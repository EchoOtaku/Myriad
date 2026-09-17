//! Small process-local caches: fixed capacity, expiring values, no background task.
use std::borrow::Borrow;
use std::collections::HashMap;
use std::hash::Hash;
use std::time::{Duration, Instant};

struct Entry<V> {
    value: V,
    expires: Instant,
    accessed: Instant,
}

pub(crate) struct RetainedCache<K, V> {
    entries: HashMap<K, Entry<V>>,
    capacity: usize,
    ttl: Duration,
}

impl<K: Clone + Eq + Hash, V> RetainedCache<K, V> {
    pub(crate) fn new(capacity: usize, ttl: Duration) -> Self {
        Self {
            entries: HashMap::new(),
            capacity,
            ttl,
        }
    }

    pub(crate) fn get<Q: ?Sized + Eq + Hash>(&mut self, key: &Q) -> Option<&V>
    where
        K: Borrow<Q>,
    {
        self.get_at(key, Instant::now())
    }

    fn get_at<Q: ?Sized + Eq + Hash>(&mut self, key: &Q, now: Instant) -> Option<&V>
    where
        K: Borrow<Q>,
    {
        self.purge_at(now);
        let entry = self.entries.get_mut(key)?;
        entry.accessed = now;
        Some(&entry.value)
    }

    pub(crate) fn insert(&mut self, key: K, value: V) {
        self.insert_with_ttl(key, value, self.ttl);
    }

    pub(crate) fn insert_with_ttl(&mut self, key: K, value: V, ttl: Duration) {
        self.insert_at(key, value, ttl, Instant::now());
    }

    fn insert_at(&mut self, key: K, value: V, ttl: Duration, now: Instant) {
        self.purge_at(now);
        if self.capacity == 0 {
            return;
        }
        if self.entries.len() >= self.capacity && !self.entries.contains_key(&key) {
            if let Some(oldest) = self
                .entries
                .iter()
                .min_by_key(|(_, e)| e.accessed)
                .map(|(k, _)| k.clone())
            {
                self.entries.remove(&oldest);
            }
        }
        self.entries.insert(
            key,
            Entry {
                value,
                expires: now + ttl,
                accessed: now,
            },
        );
    }

    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.entries.len()
    }

    pub(crate) fn purge_expired(&mut self) {
        self.purge_at(Instant::now());
    }

    fn purge_at(&mut self, now: Instant) {
        self.entries.retain(|_, entry| entry.expires > now);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn churn_is_bounded_and_idle_sweep_releases_values() {
        let now = Instant::now();
        let ttl = Duration::from_secs(60);
        let mut cache = RetainedCache::new(32, ttl);
        for id in 0..50_000 {
            cache.insert_at(id, vec![0u8; 128], ttl, now);
        }
        assert_eq!(cache.entries.len(), 32);
        cache.purge_at(now + ttl);
        assert!(cache.entries.is_empty());
    }

    #[test]
    fn access_protects_recent_values_but_does_not_extend_freshness() {
        let now = Instant::now();
        let ttl = Duration::from_secs(60);
        let mut cache = RetainedCache::new(2, ttl);
        cache.insert_at("a", 1, ttl, now);
        cache.insert_at("b", 2, ttl, now + Duration::from_secs(1));
        assert_eq!(cache.get_at("a", now + Duration::from_secs(2)), Some(&1));
        cache.insert_at("c", 3, ttl, now + Duration::from_secs(3));
        assert!(!cache.entries.contains_key("b"));
        assert_eq!(cache.get_at("a", now + ttl), None);
        assert_eq!(cache.get_at("c", now + ttl), Some(&3));
    }

    #[test]
    fn replacement_does_not_evict_other_keys_and_entry_ttls_differ() {
        let now = Instant::now();
        let ttl = Duration::from_secs(60);
        let mut cache = RetainedCache::new(2, ttl);
        cache.insert_at("a", 1, ttl, now);
        cache.insert_at("b", 2, ttl, now);
        cache.insert_at("a", 3, Duration::from_secs(1), now);
        assert_eq!(cache.entries.len(), 2);
        cache.purge_at(now + Duration::from_secs(1));
        assert_eq!(cache.entries.len(), 1);
        assert_eq!(cache.get_at("b", now + Duration::from_secs(1)), Some(&2));
    }
}
