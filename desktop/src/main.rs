#![cfg_attr(
    all(target_os = "windows", not(debug_assertions)),
    windows_subsystem = "windows"
)]

mod api;
mod app;
mod cache;
mod config;
mod engine;
mod i18n;
mod instance;
mod player;
mod queue;
#[cfg(target_os = "windows")]
mod tray;
mod ui;
mod updates;

fn main() -> eframe::Result<()> {
    let Some(_instance) = instance::acquire() else {
        return Ok(());
    };
    let options = eframe::NativeOptions {
        persist_window: false,
        viewport: eframe::egui::ViewportBuilder::default()
            .with_min_inner_size([960.0, 640.0])
            .with_maximized(true)
            .with_icon(eframe::egui::IconData {
                rgba: image::load_from_memory(include_bytes!(
                    "../../cloud/web/public/icon-192.png"
                ))
                .expect("bundled application icon")
                .to_rgba8()
                .into_raw(),
                width: 192,
                height: 192,
            })
            .with_title("Mihonban"),
        ..Default::default()
    };
    eframe::run_native(
        "Mihonban",
        options,
        Box::new(|cc| Ok(Box::new(app::MihonbanApp::new(cc)))),
    )
}
