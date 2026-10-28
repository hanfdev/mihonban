//! Background playback engine.
//!
//! The engine owns the audio output, the play queue and all track loading on
//! a dedicated thread, so playback, queue progression and background
//! downloads never depend on the UI frame loop. The UI reads an immutable
//! state snapshot and sends commands; the tray can control playback and stop
//! the engine without any window being alive.

use crate::api::{ApiClient, Track};
use crate::cache::CacheStore;
use crate::player::{AudioPlayer, PlaybackCompletionWatcher, PlaybackHandle};
use crate::queue::{PlaybackOrder, RepeatMode};
use eframe::egui;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tokio::runtime::Handle as RuntimeHandle;

/// A point-in-time copy of everything the UI needs from the engine.
#[derive(Clone, Default)]
pub struct EngineState {
    pub current_track: Option<Track>,
    pub loading: Option<Track>,
    pub playing: bool,
    pub position: Duration,
    pub shuffled: bool,
    pub repeat: RepeatMode,
    pub error: Option<String>,
}

enum EngineCommand {
    UpdateContext {
        api: Option<ApiClient>,
        cache: CacheStore,
        preload_next: bool,
    },
    PlayTracks {
        generation: u64,
        tracks: Vec<Track>,
        index: usize,
    },
    LoadFinished {
        generation: u64,
        track: Track,
        result: Result<(PathBuf, bool), String>,
    },
    Toggle,
    Next,
    Previous,
    Seek(Duration),
    SetVolume(f32),
    SetShuffle(bool),
    SetRepeat(RepeatMode),
    Stop {
        ack: Option<Sender<()>>,
    },
}

/// Thread-safe client used by the UI, the tray callbacks and the exit path.
#[derive(Clone)]
pub struct PlaybackEngineClient {
    tx: Sender<EngineCommand>,
    state: Arc<Mutex<EngineState>>,
    handle: PlaybackHandle,
}

impl PlaybackEngineClient {
    pub fn spawn(
        runtime: RuntimeHandle,
        ctx: egui::Context,
        cache: CacheStore,
        preload_next_track: bool,
        volume: f32,
    ) -> Self {
        let (tx, rx) = mpsc::channel();
        let state = Arc::new(Mutex::new(EngineState::default()));
        let handle: PlaybackHandle = Arc::new(Mutex::new(None));
        let engine_tx = tx.clone();
        let engine_state = Arc::clone(&state);
        let engine_handle = Arc::clone(&handle);
        thread::Builder::new()
            .name("mihonban-playback".into())
            .spawn(move || {
                // The audio device and its decoder live entirely on this
                // thread; nothing here is ever moved across threads.
                let engine = Engine {
                    rx,
                    tx: engine_tx,
                    state: engine_state,
                    ctx,
                    runtime,
                    api: None,
                    cache,
                    preload_next_track,
                    volume,
                    player: AudioPlayer::with_handle(Arc::clone(&engine_handle)),
                    handle: engine_handle,
                    order: PlaybackOrder::default(),
                    queue: Vec::new(),
                    current: None,
                    loading: None,
                    desired_playing: false,
                    last_seen_playing: None,
                    generation: 0,
                    prefetch_inflight: None,
                    load_abort: None,
                    prefetch_abort: None,
                    watcher: PlaybackCompletionWatcher::default(),
                    last_fingerprint: None,
                };
                engine.run();
            })
            .expect("cannot spawn the playback engine thread");
        Self { tx, state, handle }
    }

    /// The handle published by the engine; tray callbacks use it to toggle
    /// the live sink without touching the UI thread.
    pub fn playback_handle(&self) -> PlaybackHandle {
        Arc::clone(&self.handle)
    }

    pub fn snapshot(&self) -> EngineState {
        self.state
            .lock()
            .map(|state| state.clone())
            .unwrap_or_default()
    }

    pub fn is_playing(&self) -> bool {
        self.state
            .lock()
            .map(|state| state.playing)
            .unwrap_or(false)
    }

    pub fn current_track(&self) -> Option<Track> {
        self.state
            .lock()
            .ok()
            .and_then(|state| state.current_track.clone())
    }

    pub fn position(&self) -> Duration {
        self.state
            .lock()
            .map(|state| state.position)
            .unwrap_or_default()
    }

    /// Consume the most recent playback error for a short UI notice.
    pub fn take_error(&self) -> Option<String> {
        self.state
            .lock()
            .ok()
            .and_then(|mut state| state.error.take())
    }

    pub fn update_context(&self, api: Option<ApiClient>, cache: CacheStore, preload_next: bool) {
        let _ = self.tx.send(EngineCommand::UpdateContext {
            api,
            cache,
            preload_next,
        });
    }

    pub fn play_tracks(&self, generation: u64, tracks: Vec<Track>, index: usize) {
        let _ = self.tx.send(EngineCommand::PlayTracks {
            generation,
            tracks,
            index,
        });
    }

    pub fn toggle(&self) {
        let _ = self.tx.send(EngineCommand::Toggle);
    }

    pub fn next(&self) {
        let _ = self.tx.send(EngineCommand::Next);
    }

    pub fn previous(&self) {
        let _ = self.tx.send(EngineCommand::Previous);
    }

    pub fn seek(&self, position: Duration) {
        let _ = self.tx.send(EngineCommand::Seek(position));
    }

    pub fn set_volume(&self, volume: f32) {
        let _ = self.tx.send(EngineCommand::SetVolume(volume));
    }

    pub fn set_shuffle(&self, shuffled: bool) {
        let _ = self.tx.send(EngineCommand::SetShuffle(shuffled));
    }

    pub fn set_repeat(&self, repeat: RepeatMode) {
        let _ = self.tx.send(EngineCommand::SetRepeat(repeat));
    }

    pub fn stop(&self) {
        let _ = self.tx.send(EngineCommand::Stop { ack: None });
    }

    /// Stop playback and wait briefly so an exiting process never leaves a
    /// playing sink or a background download behind.
    pub fn stop_blocking(&self, timeout: Duration) {
        let (ack_tx, ack_rx) = mpsc::channel();
        if self
            .tx
            .send(EngineCommand::Stop { ack: Some(ack_tx) })
            .is_ok()
        {
            let _ = ack_rx.recv_timeout(timeout);
        }
    }
}

type Fingerprint = (Option<String>, Option<String>, bool, bool, u8);

struct Engine {
    rx: Receiver<EngineCommand>,
    tx: Sender<EngineCommand>,
    state: Arc<Mutex<EngineState>>,
    ctx: egui::Context,
    runtime: RuntimeHandle,
    api: Option<ApiClient>,
    cache: CacheStore,
    preload_next_track: bool,
    volume: f32,
    player: AudioPlayer,
    handle: PlaybackHandle,
    order: PlaybackOrder,
    queue: Vec<Track>,
    current: Option<Track>,
    loading: Option<Track>,
    desired_playing: bool,
    last_seen_playing: Option<bool>,
    generation: u64,
    prefetch_inflight: Option<String>,
    load_abort: Option<tokio::task::AbortHandle>,
    prefetch_abort: Option<tokio::task::AbortHandle>,
    watcher: PlaybackCompletionWatcher,
    last_fingerprint: Option<Fingerprint>,
}

/// The play intent after a Toggle press. Once audio is loaded the live sink
/// is the source of truth (its state just flipped); with only a load in
/// flight the press flips the pending intent; otherwise nothing is under
/// user control and the intent stays put.
fn intent_after_toggle(
    live_sink: bool,
    audible_before: bool,
    loading: bool,
    desired: bool,
) -> bool {
    if live_sink {
        !audible_before
    } else if loading {
        !desired
    } else {
        desired
    }
}

/// Fold an observation of the live sink into the play intent. External sink
/// toggles (the tray controls the sink directly) are detected as changes
/// since the last observation; a stable audible state keeps the intent, so
/// an explicit play command survives while an old paused track is replaced.
fn reconcile_intent(
    desired: bool,
    live_sink: bool,
    audible: bool,
    last_seen: Option<bool>,
) -> (bool, Option<bool>) {
    if !live_sink {
        return (desired, None);
    }
    if last_seen != Some(audible) {
        (audible, Some(audible))
    } else {
        (desired, Some(audible))
    }
}

impl Engine {
    fn run(mut self) {
        loop {
            match self.rx.recv_timeout(Duration::from_millis(100)) {
                Ok(command) => self.handle_command(command),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            while let Ok(command) = self.rx.try_recv() {
                self.handle_command(command);
            }
            self.tick();
        }
    }

    fn handle_command(&mut self, command: EngineCommand) {
        match command {
            EngineCommand::UpdateContext {
                api,
                cache,
                preload_next,
            } => {
                self.api = api;
                self.cache = cache;
                self.preload_next_track = preload_next;
            }
            EngineCommand::PlayTracks {
                generation,
                tracks,
                index,
            } => {
                self.generation = generation;
                self.queue = tracks;
                self.order.reset(self.queue.len(), index);
                self.abort_prefetch();
                // Picking tracks is an explicit play command; a pause
                // pressed while the load is in flight can still flip it back.
                self.desired_playing = true;
                if let Some(track) = self.queue.get(index).cloned() {
                    self.start_load(track);
                }
                self.publish();
            }
            EngineCommand::LoadFinished {
                generation,
                track,
                result,
            } => {
                self.handle_load_finished(generation, track, result);
            }
            EngineCommand::Toggle => {
                let live = self.player.has_sink() && !self.player.finished();
                self.desired_playing = intent_after_toggle(
                    live,
                    self.player.is_playing(),
                    self.loading.is_some(),
                    self.desired_playing,
                );
                if live {
                    self.player.toggle();
                }
                self.publish();
            }
            EngineCommand::Next => self.advance(true, false),
            EngineCommand::Previous => self.advance(false, false),
            EngineCommand::Seek(position) => {
                if let Err(error) = self.player.seek(position) {
                    self.set_error(error.to_string());
                }
            }
            EngineCommand::SetVolume(volume) => {
                self.volume = volume.clamp(0.0, 1.0);
                self.player.set_volume(self.volume);
            }
            EngineCommand::SetShuffle(shuffled) => {
                if self.order.shuffled != shuffled {
                    self.order.toggle_shuffle();
                }
                self.publish();
            }
            EngineCommand::SetRepeat(repeat) => {
                self.order.repeat = repeat;
                self.publish();
            }
            EngineCommand::Stop { ack } => {
                self.stop();
                if let Some(ack) = ack {
                    let _ = ack.send(());
                }
            }
        }
    }

    fn stop(&mut self) {
        self.player.stop();
        self.queue.clear();
        self.order = PlaybackOrder::default();
        self.current = None;
        self.loading = None;
        self.desired_playing = false;
        self.abort_prefetch();
        if let Some(abort) = self.load_abort.take() {
            abort.abort();
        }
        self.generation = self.generation.wrapping_add(1);
        self.publish();
    }

    fn advance(&mut self, forward: bool, automatic: bool) {
        if let Some(index) = self.order.step(forward, automatic) {
            if let Some(track) = self.queue.get(index).cloned() {
                self.start_load(track);
            }
        }
        self.publish();
    }

    fn abort_prefetch(&mut self) {
        if let Some(abort) = self.prefetch_abort.take() {
            abort.abort();
        }
        self.prefetch_inflight = None;
    }

    fn start_load(&mut self, track: Track) {
        if self
            .loading
            .as_ref()
            .is_some_and(|loading| loading.id == track.id)
        {
            return;
        }
        if self.prefetch_inflight.as_deref() == Some(track.id.as_str()) {
        // Supersede any in-flight playback download: nobody waits for its
        // result anymore, and the leftover transfer would only compete for
        // bandwidth with the track the user actually picked.
        if let Some(abort) = self.load_abort.take() {
            abort.abort();
        }
            // The background prefetch for this track is already running; play
            // its result when it lands instead of downloading it twice.
            self.loading = Some(track);
            self.publish();
            return;
        }
        let Some(api) = self.api.clone() else {
            self.set_error("请先连接 Mihonban 服务".into());
            return;
        };
        let id = track.id.clone();
        let extension = if track.format.trim().is_empty() {
            "audio".to_owned()
        } else {
            track.format.to_lowercase()
        };
        let cache = self.cache.clone();
        let generation = self.generation;
        let tx = self.tx.clone();
        let task_track = track.clone();
        self.loading = Some(track);
        let handle = self.runtime.spawn(async move {
            let result = api
                .stream_to_cache(&id, &extension, &cache)
                .await
                .map(|path| {
                    let temporary = path.parent() == Some(std::env::temp_dir().as_path());
                    (path, temporary)
                })
                .map_err(|error| error.to_string());
            let _ = tx.send(EngineCommand::LoadFinished {
                generation,
                track: task_track,
                result,
            });
        });
        self.load_abort = Some(handle.abort_handle());
        self.publish();
    }

    fn handle_load_finished(
        &mut self,
        generation: u64,
        track: Track,
        result: Result<(PathBuf, bool), String>,
    ) {
        let matches_loading = self
            .loading
            .as_ref()
            .is_some_and(|loading| loading.id == track.id);
        if self.prefetch_inflight.as_deref() == Some(track.id.as_str()) {
            self.prefetch_inflight = None;
            self.prefetch_abort = None;
        }
        if generation != self.generation || !matches_loading {
            // Stale results (profile switch, replaced track) only need their
            // temporary files cleaned up.
            if let Ok((path, true)) = &result {
                let _ = std::fs::remove_file(path);
            }
            return;
        }
        match result {
            Ok((path, temporary)) => {
                let title = track.title.clone();
                let cleanup = temporary.then(|| path.clone());
                match self.player.play_file(&title, path, temporary, self.desired_playing) {
                    Ok(()) => {
                        self.player.set_volume(self.volume);
                        self.current = Some(track);
                        self.loading = None;
                        self.maybe_prefetch();
                    }
                    Err(error) => {
                        self.loading = None;
                        if let Some(path) = cleanup {
                            let _ = std::fs::remove_file(path);
                        }
                        self.set_error(error.to_string());
                    }
                }
            }
            Err(error) => {
                self.loading = None;
                self.set_error(error);
            }
        }
        self.publish();
    }

    fn maybe_prefetch(&mut self) {
        if !self.preload_next_track || !self.cache.enabled() {
            return;
        }
        let Some(index) = self.order.peek_next() else {
            return;
        };
        let Some(track) = self.queue.get(index).cloned() else {
            return;
        };
        if self
            .current
            .as_ref()
            .is_some_and(|current| current.id == track.id)
        {
            return;
        }
        if self
            .loading
            .as_ref()
            .is_some_and(|loading| loading.id == track.id)
        {
            return;
        }
        if self.prefetch_inflight.as_deref() == Some(track.id.as_str()) {
            return;
        }
        if self.cache.get(&format!("audio:{}", track.id)).is_some() {
            return;
        }
        let Some(api) = self.api.clone() else {
            return;
        };
        let id = track.id.clone();
        let extension = if track.format.trim().is_empty() {
            "audio".to_owned()
        } else {
            track.format.to_lowercase()
        };
        let cache = self.cache.clone();
        let generation = self.generation;
        let tx = self.tx.clone();
        if let Some(abort) = self.prefetch_abort.take() {
            abort.abort();
        }
        self.prefetch_inflight = Some(id.clone());
        let handle = self.runtime.spawn(async move {
            let result = api
                .stream_to_cache(&id, &extension, &cache)
                .await
                .map(|path| (path, false))
                .map_err(|error| error.to_string());
            let _ = tx.send(EngineCommand::LoadFinished {
                generation,
                track,
                result,
            });
        });
        self.prefetch_abort = Some(handle.abort_handle());
    }

    fn tick(&mut self) {
        self.sync_intent_with_sink();
        if self.loading.is_none() && self.current.is_some() && self.watcher.observe(&self.handle) {
            self.advance(true, true);
        }
        self.publish();
    }

    /// Mirror pause/play changes made outside the command channel (the tray
    /// toggles the live sink directly) into the play intent, so a load that
    /// lands later cannot override the user's latest choice.
    fn sync_intent_with_sink(&mut self) {
        let live = self.player.has_sink() && !self.player.finished();
        let (desired, seen) = reconcile_intent(
            self.desired_playing,
            live,
            self.player.is_playing(),
            self.last_seen_playing,
        );
        self.desired_playing = desired;
        self.last_seen_playing = seen;
    }

    fn publish(&mut self) {
        let audible = self.player.is_playing();
        // While a track is loading the published state mirrors the user's
        // intent, so the button and the tray show what will happen when the
        // load lands; afterwards the audible sink is the truth.
        let playing = if self.loading.is_some() {
            self.desired_playing
        } else {
            audible
        };
        let fingerprint = (
            self.current.as_ref().map(|track| track.id.clone()),
            self.loading.as_ref().map(|track| track.id.clone()),
            playing,
            self.order.shuffled,
            self.order.repeat as u8,
        );
        if let Ok(mut state) = self.state.lock() {
            state.current_track = self.current.clone();
            state.loading = self.loading.clone();
            state.playing = playing;
            state.position = self.player.position();
            state.shuffled = self.order.shuffled;
            state.repeat = self.order.repeat;
        }
        if self.last_fingerprint.as_ref() != Some(&fingerprint) {
            self.last_fingerprint = Some(fingerprint);
            self.ctx.request_repaint();
        }
    }

    fn set_error(&mut self, message: String) {
        if let Ok(mut state) = self.state.lock() {
            state.error = Some(message);
        }
        self.ctx.request_repaint();
    }
}

#[cfg(test)]
mod intent_tests {
    use super::{intent_after_toggle, reconcile_intent};

    #[test]
    fn toggle_follows_the_live_sink_or_flips_a_pending_load() {
        // A live sink decides the intent by its new audible state.
        assert!(!intent_after_toggle(true, true, false, true));
        assert!(intent_after_toggle(true, false, false, true));
        // With only a load in flight the press flips the pending intent.
        assert!(!intent_after_toggle(false, false, true, true));
        assert!(intent_after_toggle(false, false, true, false));
        // Nothing under control: the intent stays put.
        assert!(intent_after_toggle(false, false, false, true));
        assert!(!intent_after_toggle(false, false, false, false));
    }

    #[test]
    fn external_sink_changes_update_the_intent_once() {
        // An explicit play command survives while a paused sink stays put.
        assert_eq!(
            reconcile_intent(true, true, false, Some(false)),
            (true, Some(false))
        );
        // The tray pausing the live sink is mirrored into the intent.
        assert_eq!(
            reconcile_intent(true, true, false, Some(true)),
            (false, Some(false))
        );
        // Resuming it again flips the intent back.
        assert_eq!(
            reconcile_intent(false, true, true, Some(false)),
            (true, Some(true))
        );
        // No live sink: the pending intent is preserved untouched.
        assert_eq!(reconcile_intent(true, false, false, None), (true, None));
    }
}
