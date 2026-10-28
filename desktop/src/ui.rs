use eframe::egui::{self, Color32, FontId, Pos2, Rect, Response, RichText, Stroke, Vec2};

pub const BG0: Color32 = Color32::from_rgb(13, 11, 9);
pub const BG1: Color32 = Color32::from_rgb(22, 19, 15);
pub const BG2: Color32 = Color32::from_rgb(30, 26, 21);
pub const BG3: Color32 = Color32::from_rgb(39, 34, 25);
pub const LINE: Color32 = Color32::from_rgb(43, 37, 29);
pub const INK: Color32 = Color32::from_rgb(244, 236, 221);
pub const DIM: Color32 = Color32::from_rgb(176, 165, 143);
pub const FAINT: Color32 = Color32::from_rgb(141, 131, 112);
pub const ACCENT: Color32 = Color32::from_rgb(232, 84, 47);
pub const ACCENT_HI: Color32 = Color32::from_rgb(255, 107, 66);
pub const GOLD: Color32 = Color32::from_rgb(227, 179, 76);
pub const GOLD_DIM: Color32 = Color32::from_rgb(165, 129, 58);

pub fn serif(size: f32) -> FontId {
    FontId::new(size, egui::FontFamily::Name("mihonban-serif".into()))
}

pub fn display(size: f32) -> FontId {
    FontId::new(size, egui::FontFamily::Name("mihonban-display".into()))
}

pub fn cover_uv(image_size: Vec2, bounds_size: Vec2) -> Rect {
    let image_aspect = image_size.x / image_size.y;
    let bounds_aspect = bounds_size.x / bounds_size.y;
    let visible = if image_aspect > bounds_aspect {
        Vec2::new(bounds_aspect / image_aspect, 1.0)
    } else {
        Vec2::new(1.0, image_aspect / bounds_aspect)
    };
    Rect::from_center_size(egui::pos2(0.5, 0.5), visible)
}

pub fn connection_endpoint(ui: &mut egui::Ui, address: &str) {
    let service = address.trim().trim_end_matches('/');
    let parsed = url::Url::parse(service).ok();
    let label = parsed
        .as_ref()
        .filter(|url| url.has_host())
        .map(|url| {
            format!(
                "{}{}",
                &url[url::Position::BeforeHost..url::Position::AfterPort],
                url.path().trim_end_matches('/')
            )
        })
        .unwrap_or_else(|| service.to_owned());
    let text = ui
        .painter()
        .layout_no_wrap(label.clone(), FontId::proportional(12.5), DIM);
    let width = (text.size().x + 56.0)
        .max(180.0)
        .min(ui.available_width().min(360.0));
    let (rect, response) = ui.allocate_exact_size(Vec2::new(width, 36.0), egui::Sense::hover());
    ui.painter().rect(
        rect,
        18.0,
        Color32::from_rgb(27, 23, 18),
        Stroke::new(1.0, LINE),
    );
    paint_icon(
        ui.painter(),
        Rect::from_center_size(
            egui::pos2(rect.left() + 22.0, rect.center().y),
            Vec2::splat(15.0),
        ),
        Icon::Server,
        FAINT,
    );
    let text_bounds = Rect::from_min_max(
        egui::pos2(rect.left() + 38.0, rect.top()),
        egui::pos2(rect.right() - 16.0, rect.bottom()),
    );
    paint_text(
        ui,
        &label,
        text_bounds,
        FontId::proportional(12.5),
        DIM,
        false,
    );
    response.widget_info(|| {
        egui::WidgetInfo::labeled(egui::WidgetType::Label, ui.is_enabled(), service)
    });
    response.on_hover_text(service);
}

pub fn brand_wordmark(ui: &mut egui::Ui, show_subtitle: bool) -> Response {
    let title_text = if show_subtitle {
        "見本盤 "
    } else {
        "見本盤"
    };
    let mut title_job =
        egui::text::LayoutJob::simple_singleline(title_text.into(), display(21.0), INK);
    title_job.sections[0].format.extra_letter_spacing = 21.0 * 0.04;
    let title = ui.painter().layout_job(title_job);
    let subtitle = show_subtitle.then(|| {
        let mut job = egui::text::LayoutJob::simple_singleline(
            "非売品・MIHONBAN".into(),
            FontId::new(11.0, egui::FontFamily::Name("mihonban-ui".into())),
            FAINT,
        );
        job.sections[0].format.extra_letter_spacing = 11.0 * 0.1;
        ui.painter().layout_job(job)
    });
    let width = title.size().x + subtitle.as_ref().map_or(0.0, |text| text.size().x);
    let (rect, response) =
        ui.allocate_exact_size(Vec2::new(width, title.size().y), egui::Sense::click());
    if let Some(subtitle) = subtitle {
        let title_baseline = title.rows[0].glyphs[0].pos.y;
        let subtitle_baseline = subtitle.rows[0]
            .glyphs
            .iter()
            .find(|glyph| glyph.chr == 'M')
            .map_or(0.0, |glyph| glyph.pos.y);
        let position = rect.min + Vec2::new(title.size().x, title_baseline - subtitle_baseline);
        ui.painter().galley(position, subtitle, FAINT);
    }
    ui.painter().galley(rect.min, title, INK);
    response.widget_info(|| {
        egui::WidgetInfo::labeled(
            egui::WidgetType::Link,
            ui.is_enabled(),
            if show_subtitle {
                "見本盤 非売品・MIHONBAN"
            } else {
                "見本盤"
            },
        )
    });
    response.on_hover_cursor(egui::CursorIcon::PointingHand)
}

pub fn paint_text(
    ui: &egui::Ui,
    text: &str,
    rect: Rect,
    font: FontId,
    color: Color32,
    centered: bool,
) {
    let mut job = egui::text::LayoutJob::simple_singleline(text.to_owned(), font, color);
    job.wrap.max_width = rect.width();
    job.wrap.max_rows = 1;
    job.wrap.break_anywhere = true;
    let galley = ui.painter().layout_job(job);
    let position = Pos2::new(
        if centered {
            rect.center().x - galley.size().x / 2.0
        } else {
            rect.left()
        },
        rect.center().y - galley.size().y / 2.0,
    );
    ui.painter().galley(position, galley, color);
}

pub fn text_link(
    ui: &egui::Ui,
    text: &str,
    rect: Rect,
    font: FontId,
    color: Color32,
    id: egui::Id,
    centered: bool,
) -> Response {
    if text.trim().is_empty() {
        return ui.interact(
            Rect::from_min_size(rect.min, Vec2::ZERO),
            id,
            egui::Sense::hover(),
        );
    }
    let mut job = egui::text::LayoutJob::simple_singleline(text.to_owned(), font, color);
    job.wrap.max_width = rect.width();
    job.wrap.max_rows = 1;
    job.wrap.break_anywhere = true;
    let galley = ui.painter().layout_job(job);
    let position = Pos2::new(
        if centered {
            rect.center().x - galley.size().x / 2.0
        } else {
            rect.left()
        },
        rect.center().y - galley.size().y / 2.0,
    );
    // The reserved row controls layout; only the visible text is a link.
    let hit_rect = Rect::from_min_size(position, galley.size())
        .intersect(rect)
        .intersect(ui.clip_rect());
    let mut response = ui.interact(hit_rect, id, egui::Sense::click());
    // Egui also targets nearby controls; a name link requires a direct text hit.
    let direct_hit = ui.rect_contains_pointer(hit_rect);
    response.hovered &= direct_hit;
    response.contains_pointer &= direct_hit;
    response.clicked &= direct_hit;
    ui.painter().galley_with_override_text_color(
        position,
        galley,
        if response.hovered() { GOLD } else { color },
    );
    if response.has_focus() {
        ui.painter()
            .rect_stroke(hit_rect, 3.0, Stroke::new(1.0, ACCENT_HI));
    }
    response
        .widget_info(|| egui::WidgetInfo::labeled(egui::WidgetType::Link, ui.is_enabled(), text));
    response.on_hover_cursor(egui::CursorIcon::PointingHand)
}

pub fn artist_credit_links<'a>(
    ui: &egui::Ui,
    artists: &'a [crate::api::ArtistCredit],
    fallback: &'a str,
    rect: Rect,
    font: FontId,
    color: Color32,
    id: egui::Id,
) -> Option<&'a str> {
    let names: Vec<&str> = if artists.is_empty() {
        vec![fallback]
    } else {
        artists
            .iter()
            .map(|artist| artist.name.as_str())
            .filter(|name| !name.trim().is_empty())
            .collect()
    };
    let separator = if names.len() == 2 { " × " } else { ", " };
    let separator_galley = ui
        .painter()
        .layout_no_wrap(separator.into(), font.clone(), FAINT);
    let painter = ui.painter().with_clip_rect(rect.intersect(ui.clip_rect()));
    let mut left = rect.left();
    let mut clicked = None;
    for (index, name) in names.into_iter().enumerate() {
        if left >= rect.right() {
            break;
        }
        if index > 0 {
            painter.galley(
                Pos2::new(left, rect.center().y - separator_galley.size().y / 2.0),
                separator_galley.clone(),
                FAINT,
            );
            left += separator_galley.size().x;
        }
        if left >= rect.right() {
            break;
        }
        let width = ui
            .painter()
            .layout_no_wrap(name.into(), font.clone(), color)
            .size()
            .x
            .min(rect.right() - left);
        let name_rect =
            Rect::from_min_size(Pos2::new(left, rect.top()), Vec2::new(width, rect.height()));
        if text_link(
            ui,
            name,
            name_rect,
            font.clone(),
            color,
            id.with(index),
            false,
        )
        .clicked()
        {
            clicked = Some(name);
        }
        left += width;
    }
    clicked
}

#[derive(Clone, Copy)]
pub enum Icon {
    Search,
    FilterX,
    Server,
    Play,
    Pause,
    User,
    Back,
    Close,
    Previous,
    Next,
    Heart,
    HeartOutline,
    Volume,
    Shuffle,
    Locate,
    Repeat,
    RepeatOne,
    VolumeMuted,
    VolumeLow,
    Fullscreen,
    FullscreenExit,
}

fn paint_web_filter_icon(painter: &egui::Painter, rect: Rect, color: Color32) {
    let edge = rect.width().min(rect.height());
    let origin = rect.center() - Vec2::splat(edge * 0.5);
    let point = |x: f32, y: f32| origin + Vec2::new(x, y) * (edge / 24.0);
    let stroke = Stroke::new(edge / 12.0, color);
    let filter = [
        (3.0, 4.0),
        (21.0, 4.0),
        (14.0, 12.0),
        (14.0, 18.0),
        (10.0, 20.0),
        (10.0, 12.0),
        (3.0, 4.0),
    ];
    painter.add(egui::Shape::line(
        filter.iter().map(|&(x, y)| point(x, y)).collect(),
        stroke,
    ));
    for &(x, y) in &filter[..filter.len() - 1] {
        painter.circle_filled(point(x, y), stroke.width * 0.5, color);
    }
    for (start, end) in [((17.0, 16.0), (21.0, 20.0)), ((21.0, 16.0), (17.0, 20.0))] {
        painter.add(egui::Shape::line(
            vec![point(start.0, start.1), point(end.0, end.1)],
            stroke,
        ));
        for (x, y) in [start, end] {
            painter.circle_filled(point(x, y), stroke.width * 0.5, color);
        }
    }
}

pub fn paint_icon(painter: &egui::Painter, rect: Rect, icon: Icon, color: Color32) {
    let size = rect.width().min(rect.height());
    let origin = rect.center() - Vec2::splat(size / 2.0);
    let point =
        |horizontal: f32, vertical: f32| origin + Vec2::new(horizontal, vertical) * (size / 24.0);
    let stroke = Stroke::new((size / 12.0).max(1.0), color);
    let line = |points: &[(f32, f32)]| {
        painter.add(egui::Shape::line(
            points
                .iter()
                .map(|&(horizontal, vertical)| point(horizontal, vertical))
                .collect(),
            stroke,
        ));
    };
    match icon {
        Icon::Locate => {
            line(&[(2.0, 12.0), (5.0, 12.0)]);
            line(&[(19.0, 12.0), (22.0, 12.0)]);
            line(&[(12.0, 2.0), (12.0, 5.0)]);
            line(&[(12.0, 19.0), (12.0, 22.0)]);
            painter.circle_stroke(point(12.0, 12.0), size * 7.0 / 24.0, stroke);
            painter.circle_filled(point(12.0, 12.0), size * 2.2 / 24.0, color);
        }
        Icon::FilterX => paint_web_filter_icon(painter, rect, color),
        Icon::Server => {
            for vertical in [3.0, 14.0] {
                painter.rect_stroke(
                    Rect::from_min_max(point(3.0, vertical), point(21.0, vertical + 7.0)),
                    1.5,
                    stroke,
                );
                painter.circle_filled(point(7.0, vertical + 3.5), size / 24.0, color);
            }
        }
        Icon::Search => {
            painter.circle_stroke(point(11.0, 11.0), size * 7.0 / 24.0, stroke);
            line(&[(16.8, 16.8), (20.0, 20.0)]);
        }
        Icon::Play => {
            painter.add(egui::Shape::convex_polygon(
                vec![point(8.0, 4.5), point(8.0, 19.5), point(21.0, 12.0)],
                color,
                Stroke::NONE,
            ));
        }
        Icon::Pause => {
            for horizontal in [5.0, 14.0] {
                painter.rect_filled(
                    Rect::from_min_max(point(horizontal, 4.0), point(horizontal + 5.0, 20.0)),
                    1.0,
                    color,
                );
            }
        }
        Icon::User => {
            painter.circle_stroke(point(12.0, 7.0), size / 6.0, stroke);
            let path = egui::epaint::CubicBezierShape::from_points_stroke(
                [
                    point(4.0, 21.0),
                    point(3.0, 13.0),
                    point(21.0, 13.0),
                    point(20.0, 21.0),
                ],
                false,
                Color32::TRANSPARENT,
                stroke,
            );
            painter.add(path);
        }
        Icon::Back => {
            painter.add(egui::Shape::line(
                [(15.0, 18.0), (9.0, 12.0), (15.0, 6.0)]
                    .iter()
                    .map(|&(horizontal, vertical)| point(horizontal, vertical))
                    .collect(),
                Stroke::new((size / 7.5).max(1.5), color),
            ));
        }
        Icon::Close => {
            line(&[(6.0, 6.0), (18.0, 18.0)]);
            line(&[(18.0, 6.0), (6.0, 18.0)]);
        }
        Icon::Fullscreen => {
            // Outward corner brackets: the standard enter-fullscreen glyph.
            line(&[(4.5, 9.5), (4.5, 4.5), (9.5, 4.5)]);
            line(&[(14.5, 4.5), (19.5, 4.5), (19.5, 9.5)]);
            line(&[(19.5, 14.5), (19.5, 19.5), (14.5, 19.5)]);
            line(&[(9.5, 19.5), (4.5, 19.5), (4.5, 14.5)]);
        }
        Icon::FullscreenExit => {
            // Inward brackets read as "compress back into a window".
            line(&[(4.5, 9.5), (9.5, 9.5), (9.5, 4.5)]);
            line(&[(14.5, 4.5), (14.5, 9.5), (19.5, 9.5)]);
            line(&[(19.5, 14.5), (14.5, 14.5), (14.5, 19.5)]);
            line(&[(9.5, 19.5), (9.5, 14.5), (4.5, 14.5)]);
        }
        Icon::Next | Icon::Previous => {
            let previous = matches!(icon, Icon::Previous);
            let flip = |horizontal: f32| {
                if previous {
                    24.0 - horizontal
                } else {
                    horizontal
                }
            };
            painter.add(egui::Shape::convex_polygon(
                vec![
                    point(flip(5.0), 5.0),
                    point(flip(5.0), 19.0),
                    point(flip(14.0), 12.0),
                ],
                color,
                Stroke::NONE,
            ));
            painter.rect_filled(
                Rect::from_two_pos(point(flip(16.0), 5.0), point(flip(19.0), 19.0)),
                1.0,
                color,
            );
        }
        Icon::Heart | Icon::HeartOutline => {
            let outline = matches!(icon, Icon::HeartOutline);
            let mut points = Vec::new();
            for (start, control1, control2, end) in [
                ((12.0, 21.0), (8.0, 17.0), (2.0, 12.0), (2.0, 7.5)),
                ((2.0, 7.5), (2.0, 2.0), (8.0, 1.5), (12.0, 6.0)),
                ((12.0, 6.0), (16.0, 1.5), (22.0, 2.0), (22.0, 7.5)),
                ((22.0, 7.5), (22.0, 12.0), (16.0, 17.0), (12.0, 21.0)),
            ] {
                let curve = egui::epaint::CubicBezierShape::from_points_stroke(
                    [
                        point(start.0, start.1),
                        point(control1.0, control1.1),
                        point(control2.0, control2.1),
                        point(end.0, end.1),
                    ],
                    false,
                    Color32::TRANSPARENT,
                    Stroke::NONE,
                );
                points.extend(curve.flatten(Some(0.2)));
            }
            painter.add(egui::epaint::PathShape {
                points,
                closed: true,
                fill: if outline { Color32::TRANSPARENT } else { color },
                stroke: if outline {
                    Stroke::new((size / 9.0).max(1.2), color)
                } else {
                    Stroke::NONE
                }
                .into(),
            });
        }
        Icon::Volume | Icon::VolumeLow | Icon::VolumeMuted => {
            painter.add(egui::Shape::convex_polygon(
                vec![
                    point(3.0, 9.0),
                    point(6.0, 9.0),
                    point(11.0, 5.0),
                    point(11.0, 19.0),
                    point(6.0, 15.0),
                    point(3.0, 15.0),
                ],
                color,
                Stroke::NONE,
            ));
            if matches!(icon, Icon::VolumeMuted) {
                line(&[(16.0, 9.0), (21.0, 15.0)]);
                line(&[(21.0, 9.0), (16.0, 15.0)]);
            }
            for distance in [4.0, 8.0] {
                if matches!(icon, Icon::VolumeMuted)
                    || matches!(icon, Icon::VolumeLow) && distance > 4.0
                {
                    continue;
                }
                painter.add(egui::epaint::CubicBezierShape::from_points_stroke(
                    [
                        point(13.0 + distance / 2.0, 12.0 - distance / 1.6),
                        point(15.0 + distance, 12.0 - distance / 3.0),
                        point(15.0 + distance, 12.0 + distance / 3.0),
                        point(13.0 + distance / 2.0, 12.0 + distance / 1.6),
                    ],
                    false,
                    Color32::TRANSPARENT,
                    stroke,
                ));
            }
        }
        Icon::Shuffle => {
            line(&[(16.0, 3.0), (21.0, 3.0), (21.0, 8.0)]);
            line(&[(4.0, 20.0), (21.0, 3.0)]);
            line(&[(21.0, 16.0), (21.0, 21.0), (16.0, 21.0)]);
            line(&[(15.0, 15.0), (21.0, 21.0)]);
            line(&[(4.0, 4.0), (9.0, 9.0)]);
        }
        Icon::Repeat | Icon::RepeatOne => {
            line(&[(17.0, 2.0), (21.0, 6.0), (17.0, 10.0)]);
            line(&[(3.0, 11.0), (3.0, 10.0)]);
            line(&[(7.0, 6.0), (21.0, 6.0)]);
            line(&[(7.0, 22.0), (3.0, 18.0), (7.0, 14.0)]);
            line(&[(21.0, 13.0), (21.0, 14.0)]);
            line(&[(17.0, 18.0), (3.0, 18.0)]);
            for points in [
                [(3.0, 10.0), (3.0, 7.8), (4.8, 6.0), (7.0, 6.0)],
                [(21.0, 14.0), (21.0, 16.2), (19.2, 18.0), (17.0, 18.0)],
            ] {
                painter.add(egui::epaint::CubicBezierShape::from_points_stroke(
                    points.map(|coordinates| point(coordinates.0, coordinates.1)),
                    false,
                    Color32::TRANSPARENT,
                    stroke,
                ));
            }
            if matches!(icon, Icon::RepeatOne) {
                // A bold filled "1" stays readable at the small player-bar
                // size; the old hairline stroke disappeared there and made
                // single-repeat look identical to list repeat.
                painter.rect_filled(
                    Rect::from_min_max(point(11.0, 8.8), point(13.6, 15.6)),
                    0.0,
                    color,
                );
                painter.add(egui::Shape::convex_polygon(
                    vec![point(8.4, 12.2), point(11.0, 8.8), point(11.0, 11.6)],
                    color,
                    Stroke::NONE,
                ));
            }
        }
    }
}

/// Rotating arc with a fading tail, shown on the play control while the
/// engine prepares audio. Phase is a 0..1 fraction of one revolution,
/// advancing clockwise from twelve o'clock.
pub fn paint_spinner(painter: &egui::Painter, rect: Rect, color: Color32, phase: f32) {
    let size = rect.width().min(rect.height());
    let stroke = (size / 10.0).max(1.8);
    let radius = size * 0.5 - stroke * 0.65;
    let head = std::f32::consts::TAU * phase.clamp(0.0, 1.0) - std::f32::consts::FRAC_PI_2;
    let sweep = std::f32::consts::TAU * 0.68;
    let segments = 26;
    for index in 0..segments {
        let from = head - sweep * index as f32 / segments as f32;
        let to = head - sweep * (index + 1) as f32 / segments as f32;
        let alpha = 1.0 - 0.88 * index as f32 / segments as f32;
        painter.line_segment(
            [
                rect.center() + Vec2::angled(from) * radius,
                rect.center() + Vec2::angled(to) * radius,
            ],
            Stroke::new(stroke, color.gamma_multiply(alpha)),
        );
    }
}

pub fn icon_button(ui: &mut egui::Ui, icon: Icon, size: f32, color: Color32) -> Response {
    let (rect, response) = ui.allocate_exact_size(Vec2::splat(size), egui::Sense::click());
    let response = response.on_hover_cursor(egui::CursorIcon::PointingHand);
    paint_icon(
        ui.painter(),
        rect.shrink(size * 0.22),
        icon,
        if response.hovered() { INK } else { color },
    );
    if response.has_focus() {
        ui.painter()
            .rect_stroke(rect, size / 2.0, Stroke::new(1.0, ACCENT_HI));
    }
    response
}

pub fn genre_more_button(ui: &mut egui::Ui, label: &str) -> Response {
    let text = ui
        .painter()
        .layout_no_wrap(label.to_owned(), FontId::proportional(14.5), FAINT);
    let (_, rect) = ui.allocate_space(Vec2::new(text.size().x + 26.0, 30.0));
    let response = ui.interact(rect, ui.id().with("genre-more"), egui::Sense::click());
    let highlighted = response.hovered() || response.has_focus();
    let color = if highlighted { GOLD } else { FAINT };
    let border = if highlighted {
        GOLD_DIM
    } else {
        Color32::from_rgba_premultiplied(35, 30, 24, 209)
    };
    ui.painter()
        .rect_filled(rect, 15.0, Color32::from_rgba_premultiplied(5, 5, 5, 5));
    let outline = rect.shrink(0.5);
    let radius = outline.height() / 2.0;
    let mut path = Vec::with_capacity(35);
    for (center, start_angle) in [
        (
            Pos2::new(outline.right() - radius, outline.center().y),
            -std::f32::consts::FRAC_PI_2,
        ),
        (
            Pos2::new(outline.left() + radius, outline.center().y),
            std::f32::consts::FRAC_PI_2,
        ),
    ] {
        for step in 0..=16 {
            let angle = start_angle + std::f32::consts::PI * step as f32 / 16.0;
            path.push(center + Vec2::new(angle.cos(), angle.sin()) * radius);
        }
    }
    path.push(path[0]);
    ui.painter().extend(egui::Shape::dashed_line(
        &path,
        Stroke::new(1.0, border),
        3.0,
        2.0,
    ));
    paint_text(ui, label, rect, FontId::proportional(14.5), color, true);
    response.widget_info(|| {
        egui::WidgetInfo::labeled(egui::WidgetType::Button, ui.is_enabled(), label)
    });
    response.on_hover_cursor(egui::CursorIcon::PointingHand)
}

/// Render the compact Web-style action used beneath artist biographies and album notes.
pub fn read_more_button(ui: &mut egui::Ui, label: &str, pill: bool) -> Response {
    let font = FontId::proportional(12.5);
    let text = ui
        .painter()
        .layout_no_wrap(label.to_owned(), font.clone(), GOLD);
    let text_size = text.size();
    let height = if pill { 30.0 } else { 26.0 };
    let arrow_width = 13.0;
    let gap = 4.0;
    let padding = if pill { 14.0 } else { 0.0 };
    let (rect, response) = ui.allocate_exact_size(
        Vec2::new(text_size.x + gap + arrow_width + padding * 2.0, height),
        egui::Sense::click(),
    );
    let highlighted = response.hovered() || response.has_focus();
    let radius = if pill { height * 0.5 } else { 0.0 };
    if pill {
        ui.painter().rect(
            rect,
            radius,
            if highlighted { BG2 } else { BG1 },
            Stroke::new(
                1.0,
                if response.has_focus() {
                    ACCENT_HI
                } else if highlighted {
                    GOLD_DIM
                } else {
                    LINE
                },
            ),
        );
    }
    let text_left = rect.left() + padding;
    ui.painter().galley(
        egui::pos2(text_left, rect.center().y - text_size.y * 0.5),
        text,
        GOLD,
    );
    let arrow_center = egui::pos2(
        text_left + text_size.x + gap + arrow_width * 0.5,
        rect.center().y,
    );
    let arrow_stroke = Stroke::new(1.35, GOLD);
    ui.painter().add(egui::Shape::line(
        vec![
            arrow_center + Vec2::new(-1.5, -3.0),
            arrow_center + Vec2::new(1.5, 0.0),
            arrow_center + Vec2::new(-1.5, 3.0),
        ],
        arrow_stroke,
    ));
    response.widget_info(|| {
        egui::WidgetInfo::labeled(egui::WidgetType::Button, ui.is_enabled(), label)
    });
    response
        .on_hover_cursor(egui::CursorIcon::PointingHand)
        .on_hover_text(label)
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum MarkdownBlock {
    Heading(u8, String),
    Paragraph(String),
    List(bool, Vec<String>),
    Quote(String),
    Code(String),
    Table {
        has_header: bool,
        rows: Vec<Vec<String>>,
    },
    Rule,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MarkdownStyle {
    Plain,
    Strong,
    Emphasis,
    Code,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct MarkdownSpan {
    text: String,
    style: MarkdownStyle,
    link: Option<String>,
}

fn markdown_spans(source: &str) -> Vec<MarkdownSpan> {
    let mut spans = Vec::new();
    let mut plain_start = 0;
    let mut cursor = 0;
    while cursor < source.len() {
        let rest = &source[cursor..];
        let (delimiter, style) = if rest.starts_with("**") {
            (Some("**"), MarkdownStyle::Strong)
        } else if rest.starts_with('`') {
            (Some("`"), MarkdownStyle::Code)
        } else if rest.starts_with('*') {
            (Some("*"), MarkdownStyle::Emphasis)
        } else {
            (None, MarkdownStyle::Plain)
        };
        if let Some(delimiter) = delimiter {
            let content_start = cursor + delimiter.len();
            if let Some(relative_end) = source[content_start..].find(delimiter) {
                let end = content_start + relative_end;
                let content = &source[content_start..end];
                if !content.is_empty()
                    && (style != MarkdownStyle::Emphasis
                        || !content.chars().next().is_some_and(char::is_whitespace))
                {
                    push_markdown_span(
                        &mut spans,
                        source,
                        plain_start,
                        cursor,
                        MarkdownStyle::Plain,
                        None,
                    );
                    push_markdown_span(&mut spans, source, content_start, end, style, None);
                    cursor = end + delimiter.len();
                    plain_start = cursor;
                    continue;
                }
            }
        }
        if rest.starts_with('[') {
            if let Some(label_end) = rest.find("](") {
                let url_start = cursor + label_end + 2;
                if let Some(relative_end) = source[url_start..].find(')') {
                    let url_end = url_start + relative_end;
                    let url = &source[url_start..url_end];
                    if (url.starts_with("http://") || url.starts_with("https://"))
                        && !url.chars().any(char::is_whitespace)
                    {
                        push_markdown_span(
                            &mut spans,
                            source,
                            plain_start,
                            cursor,
                            MarkdownStyle::Plain,
                            None,
                        );
                        spans.push(MarkdownSpan {
                            text: source[cursor + 1..cursor + label_end].to_owned(),
                            style: MarkdownStyle::Plain,
                            link: Some(url.to_owned()),
                        });
                        cursor = url_end + 1;
                        plain_start = cursor;
                        continue;
                    }
                }
            }
        }
        cursor += rest
            .chars()
            .next()
            .expect("cursor is before the end")
            .len_utf8();
    }
    push_markdown_span(
        &mut spans,
        source,
        plain_start,
        source.len(),
        MarkdownStyle::Plain,
        None,
    );
    spans
}

fn push_markdown_span(
    spans: &mut Vec<MarkdownSpan>,
    source: &str,
    start: usize,
    end: usize,
    style: MarkdownStyle,
    link: Option<String>,
) {
    if start < end {
        spans.push(MarkdownSpan {
            text: source[start..end].to_owned(),
            style,
            link,
        });
    }
}

fn markdown_blocks(source: &str) -> Vec<MarkdownBlock> {
    let mut blocks = Vec::new();
    let mut paragraph = Vec::new();
    let mut list: Option<(bool, Vec<String>)> = None;
    let mut quote = Vec::new();
    let mut code: Option<Vec<String>> = None;
    let mut table: Option<(bool, Vec<Vec<String>>)> = None;
    let flush_paragraph = |blocks: &mut Vec<MarkdownBlock>, paragraph: &mut Vec<String>| {
        if !paragraph.is_empty() {
            blocks.push(MarkdownBlock::Paragraph(
                paragraph.drain(..).collect::<Vec<_>>().join("\n"),
            ));
        }
    };
    let flush_list = |blocks: &mut Vec<MarkdownBlock>, list: &mut Option<(bool, Vec<String>)>| {
        if let Some((ordered, items)) = list.take() {
            blocks.push(MarkdownBlock::List(ordered, items));
        }
    };
    let flush_quote = |blocks: &mut Vec<MarkdownBlock>, quote: &mut Vec<String>| {
        if !quote.is_empty() {
            blocks.push(MarkdownBlock::Quote(
                quote.drain(..).collect::<Vec<_>>().join("\n"),
            ));
        }
    };
    let flush_table = |blocks: &mut Vec<MarkdownBlock>,
                       table: &mut Option<(bool, Vec<Vec<String>>)>| {
        if let Some((has_header, rows)) = table.take() {
            if !rows.is_empty() {
                blocks.push(MarkdownBlock::Table { has_header, rows });
            }
        }
    };

    for raw in source.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let line = raw.trim_end();
        if let Some(code_lines) = code.as_mut() {
            if line.trim_start().starts_with("```") {
                let text = code_lines.join("\n");
                blocks.push(MarkdownBlock::Code(text));
                code = None;
            } else {
                code_lines.push(line.to_owned());
            }
            continue;
        }
        if line.trim_start().starts_with("```") {
            flush_paragraph(&mut blocks, &mut paragraph);
            flush_list(&mut blocks, &mut list);
            flush_quote(&mut blocks, &mut quote);
            flush_table(&mut blocks, &mut table);
            code = Some(Vec::new());
            continue;
        }
        if line.trim().is_empty() {
            flush_paragraph(&mut blocks, &mut paragraph);
            flush_list(&mut blocks, &mut list);
            flush_quote(&mut blocks, &mut quote);
            flush_table(&mut blocks, &mut table);
            continue;
        }
        let trimmed_line = line.trim();
        if let Some(table_row) = trimmed_line
            .strip_prefix('|')
            .and_then(|row| row.strip_suffix('|'))
        {
            flush_paragraph(&mut blocks, &mut paragraph);
            flush_list(&mut blocks, &mut list);
            flush_quote(&mut blocks, &mut quote);
            let cells = table_row
                .split('|')
                .map(str::trim)
                .map(str::to_owned)
                .collect::<Vec<_>>();
            let separator = cells.iter().all(|cell| {
                let trimmed = cell.trim_matches(':');
                trimmed.len() >= 2 && trimmed.chars().all(|character| character == '-')
            });
            if separator {
                if let Some((has_header, _)) = table.as_mut() {
                    *has_header = true;
                }
            } else {
                table
                    .get_or_insert_with(|| (false, Vec::new()))
                    .1
                    .push(cells);
            }
            continue;
        }
        flush_table(&mut blocks, &mut table);
        if let Some((hashes, title)) = line.trim_start().split_once(' ') {
            if hashes.chars().all(|character| character == '#') && (1..=4).contains(&hashes.len()) {
                flush_paragraph(&mut blocks, &mut paragraph);
                flush_list(&mut blocks, &mut list);
                flush_quote(&mut blocks, &mut quote);
                blocks.push(MarkdownBlock::Heading(
                    hashes.len() as u8,
                    title.trim_end_matches('#').trim_end().to_owned(),
                ));
                continue;
            }
        }
        let rule = line.trim();
        if [('-', 3), ('*', 3), ('_', 3)]
            .iter()
            .any(|(character, minimum)| {
                rule.chars().count() >= *minimum
                    && rule.chars().all(|current| current == *character)
            })
        {
            flush_paragraph(&mut blocks, &mut paragraph);
            flush_list(&mut blocks, &mut list);
            flush_quote(&mut blocks, &mut quote);
            blocks.push(MarkdownBlock::Rule);
            continue;
        }
        if let Some(text) = line.trim_start().strip_prefix('>') {
            flush_paragraph(&mut blocks, &mut paragraph);
            flush_list(&mut blocks, &mut list);
            quote.push(text.trim_start().to_owned());
            continue;
        }
        let trimmed = line.trim_start();
        let unordered = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
            .or_else(|| trimmed.strip_prefix("• "));
        let ordered = trimmed
            .char_indices()
            .find(|(_, character)| matches!(character, '.' | '、' | ')'))
            .and_then(|(index, separator)| {
                (index != 0
                    && trimmed[..index]
                        .chars()
                        .all(|character| character.is_ascii_digit()))
                .then(|| trimmed[index + separator.len_utf8()..].trim_start())
            });
        if let Some(item) = unordered.or(ordered) {
            flush_paragraph(&mut blocks, &mut paragraph);
            flush_quote(&mut blocks, &mut quote);
            let is_ordered = unordered.is_none();
            match &mut list {
                Some((ordered, items)) if *ordered == is_ordered => items.push(item.to_owned()),
                _ => {
                    flush_list(&mut blocks, &mut list);
                    list = Some((is_ordered, vec![item.to_owned()]));
                }
            }
            continue;
        }
        flush_list(&mut blocks, &mut list);
        flush_quote(&mut blocks, &mut quote);
        paragraph.push(line.trim().to_owned());
    }
    if let Some(code_lines) = code {
        blocks.push(MarkdownBlock::Code(code_lines.join("\n")));
    }
    flush_paragraph(&mut blocks, &mut paragraph);
    flush_list(&mut blocks, &mut list);
    flush_quote(&mut blocks, &mut quote);
    flush_table(&mut blocks, &mut table);
    blocks
}

/// Render a short Markdown excerpt with the same quiet typography used by the Web hero.
pub fn markdown_preview(ui: &mut egui::Ui, source: &str, max_rows: usize) {
    let mut job = egui::text::LayoutJob::default();
    for (index, block) in markdown_blocks(source).into_iter().enumerate() {
        if index > 0 {
            job.append(" ", 0.0, egui::TextFormat::simple(serif(15.0), DIM));
        }
        match block {
            MarkdownBlock::Heading(level, text) => append_preview_inline(
                &mut job,
                &text,
                serif(if level <= 2 { 16.0 } else { 15.0 }),
                INK,
            ),
            MarkdownBlock::Paragraph(text) => {
                append_preview_inline(&mut job, &text, serif(15.0), DIM)
            }
            MarkdownBlock::List(ordered, items) => {
                for (index, item) in items.iter().enumerate() {
                    if index > 0 {
                        job.append(" · ", 0.0, egui::TextFormat::simple(serif(15.0), FAINT));
                    }
                    let marker = if ordered {
                        format!("{}.", index + 1)
                    } else {
                        "•".to_owned()
                    };
                    job.append(
                        &format!("{} ", marker),
                        0.0,
                        egui::TextFormat::simple(serif(15.0), FAINT),
                    );
                    append_preview_inline(&mut job, item, serif(15.0), DIM);
                }
            }
            MarkdownBlock::Quote(text) => {
                append_preview_inline(&mut job, &text, serif(15.0), FAINT)
            }
            MarkdownBlock::Code(text) => {
                let mut format = egui::TextFormat::simple(FontId::monospace(13.0), DIM);
                format.background = BG2;
                job.append(&text, 0.0, format);
            }
            MarkdownBlock::Table { rows, .. } => {
                for (row_index, row) in rows.iter().enumerate() {
                    if row_index > 0 {
                        job.append(" · ", 0.0, egui::TextFormat::simple(serif(15.0), FAINT));
                    }
                    for (cell_index, cell) in row.iter().enumerate() {
                        if cell_index > 0 {
                            job.append("  |  ", 0.0, egui::TextFormat::simple(serif(15.0), FAINT));
                        }
                        append_preview_inline(&mut job, cell, serif(15.0), DIM);
                    }
                }
            }
            MarkdownBlock::Rule => {
                job.append(" ─── ", 0.0, egui::TextFormat::simple(serif(15.0), FAINT));
            }
        }
    }
    job.wrap.max_rows = max_rows;
    job.wrap.max_width = ui.available_width();
    let galley = ui.painter().layout_job(job);
    let (rect, _) = ui.allocate_exact_size(galley.size(), egui::Sense::hover());
    ui.painter().galley(rect.min, galley, DIM);
}

fn append_preview_inline(
    job: &mut egui::text::LayoutJob,
    source: &str,
    font: FontId,
    color: Color32,
) {
    for span in markdown_spans(source) {
        let mut format = egui::TextFormat::simple(font.clone(), color);
        match span.style {
            MarkdownStyle::Plain => {}
            MarkdownStyle::Strong => {
                format.font_id = display(font.size);
                format.color = INK;
            }
            MarkdownStyle::Emphasis => format.italics = true,
            MarkdownStyle::Code => {
                format.font_id = FontId::monospace(font.size * 0.9);
                format.background = BG2;
            }
        }
        if span.link.is_some() {
            format.color = GOLD;
            format.underline = Stroke::new(1.0, GOLD_DIM);
        }
        job.append(&span.text, 0.0, format);
    }
}

/// Render full Markdown content natively, without exposing Markdown control characters.
pub fn markdown_body(ui: &mut egui::Ui, source: &str) {
    for block in markdown_blocks(source) {
        match block {
            MarkdownBlock::Heading(level, text) => {
                ui.add_space(if level == 1 { 10.0 } else { 6.0 });
                markdown_inline(ui, &text, serif(if level <= 2 { 20.0 } else { 17.0 }), INK);
            }
            MarkdownBlock::Paragraph(text) => {
                markdown_inline(ui, &text, serif(14.5), DIM);
                ui.add_space(15.0);
            }
            MarkdownBlock::List(ordered, items) => {
                for (index, item) in items.into_iter().enumerate() {
                    ui.horizontal_top(|ui| {
                        ui.add_sized(
                            Vec2::new(28.0, 0.0),
                            egui::Label::new(
                                RichText::new(if ordered {
                                    format!("{}.", index + 1)
                                } else {
                                    "•".to_owned()
                                })
                                .font(serif(14.5))
                                .color(FAINT),
                            ),
                        );
                        markdown_inline(ui, &item, serif(14.5), DIM);
                    });
                }
                ui.add_space(15.0);
            }
            MarkdownBlock::Quote(text) => {
                ui.horizontal_top(|ui| {
                    let (rect, _) =
                        ui.allocate_exact_size(Vec2::new(2.0, 30.0), egui::Sense::hover());
                    ui.painter().rect_filled(rect, 1.0, GOLD_DIM);
                    markdown_inline(ui, &text, serif(14.5), FAINT);
                });
                ui.add_space(15.0);
            }
            MarkdownBlock::Code(text) => {
                egui::Frame::none()
                    .fill(BG1)
                    .stroke(Stroke::new(1.0, LINE))
                    .rounding(8.0)
                    .inner_margin(egui::Margin::symmetric(15.0, 12.0))
                    .show(ui, |ui| {
                        ui.add(
                            egui::Label::new(
                                RichText::new(text).font(FontId::monospace(12.5)).color(DIM),
                            )
                            .wrap(),
                        );
                    });
                ui.add_space(15.0);
            }
            MarkdownBlock::Table { has_header, rows } => {
                markdown_table(ui, has_header, &rows);
                ui.add_space(16.0);
            }
            MarkdownBlock::Rule => {
                ui.add_space(15.0);
                ui.separator();
                ui.add_space(15.0);
            }
        }
    }
}

fn markdown_inline(ui: &mut egui::Ui, source: &str, font: FontId, color: Color32) {
    let old_spacing = ui.spacing().item_spacing;
    ui.spacing_mut().item_spacing.y = 0.0;
    for line in source.split('\n') {
        ui.horizontal_wrapped(|ui| {
            ui.spacing_mut().item_spacing.x = 0.0;
            for span in markdown_spans(line) {
                let mut text = RichText::new(span.text).font(font.clone()).color(color);
                match span.style {
                    MarkdownStyle::Plain => {}
                    MarkdownStyle::Strong => text = text.strong().color(INK),
                    MarkdownStyle::Emphasis => text = text.italics(),
                    MarkdownStyle::Code => {
                        text = text.monospace().size(font.size * 0.9).background_color(BG2);
                    }
                }
                if let Some(url) = span.link {
                    ui.hyperlink_to(text.color(GOLD).underline(), url);
                } else {
                    ui.add(egui::Label::new(text).wrap());
                }
            }
        });
    }
    ui.spacing_mut().item_spacing = old_spacing;
}

fn markdown_table(ui: &mut egui::Ui, has_header: bool, rows: &[Vec<String>]) {
    let columns = rows.iter().map(Vec::len).max().unwrap_or(0);
    if columns == 0 {
        return;
    }
    let cell_width = ((ui.available_width() - 1.0) / columns as f32).max(64.0);
    egui::Grid::new(ui.make_persistent_id("markdown-table"))
        .num_columns(columns)
        .spacing(Vec2::ZERO)
        .show(ui, |ui| {
            for (row_index, row) in rows.iter().enumerate() {
                for column in 0..columns {
                    let header = has_header && row_index == 0;
                    egui::Frame::none()
                        .fill(if header { BG1 } else { BG0 })
                        .stroke(Stroke::new(1.0, LINE))
                        .inner_margin(egui::Margin::symmetric(11.0, 7.0))
                        .show(ui, |ui| {
                            ui.set_width(cell_width - 22.0);
                            markdown_inline(
                                ui,
                                row.get(column).map(String::as_str).unwrap_or(""),
                                serif(13.0),
                                if header { INK } else { DIM },
                            );
                        });
                }
                ui.end_row();
            }
        });
}

pub struct Pill<'a> {
    pub id: &'a str,
    pub title: &'a str,
    pub width: f32,
    pub height: f32,
    pub active: bool,
    pub ghost: bool,
    pub user_icon: bool,
}

impl<'a> Pill<'a> {
    pub fn new(id: &'a str, title: &'a str, width: f32) -> Self {
        Self {
            id,
            title,
            width,
            height: 36.0,
            active: false,
            ghost: false,
            user_icon: false,
        }
    }

    pub fn show(self, ui: &mut egui::Ui, content: impl FnOnce(&mut egui::Ui)) {
        let popup_id = ui.make_persistent_id(self.id);
        let open = ui.memory(|memory| memory.is_popup_open(popup_id));
        let (rect, response) =
            ui.allocate_exact_size(Vec2::new(self.width, self.height), egui::Sense::click());
        let response = response.on_hover_cursor(egui::CursorIcon::PointingHand);
        let intent = response.hovered() || open;
        let sort_intent = self.ghost && intent;
        let color = if self.active || sort_intent {
            ACCENT_HI
        } else if intent {
            INK
        } else {
            DIM
        };
        let border = if sort_intent {
            // The Web sort select becomes an orange outlined control on hover.
            ACCENT
        } else if intent {
            Color32::from_rgb(74, 65, 50)
        } else if self.active {
            ACCENT.gamma_multiply(0.6)
        } else if self.ghost {
            Color32::TRANSPARENT
        } else {
            LINE
        };
        ui.painter().rect(
            rect,
            self.height / 2.0,
            if self.ghost {
                Color32::TRANSPARENT
            } else {
                BG1
            },
            Stroke::new(1.0, border),
        );
        let label_rect = Rect::from_min_max(
            rect.min + Vec2::new(if self.user_icon { 28.0 } else { 10.0 }, 0.0),
            rect.max - Vec2::new(23.0, 0.0),
        );
        paint_text(
            ui,
            self.title,
            label_rect,
            FontId::proportional(if self.height < 32.0 { 11.5 } else { 12.5 }),
            color,
            true,
        );
        if self.user_icon {
            paint_icon(
                ui.painter(),
                Rect::from_center_size(
                    Pos2::new(rect.left() + 16.0, rect.center().y),
                    Vec2::splat(15.0),
                ),
                Icon::User,
                color,
            );
        }
        let center = Pos2::new(rect.right() - 13.0, rect.center().y);
        ui.painter().add(egui::Shape::line(
            vec![
                center + Vec2::new(-3.0, -1.5),
                center + Vec2::new(0.0, 1.5),
                center + Vec2::new(3.0, -1.5),
            ],
            Stroke::new(1.2, if sort_intent { ACCENT_HI } else { FAINT }),
        ));
        if response.clicked() {
            ui.memory_mut(|memory| memory.toggle_popup(popup_id));
        }
        egui::popup::popup_below_widget(
            ui,
            popup_id,
            &response,
            egui::popup::PopupCloseBehavior::CloseOnClick,
            |ui| {
                // The popup frame adds its horizontal window margin outside this inner UI.
                // Subtract it so the visible popup edge aligns with the trigger pill.
                let popup_margin =
                    ui.style().spacing.window_margin.left + ui.style().spacing.window_margin.right;
                let popup_width = (self.width - popup_margin).max(1.0);
                ui.set_min_width(popup_width);
                ui.set_width(popup_width);
                ui.style_mut().spacing.item_spacing = Vec2::new(4.0, 4.0);
                let item_padding = if self.width < 100.0 { 4.0 } else { 12.0 };
                ui.style_mut().spacing.button_padding = Vec2::new(item_padding, 8.0);
                ui.style_mut().visuals.window_fill = BG1;
                ui.style_mut().visuals.window_stroke = Stroke::new(1.0, LINE);
                ui.style_mut().visuals.window_rounding = egui::Rounding::same(14.0);
                ui.style_mut().visuals.widgets.inactive.bg_fill = Color32::TRANSPARENT;
                ui.style_mut().visuals.widgets.inactive.weak_bg_fill = Color32::TRANSPARENT;
                ui.style_mut().visuals.widgets.inactive.bg_stroke = Stroke::NONE;
                ui.style_mut().visuals.widgets.inactive.fg_stroke.color = DIM;
                ui.style_mut().visuals.widgets.hovered.bg_fill = BG3;
                ui.style_mut().visuals.widgets.hovered.weak_bg_fill = BG3;
                ui.style_mut().visuals.widgets.hovered.bg_stroke =
                    Stroke::new(1.0, Color32::from_rgb(84, 66, 45));
                ui.style_mut().visuals.widgets.hovered.fg_stroke.color = INK;
                ui.style_mut().visuals.widgets.active.bg_fill = ACCENT;
                ui.style_mut().visuals.widgets.active.weak_bg_fill = ACCENT;
                ui.style_mut().visuals.widgets.active.bg_stroke = Stroke::NONE;
                ui.style_mut().visuals.widgets.active.fg_stroke.color = INK;
                ui.style_mut().visuals.selection.bg_fill = BG3;
                ui.style_mut().visuals.selection.stroke = Stroke::new(1.0, ACCENT_HI);
                egui::ScrollArea::vertical()
                    .max_height(360.0)
                    .show(ui, content);
            },
        );
    }
}

pub fn hover_progress(ctx: &egui::Context, id: egui::Id, hovered: bool, duration: f32) -> f32 {
    ctx.animate_bool_with_time_and_easing(id, hovered, duration, egui::emath::easing::linear)
}

pub fn css_ease(progress: f32, control: [f32; 4]) -> f32 {
    let cubic = |parameter: f32, first: f32, second: f32| {
        let inverse = 1.0 - parameter;
        3.0 * inverse * inverse * parameter * first
            + 3.0 * inverse * parameter * parameter * second
            + parameter.powi(3)
    };
    let mut lower = 0.0;
    let mut upper = 1.0;
    for _ in 0..14 {
        let middle = (lower + upper) / 2.0;
        if cubic(middle, control[0], control[2]) < progress {
            lower = middle;
        } else {
            upper = middle;
        }
    }
    cubic((lower + upper) / 2.0, control[1], control[3])
}

pub fn card_geometry(width: f32, viewport_width: f32) -> (usize, f32, f32) {
    let minimum = if viewport_width >= 1500.0 {
        190.0
    } else {
        180.0
    };
    let gap = (viewport_width * 0.0135).clamp(16.0, 22.0);
    let columns = ((width + gap) / (minimum + gap)).floor().max(1.0) as usize;
    (
        columns,
        (width - gap * (columns - 1) as f32) / columns as f32,
        gap,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_blocks_preserve_inline_markup_and_block_structure() {
        let blocks = markdown_blocks(
            "# Heading\n\nA **bold** [link](https://example.com).\n\n- First\n- Second\n\n> Quote",
        );
        assert_eq!(
            blocks,
            vec![
                MarkdownBlock::Heading(1, "Heading".into()),
                MarkdownBlock::Paragraph("A **bold** [link](https://example.com).".into()),
                MarkdownBlock::List(false, vec!["First".into(), "Second".into()]),
                MarkdownBlock::Quote("Quote".into()),
            ]
        );
    }

    #[test]
    fn markdown_blocks_keep_fenced_code_as_a_single_block() {
        let blocks = markdown_blocks("```text\n# not a heading\nline 2\n```");
        assert_eq!(
            blocks,
            vec![MarkdownBlock::Code("# not a heading\nline 2".into())]
        );
    }

    #[test]
    fn markdown_ordered_lists_respect_unicode_separator_boundaries() {
        assert_eq!(
            markdown_blocks("1、中文\n12、🎵 Sushi\n3、\n4. English\n5) 日本語"),
            vec![MarkdownBlock::List(
                true,
                vec![
                    "中文".into(),
                    "🎵 Sushi".into(),
                    "".into(),
                    "English".into(),
                    "日本語".into()
                ],
            )]
        );
        assert_eq!(
            markdown_blocks("１、全角\n汉、普通段落"),
            vec![MarkdownBlock::Paragraph("１、全角\n汉、普通段落".into())]
        );
    }

    #[test]
    fn markdown_incomplete_table_rows_remain_safe_and_preserve_text() {
        assert_eq!(
            markdown_blocks("|\n \t| \t\n\n| incomplete\n中文|"),
            vec![
                MarkdownBlock::Paragraph("|\n|".into()),
                MarkdownBlock::Paragraph("| incomplete\n中文|".into()),
            ]
        );
        assert_eq!(
            markdown_blocks("||\n|中文|\n|---|\n| A | B |"),
            vec![MarkdownBlock::Table {
                has_header: true,
                rows: vec![
                    vec!["".into()],
                    vec!["中文".into()],
                    vec!["A".into(), "B".into()]
                ],
            }]
        );
    }

    #[test]
    fn markdown_inline_styles_and_links_are_preserved_safely() {
        assert_eq!(
            markdown_spans("plain **bold** *italic* `code` [site](https://example.com)"),
            vec![
                MarkdownSpan {
                    text: "plain ".into(),
                    style: MarkdownStyle::Plain,
                    link: None,
                },
                MarkdownSpan {
                    text: "bold".into(),
                    style: MarkdownStyle::Strong,
                    link: None,
                },
                MarkdownSpan {
                    text: " ".into(),
                    style: MarkdownStyle::Plain,
                    link: None,
                },
                MarkdownSpan {
                    text: "italic".into(),
                    style: MarkdownStyle::Emphasis,
                    link: None,
                },
                MarkdownSpan {
                    text: " ".into(),
                    style: MarkdownStyle::Plain,
                    link: None,
                },
                MarkdownSpan {
                    text: "code".into(),
                    style: MarkdownStyle::Code,
                    link: None,
                },
                MarkdownSpan {
                    text: " ".into(),
                    style: MarkdownStyle::Plain,
                    link: None,
                },
                MarkdownSpan {
                    text: "site".into(),
                    style: MarkdownStyle::Plain,
                    link: Some("https://example.com".into()),
                },
            ]
        );
        assert_eq!(
            markdown_spans("[unsafe](javascript:alert(1))"),
            vec![MarkdownSpan {
                text: "[unsafe](javascript:alert(1))".into(),
                style: MarkdownStyle::Plain,
                link: None,
            }]
        );
    }

    #[test]
    fn markdown_blocks_parse_tables_and_keep_inline_markup_for_rendering() {
        assert_eq!(
            markdown_blocks("| **Name** | Note |\n|:---|---:|\n| A | *first* |\n| B | second |"),
            vec![MarkdownBlock::Table {
                has_header: true,
                rows: vec![
                    vec!["**Name**".into(), "Note".into()],
                    vec!["A".into(), "*first*".into()],
                    vec!["B".into(), "second".into()],
                ],
            }]
        );
    }

    fn link_frame(
        ctx: &egui::Context,
        text: &str,
        bounds: Rect,
        clip: Rect,
        centered: bool,
        events: Vec<egui::Event>,
    ) -> (Response, Response, egui::FullOutput) {
        let mut responses = None;
        let output = ctx.run(
            egui::RawInput {
                screen_rect: Some(Rect::from_min_size(Pos2::ZERO, Vec2::new(800.0, 600.0))),
                events,
                ..Default::default()
            },
            |ctx| {
                egui::CentralPanel::default()
                    .frame(egui::Frame::none())
                    .show(ctx, |ui| {
                        ui.set_clip_rect(clip);
                        let row = ui.interact(
                            Rect::from_min_size(Pos2::new(20.0, 20.0), Vec2::new(720.0, 80.0)),
                            egui::Id::new("test-track-row"),
                            egui::Sense::click(),
                        );
                        let artist = text_link(
                            ui,
                            text,
                            bounds,
                            FontId::proportional(14.0),
                            FAINT,
                            egui::Id::new("test-artist"),
                            centered,
                        );
                        responses = Some((artist, row));
                    });
            },
        );
        let (artist, row) = responses.unwrap();
        (artist, row, output)
    }

    fn artist_bounds() -> Rect {
        Rect::from_min_size(Pos2::new(40.0, 40.0), Vec2::new(660.0, 24.0))
    }

    fn link_clip() -> Rect {
        Rect::from_min_size(Pos2::ZERO, Vec2::new(800.0, 600.0))
    }

    fn link_text_shape<'a>(
        output: &'a egui::FullOutput,
        text: &str,
    ) -> &'a egui::epaint::TextShape {
        output
            .shapes
            .iter()
            .find_map(|shape| match &shape.shape {
                egui::Shape::Text(shape) if shape.galley.job.text == text => Some(shape),
                _ => None,
            })
            .expect("the artist text must remain painted")
    }

    fn credit_frame(
        ctx: &egui::Context,
        artists: &[crate::api::ArtistCredit],
        fallback: &str,
        bounds: Rect,
        events: Vec<egui::Event>,
    ) -> (Option<String>, egui::FullOutput) {
        let mut clicked = None;
        let output = ctx.run(
            egui::RawInput {
                screen_rect: Some(link_clip()),
                events,
                ..Default::default()
            },
            |ctx| {
                egui::CentralPanel::default()
                    .frame(egui::Frame::none())
                    .show(ctx, |ui| {
                        clicked = artist_credit_links(
                            ui,
                            artists,
                            fallback,
                            bounds,
                            FontId::proportional(14.0),
                            DIM,
                            egui::Id::new("test-artist-credits"),
                        )
                        .map(str::to_owned);
                    });
            },
        );
        (clicked, output)
    }

    fn credit_names() -> Vec<crate::api::ArtistCredit> {
        ["GROOVE UNCHANT", "pecombo"]
            .into_iter()
            .map(|name| crate::api::ArtistCredit {
                name: name.into(),
                sort: String::new(),
            })
            .collect()
    }

    fn credit_text_color(output: &egui::FullOutput, text: &str) -> Color32 {
        let shape = link_text_shape(output, text);
        shape
            .override_text_color
            .unwrap_or(shape.galley.job.sections[0].format.color)
    }

    #[test]
    fn artist_credit_hover_highlights_only_the_pointed_name() {
        let ctx = egui::Context::default();
        let artists = credit_names();
        let (_, initial) = credit_frame(&ctx, &artists, "", artist_bounds(), vec![]);
        for hovered in ["GROOVE UNCHANT", "pecombo", " × "] {
            let shape = link_text_shape(&initial, hovered);
            let point = shape.pos + shape.galley.size() / 2.0;
            let (_, output) = credit_frame(
                &ctx,
                &artists,
                "",
                artist_bounds(),
                vec![egui::Event::PointerMoved(point)],
            );
            for artist in &artists {
                assert_eq!(
                    credit_text_color(&output, &artist.name),
                    if artist.name == hovered { GOLD } else { DIM }
                );
            }
            assert_eq!(credit_text_color(&output, " × "), FAINT);
            assert_eq!(
                output.platform_output.cursor_icon,
                if hovered == " × " {
                    egui::CursorIcon::Default
                } else {
                    egui::CursorIcon::PointingHand
                }
            );
        }
    }

    #[test]
    fn artist_credit_clicks_open_the_selected_artist_but_not_the_separator() {
        let ctx = egui::Context::default();
        let artists = credit_names();
        let (_, initial) = credit_frame(&ctx, &artists, "", artist_bounds(), vec![]);
        for (text, expected) in [("pecombo", Some("pecombo")), (" × ", None)] {
            let shape = link_text_shape(&initial, text);
            let point = shape.pos + shape.galley.size() / 2.0;
            let mut clicked = None;
            for pressed in [true, false] {
                let (result, _) = credit_frame(
                    &ctx,
                    &artists,
                    "",
                    artist_bounds(),
                    vec![
                        egui::Event::PointerMoved(point),
                        egui::Event::PointerButton {
                            pos: point,
                            button: egui::PointerButton::Primary,
                            pressed,
                            modifiers: egui::Modifiers::NONE,
                        },
                    ],
                );
                clicked = result;
            }
            assert_eq!(clicked.as_deref(), expected);
        }
    }

    #[test]
    fn three_artist_credits_use_noninteractive_comma_separators() {
        let ctx = egui::Context::default();
        let artists: Vec<_> = ["First Artist", "Second Artist", "Third Artist"]
            .into_iter()
            .map(|name| crate::api::ArtistCredit {
                name: name.into(),
                sort: String::new(),
            })
            .collect();
        let (_, initial) = credit_frame(&ctx, &artists, "", artist_bounds(), vec![]);
        let separators: Vec<_> = initial
            .shapes
            .iter()
            .filter_map(|shape| match &shape.shape {
                egui::Shape::Text(shape) if shape.galley.job.text == ", " => {
                    Some(shape.pos + shape.galley.size() / 2.0)
                }
                _ => None,
            })
            .collect();
        assert_eq!(separators.len(), 2);
        assert!(!initial.shapes.iter().any(|shape| {
            matches!(&shape.shape, egui::Shape::Text(shape) if shape.galley.job.text == " × ")
        }));
        for point in separators {
            let (_, output) = credit_frame(
                &ctx,
                &artists,
                "",
                artist_bounds(),
                vec![egui::Event::PointerMoved(point)],
            );
            assert_eq!(
                output.platform_output.cursor_icon,
                egui::CursorIcon::Default
            );
            for artist in &artists {
                assert_eq!(credit_text_color(&output, &artist.name), DIM);
            }
            for shape in &output.shapes {
                if let egui::Shape::Text(shape) = &shape.shape {
                    if shape.galley.job.text == ", " {
                        assert_eq!(
                            shape
                                .override_text_color
                                .unwrap_or(shape.galley.job.sections[0].format.color),
                            FAINT
                        );
                    }
                }
            }
            for pressed in [true, false] {
                let (clicked, _) = credit_frame(
                    &ctx,
                    &artists,
                    "",
                    artist_bounds(),
                    vec![
                        egui::Event::PointerMoved(point),
                        egui::Event::PointerButton {
                            pos: point,
                            button: egui::PointerButton::Primary,
                            pressed,
                            modifiers: egui::Modifiers::NONE,
                        },
                    ],
                );
                assert!(clicked.is_none());
            }
        }
    }

    #[test]
    fn unstructured_artist_fallback_preserves_symbols_and_stays_on_one_line() {
        let ctx = egui::Context::default();
        let bounds = Rect::from_min_size(Pos2::new(40.0, 40.0), Vec2::new(120.0, 24.0));
        for fallback in [
            "X-Ray Spex",
            "Xiu Xiu × A, B",
            "An artist with × and, punctuation",
        ] {
            let (_, output) = credit_frame(&ctx, &[], fallback, bounds, vec![]);
            let shape = link_text_shape(&output, fallback);
            assert_eq!(shape.galley.rows.len(), 1);
            assert!(shape.galley.size().x <= bounds.width() + 0.01);
            assert!((shape.pos.y + shape.galley.size().y / 2.0 - bounds.center().y).abs() < 0.01);
            assert_eq!(
                output
                    .shapes
                    .iter()
                    .filter(|shape| matches!(shape.shape, egui::Shape::Text(_)))
                    .count(),
                1
            );
        }
    }

    fn click_artist_row(ctx: &egui::Context, point: Pos2, text: &str) -> (Response, Response) {
        let mut result = None;
        for pressed in [true, false] {
            let (artist, row, _) = link_frame(
                ctx,
                text,
                artist_bounds(),
                link_clip(),
                false,
                vec![
                    egui::Event::PointerMoved(point),
                    egui::Event::PointerButton {
                        pos: point,
                        button: egui::PointerButton::Primary,
                        pressed,
                        modifiers: egui::Modifiers::NONE,
                    },
                ],
            );
            result = Some((artist, row));
        }
        result.unwrap()
    }

    #[test]
    fn artist_hover_is_limited_to_visible_text() {
        let ctx = egui::Context::default();
        let name = "Pizzicato Five";
        let (artist, _, _) = link_frame(&ctx, name, artist_bounds(), link_clip(), false, vec![]);
        assert!(artist.rect.width() < artist_bounds().width() / 2.0);
        let point = artist.rect.center();
        let (artist, _, output) = link_frame(
            &ctx,
            name,
            artist_bounds(),
            link_clip(),
            false,
            vec![egui::Event::PointerMoved(point)],
        );
        assert!(artist.hovered());
        assert_eq!(
            output.platform_output.cursor_icon,
            egui::CursorIcon::PointingHand
        );
        assert_eq!(
            link_text_shape(&output, name).override_text_color,
            Some(GOLD)
        );

        let (artist, _, output) = link_frame(
            &ctx,
            name,
            artist_bounds(),
            link_clip(),
            false,
            vec![egui::Event::PointerMoved(Pos2::new(600.0, point.y))],
        );
        assert!(!artist.hovered());
        assert_eq!(
            output.platform_output.cursor_icon,
            egui::CursorIcon::Default
        );
        assert_eq!(
            link_text_shape(&output, name).override_text_color,
            Some(FAINT)
        );
    }

    #[test]
    fn artist_link_does_not_steal_blank_row_clicks() {
        let ctx = egui::Context::default();
        let name = "Pizzicato Five";
        let (artist, _, _) = link_frame(&ctx, name, artist_bounds(), link_clip(), false, vec![]);
        let point = artist.rect.center();
        let (artist, row) = click_artist_row(&ctx, point, name);
        assert!(artist.clicked());
        assert!(!row.clicked());

        let (artist, row) = click_artist_row(&ctx, Pos2::new(600.0, point.y), name);
        assert!(!artist.clicked());
        assert!(row.clicked());
    }

    #[test]
    fn clipped_artist_links_keep_text_alignment_and_visible_hit_bounds() {
        let name = "A very long artist name that must be truncated within this narrow column";
        let bounds = Rect::from_min_size(Pos2::new(40.0, 40.0), Vec2::new(180.0, 24.0));
        let clip = Rect::from_min_max(Pos2::new(70.0, 0.0), Pos2::new(190.0, 600.0));
        for centered in [false, true] {
            let ctx = egui::Context::default();
            let (artist, _, output) = link_frame(&ctx, name, bounds, clip, centered, vec![]);
            assert!(clip.contains_rect(artist.rect));
            assert!(bounds.contains_rect(artist.rect));
            assert!(artist.rect.is_positive());
            let text = link_text_shape(&output, name);
            assert!(text.galley.size().x <= bounds.width() + 0.01);
            let aligned_x = if centered {
                bounds.center().x - text.galley.size().x / 2.0
            } else {
                bounds.left()
            };
            assert!((text.pos.x - aligned_x).abs() < 0.01);
            assert!((text.pos.y + text.galley.size().y / 2.0 - bounds.center().y).abs() < 0.01);
            let (artist, _, _) = link_frame(
                &ctx,
                name,
                bounds,
                clip,
                centered,
                vec![egui::Event::PointerMoved(Pos2::new(
                    205.0,
                    bounds.center().y,
                ))],
            );
            assert!(!artist.hovered());
        }

        let ctx = egui::Context::default();
        let (artist, _, _) = link_frame(&ctx, "Short", bounds, link_clip(), true, vec![]);
        assert!((artist.rect.center().x - bounds.center().x).abs() < 0.01);
    }

    #[test]
    fn empty_artist_names_never_become_links() {
        for name in ["", "   "] {
            let ctx = egui::Context::default();
            link_frame(&ctx, name, artist_bounds(), link_clip(), false, vec![]);
            let point = Pos2::new(40.0, artist_bounds().center().y);
            let (artist, _, output) = link_frame(
                &ctx,
                name,
                artist_bounds(),
                link_clip(),
                false,
                vec![egui::Event::PointerMoved(point)],
            );
            assert!(!artist.sense.click);
            assert_eq!(
                output.platform_output.cursor_icon,
                egui::CursorIcon::Default
            );
            let (artist, _) = click_artist_row(&ctx, point, name);
            assert!(!artist.clicked());
        }
    }

    #[test]
    fn cover_crop_preserves_proportions_and_centers_the_image() {
        for image in [
            Vec2::new(800.0, 400.0),
            Vec2::new(400.0, 800.0),
            Vec2::splat(400.0),
        ] {
            for bounds in [
                Vec2::splat(128.0),
                Vec2::splat(220.0),
                Vec2::new(320.0, 180.0),
            ] {
                let uv = cover_uv(image, bounds);
                assert_eq!(uv.center(), egui::pos2(0.5, 0.5));
                assert!(
                    Rect::from_min_max(egui::Pos2::ZERO, egui::pos2(1.0, 1.0)).contains_rect(uv)
                );
                assert!(uv.width() == 1.0 || uv.height() == 1.0);
                let cropped_aspect = image.x * uv.width() / (image.y * uv.height());
                assert!((cropped_aspect - bounds.x / bounds.y).abs() < 0.0001);
            }
        }
        assert_eq!(
            cover_uv(Vec2::new(800.0, 400.0), Vec2::splat(128.0)),
            Rect::from_min_max(egui::pos2(0.25, 0.0), egui::pos2(0.75, 1.0))
        );
    }

    #[test]
    fn responsive_wall_fits_without_horizontal_overflow() {
        for width in [480.0, 960.0, 1228.0, 1850.0, 2500.0, 3800.0] {
            let (columns, card, gap) = card_geometry(width, width + 68.0);
            assert!(card >= 180.0 || columns == 1);
            assert!((columns as f32 * card + (columns - 1) as f32 * gap - width).abs() < 0.01);
        }
        assert!((css_ease(0.0, [0.25, 0.1, 0.25, 1.0])).abs() < 0.001);
        assert!((css_ease(1.0, [0.25, 0.1, 0.25, 1.0]) - 1.0).abs() < 0.001);
    }
}
