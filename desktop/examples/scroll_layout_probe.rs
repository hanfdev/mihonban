//! Headless egui CPU layout probe, not an application FPS or GPU benchmark.

#[path = "../src/app/grid_viewport.rs"]
mod grid_viewport;

use eframe::egui::{self, Color32, FontId, Rect, Sense, Vec2};
use grid_viewport::visible_grid_rows;
use serde::Serialize;
use std::{hint::black_box, time::Instant};

#[derive(Clone, Copy)]
enum Mode {
    Full,
    Virtual,
}

#[derive(Default)]
struct FrameStats {
    cards_visited: usize,
    cards_painted: usize,
    content_height: f32,
    painted_ids: Vec<usize>,
}

#[derive(Serialize)]
struct Timing {
    median_us: f64,
    p95_us: f64,
    mean_us: f64,
    min_us: f64,
    mean_cards_visited: f64,
    mean_cards_painted: f64,
}

#[derive(Serialize)]
struct Comparison {
    albums: usize,
    viewport_logical_pixels: [f32; 2],
    full_layout: Timing,
    virtual_layout: Timing,
    median_cpu_layout_speedup: f64,
    layout_validation: LayoutValidation,
}

#[derive(Serialize)]
struct LayoutValidation {
    sampled_scroll_positions: usize,
    max_content_height_delta_pixels: f32,
    allowed_height_delta_pixels: f32,
    exact_visible_ids_at_all_positions: bool,
}

#[derive(Serialize)]
struct Report {
    description: &'static str,
    excludes: &'static str,
    warmup_frames_per_mode: usize,
    measured_frames_per_mode: usize,
    comparisons: Vec<Comparison>,
}

fn card_geometry(width: f32, viewport_width: f32) -> (usize, f32, f32) {
    // Keep this geometry in sync with the native album grid in src/ui.rs.
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

fn card(ui: &mut egui::Ui, id: usize, width: f32, stats: &mut FrameStats) {
    stats.cards_visited += 1;
    ui.push_id(id, |ui| {
        let (rect, response) =
            ui.allocate_exact_size(Vec2::new(width, width + 50.0), Sense::click());
        if !ui.is_rect_visible(rect.expand(8.0)) {
            return;
        }
        stats.cards_painted += 1;
        stats.painted_ids.push(id);
        let cover = Rect::from_min_size(rect.min, Vec2::splat(width));
        ui.painter()
            .rect_filled(cover, 12.0, Color32::from_rgb(42, 38, 34));
        ui.painter().text(
            cover.left_bottom() + Vec2::new(0.0, 11.0),
            egui::Align2::LEFT_TOP,
            "A representative album title",
            FontId::proportional(15.0),
            Color32::from_rgb(230, 218, 202),
        );
        ui.painter().text(
            cover.left_bottom() + Vec2::new(0.0, 34.0),
            egui::Align2::LEFT_TOP,
            "Artist name · 2026",
            FontId::proportional(12.25),
            Color32::from_rgb(145, 132, 117),
        );
        let _ = black_box(response);
    });
}

fn frame(
    ctx: &egui::Context,
    mode: Mode,
    albums: usize,
    viewport: Vec2,
    frame_index: usize,
    scroll_offset: f32,
) -> FrameStats {
    let mut stats = FrameStats::default();
    let output = ctx.run(
        egui::RawInput {
            screen_rect: Some(Rect::from_min_size(egui::Pos2::ZERO, viewport)),
            time: Some(frame_index as f64 / 60.0),
            ..Default::default()
        },
        |ctx| {
            egui::CentralPanel::default().show(ctx, |ui| {
                let scroll = egui::ScrollArea::vertical()
                    .id_salt("album-layout-probe")
                    .auto_shrink([false, false])
                    .vertical_scroll_offset(scroll_offset)
                    .show(ui, |ui| {
                        ui.allocate_exact_size(
                            Vec2::new(ui.available_width(), 220.0),
                            Sense::hover(),
                        );
                        let (columns, width, gap) = card_geometry(ui.available_width(), viewport.x);
                        let row_gap = (viewport.x * 0.025).clamp(30.0, 40.0);
                        let rows = albums.div_ceil(columns);
                        ui.scope(|ui| {
                            ui.spacing_mut().item_spacing = Vec2::new(gap, 0.0);
                            let range = match mode {
                                Mode::Full => 0..rows,
                                Mode::Virtual => {
                                    let clip = ui.clip_rect();
                                    let window = visible_grid_rows(
                                        rows,
                                        width + 50.0,
                                        row_gap,
                                        ui.cursor().top(),
                                        clip.top() - 8.0,
                                        clip.bottom() + 8.0,
                                        1,
                                    );
                                    ui.add_space(window.before);
                                    ui.skip_ahead_auto_ids(window.rows.start);
                                    window.rows
                                }
                            };
                            let end = range.end;
                            for row in range {
                                ui.horizontal_top(|ui| {
                                    for id in row * columns..((row + 1) * columns).min(albums) {
                                        card(ui, id, width, &mut stats);
                                    }
                                });
                                ui.add_space(row_gap);
                            }
                            if matches!(mode, Mode::Virtual) {
                                ui.skip_ahead_auto_ids(rows - end);
                                ui.add_space((rows - end) as f32 * (width + 50.0 + row_gap));
                            }
                        });
                    });
                stats.content_height = scroll.content_size.y;
            });
        },
    );
    // The frame output includes CPU-side shape generation but no GPU submission.
    black_box(output);
    stats
}

fn measure(mode: Mode, albums: usize, viewport: Vec2, warmup: usize, frames: usize) -> Timing {
    let ctx = egui::Context::default();
    for i in 0..warmup {
        black_box(frame(
            &ctx,
            mode,
            albums,
            viewport,
            i,
            600.0 + (i % 60) as f32 * 12.0,
        ));
    }
    let mut samples = Vec::with_capacity(frames);
    let mut visits = 0usize;
    let mut paints = 0usize;
    for i in warmup..warmup + frames {
        let begin = Instant::now();
        let stats = frame(
            &ctx,
            mode,
            albums,
            viewport,
            i,
            600.0 + (i % 60) as f32 * 12.0,
        );
        samples.push(begin.elapsed().as_secs_f64() * 1_000_000.0);
        visits += stats.cards_visited;
        paints += stats.cards_painted;
        black_box(stats);
    }
    samples.sort_by(f64::total_cmp);
    Timing {
        median_us: samples[frames / 2],
        p95_us: samples[((frames - 1) as f64 * 0.95).ceil() as usize],
        mean_us: samples.iter().sum::<f64>() / frames as f64,
        min_us: samples[0],
        mean_cards_visited: visits as f64 / frames as f64,
        mean_cards_painted: paints as f64 / frames as f64,
    }
}

fn validate_layout(albums: usize, viewport: Vec2) -> LayoutValidation {
    let full_ctx = egui::Context::default();
    let virtual_ctx = egui::Context::default();
    let initial = frame(&full_ctx, Mode::Full, albums, viewport, 0, 0.0);
    let mut validation = LayoutValidation {
        sampled_scroll_positions: 0,
        max_content_height_delta_pixels: 0.0,
        allowed_height_delta_pixels: (initial.content_height * 0.00005).max(1.0),
        exact_visible_ids_at_all_positions: true,
    };
    let (columns, _, _) = card_geometry(viewport.x - 16.0, viewport.x);
    for (index, offset) in [
        0.0,
        600.0,
        initial.content_height * 0.5,
        (initial.content_height - viewport.y).max(0.0),
        initial.content_height,
    ]
    .into_iter()
    .enumerate()
    {
        let full = frame(&full_ctx, Mode::Full, albums, viewport, index + 1, offset);
        let virtualized = frame(
            &virtual_ctx,
            Mode::Virtual,
            albums,
            viewport,
            index + 1,
            offset,
        );
        let delta = (full.content_height - virtualized.content_height).abs();
        assert!(delta <= validation.allowed_height_delta_pixels,
            "content height mismatch: {albums} albums at {viewport:?}, offset {offset}: full {}, virtual {}, delta {delta}",
            full.content_height, virtualized.content_height);
        validation.sampled_scroll_positions += 1;
        validation.max_content_height_delta_pixels =
            validation.max_content_height_delta_pixels.max(delta);
        if full.painted_ids != virtualized.painted_ids {
            validation.exact_visible_ids_at_all_positions = false;
            let different = full
                .painted_ids
                .iter()
                .filter(|id| !virtualized.painted_ids.contains(id))
                .count()
                + virtualized
                    .painted_ids
                    .iter()
                    .filter(|id| !full.painted_ids.contains(id))
                    .count();
            assert!(
                different <= columns * 2,
                "more than one boundary row differs"
            );
            assert!(
                albums > 340,
                "small-library visible card IDs must match exactly"
            );
        }
        assert!(
            virtualized.cards_visited <= columns * ((viewport.y / 200.0).ceil() as usize + 5),
            "virtual layout work exceeded the viewport bound"
        );
    }
    validation
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let frames = std::env::args()
        .nth(1)
        .map(|value| value.parse::<usize>())
        .transpose()?
        .unwrap_or(180);
    if frames == 0 {
        return Err("measured frame count must be positive".into());
    }
    let warmup = 30;
    let mut comparisons = Vec::new();
    for viewport in [Vec2::new(1440.0, 900.0), Vec2::new(3840.0, 2160.0)] {
        for albums in [0, 1, 341] {
            black_box(validate_layout(albums, viewport));
        }
    }
    for albums in [340, 10_000] {
        for viewport in [Vec2::new(1440.0, 900.0), Vec2::new(3840.0, 2160.0)] {
            let layout_validation = validate_layout(albums, viewport);
            let full_layout = measure(Mode::Full, albums, viewport, warmup, frames);
            let virtual_layout = measure(Mode::Virtual, albums, viewport, warmup, frames);
            let speedup = full_layout.median_us / virtual_layout.median_us;
            comparisons.push(Comparison {
                albums,
                viewport_logical_pixels: [viewport.x, viewport.y],
                full_layout,
                virtual_layout,
                median_cpu_layout_speedup: speedup,
                layout_validation,
            });
        }
    }
    println!(
        "{}",
        serde_json::to_string_pretty(&Report {
            description: "Synthetic headless egui CPU layout and visible-card painting, not real client FPS",
            excludes: "GPU rendering, decoded artwork, network, audio playback, filtering, and actual wheel-event latency",
            warmup_frames_per_mode: warmup,
            measured_frames_per_mode: frames,
            comparisons,
        })?
    );
    Ok(())
}
