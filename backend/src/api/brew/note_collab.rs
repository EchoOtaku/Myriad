//! 手记协同：一篇文档一个广播房间。存在感 + 整篇快照，revision 做冲突。

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use tokio::sync::broadcast;

const ROOM_CAP: usize = 64;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NoteCollabEvent {
    #[serde(rename = "type")]
    pub kind: String,
    pub peer_id: String,
    pub user_id: i32,
    pub name: Option<String>,
    pub revision: Option<i64>,
    pub cursor: Option<i32>,
    pub title: Option<String>,
    pub content_md: Option<String>,
    pub topic: Option<String>,
    pub image: Option<String>,
}

pub struct NoteCollabHub {
    rooms: Mutex<HashMap<i32, broadcast::Sender<NoteCollabEvent>>>,
}

impl NoteCollabHub {
    fn new() -> Self {
        Self {
            rooms: Mutex::new(HashMap::new()),
        }
    }

    pub fn subscribe(&self, doc_id: i32) -> broadcast::Receiver<NoteCollabEvent> {
        self.sender(doc_id).subscribe()
    }

    pub fn publish(&self, doc_id: i32, event: NoteCollabEvent) {
        let _ = self.sender(doc_id).send(event);
    }

    fn sender(&self, doc_id: i32) -> broadcast::Sender<NoteCollabEvent> {
        let mut rooms = self.rooms.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        rooms
            .entry(doc_id)
            .or_insert_with(|| broadcast::channel(ROOM_CAP).0)
            .clone()
    }
}

static HUB: OnceCell<Arc<NoteCollabHub>> = OnceCell::new();

pub fn note_collab_hub() -> Arc<NoteCollabHub> {
    HUB.get_or_init(|| Arc::new(NoteCollabHub::new())).clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn room_broadcasts_to_subscribers() {
        let hub = NoteCollabHub::new();
        let mut rx = hub.subscribe(7);
        hub.publish(
            7,
            NoteCollabEvent {
                kind: "join".into(),
                peer_id: "a".into(),
                user_id: 1,
                name: Some("Ada".into()),
                revision: None,
                cursor: Some(4),
                title: None,
                content_md: None,
                topic: None,
                image: None,
            },
        );
        let event = rx.recv().await.expect("event");
        assert_eq!(event.kind, "join");
        assert_eq!(event.peer_id, "a");
        assert_eq!(event.cursor, Some(4));
    }
}
