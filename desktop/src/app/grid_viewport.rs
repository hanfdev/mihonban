use std::ops::Range;

#[derive(Debug, PartialEq)]
pub(super) struct GridViewport {
    pub rows: Range<usize>,
    pub before: f32,
    pub after: f32,
    pub total_height: f32,
}

/// Preserves the existing grid's trailing row gap while skipping offscreen rows.
pub(super) fn visible_grid_rows(
    total_rows: usize,
    row_height: f32,
    row_gap: f32,
    grid_top: f32,
    clip_top: f32,
    clip_bottom: f32,
    overscan: usize,
) -> GridViewport {
    let stride = row_height + row_gap;
    let total_height = total_rows as f32 * stride;
    let empty = |at: usize| GridViewport {
        rows: at..at,
        before: at as f32 * stride,
        after: (total_rows - at) as f32 * stride,
        total_height,
    };
    if total_rows == 0 {
        return empty(0);
    }
    debug_assert!(stride.is_finite() && stride > 0.0);
    if clip_bottom <= grid_top || clip_bottom <= clip_top {
        return empty(0);
    }
    if clip_top >= grid_top + total_height {
        return empty(total_rows);
    }

    // A gap belongs to its preceding row, matching the original row allocation.
    let start = (((clip_top - grid_top).max(0.0) / stride).floor() as usize)
        .min(total_rows)
        .saturating_sub(overscan);
    let end = (((clip_bottom - grid_top).max(0.0) / stride).ceil() as usize)
        .saturating_add(overscan)
        .min(total_rows);

    GridViewport {
        rows: start..end,
        before: start as f32 * stride,
        after: (total_rows - end) as f32 * stride,
        total_height,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn assert_geometry(view: &GridViewport, stride: f32) {
        let occupied = view.before + view.rows.len() as f32 * stride + view.after;
        let tolerance = view.total_height.max(1.0) * f32::EPSILON * 2.0;
        assert!((occupied - view.total_height).abs() <= tolerance);
    }

    #[test]
    fn empty_grid_has_no_spacers_or_rows() {
        let view = visible_grid_rows(0, 100.0, 20.0, 200.0, 0.0, 800.0, 1);
        assert_eq!(view.rows, 0..0);
        assert_eq!(
            (view.before, view.after, view.total_height),
            (0.0, 0.0, 0.0)
        );
    }

    #[test]
    fn partial_rows_are_included_with_grid_offset() {
        let view = visible_grid_rows(10, 100.0, 20.0, 500.0, 560.0, 850.0, 0);
        assert_eq!(view.rows, 0..3);
        assert_eq!(
            (view.before, view.after, view.total_height),
            (0.0, 840.0, 1200.0)
        );
        assert_geometry(&view, 120.0);
    }

    #[test]
    fn exact_boundaries_do_not_add_an_extra_row() {
        let view = visible_grid_rows(10, 100.0, 20.0, 100.0, 340.0, 460.0, 0);
        assert_eq!(view.rows, 2..3);
        assert_eq!((view.before, view.after), (240.0, 840.0));
        assert_geometry(&view, 120.0);
    }

    #[test]
    fn overscan_is_clamped_at_both_ends() {
        let top = visible_grid_rows(10, 100.0, 20.0, 0.0, 0.0, 121.0, 1);
        assert_eq!(top.rows, 0..3);
        let bottom = visible_grid_rows(10, 100.0, 20.0, 0.0, 1080.0, 1200.0, 1);
        assert_eq!(bottom.rows, 8..10);
        assert_eq!(bottom.after, 0.0);
        assert_geometry(&top, 120.0);
        assert_geometry(&bottom, 120.0);
    }

    #[test]
    fn offscreen_grid_keeps_its_full_height_without_rendering() {
        let above = visible_grid_rows(10, 100.0, 20.0, 500.0, 0.0, 500.0, 1);
        assert_eq!(above.rows, 0..0);
        assert_eq!((above.before, above.after), (0.0, 1200.0));
        let below = visible_grid_rows(10, 100.0, 20.0, 500.0, 1700.0, 2000.0, 1);
        assert_eq!(below.rows, 10..10);
        assert_eq!((below.before, below.after), (1200.0, 0.0));
    }

    #[test]
    fn work_is_bounded_by_viewport_instead_of_library_size() {
        let small = visible_grid_rows(100, 100.0, 20.0, 0.0, 6000.0, 6600.0, 1);
        let large = visible_grid_rows(10_000, 100.0, 20.0, 0.0, 6000.0, 6600.0, 1);
        assert_eq!(small.rows, 49..56);
        assert_eq!(large.rows, small.rows);
        assert_eq!(large.rows.len(), 7);
        assert_geometry(&small, 120.0);
        assert_geometry(&large, 120.0);
    }

    #[test]
    fn extreme_overscan_does_not_overflow() {
        let view = visible_grid_rows(10, 100.0, 20.0, 0.0, 240.0, 360.0, usize::MAX);
        assert_eq!(view.rows, 0..10);
        assert_geometry(&view, 120.0);
    }

    #[test]
    fn arbitrary_viewports_never_skip_an_intersecting_row() {
        for total_rows in [1, 2, 10, 100, 10_000] {
            for stride in [100.0, 127.5, 293.25] {
                for offset in [-500.0, -1.0, 0.0, 30.25, 200.0, 5000.0, 2_932_499.0] {
                    let clip_top = 400.0 + offset;
                    let clip_bottom = clip_top + 701.25;
                    let view = visible_grid_rows(
                        total_rows,
                        stride - 20.0,
                        20.0,
                        400.0,
                        clip_top,
                        clip_bottom,
                        1,
                    );
                    assert!(view.rows.start <= view.rows.end);
                    assert!(view.rows.end <= total_rows);
                    assert!(view.rows.len() <= (701.25 / stride).ceil() as usize + 3);
                    assert_geometry(&view, stride);
                    for row in 0..total_rows {
                        let top = 400.0 + row as f32 * stride;
                        let bottom = top + stride - 20.0;
                        if top < clip_bottom && bottom > clip_top {
                            assert!(view.rows.contains(&row), "missing row {row}: {view:?}");
                        }
                    }
                }
            }
        }
    }
}
