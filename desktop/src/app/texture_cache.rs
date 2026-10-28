use std::cell::Cell;
use std::collections::HashMap;

struct Entry<V> {
    value: V,
    bytes: usize,
    last_used: Cell<u64>,
    pinned_frame: Cell<u64>,
}

/// Keeps decoded textures within a hard byte budget while retaining visible entries.
pub(super) struct TextureCache<V> {
    entries: HashMap<String, Entry<V>>,
    budget: usize,
    bytes: usize,
    clock: Cell<u64>,
    frame: u64,
}

impl<V> TextureCache<V> {
    pub(super) fn new(budget: usize) -> Self {
        Self {
            entries: HashMap::new(),
            budget,
            bytes: 0,
            clock: Cell::new(0),
            frame: 1,
        }
    }

    /// Adjust the retention budget. Shrinking takes effect as new
    /// textures arrive, so visible entries are never evicted mid-frame.
    pub(super) fn set_budget(&mut self, budget: usize) {
        self.budget = budget.max(1);
    }

    /// Call after consuming pending uploads and before rendering the next frame.
    pub(super) fn begin_frame(&mut self) {
        if self.frame == u64::MAX {
            for entry in self.entries.values() {
                entry.pinned_frame.set(0);
            }
            self.frame = 1;
        } else {
            self.frame += 1;
        }
    }

    fn next_access(&self) -> u64 {
        let next = self.clock.get().saturating_add(1);
        self.clock.set(next);
        next
    }

    /// Reading an entry also protects it from eviction for the current frame.
    pub(super) fn get(&self, key: &str) -> Option<&V> {
        let entry = self.entries.get(key)?;
        entry.last_used.set(self.next_access());
        entry.pinned_frame.set(self.frame);
        Some(&entry.value)
    }

    pub(super) fn contains_key(&self, key: &str) -> bool {
        self.entries.contains_key(key)
    }

    /// Reject admission if keeping the visible entries would exceed the budget.
    /// A rejected replacement leaves the existing entry intact.
    pub(super) fn insert(&mut self, key: String, value: V, bytes: usize) -> bool {
        if bytes > self.budget {
            return false;
        }
        let previous_bytes = self.entries.get(&key).map_or(0, |entry| entry.bytes);
        let mut projected = self.bytes - previous_bytes + bytes;
        let mut victims = Vec::new();
        if projected > self.budget {
            let mut candidates: Vec<_> = self
                .entries
                .iter()
                .filter(|(candidate, entry)| {
                    candidate.as_str() != key && entry.pinned_frame.get() != self.frame
                })
                .map(|(candidate, entry)| (candidate.clone(), entry.last_used.get(), entry.bytes))
                .collect();
            candidates.sort_unstable_by_key(|(_, last_used, _)| *last_used);
            for (candidate, _, candidate_bytes) in candidates {
                victims.push(candidate);
                projected -= candidate_bytes;
                if projected <= self.budget {
                    break;
                }
            }
            if projected > self.budget {
                return false;
            }
        }
        for victim in victims {
            self.remove(&victim);
        }
        self.remove(&key);
        let last_used = self.next_access();
        self.entries.insert(
            key,
            Entry {
                value,
                bytes,
                last_used: Cell::new(last_used),
                pinned_frame: Cell::new(self.frame),
            },
        );
        self.bytes += bytes;
        true
    }

    pub(super) fn remove(&mut self, key: &str) -> Option<V> {
        let entry = self.entries.remove(key)?;
        self.bytes -= entry.bytes;
        Some(entry.value)
    }

    pub(super) fn retain(&mut self, mut keep: impl FnMut(&str, &V) -> bool) {
        self.entries.retain(|key, entry| keep(key, &entry.value));
        self.bytes = self.entries.values().map(|entry| entry.bytes).sum();
    }

    pub(super) fn clear(&mut self) {
        self.entries.clear();
        self.bytes = 0;
    }

    pub(super) fn bytes(&self) -> usize {
        self.bytes
    }

    pub(super) fn len(&self) -> usize {
        self.entries.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[test]
    fn shrinking_the_budget_applies_to_later_inserts() {
        let mut cache = TextureCache::new(30);
        assert!(cache.insert("a".into(), 1, 10));
        assert!(cache.insert("b".into(), 2, 10));
        cache.set_budget(10);
        cache.begin_frame();
        assert!(cache.insert("c".into(), 3, 10));
        assert_eq!(cache.bytes(), 10);
        assert!(cache.contains_key("c"));
        assert!(!cache.contains_key("a"));
    }

    fn evicting_and_clearing_drop_real_egui_texture_handles() {
        use eframe::egui::{Color32, ColorImage, Context, TextureOptions};

        const TEXTURE_BYTES: usize = 128 * 128 * 4;
        let ctx = Context::default();
        let manager = ctx.tex_manager();
        let mut cache = TextureCache::new(2 * TEXTURE_BYTES);
        let mut texture_ids = Vec::new();
        for index in 0..12 {
            cache.begin_frame();
            let texture = ctx.load_texture(
                format!("bounded-cache-{index}"),
                ColorImage::new([128, 128], Color32::WHITE),
                TextureOptions::LINEAR,
            );
            let id = texture.id();
            texture_ids.push(id);
            assert!(cache.insert(index.to_string(), texture, TEXTURE_BYTES));
            assert!(manager.read().meta(id).is_some());
            for evicted in texture_ids.iter().take(texture_ids.len().saturating_sub(2)) {
                assert!(manager.read().meta(*evicted).is_none());
            }
            let delta = manager.write().take_delta();
            if index >= 2 {
                assert!(delta.free.contains(&texture_ids[index - 2]));
            }
        }
        cache.clear();
        for id in &texture_ids {
            assert!(manager.read().meta(*id).is_none());
        }
        let delta = manager.write().take_delta();
        assert!(delta.free.contains(&texture_ids[10]));
        assert!(delta.free.contains(&texture_ids[11]));
    }

    #[test]
    fn hundreds_of_images_stay_within_the_byte_budget() {
        let mut cache = TextureCache::new(64 * 1024 * 1024);
        for index in 0..400 {
            cache.begin_frame();
            assert!(cache.insert(index.to_string(), index, 1024 * 1024));
            assert!(cache.bytes() <= 64 * 1024 * 1024);
        }
        assert_eq!(cache.len(), 64);
        assert!(!cache.contains_key("0"));
        assert_eq!(cache.get("399"), Some(&399));
    }

    #[test]
    fn least_recently_read_image_is_evicted_first() {
        let mut cache = TextureCache::new(20);
        assert!(cache.insert("a".into(), 1, 10));
        assert!(cache.insert("b".into(), 2, 10));
        cache.begin_frame();
        assert_eq!(cache.get("a"), Some(&1));
        cache.begin_frame();
        assert!(cache.insert("c".into(), 3, 10));
        assert!(cache.contains_key("a"));
        assert!(!cache.contains_key("b"));
        assert!(cache.contains_key("c"));
    }

    #[test]
    fn visible_images_are_pinned_until_the_next_frame() {
        let mut cache = TextureCache::new(20);
        assert!(cache.insert("a".into(), 1, 10));
        assert!(cache.insert("b".into(), 2, 10));
        cache.begin_frame();
        cache.get("a");
        cache.get("b");
        assert!(!cache.insert("c".into(), 3, 10));
        assert_eq!(cache.bytes(), 20);
        assert_eq!(cache.len(), 2);
        cache.begin_frame();
        assert!(cache.insert("c".into(), 3, 10));
        assert!(!cache.contains_key("a"));
        assert!(cache.contains_key("b"));
    }

    #[test]
    fn replacement_updates_bytes_and_preserves_an_unadmitted_entry() {
        let mut cache = TextureCache::new(20);
        assert!(cache.insert("a".into(), 1, 10));
        assert!(cache.insert("b".into(), 2, 10));
        assert!(cache.insert("a".into(), 3, 5));
        assert_eq!(cache.bytes(), 15);
        assert!(!cache.insert("a".into(), 4, 15));
        assert_eq!(cache.get("a"), Some(&3));
        assert_eq!(cache.bytes(), 15);
        assert!(!cache.insert("oversized".into(), 5, 21));
        assert_eq!(cache.len(), 2);
    }

    #[test]
    fn retaining_removing_and_clearing_release_the_accounted_bytes() {
        let mut cache = TextureCache::new(40);
        for index in 0..4 {
            assert!(cache.insert(index.to_string(), index, 10));
        }
        cache.retain(|_, value| *value % 2 == 0);
        assert_eq!(cache.len(), 2);
        assert_eq!(cache.bytes(), 20);
        assert_eq!(cache.remove("2"), Some(2));
        assert_eq!(cache.bytes(), 10);
        cache.clear();
        assert_eq!(cache.bytes(), 0);
        assert_eq!(cache.len(), 0);
    }
}
