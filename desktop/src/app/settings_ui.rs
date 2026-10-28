use crate::i18n;
use crate::ui::{display, ACCENT, ACCENT_HI, BG0, BG1, BG2, BG3, DIM, FAINT, INK, LINE};
use eframe::egui::{self, Color32, FontId, Rect, Response, RichText, Sense, Stroke, Vec2};

pub(super) fn card<R>(
    ui: &mut egui::Ui,
    id: &str,
    title: &str,
    description: &str,
    body: impl FnOnce(&mut egui::Ui) -> R,
) -> egui::InnerResponse<R> {
    ui.push_id(id, |ui| {
        egui::Frame::none()
            .fill(BG1)
            .stroke(Stroke::new(1.0, LINE))
            .rounding(18.0)
            .inner_margin(22.0)
            .show(ui, |ui| {
                let content_width = ui.available_width().max(1.0);
                ui.set_width(content_width);
                ui.spacing_mut().item_spacing = Vec2::new(12.0, 12.0);
                ui.add(
                    egui::Label::new(RichText::new(title).font(display(21.0)).color(INK)).wrap(),
                );
                if !description.is_empty() {
                    ui.add(
                        egui::Label::new(RichText::new(description).size(12.5).color(FAINT)).wrap(),
                    );
                }
                ui.add_space(8.0);
                body(ui)
            })
    })
    .inner
}

pub(super) fn field(ui: &mut egui::Ui, label: &str, editor: egui::TextEdit<'_>) -> Response {
    ui.scope(|ui| {
        ui.spacing_mut().item_spacing.y = 7.0;
        let label = ui.label(RichText::new(label).size(12.0).color(DIM));
        let visuals = ui.visuals_mut();
        visuals.extreme_bg_color = BG0;
        visuals.widgets.inactive.bg_fill = BG0;
        visuals.widgets.inactive.bg_stroke = Stroke::new(1.0, LINE);
        visuals.widgets.inactive.rounding = egui::Rounding::same(9.0);
        visuals.widgets.hovered.bg_fill = BG0;
        visuals.widgets.hovered.bg_stroke = Stroke::new(1.0, Color32::from_rgb(85, 68, 47));
        visuals.widgets.hovered.rounding = egui::Rounding::same(9.0);
        visuals.widgets.active.bg_fill = BG0;
        visuals.widgets.active.bg_stroke = Stroke::new(1.0, ACCENT);
        visuals.widgets.active.rounding = egui::Rounding::same(9.0);
        visuals.selection.bg_fill = Color32::from_rgb(86, 43, 27);
        visuals.selection.stroke = Stroke::new(1.0, ACCENT_HI);
        ui.add_sized(
            Vec2::new(ui.available_width(), 42.0),
            editor
                .font(FontId::proportional(13.5))
                .text_color(INK)
                .margin(Vec2::new(12.0, 10.0))
                .vertical_align(egui::Align::Center)
                .desired_width(f32::INFINITY),
        )
        .labelled_by(label.id)
    })
    .inner
}

pub(super) fn action(ui: &mut egui::Ui, label: &str, primary: bool) -> Response {
    let maximum_width = ui.max_rect().width().max(1.0);
    let text = ui.painter().layout(
        label.to_owned(),
        FontId::proportional(12.5),
        INK,
        (maximum_width - 32.0).max(1.0),
    );
    let width = (text.size().x + 32.0).max(94.0).min(maximum_width);
    let height = (text.size().y + 20.0).max(38.0);
    let (rect, response) = ui.allocate_exact_size(Vec2::new(width, height), Sense::click());
    let intent = response.hovered() || response.has_focus();
    let pressed = response.is_pointer_button_down_on();
    let fill = if primary {
        if intent && !pressed {
            ACCENT_HI
        } else {
            ACCENT
        }
    } else if intent {
        BG3
    } else {
        BG2
    };
    let border = if primary {
        Stroke::NONE
    } else {
        Stroke::new(
            1.0,
            if intent {
                Color32::from_rgb(94, 73, 50)
            } else {
                LINE
            },
        )
    };
    if ui.is_rect_visible(rect) {
        ui.painter().rect(rect, height / 2.0, fill, border);
        if response.has_focus() {
            ui.painter().rect_stroke(
                rect.expand(3.0),
                height / 2.0 + 3.0,
                Stroke::new(1.0, ACCENT_HI),
            );
        }
        ui.painter()
            .galley(rect.center() - text.size() / 2.0, text, INK);
    }
    response.widget_info(|| {
        egui::WidgetInfo::labeled(egui::WidgetType::Button, ui.is_enabled(), label)
    });
    response.on_hover_cursor(egui::CursorIcon::PointingHand)
}

pub(super) fn toggle(
    ui: &mut egui::Ui,
    id: &str,
    value: &mut bool,
    label: &str,
    description: &str,
) -> Response {
    let width = ui.available_width();
    let text_width = (width - 62.0).max(1.0);
    let label_text = ui.painter().layout(
        label.to_owned(),
        FontId::proportional(13.5),
        INK,
        text_width,
    );
    let description_text = (!description.is_empty()).then(|| {
        ui.painter().layout(
            description.to_owned(),
            FontId::proportional(11.5),
            FAINT,
            text_width,
        )
    });
    let text_height = label_text.size().y
        + description_text
            .as_ref()
            .map_or(0.0, |description| description.size().y + 5.0);
    let height = (text_height + 12.0).max(42.0);
    let (rect, _) = ui.allocate_exact_size(Vec2::new(width, height), Sense::hover());
    let id = ui.make_persistent_id(id);
    let mut response = ui.interact(rect, id, Sense::click());
    // Sense::click includes Space/Enter and accessibility activation when focused.
    if response.clicked() {
        *value = !*value;
        response.mark_changed();
    }
    response.widget_info(|| {
        egui::WidgetInfo::selected(egui::WidgetType::Checkbox, ui.is_enabled(), *value, label)
    });
    if ui.is_rect_visible(rect) {
        let text_top = rect.center().y - text_height / 2.0;
        let label_height = label_text.size().y;
        ui.painter()
            .galley(egui::pos2(rect.left(), text_top), label_text, INK);
        if let Some(description) = description_text {
            ui.painter().galley(
                egui::pos2(rect.left(), text_top + label_height + 5.0),
                description,
                FAINT,
            );
        }
        let progress = ui
            .ctx()
            .animate_bool_with_time(id.with("value"), *value, 0.16);
        let track = Rect::from_center_size(
            egui::pos2(rect.right() - 20.0, rect.center().y),
            Vec2::new(40.0, 22.0),
        );
        let fill: Color32 =
            (egui::Rgba::from(BG3) * (1.0 - progress) + egui::Rgba::from(ACCENT) * progress).into();
        let intent = response.hovered() || response.has_focus();
        let border = if intent {
            Color32::from_rgb(110, 81, 52)
        } else {
            Color32::from_rgb(62, 51, 37)
        };
        ui.painter()
            .rect(track, 11.0, fill, Stroke::new(1.0, border));
        let thumb = egui::pos2(
            egui::lerp(track.left() + 11.0..=track.right() - 11.0, progress),
            track.center().y,
        );
        ui.painter().circle_filled(thumb, 8.0, INK);
        if response.has_focus() {
            ui.painter()
                .rect_stroke(track.expand(3.0), 14.0, Stroke::new(1.0, ACCENT_HI));
        }
    }
    response.on_hover_cursor(egui::CursorIcon::PointingHand)
}

pub(super) fn divider(ui: &mut egui::Ui) {
    ui.add_space(2.0);
    let (rect, _) = ui.allocate_exact_size(Vec2::new(ui.available_width(), 1.0), Sense::hover());
    ui.painter()
        .hline(rect.x_range(), rect.center().y, Stroke::new(1.0, LINE));
    ui.add_space(2.0);
}

pub(super) fn confirm_profile_delete(
    ctx: &egui::Context,
    language: &str,
    name: &str,
    address: &str,
    focus_cancel: bool,
) -> Option<bool> {
    let screen = ctx.screen_rect();
    let scrim_id = egui::Id::new("settings-profile-delete-scrim");
    let dialog_id = egui::Id::new("settings-profile-delete-dialog");
    let scrim = egui::Area::new(scrim_id)
        .order(egui::Order::Foreground)
        .fixed_pos(screen.min)
        .movable(false)
        .constrain(false)
        .fade_in(false)
        .show(ctx, |ui| {
            let (rect, response) = ui.allocate_exact_size(screen.size(), Sense::click());
            ui.painter()
                .rect_filled(rect, 0.0, Color32::from_rgba_unmultiplied(5, 4, 3, 188));
            response
        });
    let width = (screen.width() - 96.0).clamp(1.0, 440.0);
    let padding = 26.0_f32.min(width / 4.0);
    let content_width = (width - padding * 2.0).max(1.0);
    let content_height = (screen.height() - 96.0 - padding * 2.0).max(1.0);
    let mut decision = None;
    egui::Window::new(i18n::text(language, "desktop.deleteProfileTitle"))
        .id(dialog_id)
        .order(egui::Order::Foreground)
        .anchor(egui::Align2::CENTER_CENTER, Vec2::ZERO)
        .title_bar(false)
        .movable(false)
        .resizable(false)
        .collapsible(false)
        .fade_in(false)
        .default_width(content_width)
        .min_width(content_width)
        .max_width(content_width)
        .default_height(content_height)
        .min_height(0.0)
        .max_height(content_height)
        .frame(
            egui::Frame::none()
                .fill(BG1)
                .stroke(Stroke::new(1.0, Color32::from_rgb(70, 56, 40)))
                .rounding(18.0)
                .inner_margin(padding),
        )
        .show(ctx, |ui| {
            ui.set_width(content_width);
            egui::ScrollArea::vertical()
                .id_salt("settings-profile-delete-content")
                .max_height(content_height)
                .auto_shrink([false, true])
                .show(ui, |ui| {
                    ui.set_width(content_width);
                    ui.spacing_mut().item_spacing = Vec2::new(12.0, 12.0);
                    ui.add(
                        egui::Label::new(
                            RichText::new(i18n::text(language, "desktop.deleteProfileTitle"))
                                .font(display(21.0))
                                .color(INK),
                        )
                        .wrap(),
                    );
                    ui.add(
                        egui::Label::new(
                            RichText::new(i18n::format(
                                language,
                                "desktop.deleteProfileDescription",
                                &[name],
                            ))
                            .size(13.0)
                            .color(DIM),
                        )
                        .wrap(),
                    );
                    if !address.is_empty() {
                        ui.add(
                            egui::Label::new(RichText::new(address).size(11.5).color(FAINT)).wrap(),
                        );
                    }
                    ui.add_space(8.0);
                    ui.allocate_ui_with_layout(
                        Vec2::new(ui.available_width(), 38.0),
                        egui::Layout::right_to_left(egui::Align::Center).with_main_wrap(true),
                        |ui| {
                            let confirm = action(
                                ui,
                                i18n::text(language, "desktop.deleteProfileConfirm"),
                                true,
                            );
                            let cancel = action(ui, i18n::text(language, "common.cancel"), false);
                            if focus_cancel {
                                cancel.request_focus();
                            }
                            if cancel.clicked() {
                                decision = Some(false);
                            } else if !focus_cancel && confirm.clicked() {
                                // The opening input must never approve a destructive action.
                                decision = Some(true);
                            }
                        },
                    );
                });
        });
    ctx.set_sublayer(
        scrim.response.layer_id,
        egui::LayerId::new(egui::Order::Foreground, dialog_id),
    );
    decision
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context() -> egui::Context {
        let ctx = egui::Context::default();
        let mut fonts = egui::FontDefinitions::default();
        let proportional = fonts.families[&egui::FontFamily::Proportional].clone();
        fonts.families.insert(
            egui::FontFamily::Name("mihonban-display".into()),
            proportional,
        );
        ctx.set_fonts(fonts);
        ctx
    }

    fn render(
        ctx: &egui::Context,
        width: f32,
        name: &str,
        focus_cancel: bool,
        events: Vec<egui::Event>,
    ) -> (Option<bool>, egui::FullOutput) {
        let mut decision = None;
        let output = ctx.run(
            egui::RawInput {
                screen_rect: Some(Rect::from_min_size(
                    egui::Pos2::ZERO,
                    Vec2::new(width, 900.0),
                )),
                events,
                ..Default::default()
            },
            |ctx| {
                decision = confirm_profile_delete(
                    ctx,
                    "en",
                    name,
                    "https://music.example.com",
                    focus_cancel,
                );
            },
        );
        (decision, output)
    }

    fn text_shape<'a>(output: &'a egui::FullOutput, label: &str) -> &'a egui::epaint::TextShape {
        output
            .shapes
            .iter()
            .find_map(|shape| match &shape.shape {
                egui::Shape::Text(text) if text.galley.job.text == label => Some(text),
                _ => None,
            })
            .unwrap_or_else(|| {
                panic!(
                    "Missing dialog text: {label}; text: {:?}",
                    output
                        .shapes
                        .iter()
                        .filter_map(|shape| match &shape.shape {
                            egui::Shape::Text(text) =>
                                Some((&text.galley.job.text, text.pos, shape.clip_rect)),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                )
            })
    }

    fn click(ctx: &egui::Context, position: egui::Pos2) -> Option<bool> {
        click_in_dialog(ctx, 800.0, "Music archive", position)
    }

    fn click_in_dialog(
        ctx: &egui::Context,
        width: f32,
        name: &str,
        position: egui::Pos2,
    ) -> Option<bool> {
        let mut decision = None;
        for pressed in [true, false] {
            let (next, _) = render(
                ctx,
                width,
                name,
                false,
                vec![
                    egui::Event::PointerMoved(position),
                    egui::Event::PointerButton {
                        pos: position,
                        button: egui::PointerButton::Primary,
                        pressed,
                        modifiers: egui::Modifiers::NONE,
                    },
                ],
            );
            decision = decision.or(next);
        }
        decision
    }

    #[test]
    fn ordinary_confirmation_shrinks_to_a_compact_centered_card() {
        for width in [800.0, 1920.0] {
            let ctx = context();
            render(&ctx, width, "Music archive", true, vec![]);
            render(&ctx, width, "Music archive", false, vec![]);
            render(&ctx, width, "Music archive", false, vec![]);
            let dialog = ctx
                .memory(|memory| memory.area_rect(egui::Id::new("settings-profile-delete-dialog")))
                .unwrap();
            assert!(dialog.height() < 360.0, "{dialog:?}");
            assert!(dialog.height() > 180.0, "{dialog:?}");
            assert!((dialog.center().y - 450.0).abs() < 1.0, "{dialog:?}");
            assert!((dialog.width() - 440.0).abs() < 1.0, "{dialog:?}");
        }
    }

    #[test]
    fn opening_confirmation_cannot_approve_and_focuses_cancel() {
        let ctx = context();
        let (decision, _) = render(
            &ctx,
            800.0,
            "Music archive",
            true,
            vec![egui::Event::Key {
                key: egui::Key::Enter,
                physical_key: None,
                pressed: true,
                repeat: false,
                modifiers: egui::Modifiers::NONE,
            }],
        );
        assert_ne!(decision, Some(true));
        render(&ctx, 800.0, "Music archive", false, vec![]);
        let (_, output) = render(&ctx, 800.0, "Music archive", false, vec![]);
        let cancel = text_shape(&output, i18n::text("en", "common.cancel"));
        let cancel_center = cancel.pos + cancel.galley.size() / 2.0;
        let focused = ctx.memory(|memory| memory.focused()).expect("Cancel focus");
        assert!(ctx
            .read_response(focused)
            .unwrap()
            .rect
            .contains(cancel_center));
    }

    #[test]
    fn cancel_and_outside_clicks_never_approve_deletion() {
        let ctx = context();
        render(&ctx, 800.0, "Music archive", true, vec![]);
        let (_, output) = render(&ctx, 800.0, "Music archive", false, vec![]);
        let cancel = text_shape(&output, i18n::text("en", "common.cancel"));
        assert_eq!(
            click(&ctx, cancel.pos + cancel.galley.size() / 2.0),
            Some(false)
        );
        for position in [egui::pos2(8.0, 8.0), egui::pos2(792.0, 892.0)] {
            assert_eq!(click(&ctx, position), None);
        }
    }

    #[test]
    fn scrim_covers_the_screen_and_confirm_requires_its_own_click() {
        let ctx = context();
        render(&ctx, 800.0, "Music archive", true, vec![]);
        let (_, output) = render(&ctx, 800.0, "Music archive", false, vec![]);
        let scrim_id = egui::Id::new("settings-profile-delete-scrim");
        let scrim = ctx.memory(|memory| memory.area_rect(scrim_id)).unwrap();
        assert_eq!(
            scrim,
            Rect::from_min_size(egui::Pos2::ZERO, Vec2::new(800.0, 900.0))
        );
        assert_eq!(ctx.layer_id_at(egui::pos2(8.0, 8.0)).unwrap().id, scrim_id);
        let confirm = text_shape(&output, i18n::text("en", "desktop.deleteProfileConfirm"));
        let center = confirm.pos + confirm.galley.size() / 2.0;
        assert_eq!(
            ctx.layer_id_at(center).unwrap().id,
            egui::Id::new("settings-profile-delete-dialog")
        );
        assert_eq!(click(&ctx, center), Some(true));
    }

    #[test]
    fn narrow_confirmation_wraps_long_profile_names() {
        let ctx = context();
        let name = "A music archive with a deliberately long profile name ".repeat(3);
        render(&ctx, 320.0, &name, true, vec![]);
        let (_, output) = render(&ctx, 320.0, &name, false, vec![]);
        let description = i18n::format("en", "desktop.deleteProfileDescription", &[&name]);
        let text = text_shape(&output, &description);
        assert!(text.galley.rows.len() > 3);
        let dialog = ctx
            .memory(|memory| memory.area_rect(egui::Id::new("settings-profile-delete-dialog")))
            .unwrap();
        assert!(dialog.width() <= 224.01, "{dialog:?}");
        assert!(text.galley.size().x <= 172.01, "{:?}", text.galley.size());
        assert!(
            dialog.left() >= 47.99 && dialog.right() <= 272.01,
            "{dialog:?}"
        );
    }

    #[test]
    fn long_confirmation_remains_bounded_and_its_actions_can_be_reached_by_scrolling() {
        let ctx = context();
        let name = "A music archive with a deliberately long profile name ".repeat(30);
        render(&ctx, 320.0, &name, true, vec![]);
        render(&ctx, 320.0, &name, false, vec![]);
        let dialog = ctx
            .memory(|memory| memory.area_rect(egui::Id::new("settings-profile-delete-dialog")))
            .unwrap();
        assert!(dialog.height() <= 804.01, "{dialog:?}");
        assert!(
            dialog.top() >= 47.99 && dialog.bottom() <= 852.01,
            "{dialog:?}"
        );
        for _ in 0..32 {
            render(
                &ctx,
                320.0,
                &name,
                false,
                vec![
                    egui::Event::PointerMoved(dialog.center()),
                    egui::Event::MouseWheel {
                        unit: egui::MouseWheelUnit::Point,
                        delta: Vec2::new(0.0, -10000.0),
                        modifiers: egui::Modifiers::NONE,
                    },
                ],
            );
        }
        let (_, output) = render(&ctx, 320.0, &name, false, vec![]);
        let confirm = text_shape(&output, i18n::text("en", "desktop.deleteProfileConfirm"));
        let center = confirm.pos + confirm.galley.size() / 2.0;
        assert!(dialog.contains(center), "{center:?}; {dialog:?}");
        assert_eq!(click_in_dialog(&ctx, 320.0, &name, center), Some(true));
    }
}
