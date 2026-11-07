use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tokio::sync::watch;

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize, Deserialize)]
struct Entry {
    file: String,
    bytes: u64,
    accessed: u64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct Index {
    entries: HashMap<String, Entry>,
}

#[derive(Clone)]
pub struct CacheStore {
    root: PathBuf,
    max_bytes: u64,
    enabled: bool,
    scope: String,
    state: Arc<Mutex<Index>>,
    generation: Arc<AtomicU64>,
    generation_changed: watch::Sender<u64>,
    active_temps: Arc<Mutex<std::collections::HashSet<PathBuf>>>,
}

/// Own the original download path until it is handed to the cache or player.
/// The file must close before cleanup, including when an async task is dropped.
pub(crate) struct TemporaryAudio<'a> {
    cache: &'a CacheStore,
    path: PathBuf,
    file: Option<fs::File>,
    armed: bool,
}

impl TemporaryAudio<'_> {
    pub(crate) fn file_mut(&mut self) -> &mut fs::File {
        self.file.as_mut().expect("temporary audio file is open")
    }

    pub(crate) fn finish(
        mut self,
        key: &str,
        extension: &str,
        generation: u64,
    ) -> Result<PathBuf> {
        drop(self.file.take());
        let path = self
            .cache
            .commit_temp_at_generation(key, extension, &self.path, generation)?;
        self.armed = false;
        Ok(path)
    }
}

impl Drop for TemporaryAudio<'_> {
    fn drop(&mut self) {
        drop(self.file.take());
        if self.armed {
            // Commit may have renamed the file before an index write failed.
            // Only the original temporary path belongs to this guard.
            let _ = self.cache.discard_temp(&self.path);
        }
    }
}

impl CacheStore {
    pub fn new(
        root: impl Into<PathBuf>,
        max_bytes: u64,
        enabled: bool,
        scope: impl Into<String>,
    ) -> Self {
        let root = root.into();
        let index_path = root.join("index.json");
        let index = fs::read(&index_path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let mut index: Index = index;
        index.entries.retain(|_, entry| {
            Path::new(&entry.file)
                .file_name()
                .is_some_and(|name| name == entry.file.as_str())
        });
        let (generation_changed, _) = watch::channel(0);
        let store = Self {
            root,
            max_bytes: max_bytes.max(1),
            enabled,
            scope: scope.into(),
            state: Arc::new(Mutex::new(index)),
            generation: Arc::new(AtomicU64::new(0)),
            generation_changed,
            active_temps: Arc::new(Mutex::new(std::collections::HashSet::new())),
        };
        store.sweep_stale_partials(Duration::from_secs(600));
        store
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn max_bytes(&self) -> u64 {
        self.max_bytes
    }

    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::Acquire)
    }

    pub fn generation_is_current(&self, generation: u64) -> bool {
        self.generation() == generation
    }

    pub fn clear_receiver(&self) -> watch::Receiver<u64> {
        self.generation_changed.subscribe()
    }

    fn index_path(&self) -> PathBuf {
        self.root.join("index.json")
    }

    fn key(&self, key: &str) -> String {
        format!("{}:{key}", self.scope)
    }

    fn file_name(&self, key: &str, extension: &str) -> String {
        let digest = Sha256::digest(self.key(key).as_bytes());
        let ext: String = extension
            .trim_start_matches('.')
            .chars()
            .filter(|character| character.is_ascii_alphanumeric())
            .take(12)
            .collect();
        if ext.is_empty() {
            format!("{digest:x}.bin")
        } else {
            format!("{digest:x}.{ext}")
        }
    }

    fn persist(&self, index: &Index) -> Result<()> {
        fs::create_dir_all(&self.root).context("cannot create cache directory")?;
        let temp = self.root.join("index.json.tmp");
        fs::write(
            &temp,
            serde_json::to_vec(index).context("cannot encode cache index")?,
        )?;
        if self.index_path().exists() {
            let _ = fs::remove_file(self.index_path());
        }
        fs::rename(temp, self.index_path()).context("cannot replace cache index")
    }

    fn now() -> u64 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis() as u64
    }

    pub fn get(&self, key: &str) -> Option<PathBuf> {
        if !self.enabled {
            return None;
        }
        let scoped = self.key(key);
        let mut index = self.state.lock().ok()?;
        let entry = index.entries.get_mut(&scoped)?;
        let path = self.root.join(&entry.file);
        if !path.is_file() {
            index.entries.remove(&scoped);
            let _ = self.persist(&index);
            return None;
        }
        entry.accessed = Self::now();
        // Persist access times with the next cache mutation, not on every image hit.
        Some(path)
    }

    pub fn size_bytes(&self) -> u64 {
        self.state
            .lock()
            .map(|index| index.entries.values().map(|entry| entry.bytes).sum())
            .unwrap_or(0)
    }

    /// Remove abandoned `.part` downloads left by an earlier run or an
    /// aborted transfer so they cannot accumulate next to the cache.
    pub fn sweep_stale_partials(&self, older_than: Duration) {
        if !self.enabled {
            return;
        }
        let Ok(entries) = fs::read_dir(&self.root) else {
            return;
        };
        let cutoff = SystemTime::now()
            .checked_sub(older_than)
            .unwrap_or(UNIX_EPOCH);
        for entry in entries.flatten() {
            let name = entry.file_name();
            if !name.to_string_lossy().contains(".part.") {
                continue;
            }
            let path = entry.path();
            if self
                .active_temps
                .lock()
                .map(|active| active.contains(&path))
                .unwrap_or(true)
            {
                continue;
            }
            let Ok(metadata) = entry.metadata() else {
                continue;
            };
            if metadata.modified().unwrap_or(UNIX_EPOCH) < cutoff {
                let _ = fs::remove_file(&path);
            }
        }
    }

    pub fn entry_path(&self, key: &str, extension: &str) -> PathBuf {
        self.root.join(self.file_name(key, extension))
    }

    pub fn temporary_path_at_generation(
        &self,
        key: &str,
        extension: &str,
        generation: u64,
    ) -> Result<PathBuf> {
        anyhow::ensure!(
            !self.enabled || self.generation_is_current(generation),
            "cache was cleared during the download"
        );
        let base = if self.enabled {
            self.root.clone()
        } else {
            std::env::temp_dir()
        };
        let suffix: String = extension
            .chars()
            .filter(|character| character.is_ascii_alphanumeric())
            .take(12)
            .collect();
        let serial = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let path = base.join(format!(
            "{}.{}.{}.part.{suffix}",
            self.file_name(key, "bin"),
            std::process::id(),
            serial
        ));
        if self.enabled {
            let mut active = self
                .active_temps
                .lock()
                .map_err(|_| anyhow::anyhow!("cache temporary-file list is unavailable"))?;
            anyhow::ensure!(
                self.generation_is_current(generation),
                "cache was cleared during the download"
            );
            active.insert(path.clone());
        }
        Ok(path)
    }

    pub(crate) fn temporary_audio_at_generation(
        &self,
        key: &str,
        extension: &str,
        generation: u64,
    ) -> Result<TemporaryAudio<'_>> {
        let path = self.temporary_path_at_generation(key, extension, generation)?;
        let mut temp = TemporaryAudio {
            cache: self,
            path,
            file: None,
            armed: true,
        };
        if let Some(parent) = temp.path.parent() {
            fs::create_dir_all(parent).context("cannot create cache directory")?;
        }
        temp.file = Some(fs::File::create(&temp.path).context("cannot create cache audio file")?);
        Ok(temp)
    }

    #[cfg(test)]
    pub(crate) fn active_temp_paths(&self) -> Vec<PathBuf> {
        self.active_temps.lock().unwrap().iter().cloned().collect()
    }

    pub fn discard_temp(&self, temp: &Path) -> Result<()> {
        if let Ok(mut active) = self.active_temps.lock() {
            active.remove(temp);
        }
        match fs::remove_file(temp) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error)
                .with_context(|| format!("cannot remove temporary cache file {}", temp.display())),
        }
    }

    pub fn commit_temp_at_generation(
        &self,
        key: &str,
        extension: &str,
        temp: &Path,
        generation: u64,
    ) -> Result<PathBuf> {
        if !self.enabled {
            if let Ok(mut active) = self.active_temps.lock() {
                active.remove(temp);
            }
            return Ok(temp.to_path_buf());
        }
        let mut index = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("cache index is unavailable"))?;
        if !self.generation_is_current(generation) {
            drop(index);
            let _ = self.discard_temp(temp);
            anyhow::bail!("cache was cleared during the download");
        }
        let result = (|| {
            fs::create_dir_all(&self.root).context("cannot create cache directory")?;
            let file = self.file_name(key, extension);
            let destination = self.root.join(&file);
            let bytes = fs::metadata(temp)?.len();
            if bytes > self.max_bytes {
                let safe_extension: String = extension
                    .chars()
                    .filter(|character| character.is_ascii_alphanumeric())
                    .take(12)
                    .collect();
                let playback_path = std::env::temp_dir().join(format!(
                    "mihonban-oversize-{}-{}.{}",
                    std::process::id(),
                    TEMP_COUNTER.fetch_add(1, Ordering::Relaxed),
                    safe_extension
                ));
                fs::rename(temp, &playback_path).context("cannot stage oversized cache entry")?;
                if let Ok(mut active) = self.active_temps.lock() {
                    active.remove(temp);
                }
                return Ok(playback_path);
            }
            if destination.exists() {
                fs::remove_file(&destination).context("cannot replace old cache entry")?;
            }
            fs::rename(temp, &destination).context("cannot commit cache entry")?;
            if let Ok(mut active) = self.active_temps.lock() {
                active.remove(temp);
            }
            let scoped = self.key(key);
            if let Some(previous) = index.entries.insert(
                scoped,
                Entry {
                    file,
                    bytes,
                    accessed: Self::now(),
                },
            ) {
                if previous.file != self.file_name(key, extension) {
                    let _ = fs::remove_file(self.root.join(previous.file));
                }
            }
            self.evict_locked(&mut index)?;
            self.persist(&index)?;
            Ok(destination)
        })();
        drop(index);
        if result.is_err() {
            let _ = self.discard_temp(temp);
        }
        result
    }

    pub fn put_bytes(&self, key: &str, extension: &str, bytes: &[u8]) -> Result<PathBuf> {
        if !self.enabled {
            return Err(anyhow::anyhow!("cache is disabled"));
        }
        fs::create_dir_all(&self.root).context("cannot create cache directory")?;
        let generation = self.generation();
        let temp = self.temporary_path_at_generation(key, extension, generation)?;
        if let Err(error) = fs::write(&temp, bytes).context("cannot write cache entry") {
            let _ = self.discard_temp(&temp);
            return Err(error);
        }
        self.commit_temp_at_generation(key, extension, &temp, generation)
    }

    fn evict_locked(&self, index: &mut Index) -> Result<()> {
        let mut total: u64 = index.entries.values().map(|entry| entry.bytes).sum();
        while total > self.max_bytes {
            let Some((key, entry)) = index
                .entries
                .iter()
                .min_by_key(|(_, entry)| entry.accessed)
                .map(|(key, entry)| (key.clone(), entry.clone()))
            else {
                break;
            };
            let _ = fs::remove_file(self.root.join(entry.file));
            index.entries.remove(&key);
            total -= entry.bytes;
        }
        Ok(())
    }

    pub fn clear(&self) -> Result<()> {
        let generation = self.generation.fetch_add(1, Ordering::AcqRel) + 1;
        self.generation_changed.send_replace(generation);
        let mut index = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("cache index is unavailable"))?;
        index.entries.clear();
        let active = self
            .active_temps
            .lock()
            .map_err(|_| anyhow::anyhow!("cache temporary-file list is unavailable"))?;
        let mut first_error = None;
        if self.root.exists() {
            for entry in fs::read_dir(&self.root).context("cannot read cache directory")? {
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(error) => {
                        first_error.get_or_insert(error);
                        continue;
                    }
                };
                let path = entry.path();
                if active.contains(&path) {
                    continue;
                }
                let file_type = match entry.file_type() {
                    Ok(file_type) => file_type,
                    Err(error) => {
                        first_error.get_or_insert(error);
                        continue;
                    }
                };
                if !file_type.is_file() {
                    continue;
                }
                let result = fs::remove_file(&path);
                if let Err(error) = result {
                    first_error.get_or_insert(error);
                }
            }
        }
        drop(active);
        self.persist(&index)?;
        if let Some(error) = first_error {
            return Err(error).context("some cache files could not be removed");
        }
        Ok(())
    }

    pub fn enforce_limit(&self) -> Result<()> {
        let mut index = self
            .state
            .lock()
            .map_err(|_| anyhow::anyhow!("cache index is unavailable"))?;
        self.evict_locked(&mut index)?;
        self.persist(&index)
    }
}

#[cfg(test)]
mod tests {
    use super::CacheStore;
    use std::fs;

    fn store(max: u64) -> (CacheStore, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        (CacheStore::new(dir.path(), max, true, "profile"), dir)
    }

    #[test]
    fn temporary_audio_drop_closes_file_and_unregisters_it() {
        use std::io::Write;
        let (cache, _dir) = store(100);
        let mut temp = cache.temporary_audio_at_generation("audio:a", "flac", 0).unwrap();
        let path = temp.path.clone();
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // Deny deletion while this owned handle is open, so this test checks
            // close-before-discard rather than relying on Rust's delete sharing.
            temp.file = Some(fs::OpenOptions::new().write(true).share_mode(3).open(&path).unwrap());
        }
        temp.file_mut().write_all(b"partial").unwrap();
        assert_eq!(cache.active_temp_paths(), vec![path.clone()]);
        drop(temp);
        assert!(!path.exists());
        assert!(cache.active_temp_paths().is_empty());
    }

    #[test]
    fn temporary_audio_directory_failure_does_not_leave_a_registration() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("not-a-directory");
        fs::write(&root, b"block directory creation").unwrap();
        let cache = CacheStore::new(&root, 100, true, "failure");
        assert!(cache.temporary_audio_at_generation("audio:a", "flac", 0).is_err());
        assert!(cache.active_temp_paths().is_empty());
        assert_eq!(fs::read(root).unwrap(), b"block directory creation");
    }

    #[test]
    fn temporary_audio_rejects_clear_before_creation_and_before_commit() {
        use std::io::Write;
        let (cache, _dir) = store(100);
        let generation = cache.generation();
        let mut temp = cache.temporary_audio_at_generation("audio:a", "flac", generation).unwrap();
        let path = temp.path.clone();
        temp.file_mut().write_all(b"partial").unwrap();
        cache.clear().unwrap();
        assert!(path.exists(), "clear must leave an actively owned file alone");
        assert!(cache.temporary_audio_at_generation("audio:b", "flac", generation).is_err());
        assert!(temp.finish("audio:a", "flac", generation).is_err());
        assert!(!path.exists());
        assert!(cache.active_temp_paths().is_empty());
        assert_eq!(cache.size_bytes(), 0);
    }

    #[test]
    fn failed_index_persistence_does_not_delete_the_committed_audio() {
        use std::io::Write;
        let (cache, _dir) = store(100);
        let mut temp = cache.temporary_audio_at_generation("audio:a", "flac", 0).unwrap();
        let original = temp.path.clone();
        temp.file_mut().write_all(b"complete audio").unwrap();
        fs::create_dir(cache.root().join("index.json.tmp")).unwrap();
        assert!(temp.finish("audio:a", "flac", 0).is_err());
        assert!(!original.exists());
        assert!(cache.active_temp_paths().is_empty());
        assert_eq!(fs::read(cache.get("audio:a").unwrap()).unwrap(), b"complete audio");
        assert_eq!(cache.size_bytes(), 14);
    }

    #[test]
    fn failed_commit_before_rename_discards_the_original_audio() {
        use std::io::Write;
        let (cache, _dir) = store(100);
        let mut temp = cache.temporary_audio_at_generation("audio:a", "flac", 0).unwrap();
        let original = temp.path.clone();
        temp.file_mut().write_all(b"complete audio").unwrap();
        let destination = cache.entry_path("audio:a", "flac");
        fs::create_dir(&destination).unwrap();
        assert!(temp.finish("audio:a", "flac", 0).is_err());
        assert!(!original.exists());
        assert!(destination.is_dir());
        assert!(cache.active_temp_paths().is_empty());
        assert_eq!(cache.size_bytes(), 0);
    }

    #[cfg(windows)]
    #[test]
    fn locked_temp_is_unregistered_and_can_be_swept_after_the_lock_closes() {
        use std::os::windows::fs::OpenOptionsExt;
        let (cache, _dir) = store(100);
        let temp = cache.temporary_audio_at_generation("audio:a", "flac", 0).unwrap();
        let path = temp.path.clone();
        // Allow reads/writes but not deletion, unlike Rust's default sharing mode.
        let lock = fs::OpenOptions::new().read(true).share_mode(3).open(&path).unwrap();
        drop(temp);
        assert!(path.exists());
        assert!(cache.active_temp_paths().is_empty());
        let old = std::time::SystemTime::now() - std::time::Duration::from_secs(3600);
        drop(lock);
        fs::File::options().write(true).open(&path).unwrap()
            .set_times(fs::FileTimes::new().set_modified(old)).unwrap();
        cache.sweep_stale_partials(std::time::Duration::from_secs(600));
        assert!(!path.exists());
    }

    fn old_evict(cache: &CacheStore, index: &mut super::Index) {
        while index.entries.values().map(|entry| entry.bytes).sum::<u64>() > cache.max_bytes {
            let Some((key, entry)) = index.entries.iter()
                .min_by_key(|(_, entry)| entry.accessed)
                .map(|(key, entry)| (key.clone(), entry.clone())) else { break };
            let _ = fs::remove_file(cache.root.join(entry.file));
            index.entries.remove(&key);
        }
    }

    #[test]
    fn eviction_matches_old_algorithm_at_every_victim_boundary_with_ties_and_file_errors() {
        use super::{Entry, Index};
        let original = Index { entries: (0..16).map(|i| (format!("key-{i}"), Entry {
            file: format!("{i}.flac"), bytes: i + 1, accessed: i / 4,
        })).collect() };
        let total: u64 = original.entries.values().map(|entry| entry.bytes).sum();
        // Cloning this exact map preserves the hash seed, iteration order and ties.
        // Every budget checks each cumulative victim prefix, not only final survivors.
        for max in 1..=total {
            let (old_cache, _old_dir) = store(max);
            let (new_cache, _new_dir) = store(max);
            for cache in [&old_cache, &new_cache] {
                for i in 0..16 {
                    let path = cache.root.join(format!("{i}.flac"));
                    match i % 3 {
                        0 => fs::write(path, b"audio").unwrap(),
                        1 => fs::create_dir(path).unwrap(),
                        _ => {}, // Missing files and failed deletions still remove index entries.
                    }
                }
            }
            let mut old = Index { entries: original.entries.clone() };
            let mut new = Index { entries: original.entries.clone() };
            old_evict(&old_cache, &mut old);
            new_cache.evict_locked(&mut new).unwrap();
            assert_eq!(serde_json::to_value(&old).unwrap(), serde_json::to_value(&new).unwrap(),
                "victim prefix differs at budget {max}");
            for entry in original.entries.values() {
                assert_eq!(old_cache.root.join(&entry.file).exists(), new_cache.root.join(&entry.file).exists());
            }
        }
    }

    #[test]
    fn multi_eviction_replacement_and_clear_persist_the_same_survivors_on_reload() {
        let (cache, dir) = store(12);
        for (i, key) in ["a", "b", "c"].into_iter().enumerate() {
            cache.put_bytes(key, "bin", b"1234").unwrap();
            cache.state.lock().unwrap().entries.get_mut(&cache.key(key)).unwrap().accessed = i as u64;
        }
        cache.put_bytes("d", "bin", b"123456789").unwrap();
        assert_eq!(cache.size_bytes(), 9);
        assert_eq!(cache.state.lock().unwrap().entries.len(), 1);
        let previous = cache.entry_path("d", "bin");
        let replacement = cache.put_bytes("d", "flac", b"replace").unwrap();
        assert!(!previous.exists());
        assert_eq!(cache.size_bytes(), 7);
        let reloaded = CacheStore::new(dir.path(), 12, true, "profile");
        assert_eq!(reloaded.size_bytes(), 7);
        assert_eq!(reloaded.get("d"), Some(replacement));
        let mut smaller = reloaded.clone();
        smaller.max_bytes = 3;
        smaller.enforce_limit().unwrap();
        assert_eq!(CacheStore::new(dir.path(), 3, true, "profile").size_bytes(), 0);
        cache.clear().unwrap();
        let cleared = CacheStore::new(dir.path(), 12, true, "profile");
        assert_eq!(cleared.size_bytes(), 0);
        assert!(cleared.get("d").is_none());
    }

    #[test]
    #[ignore = "synthetic release benchmark; not an application FPS or memory measurement"]
    fn benchmark_eviction_single_sum_against_old_loop() {
        use super::{Entry, Index};
        use std::time::Instant;
        let (cache, _dir) = store(512);
        let original = Index { entries: (0..2048).map(|i| (format!("key-{i}"), Entry {
            file: format!("missing-{i}.flac"), bytes: 1, accessed: i / 4,
        })).collect() };
        let mut old_times = Vec::new();
        let mut new_times = Vec::new();
        for sample in 0..23 {
            let mut old = Index { entries: original.entries.clone() };
            let mut new = Index { entries: original.entries.clone() };
            // Alternate order to reduce systematic filesystem/CPU warm-up bias.
            let mut measure_old = || {
                let start = Instant::now();
                old_evict(&cache, &mut old);
                if sample >= 3 { old_times.push(start.elapsed()); }
            };
            let mut measure_new = || {
                let start = Instant::now();
                cache.evict_locked(&mut new).unwrap();
                if sample >= 3 { new_times.push(start.elapsed()); }
            };
            if sample % 2 == 0 { measure_old(); measure_new(); }
            else { measure_new(); measure_old(); }
            assert_eq!(serde_json::to_value(old).unwrap(), serde_json::to_value(new).unwrap());
        }
        old_times.sort();
        new_times.sort();
        eprintln!("synthetic eviction, 2048 -> 512 entries (missing files), 20 samples: old median={:?} p95={:?}; new median={:?} p95={:?}",
            old_times[10], old_times[18], new_times[10], new_times[18]);
    }

    #[test]
    fn stores_and_hits_entries() {
        let (cache, _dir) = store(100);
        let path = cache.put_bytes("cover:a", "jpg", b"hello").unwrap();
        assert_eq!(fs::read(cache.get("cover:a").unwrap()).unwrap(), b"hello");
        assert_eq!(path.extension().unwrap(), "jpg");
    }

    #[test]
    fn enforces_limit_with_lru_eviction() {
        let (cache, _dir) = store(6);
        cache.put_bytes("a", "bin", b"1234").unwrap();
        cache
            .state
            .lock()
            .unwrap()
            .entries
            .get_mut(&cache.key("a"))
            .unwrap()
            .accessed = 0;
        cache.put_bytes("b", "bin", b"5678").unwrap();
        assert!(cache.get("a").is_none());
        assert!(cache.get("b").is_some());
        assert!(cache.size_bytes() <= 6);
    }

    #[test]
    fn cache_hits_update_lru_without_rewriting_the_disk_index() {
        let (cache, _dir) = store(100);
        cache.put_bytes("cover:a", "jpg", b"hello").unwrap();
        {
            let mut index = cache.state.lock().unwrap();
            index
                .entries
                .get_mut(&cache.key("cover:a"))
                .unwrap()
                .accessed = 0;
            cache.persist(&index).unwrap();
        }
        let persisted = fs::read(cache.index_path()).unwrap();
        for _ in 0..100 {
            assert!(cache.get("cover:a").is_some());
        }
        assert_eq!(fs::read(cache.index_path()).unwrap(), persisted);
        assert!(cache.state.lock().unwrap().entries[&cache.key("cover:a")].accessed > 0);
    }

    #[test]
    fn cache_mutations_evict_by_memory_touches_and_persist_them_together() {
        let (cache, dir) = store(8);
        let a = cache.put_bytes("a", "bin", b"aaaa").unwrap();
        let b = cache.put_bytes("b", "bin", b"bbbb").unwrap();
        {
            let mut index = cache.state.lock().unwrap();
            index.entries.get_mut(&cache.key("a")).unwrap().accessed = 1;
            index.entries.get_mut(&cache.key("b")).unwrap().accessed = 2;
            cache.persist(&index).unwrap();
        }
        assert_eq!(cache.get("a"), Some(a.clone()));
        let c = cache.put_bytes("c", "bin", b"cccc").unwrap();
        assert!(a.is_file());
        assert!(!b.exists());
        assert!(c.is_file());
        assert_eq!(cache.size_bytes(), 8);

        let reloaded = CacheStore::new(dir.path(), 8, true, "profile");
        let index = reloaded.state.lock().unwrap();
        assert!(index.entries[&cache.key("a")].accessed > 2);
        assert!(!index.entries.contains_key(&cache.key("b")));
        assert!(index.entries.contains_key(&cache.key("c")));
    }

    #[test]
    fn profiles_are_isolated() {
        let dir = tempfile::tempdir().unwrap();
        let first = CacheStore::new(dir.path(), 100, true, "one");
        let second = CacheStore::new(dir.path(), 100, true, "two");
        first.put_bytes("audio:t", "flac", b"one").unwrap();
        assert!(second.get("audio:t").is_none());
    }

    #[test]
    fn clear_removes_entries() {
        let (cache, _dir) = store(100);
        cache.put_bytes("a", "bin", b"1").unwrap();
        cache.clear().unwrap();
        assert!(cache.get("a").is_none());
        assert_eq!(cache.size_bytes(), 0);
    }

    #[test]
    fn clear_removes_unindexed_partial_downloads() {
        let (cache, _dir) = store(100);
        let orphan = cache.root().join("orphan.1234.0.part.flac");
        fs::write(&orphan, b"unfinished audio").unwrap();

        cache.clear().unwrap();

        assert!(!orphan.exists());
        assert_eq!(cache.size_bytes(), 0);
    }

    #[test]
    fn clear_invalidates_active_download_before_it_can_commit() {
        let (cache, _dir) = store(100);
        let generation = cache.generation();
        let temp = cache
            .temporary_path_at_generation("audio:a", "flac", generation)
            .unwrap();
        fs::write(&temp, b"unfinished audio").unwrap();

        cache.clear().unwrap();

        assert!(cache.generation() > generation);
        assert!(cache
            .commit_temp_at_generation("audio:a", "flac", &temp, generation)
            .is_err());
        assert!(!temp.exists());
        assert_eq!(cache.size_bytes(), 0);
    }
}

#[cfg(test)]
mod sweep_tests {
    use super::*;

    #[test]
    fn stale_partials_are_swept_but_fresh_and_committed_files_survive() {
        let dir = tempfile::tempdir().unwrap();
        let store = CacheStore::new(dir.path().join("media"), 1024 * 1024, true, "test");
        let root = store.root().to_path_buf();
        fs::create_dir_all(&root).unwrap();
        let stale = root.join("aaaa.bin.1.1.part.flac");
        let fresh = root.join("bbbb.bin.2.2.part.flac");
        let committed = root.join("cccc.flac");
        fs::write(&stale, b"stale").unwrap();
        fs::write(&fresh, b"fresh").unwrap();
        fs::write(&committed, b"done").unwrap();
        let old = SystemTime::now() - Duration::from_secs(3600);
        let times = fs::FileTimes::new().set_modified(old);
        fs::File::options()
            .write(true)
            .open(&stale)
            .unwrap()
            .set_times(times)
            .unwrap();
        store.sweep_stale_partials(Duration::from_secs(600));
        assert!(!stale.exists());
        assert!(fresh.exists());
        assert!(committed.exists());
    }
}
