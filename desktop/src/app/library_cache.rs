use super::{compare_raw_rating, compare_weighted_rating, credits, Album, LibrarySort};
use std::sync::Arc;

#[derive(Clone, PartialEq)]
pub(super) struct LibraryFilters {
    pub query: String,
    pub min_rating: f32,
    pub decade: String,
    pub artist: String,
    pub genre: String,
    pub sort: LibrarySort,
}

#[derive(Default)]
pub(super) struct LibraryFacets {
    pub years: Vec<i32>,
    pub artists: Vec<String>,
    pub genres: Vec<String>,
}

#[derive(Default)]
pub(super) struct LibraryCache {
    filters: Option<LibraryFilters>,
    indices: Arc<[usize]>,
    facets: Arc<LibraryFacets>,
}

impl LibraryCache {
    /// A refreshed library invalidates even identical filter selections.
    pub(super) fn replace_albums(&mut self, albums: &[Album]) {
        self.filters = None;
        self.indices = Arc::default();
        let mut years: Vec<_> = albums
            .iter()
            .filter_map(|album| album.year)
            .map(|year| year.div_euclid(10) * 10)
            .collect();
        years.sort_unstable();
        years.dedup();
        let mut artists: Vec<_> = albums.iter().flat_map(credits).collect();
        artists.sort_by_cached_key(|artist| artist.to_lowercase());
        artists.dedup();
        let mut genres: Vec<_> = albums
            .iter()
            .flat_map(|album| album.genres.iter().chain(&album.secondary_genres).cloned())
            .collect();
        genres.sort_by_cached_key(|genre| genre.to_lowercase());
        genres.dedup_by(|left, right| left.eq_ignore_ascii_case(right));
        self.facets = Arc::new(LibraryFacets {
            years,
            artists,
            genres,
        });
    }

    pub(super) fn facets(&self) -> Arc<LibraryFacets> {
        Arc::clone(&self.facets)
    }

    /// The steady-state scroll path shares indices without cloning album records.
    pub(super) fn albums(&mut self, albums: &[Album], filters: LibraryFilters) -> Arc<[usize]> {
        if self.filters.as_ref() == Some(&filters) {
            return Arc::clone(&self.indices);
        }
        let query = filters.query.trim().to_lowercase();
        let decade = filters
            .decade
            .strip_suffix('s')
            .and_then(|value| value.parse::<i32>().ok());
        let mut indices: Vec<_> = albums
            .iter()
            .enumerate()
            .filter_map(|(index, album)| {
                let query_matches = query.is_empty()
                    || album.title.to_lowercase().contains(&query)
                    || album.artist.to_lowercase().contains(&query)
                    || album
                        .artists
                        .iter()
                        .any(|artist| artist.name.to_lowercase().contains(&query))
                    || album
                        .genres
                        .iter()
                        .chain(&album.secondary_genres)
                        .any(|genre| genre.to_lowercase().contains(&query));
                let rating = album.rym.as_ref().and_then(|rym| rym.rating).unwrap_or(0.0);
                let decade_matches = filters.decade.is_empty()
                    || album
                        .year
                        .map(|year| Some(year.div_euclid(10) * 10) == decade)
                        .unwrap_or(false);
                let artist_matches = filters.artist.is_empty()
                    || album.artist == filters.artist
                    || album
                        .artists
                        .iter()
                        .any(|artist| artist.name == filters.artist);
                let genre_matches = filters.genre.is_empty()
                    || album
                        .genres
                        .iter()
                        .chain(&album.secondary_genres)
                        .any(|genre| genre.eq_ignore_ascii_case(&filters.genre));
                (query_matches
                    && rating >= f64::from(filters.min_rating)
                    && decade_matches
                    && artist_matches
                    && genre_matches)
                    .then_some(index)
            })
            .collect();
        match filters.sort {
            LibrarySort::Artist => indices.sort_by_cached_key(|&index| {
                let album = &albums[index];
                (album.artist_sort.to_lowercase(), album.year.unwrap_or(0))
            }),
            LibrarySort::Title => {
                indices.sort_by_cached_key(|&index| albums[index].title.to_lowercase())
            }
            sort => indices.sort_by(|&a, &b| {
                let (a, b) = (&albums[a], &albums[b]);
                match sort {
                    LibrarySort::Rating => compare_weighted_rating(a, b),
                    LibrarySort::RatingRaw => compare_raw_rating(a, b),
                    LibrarySort::YearNew => b.year.unwrap_or(0).cmp(&a.year.unwrap_or(0)),
                    LibrarySort::YearOld => {
                        a.year.unwrap_or(i32::MAX).cmp(&b.year.unwrap_or(i32::MAX))
                    }
                    LibrarySort::Added => b.updated_at.cmp(&a.updated_at),
                    LibrarySort::Artist | LibrarySort::Title => unreachable!(),
                }
            }),
        }
        self.filters = Some(filters);
        self.indices = indices.into();
        Arc::clone(&self.indices)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn album(id: &str, artist: &str, title: &str, year: i32, genre: &str) -> Album {
        serde_json::from_value(serde_json::json!({
            "id": id, "artist": artist, "artistSort": artist,
            "title": title, "year": year, "genres": [genre],
            "rym": {"rating": 4.0, "votes": 100}
        }))
        .unwrap()
    }

    fn filters() -> LibraryFilters {
        LibraryFilters {
            query: String::new(),
            min_rating: 0.0,
            decade: String::new(),
            artist: String::new(),
            genre: String::new(),
            sort: LibrarySort::Title,
        }
    }

    #[test]
    fn unchanged_filters_reuse_indices_and_library_refresh_invalidates_them() {
        let mut albums = vec![
            album("a", "Artist", "Zulu", 1995, "Rock"),
            album("b", "Other", "Alpha", 2002, "Jazz"),
        ];
        let mut cache = LibraryCache::default();
        cache.replace_albums(&albums);
        let first = cache.albums(&albums, filters());
        assert_eq!(&*first, &[1, 0]);
        let next_frame = cache.albums(&albums, filters());
        assert!(Arc::ptr_eq(&first, &next_frame));
        albums.reverse();
        cache.replace_albums(&albums);
        let refreshed = cache.albums(&albums, filters());
        assert!(!Arc::ptr_eq(&first, &refreshed));
        assert_eq!(&*refreshed, &[0, 1]);
    }

    #[test]
    fn filter_changes_refresh_results_and_facets_stay_shared() {
        let albums = vec![
            album("a", "Artist", "Zulu", 1995, "Rock"),
            album("b", "Other", "Alpha", 2002, "Jazz"),
        ];
        let mut cache = LibraryCache::default();
        cache.replace_albums(&albums);
        let first = cache.albums(&albums, filters());
        let mut filter = filters();
        filter.decade = "1990s".into();
        filter.genre = "rOcK".into();
        assert_eq!(&*cache.albums(&albums, filter.clone()), &[0]);
        filter.query = "  zULu  ".into();
        assert_eq!(&*cache.albums(&albums, filter.clone()), &[0]);
        filter.artist = "Other".into();
        assert!(cache.albums(&albums, filter).is_empty());
        assert_eq!(&*first, &[1, 0]);
        let facets = cache.facets();
        assert_eq!(facets.years, vec![1990, 2000]);
        assert_eq!(facets.artists, vec!["Artist", "Other"]);
        assert_eq!(facets.genres, vec!["Jazz", "Rock"]);
        assert!(Arc::ptr_eq(&facets, &cache.facets()));
    }
}
