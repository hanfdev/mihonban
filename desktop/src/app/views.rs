use super::tracks::{TrackSource, TRACK_GAP, TRACK_HEIGHT};
use super::*;

impl MihonbanApp {
    fn track_rows(&mut self, ui: &mut egui::Ui, ctx: &egui::Context, tracks: &[Track], flat: bool) {
        self.track_rows_from(ui, ctx, TrackSource::Direct(tracks), flat);
    }

    pub(super) fn track_rows_from(
        &mut self,
        ui: &mut egui::Ui,
        ctx: &egui::Context,
        tracks: TrackSource<'_>,
        flat: bool,
    ) {
        if tracks.len() == 0 {
            empty_state(ui, self.t("desktop.noTracks"));
            return;
        }
        let mut previous_disc = 0;
        let multiple_discs = !flat && (0..tracks.len()).any(|index| tracks.get(index).disc > 1);
        let original_gap = ui.spacing().item_spacing.y;
        let viewport = if flat {
            ui.spacing_mut().item_spacing.y = TRACK_GAP;
            Some(visible_grid_rows(
                tracks.len(),
                TRACK_HEIGHT,
                TRACK_GAP,
                ui.cursor().top(),
                ui.clip_rect().top(),
                ui.clip_rect().bottom(),
                2,
            ))
        } else {
            None
        };
        let range = viewport
            .as_ref()
            .map(|view| view.rows.clone())
            .unwrap_or(0..tracks.len());
        if let Some(view) = &viewport {
            ui.add_space(view.before);
        }
        for index in range {
            let track = tracks.get(index);
            if !flat && multiple_discs && previous_disc != track.disc {
                ui.add_space(12.0);
                ui.label(
                    RichText::new(self.tf("common.disc", &[&track.disc.max(1).to_string()]))
                        .color(FAINT)
                        .size(12.0),
                );
                previous_disc = track.disc;
            }
            let (rect, _) = ui.allocate_exact_size(
                Vec2::new(ui.available_width(), if flat { TRACK_HEIGHT } else { 60.0 }),
                egui::Sense::hover(),
            );
            if !ui.is_rect_visible(rect) {
                continue;
            }
            let response = ui.interact(
                rect,
                ui.id().with(("track-row", &track.id)),
                egui::Sense::click(),
            );
            let current = self
                .current_track
                .as_ref()
                .is_some_and(|current| current.id == track.id);
            let hovered = response.contains_pointer();
            if hovered || current {
                ui.painter().rect_filled(rect, 10.0, BG1);
            }
            if let Some((id, start)) = &self.track_view.flash {
                let elapsed = ctx.input(|input| input.time) - start;
                if id == &track.id && elapsed < 1.7 {
                    let opacity = if elapsed < 0.765 {
                        1.0
                    } else {
                        ((1.7 - elapsed) / 0.935).max(0.0)
                    };
                    ui.painter().rect_filled(
                        rect,
                        10.0,
                        ACCENT.gamma_multiply(0.18 * opacity as f32),
                    );
                    ctx.request_repaint();
                }
            }
            let mut child_clicked = false;
            let can_edit_favorites = self.role.as_deref() == Some("admin") && self.favorites_loaded;
            let heart_column = !flat || can_edit_favorites || self.page == Page::Favorites;
            let duration_right = rect.right() - if heart_column { 64.0 } else { 12.0 };
            let duration_left = duration_right - 52.0;
            let main_left = if flat {
                let art_rect =
                    egui::Rect::from_min_size(rect.min + Vec2::new(12.0, 9.0), Vec2::splat(42.0));
                if let Some(id) = &track.album_id {
                    if let Some(artwork) = self.covers.get(id) {
                        egui::Image::from_texture((artwork.original.id(), art_rect.size()))
                            .rounding(7.0)
                            .paint_at(ui, art_rect);
                    } else {
                        self.load_cover(ctx, id.clone());
                    }
                    if ui
                        .interact(art_rect, response.id.with("album"), egui::Sense::click())
                        .clicked()
                    {
                        self.load_album(id.clone());
                        child_clicked = true;
                    }
                }
                art_rect.right() + 14.0
            } else {
                let number_rect = egui::Rect::from_min_size(
                    rect.min + Vec2::new(14.0, 0.0),
                    Vec2::new(34.0, rect.height()),
                );
                if hovered || current && self.engine.is_playing() {
                    paint_icon(
                        ui.painter(),
                        egui::Rect::from_center_size(number_rect.center(), Vec2::splat(13.0)),
                        if current && self.engine.is_playing() {
                            Icon::Pause
                        } else {
                            Icon::Play
                        },
                        if current { ACCENT_HI } else { INK },
                    );
                } else {
                    paint_text(
                        ui,
                        &track.track.unwrap_or((index + 1) as i32).to_string(),
                        number_rect,
                        FontId::proportional(12.5),
                        FAINT,
                        true,
                    );
                }
                number_rect.right() + 12.0
            };
            let show_album = flat && rect.width() > 720.0;
            let title_right = if flat {
                if show_album {
                    main_left + (rect.width() - 44.0 - 52.0 - 24.0 - 42.0) * (1.4 / 2.4)
                } else {
                    rect.right() - 108.0
                }
            } else {
                rect.right() - 270.0
            };
            let title_rect = egui::Rect::from_min_size(
                egui::pos2(main_left, rect.top() + if flat { 8.0 } else { 10.0 }),
                Vec2::new((title_right - main_left).max(80.0), 20.0),
            );
            paint_text(
                ui,
                &track.title,
                title_rect,
                FontId::proportional(14.5),
                if current {
                    ACCENT_HI
                } else if hovered {
                    INK
                } else {
                    DIM
                },
                false,
            );
            let artist_rect = title_rect.translate(Vec2::new(0.0, 21.0));
            let clicked_artist = artist_credit_links(
                ui,
                &track.artists,
                &track.artist,
                artist_rect,
                FontId::proportional(11.5),
                FAINT,
                response.id.with("artist"),
            );
            if let Some(name) = clicked_artist {
                self.open_artist(name.to_owned());
                child_clicked = true;
            }
            if show_album {
                let album_rect = egui::Rect::from_min_max(
                    egui::pos2(title_right + 20.0, rect.top()),
                    egui::pos2(duration_left - 14.0, rect.bottom()),
                );
                let album_response = ui
                    .interact(
                        album_rect,
                        response.id.with("album-title"),
                        egui::Sense::click(),
                    )
                    .on_hover_cursor(egui::CursorIcon::PointingHand);
                paint_text(
                    ui,
                    &track
                        .year
                        .map(|year| format!("{} · {year}", track.album_title))
                        .unwrap_or_else(|| track.album_title.clone()),
                    album_rect,
                    FontId::proportional(12.5),
                    if album_response.hovered() {
                        GOLD
                    } else {
                        FAINT
                    },
                    false,
                );
                if album_response.clicked() {
                    if let Some(id) = &track.album_id {
                        self.load_album(id.clone());
                        child_clicked = true;
                    }
                }
            } else if !flat {
                let rate = format_bitrate(track.bitrate);
                let format = if track.format.is_empty() {
                    rate
                } else if rate.is_empty() {
                    track.format.to_uppercase()
                } else {
                    format!("{}  ·  {}", track.format.to_uppercase(), rate)
                };
                let format_rect = egui::Rect::from_min_size(
                    egui::pos2(rect.right() - 230.0, rect.top()),
                    Vec2::new(110.0, rect.height()),
                );
                paint_text(
                    ui,
                    &format,
                    format_rect,
                    FontId::proportional(11.0),
                    FAINT,
                    true,
                );
            }
            let duration_rect = egui::Rect::from_min_size(
                egui::pos2(
                    if flat {
                        duration_left
                    } else {
                        rect.right() - 112.0
                    },
                    rect.top(),
                ),
                Vec2::new(if flat { 52.0 } else { 64.0 }, rect.height()),
            );
            paint_text(
                ui,
                &format_duration(track.duration),
                duration_rect,
                FontId::proportional(12.5),
                FAINT,
                true,
            );
            let is_favorite = self
                .favorites
                .tracks
                .iter()
                .any(|favorite| favorite.id == track.id);
            // Mirror the Web: unfavorited hearts appear on row hover; favorited
                // hearts stay visible. The reserved column never shifts.
                if heart_column && (is_favorite || (can_edit_favorites && hovered)) {
                let heart_rect = egui::Rect::from_center_size(
                    egui::pos2(rect.right() - 40.0, rect.center().y),
                    Vec2::splat(32.0),
                );
                let heart_response = ui.interact(
                    heart_rect,
                    response.id.with(("favorite", &track.id)),
                    if can_edit_favorites {
                        egui::Sense::click()
                    } else {
                        egui::Sense::hover()
                    },
                );
                paint_icon(
                    ui.painter(),
                    heart_rect.shrink(8.0),
                    if is_favorite {
                        Icon::Heart
                    } else {
                        Icon::HeartOutline
                    },
                    if is_favorite {
                        if heart_response.hovered() && can_edit_favorites {
                            ACCENT_HI
                        } else {
                            ACCENT
                        }
                    } else if heart_response.hovered() {
                        INK
                    } else {
                        FAINT
                    },
                );
                let label = self.t(if is_favorite {
                    if can_edit_favorites {
                        "common.unfav"
                    } else {
                        "common.faved"
                    }
                } else {
                    "common.fav"
                });
                let heart_hovered = heart_response.hovered();
                let clicked = heart_response.on_hover_text(label).clicked();
                if clicked && can_edit_favorites {
                    self.toggle_favorite("track", &track.id);
                    child_clicked = true;
                }
                if heart_hovered && can_edit_favorites {
                    ctx.set_cursor_icon(egui::CursorIcon::PointingHand);
                }
            }
            if response.clicked() && !child_clicked {
                if current {
                    self.engine.toggle();
                } else {
                    self.play_queue(tracks.queue(), index);
                }
            }
            if response.hovered() {
                ctx.set_cursor_icon(egui::CursorIcon::PointingHand);
            }
        }
        if let Some(view) = &viewport {
            ui.add_space(view.after);
        }
        ui.spacing_mut().item_spacing.y = original_gap;
    }

    pub(super) fn album_detail(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        let Some(detail) = self.selected.clone() else {
            return;
        };
        self.backdrop(ui, &detail.album.id);
        // Match the Web button's 18px top margin and the hero's 26px top
        // padding instead of pinning the button to the header edge.
        ui.add_space(18.0);
        if back_button(ui, self.t("common.back")) {
            self.selected = None;
            return;
        }
        ui.add_space(26.0);
        let gap = (ctx.screen_rect().width() * 0.04).clamp(28.0, 56.0);
        let wide = ctx.screen_rect().width() >= 1400.0;
        ui.horizontal_top(|ui| {
            ui.spacing_mut().item_spacing.x = gap;
            let (cover, _) = ui.allocate_exact_size(Vec2::splat(264.0), egui::Sense::hover());
            if let Some(artwork) = self.covers.get(&detail.album.id) {
                egui::Image::from_texture((artwork.original.id(), cover.size()))
                    .rounding(14.0)
                    .paint_at(ui, cover);
            } else {
                self.load_cover(ctx, detail.album.id.clone());
            }
            // The native scroll handle overlays the content edge. Reserve a
            // small breathing room so the final genre pill never sits beneath
            // that handle.
            let available = (ui.available_width() - 18.0).max(0.0);
            ui.allocate_ui_with_layout(
                Vec2::new(available, 0.0),
                egui::Layout::top_down(egui::Align::Min),
                |ui| {
                    if wide {
                        // Keep the taxonomy column at the same visual anchor
                        // as Web on very wide monitors instead of letting the
                        // identity column consume the entire remaining row.
                        let context_width = (ctx.screen_rect().width() * 0.4)
                            .clamp(560.0, 1400.0)
                            .min(available * 0.48);
                        let context_gap = (ctx.screen_rect().width() * 0.04).clamp(34.0, 82.0);
                        let identity_width = (available - context_width - context_gap).max(280.0);
                        ui.horizontal_top(|ui| {
                            ui.spacing_mut().item_spacing.x = context_gap;
                            ui.allocate_ui_with_layout(
                                Vec2::new(identity_width, 0.0),
                                egui::Layout::top_down(egui::Align::Min),
                                |ui| {
                                    ui.set_width(identity_width);
                                    self.album_identity(ui, &detail);
                                },
                            );
                            ui.allocate_ui_with_layout(
                                Vec2::new(context_width, 0.0),
                                egui::Layout::top_down(egui::Align::Min),
                                |ui| {
                                    ui.set_width(context_width);
                                    self.album_context(ui, &detail);
                                },
                            );
                        });
                    } else {
                        self.album_identity(ui, &detail);
                        ui.add_space(24.0);
                        self.album_context(ui, &detail);
                    }
                },
            );
        });
        ui.add_space(34.0);
        self.track_rows(ui, ctx, &detail.tracks, false);
        self.album_gallery(ui, ctx, &detail);
        self.album_similar(ui, ctx, &detail);
    }

    fn album_gallery(&mut self, ui: &mut egui::Ui, ctx: &egui::Context, detail: &AlbumDetail) {
        if detail.images.is_empty() {
            return;
        }
        ui.add_space(8.0);
        ui.label(
            RichText::new(self.t("albumPage.gallery"))
                .font(serif(20.0))
                .color(DIM),
        );
        ui.add_space(12.0);
        let thumb_size = 148.0;
        let bar_height = 6.0;
        let strip_size = Vec2::new(ui.available_width(), thumb_size + bar_height);
        let (strip_rect, _) = ui.allocate_exact_size(strip_size, egui::Sense::hover());
        // egui moves nested scrollbars into the current clip when their own
        // content is off-screen. Keep painting covers as they enter view, but
        // hide the bar until it can stay at the gallery's actual bottom.
        let show_bar = ui.clip_rect().contains_rect(strip_rect);
        ui.allocate_ui_at_rect(strip_rect, |ui| {
            ui.scope(|ui| {
                ui.spacing_mut().scroll.floating = false;
                ui.spacing_mut().scroll.bar_width = bar_height;
                let bar_width = strip_rect.width().min(560.0);
                egui::ScrollArea::horizontal()
                    .id_salt(("album-gallery", &detail.album.id))
                    .auto_shrink([false, true])
                    .scroll_bar_visibility(if show_bar {
                        egui::containers::scroll_area::ScrollBarVisibility::VisibleWhenNeeded
                    } else {
                        egui::containers::scroll_area::ScrollBarVisibility::AlwaysHidden
                    })
                    .scroll_bar_rect(egui::Rect::from_min_size(
                        strip_rect.min,
                        Vec2::new(bar_width, strip_rect.height()),
                    ))
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            ui.spacing_mut().item_spacing.x = 12.0;
                            for (index, image_id) in detail.images.iter().enumerate() {
                                let (rect, response) = ui.allocate_exact_size(
                                    Vec2::splat(thumb_size),
                                    egui::Sense::click(),
                                );
                                if !ui.is_rect_visible(rect) {
                                    continue;
                                }
                                ui.painter().rect_filled(rect, 8.0, BG2);
                                if let Some(texture) = self.gallery_images.get(image_id) {
                                    egui::Image::from_texture((texture.id(), rect.size()))
                                        .uv(cover_uv(texture.size_vec2(), rect.size()))
                                        .rounding(8.0)
                                        .paint_at(ui, rect);
                                    if response.hovered() {
                                        let inset = rect.shrink(1.0);
                                        ui.painter().rect_stroke(
                                            inset,
                                            8.0,
                                            egui::Stroke::new(
                                                1.0,
                                                Color32::WHITE.gamma_multiply(0.14),
                                            ),
                                        );
                                    }
                                } else {
                                    ui.painter().circle_stroke(
                                        rect.center(),
                                        14.0,
                                        egui::Stroke::new(1.5, FAINT.gamma_multiply(0.42)),
                                    );
                                    self.load_gallery_image(ctx, image_id.clone());
                                }
                                if response.hovered() {
                                    ctx.set_cursor_icon(egui::CursorIcon::ZoomIn);
                                }
                                if response.clicked() {
                                    self.gallery_open = Some(index);
                                }
                            }
                        });
                    });
            });
        });
        ui.add_space(12.0);
    }

    fn album_similar(&mut self, ui: &mut egui::Ui, ctx: &egui::Context, detail: &AlbumDetail) {
        if detail.similar.is_empty() {
            return;
        }
        ui.label(
            RichText::new(self.t("albumPage.similar"))
                .font(serif(20.0))
                .color(DIM),
        );
        ui.add_space(12.0);
        let bar_height = 6.0;
        let strip_size = Vec2::new(ui.available_width(), 190.0 + bar_height);
        let (strip_rect, _) = ui.allocate_exact_size(strip_size, egui::Sense::hover());
        let show_bar = ui.clip_rect().contains_rect(strip_rect);
        ui.allocate_ui_at_rect(strip_rect, |ui| {
            ui.scope(|ui| {
                ui.spacing_mut().scroll.floating = false;
                ui.spacing_mut().scroll.bar_width = bar_height;
                let bar_width = strip_rect.width().min(560.0);
                egui::ScrollArea::horizontal()
                    .id_salt(("album-similar", &detail.album.id))
                    .auto_shrink([false, true])
                    .scroll_bar_visibility(if show_bar {
                        egui::containers::scroll_area::ScrollBarVisibility::VisibleWhenNeeded
                    } else {
                        egui::containers::scroll_area::ScrollBarVisibility::AlwaysHidden
                    })
                    .scroll_bar_rect(egui::Rect::from_min_size(
                        strip_rect.min,
                        Vec2::new(bar_width, strip_rect.height()),
                    ))
                    .show(ui, |ui| {
                        ui.horizontal(|ui| {
                            ui.spacing_mut().item_spacing.x = 16.0;
                            for similar in &detail.similar {
                                let (rect, response) = ui.allocate_exact_size(
                                    Vec2::new(132.0, 190.0),
                                    egui::Sense::click(),
                                );
                                if !ui.is_rect_visible(rect) {
                                    continue;
                                }
                                let cover = egui::Rect::from_min_size(rect.min, Vec2::splat(132.0));
                                ui.painter().rect_filled(cover, 8.0, BG2);
                                if let Some(artwork) = self.covers.get(&similar.id) {
                                    egui::Image::from_texture((
                                        artwork.original.id(),
                                        cover.size(),
                                    ))
                                    .uv(cover_uv(artwork.original.size_vec2(), cover.size()))
                                    .rounding(8.0)
                                    .paint_at(ui, cover);
                                } else {
                                    ui.painter().circle_stroke(
                                        cover.center(),
                                        14.0,
                                        egui::Stroke::new(1.5, FAINT.gamma_multiply(0.42)),
                                    );
                                    self.load_cover(ctx, similar.id.clone());
                                }
                                if response.hovered() {
                                    ui.painter().rect_stroke(
                                        cover.shrink(1.0),
                                        8.0,
                                        egui::Stroke::new(1.0, Color32::WHITE.gamma_multiply(0.14)),
                                    );
                                    ctx.set_cursor_icon(egui::CursorIcon::PointingHand);
                                }
                                let title_rect = egui::Rect::from_min_size(
                                    egui::pos2(rect.left(), cover.bottom() + 7.0),
                                    Vec2::new(rect.width(), 18.0),
                                );
                                paint_text(
                                    ui,
                                    &similar.title,
                                    title_rect,
                                    FontId::proportional(12.5),
                                    if response.hovered() { INK } else { DIM },
                                    false,
                                );
                                let rating = similar
                                    .rating
                                    .map(|value| format!("★{value:.2}"))
                                    .unwrap_or_default();
                                let votes = similar
                                    .votes
                                    .and_then(|value| compact_votes(&self.config.language, value))
                                    .map(|value| format!(" · {value}"));
                                let score = format!("{rating}{}", votes.unwrap_or_default());
                                paint_text(
                                    ui,
                                    &score,
                                    title_rect.translate(Vec2::new(0.0, 19.0)),
                                    FontId::proportional(11.5),
                                    GOLD,
                                    false,
                                );
                                if response.clicked() {
                                    self.load_album(similar.id.clone());
                                }
                            }
                        });
                    });
            });
        });
    }

    pub(super) fn gallery_lightbox(&mut self, ctx: &egui::Context) {
        let Some(detail) = self.selected.as_ref() else {
            self.gallery_open = None;
            return;
        };
        let Some(index) = self.gallery_open else {
            return;
        };
        if index >= detail.images.len() {
            self.gallery_open = None;
            return;
        }
        let images = detail.images.clone();
        let image_count = images.len();
        let screen = ctx.screen_rect();
        egui::Area::new(egui::Id::new("album-gallery-lightbox"))
            .order(egui::Order::Foreground)
            .fixed_pos(screen.min)
            .show(ctx, |ui| {
                ui.set_min_size(screen.size());
                let (backdrop, backdrop_response) =
                    ui.allocate_exact_size(screen.size(), egui::Sense::click());
                ui.painter().rect_filled(
                    backdrop,
                    0.0,
                    Color32::from_rgba_unmultiplied(5, 4, 3, 232),
                );
                let image_rect = backdrop.shrink(72.0);
                if let Some(image_id) = images.get(index) {
                    if let Some(texture) = self.gallery_images.get(image_id) {
                        let source = texture.size_vec2();
                        let scale = (image_rect.width() / source.x)
                            .min(image_rect.height() / source.y)
                            .min(1.0);
                        let size = source * scale;
                        let rect = Rect::from_center_size(image_rect.center(), size);
                        egui::Image::from_texture((texture.id(), size)).paint_at(ui, rect);
                        let image_response = ui.interact(
                            rect,
                            egui::Id::new("album-gallery-lightbox-image"),
                            egui::Sense::click(),
                        );
                        if image_response.clicked() {
                            return;
                        }
                    } else {
                        self.load_gallery_image(ctx, image_id.clone());
                    }
                }
                if backdrop_response.clicked() {
                    self.gallery_open = None;
                    return;
                }
                let close_rect = Rect::from_min_size(
                    egui::pos2(backdrop.right() - 62.0, backdrop.top() + 20.0),
                    Vec2::splat(42.0),
                );
                ui.painter().circle_filled(
                    close_rect.center(),
                    21.0,
                    Color32::from_rgba_unmultiplied(30, 26, 21, 220),
                );
                let close = ui
                    .allocate_ui_at_rect(close_rect, |ui| icon_button(ui, Icon::Close, 42.0, DIM))
                    .inner;
                if close.clicked() {
                    self.gallery_open = None;
                }
                if image_count > 1 {
                    let left_rect = Rect::from_min_size(
                        egui::pos2(backdrop.left() + 18.0, backdrop.center().y - 24.0),
                        Vec2::splat(48.0),
                    );
                    let right_rect = Rect::from_min_size(
                        egui::pos2(backdrop.right() - 66.0, backdrop.center().y - 24.0),
                        Vec2::splat(48.0),
                    );
                    let left = ui
                        .allocate_ui_at_rect(left_rect, |ui| {
                            icon_button(ui, Icon::Previous, 48.0, DIM)
                        })
                        .inner;
                    let right = ui
                        .allocate_ui_at_rect(right_rect, |ui| {
                            icon_button(ui, Icon::Next, 48.0, DIM)
                        })
                        .inner;
                    if left.clicked() {
                        self.gallery_open = Some((index + image_count - 1) % image_count);
                    }
                    if right.clicked() {
                        self.gallery_open = Some((index + 1) % image_count);
                    }
                }
                paint_text(
                    ui,
                    &format!("{} / {}", index + 1, image_count),
                    Rect::from_center_size(
                        egui::pos2(backdrop.center().x, backdrop.bottom() - 35.0),
                        Vec2::new(120.0, 24.0),
                    ),
                    FontId::proportional(12.0),
                    DIM,
                    true,
                );
            });
    }

    fn album_identity(&mut self, ui: &mut egui::Ui, detail: &AlbumDetail) {
        ui.spacing_mut().item_spacing.y = 4.0;
        let artist_font = FontId::proportional(15.0);
        let artist_height = ui
            .painter()
            .layout_no_wrap(detail.album.artist.clone(), artist_font.clone(), DIM)
            .size()
            .y;
        let (artist_rect, _) = ui.allocate_exact_size(
            Vec2::new(ui.available_width(), artist_height),
            egui::Sense::hover(),
        );
        if let Some(name) = artist_credit_links(
            ui,
            &detail.album.artists,
            &detail.album.artist,
            artist_rect,
            artist_font,
            DIM,
            ui.id().with("album-artists"),
        ) {
            self.open_artist(name.to_owned());
        }
        ui.label(
            RichText::new(&detail.album.title)
                .font(display(44.0))
                .color(INK),
        );
        ui.add_space(6.0);
        let mut metadata = Vec::new();
        if let Some(year) = detail.album.year {
            metadata.push(year.to_string());
        }
        metadata.push(self.tf("count.tracks", &[&detail.tracks.len().to_string()]));
        if let Some(duration) = detail.album.duration {
            metadata.push(self.tf(
                "time.minutes",
                &[&((duration / 60.0).round() as u64).to_string()],
            ));
        }
        let mut formats: Vec<_> = detail
            .tracks
            .iter()
            .map(|track| track.format.to_uppercase())
            .filter(|format| !format.is_empty())
            .collect();
        formats.sort();
        formats.dedup();
        if !formats.is_empty() {
            metadata.push(formats.join(" / "));
        }
        ui.label(
            RichText::new(metadata.join("  ·  "))
                .size(13.0)
                .color(FAINT),
        );
        ui.add_space(18.0);
        if let Some(rym) = &detail.album.rym {
            ui.horizontal(|ui| {
                ui.spacing_mut().item_spacing.x = 8.0;
                ui.label(
                    RichText::new(
                        rym.rating
                            .map(|rating| format!("{rating:.2}"))
                            .unwrap_or_else(|| "—".into()),
                    )
                    .font(display(42.0))
                    .color(GOLD),
                );
                ui.label(RichText::new("/ 5.00").size(13.0).color(FAINT));
                ui.add_space(14.0);
                ui.vertical(|ui| {
                    ui.spacing_mut().item_spacing.y = 3.0;
                    if let Some(votes) = rym.votes {
                        ui.label(
                            RichText::new(self.tf("rym.votes", &[&votes.to_string()]))
                                .size(12.5)
                                .color(DIM),
                        );
                    }
                    if let Some(rank) = &rym.rank {
                        ui.label(RichText::new(rank).size(12.5).color(DIM));
                    }
                    if let Some(url) = rym
                        .url
                        .as_deref()
                        .filter(|url| url.starts_with("https://") || url.starts_with("http://"))
                    {
                        ui.hyperlink_to(
                            RichText::new(self.t("rym.page")).size(12.5).color(FAINT),
                            url,
                        );
                    }
                });
            });
        } else {
            ui.label(
                RichText::new(self.t("rym.noDataUser"))
                    .color(FAINT)
                    .size(13.0),
            );
        }
        ui.add_space(20.0);
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 18.0;
            let current = self
                .current_track
                .as_ref()
                .and_then(|track| track.album_id.as_deref())
                == Some(detail.album.id.as_str());
            let playing = current && self.engine.is_playing();
            let response = ui.add(
                egui::Button::new(
                    RichText::new(format!(
                        "    {}",
                        self.t(if playing {
                            "common.pause"
                        } else {
                            "common.play"
                        })
                    ))
                    .size(14.0)
                    .color(Color32::WHITE),
                )
                .fill(ACCENT)
                .stroke(egui::Stroke::NONE)
                .rounding(22.0)
                .min_size(Vec2::new(92.0, 40.0)),
            );
            paint_icon(
                ui.painter(),
                egui::Rect::from_center_size(
                    egui::pos2(response.rect.left() + 24.0, response.rect.center().y),
                    Vec2::splat(14.0),
                ),
                if playing { Icon::Pause } else { Icon::Play },
                Color32::WHITE,
            );
            if response.clicked() {
                if current {
                    self.engine.toggle();
                } else {
                    self.play_queue(detail.tracks.clone(), 0);
                }
            }
            let is_favorite = self
                .favorites
                .albums
                .iter()
                .any(|favorite| favorite.id == detail.album.id);
            let can_edit_favorites = self.role.as_deref() == Some("admin") && self.favorites_loaded;
            if can_edit_favorites || is_favorite {
                let (rect, response) = ui.allocate_exact_size(
                    Vec2::splat(36.0),
                    if can_edit_favorites {
                        egui::Sense::click()
                    } else {
                        egui::Sense::hover()
                    },
                );
                paint_icon(
                    ui.painter(),
                    rect.shrink(10.0),
                    if is_favorite {
                        Icon::Heart
                    } else {
                        Icon::HeartOutline
                    },
                    if is_favorite {
                        ACCENT
                    } else if response.hovered() {
                        INK
                    } else {
                        FAINT
                    },
                );
                let label = self.t(if is_favorite {
                    if can_edit_favorites {
                        "common.unfav"
                    } else {
                        "common.faved"
                    }
                } else {
                    "common.fav"
                });
                let heart_hovered = response.hovered();
                let clicked = response.on_hover_text(label).clicked();
                if clicked && can_edit_favorites {
                    self.toggle_favorite("album", &detail.album.id);
                }
                if heart_hovered && can_edit_favorites {
                    ui.ctx().set_cursor_icon(egui::CursorIcon::PointingHand);
                }
            }
        });
    }

    fn album_context(&mut self, ui: &mut egui::Ui, detail: &AlbumDetail) {
        let genres: Vec<_> = detail
            .album
            .genres
            .iter()
            .map(|genre| (genre, true))
            .chain(
                detail
                    .album
                    .secondary_genres
                    .iter()
                    .map(|genre| (genre, false)),
            )
            .collect();
        if !genres.is_empty() {
            ui.label(
                RichText::new(self.t("common.genres"))
                    .color(FAINT)
                    .size(11.0)
                    .strong(),
            );
            ui.add_space(5.0);
            ui.horizontal_wrapped(|ui| {
                ui.spacing_mut().item_spacing = Vec2::new(7.0, 7.0);
                let shown = if self.expanded_genres {
                    genres.len()
                } else {
                    genres.len().min(7)
                };
                for (genre, primary) in &genres[..shown] {
                    if ui
                        .add(
                            egui::Button::new(
                                RichText::new(*genre).size(12.0).color(if *primary {
                                    GOLD
                                } else {
                                    DIM
                                }),
                            )
                            .fill(Color32::TRANSPARENT)
                            .stroke(egui::Stroke::new(
                                1.0,
                                if *primary { GOLD_DIM } else { LINE },
                            ))
                            .rounding(16.0)
                            .min_size(Vec2::new(0.0, 30.0)),
                        )
                        .clicked()
                    {
                        self.genre_filter = (*genre).clone();
                        self.selected = None;
                        self.selected_artist = None;
                        self.page = Page::Library;
                    }
                }
                if genres.len() > 7 {
                    let label = if self.expanded_genres {
                        self.t("common.less").to_owned()
                    } else {
                        format!("+{}", genres.len() - 7)
                    };
                    let hint = self.t(if self.expanded_genres {
                        "common.less"
                    } else {
                        "common.more"
                    });
                    if genre_more_button(ui, &label).on_hover_text(hint).clicked() {
                        self.expanded_genres = !self.expanded_genres;
                    }
                }
            });
        }
        if let Some(rym) = &detail.album.rym {
            if !rym.descriptors.is_empty() {
                ui.add_space(8.0);
                ui.label(
                    RichText::new(rym.descriptors.join(" · "))
                        .size(12.5)
                        .color(FAINT),
                );
            }
        }
        if !detail.note.trim().is_empty() {
            ui.add_space(24.0);
            ui.separator();
            ui.add_space(16.0);
            ui.label(
                RichText::new(self.t("albumPage.note"))
                    .size(11.0)
                    .color(FAINT)
                    .strong(),
            );
            ui.add_space(5.0);
            markdown_preview(ui, &detail.note, 3);
            ui.add_space(7.0);
            let is_long = detail.note.chars().count() > 180 || detail.note.split('\n').count() > 3;
            if is_long && read_more_button(ui, self.t("md.more"), true).clicked() {
                self.open_reader(detail.album.title.clone(), detail.note.clone(), ui.ctx());
            }
        }
    }

    fn backdrop(&self, ui: &egui::Ui, id: &str) {
        let Some(artwork) = self.covers.get(id) else {
            return;
        };
        let origin = ui.cursor().min - Vec2::new(40.0, 35.0);
        let width = ui.available_width() + 80.0;
        let mut mesh = egui::Mesh::with_texture(artwork.backdrop.id());
        for band in 0..64 {
            let top = band as f32 / 64.0;
            let bottom = (band + 1) as f32 / 64.0;
            let alpha = (1.0 - top).powf(2.0) * 0.84;
            let rect = egui::Rect::from_min_max(
                origin + Vec2::new(0.0, top * 640.0),
                origin + Vec2::new(width, bottom * 640.0),
            );
            let tint = Color32::from_rgba_unmultiplied(64, 64, 64, (alpha * 255.0) as u8);
            mesh.add_rect_with_uv(
                rect,
                egui::Rect::from_min_max(egui::pos2(0.1, top), egui::pos2(0.9, bottom)),
                tint,
            );
        }
        ui.painter().add(egui::Shape::mesh(mesh));
    }

    fn artist_entries(&self) -> Vec<ArtistEntry> {
        let mut entries = HashMap::<String, ArtistEntry>::new();
        for album in &self.albums {
            for name in credits(album) {
                let entry = entries.entry(name.clone()).or_insert_with(|| ArtistEntry {
                    artist: self
                        .artists
                        .iter()
                        .find(|artist| artist.name == name)
                        .cloned()
                        .unwrap_or_else(|| Artist {
                            name,
                            ..Default::default()
                        }),
                    count: 0,
                    years: Vec::new(),
                    latest: 0,
                    genres: Vec::new(),
                });
                entry.count += 1;
                entry.latest = entry.latest.max(album.updated_at);
                if let Some(year) = album.year {
                    entry.years.push(year);
                }
                for genre in &album.genres {
                    if !entry.genres.contains(genre) {
                        entry.genres.push(genre.clone());
                    }
                }
            }
        }
        for artist in &self.artists {
            if artist.featured_track_count > 0 {
                entries
                    .entry(artist.name.clone())
                    .or_insert_with(|| ArtistEntry {
                        artist: artist.clone(),
                        count: 0,
                        years: Vec::new(),
                        latest: 0,
                        genres: Vec::new(),
                    });
            }
        }
        let query = self.query.trim().to_lowercase();
        let mut entries: Vec<_> = entries
            .into_values()
            .filter(|entry| {
                (query.is_empty()
                    || format!(
                        "{} {} {}",
                        entry.artist.name,
                        entry.artist.sort,
                        entry.artist.aliases.join(" ")
                    )
                    .to_lowercase()
                    .contains(&query))
                    && (self.artist_genre.is_empty()
                        || entry
                            .genres
                            .iter()
                            .any(|genre| genre.eq_ignore_ascii_case(&self.artist_genre)))
            })
            .collect();
        entries.sort_by(|left, right| {
            let name = || {
                let left_name = if left.artist.sort.is_empty() {
                    &left.artist.name
                } else {
                    &left.artist.sort
                };
                let right_name = if right.artist.sort.is_empty() {
                    &right.artist.name
                } else {
                    &right.artist.sort
                };
                left_name.to_lowercase().cmp(&right_name.to_lowercase())
            };
            match self.artist_sort {
                1 => name(),
                2 => right.latest.cmp(&left.latest).then_with(name),
                _ => right
                    .count
                    .cmp(&left.count)
                    .then_with(|| {
                        right
                            .artist
                            .featured_track_count
                            .cmp(&left.artist.featured_track_count)
                    })
                    .then_with(name),
            }
        });
        entries
    }

    pub(super) fn artists_page(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        let mut genres: Vec<_> = self
            .albums
            .iter()
            .flat_map(|album| album.genres.iter().cloned())
            .collect();
        genres.sort();
        genres.dedup();
        let language = self.config.language.clone();
        ui.horizontal(|ui| {
            let title = if self.artist_genre.is_empty() {
                self.t("artists.filterGenre").to_owned()
            } else {
                self.artist_genre.clone()
            };
            filter_combo(
                ui,
                "artist-genre",
                &title,
                !self.artist_genre.is_empty(),
                |ui| {
                    if ui
                        .selectable_label(
                            self.artist_genre.is_empty(),
                            i18n::text(&language, "library.anyGenre"),
                        )
                        .clicked()
                    {
                        self.artist_genre.clear();
                    }
                    for genre in &genres {
                        if ui
                            .selectable_label(self.artist_genre == *genre, genre)
                            .clicked()
                        {
                            self.artist_genre = genre.clone();
                        }
                    }
                },
            );
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                let keys = ["artists.sortCount", "artists.sortName", "artists.sortAdded"];
                let mut sort = Pill::new(
                    "artist-sort",
                    i18n::text(&language, keys[self.artist_sort]),
                    160.0,
                );
                sort.ghost = true;
                sort.show(ui, |ui| {
                    for (index, key) in keys.iter().enumerate() {
                        if ui
                            .selectable_label(self.artist_sort == index, i18n::text(&language, key))
                            .clicked()
                        {
                            self.artist_sort = index;
                        }
                    }
                });
            });
        });
        ui.add_space(30.0);
        let entries = self.artist_entries();
        let gap = (ctx.screen_rect().width() * 0.016).clamp(14.0, 24.0);
        let columns = ((ui.available_width() + gap) / (158.0 + gap))
            .floor()
            .max(1.0) as usize;
        let width = (ui.available_width() - gap * (columns - 1) as f32) / columns as f32;
        ui.scope(|ui| {
            ui.spacing_mut().item_spacing = Vec2::new(gap, 0.0);
            for row in entries.chunks(columns) {
                ui.horizontal_top(|ui| {
                    for entry in row {
                        let (rect, response) =
                            ui.allocate_exact_size(Vec2::new(width, 196.0), egui::Sense::click());
                        if !ui.is_rect_visible(rect) {
                            continue;
                        }
                        let hovered = response.hovered();
                        let lift = css_ease(
                            hover_progress(ctx, response.id.with("artist-hover"), hovered, 0.22),
                            [0.2, 0.7, 0.3, 1.2],
                        );
                        let avatar = egui::Rect::from_center_size(
                            egui::pos2(rect.center().x, rect.top() + 64.0 - lift * 4.0),
                            Vec2::splat(128.0),
                        );
                        let key = artist_art_key(&entry.artist);
                        ui.painter().circle_filled(avatar.center(), 64.0, BG2);
                        if let Some(artwork) = self.covers.get(&key) {
                            egui::Image::from_texture((artwork.original.id(), avatar.size()))
                                .uv(cover_uv(artwork.original.size_vec2(), avatar.size()))
                                .rounding(64.0)
                                .paint_at(ui, avatar);
                        } else {
                            self.load_cover(ctx, key);
                        }
                        ui.painter().circle_stroke(
                            avatar.center(),
                            64.0,
                            egui::Stroke::new(1.0, Color32::WHITE.gamma_multiply(0.04)),
                        );
                        let name_rect = egui::Rect::from_min_size(
                            egui::pos2(rect.left(), rect.top() + 142.0),
                            Vec2::new(width, 20.0),
                        );
                        paint_text(
                            ui,
                            &entry.artist.name,
                            name_rect,
                            serif(14.5),
                            if hovered { GOLD } else { INK },
                            true,
                        );
                        let years = year_range(&entry.years);
                        let primary = if entry.count > 0 {
                            format!(
                                "{}{}{}",
                                self.tf("artists.albums", &[&entry.count.to_string()]),
                                if years.is_empty() { "" } else { " · " },
                                years
                            )
                        } else {
                            self.tf(
                                "artists.featuredTracks",
                                &[&entry.artist.featured_track_count.to_string()],
                            )
                        };
                        paint_text(
                            ui,
                            &primary,
                            name_rect.translate(Vec2::new(0.0, 20.0)),
                            FontId::proportional(12.0),
                            FAINT,
                            true,
                        );
                        if entry.count > 0 && entry.artist.featured_track_count > 0 {
                            paint_text(
                                ui,
                                &self.tf(
                                    "artists.featuredTracks",
                                    &[&entry.artist.featured_track_count.to_string()],
                                ),
                                name_rect.translate(Vec2::new(0.0, 37.0)),
                                FontId::proportional(11.0),
                                FAINT,
                                true,
                            );
                        }
                        if response
                            .on_hover_cursor(egui::CursorIcon::PointingHand)
                            .clicked()
                        {
                            self.page = Page::Artists;
                            self.open_artist(entry.artist.name.clone());
                        }
                    }
                });
                ui.add_space(38.0);
            }
        });
        if entries.is_empty() {
            empty_state(ui, self.t("artists.empty"));
        }
    }

    pub(super) fn artist_detail(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        let Some(name) = self.selected_artist.clone() else {
            return;
        };
        let artist = self
            .artists
            .iter()
            .find(|artist| artist.name == name)
            .cloned()
            .unwrap_or_else(|| Artist {
                name: name.clone(),
                ..Default::default()
            });
        let key = artist_art_key(&artist);
        self.backdrop(ui, &key);
        ui.add_space(18.0);
        if back_button(ui, self.t("common.back")) {
            self.selected_artist = None;
            return;
        }
        ui.add_space(26.0);
        let albums: Vec<_> = self
            .albums
            .iter()
            .filter(|album| credits(album).contains(&name))
            .cloned()
            .collect();
        ui.horizontal_top(|ui| {
            ui.spacing_mut().item_spacing.x = 36.0;
            let (avatar, _) = ui.allocate_exact_size(Vec2::splat(220.0), egui::Sense::hover());
            if let Some(artwork) = self.covers.get(&key) {
                egui::Image::from_texture((artwork.original.id(), avatar.size()))
                    .uv(cover_uv(artwork.original.size_vec2(), avatar.size()))
                    .rounding(110.0)
                    .paint_at(ui, avatar);
            } else {
                self.load_cover(ctx, key);
            }
            ui.vertical(|ui| {
                ui.label(
                    RichText::new(self.t("artistPage.kicker"))
                        .color(DIM)
                        .size(15.0),
                );
                ui.label(RichText::new(&name).font(display(44.0)).color(INK));
                if !artist.sort.is_empty() && artist.sort != name {
                    ui.label(RichText::new(&artist.sort).color(FAINT).size(13.0));
                }
                ui.label(
                    RichText::new(self.tf("count.albums", &[&albums.len().to_string()]))
                        .color(FAINT)
                        .size(13.0),
                );
                if !artist.note.is_empty() {
                    ui.add_space(12.0);
                    ui.vertical(|ui| {
                        ui.set_max_width(680.0);
                        markdown_body(ui, &artist.note);
                    });
                }
                if let Some(bio) = self.artist_bios.get(&name).filter(|bio| !bio.is_empty()) {
                    if read_more_button(ui, self.t("artistPage.readBio"), true).clicked() {
                        self.open_reader(name.clone(), bio.clone(), ctx);
                    }
                }
            });
        });
        ui.add_space(32.0);
        self.album_grid(ui, ctx, &albums);
        let featured: Vec<_> = self
            .tracks
            .iter()
            .filter(|track| {
                track.artists.iter().any(|credit| credit.name == name)
                    && !albums
                        .iter()
                        .any(|album| Some(&album.id) == track.album_id.as_ref())
            })
            .cloned()
            .collect();
        if !featured.is_empty() {
            ui.label(
                RichText::new(self.t("artistPage.featuredTracks"))
                    .font(serif(20.0))
                    .color(INK),
            );
            self.track_rows(ui, ctx, &featured, true);
        }
    }

    pub(super) fn favorites_page(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        ui.horizontal(|ui| {
            for (tracks, key) in [(false, "favs.albums"), (true, "favs.tracks")] {
                if ui
                    .add(
                        egui::Button::new(RichText::new(self.t(key)).color(
                            if self.favorite_tracks == tracks {
                                INK
                            } else {
                                DIM
                            },
                        ))
                        .fill(if self.favorite_tracks == tracks {
                            BG3
                        } else {
                            Color32::TRANSPARENT
                        })
                        .stroke(egui::Stroke::NONE)
                        .rounding(18.0)
                        .min_size(Vec2::new(76.0, 36.0)),
                    )
                    .clicked()
                {
                    self.favorite_tracks = tracks;
                }
            }
        });
        ui.add_space(24.0);
        let query = self.query.trim().to_lowercase();
        if self.favorite_tracks {
            let tracks: Vec<_> = self
                .favorites
                .tracks
                .iter()
                .filter_map(|favorite| self.tracks.iter().find(|track| track.id == favorite.id))
                .filter(|track| {
                    query.is_empty()
                        || format!("{} {} {}", track.title, track.artist, track.album_title)
                            .to_lowercase()
                            .contains(&query)
                })
                .cloned()
                .collect();
            self.track_rows(ui, ctx, &tracks, true);
        } else {
            let albums: Vec<_> = self
                .favorites
                .albums
                .iter()
                .filter_map(|favorite| self.albums.iter().find(|album| album.id == favorite.id))
                .filter(|album| {
                    query.is_empty()
                        || format!("{} {}", album.title, album.artist)
                            .to_lowercase()
                            .contains(&query)
                })
                .cloned()
                .collect();
            self.album_grid(ui, ctx, &albums);
            if albums.is_empty() {
                empty_state(ui, self.t("favs.emptyAlbums"));
            }
        }
    }
}

fn format_bitrate(value: Option<f64>) -> String {
    let Some(rate) = value.filter(|rate| rate.is_finite() && *rate > 0.0) else {
        return String::new();
    };
    if rate >= 1_000.0 {
        let megabits = rate / 1_000.0;
        // At two decimals, exact binary ties are odd eighths. JavaScript's toFixed
        // rounds these upward, whereas Rust's formatter rounds ties to even.
        let rounded = if (megabits.fract() * 8.0) % 2.0 == 1.0 {
            (megabits * 100.0).round() / 100.0
        } else {
            megabits
        };
        let text = format!("{rounded:.2}");
        format!("{}M", text.trim_end_matches('0').trim_end_matches('.'))
    } else {
        format!("{:.0}K", rate.round())
    }
}

fn back_button(ui: &mut egui::Ui, title: &str) -> bool {
    let label = ui
        .painter()
        .layout_no_wrap(title.to_owned(), FontId::proportional(14.0), DIM);
    let width = (14.0 + 15.0 + 6.0 + label.size().x + 14.0).max(78.0);
    let (rect, response) = ui.allocate_exact_size(Vec2::new(width, 36.0), egui::Sense::click());
    let hovered = response.hovered() || response.has_focus();
    let foreground = if hovered { INK } else { DIM };
    ui.painter().rect(
        rect,
        18.0,
        Color32::from_rgba_premultiplied(13, 11, 9, 128),
        egui::Stroke::new(1.0, LINE),
    );
    paint_icon(
        ui.painter(),
        egui::Rect::from_center_size(
            egui::pos2(rect.left() + 14.0 + 7.5, rect.center().y),
            Vec2::splat(15.0),
        ),
        Icon::Back,
        foreground,
    );
    ui.painter().galley(
        egui::pos2(
            rect.left() + 14.0 + 15.0 + 6.0,
            rect.center().y - label.size().y / 2.0,
        ),
        label,
        foreground,
    );
    response.widget_info(|| {
        egui::WidgetInfo::labeled(egui::WidgetType::Button, ui.is_enabled(), title)
    });
    let response = response.on_hover_cursor(egui::CursorIcon::PointingHand);
    response.clicked()
}

fn artist_art_key(artist: &Artist) -> String {
    format!(
        "artist:{}{}",
        if artist.has_avatar { "custom:" } else { "" },
        artist.name
    )
}

pub(super) fn credits(album: &Album) -> Vec<String> {
    if album.artists.is_empty() {
        vec![album.artist.clone()]
    } else {
        album
            .artists
            .iter()
            .map(|credit| credit.name.clone())
            .collect()
    }
}

fn year_range(years: &[i32]) -> String {
    match (years.iter().min(), years.iter().max()) {
        (Some(first), Some(last)) if first != last => format!("{first}–{last}"),
        (Some(year), _) => year.to_string(),
        _ => String::new(),
    }
}

fn compact_votes(language: &str, votes: u64) -> Option<String> {
    if votes == 0 {
        return None;
    }
    let compact = if votes >= 1_000_000 {
        format!("{}M", (votes as f64 / 1_000_000.0).round() as u64)
    } else if votes >= 1_000 {
        format!("{}K", (votes as f64 / 1_000.0).round() as u64)
    } else {
        votes.to_string()
    };
    if votes >= 10_000 && matches!(language, "zh-Hans" | "zh-Hant" | "ja" | "ko") {
        let unit = if language == "ko" { "만" } else { "万" };
        Some(format!(
            "{}{}",
            (votes as f64 / 10_000.0).round() as u64,
            unit
        ))
    } else {
        Some(compact)
    }
}

#[cfg(test)]
mod tests {
    use super::format_bitrate;

    #[test]
    fn api_bitrates_match_the_web_clients_compact_units() {
        for (kbps, expected) in [
            (320.0, "320K"),
            (971.0, "971K"),
            (971.5, "972K"),
            (999.5, "1000K"),
            (1_000.0, "1M"),
            (1_005.0, "1M"),
            (1_022.0, "1.02M"),
            (1_125.0, "1.13M"),
            (1_500.0, "1.5M"),
            (1_875.0, "1.88M"),
        ] {
            assert_eq!(format_bitrate(Some(kbps)), expected);
        }
    }

    #[test]
    fn unavailable_bitrates_are_hidden_as_in_the_web_client() {
        for value in [
            None,
            Some(0.0),
            Some(-1.0),
            Some(f64::NAN),
            Some(f64::INFINITY),
            Some(f64::NEG_INFINITY),
        ] {
            assert_eq!(format_bitrate(value), "");
        }
    }
}
