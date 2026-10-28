use crate::i18n;
use anyhow::{Context, Result};
use eframe::egui::{self, ViewportCommand};
use std::cell::RefCell;
use std::sync::{
    atomic::{AtomicBool, AtomicIsize, Ordering},
    mpsc::{self, Receiver},
};
use tray_icon::{
    menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem},
    Icon, MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent,
};

pub enum TrayAction {
    Show,
    ToggleWindow,
    Exit,
}

// The tray icon owns a separate native window. When the main viewport is
// hidden, queuing a viewport command alone can leave the eframe loop asleep.
// Keep the main HWND so tray callbacks can wake/restore it immediately.
static MAIN_HWND: AtomicIsize = AtomicIsize::new(0);
static FORCE_EXIT: AtomicBool = AtomicBool::new(false);
static MAIN_HIDDEN: AtomicBool = AtomicBool::new(false);

struct PlaybackMenu {
    item: MenuItem,
    language: String,
}

thread_local! {
    // Native menu callbacks run on the thread that created the tray menu.
    // Keep the menu handle there instead of making a native UI item Send.
    static PLAYBACK_MENU: RefCell<Option<PlaybackMenu>> = const { RefCell::new(None) };
}

#[cfg(target_os = "windows")]
pub fn register_main_window(hwnd: isize) {
    MAIN_HWND.store(hwnd, Ordering::Release);
}

#[cfg(target_os = "windows")]
fn restore_native_window() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        IsIconic, IsZoomed, SetForegroundWindow, ShowWindow, SW_RESTORE, SW_SHOW, SW_SHOWMAXIMIZED,
    };
    let hwnd = MAIN_HWND.load(Ordering::Acquire);
    if hwnd != 0 {
        // SAFETY: the handle is captured from eframe's live Win32 viewport.
        unsafe {
            let was_maximized = IsZoomed(hwnd as _) != 0;
            let was_minimized = IsIconic(hwnd as _) != 0;
            if was_maximized {
                ShowWindow(hwnd as _, SW_SHOWMAXIMIZED);
            } else if was_minimized {
                ShowWindow(hwnd as _, SW_RESTORE);
            } else {
                ShowWindow(hwnd as _, SW_SHOW);
            }
            SetForegroundWindow(hwnd as _);
        }
    }
}

/// Wake the native event loop even when the eframe viewport is hidden.
///
/// Winit can stop scheduling egui repaints for an invisible window. A queued
/// Win32 message still reaches the owning thread, so the next repaint can
/// consume pending playback, download, or tray actions.
#[cfg(target_os = "windows")]
pub fn wake_main_window() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{PostMessageW, WM_NULL};
    let hwnd = MAIN_HWND.load(Ordering::Acquire);
    if hwnd != 0 {
        // SAFETY: the handle is captured from eframe's live Win32 viewport;
        // WM_NULL does not carry pointers or mutate window state.
        unsafe {
            PostMessageW(hwnd as _, WM_NULL, 0, 0);
        }
    }
}

#[cfg(target_os = "windows")]
fn request_native_exit() {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowThreadProcessId, PostMessageW, PostThreadMessageW, WM_CLOSE, WM_QUIT,
    };
    FORCE_EXIT.store(true, Ordering::Release);
    // Remove the shell entry immediately. The eframe loop may be asleep
    // because the viewport is hidden, but the user must never be left with a
    // dead tray icon while the close request is being delivered.
    remove_stale_icons();
    // A hidden eframe loop may never observe WM_CLOSE/WM_QUIT. Give the
    // normal shutdown path a short window, then terminate the process so a
    // tray exit can never leave an orphaned client behind.
    std::thread::spawn(|| {
        std::thread::sleep(std::time::Duration::from_millis(750));
        if FORCE_EXIT.load(Ordering::Acquire) {
            remove_stale_icons();
            std::process::exit(0);
        }
    });
    let hwnd = MAIN_HWND.load(Ordering::Acquire);
    if hwnd != 0 {
        // SAFETY: posting WM_CLOSE is asynchronous and does not dereference
        // the handle from this callback thread.
        unsafe {
            PostMessageW(hwnd as _, WM_CLOSE, 0, 0);
        }
        wake_main_window();
        // WM_CLOSE is handled by eframe only after its hidden viewport wakes.
        // WM_QUIT gives the owning event-loop thread an unconditional exit
        // path, so tray exit cannot remain stuck behind an invisible window.
        let thread_id = unsafe { GetWindowThreadProcessId(hwnd as _, std::ptr::null_mut()) };
        if thread_id != 0 {
            unsafe {
                PostThreadMessageW(thread_id, WM_QUIT, 0, 0);
            }
        }
    }
}

#[cfg(target_os = "windows")]
fn remove_stale_icons() {
    use std::mem::size_of;
    use windows_sys::core::GUID;
    use windows_sys::Win32::UI::Shell::{Shell_NotifyIconW, NIF_GUID, NIM_DELETE, NOTIFYICONDATAW};
    let guid = GUID::from_u128(0x4d49484f4e42414e0000000000000001);
    let mut data: NOTIFYICONDATAW = unsafe { std::mem::zeroed() };
    data.cbSize = size_of::<NOTIFYICONDATAW>() as u32;
    data.uFlags = NIF_GUID;
    data.guidItem = guid;
    data.hWnd = std::ptr::null_mut();
    // SAFETY: all fields required for GUID based NIM_DELETE are initialized.
    unsafe { Shell_NotifyIconW(NIM_DELETE, &data) };
}

#[cfg(target_os = "windows")]
pub fn force_exit_requested() -> bool {
    FORCE_EXIT.swap(false, Ordering::AcqRel)
}

#[cfg(target_os = "windows")]
fn main_window_hidden() -> bool {
    MAIN_HIDDEN.load(Ordering::Acquire)
}

pub struct SystemTray {
    icon: Option<TrayIcon>,
    show: MenuItem,
    playback: MenuItem,
    exit: MenuItem,
    receiver: Receiver<TrayAction>,
    engine: crate::engine::PlaybackEngineClient,
    language: String,
    playing: bool,
    has_track: bool,
    hidden: bool,
    restoring: bool,
    exiting: bool,
}

impl Drop for SystemTray {
    fn drop(&mut self) {
        PLAYBACK_MENU.with(|menu| *menu.borrow_mut() = None);
        // Hide the shell entry before destroying the native tray window. This
        // gives Explorer an explicit state transition during shutdown and
        // avoids leaving a stale icon behind when eframe tears down the app.
        if let Some(icon) = self.icon.take() {
            let _ = icon.set_visible(false);
            drop(icon);
        }
    }
}

impl SystemTray {
    pub fn new(
        ctx: &egui::Context,
        language: &str,
        playback_handle: crate::player::PlaybackHandle,
        engine: crate::engine::PlaybackEngineClient,
    ) -> Result<Self> {
        remove_stale_icons();
        let image = image::load_from_memory(include_bytes!("../../cloud/web/public/icon-192.png"))?
            .to_rgba8();
        let (width, height) = image.dimensions();
        let icon = Icon::from_rgba(image.into_raw(), width, height)?;
        let menu = Menu::new();
        let show = MenuItem::new(i18n::text(language, "desktop.trayHide"), true, None);
        let playback = MenuItem::new(i18n::text(language, "common.play"), false, None);
        let exit = MenuItem::new(i18n::text(language, "desktop.trayExit"), true, None);
        menu.append_items(&[
            &show,
            &PredefinedMenuItem::separator(),
            &playback,
            &PredefinedMenuItem::separator(),
            &exit,
        ])?;
        let tray = TrayIconBuilder::new()
            .with_icon(icon)
            .with_tooltip("Mihonban")
            // Keep one stable Windows identity so a restarted client can
            // reclaim a shell entry left behind by an abnormal termination.
            .with_guid(0x4d49484f4e42414e0000000000000001)
            .with_menu(Box::new(menu))
            .with_menu_on_left_click(false)
            .build()
            .context("cannot create the Windows tray icon")?;

        PLAYBACK_MENU.with(|menu| {
            *menu.borrow_mut() = Some(PlaybackMenu {
                item: playback.clone(),
                language: language.into(),
            });
        });

        let (sender, receiver) = mpsc::channel();
        let exit_engine = engine.clone();
        let show_id = show.id().clone();
        let playback_id = playback.id().clone();
        let exit_id = exit.id().clone();
        let menu_sender = sender.clone();
        let menu_ctx = ctx.clone();
        MenuEvent::set_event_handler(Some(move |event: MenuEvent| {
            if event.id == playback_id {
                // The main viewport may be hidden, in which case egui cannot
                // receive a paint event to consume a queued playback action.
                // Control the rodio sink directly so this menu item responds
                // immediately in both visible and hidden states.
                if let Some(playing) = crate::player::toggle_shared_playback(&playback_handle) {
                    PLAYBACK_MENU.with(|menu| {
                        if let Some(menu) = menu.borrow().as_ref() {
                            menu.item.set_text(i18n::text(
                                &menu.language,
                                if playing {
                                    "common.pause"
                                } else {
                                    "common.play"
                                },
                            ));
                        }
                    });
                }
                menu_ctx.request_repaint();
                return;
            }
            let action = if event.id == show_id {
                TrayAction::ToggleWindow
            } else if event.id == exit_id {
                TrayAction::Exit
            } else {
                return;
            };
            if matches!(&action, TrayAction::ToggleWindow) && main_window_hidden() {
                // A hidden eframe viewport may be waiting without a paint
                // event. Restore the native window before the queued action
                // reaches the UI loop so the toggle is always responsive.
                restore_native_window();
                menu_ctx.send_viewport_cmd(ViewportCommand::Visible(true));
                menu_ctx.send_viewport_cmd(ViewportCommand::Minimized(false));
                menu_ctx.send_viewport_cmd(ViewportCommand::Focus);
            }
            if matches!(&action, TrayAction::Exit) {
                // Stop the background playback engine before the process
                // watchdog terminates it, so no sink or download is cut off.
                exit_engine.stop_blocking(std::time::Duration::from_millis(600));
                request_native_exit();
            }
            let _ = menu_sender.send(action);
            menu_ctx.request_repaint();
            wake_main_window();
        }));
        let tray_id = tray.id().clone();
        let tray_ctx = ctx.clone();
        TrayIconEvent::set_event_handler(Some(move |event: TrayIconEvent| {
            let show = match event {
                TrayIconEvent::Click {
                    id,
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
                | TrayIconEvent::DoubleClick {
                    id,
                    button: MouseButton::Left,
                    ..
                } => id == tray_id,
                _ => false,
            };
            if show {
                tray_ctx.send_viewport_cmd(ViewportCommand::Visible(true));
                tray_ctx.send_viewport_cmd(ViewportCommand::Minimized(false));
                tray_ctx.send_viewport_cmd(ViewportCommand::Focus);
                restore_native_window();
                let _ = sender.send(TrayAction::Show);
                // A hidden viewport may not have a pending paint event, so
                // wake the eframe loop explicitly after every tray click.
                tray_ctx.request_repaint();
                wake_main_window();
            }
        }));

        Ok(Self {
            icon: Some(tray),
            show,
            playback,
            exit,
            receiver,
            engine,
            language: language.into(),
            playing: false,
            has_track: false,
            hidden: false,
            restoring: false,
            exiting: false,
        })
    }

    pub fn refresh(&mut self, language: &str, playing: bool, has_track: bool) {
        if self.language != language || self.playing != playing {
            PLAYBACK_MENU.with(|menu| {
                if let Some(menu) = menu.borrow_mut().as_mut() {
                    menu.language = language.into();
                }
            });
            self.show.set_text(i18n::text(
                language,
                if self.hidden {
                    "desktop.trayShow"
                } else {
                    "desktop.trayHide"
                },
            ));
            self.playback.set_text(i18n::text(
                language,
                if playing {
                    "common.pause"
                } else {
                    "common.play"
                },
            ));
            self.exit.set_text(i18n::text(language, "desktop.trayExit"));
            self.language = language.into();
            self.playing = playing;
        }
        if self.has_track != has_track {
            self.playback.set_enabled(has_track);
            self.has_track = has_track;
        }
    }

    pub fn actions(&self) -> Vec<TrayAction> {
        self.receiver.try_iter().collect()
    }

    pub fn is_exiting(&self) -> bool {
        self.exiting
    }

    pub fn show(&mut self, ctx: &egui::Context) {
        self.hidden = false;
        MAIN_HIDDEN.store(false, Ordering::Release);
        self.restoring = true;
        self.show
            .set_text(i18n::text(&self.language, "desktop.trayHide"));
        restore_native_window();
        ctx.send_viewport_cmd(ViewportCommand::Visible(true));
        ctx.send_viewport_cmd(ViewportCommand::Minimized(false));
        ctx.send_viewport_cmd(ViewportCommand::Focus);
        // A hidden viewport may be waiting in ControlFlow::Wait. Explicitly
        // wake the event loop so the queued viewport commands are applied.
        ctx.request_repaint();
    }

    pub fn toggle_window(&mut self, ctx: &egui::Context) {
        if self.hidden {
            self.show(ctx);
        } else {
            self.hide(ctx);
        }
    }

    pub fn exit(&mut self, ctx: &egui::Context) {
        self.exiting = true;
        self.engine.stop();
        if let Some(icon) = self.icon.take() {
            let _ = icon.set_visible(false);
            drop(icon);
        }
        ctx.send_viewport_cmd(ViewportCommand::Close);
        ctx.request_repaint();
    }

    pub fn update_window(
        &mut self,
        ctx: &egui::Context,
        minimize_to_tray: bool,
        close_to_tray: bool,
    ) -> bool {
        let (minimized, close_requested) = ctx.input(|input| {
            (
                input.viewport().minimized == Some(true),
                input.viewport().close_requested(),
            )
        });
        if self.exiting {
            return false;
        }
        if close_requested && close_to_tray {
            ctx.send_viewport_cmd(ViewportCommand::CancelClose);
            self.hide(ctx);
        } else if self.restoring {
            if !minimized {
                self.restoring = false;
            }
        } else if minimized && minimize_to_tray && !self.hidden {
            self.hide(ctx);
        }
        self.hidden
    }

    fn hide(&mut self, ctx: &egui::Context) {
        self.hidden = true;
        MAIN_HIDDEN.store(true, Ordering::Release);
        self.restoring = false;
        self.show
            .set_text(i18n::text(&self.language, "desktop.trayShow"));
        // Hide the native viewport for real. Playback, queue progression and
        // background downloads live in the playback engine thread, so no
        // off-screen stand-in window is needed to keep them alive.
        ctx.send_viewport_cmd(ViewportCommand::Visible(false));
        ctx.request_repaint();
    }
}
