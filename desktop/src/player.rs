use anyhow::{Context, Result};
use rodio::{Decoder, OutputStream, OutputStreamBuilder, Sink, Source};
use std::fs::File;
use std::io::BufReader;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

/// Thread-safe handle used by the Windows tray callback to control the
/// currently loaded sink even while the main viewport is hidden.
pub type PlaybackHandle = Arc<Mutex<Option<Arc<Sink>>>>;

#[derive(Default)]
pub struct PlaybackCompletionWatcher {
    observed_sink: Option<usize>,
}

impl PlaybackCompletionWatcher {
    pub fn observe(&mut self, handle: &PlaybackHandle) -> bool {
        let sink = handle
            .lock()
            .ok()
            .and_then(|shared_sink| shared_sink.clone());
        let Some(sink) = sink else {
            self.observed_sink = None;
            return false;
        };

        let sink_id = Arc::as_ptr(&sink) as usize;
        if self
            .observed_sink
            .is_some_and(|observed| observed != sink_id)
        {
            self.observed_sink = None;
        }
        observe_sink_state(
            &mut self.observed_sink,
            sink_id,
            sink.is_paused(),
            sink.empty(),
        )
    }
}

fn observe_sink_state(
    observed_sink: &mut Option<usize>,
    sink_id: usize,
    paused: bool,
    empty: bool,
) -> bool {
    if empty {
        return observed_sink.take() == Some(sink_id);
    }
    if !paused {
        *observed_sink = Some(sink_id);
    }
    false
}

fn decode_file(path: &Path) -> Result<Decoder<BufReader<File>>> {
    let file = File::open(path).context("cannot open downloaded audio")?;
    // Pass file length and seekability so FLAC can use byte-based random access.
    Decoder::try_from(file).context("Mihonban returned audio that the native decoder cannot read")
}

fn decoder_seek_limit(source: &impl Source) -> Option<Duration> {
    // The FLAC demuxer cannot locate a frame at EOF. Seek to the final
    // audio frame and let normal playback finish it instead.
    let frame = Duration::from_nanos(1_000_000_000u64.div_ceil(u64::from(source.sample_rate())));
    source
        .total_duration()
        .map(|duration| duration.saturating_sub(frame))
}

pub struct AudioPlayer {
    stream: Option<OutputStream>,
    sink: Option<Arc<Sink>>,
    playback_handle: PlaybackHandle,
    seek_limit: Option<Duration>,
    title: String,
    source_path: Option<PathBuf>,
    remove_source_on_stop: bool,
}

impl AudioPlayer {
    /// Create a player that publishes its live sink through `playback_handle`
    /// so other threads can control playback without the UI loop.
    pub fn with_handle(playback_handle: PlaybackHandle) -> Self {
        let stream = OutputStreamBuilder::open_default_stream()
            .ok()
            .map(|mut stream| {
                stream.log_on_drop(false);
                stream
            });
        Self {
            stream,
            sink: None,
            playback_handle,
            seek_limit: None,
            title: String::new(),
            source_path: None,
            remove_source_on_stop: false,
        }
    }

    pub fn play_file(&mut self, title: &str, path: PathBuf, remove_on_stop: bool) -> Result<()> {
        self.stop();
        let stream = self
            .stream
            .as_ref()
            .context("no Windows audio output is available")?;
        let source = decode_file(&path)?;
        self.seek_limit = decoder_seek_limit(&source);
        let sink = Arc::new(Sink::connect_new(stream.mixer()));
        sink.append(source);
        sink.play();
        self.sink = Some(sink.clone());
        if let Ok(mut shared_sink) = self.playback_handle.lock() {
            *shared_sink = Some(sink);
        }
        self.title = title.to_owned();
        self.source_path = Some(path);
        self.remove_source_on_stop = remove_on_stop;
        Ok(())
    }

    pub fn toggle(&self) {
        if let Some(sink) = &self.sink {
            toggle_sink(sink);
        }
    }

    /// Return a handle that can be used by native UI callbacks without
    /// borrowing the application state or requiring an egui repaint.
    pub fn playback_handle(&self) -> PlaybackHandle {
        Arc::clone(&self.playback_handle)
    }

    pub fn stop(&mut self) {
        if let Ok(mut shared_sink) = self.playback_handle.lock() {
            *shared_sink = None;
        }
        if let Some(sink) = self.sink.take() {
            sink.stop();
        }
        self.seek_limit = None;
        if let Some(path) = self.source_path.take() {
            if self.remove_source_on_stop {
                let _ = std::fs::remove_file(path);
            }
        }
        self.remove_source_on_stop = false;
    }
    pub fn is_playing(&self) -> bool {
        self.sink
            .as_ref()
            .is_some_and(|sink| !sink.is_paused() && !sink.empty())
    }
    pub fn title(&self) -> &str {
        &self.title
    }
    pub fn position(&self) -> Duration {
        self.sink
            .as_ref()
            .map_or(Duration::ZERO, |sink| sink.get_pos())
    }

    pub fn finished(&self) -> bool {
        self.sink.as_ref().is_some_and(|sink| sink.empty())
    }

    pub fn set_volume(&self, volume: f32) {
        if let Some(sink) = &self.sink {
            sink.set_volume(volume.clamp(0.0, 1.0));
        }
    }

    pub fn seek(&mut self, position: Duration) -> Result<()> {
        let sink = self.sink.as_ref().context("no audio track is loaded")?;
        anyhow::ensure!(!sink.empty(), "the current audio track has finished");
        let position = self
            .seek_limit
            .map_or(position, |limit| position.min(limit));
        sink.try_seek(position)
            .map_err(|error| anyhow::anyhow!("cannot seek in this audio stream: {error}"))?;
        Ok(())
    }
}

/// Toggle the loaded sink and return whether it is playing after the change.
pub fn toggle_shared_playback(handle: &PlaybackHandle) -> Option<bool> {
    let sink = handle
        .lock()
        .ok()
        .and_then(|shared_sink| shared_sink.clone());
    let sink = sink.as_ref()?;
    toggle_sink(sink);
    Some(!sink.is_paused() && !sink.empty())
}

fn toggle_sink(sink: &Sink) {
    if sink.is_paused() {
        sink.play();
    } else {
        sink.pause();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    const FLAC: &[u8] = include_bytes!("../tests/fixtures/seek-stereo.flac");

    #[test]
    fn completion_watcher_signals_only_after_an_observed_playback_ends() {
        let mut observed = None;
        assert!(!observe_sink_state(&mut observed, 1, false, false));
        assert_eq!(observed, Some(1));
        assert!(!observe_sink_state(&mut observed, 1, true, false));
        assert_eq!(observed, Some(1));
        assert!(observe_sink_state(&mut observed, 1, true, true));
        assert_eq!(observed, None);
        assert!(!observe_sink_state(&mut observed, 1, false, true));
    }

    #[test]
    fn completion_watcher_does_not_report_a_replaced_sink_as_finished() {
        let mut observed = Some(1);
        assert!(!observe_sink_state(&mut observed, 2, false, false));
        assert_eq!(observed, Some(2));
        assert!(observe_sink_state(&mut observed, 2, false, true));
    }

    #[test]
    fn shared_playback_toggle_controls_a_sink_without_the_ui_loop() {
        let (sink, _queue) = Sink::new();
        sink.append(rodio::source::SineWave::new(440.0).take_duration(Duration::from_secs(1)));
        let sink = Arc::new(sink);
        let handle = Arc::new(Mutex::new(Some(Arc::clone(&sink))));
        assert!(!sink.is_paused());
        assert_eq!(toggle_shared_playback(&handle), Some(false));
        assert!(sink.is_paused());
        assert_eq!(toggle_shared_playback(&handle), Some(true));
        assert!(!sink.is_paused());
    }

    #[test]
    fn shared_playback_toggle_without_a_sink_has_no_playback_state() {
        let handle = Arc::new(Mutex::new(None));
        assert_eq!(toggle_shared_playback(&handle), None);
    }

    #[test]
    fn shared_playback_toggle_does_not_report_an_empty_sink_as_playing() {
        let (sink, _queue) = Sink::new();
        let handle = Arc::new(Mutex::new(Some(Arc::new(sink))));
        assert_eq!(toggle_shared_playback(&handle), Some(false));
        assert_eq!(toggle_shared_playback(&handle), Some(false));
    }

    fn fixture(bytes: &[u8]) -> tempfile::NamedTempFile {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(bytes).unwrap();
        file.flush().unwrap();
        file
    }

    fn assert_seek_samples(file: &tempfile::NamedTempFile, times_ms: &[u64]) {
        let mut decoder = decode_file(file.path()).unwrap();
        let rate = u64::from(decoder.sample_rate());
        let channels = u64::from(decoder.channels());
        let reference: Vec<_> = decode_file(file.path()).unwrap().collect();
        for &millis in times_ms {
            decoder.try_seek(Duration::from_millis(millis)).unwrap();
            let offset = (millis * rate / 1000 * channels) as usize;
            let actual: Vec<_> = decoder.by_ref().take(512).collect();
            assert_eq!(
                actual,
                reference[offset..offset + 512],
                "seek to {millis} ms"
            );
        }
    }

    #[test]
    fn file_backed_flac_seeks_both_directions_without_a_seek_table() {
        assert_eq!(&FLAC[..4], b"fLaC");
        let mut offset = 4;
        loop {
            let header = &FLAC[offset..offset + 4];
            assert_ne!(header[0] & 0x7f, 3, "fixture must not contain a SEEKTABLE");
            let length = u32::from_be_bytes([0, header[1], header[2], header[3]]) as usize;
            offset += 4 + length;
            if header[0] & 0x80 != 0 {
                break;
            }
        }
        let file = fixture(FLAC);
        let decoder = decode_file(file.path()).unwrap();
        assert_eq!(decoder.channels(), 2);
        assert_eq!(decoder.total_duration(), Some(Duration::from_millis(4250)));
        assert_seek_samples(&file, &[2500, 125, 3750, 0, 4100, 1250, 5]);
    }

    #[test]
    fn file_backed_pcm_wav_seeks_preserve_stereo_channels() {
        let rate = 48000u32;
        let frames = rate * 3;
        let data_size = frames * 4;
        let mut bytes = Vec::with_capacity(data_size as usize + 44);
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(data_size + 36).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&2u16.to_le_bytes());
        bytes.extend_from_slice(&rate.to_le_bytes());
        bytes.extend_from_slice(&(rate * 4).to_le_bytes());
        bytes.extend_from_slice(&4u16.to_le_bytes());
        bytes.extend_from_slice(&16u16.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&data_size.to_le_bytes());
        for frame in 0..frames {
            let left = ((frame * 17) % 32000) as i16;
            let right = -(((frame * 29) % 32000) as i16);
            bytes.extend_from_slice(&left.to_le_bytes());
            bytes.extend_from_slice(&right.to_le_bytes());
        }
        let file = fixture(&bytes);
        assert_seek_samples(&file, &[2000, 125, 2500, 0, 1000, 5]);
    }

    #[test]
    fn flac_end_seek_finishes_the_last_frame_and_can_seek_back() {
        let file = fixture(FLAC);
        let mut decoder = decode_file(file.path()).unwrap();
        let limit = decoder_seek_limit(&decoder).unwrap();
        for target in [Duration::from_millis(4250), Duration::from_secs(9)] {
            decoder.try_seek(target.min(limit)).unwrap();
            let final_samples: Vec<_> = decoder.by_ref().collect();
            assert!(!final_samples.is_empty());
            assert!(final_samples.len() <= 4);
            decoder.try_seek(Duration::ZERO).unwrap();
            assert!(decoder.next().is_some());
        }
    }
}
