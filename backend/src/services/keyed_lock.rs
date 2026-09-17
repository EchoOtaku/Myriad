//! A key exists only while an owner is holding or waiting for its lock.
use std::collections::HashMap;
use std::sync::{Arc, Mutex, Weak};

type Lock = tokio::sync::Mutex<()>;
type Registry = Arc<Mutex<HashMap<String, Weak<Lock>>>>;

#[derive(Default)]
pub(crate) struct KeyedLocks(Registry);

pub(crate) struct KeyedLock {
    registry: Registry,
    key: String,
    lock: Arc<Lock>,
}

impl KeyedLocks {
    pub(crate) fn get(&self, key: &str) -> KeyedLock {
        let mut registry = self.0.lock().unwrap_or_else(|p| p.into_inner());
        let lock = registry
            .get(key)
            .and_then(Weak::upgrade)
            .unwrap_or_else(|| {
                let lock = Arc::new(Lock::new(()));
                registry.insert(key.to_string(), Arc::downgrade(&lock));
                lock
            });
        KeyedLock {
            registry: self.0.clone(),
            key: key.to_string(),
            lock,
        }
    }
}

impl KeyedLock {
    pub(crate) async fn lock(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.lock.lock().await
    }
}

impl Drop for KeyedLock {
    fn drop(&mut self) {
        let mut registry = self.registry.lock().unwrap_or_else(|p| p.into_inner());
        // Acquisition and final removal share this mutex, including canceled waiters.
        if Arc::strong_count(&self.lock) == 1 {
            registry.remove(&self.key);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn aborted_waiter_does_not_remove_active_owners_lock() {
        let locks = Arc::new(KeyedLocks::default());
        let owner = locks.get("shared");
        let guard = owner.lock().await;
        let waiting_locks = locks.clone();
        let (ready, started) = tokio::sync::oneshot::channel();
        let waiter = tokio::spawn(async move {
            let handle = waiting_locks.get("shared");
            ready.send(()).unwrap();
            let _guard = handle.lock().await;
        });
        started.await.unwrap();
        waiter.abort();
        let _ = waiter.await;
        let reconnect = locks.get("shared");
        assert!(Arc::ptr_eq(&owner.lock, &reconnect.lock));
        assert!(reconnect.lock.try_lock().is_err());
        drop(reconnect);
        drop(guard);
        drop(owner);
        assert!(locks.0.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn churn_and_canceled_waiters_release_registry_without_splitting_locks() {
        let locks = KeyedLocks::default();
        for n in 0..1000 {
            let owner = locks.get(&n.to_string());
            let guard = owner.lock().await;
            let waiter = locks.get(&n.to_string());
            assert!(Arc::ptr_eq(&owner.lock, &waiter.lock));
            assert!(waiter.lock.try_lock().is_err());
            drop(waiter);
            assert_eq!(locks.0.lock().unwrap().len(), 1);
            drop(guard);
            drop(owner);
            assert!(locks.0.lock().unwrap().is_empty());
        }
    }
}
