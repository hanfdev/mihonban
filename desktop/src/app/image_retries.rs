use std::{
    collections::HashMap,
    time::{Duration, Instant},
};

const IMAGE_RETRY_DELAY: Duration = Duration::from_secs(30);

#[derive(Default)]
pub(super) struct ImageRetries {
    retry_after: HashMap<String, Instant>,
}

impl ImageRetries {
    /// Missing or corrupt resources must not trigger a request on every UI frame.
    pub(super) fn can_retry(&mut self, id: &str, now: Instant) -> bool {
        match self.retry_after.get(id) {
            Some(&deadline) if deadline > now => false,
            Some(_) => {
                self.retry_after.remove(id);
                true
            }
            None => true,
        }
    }

    pub(super) fn failed(&mut self, id: String, now: Instant) {
        self.retry_after.insert(id, now + IMAGE_RETRY_DELAY);
    }

    pub(super) fn succeeded(&mut self, id: &str) {
        self.retry_after.remove(id);
    }

    pub(super) fn clear(&mut self) {
        self.retry_after.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn failing_images_wait_without_blocking_other_images() {
        let now = Instant::now();
        let mut retries = ImageRetries::default();
        assert!(retries.can_retry("broken", now));
        retries.failed("broken".into(), now);
        for second in 0..30 {
            assert!(!retries.can_retry("broken", now + Duration::from_secs(second)));
            assert!(retries.can_retry("healthy", now + Duration::from_secs(second)));
        }
        assert!(retries.can_retry("broken", now + IMAGE_RETRY_DELAY));
        assert!(retries.retry_after.is_empty());
    }

    #[test]
    fn success_and_profile_changes_clear_previous_failures() {
        let now = Instant::now();
        let mut retries = ImageRetries::default();
        retries.failed("cover".into(), now);
        retries.succeeded("cover");
        assert!(retries.can_retry("cover", now));
        retries.failed("artist".into(), now);
        retries.clear();
        assert!(retries.can_retry("artist", now));
    }
}
