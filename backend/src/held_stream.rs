use std::{
    pin::Pin,
    task::{Context, Poll},
};

use futures::Stream;

/// Keeps `guard` alive until the inner stream is dropped.
///
/// Field drop order is explicit and edition-independent. Admission permits,
/// cancel senders, and presence guards belong here rather than as tail
/// temporaries of a generator body.
pub(crate) struct HeldStream<S, G> {
    inner: S,
    _guard: G,
}

impl<S, G> HeldStream<S, G> {
    pub(crate) fn new(inner: S, guard: G) -> Self {
        Self {
            inner,
            _guard: guard,
        }
    }
}

impl<S, G> Stream for HeldStream<S, G>
where
    S: Stream,
{
    type Item = S::Item;

    fn poll_next(self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        // SAFETY: `inner` is pinned when `HeldStream` is pinned. `_guard` is
        // never moved out or pinned independently.
        unsafe { self.map_unchecked_mut(|this| &mut this.inner) }.poll_next(cx)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures::stream::{self, StreamExt};
    use std::sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    };

    struct DropRec(Arc<Mutex<Vec<&'static str>>>, &'static str);

    impl Drop for DropRec {
        fn drop(&mut self) {
            self.0.lock().expect("drop log").push(self.1);
        }
    }

    struct DropFlag(Arc<AtomicBool>);

    impl Drop for DropFlag {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }

    #[test]
    fn inner_drops_before_guard() {
        let log = Arc::new(Mutex::new(Vec::new()));
        drop(HeldStream::new(
            DropRec(log.clone(), "inner"),
            DropRec(log.clone(), "guard"),
        ));
        assert_eq!(*log.lock().expect("drop log"), ["inner", "guard"]);
    }

    #[tokio::test]
    async fn guard_stays_until_the_stream_value_is_dropped() {
        let dropped = Arc::new(AtomicBool::new(false));
        let mut stream = HeldStream::new(stream::iter([1, 2, 3]), DropFlag(dropped.clone()));
        assert!(!dropped.load(Ordering::SeqCst));
        assert_eq!(stream.next().await, Some(1));
        assert!(!dropped.load(Ordering::SeqCst));
        assert_eq!(stream.next().await, Some(2));
        assert_eq!(stream.next().await, Some(3));
        assert_eq!(stream.next().await, None);
        assert!(
            !dropped.load(Ordering::SeqCst),
            "permit/guard must survive stream exhaustion"
        );
        drop(stream);
        assert!(dropped.load(Ordering::SeqCst));
    }
}
