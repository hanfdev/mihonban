use super::*;
use egui::{Pos2, Rect, Response, Sense, Stroke};

impl MihonbanApp {
    pub(super) fn full_player_page(&mut self, ctx: &egui::Context) {
        let Some(track) = self.current_track.clone() else {
            self.full_player = false;
            self.player_transition = None;
            return;
        };
        let Some(offset) = self.full_player_offset(ctx) else {
            return;
        };
        let screen = ctx.screen_rect();
        egui::Area::new(egui::Id::new("full-player-sheet"))
            .order(egui::Order::Foreground)
            .default_size(screen.size())
            .constrain(false)
            .fixed_pos(egui::pos2(screen.left(), screen.top() + offset))
            .show(ctx, |ui| {
                ui.set_min_size(screen.size());
                let screen_bounds = ui.max_rect();
                ui.painter().rect_filled(screen_bounds, 0.0, BG0);
                let progress = (1.0 - offset / screen.height().max(1.0)).clamp(0.0, 1.0);
                if let Some(artwork) = track.album_id.as_ref().and_then(|id| self.covers.get(id)) {
                    let backdrop_opacity = 0.78 * progress;
                    ui.scope(|ui| {
                        ui.set_opacity(backdrop_opacity);
                        paint_backdrop(ui, screen_bounds, artwork);
                    });
                }
                ui.set_opacity(progress);
                let bounds = screen_bounds.translate(Vec2::new(0.0, 18.0 * (1.0 - progress)));
                let close =
                    Rect::from_min_size(bounds.min + Vec2::new(24.0, 14.0), Vec2::splat(38.0));
                let response = ui
                    .interact(close, ui.id().with("collapse"), Sense::click())
                    .on_hover_cursor(egui::CursorIcon::PointingHand)
                    .on_hover_text(self.t("player.collapse"));
                if response.hovered() {
                    ui.painter().circle_filled(close.center(), 19.0, BG2);
                }
                ui.painter().add(egui::Shape::line(
                    vec![
                        close.center() + Vec2::new(-6.0, -3.0),
                        close.center() + Vec2::new(0.0, 3.0),
                        close.center() + Vec2::new(6.0, -3.0),
                    ],
                    Stroke::new(2.0, if response.hovered() { INK } else { DIM }),
                ));
                if response.clicked() {
                    self.set_full_player_open(false, ctx);
                }
                let album = Rect::from_center_size(
                    Pos2::new(bounds.center().x, bounds.top() + 33.0),
                    Vec2::new((bounds.width() - 112.0).min(720.0), 28.0),
                );
                if player_link(
                    ui,
                    &track.album_title,
                    album,
                    FontId::proportional(12.5),
                    DIM,
                    "full-album",
                )
                .clicked()
                {
                    self.open_player_album(ctx, &track);
                }
                let (cover, panel) = full_player_geometry(bounds);
                ui.painter().add(
                    egui::epaint::Shadow {
                        offset: Vec2::new(0.0, 34.0),
                        blur: 90.0,
                        spread: -26.0,
                        color: Color32::from_black_alpha(230),
                    }
                    .as_shape(cover, 14.0),
                );
                self.paint_player_cover(ui, ctx, &track, cover, 14.0);
                let title = Rect::from_min_size(panel.min, Vec2::new(panel.width(), 42.0));
                if player_link(
                    ui,
                    &track.title,
                    title,
                    display((bounds.width() * 0.026).clamp(24.0, 33.0)),
                    INK,
                    "full-title",
                )
                .clicked()
                {
                    self.open_player_album(ctx, &track);
                }
                let artist = Rect::from_min_size(
                    panel.min + Vec2::new(0.0, 44.0),
                    Vec2::new(panel.width(), 24.0),
                );
                if let Some(name) = artist_credit_links(
                    ui,
                    &track.artists,
                    &track.artist,
                    artist,
                    FontId::proportional(15.0),
                    DIM,
                    ui.id().with("full-artist"),
                ) {
                    self.open_player_artist(ctx, name);
                }
                self.seek_control(
                    ui,
                    &track,
                    Rect::from_min_size(
                        panel.min + Vec2::new(0.0, 82.0),
                        Vec2::new(panel.width(), 26.0),
                    ),
                    true,
                );
                self.playback_controls(
                    ui,
                    Pos2::new(panel.center().x - 158.0, panel.top() + 141.0),
                    true,
                );
                let volume_width = (panel.width() * 0.9).min(280.0);
                self.volume_control(
                    ui,
                    Rect::from_center_size(
                        Pos2::new(panel.center().x, panel.top() + 242.0),
                        Vec2::new(volume_width, 24.0),
                    ),
                );
            });
        ctx.request_repaint_after(Duration::from_millis(100));
    }

    pub(super) fn player_bar(&mut self, ctx: &egui::Context, ui: &mut egui::Ui) {
        let Some(track) = self.current_track.clone() else {
            return;
        };
        let (bounds, _) =
            ui.allocate_exact_size(Vec2::new(ui.available_width(), 52.0), Sense::hover());
        let cover = Rect::from_min_size(bounds.min, Vec2::splat(52.0));
        self.paint_player_cover(ui, ctx, &track, cover, 7.0);
        if ui
            .interact(cover, ui.id().with("player-cover"), Sense::click())
            .on_hover_cursor(egui::CursorIcon::PointingHand)
            .on_hover_text(self.t("player.viewAlbum"))
            .clicked()
        {
            self.set_full_player_open(true, ctx);
        }
        let info_width = ((bounds.width() - 760.0) * 0.5 + 200.0).clamp(120.0, 200.0);
        let title = Rect::from_min_size(
            bounds.min + Vec2::new(68.0, 5.0),
            Vec2::new(info_width, 22.0),
        );
        if player_link(
            ui,
            &track.title,
            title,
            FontId::new(13.5, egui::FontFamily::Name("mihonban-ui-bold".into())),
            INK,
            "mini-title",
        )
        .clicked()
        {
            self.open_player_album(ctx, &track);
        }
        let artist = title.translate(Vec2::new(0.0, 22.0));
        if let Some(name) = artist_credit_links(
            ui,
            &track.artists,
            &track.artist,
            artist,
            FontId::proportional(12.0),
            FAINT,
            ui.id().with("mini-artist"),
        ) {
            self.open_player_artist(ctx, name);
        }
        let controls = Pos2::new(title.right() + 16.0, bounds.center().y - 22.0);
        self.playback_controls(ui, controls, false);
        let volume = Rect::from_min_size(
            Pos2::new(bounds.right() - 130.0, bounds.center().y - 12.0),
            Vec2::new(130.0, 24.0),
        );
        let progress_left = controls.x + 212.0 + 16.0;
        let progress = Rect::from_min_max(
            Pos2::new(progress_left, bounds.center().y - 9.0),
            Pos2::new(volume.left() - 16.0, bounds.center().y + 9.0),
        );
        self.seek_control(ui, &track, progress, false);
        self.volume_control(ui, volume);
        ctx.request_repaint_after(Duration::from_millis(100));
    }

    fn paint_player_cover(
        &mut self,
        ui: &egui::Ui,
        ctx: &egui::Context,
        track: &Track,
        cover: Rect,
        rounding: f32,
    ) {
        ui.painter().rect_filled(cover, rounding, BG2);
        if let Some(id) = &track.album_id {
            if let Some(artwork) = self.covers.get(id) {
                egui::Image::from_texture((artwork.original.id(), cover.size()))
                    .rounding(rounding)
                    .paint_at(ui, cover);
            } else {
                self.load_cover(ctx, id.clone());
            }
        }
    }

    fn open_player_album(&mut self, ctx: &egui::Context, track: &Track) {
        if let Some(id) = &track.album_id {
            self.set_full_player_open(false, ctx);
            self.selected_artist = None;
            self.load_cover(ctx, id.clone());
            self.load_album(id.clone());
        }
    }

    fn open_player_artist(&mut self, ctx: &egui::Context, name: &str) {
        self.set_full_player_open(false, ctx);
        self.open_artist(name.to_owned());
    }

    fn playback_controls(&mut self, ui: &mut egui::Ui, origin: Pos2, big: bool) {
        let playing = self.engine.is_playing();
        let repeat = self.playback_order.repeat;
        let shuffled = self.playback_order.shuffled;
        let buttons = [
            (
                if big { 22.0 } else { 17.0 },
                if big { 44.0 } else { 34.0 },
                Icon::Shuffle,
                "shuffle",
                self.t("player.shuffle"),
                shuffled,
            ),
            (
                if big { 85.0 } else { 59.0 },
                if big { 50.0 } else { 38.0 },
                Icon::Previous,
                "previous",
                self.t("player.prev"),
                false,
            ),
            (
                if big { 158.0 } else { 106.0 },
                if big { 64.0 } else { 44.0 },
                if playing { Icon::Pause } else { Icon::Play },
                "toggle",
                self.t(if playing {
                    "common.pause"
                } else {
                    "common.play"
                }),
                playing,
            ),
            (
                if big { 231.0 } else { 153.0 },
                if big { 50.0 } else { 38.0 },
                Icon::Next,
                "next",
                self.t("player.next"),
                false,
            ),
            (
                if big { 294.0 } else { 195.0 },
                if big { 44.0 } else { 34.0 },
                if repeat == RepeatMode::One {
                    Icon::RepeatOne
                } else {
                    Icon::Repeat
                },
                "repeat",
                self.t(repeat.label()),
                repeat != RepeatMode::Off,
            ),
        ];
        for (horizontal, size, icon, id, label, active) in buttons {
            let rect = Rect::from_center_size(
                origin + Vec2::new(horizontal, if big { 32.0 } else { 22.0 }),
                Vec2::splat(size),
            );
            let response = ui
                .interact(rect, ui.id().with(id), Sense::click())
                .on_hover_cursor(egui::CursorIcon::PointingHand)
                .on_hover_text(label);
            response
                .widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Button, true, label));
            let main = id == "toggle";
            let hover = hover_progress(
                ui.ctx(),
                response.id.with("hover"),
                response.hovered(),
                0.15,
            );
            if main {
                ui.painter().circle_filled(
                    rect.center(),
                    size * 0.5 * (1.0 + 0.06 * hover),
                    if playing {
                        if response.hovered() {
                            ACCENT_HI
                        } else {
                            ACCENT
                        }
                    } else if response.hovered() {
                        Color32::WHITE
                    } else {
                        INK
                    },
                );
            } else if hover > 0.0 {
                ui.painter()
                    .circle_filled(rect.center(), size * 0.5, BG2.gamma_multiply(hover));
            }
            let icon_size = if main {
                if big {
                    28.0
                } else {
                    18.0
                }
            } else if big {
                if id == "previous" || id == "next" {
                    26.0
                } else {
                    20.0
                }
            } else if id == "previous" || id == "next" {
                18.0
            } else {
                16.0
            };
            paint_icon(
                ui.painter(),
                Rect::from_center_size(rect.center(), Vec2::splat(icon_size)),
                icon,
                if main {
                    if playing {
                        Color32::from_rgb(255, 246, 236)
                    } else {
                        BG0
                    }
                } else if active {
                    ACCENT_HI
                } else if response.hovered() {
                    INK
                } else {
                    DIM
                },
            );
            if active && !main {
                ui.painter().circle_filled(
                    Pos2::new(rect.center().x, rect.bottom() - 5.0),
                    2.0,
                    ACCENT_HI,
                );
            }
            if response.has_focus() {
                ui.painter().circle_stroke(
                    rect.center(),
                    size * 0.5 + 2.0,
                    Stroke::new(1.0, ACCENT_HI),
                );
            }
            if response.clicked() {
                match id {
                    "previous" => self.step_queue(false),
                    "next" => self.step_queue(true),
                    "shuffle" => {
                        self.playback_order.toggle_shuffle();
                        self.engine.set_shuffle(self.playback_order.shuffled);
                    }
                    "repeat" => {
                        self.playback_order.repeat.cycle();
                        self.engine.set_repeat(self.playback_order.repeat);
                    }
                    _ => self.engine.toggle(),
                }
            }
        }
    }

    fn seek_control(&mut self, ui: &mut egui::Ui, track: &Track, bounds: Rect, big: bool) {
        let duration = track
            .duration
            .filter(|duration| duration.is_finite() && *duration > 0.0)
            .unwrap_or(0.0);
        let mut position = self.engine.position().as_secs_f64().min(duration);
        let bar = if big {
            bounds
        } else {
            Rect::from_min_max(
                bounds.min + Vec2::new(48.0, 0.0),
                bounds.max - Vec2::new(48.0, 0.0),
            )
        };
        let response = media_slider(
            ui,
            bar,
            "seek",
            &mut position,
            duration,
            big,
            self.t("player.seek"),
        );
        let seek_error_id = egui::Id::new("player-seek-error");
        if should_commit_seek(&response) {
            // The engine reports a failed seek through its error channel and
            // the status line; the seek bar itself keeps the released value.
            self.engine.seek(Duration::from_secs_f64(position));
            ui.ctx()
                .data_mut(|data| data.remove::<(String, Instant)>(seek_error_id));
        }
        let elapsed = format_duration(Some(position));
        let remaining = if duration > 0.0 {
            if big {
                format!("-{}", format_duration(Some((duration - position).max(0.0))))
            } else {
                format_duration(Some(duration))
            }
        } else {
            "–:––".into()
        };
        let text_top = if big { bounds.bottom() } else { bounds.top() };
        let left = Rect::from_min_size(Pos2::new(bounds.left(), text_top), Vec2::new(40.0, 18.0));
        let right = Rect::from_min_size(
            Pos2::new(bounds.right() - 40.0, text_top),
            Vec2::new(40.0, 18.0),
        );
        paint_text(ui, &elapsed, left, FontId::proportional(11.5), FAINT, false);
        let galley = ui
            .painter()
            .layout_no_wrap(remaining, FontId::proportional(11.5), FAINT);
        ui.painter().galley(
            Pos2::new(
                if big {
                    right.right() - galley.size().x
                } else {
                    right.left()
                },
                right.center().y - galley.size().y * 0.5,
            ),
            galley,
            FAINT,
        );
        if let Some((track_id, started)) = ui
            .ctx()
            .data(|data| data.get_temp::<(String, Instant)>(seek_error_id))
        {
            if track_id != track.id || started.elapsed() >= Duration::from_secs(4) {
                ui.ctx()
                    .data_mut(|data| data.remove::<(String, Instant)>(seek_error_id));
            } else if big == (self.full_player || self.player_transition.is_some()) {
                egui::Area::new(seek_error_id.with("notice"))
                    .order(egui::Order::Tooltip)
                    .pivot(egui::Align2::CENTER_BOTTOM)
                    .fixed_pos(Pos2::new(bar.center().x, bar.top() - 8.0))
                    .interactable(false)
                    .show(ui.ctx(), |ui| {
                        egui::Frame::none()
                            .fill(BG1)
                            .stroke(Stroke::new(1.0, LINE))
                            .rounding(8.0)
                            .inner_margin(egui::Margin::symmetric(12.0, 9.0))
                            .show(ui, |ui| {
                                ui.set_max_width(300.0);
                                ui.label(
                                    RichText::new(self.t("player.seekFailed"))
                                        .size(12.0)
                                        .color(INK),
                                );
                            });
                    });
                ui.ctx().request_repaint_after(Duration::from_millis(100));
            }
        }
    }

    fn volume_control(&mut self, ui: &mut egui::Ui, bounds: Rect) {
        let mute = Rect::from_center_size(
            Pos2::new(bounds.left() + 11.0, bounds.center().y),
            Vec2::splat(22.0),
        );
        let response = ui
            .interact(mute, ui.id().with("mute"), Sense::click())
            .on_hover_cursor(egui::CursorIcon::PointingHand)
            .on_hover_text(self.t(if self.volume > 0.0 {
                "player.mute"
            } else {
                "player.unmute"
            }));
        if response.hovered() {
            ui.painter().circle_filled(mute.center(), 11.0, BG2);
        }
        paint_icon(
            ui.painter(),
            mute.shrink(3.0),
            if self.volume == 0.0 {
                Icon::VolumeMuted
            } else if self.volume < 0.5 {
                Icon::VolumeLow
            } else {
                Icon::Volume
            },
            if response.hovered() { INK } else { FAINT },
        );
        if response.clicked() {
            self.volume = if self.volume > 0.0 {
                0.0
            } else {
                self.last_audible_volume
            };
            self.engine.set_volume(self.volume);
        }
        let bar = Rect::from_min_max(Pos2::new(mute.right() + 8.0, bounds.top()), bounds.max);
        let mut volume = f64::from(self.volume);
        if media_slider(
            ui,
            bar,
            "volume",
            &mut volume,
            1.0,
            true,
            self.t("player.volume"),
        )
        .changed()
        {
            self.volume = volume as f32;
            if self.volume > 0.0 {
                self.last_audible_volume = self.volume;
            }
            self.engine.set_volume(self.volume);
        }
    }
}

fn full_player_geometry(bounds: Rect) -> (Rect, Rect) {
    let mut art_size = (bounds.height() * 0.44)
        .min(bounds.width() * 0.36)
        .clamp(240.0, 440.0);
    let mut panel_width = (bounds.width() * 0.46).min(460.0);
    let gap = (bounds.width() * 0.065).clamp(40.0, 84.0);
    let overflow = (art_size + gap + panel_width - (bounds.width() - 48.0)).max(0.0);
    art_size -= overflow * 0.5;
    panel_width -= overflow * 0.5;
    let center_y = bounds.top() + 52.0 + (bounds.height() - 76.0 - bounds.height() * 0.04) * 0.5;
    let left = bounds.center().x - (art_size + gap + panel_width) * 0.5;
    let cover = Rect::from_min_size(
        Pos2::new(left, center_y - art_size * 0.5),
        Vec2::splat(art_size),
    );
    let panel = Rect::from_min_size(
        Pos2::new(cover.right() + gap, center_y - 126.0),
        Vec2::new(panel_width, 253.0),
    );
    (cover, panel)
}

fn player_link(
    ui: &egui::Ui,
    text: &str,
    rect: Rect,
    font: FontId,
    color: Color32,
    id: &str,
) -> Response {
    let response = ui
        .interact(rect, ui.id().with(id), Sense::click())
        .on_hover_cursor(egui::CursorIcon::PointingHand);
    paint_text(
        ui,
        text,
        rect,
        font,
        if response.hovered() { GOLD } else { color },
        id == "full-album",
    );
    if response.has_focus() {
        ui.painter()
            .rect_stroke(rect, 3.0, Stroke::new(1.0, ACCENT_HI));
    }
    response
}

fn media_slider(
    ui: &mut egui::Ui,
    bounds: Rect,
    name: &str,
    value: &mut f64,
    maximum: f64,
    thumb: bool,
    label: &str,
) -> Response {
    let mut response = ui
        .interact(bounds, ui.id().with(name), Sense::click_and_drag())
        .on_hover_cursor(egui::CursorIcon::PointingHand);
    let preview_id = response.id.with("preview");
    let focused = ui.input(|input| input.focused);
    if !focused {
        ui.ctx().data_mut(|data| data.remove::<f64>(preview_id));
    }
    let preview = ui.ctx().data(|data| data.get_temp::<f64>(preview_id));
    if maximum > 0.0 && focused {
        if let Some(preview) = preview {
            *value = preview;
        }
        let transform = ui
            .ctx()
            .memory(|memory| memory.layer_transforms.get(&response.layer_id).copied())
            .unwrap_or(egui::emath::TSTransform::IDENTITY);
        let completed_press = ui.input(|input| {
            let mut press = None;
            for event in &input.raw.events {
                if let egui::Event::PointerButton {
                    pos,
                    button: egui::PointerButton::Primary,
                    pressed,
                    ..
                } = event
                {
                    if *pressed {
                        press = Some(*pos);
                    } else if press.is_some() {
                        return press;
                    }
                }
            }
            None
        });
        let completed_gesture = response.enabled()
            && completed_press.is_some_and(|press| {
                (transform * bounds.intersect(ui.clip_rect())).contains(press)
                    && ui.ctx().layer_id_at(press) == Some(response.layer_id)
            });
        let pointer_released = (preview.is_some() || completed_gesture)
            && ui.input(|input| input.pointer.any_released());
        if response.clicked()
            || response.is_pointer_button_down_on()
            || response.dragged()
            || response.drag_stopped()
            || pointer_released
        {
            // A fast press/move/release can finish before egui classifies it as
            // a drag. Keep the press capture and commit its final pointer value.
            let pointer = response.interact_pointer_pos().or_else(|| {
                pointer_released
                    .then(|| ui.input(|input| input.pointer.interact_pos()))
                    .flatten()
                    .map(|pointer| transform.inverse() * pointer)
            });
            if let Some(pointer) = pointer {
                *value = f64::from(((pointer.x - bounds.left()) / bounds.width()).clamp(0.0, 1.0))
                    * maximum;
                ui.ctx()
                    .data_mut(|data| data.insert_temp(preview_id, *value));
                response.mark_changed();
                response.request_focus();
            } else if pointer_released {
                response.mark_changed();
            }
        }
        if response.has_focus() {
            let step = if maximum <= 1.0 {
                0.02
            } else if ui.input(|input| input.modifiers.shift) {
                30.0
            } else {
                5.0
            };
            let next = ui.input(|input| {
                if input.key_pressed(egui::Key::ArrowRight) || input.key_pressed(egui::Key::ArrowUp)
                {
                    Some(*value + step)
                } else if input.key_pressed(egui::Key::ArrowLeft)
                    || input.key_pressed(egui::Key::ArrowDown)
                {
                    Some(*value - step)
                } else if input.key_pressed(egui::Key::Home) {
                    Some(0.0)
                } else if input.key_pressed(egui::Key::End) {
                    Some(maximum)
                } else {
                    None
                }
            });
            if let Some(next) = next {
                *value = next.clamp(0.0, maximum);
                response.mark_changed();
            }
        }
    }
    if !response.dragged() && !response.is_pointer_button_down_on() {
        ui.ctx().data_mut(|data| data.remove::<f64>(preview_id));
    }
    response
        .widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Slider, maximum > 0.0, label));
    let fraction = if maximum > 0.0 {
        (*value / maximum).clamp(0.0, 1.0) as f32
    } else {
        0.0
    };
    let thickness = if name == "volume" {
        3.0
    } else if thumb {
        4.0
    } else {
        3.5
    };
    let rail = Rect::from_center_size(bounds.center(), Vec2::new(bounds.width(), thickness));
    let tip = Pos2::new(rail.left() + rail.width() * fraction, rail.center().y);
    ui.painter().rect_filled(rail, 2.0, BG3);
    let color = if response.hovered() || response.dragged() {
        ACCENT_HI
    } else if name == "volume" {
        DIM
    } else {
        INK
    };
    ui.painter().rect_filled(
        Rect::from_min_max(rail.min, Pos2::new(tip.x, rail.bottom())),
        2.0,
        color,
    );
    if thumb || response.hovered() || response.dragged() || response.has_focus() {
        let radius = if response.dragged() {
            7.4
        } else if name == "seek" && thumb {
            6.0
        } else {
            5.5
        };
        ui.painter().circle_filled(tip, radius, INK);
    }
    if response.has_focus() && name != "seek" && name != "volume" {
        ui.painter().rect_stroke(
            bounds.expand(2.0),
            3.0,
            Stroke::new(1.0, ACCENT_HI.gamma_multiply(0.65)),
        );
    }
    response
}

fn should_commit_seek(response: &Response) -> bool {
    response.changed()
        && (response.clicked() || response.drag_stopped() || !response.is_pointer_button_down_on())
}

fn paint_backdrop(ui: &egui::Ui, bounds: Rect, artwork: &Artwork) {
    let aspect = bounds.width() / bounds.height();
    let half = Vec2::new(aspect.min(1.0), aspect.recip().min(1.0)) / 2.8;
    ui.painter().image(
        artwork.backdrop.id(),
        bounds,
        Rect::from_min_max(Pos2::new(0.5, 0.5) - half, Pos2::new(0.5, 0.5) + half),
        Color32::from_gray(77),
    );
    let mut mesh = egui::Mesh::default();
    let divisions = 20;
    for vertical in 0..=divisions {
        for horizontal in 0..=divisions {
            let fraction = Vec2::new(
                horizontal as f32 / divisions as f32,
                vertical as f32 / divisions as f32,
            );
            let distance = (((fraction.x - 0.5) / 1.2).powi(2) + (fraction.y / 0.9).powi(2)).sqrt();
            let radial = ((distance - 0.25) / 0.75).clamp(0.0, 1.0) * 0.6;
            let linear = 0.3 + fraction.y * 0.55;
            mesh.colored_vertex(
                bounds.min + bounds.size() * fraction,
                Color32::from_rgba_unmultiplied(
                    13,
                    11,
                    9,
                    ((1.0 - (1.0 - radial) * (1.0 - linear)) * 255.0) as u8,
                ),
            );
            if horizontal < divisions && vertical < divisions {
                let index = (vertical * (divisions + 1) + horizontal) as u32;
                mesh.add_triangle(index, index + 1, index + divisions as u32 + 1);
                mesh.add_triangle(
                    index + 1,
                    index + divisions as u32 + 2,
                    index + divisions as u32 + 1,
                );
            }
        }
    }
    ui.painter().add(mesh);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn slider_frame(
        ctx: &egui::Context,
        events: Vec<egui::Event>,
        playback_position: f64,
    ) -> (f64, bool, bool, bool, bool, bool) {
        named_slider_frame(ctx, events, playback_position, "seek", 180.0, true)
    }

    fn named_slider_frame(
        ctx: &egui::Context,
        events: Vec<egui::Event>,
        playback_position: f64,
        name: &str,
        maximum: f64,
        focused: bool,
    ) -> (f64, bool, bool, bool, bool, bool) {
        let mut result = None;
        let input = egui::RawInput {
            screen_rect: Some(Rect::from_min_size(Pos2::ZERO, Vec2::new(500.0, 200.0))),
            events,
            focused,
            ..Default::default()
        };
        let _ = ctx.run(input, |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                let mut value = playback_position;
                let response = media_slider(
                    ui,
                    Rect::from_min_max(Pos2::new(100.0, 50.0), Pos2::new(400.0, 80.0)),
                    name,
                    &mut value,
                    maximum,
                    false,
                    "Seek",
                );
                result = Some((
                    value,
                    response.changed(),
                    response.dragged(),
                    response.drag_stopped(),
                    response.changed() && !response.is_pointer_button_down_on(),
                    should_commit_seek(&response),
                ));
            });
        });
        result.unwrap()
    }

    fn pointer_button(pos: Pos2, pressed: bool) -> egui::Event {
        egui::Event::PointerButton {
            pos,
            button: egui::PointerButton::Primary,
            pressed,
            modifiers: egui::Modifiers::NONE,
        }
    }

    #[test]
    fn seek_slider_commits_the_dragged_position_on_release() {
        let ctx = egui::Context::default();
        slider_frame(&ctx, vec![], 10.0);
        let start = Pos2::new(120.0, 65.0);
        slider_frame(
            &ctx,
            vec![
                egui::Event::PointerMoved(start),
                pointer_button(start, true),
            ],
            10.0,
        );
        let target = Pos2::new(325.0, 65.0);
        let dragging = slider_frame(&ctx, vec![egui::Event::PointerMoved(target)], 10.1);
        assert!(dragging.2);
        assert!(!dragging.4);
        assert!(!dragging.5);
        assert!((dragging.0 - 135.0).abs() < 0.001);
        let stationary = slider_frame(&ctx, vec![], 10.2);
        assert!(stationary.2);
        assert!((stationary.0 - 135.0).abs() < 0.001);
        let released = slider_frame(&ctx, vec![pointer_button(target, false)], 10.3);
        assert!(released.3);
        assert!(released.1);
        assert!(!released.2);
        assert!(released.4);
        assert!(released.5);
        assert!((released.0 - 135.0).abs() < 0.001);
    }

    #[test]
    fn seek_slider_keeps_the_drag_preview_when_the_pointer_leaves_the_window() {
        let ctx = egui::Context::default();
        slider_frame(&ctx, vec![], 10.0);
        let start = Pos2::new(120.0, 65.0);
        slider_frame(
            &ctx,
            vec![
                egui::Event::PointerMoved(start),
                pointer_button(start, true),
            ],
            10.0,
        );
        let target = Pos2::new(325.0, 65.0);
        slider_frame(&ctx, vec![egui::Event::PointerMoved(target)], 10.1);
        slider_frame(&ctx, vec![egui::Event::PointerGone], 10.2);
        let outside = slider_frame(&ctx, vec![], 10.3);
        assert!(outside.2);
        assert!((outside.0 - 135.0).abs() < 0.001);
        let released = slider_frame(&ctx, vec![pointer_button(target, false)], 10.4);
        assert!(released.1 && !released.2);
        assert!((released.0 - 135.0).abs() < 0.001);
    }

    #[test]
    fn seek_slider_commits_a_fast_drag_released_on_the_next_frame() {
        let ctx = egui::Context::default();
        slider_frame(&ctx, vec![], 10.0);
        let start = Pos2::new(120.0, 65.0);
        slider_frame(
            &ctx,
            vec![
                egui::Event::PointerMoved(start),
                pointer_button(start, true),
            ],
            10.0,
        );
        let target = Pos2::new(325.0, 65.0);
        let released = slider_frame(
            &ctx,
            vec![
                egui::Event::PointerMoved(target),
                pointer_button(target, false),
            ],
            10.1,
        );
        assert!(released.4);
        assert!(released.5);
        assert!((released.0 - 135.0).abs() < 0.001);
    }

    #[test]
    fn seek_slider_accepts_a_click_completed_in_one_frame() {
        let ctx = egui::Context::default();
        slider_frame(&ctx, vec![], 10.0);
        let target = Pos2::new(325.0, 65.0);
        let clicked = slider_frame(
            &ctx,
            vec![
                egui::Event::PointerMoved(target),
                pointer_button(target, true),
                pointer_button(target, false),
            ],
            10.1,
        );
        assert!(clicked.4);
        assert!(clicked.5);
        assert!((clicked.0 - 135.0).abs() < 0.001);
    }

    #[test]
    fn seek_slider_commits_a_drag_completed_in_one_frame() {
        let ctx = egui::Context::default();
        slider_frame(&ctx, vec![], 10.0);
        let start = Pos2::new(120.0, 65.0);
        let target = Pos2::new(325.0, 65.0);
        let released = slider_frame(
            &ctx,
            vec![
                egui::Event::PointerMoved(start),
                pointer_button(start, true),
                egui::Event::PointerMoved(target),
                pointer_button(target, false),
            ],
            10.1,
        );
        assert!(released.4);
        assert!(released.5);
        assert!((released.0 - 135.0).abs() < 0.001);
    }

    #[test]
    fn seek_slider_ignores_a_gesture_started_outside_the_rail() {
        let ctx = egui::Context::default();
        slider_frame(&ctx, vec![], 10.0);
        let start = Pos2::new(50.0, 65.0);
        let target = Pos2::new(325.0, 65.0);
        let released = slider_frame(
            &ctx,
            vec![
                egui::Event::PointerMoved(start),
                pointer_button(start, true),
                egui::Event::PointerMoved(target),
                pointer_button(target, false),
            ],
            10.1,
        );
        assert!(!released.4);
        assert!(!released.5);
        assert_eq!(released.0, 10.1);
    }

    #[test]
    fn seek_slider_clamps_a_release_outside_the_rail() {
        let ctx = egui::Context::default();
        slider_frame(&ctx, vec![], 10.0);
        let start = Pos2::new(120.0, 65.0);
        slider_frame(
            &ctx,
            vec![
                egui::Event::PointerMoved(start),
                pointer_button(start, true),
            ],
            10.0,
        );
        let target = Pos2::new(450.0, 100.0);
        let released = slider_frame(
            &ctx,
            vec![
                egui::Event::PointerMoved(target),
                pointer_button(target, false),
            ],
            10.1,
        );
        assert!(released.4);
        assert_eq!(released.0, 180.0);
    }

    #[test]
    fn seek_slider_discards_the_preview_when_the_window_loses_focus() {
        let ctx = egui::Context::default();
        slider_frame(&ctx, vec![], 10.0);
        let start = Pos2::new(120.0, 65.0);
        slider_frame(
            &ctx,
            vec![
                egui::Event::PointerMoved(start),
                pointer_button(start, true),
            ],
            10.0,
        );
        slider_frame(
            &ctx,
            vec![egui::Event::PointerMoved(Pos2::new(325.0, 65.0))],
            10.1,
        );
        let unfocused = named_slider_frame(&ctx, vec![], 10.2, "seek", 180.0, false);
        assert_eq!(unfocused.0, 10.2);
        assert!(!unfocused.4);
    }

    #[test]
    fn volume_slider_still_updates_while_the_pointer_is_held() {
        let ctx = egui::Context::default();
        named_slider_frame(&ctx, vec![], 0.25, "volume", 1.0, true);
        let start = Pos2::new(120.0, 65.0);
        named_slider_frame(
            &ctx,
            vec![
                egui::Event::PointerMoved(start),
                pointer_button(start, true),
            ],
            0.25,
            "volume",
            1.0,
            true,
        );
        let dragged = named_slider_frame(
            &ctx,
            vec![egui::Event::PointerMoved(Pos2::new(325.0, 65.0))],
            0.25,
            "volume",
            1.0,
            true,
        );
        assert!(dragged.1 && dragged.2);
        assert!((dragged.0 - 0.75).abs() < 0.001);
    }

    #[test]
    fn player_fits_supported_windows_and_stays_centered() {
        for size in [
            Vec2::new(960.0, 600.0),
            Vec2::new(1280.0, 820.0),
            Vec2::new(1920.0, 1080.0),
            Vec2::new(3840.0, 2160.0),
        ] {
            let bounds = Rect::from_min_size(Pos2::new(0.0, 22.0), size);
            let (cover, panel) = full_player_geometry(bounds);
            assert!(bounds.contains_rect(cover));
            assert!(bounds.contains_rect(panel));
            assert!(panel.left() - cover.right() >= 40.0);
            assert!((cover.width() - cover.height()).abs() < 0.01);
            assert!(((cover.left() + panel.right()) * 0.5 - bounds.center().x).abs() < 0.01);
            assert!((cover.center().y - panel.center().y).abs() < 1.0);
        }
    }
}
