use rand::seq::SliceRandom;

#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub enum RepeatMode {
    #[default]
    Off,
    All,
    One,
}

impl RepeatMode {
    pub fn cycle(&mut self) {
        *self = match self {
            Self::Off => Self::All,
            Self::All => Self::One,
            Self::One => Self::Off,
        };
    }

    pub fn label(self) -> &'static str {
        match self {
            Self::Off => "player.repeatOff",
            Self::All => "player.repeatAll",
            Self::One => "player.repeatOne",
        }
    }
}

#[derive(Default)]
pub struct PlaybackOrder {
    order: Vec<usize>,
    position: usize,
    pub shuffled: bool,
    pub repeat: RepeatMode,
}

impl PlaybackOrder {
    pub fn reset(&mut self, length: usize, current: usize) {
        self.order = (0..length).collect();
        self.position = current.min(length.saturating_sub(1));
        if self.shuffled && !self.order.is_empty() {
            self.order.swap(0, self.position);
            self.order[1..].shuffle(&mut rand::thread_rng());
            self.position = 0;
        }
    }

    pub fn toggle_shuffle(&mut self) {
        let current = self.current().unwrap_or(0);
        self.shuffled = !self.shuffled;
        self.reset(self.order.len(), current);
    }

    pub fn current(&self) -> Option<usize> {
        self.order.get(self.position).copied()
    }

    pub fn peek_next(&self) -> Option<usize> {
        self.current()?;
        if self.repeat == RepeatMode::One {
            return self.current();
        }
        if self.position + 1 < self.order.len() {
            Some(self.order[self.position + 1])
        } else if self.repeat == RepeatMode::All {
            self.order.first().copied()
        } else {
            None
        }
    }

    pub fn step(&mut self, forward: bool, automatic: bool) -> Option<usize> {
        self.current()?;
        if automatic && self.repeat == RepeatMode::One {
            return self.current();
        }
        if forward {
            if self.position + 1 < self.order.len() {
                self.position += 1;
            } else if self.repeat == RepeatMode::All {
                self.position = 0;
            } else {
                return None;
            }
        } else if self.position > 0 {
            self.position -= 1;
        } else if self.repeat == RepeatMode::All {
            self.position = self.order.len() - 1;
        }
        self.current()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shuffle_visits_every_track_once_and_previous_retraces_it() {
        for length in [2, 3, 6, 15] {
            let mut order = PlaybackOrder::default();
            order.reset(length, 1);
            order.toggle_shuffle();
            let mut visited = vec![order.current().unwrap()];
            while let Some(index) = order.step(true, true) {
                visited.push(index);
            }
            assert_eq!(visited[0], 1);
            let mut sorted = visited.clone();
            sorted.sort_unstable();
            assert_eq!(sorted, (0..length).collect::<Vec<_>>());
            for expected in visited[..visited.len() - 1].iter().rev() {
                assert_eq!(order.step(false, false), Some(*expected));
            }
            order.toggle_shuffle();
            assert_eq!(order.current(), Some(1));
            assert_eq!(order.step(true, false), (length > 2).then_some(2));
        }
    }

    #[test]
    fn repeat_modes_handle_both_boundaries_and_manual_skip() {
        let mut order = PlaybackOrder::default();
        order.reset(2, 0);
        assert_eq!(order.step(false, false), Some(0));
        assert_eq!(order.step(true, true), Some(1));
        assert_eq!(order.step(true, true), None);
        order.repeat.cycle();
        assert_eq!(order.step(true, true), Some(0));
        assert_eq!(order.step(false, false), Some(1));
        order.repeat.cycle();
        assert_eq!(order.step(true, true), Some(1));
        assert_eq!(order.step(false, false), Some(0));
        assert_eq!(order.step(true, false), Some(1));
        order.repeat.cycle();
        assert_eq!(order.repeat.label(), "player.repeatOff");
    }

    #[test]
    fn empty_and_single_track_queues_are_safe() {
        let mut order = PlaybackOrder::default();
        order.toggle_shuffle();
        assert_eq!(order.step(true, true), None);
        order.reset(1, 0);
        assert_eq!(order.step(true, true), None);
        order.repeat = RepeatMode::All;
        assert_eq!(order.step(true, true), Some(0));
        order.repeat = RepeatMode::One;
        assert_eq!(order.step(true, true), Some(0));
    }

    #[test]
    fn peek_next_follows_repeat_boundaries() {
        let mut order = PlaybackOrder::default();
        order.reset(3, 1);
        assert_eq!(order.peek_next(), Some(2));
        order.step(true, false);
        assert_eq!(order.peek_next(), None);
        order.repeat = RepeatMode::All;
        assert_eq!(order.peek_next(), Some(0));
        order.repeat = RepeatMode::One;
        assert_eq!(order.peek_next(), Some(2));
    }
}
