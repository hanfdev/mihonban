use super::*;

pub(super) const TRACK_HEIGHT: f32 = 60.0;
pub(super) const TRACK_GAP: f32 = 4.0;
const LIST_TOP: f32 = 12.0;
const LIST_BOTTOM: f32 = 42.0;

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(super) enum TrackSort {
    #[default]
    Title,
    Artist,
    Album,
    YearNew,
    YearOld,
    Added,
}

impl TrackSort {
    const ALL: [Self; 6] = [
        Self::Title,
        Self::Artist,
        Self::Album,
        Self::YearNew,
        Self::YearOld,
        Self::Added,
    ];

    fn label(self) -> &'static str {
        match self {
            Self::Title => "tracks.sortTitle",
            Self::Artist => "tracks.sortArtist",
            Self::Album => "tracks.sortAlbum",
            Self::YearNew => "tracks.sortYearNew",
            Self::YearOld => "tracks.sortYearOld",
            Self::Added => "tracks.sortAdded",
        }
    }
}

struct TrackKeys {
    title: Vec<u8>,
    artist: Vec<u8>,
    album: Vec<u8>,
    artist_album: Vec<u8>,
    haystack: String,
}

#[derive(Default)]
pub(super) struct TrackCache {
    keys: Vec<TrackKeys>,
    sort: Option<TrackSort>,
    query: Option<String>,
    ordered: Vec<usize>,
    shown: Arc<[usize]>,
    revision: u64,
}

impl TrackCache {
    pub(super) fn replace(&mut self, tracks: &[Track]) {
        self.keys = tracks
            .iter()
            .map(|track| {
                let artist = if track.artist_sort.is_empty() {
                    &track.artist
                } else {
                    &track.artist_sort
                };
                TrackKeys {
                    title: collation_key(&track.title, true),
                    artist: collation_key(artist, false),
                    album: collation_key(&track.album_title, true),
                    artist_album: collation_key(&track.album_title, false),
                    haystack: format!(
                        "{} {} {} {}",
                        track.title,
                        track.artist,
                        track
                            .artists
                            .iter()
                            .map(|artist| artist.name.as_str())
                            .collect::<Vec<_>>()
                            .join(" "),
                        track.album_title
                    )
                    .to_lowercase(),
                }
            })
            .collect();
        self.sort = None;
        self.query = None;
        self.shown = Arc::default();
    }

    pub(super) fn shown(&mut self, tracks: &[Track], sort: TrackSort, query: &str) -> Arc<[usize]> {
        if self.keys.len() != tracks.len() {
            self.replace(tracks);
        }
        let query = query.trim().to_lowercase();
        let sort_changed = self.sort != Some(sort);
        if sort_changed {
            self.ordered = (0..tracks.len()).collect();
            // Stable sorting preserves the service order for equal years and dates.
            self.ordered.sort_by(|&left, &right| {
                let a = &tracks[left];
                let b = &tracks[right];
                let ka = &self.keys[left];
                let kb = &self.keys[right];
                match sort {
                    TrackSort::Title => ka.title.cmp(&kb.title),
                    TrackSort::Artist => ka
                        .artist
                        .cmp(&kb.artist)
                        .then_with(|| ka.artist_album.cmp(&kb.artist_album))
                        .then_with(|| a.track.unwrap_or(0).cmp(&b.track.unwrap_or(0))),
                    TrackSort::Album => ka
                        .album
                        .cmp(&kb.album)
                        .then_with(|| a.disc.max(1).cmp(&b.disc.max(1)))
                        .then_with(|| a.track.unwrap_or(0).cmp(&b.track.unwrap_or(0))),
                    TrackSort::YearNew => b.year.unwrap_or(0).cmp(&a.year.unwrap_or(0)),
                    TrackSort::YearOld => a.year.unwrap_or(9999).cmp(&b.year.unwrap_or(9999)),
                    TrackSort::Added => b.added_at.cmp(&a.added_at),
                }
            });
            self.sort = Some(sort);
        }
        if sort_changed || self.query.as_ref() != Some(&query) {
            self.shown = self
                .ordered
                .iter()
                .copied()
                .filter(|&index| query.is_empty() || self.keys[index].haystack.contains(&query))
                .collect::<Vec<_>>()
                .into();
            self.query = Some(query);
            self.revision = self.revision.wrapping_add(1);
        }
        Arc::clone(&self.shown)
    }
}

fn collation_key(text: &str, japanese: bool) -> Vec<u8> {
    use icu_collator::{options::CollatorOptions, Collator, CollatorBorrowed};
    use std::sync::OnceLock;
    static JAPANESE: OnceLock<CollatorBorrowed<'static>> = OnceLock::new();
    static DEFAULT: OnceLock<CollatorBorrowed<'static>> = OnceLock::new();
    let collator = if japanese {
        JAPANESE.get_or_init(|| {
            Collator::try_new(icu_locale::locale!("ja").into(), CollatorOptions::default())
                .expect("bundled Japanese collation")
        })
    } else {
        DEFAULT.get_or_init(|| {
            Collator::try_new(system_locale().into(), CollatorOptions::default())
                .expect("bundled default collation")
        })
    };
    let mut key = Vec::new();
    collator
        .write_sort_key_to(text, &mut key)
        .expect("writing a collation key into memory");
    key
}

fn system_locale() -> icu_locale::Locale {
    #[cfg(target_os = "windows")]
    {
        let mut locale = [0u16; 85];
        let size = unsafe {
            windows_sys::Win32::Globalization::GetUserDefaultLocaleName(
                locale.as_mut_ptr(),
                locale.len() as i32,
            )
        };
        if size > 1 {
            if let Ok(locale) = String::from_utf16_lossy(&locale[..size as usize - 1]).parse() {
                return locale;
            }
        }
    }
    icu_locale::locale!("en")
}

#[derive(Default)]
pub(super) struct TrackView {
    sort: TrackSort,
    shuffle: bool,
    player_shuffle: bool,
    revision: u64,
    scroll_offset: f32,
    pub(super) locate: Option<TrackLocate>,
    pub(super) flash: Option<(String, f64)>,
}

pub(super) struct TrackLocate {
    from: f32,
    to: f32,
    start: f64,
    track: String,
}

fn locate_offset(index: usize, count: usize, viewport_height: f32) -> f32 {
    let stride = TRACK_HEIGHT + TRACK_GAP;
    let total = LIST_TOP + count as f32 * stride + LIST_BOTTOM;
    (LIST_TOP + index as f32 * stride + TRACK_HEIGHT * 0.5 - viewport_height * 0.5)
        .clamp(0.0, (total - viewport_height).max(0.0))
}

pub(super) enum TrackSource<'a> {
    Direct(&'a [Track]),
    Indexed(&'a [Track], &'a [usize]),
}

impl TrackSource<'_> {
    pub(super) fn len(&self) -> usize {
        match self {
            Self::Direct(tracks) => tracks.len(),
            Self::Indexed(_, indices) => indices.len(),
        }
    }

    pub(super) fn get(&self, index: usize) -> &Track {
        match self {
            Self::Direct(tracks) => &tracks[index],
            Self::Indexed(tracks, indices) => &tracks[indices[index]],
        }
    }

    pub(super) fn queue(&self) -> Vec<Track> {
        (0..self.len())
            .map(|index| self.get(index).clone())
            .collect()
    }
}

fn centered_width(ui: &egui::Ui, max_width: f32, right_gutter: f32) -> Rect {
    let available = (ui.available_width() - right_gutter).max(1.0);
    let width = available.min(max_width);
    Rect::from_min_size(
        ui.cursor().min + Vec2::new((available - width) * 0.5, 0.0),
        Vec2::new(width, ui.available_height()),
    )
}

impl MihonbanApp {
    pub(super) fn tracks_page(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        let tracks = Arc::clone(&self.tracks);
        let now = ctx.input(|input| input.time);
        if self.track_view.player_shuffle != self.playback_order.shuffled {
            self.track_view.shuffle = self.playback_order.shuffled;
            self.track_view.player_shuffle = self.playback_order.shuffled;
        }
        let mut shown = self
            .track_cache
            .shown(&tracks, self.track_view.sort, &self.query);
        let current = self
            .current_track
            .as_ref()
            .and_then(|track| shown.iter().position(|&index| tracks[index].id == track.id));
        let toolbar = centered_width(ui, 1360.0, 32.0);
        let toolbar = Rect::from_min_size(toolbar.min, Vec2::new(toolbar.width(), 70.0));
        let inset = if toolbar.width() > 720.0 { 32.0 } else { 10.0 };
        ui.allocate_ui_at_rect(toolbar.shrink2(Vec2::new(inset, 12.0)), |ui| {
            ui.horizontal_centered(|ui| {
                ui.spacing_mut().item_spacing.x = 14.0;
                let play = track_control(
                    ui,
                    "tracks-play",
                    Icon::Play,
                    46.0,
                    true,
                    false,
                    !shown.is_empty(),
                )
                .on_hover_text(self.t(if self.track_view.shuffle {
                    "common.shuffleOn"
                } else {
                    "common.playAll"
                }));
                if play.clicked() && !shown.is_empty() {
                    self.playback_order.shuffled = self.track_view.shuffle;
                    self.track_view.player_shuffle = self.track_view.shuffle;
                    self.engine.set_shuffle(self.track_view.shuffle);
                    let index = if self.track_view.shuffle {
                        rand::Rng::gen_range(&mut rand::thread_rng(), 0..shown.len())
                    } else {
                        0
                    };
                    self.play_queue(
                        shown.iter().map(|&index| tracks[index].clone()).collect(),
                        index,
                    );
                }
                if track_control(
                    ui,
                    "tracks-shuffle",
                    Icon::Shuffle,
                    37.0,
                    false,
                    self.track_view.shuffle,
                    true,
                )
                .on_hover_text(self.t(if self.track_view.shuffle {
                    "common.shuffleOn"
                } else {
                    "common.shuffleOff"
                }))
                .clicked()
                {
                    self.track_view.shuffle = !self.track_view.shuffle;
                    self.track_view.player_shuffle = self.track_view.shuffle;
                    self.playback_order.shuffled = self.track_view.shuffle;
                    self.engine.set_shuffle(self.track_view.shuffle);
                }
                if let Some(index) = current {
                    if track_control(ui, "tracks-locate", Icon::Locate, 37.0, false, false, true)
                        .on_hover_text(self.t("common.locate"))
                        .clicked()
                    {
                        self.track_view.locate = Some(TrackLocate {
                            from: self.track_view.scroll_offset,
                            to: locate_offset(
                                index,
                                shown.len(),
                                (ui.max_rect().bottom() - toolbar.bottom()).max(1.0),
                            ),
                            start: now,
                            track: tracks[shown[index]].id.clone(),
                        });
                    }
                }
                ui.label(
                    RichText::new(self.tf("count.tracks", &[&shown.len().to_string()]))
                        .color(FAINT)
                        .size(13.0),
                );
                ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                    let mut pill =
                        Pill::new("tracks-sort", self.t(self.track_view.sort.label()), 142.0);
                    pill.ghost = true;
                    pill.show(ui, |ui| {
                        for sort in TrackSort::ALL {
                            if ui
                                .selectable_label(
                                    self.track_view.sort == sort,
                                    self.t(sort.label()),
                                )
                                .clicked()
                            {
                                self.track_view.sort = sort;
                                ui.close_menu();
                            }
                        }
                    });
                    if !self.query.trim().is_empty()
                        && clear_filters_button(ui, self.t("common.clearFilters"), 1)
                    {
                        self.query.clear();
                    }
                });
            });
        });
        ui.painter().line_segment(
            [toolbar.left_bottom(), toolbar.right_bottom()],
            Stroke::new(1.0, Color32::from_white_alpha(6)),
        );
        ui.advance_cursor_after_rect(toolbar);
        shown = self
            .track_cache
            .shown(&tracks, self.track_view.sort, &self.query);
        let mut forced_offset = None;
        if self.track_view.revision != self.track_cache.revision {
            self.track_view.revision = self.track_cache.revision;
            self.track_view.locate = None;
            self.track_view.flash = None;
            forced_offset = Some(0.0);
        }
        if let Some(offset) = self.scroll_to_top_offset(Page::Tracks, ctx) {
            forced_offset = Some(offset);
        }
        if ctx.input(|input| input.raw_scroll_delta != Vec2::ZERO) {
            self.track_view.locate = None;
        }
        if let Some(locate) = self.track_view.locate.as_mut() {
            if let Some(index) = shown
                .iter()
                .position(|&index| tracks[index].id == locate.track)
            {
                locate.to = locate_offset(index, shown.len(), ui.available_height());
            }
            let progress = ((now - locate.start) / 0.42).clamp(0.0, 1.0) as f32;
            let eased = 1.0 - (1.0 - progress).powi(3);
            forced_offset = Some(locate.from + (locate.to - locate.from) * eased);
            if progress >= 1.0 {
                self.track_view.flash = Some((locate.track.clone(), now));
                self.track_view.locate = None;
            }
            ctx.request_repaint();
        }
        if self
            .track_view
            .flash
            .as_ref()
            .is_some_and(|(_, start)| now - start > 1.7)
        {
            self.track_view.flash = None;
        }
        let mut scroll = egui::ScrollArea::vertical()
            .id_salt("tracks-page-scroll")
            .auto_shrink([false, false])
            .scroll_bar_rect(Rect::from_min_max(
                ui.max_rect().min,
                egui::pos2(ctx.screen_rect().right(), ui.max_rect().bottom()),
            ));
        if let Some(offset) = forced_offset {
            scroll = scroll.vertical_scroll_offset(offset);
        }
        let output = scroll.show(ui, |ui| {
            let content = centered_width(ui, 1040.0, 32.0);
            let inset = if content.width() > 720.0 { 32.0 } else { 10.0 };
            let content = content.shrink2(Vec2::new(inset, 0.0));
            ui.allocate_ui_at_rect(content, |ui| {
                ui.add_space(LIST_TOP);
                self.track_rows_from(ui, ctx, TrackSource::Indexed(&tracks, &shown), true);
                ui.add_space(LIST_BOTTOM);
            });
        });
        self.track_view.scroll_offset = output.state.offset.y;
        self.page_scroll_offsets
            .insert(Page::Tracks, output.state.offset.y);
    }
}

fn track_control(
    ui: &mut egui::Ui,
    id: &str,
    icon: Icon,
    size: f32,
    primary: bool,
    active: bool,
    enabled: bool,
) -> egui::Response {
    let (rect, _) = ui.allocate_exact_size(Vec2::splat(size), egui::Sense::hover());
    let mut response = ui.interact(
        rect,
        ui.id().with(id),
        if enabled {
            egui::Sense::click()
        } else {
            egui::Sense::hover()
        },
    );
    let hover = enabled && response.hovered();
    let scale = if response.is_pointer_button_down_on() {
        0.95
    } else if primary && hover {
        1.05
    } else {
        1.0
    };
    let bounds = Rect::from_center_size(rect.center(), rect.size() * scale);
    let opacity = if enabled { 1.0 } else { 0.45 };
    if primary {
        ui.painter().add(
            egui::epaint::Shadow {
                offset: Vec2::ZERO,
                blur: 18.0,
                spread: -7.0,
                color: ACCENT.gamma_multiply(0.42 * opacity),
            }
            .as_shape(bounds, size * 0.5),
        );
    }
    ui.painter().circle(
        bounds.center(),
        bounds.width() * 0.5,
        if primary {
            if hover {
                ACCENT_HI
            } else {
                ACCENT
            }
        } else {
            BG1
        }
        .gamma_multiply(opacity),
        if primary {
            Stroke::NONE
        } else {
            Stroke::new(
                1.0,
                if active {
                    ACCENT.gamma_multiply(0.6)
                } else if hover {
                    Color32::from_rgb(74, 65, 50)
                } else {
                    LINE
                },
            )
        },
    );
    paint_icon(
        ui.painter(),
        Rect::from_center_size(
            bounds.center(),
            Vec2::splat(if primary { 20.0 } else { 15.0 }) * scale,
        ),
        icon,
        (if primary {
            Color32::WHITE
        } else if active {
            ACCENT_HI
        } else if hover {
            INK
        } else {
            DIM
        })
        .gamma_multiply(opacity),
    );
    if response.has_focus() {
        ui.painter().circle_stroke(
            bounds.center(),
            bounds.width() * 0.5 + 3.0,
            Stroke::new(1.0, ACCENT_HI),
        );
    }
    if enabled {
        response = response.on_hover_cursor(egui::CursorIcon::PointingHand);
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    fn track(
        id: &str,
        title: &str,
        artist: &str,
        album: &str,
        year: Option<i32>,
        added: i64,
        disc: i32,
        number: i32,
    ) -> Track {
        serde_json::from_value(serde_json::json!({
            "id": id, "title": title, "artist": artist, "artistSort": artist,
            "albumTitle": album, "year": year, "addedAt": added,
            "disc": disc, "track": number
        }))
        .unwrap()
    }

    fn ids(cache: &mut TrackCache, tracks: &[Track], sort: TrackSort, query: &str) -> Vec<String> {
        cache
            .shown(tracks, sort, query)
            .iter()
            .map(|&index| tracks[index].id.clone())
            .collect()
    }

    #[test]
    fn all_six_web_sort_modes_use_track_metadata_and_stable_ties() {
        let tracks = vec![
            track("a", "Zulu", "B", "Alpha", Some(1999), 30, 2, 1),
            track("b", "Beta", "A", "Zulu", None, 10, 1, 1),
            track("c", "Alpha", "B", "Alpha", Some(2020), 20, 1, 2),
            track("d", "Delta", "B", "Alpha", Some(2020), 20, 1, 1),
        ];
        let mut cache = TrackCache::default();
        for (sort, expected) in [
            (TrackSort::Title, vec!["c", "b", "d", "a"]),
            (TrackSort::Artist, vec!["b", "a", "d", "c"]),
            (TrackSort::Album, vec!["d", "c", "a", "b"]),
            (TrackSort::YearNew, vec!["c", "d", "a", "b"]),
            (TrackSort::YearOld, vec!["a", "c", "d", "b"]),
            (TrackSort::Added, vec!["a", "c", "d", "b"]),
        ] {
            assert_eq!(ids(&mut cache, &tracks, sort, ""), expected);
        }
    }

    #[test]
    fn search_preserves_sort_order_and_steady_frames_reuse_results() {
        let mut tracks = vec![
            track("a", "Zulu", "Singer", "Album", None, 0, 1, 1),
            track("b", "Alpha", "Singer", "Album", None, 0, 1, 2),
        ];
        tracks[1].artists = vec![crate::api::ArtistCredit {
            name: "Guest Singer".into(),
            sort: String::new(),
        }];
        let mut cache = TrackCache::default();
        assert_eq!(
            ids(&mut cache, &tracks, TrackSort::Title, " SINGER "),
            ["b", "a"]
        );
        let first = cache.shown(&tracks, TrackSort::Title, "singer");
        let next = cache.shown(&tracks, TrackSort::Title, "singer");
        assert!(Arc::ptr_eq(&first, &next));
        assert_eq!(ids(&mut cache, &tracks, TrackSort::Title, "guest"), ["b"]);
        assert!(cache.shown(&tracks, TrackSort::Title, "missing").is_empty());
        assert_eq!(ids(&mut cache, &tracks, TrackSort::Title, ""), ["b", "a"]);
        tracks[0].title = "Aardvark".into();
        cache.replace(&tracks);
        assert_eq!(ids(&mut cache, &tracks, TrackSort::Title, ""), ["a", "b"]);
    }

    #[test]
    fn queue_uses_the_displayed_order_and_artist_sort_uses_explicit_credit() {
        let mut tracks = vec![
            track("a", "A", "The Band", "Album", None, 0, 1, 1),
            track("b", "B", "Cat", "Album", None, 0, 1, 2),
        ];
        tracks[0].artist_sort = "Band, The".into();
        let mut cache = TrackCache::default();
        assert_eq!(ids(&mut cache, &tracks, TrackSort::Artist, ""), ["a", "b"]);
        let shown = [1, 0];
        let queue = TrackSource::Indexed(&tracks, &shown).queue();
        assert_eq!(
            queue
                .iter()
                .map(|track| track.id.as_str())
                .collect::<Vec<_>>(),
            ["b", "a"]
        );
        assert!(TrackSource::Indexed(&tracks, &[]).queue().is_empty());
    }

    #[test]
    fn locate_centers_distant_rows_and_clamps_to_both_list_boundaries() {
        assert_eq!(locate_offset(0, 0, 800.0), 0.0);
        assert_eq!(locate_offset(0, 3, 800.0), 0.0);
        assert_eq!(locate_offset(0, 3621, 800.0), 0.0);
        let target = locate_offset(2400, 3621, 800.0);
        assert!((LIST_TOP + 2400.0 * 64.0 + 30.0 - target - 400.0).abs() < 0.01);
        let maximum = LIST_TOP + 3621.0 * 64.0 + LIST_BOTTOM - 800.0;
        assert_eq!(locate_offset(3620, 3621, 800.0), maximum);
        let view = visible_grid_rows(
            3621,
            TRACK_HEIGHT,
            TRACK_GAP,
            LIST_TOP,
            target,
            target + 800.0,
            2,
        );
        assert!(view.rows.contains(&2400));
        assert!(view.rows.len() < 20);
    }

    #[test]
    fn native_japanese_collation_sorts_accents_with_their_base_letters() {
        #[cfg(target_os = "windows")]
        assert!(collation_key("Ångström", true) < collation_key("Beta", true));
        assert!(collation_key("Alpha", true) < collation_key("Zulu", true));
    }
}
