//! Federation inbox anti-replay (MYR-023).
//!
//! HTTP Date freshness alone is weak: a signed request can be re-played until
//! the Date falls outside the clock-skew window. This module reserves activity
//! ids / body digests while a handler is running and commits them only after the
//! handler succeeds. Transient failures therefore remain retryable, while
//! concurrent duplicates cannot run the same side effects.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

use super::signature::HTTP_DATE_MAX_SKEW;
use super::types::normalize_activity_id;

/// How long a seen activity id / body digest is remembered.
///
/// Slightly longer than [`HTTP_DATE_MAX_SKEW`] so a request that still has a
/// fresh Date cannot slip past dedup near the edge of the skew window.
pub fn replay_dedup_ttl() -> chrono::Duration {
    HTTP_DATE_MAX_SKEW + chrono::Duration::minutes(5)
}

/// Soft cap on tracked keys (evict oldest on overflow).
const REPLAY_DEDUP_MAX_ENTRIES: usize = 16_384;

/// Build stable dedup keys for an inbound activity.
///
/// - Body digest always (covers pure HTTP signature replay of the same bytes).
/// - Normalized activity `id` when present (covers re-signed redeliveries of
///   the same ActivityPub object within the TTL).
pub fn replay_dedup_keys(activity_id: &str, body: &[u8]) -> Vec<String> {
    let mut keys = Vec::with_capacity(2);
    let digest = Sha256::digest(body);
    keys.push(format!("d:{}", hex::encode(digest)));
    let norm = normalize_activity_id(activity_id);
    if !norm.is_empty() {
        keys.push(format!("a:{norm}"));
    }
    keys
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReplayEntryState {
    InFlight(u64),
    Accepted,
}

#[derive(Clone, Copy, Debug)]
struct ReplayEntry {
    until: Instant,
    state: ReplayEntryState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReplayBegin {
    Fresh(u64),
    InFlight,
    Accepted,
}

struct ReplayCache {
    entries: HashMap<String, ReplayEntry>,
    /// Insertion order for overflow eviction (oldest first).
    order: Vec<String>,
    next_token: u64,
}

impl ReplayCache {
    fn new() -> Self {
        Self {
            entries: HashMap::new(),
            order: Vec::new(),
            next_token: 1,
        }
    }

    fn purge_expired(&mut self, now: Instant) {
        self.order.retain(|k| {
            if self.entries.get(k).is_some_and(|entry| entry.until > now) {
                true
            } else {
                self.entries.remove(k);
                false
            }
        });
    }

    fn begin(&mut self, keys: &[String], ttl: Duration, now: Instant) -> ReplayBegin {
        self.purge_expired(now);

        let mut has_in_flight = false;
        for key in keys {
            match self.entries.get(key).map(|entry| entry.state) {
                Some(ReplayEntryState::Accepted) => return ReplayBegin::Accepted,
                Some(ReplayEntryState::InFlight(_)) => has_in_flight = true,
                None => {}
            }
        }
        if has_in_flight {
            return ReplayBegin::InFlight;
        }

        let token = self.take_token();
        let until = now + ttl;
        for key in keys {
            while self.entries.len() >= REPLAY_DEDUP_MAX_ENTRIES {
                if let Some(old) = self.order.first().cloned() {
                    self.order.remove(0);
                    self.entries.remove(&old);
                } else {
                    break;
                }
            }
            self.entries.insert(
                key.clone(),
                ReplayEntry {
                    until,
                    state: ReplayEntryState::InFlight(token),
                },
            );
            self.order.push(key.clone());
        }
        ReplayBegin::Fresh(token)
    }

    fn take_token(&mut self) -> u64 {
        let token = self.next_token;
        self.next_token = self.next_token.wrapping_add(1).max(1);
        token
    }

    /// Commit only entries still owned by this reservation. The token prevents
    /// an expired handler from overwriting a newer reservation.
    fn commit(&mut self, keys: &[String], token: u64, ttl: Duration, now: Instant) {
        let until = now + ttl;
        for key in keys {
            let Some(entry) = self.entries.get_mut(key) else {
                continue;
            };
            if entry.state == ReplayEntryState::InFlight(token) {
                entry.state = ReplayEntryState::Accepted;
                entry.until = until;
            }
        }
    }

    fn release(&mut self, keys: &[String], token: u64) {
        for key in keys {
            if self
                .entries
                .get(key)
                .is_some_and(|entry| entry.state == ReplayEntryState::InFlight(token))
            {
                self.entries.remove(key);
                self.order.retain(|candidate| candidate != key);
            }
        }
    }

    #[cfg(test)]
    fn len(&self) -> usize {
        self.entries.len()
    }
}

fn global_cache() -> &'static Mutex<ReplayCache> {
    static CACHE: OnceLock<Mutex<ReplayCache>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(ReplayCache::new()))
}

/// Result of reserving an authenticated inbox activity.
pub enum ReplayDecision {
    Fresh(ReplayReservation),
    InFlight,
    Accepted,
}

/// In-flight reservation. Completing an error, or dropping the reservation,
/// releases its keys so the peer can retry the same Activity.
pub struct ReplayReservation {
    keys: Vec<String>,
    token: u64,
    finished: bool,
}

impl ReplayReservation {
    pub fn complete<T, E>(mut self, result: Result<T, E>) -> Result<T, E> {
        if result.is_ok() {
            self.commit();
        }
        result
    }

    fn commit(&mut self) {
        let ttl = std_duration_from_chrono(replay_dedup_ttl());
        let now = Instant::now();
        match global_cache().lock() {
            Ok(mut cache) => cache.commit(&self.keys, self.token, ttl, now),
            Err(poisoned) => {
                tracing::error!(
                    "federation replay cache lock poisoned while committing; resetting"
                );
                let mut cache = poisoned.into_inner();
                *cache = ReplayCache::new();
            }
        }
        self.finished = true;
    }
}

impl Drop for ReplayReservation {
    fn drop(&mut self) {
        if self.finished {
            return;
        }
        match global_cache().lock() {
            Ok(mut cache) => cache.release(&self.keys, self.token),
            Err(poisoned) => {
                tracing::error!("federation replay cache lock poisoned while releasing; resetting");
                let mut cache = poisoned.into_inner();
                *cache = ReplayCache::new();
            }
        }
    }
}

/// Reserve an activity after successful signature verification.
///
/// Fail-open on lock poison so a stuck mutex cannot deny all federation.
pub fn begin_replay(keys: &[String]) -> ReplayDecision {
    let ttl = std_duration_from_chrono(replay_dedup_ttl());
    let now = Instant::now();
    let begin = match global_cache().lock() {
        Ok(mut cache) => cache.begin(keys, ttl, now),
        Err(poisoned) => {
            tracing::error!("federation replay cache lock poisoned; resetting");
            let mut cache = poisoned.into_inner();
            *cache = ReplayCache::new();
            cache.begin(keys, ttl, now)
        }
    };

    match begin {
        ReplayBegin::Fresh(token) => ReplayDecision::Fresh(ReplayReservation {
            keys: keys.to_vec(),
            token,
            finished: false,
        }),
        ReplayBegin::InFlight => ReplayDecision::InFlight,
        ReplayBegin::Accepted => ReplayDecision::Accepted,
    }
}

fn std_duration_from_chrono(d: chrono::Duration) -> Duration {
    Duration::from_secs(d.num_seconds().max(0) as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fresh_token(begin: ReplayBegin) -> u64 {
        match begin {
            ReplayBegin::Fresh(token) => token,
            other => panic!("expected fresh replay reservation, got {other:?}"),
        }
    }

    #[test]
    fn replay_dedup_keys_include_digest_and_normalized_id() {
        let body = br#"{"id":"https://A.example/activities/1/?x=1","type":"Follow"}"#;
        let keys = replay_dedup_keys("https://A.example/activities/1/?x=1#frag", body);
        assert_eq!(keys.len(), 2);
        assert!(keys[0].starts_with("d:"));
        assert_eq!(keys[0].len(), 2 + 64); // d: + sha256 hex
        assert_eq!(keys[1], "a:https://a.example/activities/1");
    }

    #[test]
    fn replay_dedup_keys_digest_only_when_id_missing() {
        let keys = replay_dedup_keys("", b"hello");
        assert_eq!(keys.len(), 1);
        assert!(keys[0].starts_with("d:"));
    }

    #[test]
    fn ttl_is_at_least_date_skew_window() {
        assert!(replay_dedup_ttl() >= HTTP_DATE_MAX_SKEW);
        assert!(replay_dedup_ttl() <= HTTP_DATE_MAX_SKEW + chrono::Duration::minutes(15));
    }

    #[test]
    fn first_sighting_accepted_second_is_replay() {
        let mut cache = ReplayCache::new();
        let keys = replay_dedup_keys("https://peer.example/a/1", b"body-a");
        let ttl = Duration::from_secs(600);
        let t0 = Instant::now();
        let token = fresh_token(cache.begin(&keys, ttl, t0));
        assert_eq!(
            cache.begin(&keys, ttl, t0 + Duration::from_millis(1)),
            ReplayBegin::InFlight
        );
        cache.commit(&keys, token, ttl, t0 + Duration::from_millis(2));
        assert_eq!(
            cache.begin(&keys, ttl, t0 + Duration::from_secs(1)),
            ReplayBegin::Accepted
        );
        // Same activity id, different body → still replay (id key hits).
        let keys2 = replay_dedup_keys("https://peer.example/a/1", b"body-b");
        assert_eq!(
            cache.begin(&keys2, ttl, t0 + Duration::from_secs(2)),
            ReplayBegin::Accepted
        );
        // Different id and body → fresh.
        let keys3 = replay_dedup_keys("https://peer.example/a/2", b"body-c");
        assert!(matches!(
            cache.begin(&keys3, ttl, t0 + Duration::from_secs(3)),
            ReplayBegin::Fresh(_)
        ));
    }

    #[test]
    fn pure_body_replay_caught_without_activity_id() {
        let mut cache = ReplayCache::new();
        let keys = replay_dedup_keys("", b"same-bytes");
        let ttl = Duration::from_secs(600);
        let t0 = Instant::now();
        let token = fresh_token(cache.begin(&keys, ttl, t0));
        cache.commit(&keys, token, ttl, t0);
        assert_eq!(cache.begin(&keys, ttl, t0), ReplayBegin::Accepted);
    }

    #[test]
    fn transient_handler_failure_releases_reservation_for_retry() {
        let mut cache = ReplayCache::new();
        let keys = replay_dedup_keys("https://peer.example/a/transient", b"room-not-ready");
        let ttl = Duration::from_secs(600);
        let t0 = Instant::now();

        let token = fresh_token(cache.begin(&keys, ttl, t0));
        assert_eq!(
            cache.begin(&keys, ttl, t0 + Duration::from_millis(1)),
            ReplayBegin::InFlight
        );

        // Mirrors an inbox handler returning transient 503: do not commit.
        cache.release(&keys, token);
        assert!(matches!(
            cache.begin(&keys, ttl, t0 + Duration::from_secs(1)),
            ReplayBegin::Fresh(_)
        ));
        assert_eq!(cache.order.len(), keys.len());
    }

    #[test]
    fn public_reservation_releases_after_handler_error() {
        let keys = replay_dedup_keys(
            "https://peer.example/a/public-transient-test",
            b"key-exchange-before-room-invite",
        );
        let reservation = match begin_replay(&keys) {
            ReplayDecision::Fresh(reservation) => reservation,
            _ => panic!("first public reservation should be fresh"),
        };

        let result: Result<(), ()> = reservation.complete(Err(()));
        assert!(result.is_err());
        assert!(matches!(begin_replay(&keys), ReplayDecision::Fresh(_)));
    }

    #[test]
    fn stale_release_does_not_remove_a_newer_reservation() {
        let mut cache = ReplayCache::new();
        let keys = replay_dedup_keys("https://peer.example/a/reowned", b"same-body");
        let ttl = Duration::from_secs(1);
        let t0 = Instant::now();

        let stale_token = fresh_token(cache.begin(&keys, ttl, t0));
        let current_token = fresh_token(cache.begin(&keys, ttl, t0 + Duration::from_secs(2)));

        cache.release(&keys, stale_token);
        assert_eq!(
            cache.begin(&keys, ttl, t0 + Duration::from_millis(2500)),
            ReplayBegin::InFlight
        );

        cache.release(&keys, current_token);
        assert!(matches!(
            cache.begin(&keys, ttl, t0 + Duration::from_secs(3)),
            ReplayBegin::Fresh(_)
        ));
    }

    #[test]
    fn expired_entries_allow_reaccept() {
        let mut cache = ReplayCache::new();
        let keys = replay_dedup_keys("https://peer.example/a/x", b"z");
        let ttl = Duration::from_secs(10);
        let t0 = Instant::now();
        let token = fresh_token(cache.begin(&keys, ttl, t0));
        cache.commit(&keys, token, ttl, t0);
        assert_eq!(
            cache.begin(&keys, ttl, t0 + Duration::from_secs(1)),
            ReplayBegin::Accepted
        );
        // After TTL, purged on next call.
        assert!(matches!(
            cache.begin(&keys, ttl, t0 + Duration::from_secs(11)),
            ReplayBegin::Fresh(_)
        ));
    }

    #[test]
    fn overflow_evicts_oldest() {
        let mut cache = ReplayCache::new();
        let ttl = Duration::from_secs(600);
        let t0 = Instant::now();
        // Fill past the soft cap with unique digests.
        for i in 0..(REPLAY_DEDUP_MAX_ENTRIES + 8) {
            let body = format!("body-{i}");
            let keys = replay_dedup_keys("", body.as_bytes());
            let token = fresh_token(cache.begin(&keys, ttl, t0));
            cache.commit(&keys, token, ttl, t0);
        }
        assert!(cache.len() <= REPLAY_DEDUP_MAX_ENTRIES);
        // First body should have been evicted.
        let first = replay_dedup_keys("", b"body-0");
        assert!(matches!(
            cache.begin(&first, ttl, t0),
            ReplayBegin::Fresh(_)
        ));
    }
}
