use super::{credits, Album, Artist};
use std::{cmp::Ordering, collections::HashMap, sync::Arc};

#[derive(Clone, PartialEq)]
pub(super) struct ArtistFilters {
    pub query: String,
    pub genre: String,
    pub sort: usize,
}

pub(super) struct ArtistEntry {
    pub artist: Artist,
    pub count: usize,
    pub years: Vec<i32>,
    pub latest: i64,
    pub genres: Vec<String>,
    search: String,
    name_key: String,
}

impl ArtistEntry {
    fn new(artist: Artist) -> Self {
        let search = format!(
            "{} {} {}",
            artist.name,
            artist.sort,
            artist.aliases.join(" ")
        )
        .to_lowercase();
        let name_key = if artist.sort.is_empty() {
            &artist.name
        } else {
            &artist.sort
        }
        .to_lowercase();
        Self {
            artist,
            count: 0,
            years: Vec::new(),
            latest: 0,
            genres: Vec::new(),
            search,
            name_key,
        }
    }
}

pub(super) struct ArtistSnapshot {
    pub entries: Vec<ArtistEntry>,
    pub genres: Vec<String>,
}

impl ArtistSnapshot {
    fn build(albums: &[Album], artists: &[Artist]) -> Self {
        // Match the old linear find: duplicate metadata names use the first record.
        let mut metadata = HashMap::new();
        for artist in artists {
            metadata.entry(artist.name.as_str()).or_insert(artist);
        }
        let mut entries = HashMap::<String, ArtistEntry>::new();
        for album in albums {
            for name in credits(album) {
                let entry = entries.entry(name.clone()).or_insert_with(|| {
                    ArtistEntry::new(
                        metadata
                            .get(name.as_str())
                            .map(|artist| (**artist).clone())
                            .unwrap_or_else(|| Artist {
                                name,
                                ..Default::default()
                            }),
                    )
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
        // For track-only names, the first qualifying record wins, as before.
        for artist in artists {
            if artist.featured_track_count > 0 {
                entries
                    .entry(artist.name.clone())
                    .or_insert_with(|| ArtistEntry::new(artist.clone()));
            }
        }
        Self {
            entries: entries.into_values().collect(),
            genres: genre_options(albums),
        }
    }
}

/// Artist genre options come from primary genres only. Spellings that differ
/// only in ASCII case are one option, because the filter matches them
/// alike; like the Web client, the most frequent spelling labels the option
/// and a tie keeps the spelling seen first.
fn genre_options(albums: &[Album]) -> Vec<String> {
    let mut groups: Vec<Vec<(&str, usize)>> = Vec::new();
    let mut by_key = HashMap::<String, usize>::new();
    for genre in albums.iter().flat_map(|album| &album.genres) {
        let group = *by_key.entry(genre.to_ascii_lowercase()).or_insert_with(|| {
            groups.push(Vec::new());
            groups.len() - 1
        });
        let forms = &mut groups[group];
        match forms.iter_mut().find(|(form, _)| *form == genre.as_str()) {
            Some((_, count)) => *count += 1,
            None => forms.push((genre.as_str(), 1)),
        }
    }
    let mut options: Vec<String> = groups
        .iter()
        .map(|forms| {
            let mut best = forms[0];
            for &form in &forms[1..] {
                if form.1 > best.1 {
                    best = form;
                }
            }
            best.0.to_owned()
        })
        .collect();
    options.sort();
    options
}

fn compare(left: &ArtistEntry, right: &ArtistEntry, sort: usize) -> Ordering {
    let name = || left.name_key.cmp(&right.name_key);
    match sort {
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
}

#[derive(Default)]
pub(super) struct ArtistCache {
    snapshot: Option<Arc<ArtistSnapshot>>,
    filters: Option<ArtistFilters>,
    indices: Arc<[usize]>,
}

impl ArtistCache {
    /// Source replacements invalidate even when their lengths have not changed.
    pub(super) fn invalidate(&mut self) {
        self.snapshot = None;
        self.filters = None;
        self.indices = Arc::default();
    }

    /// Aggregation is lazy: loading a library need not build an unopened artist page.
    pub(super) fn snapshot(&mut self, albums: &[Album], artists: &[Artist]) -> Arc<ArtistSnapshot> {
        Arc::clone(
            self.snapshot
                .get_or_insert_with(|| Arc::new(ArtistSnapshot::build(albums, artists))),
        )
    }

    /// Keep only the latest selection; query history cannot grow the cache.
    pub(super) fn entries(
        &mut self,
        albums: &[Album],
        artists: &[Artist],
        filters: ArtistFilters,
    ) -> Arc<[usize]> {
        if self.filters.as_ref() == Some(&filters) {
            return Arc::clone(&self.indices);
        }
        let snapshot = self.snapshot(albums, artists);
        let query = filters.query.trim().to_lowercase();
        // Always start from the same base order, not the previous sorted selection.
        let mut indices: Vec<_> = snapshot
            .entries
            .iter()
            .enumerate()
            .filter_map(|(index, entry)| {
                ((query.is_empty() || entry.search.contains(&query))
                    && (filters.genre.is_empty()
                        || entry
                            .genres
                            .iter()
                            .any(|genre| genre.eq_ignore_ascii_case(&filters.genre))))
                .then_some(index)
            })
            .collect();
        indices.sort_by(|&left, &right| {
            compare(
                &snapshot.entries[left],
                &snapshot.entries[right],
                filters.sort,
            )
        });
        self.filters = Some(filters);
        self.indices = indices.into();
        Arc::clone(&self.indices)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{hint::black_box, time::Instant};

    #[derive(Clone)]
    struct LegacyEntry {
        artist: Artist,
        count: usize,
        years: Vec<i32>,
        latest: i64,
        genres: Vec<String>,
    }

    fn legacy_entry(artist: Artist) -> LegacyEntry {
        LegacyEntry {
            artist,
            count: 0,
            years: Vec::new(),
            latest: 0,
            genres: Vec::new(),
        }
    }

    // Retain the pre-cache algorithm independently as the regression and timing oracle.
    fn legacy_entries(
        albums: &[Album],
        artists: &[Artist],
        filters: &ArtistFilters,
    ) -> Vec<LegacyEntry> {
        let mut entries = HashMap::<String, LegacyEntry>::new();
        for album in albums {
            for name in credits(album) {
                let entry = entries.entry(name.clone()).or_insert_with(|| {
                    legacy_entry(
                        artists
                            .iter()
                            .find(|artist| artist.name == name)
                            .cloned()
                            .unwrap_or_else(|| Artist {
                                name,
                                ..Default::default()
                            }),
                    )
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
        for artist in artists {
            if artist.featured_track_count > 0 {
                entries
                    .entry(artist.name.clone())
                    .or_insert_with(|| legacy_entry(artist.clone()));
            }
        }
        let query = filters.query.trim().to_lowercase();
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
                    && (filters.genre.is_empty()
                        || entry
                            .genres
                            .iter()
                            .any(|genre| genre.eq_ignore_ascii_case(&filters.genre)))
            })
            .collect();
        entries.sort_by(|left, right| legacy_compare(left, right, filters.sort));
        entries
    }

    fn legacy_compare(left: &LegacyEntry, right: &LegacyEntry, sort: usize) -> Ordering {
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
        match sort {
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
    }

    fn album(
        id: &str,
        name: &str,
        names: &[&str],
        year: Option<i32>,
        updated: i64,
        genres: &[&str],
    ) -> Album {
        serde_json::from_value(serde_json::json!({
            "id": id, "title": id, "artist": name,
            "artists": names.iter().map(|name| serde_json::json!({"name": name, "sort": "ignored credit sort"})).collect::<Vec<_>>(),
            "year": year, "updatedAt": updated, "genres": genres, "secondaryGenres": ["Secondary only"]
        })).unwrap()
    }

    fn artist(name: &str, sort: &str, aliases: &[&str], featured: usize) -> Artist {
        Artist {
            name: name.into(),
            sort: sort.into(),
            aliases: aliases.iter().map(|s| (*s).into()).collect(),
            featured_track_count: featured,
            note: format!("note for {name}"),
            has_avatar: true,
        }
    }

    fn filters(query: &str, genre: &str, sort: usize) -> ArtistFilters {
        ArtistFilters {
            query: query.into(),
            genre: genre.into(),
            sort,
        }
    }

    fn fixture() -> (Vec<Album>, Vec<Artist>) {
        let albums = vec![
            album(
                "a",
                "Combined display",
                &["Alpha", "Beta", "Alpha"],
                Some(1999),
                -2,
                &["rock", "Jazz", "rock"],
            ),
            album("b", "Alpha", &[], Some(1970), 12, &["Rock"]),
            album("c", "Unknown & Band", &[], None, -3, &["Äther"]),
            album("d", "Tie A", &[], Some(2005), 5, &["Rock"]),
            album("e", "Tie B", &[], Some(2005), 5, &["Rock"]),
            album("f", "Count tie", &[], Some(2001), 100, &["Jazz"]),
            album("g", "Named only", &[], None, 0, &[]),
            album("h", "Tie C", &[], Some(2005), 1, &["Rock"]),
        ];
        let artists = vec![
            artist("Alpha", "Zed", &["First Alias", "Second"], 0),
            artist("Alpha", "Wrong duplicate", &["Do not match"], 99),
            artist("Beta", "Beta sort", &["ベータ"], 3),
            artist("Tie A", "SAME", &[], 2),
            artist("Tie B", "same", &[], 2),
            artist("Tie C", "Same", &[], 10),
            artist("Count tie", "Aardvark", &[], 1),
            artist("Track only", "Ignored zero", &[], 0),
            artist("Track only", "Track sort", &["Guest Alias"], 4),
            artist("Track only", "Ignored positive", &[], 9),
            artist("Not credited", "", &[], 0),
            artist("Named only", "", &["Alias"], 0),
        ];
        (albums, artists)
    }

    fn as_legacy(entry: &ArtistEntry) -> LegacyEntry {
        LegacyEntry {
            artist: entry.artist.clone(),
            count: entry.count,
            years: entry.years.clone(),
            latest: entry.latest,
            genres: entry.genres.clone(),
        }
    }

    fn assert_payload(actual: &ArtistEntry, expected: &LegacyEntry) {
        assert_eq!(actual.artist.name, expected.artist.name);
        assert_eq!(actual.artist.sort, expected.artist.sort);
        assert_eq!(actual.artist.aliases, expected.artist.aliases);
        assert_eq!(actual.artist.note, expected.artist.note);
        assert_eq!(actual.artist.has_avatar, expected.artist.has_avatar);
        assert_eq!(
            actual.artist.featured_track_count,
            expected.artist.featured_track_count
        );
        assert_eq!(actual.count, expected.count);
        assert_eq!(actual.years, expected.years);
        assert_eq!(actual.latest, expected.latest);
        assert_eq!(actual.genres, expected.genres);
    }

    #[test]
    fn all_filters_and_sorts_match_legacy_including_equal_comparator_groups() {
        let (albums, artists) = fixture();
        let mut cache = ArtistCache::default();
        let snapshot = cache.snapshot(&albums, &artists);
        for sort in [0, 1, 2, 99] {
            for query in [
                "",
                "  ALPHA  ",
                "zed first",
                "alias second",
                "named only  alias",
                "named only alias",
                "guest alias",
                "ベータ",
                "not credited",
                "do not match",
                "Unknown & Band",
            ] {
                for genre in [
                    "",
                    "rOcK",
                    "Jazz",
                    "Äther",
                    "äther",
                    "Secondary only",
                    "missing",
                ] {
                    let filter = filters(query, genre, sort);
                    let expected = legacy_entries(&albums, &artists, &filter);
                    let indices = cache.entries(&albums, &artists, filter);
                    assert_eq!(
                        indices.len(),
                        expected.len(),
                        "query={query}, genre={genre}, sort={sort}"
                    );
                    for &index in indices.iter() {
                        let actual = &snapshot.entries[index];
                        let old = expected
                            .iter()
                            .find(|old| old.artist.name == actual.artist.name)
                            .unwrap();
                        assert_payload(actual, old);
                    }
                    // Independent HashMaps may permute complete ties, but not comparator groups.
                    for (&index, old) in indices.iter().zip(&expected) {
                        assert_eq!(
                            legacy_compare(&as_legacy(&snapshot.entries[index]), old, sort),
                            Ordering::Equal
                        );
                    }
                }
            }
        }
    }

    #[test]
    fn aggregation_preserves_metadata_credits_years_and_primary_facets() {
        let (albums, artists) = fixture();
        let snapshot = ArtistSnapshot::build(&albums, &artists);
        let entry = |name| {
            snapshot
                .entries
                .iter()
                .find(|entry| entry.artist.name == name)
                .unwrap()
        };
        // "rock" and "Rock" are one option labelled by the more frequent
        // spelling; secondary genres never become options.
        assert_eq!(snapshot.genres, ["Jazz", "Rock", "Äther"]);
        assert_eq!(entry("Alpha").count, 3);
        assert_eq!(entry("Alpha").years, [1999, 1999, 1970]);
        assert_eq!(entry("Alpha").genres, ["rock", "Jazz", "Rock"]);
        assert_eq!(entry("Alpha").latest, 12);
        assert_eq!(entry("Alpha").artist.sort, "Zed");
        assert_eq!(entry("Alpha").artist.featured_track_count, 0);
        assert_eq!(entry("Beta").latest, 0);
        assert_eq!(entry("Track only").artist.sort, "Track sort");
        assert_eq!(entry("Track only").count, 0);
        assert_eq!(entry("Unknown & Band").artist.sort, "");
        assert!(entry("Unknown & Band").years.is_empty());
        assert!(!snapshot.entries.iter().any(|entry| matches!(
            entry.artist.name.as_str(),
            "Combined display" | "Not credited"
        )));
    }

    #[test]
    fn genre_options_merge_case_variants_and_still_filter_every_spelling() {
        let albums = vec![
            album("a", "One", &[], None, 0, &["Akishibu-kei", "Ambient"]),
            album("b", "Two", &[], None, 0, &["Akishibu-Kei"]),
            album("c", "Three", &[], None, 0, &["Akishibu-kei"]),
            album("d", "Four", &[], None, 0, &["ambient pop", "Ambient Pop"]),
        ];
        let mut cache = ArtistCache::default();
        let genres = cache.snapshot(&albums, &[]).genres.clone();
        // One option per case-folded genre; the most frequent spelling wins,
        // and a tie keeps the spelling seen first.
        assert_eq!(genres, ["Akishibu-kei", "Ambient", "ambient pop"]);
        for spelling in ["Akishibu-kei", "Akishibu-Kei", "AKISHIBU-KEI"] {
            let indices = cache.entries(&albums, &[], filters("", spelling, 1));
            assert_eq!(indices.len(), 3, "spelling {spelling}");
        }
    }

    #[test]
    fn comparator_matches_all_pairs_and_filters_restart_from_base_order() {
        let (albums, artists) = fixture();
        let mut cache = ArtistCache::default();
        let snapshot = cache.snapshot(&albums, &artists);
        for sort in [0, 1, 2, 99] {
            for left in &snapshot.entries {
                for right in &snapshot.entries {
                    assert_eq!(
                        compare(left, right, sort),
                        legacy_compare(&as_legacy(left), &as_legacy(right), sort)
                    );
                }
            }
        }
        let a = snapshot
            .entries
            .iter()
            .find(|entry| entry.artist.name == "Tie A")
            .unwrap();
        let b = snapshot
            .entries
            .iter()
            .find(|entry| entry.artist.name == "Tie B")
            .unwrap();
        for sort in [0, 1, 2] {
            assert_eq!(compare(a, b, sort), Ordering::Equal);
        }
        for sort in [2, 0, 1, 0, 2, 1] {
            let actual = cache.entries(&albums, &artists, filters("", "", sort));
            let mut expected: Vec<_> = (0..snapshot.entries.len()).collect();
            expected.sort_by(|&a, &b| {
                legacy_compare(
                    &as_legacy(&snapshot.entries[a]),
                    &as_legacy(&snapshot.entries[b]),
                    sort,
                )
            });
            assert_eq!(&*actual, &expected);
        }
    }

    #[test]
    fn invalidation_is_lazy_and_replaces_same_length_sources_and_late_metadata() {
        let mut albums = vec![album("one", "Alpha", &[], Some(1990), 1, &["Rock"])];
        let mut artists = Vec::new();
        let mut cache = ArtistCache::default();
        assert!(cache.snapshot.is_none());
        let first_snapshot = cache.snapshot(&albums, &artists);
        let first = cache.entries(&albums, &artists, filters("", "", 0));
        for _ in 0..20 {
            assert!(Arc::ptr_eq(
                &first_snapshot,
                &cache.snapshot(&albums, &artists)
            ));
            assert!(Arc::ptr_eq(
                &first,
                &cache.entries(&albums, &artists, filters("", "", 0))
            ));
        }
        // Connected replaces albums, even when the number of albums stays unchanged.
        albums[0] = album("two", "Beta", &[], Some(2000), 2, &["Jazz"]);
        cache.invalidate();
        assert!(cache.snapshot.is_none());
        let connected = cache.snapshot(&albums, &artists);
        assert!(!Arc::ptr_eq(&first_snapshot, &connected));
        assert_eq!(connected.entries[0].artist.name, "Beta");
        assert_eq!(connected.genres, ["Jazz"]);
        assert!(!Arc::ptr_eq(
            &first,
            &cache.entries(&albums, &artists, filters("", "", 0))
        ));
        // ExtrasLoaded can arrive after an artist page has already rendered.
        artists.push(artist("Beta", "Updated sort", &["Late alias"], 2));
        cache.invalidate();
        assert_eq!(
            cache
                .entries(&albums, &artists, filters("late alias", "", 1))
                .len(),
            1
        );
        artists[0] = artist("Beta", "Same length replacement", &["New alias"], 4);
        cache.invalidate();
        assert!(cache
            .entries(&albums, &artists, filters("late alias", "", 1))
            .is_empty());
        assert_eq!(
            cache
                .entries(&albums, &artists, filters("new alias", "", 1))
                .len(),
            1
        );
        // A profile switch empties both sources before data for the new profile arrives.
        albums.clear();
        artists.clear();
        cache.invalidate();
        assert!(cache
            .entries(&albums, &artists, filters("", "", 0))
            .is_empty());
        assert!(cache.snapshot(&albums, &artists).genres.is_empty());
        assert_eq!(first_snapshot.entries[0].artist.name, "Alpha");
    }

    #[test]
    fn filter_history_is_not_retained_and_old_snapshots_remain_immutable() {
        let (albums, artists) = fixture();
        let mut cache = ArtistCache::default();
        let snapshot = cache.snapshot(&albums, &artists);
        let indices = cache.entries(&albums, &artists, filters("", "", 0));
        let old_indices = Arc::downgrade(&indices);
        drop(indices);
        for index in 0..100 {
            cache.entries(&albums, &artists, filters(&format!("query {index}"), "", 0));
            assert!(Arc::ptr_eq(&snapshot, &cache.snapshot(&albums, &artists)));
        }
        assert!(old_indices.upgrade().is_none());
        assert_eq!(Arc::strong_count(&snapshot), 2);
        let weak = Arc::downgrade(&snapshot);
        drop(snapshot);
        cache.invalidate();
        assert!(weak.upgrade().is_none());
        assert!(cache.filters.is_none());
    }

    fn synthetic_fixture() -> (Vec<Album>, Vec<Artist>) {
        let artists: Vec<_> = (0..480)
            .map(|index| {
                artist(
                    &format!("Artist {index:04}"),
                    &format!("Sort {:04}", 479 - index),
                    &[&format!("Alias {index:04}")],
                    index % 7,
                )
            })
            .collect();
        let albums = (0..2400)
            .map(|index| {
                let name = &artists[index % 480].name;
                let other = &artists[(index * 17 + 3) % 480].name;
                album(
                    &format!("album {index:04}"),
                    name,
                    &[name, other],
                    Some(1960 + (index % 65) as i32),
                    index as i64,
                    &[if index % 2 == 0 { "Rock" } else { "Jazz" }],
                )
            })
            .collect();
        (albums, artists)
    }

    fn measure(label: &str, iterations: usize, mut run: impl FnMut()) {
        for _ in 0..3 {
            run();
        }
        let mut samples = Vec::new();
        for _ in 0..31 {
            let started = Instant::now();
            for _ in 0..iterations {
                run();
            }
            samples.push(started.elapsed().as_secs_f64() * 1_000_000.0 / iterations as f64);
        }
        samples.sort_by(f64::total_cmp);
        let p95 = (samples.len() * 95).div_ceil(100) - 1;
        eprintln!(
            "{label}: median={:.3} us/op p95={:.3} us/op (31 samples, {iterations} ops/sample)",
            samples[samples.len() / 2],
            samples[p95]
        );
    }

    #[test]
    #[ignore = "synthetic release benchmark; run with --release --ignored --nocapture"]
    fn synthetic_artist_cache_benchmark() {
        assert!(!cfg!(debug_assertions), "run this benchmark with --release");
        let (albums, artists) = synthetic_fixture();
        let baseline = filters("", "", 0);
        eprintln!("Synthetic deterministic fixture: {} albums, {} metadata records. Timings are algorithm costs, not application FPS or memory measurements.", albums.len(), artists.len());
        measure("legacy aggregation + facets + filter", 1, || {
            let mut genres: Vec<_> = albums
                .iter()
                .flat_map(|album| album.genres.iter().cloned())
                .collect();
            genres.sort();
            genres.dedup();
            black_box(genres);
            black_box(legacy_entries(&albums, &artists, &baseline));
        });
        measure("cache cold snapshot + filter", 1, || {
            let mut cache = ArtistCache::default();
            black_box(cache.snapshot(&albums, &artists));
            black_box(cache.entries(&albums, &artists, baseline.clone()));
        });
        let mut cache = ArtistCache::default();
        cache.entries(&albums, &artists, baseline.clone());
        measure("cache warm snapshot + unchanged filter", 1000, || {
            black_box(cache.snapshot(&albums, &artists));
            black_box(cache.entries(&albums, &artists, baseline.clone()));
        });
        let queries = [
            filters("alias 00", "", 0),
            filters("", "Rock", 1),
            filters("artist", "Jazz", 2),
            filters("", "", 0),
        ];
        let mut checked = ArtistCache::default();
        let snapshot = checked.snapshot(&albums, &artists);
        for query in &queries {
            let old = legacy_entries(&albums, &artists, query);
            let indices = checked.entries(&albums, &artists, query.clone());
            assert_eq!(indices.len(), old.len());
            for (&index, expected) in indices.iter().zip(&old) {
                assert_payload(&snapshot.entries[index], expected);
            }
        }
        let mut index = 0;
        measure(
            "legacy changed filter cycle (without facet rebuild)",
            4,
            || {
                black_box(legacy_entries(
                    &albums,
                    &artists,
                    &queries[index % queries.len()],
                ));
                index += 1;
            },
        );
        let mut index = 0;
        measure("cache changed filter cycle", 20, || {
            black_box(cache.snapshot(&albums, &artists));
            black_box(cache.entries(&albums, &artists, queries[index % queries.len()].clone()));
            index += 1;
        });
    }
}
