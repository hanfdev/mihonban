use crate::{
    api::{Album, AlbumDetail, ApiClient, Artist, Favorite, Favorites, Track},
    cache::CacheStore,
    config::{self, AppConfig},
    i18n,
    engine::PlaybackEngineClient,
    queue::{PlaybackOrder, RepeatMode},
    ui::*,
    updates,
};
use eframe::egui::{self, Color32, FontId, Rect, RichText, Rounding, Stroke, TextureHandle, Vec2};
#[cfg(target_os = "windows")]
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    path::PathBuf,
    sync::{
        mpsc::{self, Receiver, Sender},
        Arc,
    },
    time::{Duration, Instant},
};
use tokio::{
    runtime::Runtime,
    sync::{OwnedSemaphorePermit, Semaphore},
};

mod grid_viewport;
mod image_retries;
mod images;
mod library_cache;
mod playback;
mod settings;
mod settings_ui;
mod texture_cache;
mod tracks;
mod views;
use grid_viewport::visible_grid_rows;
use image_retries::ImageRetries;
use images::{prepare_artwork, prepare_gallery, PreparedArtwork};
use library_cache::{LibraryCache, LibraryFilters};
use texture_cache::TextureCache;
use tracks::{TrackCache, TrackView};
use views::credits;

// The cover budget adapts to the actual viewport; see cover_texture_budget.
const COVER_TEXTURE_FLOOR: usize = 40 * 1024 * 1024;
const COVER_TEXTURE_CEILING: usize = 72 * 1024 * 1024;
const COVER_ESTIMATED_BYTES: usize = 2 * 1024 * 1024;
const GALLERY_TEXTURE_BUDGET: usize = 16 * 1024 * 1024;

const SERIF_REGULAR: &[u8] =
    include_bytes!(concat!(env!("OUT_DIR"), "/ShipporiMincho-SemiBold.ttf.gz"));
const SERIF_BOLD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/ShipporiMincho-Bold.ttf.gz"));
const SANS_REGULAR: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/Inter-Regular.ttf.gz"));
const SANS_SEMIBOLD: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/Inter-SemiBold.ttf.gz"));
const CJK_SERIF: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/NotoSerifSC-SemiBold.ttf.gz"));
const CJK_SANS: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/NotoSansSC-Regular.ttf.gz"));

#[derive(Clone, Copy, PartialEq, Eq)]
enum LibrarySort {
    Rating,
    RatingRaw,
    Artist,
    Title,
    YearNew,
    YearOld,
    Added,
}

enum Message {
    Connected(Result<(Vec<Album>, Vec<Track>, Option<String>), String>),
    AlbumLoaded(Result<AlbumDetail, String>),
    AlbumPlayLoaded(Result<AlbumDetail, String>),
    ExtrasLoaded(Vec<Artist>, Favorites, u64),
    ArtistBioLoaded(String, Result<String, String>),
    CoverLoaded(
        u64,
        String,
        Result<PreparedArtwork, String>,
        OwnedSemaphorePermit,
    ),
    GalleryImageLoaded(
        u64,
        String,
        Result<egui::ColorImage, String>,
        OwnedSemaphorePermit,
    ),
    FavoriteChanged(String, String, bool, Option<usize>, Result<(), String>),
    UpdateChecked(Result<crate::api::UpdateManifest, String>),
    UpdateDownloaded(Result<PathBuf, String>),
}

#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Page {
    Library,
    Tracks,
    Artists,
    Favorites,
    Settings,
}

#[derive(Clone, Copy)]
struct ScrollToTop {
    page: Page,
    from: f32,
    started: f64,
    duration: f64,
}

#[derive(Clone, Copy)]
struct PlayerTransition {
    from: f32,
    to: f32,
    started: f64,
    duration: f64,
}

struct ReaderTransition {
    from: f32,
    to: f32,
    started: f64,
    duration: f64,
}

struct Artwork {
    original: TextureHandle,
    muted: Option<TextureHandle>,
    backdrop: TextureHandle,
}

#[derive(Clone, Copy)]
enum AlbumGridSource<'a> {
    Library(&'a [usize]),
    Albums(&'a [Album]),
}

impl AlbumGridSource<'_> {
    fn len(&self) -> usize {
        match self {
            Self::Library(indices) => indices.len(),
            Self::Albums(albums) => albums.len(),
        }
    }
}

struct ArtistEntry {
    artist: Artist,
    count: usize,
    years: Vec<i32>,
    latest: i64,
    genres: Vec<String>,
}

#[derive(Clone)]
struct ProfileDeletion {
    index: usize,
    profile: config::ServerProfile,
    focus_cancel: bool,
}

pub struct MihonbanApp {
    runtime: Arc<Runtime>,
    repaint_ctx: egui::Context,
    tx: Sender<(u64, Message)>,
    rx: Receiver<(u64, Message)>,
    config: AppConfig,
    cache: CacheStore,
    profile_name: String,
    base_url: String,
    manifest_url: String,
    password: String,
    remember_password: bool,
    pending_profile_delete: Option<ProfileDeletion>,
    api: Option<ApiClient>,
    role: Option<String>,
    albums: Vec<Album>,
    library_cache: LibraryCache,
    tracks: Arc<[Track]>,
    track_cache: TrackCache,
    track_view: TrackView,
    selected: Option<AlbumDetail>,
    selected_artist: Option<String>,
    artists: Vec<Artist>,
    favorites: Favorites,
    favorites_loaded: bool,
    favorite_revision: u64,
    pending_favorites: HashSet<(String, String)>,
    favorite_tracks: bool,
    artist_sort: usize,
    artist_genre: String,
    artist_bios: HashMap<String, String>,
    covers: TextureCache<Artwork>,
    logo: TextureHandle,
    image_slots: Arc<Semaphore>,
    image_generation: u64,
    cover_requests: std::collections::HashSet<String>,
    cover_retries: ImageRetries,
    gallery_images: TextureCache<TextureHandle>,
    gallery_requests: std::collections::HashSet<String>,
    gallery_retries: ImageRetries,
    gallery_open: Option<usize>,
    page: Page,
    page_scroll_offsets: HashMap<Page, f32>,
    scroll_to_top: Option<ScrollToTop>,
    query: String,
    searching: bool,
    min_rating: f32,
    decade: String,
    artist_filter: String,
    genre_filter: String,
    library_sort: LibrarySort,
    status: String,
    busy: bool,
    engine: PlaybackEngineClient,
    current_track: Option<Track>,
    playback_order: PlaybackOrder,
    loading_track: Option<String>,
    reader: Option<(String, String)>,
    reader_generation: u64,
    reader_open: bool,
    reader_transition: Option<ReaderTransition>,
    expanded_genres: bool,
    volume: f32,
    last_audible_volume: f32,
    full_player: bool,
    player_transition: Option<PlayerTransition>,
    update: Option<crate::api::UpdateManifest>,
    #[cfg(target_os = "windows")]
    tray: Result<crate::tray::SystemTray, String>,
}

fn cubic_bezier_ease(progress: f64, x1: f64, y1: f64, x2: f64, y2: f64) -> f64 {
    if progress <= 0.0 {
        return 0.0;
    }
    if progress >= 1.0 {
        return 1.0;
    }
    let coordinate = |time: f64, first: f64, second: f64| {
        let inverse = 1.0 - time;
        3.0 * inverse * inverse * time * first
            + 3.0 * inverse * time * time * second
            + time * time * time
    };
    let mut low = 0.0;
    let mut high = 1.0;
    for _ in 0..12 {
        let middle = (low + high) * 0.5;
        if coordinate(middle, x1, x2) < progress {
            low = middle;
        } else {
            high = middle;
        }
    }
    coordinate((low + high) * 0.5, y1, y2)
}

fn cover_texture_budget(visible_covers: usize) -> usize {
    (visible_covers.saturating_mul(COVER_ESTIMATED_BYTES) + 12 * 1024 * 1024)
        .clamp(COVER_TEXTURE_FLOOR, COVER_TEXTURE_CEILING)
}

impl MihonbanApp {
    pub fn new(cc: &eframe::CreationContext<'_>) -> Self {
        let (tx, rx) = mpsc::channel();
        let runtime = Arc::new(
            tokio::runtime::Builder::new_multi_thread()
                .worker_threads(2)
                .max_blocking_threads(2)
                // Reqwest's connection and timeout futures use Tokio's
                // timer and I/O drivers. Without them, the first automatic
                // server connection panics and closes the client at startup.
                .enable_all()
                .thread_name("mihonban-worker")
                .build()
                .expect("Tokio runtime must be available"),
        );
        let mut config = config::load();
        if config.cache_dir.trim().is_empty() {
            config.cache_dir = config::default_cache_dir().to_string_lossy().into_owned();
        }
        configure_style(&cc.egui_ctx, &config.language);
        let profile = config
            .profiles
            .get(config.active_profile)
            .cloned()
            .unwrap_or_default();
        let cache = cache_for(&config, &profile.base_url);
        let password = config::load_password(&profile.name).unwrap_or_default();
        let logo_image =
            image::load_from_memory(include_bytes!("../../cloud/web/public/icon-192.png"))
                .expect("bundled Web logo")
                .to_rgba8();
        let logo = cc.egui_ctx.load_texture(
            "web-logo",
            egui::ColorImage::from_rgba_unmultiplied(
                [logo_image.width() as usize, logo_image.height() as usize],
                logo_image.as_raw(),
            ),
            egui::TextureOptions::LINEAR,
        );
        let engine = PlaybackEngineClient::spawn(
            runtime.handle().clone(),
            cc.egui_ctx.clone(),
            cache.clone(),
            config.preload_next_track,
            0.82,
        );
        let playback_handle = engine.playback_handle();
        let tray_engine = engine.clone();
        let mut app = Self {
            runtime,
            repaint_ctx: cc.egui_ctx.clone(),
            tx,
            rx,
            config: config.clone(),
            cache,
            profile_name: profile.name,
            base_url: profile.base_url,
            manifest_url: profile.update_manifest_url,
            password,
            remember_password: true,
            pending_profile_delete: None,
            api: None,
            role: None,
            albums: Vec::new(),
            library_cache: LibraryCache::default(),
            tracks: Arc::default(),
            track_cache: TrackCache::default(),
            track_view: TrackView::default(),
            selected: None,
            selected_artist: None,
            artists: Vec::new(),
            favorites: Favorites::default(),
            favorites_loaded: false,
            favorite_revision: 0,
            pending_favorites: HashSet::new(),
            favorite_tracks: false,
            artist_sort: 0,
            artist_genre: String::new(),
            artist_bios: HashMap::new(),
            covers: TextureCache::new(COVER_TEXTURE_FLOOR),
            logo,
            image_slots: Arc::new(Semaphore::new(2)),
            image_generation: 0,
            cover_requests: std::collections::HashSet::new(),
            cover_retries: ImageRetries::default(),
            gallery_images: TextureCache::new(GALLERY_TEXTURE_BUDGET),
            gallery_requests: std::collections::HashSet::new(),
            gallery_retries: ImageRetries::default(),
            gallery_open: None,
            page: Page::Library,
            page_scroll_offsets: HashMap::new(),
            scroll_to_top: None,
            query: String::new(),
            searching: false,
            min_rating: 0.0,
            decade: String::new(),
            artist_filter: String::new(),
            genre_filter: String::new(),
            library_sort: LibrarySort::Rating,
            status: i18n::text(&config.language, "desktop.ready").into(),
            busy: false,
            engine,
            current_track: None,
            playback_order: PlaybackOrder::default(),
            loading_track: None,
            reader: None,
            reader_generation: 0,
            reader_open: false,
            reader_transition: None,
            expanded_genres: false,
            volume: 0.82,
            last_audible_volume: 0.82,
            full_player: false,
            player_transition: None,
            update: None,
            #[cfg(target_os = "windows")]
            tray: crate::tray::SystemTray::new(
                &cc.egui_ctx,
                &config.language,
                playback_handle,
                tray_engine,
            )
            .map_err(|error| error.to_string()),
        };
        if !app.base_url.trim().is_empty() {
            app.connect();
        }
        app
    }

    fn spawn<F>(&self, future: F)
    where
        F: std::future::Future<Output = Message> + Send + 'static,
    {
        let tx = self.tx.clone();
        let generation = self.image_generation;
        let repaint_ctx = self.repaint_ctx.clone();
        self.runtime.spawn(async move {
            let _ = tx.send((generation, future.await));
            repaint_ctx.request_repaint();
            #[cfg(target_os = "windows")]
            crate::tray::wake_main_window();
        });
    }

    fn t(&self, key: &str) -> &'static str {
        i18n::text(&self.config.language, key)
    }

    fn navigate_to_page(&mut self, page: Page, ctx: &egui::Context) {
        let from = self.page_scroll_offsets.get(&page).copied().unwrap_or(0.0);
        self.page = page;
        self.selected = None;
        self.selected_artist = None;
        if page != Page::Settings {
            self.query.clear();
        }
        if page == Page::Tracks {
            self.track_view.locate = None;
        }
        self.track_view.locate = None;
        let started = ctx.input(|input| input.time);
        self.scroll_to_top = (from > 0.5).then_some(ScrollToTop {
            page,
            from,
            started,
            duration: f64::from(
                (0.36 + 0.16 * (from / ctx.screen_rect().height().max(1.0)).sqrt())
                    .clamp(0.36, 0.8),
            ),
        });
        ctx.request_repaint();
    }

    fn scroll_to_top_offset(&mut self, page: Page, ctx: &egui::Context) -> Option<f32> {
        let animation = self.scroll_to_top?;
        if animation.page != page {
            return None;
        }
        let elapsed = ctx.input(|input| input.time) - animation.started;
        if elapsed > 0.08 && ctx.input(|input| input.raw_scroll_delta != Vec2::ZERO) {
            self.scroll_to_top = None;
            return None;
        }
        let progress = (elapsed / animation.duration).clamp(0.0, 1.0);
        let eased = cubic_bezier_ease(progress, 0.25, 0.1, 0.25, 1.0);
        if progress >= 1.0 {
            self.scroll_to_top = None;
        } else {
            ctx.request_repaint_after(Duration::from_millis(16));
        }
        Some(animation.from * (1.0 - eased as f32))
    }

    fn player_position_fraction(&self, now: f64) -> f32 {
        let Some(transition) = self.player_transition else {
            return if self.full_player { 0.0 } else { 1.0 };
        };
        let progress = ((now - transition.started) / transition.duration).clamp(0.0, 1.0);
        let eased = if transition.to < transition.from {
            cubic_bezier_ease(progress, 0.32, 0.72, 0.1, 1.0)
        } else {
            cubic_bezier_ease(progress, 0.55, 0.0, 0.85, 0.36)
        };
        transition.from + (transition.to - transition.from) * eased as f32
    }

    fn set_full_player_open(&mut self, open: bool, ctx: &egui::Context) {
        if self.full_player == open && self.player_transition.is_none() {
            return;
        }
        let now = ctx.input(|input| input.time);
        let from = self.player_position_fraction(now);
        let to = if open { 0.0 } else { 1.0 };
        self.full_player = open;
        self.player_transition = if (from - to).abs() < 0.001 {
            None
        } else {
            Some(PlayerTransition {
                from,
                to,
                started: now,
                duration: if open { 0.36 } else { 0.28 } * (from - to).abs() as f64,
            })
        };
        ctx.request_repaint();
    }

    fn reader_position_fraction(&self, now: f64) -> f32 {
        let Some(transition) = &self.reader_transition else {
            return if self.reader_open { 1.0 } else { 0.0 };
        };
        let progress = ((now - transition.started) / transition.duration).clamp(0.0, 1.0);
        let eased = 1.0 - (1.0 - progress).powi(3);
        transition.from + (transition.to - transition.from) * eased as f32
    }

    fn set_reader_open(&mut self, open: bool, ctx: &egui::Context) {
        if self.reader_open == open {
            return;
        }
        let now = ctx.input(|input| input.time);
        let from = self.reader_position_fraction(now);
        let to = if open { 1.0 } else { 0.0 };
        self.reader_open = open;
        self.reader_transition = if (from - to).abs() < 0.001 {
            None
        } else {
            Some(ReaderTransition {
                from,
                to,
                started: now,
                duration: if open { 0.34 } else { 0.24 } * (from - to).abs() as f64,
            })
        };
        ctx.request_repaint();
    }

    fn reader_animation(&mut self, ctx: &egui::Context) -> Option<f32> {
        if self.reader.is_none() {
            return None;
        }
        let now = ctx.input(|input| input.time);
        let progress = self.reader_position_fraction(now);
        if let Some(transition) = self.reader_transition.as_ref() {
            let finished = (now - transition.started) >= transition.duration;
            if finished {
                self.reader_transition = None;
                if !self.reader_open {
                    self.reader = None;
                    return None;
                }
            } else {
                ctx.request_repaint_after(Duration::from_millis(16));
            }
        }
        Some(progress)
    }

    fn open_reader(&mut self, title: String, text: String, ctx: &egui::Context) {
        self.reader_generation = self.reader_generation.wrapping_add(1);
        self.reader = Some((title, text));
        self.set_reader_open(true, ctx);
    }

    fn full_player_offset(&mut self, ctx: &egui::Context) -> Option<f32> {
        if !self.full_player && self.player_transition.is_none() {
            return None;
        }
        let now = ctx.input(|input| input.time);
        let offset_fraction = self.player_position_fraction(now);
        if let Some(transition) = self.player_transition {
            let progress = ((now - transition.started) / transition.duration).clamp(0.0, 1.0);
            if progress >= 1.0 {
                self.player_transition = None;
            } else {
                ctx.request_repaint_after(Duration::from_millis(16));
            }
        }
        if !self.full_player && offset_fraction >= 1.0 {
            None
        } else {
            Some(ctx.screen_rect().height() * offset_fraction)
        }
    }

    fn tf(&self, key: &str, values: &[&str]) -> String {
        i18n::format(&self.config.language, key, values)
    }

    fn connect(&mut self) {
        self.favorite_revision = self.favorite_revision.wrapping_add(1);
        self.favorites_loaded = false;
        self.busy = true;
        self.status = self.t("desktop.connecting").into();
        let result = ApiClient::new(&self.base_url);
        let password = self.password.clone();
        match result {
            Ok(api) => {
                self.api = Some(api.clone());
                self.spawn(async move {
                    let connected = async {
                        api.health().await?;
                        let me = api.me().await?;
                        let role = if !me.ok && !me.guest {
                            Some(
                                api.login(&password)
                                    .await?
                                    .role
                                    .unwrap_or_else(|| "user".into()),
                            )
                        } else {
                            me.role
                        };
                        let albums = api.library(false).await?;
                        let tracks = api.tracks(false).await?;
                        Ok::<_, anyhow::Error>((albums, tracks, role))
                    }
                    .await
                    .map_err(|error| error.to_string());
                    Message::Connected(connected)
                });
            }
            Err(error) => {
                self.busy = false;
                self.status = error.to_string();
            }
        }
    }

    fn toggle_favorite(&mut self, kind: &'static str, id: &str) {
        if self.role.as_deref() != Some("admin") || !self.favorites_loaded {
            return;
        }
        let key = (kind.to_owned(), id.to_owned());
        if !self.pending_favorites.insert(key) {
            return;
        }
        self.favorite_revision = self.favorite_revision.wrapping_add(1);
        let items = if kind == "album" {
            &mut self.favorites.albums
        } else {
            &mut self.favorites.tracks
        };
        let previous_index = items.iter().position(|favorite| favorite.id == id);
        let adding = previous_index.is_none();
        if adding {
            items.insert(0, Favorite { id: id.to_owned() });
        } else if let Some(index) = previous_index {
            items.remove(index);
        }
        let Some(api) = self.api.clone() else {
            self.pending_favorites
                .remove(&(kind.to_owned(), id.to_owned()));
            return;
        };
        let id = id.to_owned();
        self.spawn(async move {
            Message::FavoriteChanged(
                kind.to_owned(),
                id.clone(),
                adding,
                previous_index,
                api.set_favorite(kind, &id, adding)
                    .await
                    .map_err(|error| error.to_string()),
            )
        });
    }

    fn filtered_albums(&mut self) -> Arc<[usize]> {
        self.library_cache.albums(
            &self.albums,
            LibraryFilters {
                query: self.query.clone(),
                min_rating: self.min_rating,
                decade: self.decade.clone(),
                artist: self.artist_filter.clone(),
                genre: self.genre_filter.clone(),
                sort: self.library_sort,
            },
        )
    }

    fn load_album(&mut self, id: String) {
        let Some(api) = self.api.clone() else {
            self.status = "请先连接 Mihonban 服务".into();
            return;
        };
        self.busy = true;
        self.status = self.t("common.loading").into();
        self.spawn(async move {
            Message::AlbumLoaded(api.album(&id).await.map_err(|error| error.to_string()))
        });
    }

    fn load_cover(&mut self, ctx: &egui::Context, id: String) {
        let Some(api) = self.api.clone() else { return };
        if self.covers.contains_key(&id)
            || self.cover_requests.contains(&id)
            || !self.cover_retries.can_retry(&id, Instant::now())
        {
            return;
        }
        let Ok(permit) = self.image_slots.clone().try_acquire_owned() else {
            return;
        };
        self.cover_requests.insert(id.clone());
        let cache = self.cache.clone();
        let generation = self.image_generation;
        let tx = self.tx.clone();
        let worker_ctx = ctx.clone();
        self.runtime.spawn(async move {
            let result = async {
                let shaded = !id.starts_with("artist:");
                let bytes = if let Some(name) = id.strip_prefix("artist:") {
                    api.artist_art_cached(
                        name.trim_start_matches("custom:"),
                        name.starts_with("custom:"),
                        &cache,
                    )
                    .await?
                } else {
                    api.cover_cached(&id, &cache).await?
                };
                tokio::task::spawn_blocking(move || prepare_artwork(&bytes, shaded)).await?
            }
            .await
            .map_err(|error: anyhow::Error| error.to_string());
            // Hold the permit until the UI consumes the prepared pixels, so
            // decoded results cannot accumulate while the window is hidden.
            let _ = tx.send((
                generation,
                Message::CoverLoaded(generation, id, result, permit),
            ));
            worker_ctx.request_repaint();
        });
        ctx.request_repaint();
    }

    fn load_gallery_image(&mut self, ctx: &egui::Context, id: String) {
        let Some(api) = self.api.clone() else { return };
        if self.gallery_images.contains_key(&id)
            || self.gallery_requests.contains(&id)
            || !self.gallery_retries.can_retry(&id, Instant::now())
        {
            return;
        }
        let Ok(permit) = self.image_slots.clone().try_acquire_owned() else {
            return;
        };
        self.gallery_requests.insert(id.clone());
        let cache = self.cache.clone();
        let generation = self.image_generation;
        let tx = self.tx.clone();
        let worker_ctx = ctx.clone();
        self.runtime.spawn(async move {
            let result = async {
                let bytes = api.image_cached(&id, 480, &cache).await?;
                tokio::task::spawn_blocking(move || prepare_gallery(&bytes)).await?
            }
            .await
            .map_err(|error: anyhow::Error| error.to_string());
            let _ = tx.send((
                generation,
                Message::GalleryImageLoaded(generation, id, result, permit),
            ));
            worker_ctx.request_repaint();
        });
        ctx.request_repaint();
    }

    fn play_queue(&mut self, tracks: Vec<Track>, index: usize) {
        if index < tracks.len() {
            self.playback_order.reset(tracks.len(), index);
            self.engine.play_tracks(self.image_generation, tracks, index);
        }
    }

    fn play_album(&mut self, id: &str) {
        if self
            .current_track
            .as_ref()
            .and_then(|track| track.album_id.as_deref())
            == Some(id)
        {
            self.engine.toggle();
            return;
        }
        let Some(api) = self.api.clone() else { return };
        let id = id.to_owned();
        self.busy = true;
        self.spawn(async move {
            Message::AlbumPlayLoaded(api.album(&id).await.map_err(|error| error.to_string()))
        });
    }

    fn step_queue(&mut self, forward: bool) {
        if forward {
            self.engine.next();
        } else {
            self.engine.previous();
        }
    }

    fn open_artist(&mut self, name: String) {
        self.selected = None;
        self.selected_artist = Some(name.clone());
        if !self.artist_bios.contains_key(&name) {
            if let Some(api) = self.api.clone() {
                self.spawn(async move {
                    Message::ArtistBioLoaded(
                        name.clone(),
                        api.artist_bio(&name)
                            .await
                            .map_err(|error| error.to_string()),
                    )
                });
            }
        }
    }

    fn save_profile(&mut self) {
        if self.profile_name.trim().is_empty() || self.base_url.trim().is_empty() {
            self.status = "A profile name and service address are required".into();
            return;
        }
        let profile = config::ServerProfile {
            name: self.profile_name.trim().to_owned(),
            base_url: self.base_url.trim().trim_end_matches('/').to_owned(),
            update_manifest_url: self.manifest_url.trim().to_owned(),
        };
        if let Some(old) = self.config.profiles.get(self.config.active_profile) {
            if old.name != profile.name {
                let _ = config::clear_password(&old.name);
            }
        }
        if self.config.profiles.len() <= self.config.active_profile {
            self.config.profiles.push(profile.clone());
        } else {
            self.config.profiles[self.config.active_profile] = profile.clone();
        }
        if self.remember_password {
            let _ = config::save_password(&profile.name, &self.password);
        } else {
            let _ = config::clear_password(&profile.name);
        }
        match config::save(&self.config) {
            Ok(()) => {
                self.cache = cache_for(&self.config, &profile.base_url);
                self.status = self.t("desktop.saved").into();
            }
            Err(error) => self.status = error.to_string(),
        }
    }

    fn select_profile(&mut self, index: usize) {
        let Some(profile) = self.config.profiles.get(index).cloned() else {
            return;
        };
        self.config.active_profile = index;
        self.pending_profile_delete = None;
        self.pending_favorites.clear();
        self.favorites_loaded = false;
        self.favorite_revision = self.favorite_revision.wrapping_add(1);
        self.profile_name = profile.name.clone();
        self.base_url = profile.base_url.clone();
        self.manifest_url = profile.update_manifest_url;
        self.password = config::load_password(&profile.name).unwrap_or_default();
        self.cache = cache_for(&self.config, &profile.base_url);
        self.api = None;
        self.role = None;
        self.albums.clear();
        self.library_cache.replace_albums(&self.albums);
        self.tracks = Arc::default();
        self.track_cache = TrackCache::default();
        self.track_view = TrackView::default();
        self.engine.stop();
        self.selected = None;
        self.selected_artist = None;
        self.artists.clear();
        self.favorites = Favorites::default();
        self.artist_bios.clear();
        self.image_generation = self.image_generation.wrapping_add(1);
        self.covers.clear();
        self.cover_requests.clear();
        self.cover_retries.clear();
        self.gallery_images.clear();
        self.gallery_requests.clear();
        self.gallery_retries.clear();
        self.gallery_open = None;
        self.status = format!("Selected profile: {}", profile.name);
        let _ = config::save(&self.config);
    }

    fn add_profile(&mut self) {
        self.config.profiles.push(config::ServerProfile {
            name: format!("Mihonban server {}", self.config.profiles.len() + 1),
            base_url: "http://127.0.0.1:8788".into(),
            update_manifest_url: String::new(),
        });
        let index = self.config.profiles.len() - 1;
        self.select_profile(index);
        self.status = "New profile created; edit it and save".into();
    }

    fn delete_profile(&mut self, pending: ProfileDeletion) -> anyhow::Result<()> {
        let current = self
            .config
            .profiles
            .get(pending.index)
            .ok_or_else(|| anyhow::anyhow!("the selected server profile no longer exists"))?;
        anyhow::ensure!(
            current.name == pending.profile.name
                && current.base_url == pending.profile.base_url
                && current.update_manifest_url == pending.profile.update_manifest_url,
            "the selected server profile changed; review it before deleting"
        );
        let mut next = self.config.clone();
        let removed = next.remove_profile(pending.index)?;
        config::save(&next)?;
        // Profiles with the same name share a credential key. Preserve it
        // while another remaining profile still uses that key.
        let credential_result = if next
            .profiles
            .iter()
            .any(|profile| profile.name == removed.name)
        {
            Ok(())
        } else {
            config::clear_password(&removed.name)
        };
        self.config = next;
        self.engine.stop();
        self.current_track = None;
        self.playback_order = PlaybackOrder::default();
        self.loading_track = None;
        self.full_player = false;
        self.player_transition = None;
        self.update = None;
        self.busy = false;
        self.select_profile(self.config.active_profile);
        self.status = match credential_result {
            Ok(()) => self.tf("desktop.profileDeleted", &[&removed.name]),
            Err(error) => self.tf(
                "desktop.profileCredentialsRetained",
                &[&removed.name, &error.to_string()],
            ),
        };
        Ok(())
    }

    fn consume_messages(&mut self, ctx: &egui::Context) {
        while let Ok((generation, message)) = self.rx.try_recv() {
            // A removed or switched profile must never restore stale data or playback.
            if generation != self.image_generation {
                continue;
            }
            self.busy = false;
            match message {
                Message::Connected(result) => match result {
                    Ok((albums, tracks, role)) => {
                        self.role = role.or_else(|| Some("user".into()));
                        self.albums = albums;
                        self.library_cache.replace_albums(&self.albums);
                        self.tracks = tracks.into();
                        self.track_cache.replace(&self.tracks);
                        self.status = self.t("desktop.connected").into();
                        if let Some(api) = self.api.clone() {
                            let favorite_revision = self.favorite_revision;
                            self.spawn(async move {
                                let (artists, favorites) =
                                    tokio::join!(api.artists(), api.favorites());
                                Message::ExtrasLoaded(
                                    artists.unwrap_or_default(),
                                    favorites.unwrap_or_default(),
                                    favorite_revision,
                                )
                            });
                        }
                    }
                    Err(error) => self.status = error,
                },
                Message::AlbumLoaded(result) => match result {
                    Ok(detail) => {
                        let id = detail.album.id.clone();
                        self.selected = Some(detail);
                        self.expanded_genres = false;
                        self.status = self.t("desktop.ready").into();
                        self.load_cover(ctx, id);
                    }
                    Err(error) => self.status = error,
                },
                Message::AlbumPlayLoaded(result) => match result {
                    Ok(detail) => self.play_queue(detail.tracks, 0),
                    Err(error) => self.status = error,
                },
                Message::ExtrasLoaded(artists, favorites, revision) => {
                    self.artists = artists;
                    if self.favorite_revision == revision {
                        self.favorites = favorites;
                        self.favorites_loaded = true;
                    }
                }
                Message::FavoriteChanged(kind, id, adding, previous_index, result) => {
                    self.pending_favorites.remove(&(kind.clone(), id.clone()));
                    if let Err(error) = result {
                        let items = if kind == "album" {
                            &mut self.favorites.albums
                        } else {
                            &mut self.favorites.tracks
                        };
                        if adding {
                            items.retain(|favorite| favorite.id != id);
                        } else if !items.iter().any(|favorite| favorite.id == id) {
                            let index = previous_index.unwrap_or(items.len()).min(items.len());
                            items.insert(index, Favorite { id });
                        }
                        self.status = error;
                    }
                }
                Message::ArtistBioLoaded(name, result) => {
                    if let Ok(bio) = result {
                        self.artist_bios.insert(name, bio);
                    }
                }
                Message::CoverLoaded(generation, id, result, _permit) => {
                    if generation != self.image_generation {
                        continue;
                    }
                    match result {
                        Ok(prepared) => {
                            self.cover_requests.remove(&id);
                            self.cover_retries.succeeded(&id);
                            let original = ctx.load_texture(
                                format!("cover-{id}"),
                                prepared.original,
                                egui::TextureOptions::LINEAR,
                            );
                            let muted = prepared.muted.map(|pixels| {
                                ctx.load_texture(
                                    format!("muted-{id}"),
                                    pixels,
                                    egui::TextureOptions::LINEAR,
                                )
                            });
                            let backdrop = ctx.load_texture(
                                format!("backdrop-{id}"),
                                prepared.backdrop,
                                egui::TextureOptions::LINEAR,
                            );
                            let bytes = original.byte_size()
                                + backdrop.byte_size()
                                + muted.as_ref().map_or(0, TextureHandle::byte_size);
                            self.covers.insert(
                                id,
                                Artwork {
                                    original,
                                    muted,
                                    backdrop,
                                },
                                bytes,
                            );
                        }
                        Err(error) => {
                            self.cover_requests.remove(&id);
                            self.cover_retries.failed(id, Instant::now());
                            self.status = error;
                        }
                    }
                }
                Message::GalleryImageLoaded(generation, id, result, _permit) => {
                    if generation != self.image_generation {
                        continue;
                    }
                    match result {
                        Ok(pixels) => {
                            self.gallery_requests.remove(&id);
                            self.gallery_retries.succeeded(&id);
                            let texture = ctx.load_texture(
                                format!("gallery-{id}"),
                                pixels,
                                egui::TextureOptions::LINEAR,
                            );
                            let bytes = texture.byte_size();
                            self.gallery_images.insert(id, texture, bytes);
                        }
                        Err(error) => {
                            self.gallery_requests.remove(&id);
                            self.gallery_retries.failed(id, Instant::now());
                            self.status = error;
                        }
                    }
                }
                Message::UpdateChecked(result) => match result {
                    Ok(update) => {
                        self.status =
                            if updates::is_newer(&update.latest, env!("CARGO_PKG_VERSION")) {
                                format!("Client update available: {}", update.latest)
                            } else {
                                "Client is up to date".into()
                            };
                        self.update = Some(update);
                    }
                    Err(error) => self.status = error,
                },
                Message::UpdateDownloaded(result) => match result {
                    Ok(path) => self.status = format!("Update verified: {}", path.display()),
                    Err(error) => self.status = error,
                },
            }
        }
    }

    fn header(&mut self, ui: &mut egui::Ui) {
        let width = ui.available_width();
        let height = 38.0;
        let (rect, _) = ui.allocate_exact_size(Vec2::new(width, height), egui::Sense::hover());
        ui.allocate_ui_at_rect(
            egui::Rect::from_min_size(rect.min, Vec2::new(600.0_f32.min(width - 270.0), height)),
            |ui| {
                ui.horizontal_centered(|ui| {
                    ui.spacing_mut().item_spacing.x = 9.0;
                    if ui
                        .add(
                            egui::ImageButton::new((self.logo.id(), Vec2::splat(26.0)))
                                .frame(false),
                        )
                        .clicked()
                    {
                        self.navigate_to_page(Page::Library, ui.ctx());
                    }
                    if brand_wordmark(ui, width > 1230.0).clicked() {
                        self.navigate_to_page(Page::Library, ui.ctx());
                    }
                    ui.add_space(5.0);
                    ui.spacing_mut().item_spacing.x = 2.0;
                    for (page, key) in [
                        (Page::Library, "nav.library"),
                        (Page::Tracks, "nav.tracks"),
                        (Page::Artists, "nav.artists"),
                        (Page::Favorites, "nav.favs"),
                    ] {
                        let selected = self.page == page;
                        let button = egui::Button::new(
                            RichText::new(self.t(key)).size(14.5).color(if selected {
                                INK
                            } else {
                                DIM
                            }),
                        )
                        .fill(if selected { BG3 } else { Color32::TRANSPARENT })
                        .stroke(egui::Stroke::NONE)
                        .rounding(18.0)
                        .min_size(Vec2::new(48.0, 36.0));
                        if ui
                            .add(button)
                            .on_hover_cursor(egui::CursorIcon::PointingHand)
                            .clicked()
                        {
                            self.navigate_to_page(page, ui.ctx());
                        }
                    }
                });
            },
        );
        let searchable = self.selected.is_none()
            && self.selected_artist.is_none()
            && self.page != Page::Settings;
        if width >= 1692.0 && searchable {
            let search_rect = egui::Rect::from_center_size(rect.center(), Vec2::new(420.0, 38.0));
            ui.allocate_ui_at_rect(search_rect, |ui| self.search_field(ui));
        }
        let right =
            egui::Rect::from_min_max(egui::pos2(rect.right() - 290.0, rect.top()), rect.max);
        ui.allocate_ui_at_rect(right, |ui| {
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                ui.spacing_mut().item_spacing.x = 10.0;
                let role = self.t(if self.role.as_deref() == Some("admin") {
                    "login.roleAdmin"
                } else {
                    "login.roleGuest"
                });
                let mut account = Pill::new("account-menu", role, 84.0);
                account.height = 30.0;
                account.user_icon = true;
                account.show(ui, |ui| {
                    if ui.button(self.t("desktop.settings")).clicked() {
                        self.navigate_to_page(Page::Settings, ui.ctx());
                    }
                    if ui.button(self.t("desktop.connect")).clicked() {
                        self.connect();
                    }
                });
                let short = i18n::LANGUAGES
                    .iter()
                    .find(|entry| entry.0 == self.config.language)
                    .map(|entry| entry.1)
                    .unwrap_or("EN");
                let mut language = Pill::new("language-menu", short, 49.0);
                language.height = 28.0;
                language.show(ui, |ui| {
                    for (id, short, name) in i18n::LANGUAGES {
                        if ui
                            .selectable_label(self.config.language == id, short)
                            .on_hover_text(name)
                            .clicked()
                        {
                            self.config.language = id.to_owned();
                            let _ = config::save(&self.config);
                            configure_style(ui.ctx(), &self.config.language);
                        }
                    }
                });
                if width > 1230.0 {
                    ui.label(
                        RichText::new(self.tf("count.albums", &[&self.albums.len().to_string()]))
                            .size(12.5)
                            .color(FAINT),
                    );
                }
                if width < 1692.0
                    && searchable
                    && icon_button(ui, Icon::Search, 30.0, FAINT).clicked()
                {
                    self.searching = !self.searching;
                }
            });
        });
        if self.searching && width < 1692.0 && searchable {
            ui.add_space(10.0);
            self.search_field(ui);
        }
    }

    fn search_field(&mut self, ui: &mut egui::Ui) {
        egui::Frame::none()
            .fill(BG1)
            .stroke(egui::Stroke::new(1.0, LINE))
            .rounding(20.0)
            .inner_margin(egui::Margin::symmetric(14.0, 7.0))
            .show(ui, |ui| {
                ui.horizontal(|ui| {
                    ui.spacing_mut().item_spacing.x = 9.0;
                    let (icon_rect, _) =
                        ui.allocate_exact_size(Vec2::splat(16.0), egui::Sense::hover());
                    paint_icon(ui.painter(), icon_rect, Icon::Search, FAINT);
                    let clear_width = if self.query.is_empty() { 0.0 } else { 24.0 };
                    ui.add_sized(
                        [ui.available_width() - clear_width, 22.0],
                        egui::TextEdit::singleline(&mut self.query)
                            .id_salt("global-search")
                            .hint_text(i18n::text(&self.config.language, "search.placeholder"))
                            .font(FontId::proportional(14.5))
                            .frame(false),
                    );
                    if !self.query.is_empty() && icon_button(ui, Icon::Close, 18.0, FAINT).clicked()
                    {
                        self.query.clear();
                    }
                });
            });
    }

    fn library(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        self.library_filters(ui);
        let albums = self.filtered_albums();
        self.album_grid_source(ui, ctx, AlbumGridSource::Library(&albums));
        if albums.is_empty() {
            let message = self.t(if self.albums.is_empty() {
                "desktop.connectHint"
            } else {
                "empty.noMatch"
            });
            empty_state(ui, message);
        }
    }

    fn album_grid(&mut self, ui: &mut egui::Ui, ctx: &egui::Context, albums: &[Album]) {
        self.album_grid_source(ui, ctx, AlbumGridSource::Albums(albums));
    }

    fn album_grid_source(
        &mut self,
        ui: &mut egui::Ui,
        ctx: &egui::Context,
        albums: AlbumGridSource<'_>,
    ) {
        let viewport_width = ctx.screen_rect().width();
        let (columns, card_width, gap) = card_geometry(ui.available_width(), viewport_width);
        let row_gap = (viewport_width * 0.025).clamp(30.0, 40.0);
        ui.scope(|ui| {
            ui.spacing_mut().item_spacing = Vec2::new(gap, 0.0);
            let row_height = card_width + 50.0;
            let viewport = visible_grid_rows(
                albums.len().div_ceil(columns),
                row_height,
                row_gap,
                ui.cursor().top(),
                ui.clip_rect().top(),
                ui.clip_rect().bottom(),
                1,
            );
            // Keep the budget in step with the cards actually rendered so
            // that small viewports release memory and large grids never
            // evict covers that stay on screen.
            self.covers
                .set_budget(cover_texture_budget(viewport.rows.len().max(1) * columns));
            // Spacers preserve scroll geometry without allocating offscreen cards.
            ui.add_space(viewport.before);
            for row in viewport.rows {
                ui.horizontal_top(|ui| {
                    let start = row * columns;
                    for index in start..(start + columns).min(albums.len()) {
                        let album = match albums {
                            AlbumGridSource::Library(indices) => {
                                std::borrow::Cow::Owned(self.albums[indices[index]].clone())
                            }
                            AlbumGridSource::Albums(albums) => {
                                std::borrow::Cow::Borrowed(&albums[index])
                            }
                        };
                        let (card, _) = ui.allocate_exact_size(
                            Vec2::new(card_width, row_height),
                            egui::Sense::hover(),
                        );
                        // Album identity stays stable when virtual rows or sort order change.
                        let response = ui.interact(
                            card,
                            egui::Id::new((
                                "album-wall-card",
                                self.page,
                                &self.selected_artist,
                                &album.id,
                            )),
                            egui::Sense::click(),
                        );
                        if !ui.is_rect_visible(card.expand(8.0)) {
                            continue;
                        }
                        let hovered = response.contains_pointer() || response.has_focus();
                        let lift = css_ease(
                            hover_progress(ctx, response.id.with("lift"), hovered, 0.24),
                            [0.2, 0.72, 0.3, 1.16],
                        );
                        let zoom = css_ease(
                            hover_progress(ctx, response.id.with("zoom"), hovered, 0.35),
                            [0.25, 0.1, 0.25, 1.0],
                        );
                        let fade = hover_progress(ctx, response.id.with("button"), hovered, 0.2);
                        let cover = egui::Rect::from_min_size(
                            card.min - Vec2::new(0.0, lift * 5.0),
                            Vec2::splat(card_width),
                        );
                        ui.painter().rect_filled(cover, 12.0, BG2);
                        let current = self
                            .current_track
                            .as_ref()
                            .and_then(|track| track.album_id.as_deref())
                            == Some(album.id.as_str());
                        if let Some(artwork) = self.covers.get(&album.id) {
                            let half = 0.5 / (1.0 + 0.045 * zoom);
                            let uv = egui::Rect::from_min_max(
                                egui::pos2(0.5 - half, 0.5 - half),
                                egui::pos2(0.5 + half, 0.5 + half),
                            );
                            egui::Image::from_texture((
                                if current {
                                    artwork.original.id()
                                } else {
                                    artwork.muted.as_ref().unwrap_or(&artwork.original).id()
                                },
                                cover.size(),
                            ))
                            .uv(uv)
                            .rounding(12.0)
                            .paint_at(ui, cover);
                            if !current && zoom > 0.0 {
                                egui::Image::from_texture((artwork.original.id(), cover.size()))
                                    .uv(uv)
                                    .tint(Color32::WHITE.gamma_multiply(zoom))
                                    .rounding(12.0)
                                    .paint_at(ui, cover);
                            }
                        } else {
                            ui.painter().circle_stroke(
                                cover.center(),
                                13.0,
                                egui::Stroke::new(1.5, FAINT.gamma_multiply(0.4)),
                            );
                            ui.painter().circle_filled(
                                cover.center(),
                                3.0,
                                FAINT.gamma_multiply(0.4),
                            );
                            self.load_cover(ctx, album.id.clone());
                        }
                        ui.painter().rect_stroke(
                            cover,
                            12.0,
                            egui::Stroke::new(
                                1.0,
                                Color32::WHITE.gamma_multiply(0.035 + zoom * 0.04),
                            ),
                        );
                        let mut play_clicked = false;
                        if fade > 0.0 || current {
                            let opacity = if current { 1.0 } else { fade };
                            let center = cover.right_bottom() - Vec2::splat(33.0)
                                + Vec2::new(0.0, (1.0 - opacity) * 8.0);
                            let play_rect = egui::Rect::from_center_size(center, Vec2::splat(44.0));
                            let play_response = ui
                                .interact(play_rect, response.id.with("play"), egui::Sense::click())
                                .on_hover_cursor(egui::CursorIcon::PointingHand);
                            let playing = current && self.engine.is_playing();
                            let highlight = play_response.hovered() || playing;
                            ui.painter().circle_filled(
                                center + Vec2::new(0.0, 3.0),
                                23.0,
                                Color32::BLACK.gamma_multiply(opacity * 0.18),
                            );
                            ui.painter().circle_filled(
                                center,
                                22.0,
                                if highlight {
                                    ACCENT.gamma_multiply(opacity)
                                } else {
                                    Color32::from_rgba_unmultiplied(
                                        18,
                                        15,
                                        12,
                                        (opacity * 168.0) as u8,
                                    )
                                },
                            );
                            ui.painter().circle_stroke(
                                center,
                                21.5,
                                egui::Stroke::new(
                                    1.0,
                                    if highlight {
                                        ACCENT_HI
                                    } else {
                                        Color32::WHITE.gamma_multiply(opacity * 0.18)
                                    },
                                ),
                            );
                            paint_icon(
                                ui.painter(),
                                egui::Rect::from_center_size(center, Vec2::splat(18.0)),
                                if playing { Icon::Pause } else { Icon::Play },
                                INK.gamma_multiply(opacity),
                            );
                            play_clicked = play_response.clicked();
                            if play_clicked {
                                self.play_album(&album.id);
                            }
                        }
                        let title_rect = egui::Rect::from_min_size(
                            egui::pos2(card.left(), card.top() + card_width + 11.0),
                            Vec2::new(card_width, 20.0),
                        );
                        paint_text(
                            ui,
                            &album.title,
                            title_rect,
                            serif(15.0),
                            if hovered {
                                Color32::from_rgb(240, 224, 189)
                            } else {
                                INK
                            },
                            false,
                        );
                        let sub_rect = title_rect.translate(Vec2::new(0.0, 23.0));
                        let score = rating(&album)
                            .map(|score| format!("★{score:.2}"))
                            .unwrap_or_default();
                        let score_width = if score.is_empty() { 0.0 } else { 47.0 };
                        let score_rect = egui::Rect::from_min_max(
                            egui::pos2(sub_rect.right() - score_width, sub_rect.top()),
                            sub_rect.max,
                        );
                        paint_text(
                            ui,
                            &score,
                            score_rect,
                            FontId::proportional(12.25),
                            GOLD,
                            false,
                        );
                        let year = album
                            .year
                            .map(|year| format!("· {year}"))
                            .unwrap_or_default();
                        let year_width = if year.is_empty() { 0.0 } else { 43.0 };
                        let artist_width = (card_width - score_width - year_width - 7.0).max(20.0);
                        let artist_rect =
                            egui::Rect::from_min_size(sub_rect.min, Vec2::new(artist_width, 18.0));
                        let clicked_artist = artist_credit_links(
                            ui,
                            &album.artists,
                            &album.artist,
                            artist_rect,
                            FontId::proportional(12.25),
                            FAINT,
                            response.id.with("artist"),
                        );
                        let actual_artist_width = ui
                            .painter()
                            .layout_no_wrap(
                                album.artist.clone(),
                                FontId::proportional(12.25),
                                FAINT,
                            )
                            .size()
                            .x
                            .min(artist_width);
                        paint_text(
                            ui,
                            &year,
                            egui::Rect::from_min_size(
                                sub_rect.min + Vec2::new(actual_artist_width + 5.0, 0.0),
                                Vec2::new(year_width, 18.0),
                            ),
                            FontId::proportional(12.25),
                            FAINT,
                            false,
                        );
                        if let Some(name) = clicked_artist {
                            self.open_artist(name.to_owned());
                        } else if response.clicked() && !play_clicked {
                            self.load_album(album.id.clone());
                        }
                        if response.hovered() {
                            ctx.set_cursor_icon(egui::CursorIcon::PointingHand);
                        }
                        response.on_hover_text(format!("{}\n{}", album.title, album.artist));
                    }
                });
                ui.add_space(row_gap);
            }
            ui.add_space(viewport.after);
        });
    }

    fn library_filters(&mut self, ui: &mut egui::Ui) {
        let facets = self.library_cache.facets();
        let language = self.config.language.clone();
        let active_filter_count = usize::from(self.min_rating > 0.0)
            + usize::from(!self.decade.is_empty())
            + usize::from(!self.artist_filter.is_empty())
            + usize::from(!self.genre_filter.is_empty())
            + usize::from(!self.query.is_empty());
        ui.horizontal(|ui| {
            ui.spacing_mut().item_spacing.x = 10.0;
            let title = if self.min_rating == 0.0 {
                self.t("library.filterRating").to_owned()
            } else {
                format!("{:.1}+", self.min_rating)
            };
            filter_combo(ui, "rating-filter", &title, self.min_rating > 0.0, |ui| {
                for threshold in [0.0, 2.5, 3.0, 3.2, 3.4, 3.5, 3.6, 3.8, 4.0, 4.2] {
                    let label = if threshold == 0.0 {
                        i18n::text(&language, "library.anyRating").to_owned()
                    } else {
                        format!("{threshold:.1}+")
                    };
                    if ui
                        .selectable_label(self.min_rating == threshold, label)
                        .clicked()
                    {
                        self.min_rating = threshold;
                    }
                }
            });
            let title = if self.decade.is_empty() {
                self.t("library.filterDecade").to_owned()
            } else {
                self.decade.clone()
            };
            filter_combo(ui, "decade-filter", &title, !self.decade.is_empty(), |ui| {
                if ui
                    .selectable_label(
                        self.decade.is_empty(),
                        i18n::text(&language, "library.anyDecade"),
                    )
                    .clicked()
                {
                    self.decade.clear();
                }
                for year in facets.years.iter().rev() {
                    let label = format!("{year}s");
                    if ui.selectable_label(self.decade == label, &label).clicked() {
                        self.decade = label;
                    }
                }
            });
            let title = if self.artist_filter.is_empty() {
                self.t("library.filterArtist").to_owned()
            } else {
                self.artist_filter.clone()
            };
            filter_combo(
                ui,
                "artist-filter",
                &title,
                !self.artist_filter.is_empty(),
                |ui| {
                    if ui
                        .selectable_label(
                            self.artist_filter.is_empty(),
                            i18n::text(&language, "library.anyArtist"),
                        )
                        .clicked()
                    {
                        self.artist_filter.clear();
                    }
                    for artist in &facets.artists {
                        if ui
                            .selectable_label(self.artist_filter == *artist, artist)
                            .clicked()
                        {
                            self.artist_filter = artist.clone();
                        }
                    }
                },
            );
            let title = if self.genre_filter.is_empty() {
                self.t("library.filterGenre").to_owned()
            } else {
                self.genre_filter.clone()
            };
            filter_combo(
                ui,
                "genre-filter",
                &title,
                !self.genre_filter.is_empty(),
                |ui| {
                    if ui
                        .selectable_label(
                            self.genre_filter.is_empty(),
                            i18n::text(&language, "library.anyGenre"),
                        )
                        .clicked()
                    {
                        self.genre_filter.clear();
                    }
                    for genre in &facets.genres {
                        if ui
                            .selectable_label(self.genre_filter == *genre, genre)
                            .clicked()
                        {
                            self.genre_filter = genre.clone();
                        }
                    }
                },
            );
            ui.with_layout(egui::Layout::right_to_left(egui::Align::Center), |ui| {
                let mut sort_menu = Pill::new(
                    "library-sort",
                    sort_label(&language, self.library_sort),
                    150.0,
                );
                sort_menu.ghost = true;
                sort_menu.show(ui, |ui| {
                    for sort in [
                        LibrarySort::Rating,
                        LibrarySort::RatingRaw,
                        LibrarySort::Artist,
                        LibrarySort::Title,
                        LibrarySort::YearNew,
                        LibrarySort::YearOld,
                        LibrarySort::Added,
                    ] {
                        if ui
                            .selectable_label(
                                self.library_sort == sort,
                                sort_label(&language, sort),
                            )
                            .clicked()
                        {
                            self.library_sort = sort;
                        }
                    }
                });
                if active_filter_count > 0 {
                    if clear_filters_button(ui, self.t("common.clearFilters"), active_filter_count)
                    {
                        self.min_rating = 0.0;
                        self.decade.clear();
                        self.artist_filter.clear();
                        self.genre_filter.clear();
                        self.query.clear();
                    }
                }
            });
        });
        ui.add_space(24.0);
    }

    fn connection_view(&mut self, ui: &mut egui::Ui, ctx: &egui::Context) {
        let bounds = ui.max_rect();
        let width = (bounds.width() - 32.0).clamp(320.0, 520.0);
        egui::Area::new(egui::Id::new("connection-card"))
            .order(egui::Order::Middle)
            .pivot(egui::Align2::CENTER_CENTER)
            .fixed_pos(bounds.center())
            .constrain_to(bounds)
            .movable(false)
            .default_width(width)
            .show(ctx, |ui| {
                ui.set_width(width);
                egui::Frame::none()
                    .fill(BG1)
                    .stroke(egui::Stroke::new(1.0, LINE))
                    .rounding(22.0)
                    .shadow(egui::epaint::Shadow {
                        offset: Vec2::new(0.0, 16.0),
                        blur: 48.0,
                        spread: -8.0,
                        color: Color32::from_black_alpha(110),
                    })
                    .inner_margin(egui::Margin::symmetric(36.0, 32.0))
                    .show(ui, |ui| {
                        ui.spacing_mut().item_spacing.y = 0.0;
                        ui.vertical_centered(|ui| {
                            let logo_size = 56.0;
                            let (logo_rect, _) = ui
                                .allocate_exact_size(Vec2::splat(logo_size), egui::Sense::hover());
                            ui.painter().circle_filled(
                                logo_rect.center(),
                                logo_size * 0.5 + 8.0,
                                Color32::from_rgb(28, 24, 18),
                            );
                            egui::Image::from_texture((self.logo.id(), Vec2::splat(logo_size)))
                                .paint_at(ui, logo_rect);
                            ui.add_space(22.0);
                            ui.label(
                                RichText::new(if self.busy {
                                    self.t("desktop.connectingTitle")
                                } else {
                                    self.t("desktop.connectionFailedTitle")
                                })
                                .font(display(26.0))
                                .color(INK),
                            );
                            ui.add_space(10.0);
                            ui.label(
                                RichText::new(if self.busy {
                                    self.t("desktop.connectingBody")
                                } else {
                                    self.t("desktop.connectionFailedBody")
                                })
                                .size(13.0)
                                .color(DIM),
                            );
                            ui.add_space(26.0);
                            connection_endpoint(ui, &self.base_url);
                            ui.add_space(10.0);
                            ui.add(
                                egui::Label::new(
                                    RichText::new(format!(
                                        "{} · {}",
                                        self.t("desktop.profile"),
                                        self.profile_name
                                    ))
                                    .size(11.0)
                                    .color(FAINT),
                                )
                                .truncate(),
                            );
                            ui.add_space(26.0);
                            if self.busy {
                                let progress_width = ui.available_width().min(240.0);
                                let (progress, _) = ui.allocate_exact_size(
                                    Vec2::new(progress_width, 3.0),
                                    egui::Sense::hover(),
                                );
                                let time = ctx.input(|input| input.time) as f32;
                                let phase = (time * 0.75).sin() * 0.5 + 0.5;
                                let lead = progress.left() + progress.width() * (phase * 0.72);
                                ui.painter().rect_filled(progress, 2.0, BG3);
                                ui.painter().rect_filled(
                                    egui::Rect::from_min_max(
                                        egui::pos2(lead, progress.top()),
                                        egui::pos2(
                                            (lead + progress.width() * 0.28).min(progress.right()),
                                            progress.bottom(),
                                        ),
                                    ),
                                    2.0,
                                    ACCENT,
                                );
                                ui.add_space(14.0);
                                ui.label(
                                    RichText::new(self.t("desktop.connecting"))
                                        .size(11.5)
                                        .color(FAINT),
                                );
                                ctx.request_repaint_after(Duration::from_millis(16));
                            } else {
                                ui.add(
                                    egui::Label::new(
                                        RichText::new(&self.status).size(11.5).color(FAINT),
                                    )
                                    .wrap(),
                                );
                                ui.add_space(20.0);
                                ui.horizontal(|ui| {
                                    let button_width = 148.0;
                                    let gap = 12.0;
                                    ui.add_space(
                                        ((ui.available_width() - button_width * 2.0 - gap) / 2.0)
                                            .max(0.0),
                                    );
                                    ui.spacing_mut().item_spacing.x = gap;
                                    if ui
                                        .add_sized(
                                            [button_width, 36.0],
                                            egui::Button::new(self.t("common.retry"))
                                                .fill(ACCENT)
                                                .rounding(18.0),
                                        )
                                        .on_hover_cursor(egui::CursorIcon::PointingHand)
                                        .clicked()
                                    {
                                        self.connect();
                                    }
                                    if ui
                                        .add_sized(
                                            [button_width, 36.0],
                                            egui::Button::new(self.t("desktop.settings"))
                                                .fill(Color32::TRANSPARENT)
                                                .stroke(egui::Stroke::new(1.0, LINE))
                                                .rounding(18.0),
                                        )
                                        .on_hover_cursor(egui::CursorIcon::PointingHand)
                                        .clicked()
                                    {
                                        self.navigate_to_page(Page::Settings, ui.ctx());
                                    }
                                });
                            }
                        });
                    });
            });
    }

    /// Synchronize the UI with the background playback engine: forward the
    /// current connection context, surface errors and mirror playback state.
    fn poll_engine(&mut self) {
        self.engine.update_context(
            self.api.clone(),
            self.cache.clone(),
            self.config.preload_next_track,
        );
        if let Some(error) = self.engine.take_error() {
            self.status = error;
        }
        let state = self.engine.snapshot();
        if let Some(track) = state.loading {
            if self.loading_track.as_deref() != Some(track.id.as_str()) {
                self.status = format!("{} {}", self.t("desktop.preparing"), track.title);
                self.loading_track = Some(track.id);
            }
        } else {
            self.loading_track = None;
        }
        if self.current_track.as_ref().map(|track| track.id.as_str())
            != state.current_track.as_ref().map(|track| track.id.as_str())
        {
            if let Some(track) = &state.current_track {
                self.status = format!("{} {}", self.t("desktop.playing"), track.title);
            }
            self.current_track = state.current_track.clone();
        }
        self.playback_order.shuffled = state.shuffled;
        self.playback_order.repeat = state.repeat;
    }

}

impl eframe::App for MihonbanApp {
    fn update(&mut self, ctx: &egui::Context, frame: &mut eframe::Frame) {
        // Upload against the previous frame's visible pins before starting a
        // fresh visibility pass, so pending images cannot evict onscreen covers.
        self.consume_messages(ctx);
        self.poll_engine();
        self.covers.begin_frame();
        self.gallery_images.begin_frame();
        #[cfg(target_os = "windows")]
        if let Ok(handle) = frame.window_handle() {
            if let RawWindowHandle::Win32(handle) = handle.as_raw() {
                crate::tray::register_main_window(handle.hwnd.get());
            }
        }
        #[cfg(target_os = "windows")]
        if let Ok(tray) = &mut self.tray {
            for action in tray.actions() {
                match action {
                    crate::tray::TrayAction::Show => tray.show(ctx),
                    crate::tray::TrayAction::ToggleWindow => tray.toggle_window(ctx),
                    crate::tray::TrayAction::Exit => {
                        tray.exit(ctx);
                        // exit() drops the native tray window immediately.
                        // Do not touch its menu or close interception again in
                        // this frame; doing so races tray-icon's WM_DESTROY.
                        return;
                    }
                }
            }
            if crate::tray::force_exit_requested() {
                tray.exit(ctx);
                return;
            }
            if tray.is_exiting() {
                return;
            }
            tray.refresh(
                &self.config.language,
                self.engine.is_playing(),
                self.current_track.is_some(),
            );
            if tray.update_window(ctx, self.config.minimize_to_tray, self.config.close_to_tray) {
                ctx.request_repaint_after(Duration::from_millis(250));
                return;
            }
        }
        if ctx.input(|input| input.key_pressed(egui::Key::Escape)) {
            if self.pending_profile_delete.is_some() {
                self.pending_profile_delete = None;
            } else if self.full_player {
                self.set_full_player_open(false, ctx);
            } else if self.reader.is_some() {
                self.set_reader_open(false, ctx);
            } else if self.selected.is_some() {
                self.selected = None;
            } else if self.selected_artist.is_some() {
                self.selected_artist = None;
            } else {
                self.searching = false;
                self.query.clear();
            }
        }
        if self.pending_profile_delete.is_none()
            && ctx.input(|input| input.modifiers.ctrl && input.key_pressed(egui::Key::F))
        {
            self.searching = true;
            ctx.memory_mut(|memory| memory.request_focus(egui::Id::new("global-search")));
        }
        if self.pending_profile_delete.is_none()
            && !ctx.wants_keyboard_input()
            && ctx.input(|input| input.key_pressed(egui::Key::Space))
        {
            self.engine.toggle();
        }
        let gutter = (ctx.screen_rect().width() * 0.022).clamp(18.0, 34.0);
        // Detail pages follow the Web layout's fixed 26px hero inset. The
        // library wall keeps its responsive gutter so its card density stays
        // unchanged at different window sizes.
        let detail_page = self.selected.is_some() || self.selected_artist.is_some();
        egui::TopBottomPanel::top("header")
            .frame(
                egui::Frame::none()
                    .fill(BG0)
                    .stroke(egui::Stroke::new(1.0, Color32::from_rgb(34, 29, 22)))
                    .inner_margin(egui::Margin::symmetric(gutter, 12.0)),
            )
            .show(ctx, |ui| {
                if self.pending_profile_delete.is_some() {
                    ui.disable();
                }
                self.header(ui);
            });
        if self.current_track.is_some() {
            egui::TopBottomPanel::bottom("player")
                .frame(
                    egui::Frame::none()
                        .fill(Color32::from_rgb(16, 13, 10))
                        .stroke(egui::Stroke::new(1.0, LINE))
                        .inner_margin(egui::Margin::symmetric(20.0, 10.0)),
                )
                .show(ctx, |ui| {
                    if self.pending_profile_delete.is_some() {
                        ui.disable();
                    }
                    self.player_bar(ctx, ui);
                });
        }
        egui::CentralPanel::default()
            .frame(egui::Frame::none().fill(BG0).inner_margin(egui::Margin {
                left: if detail_page { 26.0 } else { gutter },
                // The main scrollbar belongs to the window edge like the
                // Web .main scrollbar on every page. The left inset still
                // controls the content grid and detail hero alignment.
                right: 0.0,
                top: if self.selected.is_some()
                    || self.selected_artist.is_some()
                    || self.page == Page::Tracks
                {
                    0.0
                } else {
                    18.0
                },
                bottom: 18.0,
            }))
            .show(ctx, |ui| {
                if self.pending_profile_delete.is_some() {
                    ui.disable();
                }
                let connection_screen = self.page == Page::Library
                    && self.selected.is_none()
                    && self.selected_artist.is_none()
                    && self.albums.is_empty()
                    && self.role.is_none();
                if connection_screen {
                    self.connection_view(ui, ctx);
                    return;
                }
                ui.scope(|ui| {
                    // Keep scrollbar styling local to the page scroll area so
                    // ordinary inactive controls retain their normal surface.
                    let style = ui.style_mut();
                    style.spacing.scroll = egui::style::ScrollStyle {
                        floating: true,
                        bar_width: 10.0,
                        handle_min_length: 24.0,
                        bar_inner_margin: 0.0,
                        bar_outer_margin: 0.0,
                        floating_width: 10.0,
                        floating_allocated_width: 0.0,
                        foreground_color: false,
                        dormant_background_opacity: 0.0,
                        active_background_opacity: 0.0,
                        interact_background_opacity: 0.0,
                        dormant_handle_opacity: 1.0,
                        active_handle_opacity: 1.0,
                        interact_handle_opacity: 1.0,
                    };
                    style.visuals.widgets.inactive.bg_fill = crate::ui::BG3;
                    if self.page == Page::Tracks && !detail_page {
                        self.tracks_page(ui, ctx);
                        return;
                    }
                    let page = self.page;
                    let detail_id = self
                        .selected
                        .as_ref()
                        .map(|detail| detail.album.id.clone())
                        .or_else(|| self.selected_artist.clone());
                    let scroll_to_top = self.scroll_to_top_offset(page, ctx);
                    let mut scroll = egui::ScrollArea::vertical()
                        .id_salt(("main-scroll", page, detail_id))
                        .auto_shrink([false, false])
                        .scroll_bar_rect(egui::Rect::from_min_max(
                            ui.max_rect().min,
                            egui::pos2(ctx.screen_rect().right(), ui.max_rect().bottom()),
                        ));
                    if let Some(offset) = scroll_to_top {
                        scroll = scroll.vertical_scroll_offset(offset);
                    }
                    let output = scroll.show(ui, |ui| {
                        // Keep the Web grid's right content inset while
                        // letting the outer scrollbar occupy the true
                        // window edge on every top-level page.
                        if !detail_page {
                            ui.set_width((ui.available_width() - gutter).max(1.0));
                        }
                        if self.selected.is_some() {
                            self.album_detail(ui, ctx);
                        } else if self.selected_artist.is_some() {
                            self.artist_detail(ui, ctx);
                        } else {
                            match self.page {
                                Page::Library => self.library(ui, ctx),
                                Page::Tracks => self.tracks_page(ui, ctx),
                                Page::Artists => self.artists_page(ui, ctx),
                                Page::Favorites => self.favorites_page(ui, ctx),
                                Page::Settings => {
                                    let left = ((ui.available_width() - 1120.0) / 2.0).max(0.0);
                                    ui.horizontal_top(|ui| {
                                        ui.add_space(left);
                                        ui.vertical(|ui| {
                                            ui.set_width(ui.available_width().min(1120.0));
                                            self.settings(ui);
                                        });
                                    });
                                }
                            }
                        }
                        if self.page != Page::Settings && self.albums.is_empty() {
                            ui.add_space(24.0);
                            ui.label(RichText::new(&self.status).size(12.0).color(FAINT));
                        }
                    });
                    if !detail_page {
                        self.page_scroll_offsets.insert(page, output.state.offset.y);
                    }
                });
            });
        self.full_player_page(ctx);
        self.profile_delete_dialog(ctx);
        if self.gallery_open.is_some() {
            self.gallery_lightbox(ctx);
        }
        let reader_progress = self.reader_animation(ctx);
        if let (Some((title, text)), Some(progress)) = (self.reader.clone(), reader_progress) {
            let bounds = ctx.screen_rect();
            let card_size = Vec2::new(
                (bounds.width() - 44.0).clamp(280.0, 680.0),
                (bounds.height() - 60.0).clamp(260.0, 780.0),
            );
            let card_scale = 0.98 + 0.02 * progress;
            let card = Rect::from_center_size(
                bounds.center() + Vec2::new(0.0, (1.0 - progress) * 22.0),
                card_size * card_scale,
            );
            let kicker = if self.selected_artist.is_some() {
                self.t("artistPage.kicker")
            } else {
                self.t("albumPage.kicker")
            };
            let reader_art = if let Some(detail) = self.selected.as_ref() {
                self.covers
                    .get(&detail.album.id)
                    .map(|artwork| (artwork.original.id(), true))
            } else if let Some(name) = self.selected_artist.as_ref() {
                let artist = self.artists.iter().find(|artist| artist.name == *name);
                artist
                    .map(|artist| {
                        format!(
                            "artist:{}{}",
                            if artist.has_avatar { "custom:" } else { "" },
                            artist.name
                        )
                    })
                    .and_then(|key| {
                        self.covers
                            .get(&key)
                            .map(|artwork| (artwork.original.id(), false))
                    })
            } else {
                None
            };
            let mut close = false;
            egui::Area::new(egui::Id::new("note-reader-backdrop"))
                .order(egui::Order::Foreground)
                .fixed_pos(bounds.min)
                .show(ctx, |ui| {
                    ui.set_min_size(bounds.size());
                    let full = ui.max_rect();
                    let backdrop = ui.interact(
                        full,
                        egui::Id::new("note-reader-dismiss"),
                        egui::Sense::click(),
                    );
                    ui.painter().rect_filled(
                        full,
                        0.0,
                        Color32::from_rgba_premultiplied(8, 6, 4, (190.0 * progress) as u8),
                    );
                    if backdrop.clicked() {
                        close = true;
                    }
                    // Absorb clicks anywhere on the card so only clicks
                    // outside it dismiss the reader; widgets inside the
                    // card (close button, links) register later and still
                    // win the pointer where they overlap.
                    ui.interact(
                        card,
                        egui::Id::new("note-reader-card-guard"),
                        egui::Sense::click(),
                    );
                    ui.allocate_ui_at_rect(card, |ui| {
                        egui::Frame::none()
                            .fill(BG1)
                            .stroke(Stroke::new(1.0, LINE))
                            .rounding(18.0)
                            .shadow(egui::epaint::Shadow {
                                offset: Vec2::new(0.0, 18.0),
                                blur: 48.0,
                                spread: 0.0,
                                color: Color32::from_black_alpha(180),
                            })
                            .show(ui, |ui| {
                                ui.set_min_size(card.size());
                                ui.set_max_size(card.size());
                                ui.add_space(17.0);
                                ui.horizontal(|ui| {
                                    ui.spacing_mut().item_spacing.x = 14.0;
                                    ui.add_space(20.0);
                                    if let Some((texture, square)) = reader_art {
                                        let (rect, _) = ui.allocate_exact_size(
                                            Vec2::splat(46.0),
                                            egui::Sense::hover(),
                                        );
                                        egui::Image::from_texture((texture, rect.size()))
                                            .rounding(if square { 8.0 } else { 23.0 })
                                            .paint_at(ui, rect);
                                    }
                                    ui.vertical(|ui| {
                                        ui.label(RichText::new(kicker).size(10.5).color(FAINT));
                                        ui.label(
                                            RichText::new(&title).font(serif(21.0)).color(INK),
                                        );
                                    });
                                    ui.with_layout(
                                        egui::Layout::right_to_left(egui::Align::Center),
                                        |ui| {
                                            ui.add_space(20.0);
                                            if icon_button(ui, Icon::Close, 32.0, DIM).clicked() {
                                                close = true;
                                            }
                                        },
                                    );
                                });
                                ui.add_space(17.0);
                                ui.add_space(12.0);
                                ui.separator();
                                ui.add_space(22.0);
                                reader_markdown_area(ui, &text, self.reader_generation);
                                ui.add_space(34.0);
                            });
                    });
                });
            if close {
                self.set_reader_open(false, ctx);
            }
        }
        if (self.busy || self.loading_track.is_some())
            && !(self.albums.is_empty() && self.role.is_none())
        {
            egui::Area::new(egui::Id::new("loading-status"))
                .anchor(
                    egui::Align2::RIGHT_BOTTOM,
                    Vec2::new(
                        -24.0,
                        if self.current_track.is_some() {
                            -100.0
                        } else {
                            -24.0
                        },
                    ),
                )
                .show(ctx, |ui| {
                    egui::Frame::none()
                        .fill(BG1)
                        .rounding(18.0)
                        .inner_margin(12.0)
                        .show(ui, |ui| {
                            ui.horizontal(|ui| {
                                ui.spinner();
                                ui.label(RichText::new(&self.status).size(12.0).color(DIM));
                            });
                        });
                });
        }
        if self.engine.is_playing() {
            ctx.request_repaint_after(Duration::from_millis(100));
        }
    }
}

fn reader_markdown_area(ui: &mut egui::Ui, text: &str, generation: u64) {
    let body_width = (ui.available_width() - 52.0).max(1.0);
    let body_height = (ui.available_height() - 34.0).max(1.0);
    ui.horizontal(|ui| {
        ui.add_space(26.0);
        ui.allocate_ui_with_layout(
            Vec2::new(body_width, body_height),
            egui::Layout::top_down(egui::Align::Min),
            |ui| {
                ui.set_min_size(Vec2::new(body_width, body_height));
                ui.set_max_size(Vec2::new(body_width, body_height));
                egui::ScrollArea::vertical()
                    .id_salt(("note-reader-body", generation))
                    .max_width(body_width)
                    .max_height(body_height)
                    .auto_shrink([false, false])
                    .show(ui, |ui| {
                        ui.set_width(body_width);
                        // ScrollArea inherits its parent layout; keep Markdown blocks in reading order.
                        ui.with_layout(egui::Layout::top_down(egui::Align::Min), |ui| {
                            markdown_body(ui, text);
                        });
                    });
            },
        );
        ui.add_space(26.0);
    });
}

fn configure_style(ctx: &egui::Context, language: &str) {
    ctx.options_mut(|options| {
        options.line_scroll_speed = 72.0;
    });
    let mut fonts = egui::FontDefinitions::empty();
    fonts
        .font_data
        .insert("mihonban-serif".into(), compressed_font(SERIF_REGULAR));
    fonts
        .font_data
        .insert("mihonban-serif-bold".into(), compressed_font(SERIF_BOLD));
    fonts
        .font_data
        .insert("mihonban-sans".into(), compressed_font(SANS_REGULAR));
    fonts.font_data.insert(
        "mihonban-sans-semibold".into(),
        compressed_font(SANS_SEMIBOLD),
    );
    fonts
        .font_data
        .insert("mihonban-cjk-serif".into(), compressed_font(CJK_SERIF));
    fonts
        .font_data
        .insert("mihonban-cjk-sans".into(), compressed_font(CJK_SANS));
    fonts.families.insert(
        egui::FontFamily::Name("mihonban-serif".into()),
        vec!["mihonban-serif".into(), "mihonban-cjk-serif".into()],
    );
    fonts.families.insert(
        egui::FontFamily::Name("mihonban-display".into()),
        vec!["mihonban-serif-bold".into(), "mihonban-cjk-serif".into()],
    );
    fonts.families.insert(
        egui::FontFamily::Name("mihonban-ui".into()),
        vec!["mihonban-sans".into(), "mihonban-cjk-sans".into()],
    );
    fonts.families.insert(
        egui::FontFamily::Name("mihonban-ui-bold".into()),
        vec!["mihonban-sans-semibold".into(), "mihonban-cjk-sans".into()],
    );
    fonts.families.insert(
        egui::FontFamily::Proportional,
        vec!["mihonban-sans".into(), "mihonban-cjk-sans".into()],
    );
    fonts.families.insert(
        egui::FontFamily::Monospace,
        vec!["mihonban-sans".into(), "mihonban-cjk-sans".into()],
    );
    load_windows_font_fallbacks(&mut fonts, language);
    ctx.set_fonts(fonts);
    let mut visuals = egui::Visuals::dark();
    visuals.panel_fill = BG0;
    visuals.window_fill = BG1;
    visuals.faint_bg_color = BG1;
    visuals.extreme_bg_color = BG1;
    visuals.widgets.noninteractive.bg_fill = BG1;
    visuals.widgets.noninteractive.fg_stroke.color = DIM;
    visuals.widgets.inactive.bg_fill = BG2;
    visuals.widgets.inactive.fg_stroke.color = DIM;
    visuals.widgets.hovered.bg_fill = BG3;
    visuals.widgets.hovered.fg_stroke.color = INK;
    visuals.widgets.active.bg_fill = ACCENT;
    visuals.widgets.active.fg_stroke.color = INK;
    visuals.selection.bg_fill = ACCENT;
    visuals.selection.stroke.color = INK;
    visuals.window_rounding = Rounding::same(12.0);
    visuals.widgets.noninteractive.rounding = Rounding::same(8.0);
    visuals.widgets.inactive.rounding = Rounding::same(8.0);
    visuals.widgets.hovered.rounding = Rounding::same(8.0);
    visuals.widgets.active.rounding = Rounding::same(8.0);
    visuals.widgets.open.rounding = Rounding::same(8.0);
    ctx.set_visuals(visuals);
    let mut style = (*ctx.style()).clone();
    style.spacing.item_spacing = Vec2::new(8.0, 8.0);
    style.spacing.button_padding = Vec2::new(12.0, 7.0);
    style
        .text_styles
        .insert(egui::TextStyle::Body, FontId::proportional(14.5));
    style
        .text_styles
        .insert(egui::TextStyle::Button, FontId::proportional(14.0));
    style.visuals.widgets.inactive.bg_stroke = egui::Stroke::new(1.0, LINE);
    style.visuals.widgets.noninteractive.bg_stroke = egui::Stroke::new(1.0, LINE);
    style.visuals.widgets.hovered.bg_stroke = egui::Stroke::new(1.0, Color32::from_rgb(74, 65, 50));
    style.visuals.hyperlink_color = GOLD;
    ctx.set_style(style);
}

#[cfg(target_os = "windows")]
fn load_windows_font_fallbacks(fonts: &mut egui::FontDefinitions, language: &str) {
    let mut roots = Vec::new();
    // Windows may be installed on any drive, and fonts can be installed for
    // the current user without administrator access.
    if let Some(local_app_data) = std::env::var_os("LOCALAPPDATA") {
        roots.push(
            PathBuf::from(local_app_data)
                .join("Microsoft")
                .join("Windows")
                .join("Fonts"),
        );
    }
    if let Some(windows_dir) = std::env::var_os("WINDIR") {
        roots.push(PathBuf::from(windows_dir).join("Fonts"));
    }
    let mut fallbacks = vec![
        ("windows-ui-fallback", "segoeui.ttf"),
        ("windows-symbol-fallback", "seguisym.ttf"),
        ("windows-historic-fallback", "seguihis.ttf"),
    ];
    if language == "ko" {
        // The Korean face costs about 13 MB and is only needed for the
        // Korean interface; keep it out of every other language.
        fallbacks.push(("windows-korean", "malgun.ttf"));
    }
    for (name, file_name) in fallbacks {
        let Some(path) = roots
            .iter()
            .map(|root| root.join(file_name))
            .find(|path| path.is_file())
        else {
            continue;
        };
        if let Ok(bytes) = std::fs::read(path) {
            append_font_fallback(fonts, name, egui::FontData::from_owned(bytes));
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn load_windows_font_fallbacks(_fonts: &mut egui::FontDefinitions, _language: &str) {}

fn append_font_fallback(fonts: &mut egui::FontDefinitions, name: &str, data: egui::FontData) {
    fonts.font_data.insert(name.to_owned(), data);
    for family in fonts.families.values_mut() {
        family.push(name.to_owned());
    }
}

fn compressed_font(bytes: &'static [u8]) -> egui::FontData {
    let mut decoder = flate2::read::GzDecoder::new(bytes);
    let mut font = Vec::new();
    decoder
        .read_to_end(&mut font)
        .expect("bundled font can be decompressed");
    egui::FontData::from_owned(font)
}

#[cfg(test)]
mod animation_tests {
    use super::cubic_bezier_ease;

    #[test]
    fn player_transition_curves_match_web_timing_and_remain_monotonic() {
        for (x1, y1, x2, y2) in [(0.32, 0.72, 0.1, 1.0), (0.55, 0.0, 0.85, 0.36)] {
            let values: Vec<_> = (0..=100)
                .map(|step| cubic_bezier_ease(step as f64 / 100.0, x1, y1, x2, y2))
                .collect();

            assert_eq!(values.first(), Some(&0.0));
            assert_eq!(values.last(), Some(&1.0));
            assert!(values.windows(2).all(|pair| pair[0] <= pair[1]));
            assert!(values.iter().all(|value| (0.0..=1.0).contains(value)));
        }
    }
}

#[cfg(test)]
mod font_tests {
    use super::*;

    #[test]
    fn system_fallbacks_follow_the_branded_fonts() {
        let mut fonts = egui::FontDefinitions::empty();
        fonts.families.insert(
            egui::FontFamily::Name("mihonban-ui".into()),
            vec!["mihonban-sans".into(), "mihonban-cjk-sans".into()],
        );
        append_font_fallback(
            &mut fonts,
            "system-fallback",
            egui::FontData::from_static(SANS_REGULAR),
        );
        assert_eq!(
            fonts.families[&egui::FontFamily::Name("mihonban-ui".into())],
            ["mihonban-sans", "mihonban-cjk-sans", "system-fallback"]
        );
    }

    #[test]
    fn bundled_fonts_decompress_to_valid_truetype_data() {
        for compressed in [
            SERIF_REGULAR,
            SERIF_BOLD,
            SANS_REGULAR,
            SANS_SEMIBOLD,
            CJK_SERIF,
            CJK_SANS,
        ] {
            let font = compressed_font(compressed);
            assert_eq!(&font.font[..4], &[0, 1, 0, 0]);
        }
    }
}

#[cfg(test)]
mod reader_layout_tests {
    use super::*;

    #[test]
    fn cjk_markdown_renders_with_production_fonts_at_multiple_widths() {
        let source = "## 《Test Album》：向示例世界递上的一张90年代样例名片\n\n\
            90年代酒廊流行乐（Lounge Pop）的地理中心，并非只在英国（如 **Sample Band One**, **Sample Band Two**）。\n\n\
            由 **Sample Studio** 录制于1996年的开篇曲《Sample Song》。";

        for width in [280.0, 480.0, 960.0, 1600.0] {
            let ctx = egui::Context::default();
            configure_style(&ctx, "en");

            for full_body in [false, true] {
                let output = ctx.run(
                    egui::RawInput {
                        screen_rect: Some(Rect::from_min_size(
                            egui::Pos2::ZERO,
                            Vec2::new(width, 900.0),
                        )),
                        ..Default::default()
                    },
                    |ctx| {
                        egui::CentralPanel::default()
                            .frame(egui::Frame::none())
                            .show(ctx, |ui| {
                                if full_body {
                                    reader_markdown_area(ui, source, 2);
                                } else {
                                    markdown_preview(ui, source, 3);
                                }
                            });
                    },
                );

                let rendered_text = output
                    .shapes
                    .iter()
                    .filter_map(|clipped| match &clipped.shape {
                        egui::Shape::Text(shape) => Some(shape.galley.job.text.as_str()),
                        _ => None,
                    })
                    .collect::<Vec<_>>();
                assert!(
                    rendered_text
                        .iter()
                        .any(|text| text.contains("Sample Band One")),
                    "missing album text at width {width}, full_body={full_body}"
                );
                assert!(rendered_text.iter().all(|text| !text.contains("**")));
                assert!(!ctx
                    .tessellate(output.shapes, output.pixels_per_point)
                    .is_empty());
            }
        }
    }

    #[test]
    fn reader_markdown_blocks_flow_down_inside_the_scroll_area() {
        let ctx = egui::Context::default();
        configure_style(&ctx, "en");
        let source = "# Artist overview\n\nFirst paragraph.\n\n# Discography\n\nSecond paragraph.";
        let output = ctx.run(
            egui::RawInput {
                screen_rect: Some(Rect::from_min_size(
                    egui::Pos2::ZERO,
                    Vec2::new(1200.0, 900.0),
                )),
                ..Default::default()
            },
            |ctx| {
                egui::CentralPanel::default()
                    .frame(egui::Frame::none())
                    .show(ctx, |ui| {
                        ui.allocate_ui_with_layout(
                            Vec2::new(740.0, 700.0),
                            egui::Layout::top_down(egui::Align::Min),
                            |ui| reader_markdown_area(ui, source, 1),
                        );
                    });
            },
        );

        let text_y = |needle: &str| {
            output
                .shapes
                .iter()
                .find_map(|clipped| match &clipped.shape {
                    egui::Shape::Text(shape) if shape.galley.job.text.contains(needle) => {
                        Some(shape.pos.y)
                    }
                    _ => None,
                })
                .unwrap_or_else(|| panic!("reader did not render {needle:?}"))
        };

        assert!(text_y("Artist overview") < text_y("First paragraph."));
        assert!(text_y("First paragraph.") < text_y("Discography"));
        assert!(text_y("Discography") < text_y("Second paragraph."));
    }
}

fn filter_combo(
    ui: &mut egui::Ui,
    id: &'static str,
    title: &str,
    active: bool,
    content: impl FnOnce(&mut egui::Ui),
) {
    let mut pill = Pill::new(id, title, 124.0);
    pill.active = active;
    pill.show(ui, content);
}

/// Compact utility action matching the Web clear-filters pill.
fn clear_filters_button(ui: &mut egui::Ui, title: &str, count: usize) -> bool {
    let label = ui
        .painter()
        .layout_no_wrap(title.to_owned(), FontId::proportional(12.0), DIM);
    let count_label = count.to_string();
    let count_galley =
        ui.painter()
            .layout_no_wrap(count_label.clone(), FontId::proportional(10.0), ACCENT_HI);
    let count_width = (count_galley.size().x + 10.0).max(18.0);
    let width = 10.0 + 15.0 + 7.0 + label.size().x + 7.0 + count_width + 8.0;
    let (rect, response) = ui.allocate_exact_size(Vec2::new(width, 36.0), egui::Sense::click());
    let hovered = response.hovered() || response.has_focus();
    let foreground = if hovered { ACCENT_HI } else { DIM };
    // Web: surface-line at rest, accent-line on intent.
    let border = if hovered {
        Color32::from_rgba_unmultiplied(232, 84, 47, 115)
    } else {
        Color32::from_rgba_unmultiplied(255, 255, 255, 20)
    };
    let fill = if hovered {
        Color32::from_rgba_unmultiplied(232, 84, 47, 9)
    } else {
        Color32::TRANSPARENT
    };
    ui.painter()
        .rect(rect, 18.0, fill, Stroke::new(1.0, border));
    paint_icon(
        ui.painter(),
        Rect::from_center_size(
            egui::pos2(rect.left() + 10.0 + 7.5, rect.center().y),
            Vec2::splat(15.0),
        ),
        Icon::FilterX,
        if hovered {
            ACCENT_HI
        } else {
            ACCENT_HI.gamma_multiply(0.82)
        },
    );
    ui.painter().galley(
        egui::pos2(
            rect.left() + 10.0 + 15.0 + 7.0,
            rect.center().y - label.size().y / 2.0,
        ),
        label,
        foreground,
    );
    let count_rect = Rect::from_min_size(
        egui::pos2(rect.right() - 8.0 - count_width, rect.center().y - 9.0),
        Vec2::new(count_width, 18.0),
    );
    ui.painter().rect_filled(
        count_rect,
        9.0,
        Color32::from_rgba_unmultiplied(232, 84, 47, 28),
    );
    ui.painter().galley(
        egui::pos2(
            count_rect.center().x - count_galley.size().x / 2.0,
            count_rect.center().y - count_galley.size().y / 2.0,
        ),
        count_galley,
        ACCENT_HI,
    );
    response
        .on_hover_cursor(egui::CursorIcon::PointingHand)
        .on_hover_text(title)
        .clicked()
}

fn sort_label(language: &str, sort: LibrarySort) -> &'static str {
    let key = match sort {
        LibrarySort::Rating => "library.sortRating",
        LibrarySort::RatingRaw => "library.sortRatingRaw",
        LibrarySort::Artist => "library.sortArtist",
        LibrarySort::Title => "library.sortTitle",
        LibrarySort::YearNew => "library.sortYearNew",
        LibrarySort::YearOld => "library.sortYearOld",
        LibrarySort::Added => "library.sortAdded",
    };
    i18n::text(language, key)
}

fn rating(album: &Album) -> Option<f64> {
    album
        .rym
        .as_ref()
        .and_then(|rym| rym.rating)
        .filter(|value| value.is_finite() && (0.0..=5.0).contains(value))
}

fn votes(album: &Album) -> u64 {
    album.rym.as_ref().and_then(|rym| rym.votes).unwrap_or(0)
}

fn compare_weighted_rating(a: &Album, b: &Album) -> std::cmp::Ordering {
    let score = |album: &Album| match rating(album) {
        None => f64::NEG_INFINITY,
        Some(value) if value <= 3.3 => value,
        Some(value) => (value * votes(album) as f64 + 3.3 * 50.0) / (votes(album) as f64 + 50.0),
    };
    score(b)
        .total_cmp(&score(a))
        .then_with(|| votes(b).cmp(&votes(a)))
        .then_with(|| {
            rating(b)
                .unwrap_or(-1.0)
                .total_cmp(&rating(a).unwrap_or(-1.0))
        })
}

fn compare_raw_rating(a: &Album, b: &Album) -> std::cmp::Ordering {
    rating(b)
        .unwrap_or(-1.0)
        .total_cmp(&rating(a).unwrap_or(-1.0))
        .then_with(|| votes(b).cmp(&votes(a)))
}

fn cache_for(config: &AppConfig, base_url: &str) -> CacheStore {
    let root = if config.cache_dir.trim().is_empty() {
        config::default_cache_dir()
    } else {
        PathBuf::from(config.cache_dir.trim())
    };
    let scope = format!("{:x}", Sha256::digest(base_url.as_bytes()));
    let cache = CacheStore::new(root, config.cache_max_bytes, config.cache_enabled, scope);
    let _ = cache.enforce_limit();
    cache
}

fn empty_state(ui: &mut egui::Ui, message: &str) {
    ui.add_space(54.0);
    ui.vertical_centered(|ui| {
        ui.label(RichText::new("◉").size(32.0).color(FAINT));
        ui.label(RichText::new(message).size(15.0).color(DIM));
    });
}

fn format_duration(duration: Option<f64>) -> String {
    let seconds = duration.unwrap_or(0.0).max(0.0) as u64;
    if seconds == 0 {
        return "—".into();
    }
    format!("{}:{:02}", seconds / 60, seconds % 60)
}

fn format_bytes(bytes: u64) -> String {
    const UNITS: [&str; 4] = ["B", "KB", "MB", "GB"];
    let mut value = bytes as f64;
    let mut unit = 0;
    while value >= 1024.0 && unit < UNITS.len() - 1 {
        value /= 1024.0;
        unit += 1;
    }
    format!("{value:.1} {}", UNITS[unit])
}

#[cfg(test)]
mod cover_budget_tests {
    use super::*;

    #[test]
    fn cover_budget_scales_with_visible_cards_and_stays_clamped() {
        assert_eq!(cover_texture_budget(0), COVER_TEXTURE_FLOOR);
        assert_eq!(cover_texture_budget(4), COVER_TEXTURE_FLOOR);
        let mid = cover_texture_budget(20);
        assert!(mid >= 20 * COVER_ESTIMATED_BYTES);
        assert!(mid <= COVER_TEXTURE_CEILING);
        assert_eq!(cover_texture_budget(1000), COVER_TEXTURE_CEILING);
    }
}
