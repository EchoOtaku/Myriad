//! Feishu long-connection Frame (pbbp2) and session loop.
//!
//! Framing matches `larksuite-oapi-sdk-rs` 0.2.0 `proto/ws.proto` (MIT).
//! Handshake: POST `/callback/ws/endpoint` with AppID/AppSecret, then WSS.
//! method 0 = control (ping/pong); method 1 = data (event + ACK).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use futures::{SinkExt, StreamExt};
use myriad_agent_rules::channel::{
    ConnectFailureKind, FEISHU_CARD_ACTION_TRIGGER, FEISHU_MESSAGE_RECEIVE_V1,
    classify_feishu_handshake, parse_feishu_event_envelope,
};
use myriad_error::redact_secrets;
use prost::Message as ProstMessage;
use tokio::sync::{Mutex, watch};
use tokio_tungstenite::tungstenite::Message;
use tracing::{info, warn};

const METHOD_CONTROL: i32 = 0;
const METHOD_DATA: i32 = 1;
const MSG_TYPE_EVENT: &str = "event";
const MSG_TYPE_PING: &str = "ping";
const MSG_TYPE_PONG: &str = "pong";
const HEADER_TYPE: &str = "type";
const HEADER_SUM: &str = "sum";
const HEADER_SEQ: &str = "seq";
const HEADER_MESSAGE_ID: &str = "message_id";
const HEADER_BIZ_RT: &str = "biz_rt";
const HEADER_HANDSHAKE_STATUS: &str = "Handshake-Status";
const HEADER_HANDSHAKE_MSG: &str = "Handshake-Msg";
const HEADER_HANDSHAKE_AUTH_ERR_CODE: &str = "Handshake-Autherrcode";
const WS_CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_FRAGMENT_COUNT: usize = 64;
const MAX_EVENT_BYTES: usize = 1024 * 1024;
const MAX_FRAME_BYTES: usize = MAX_EVENT_BYTES + 16 * 1024;
const MAX_PENDING_MESSAGES: usize = 32;
const MAX_PENDING_BYTES: usize = 4 * 1024 * 1024;
const FRAGMENT_TTL: Duration = Duration::from_secs(5);

fn expire_fragments(pending: &mut HashMap<String, FragEntry>) {
    pending.retain(|_, entry| !entry.expired());
    if pending.is_empty() {
        pending.shrink_to_fit();
    }
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Header {
    #[prost(string, required, tag = "1")]
    pub key: String,
    #[prost(string, required, tag = "2")]
    pub value: String,
}

#[derive(Clone, PartialEq, prost::Message)]
pub struct Frame {
    #[prost(uint64, required, tag = "1")]
    pub seq_id: u64,
    #[prost(uint64, required, tag = "2")]
    pub log_id: u64,
    #[prost(int32, required, tag = "3")]
    pub service: i32,
    #[prost(int32, required, tag = "4")]
    pub method: i32,
    #[prost(message, repeated, tag = "5")]
    pub headers: Vec<Header>,
    #[prost(string, optional, tag = "6")]
    pub payload_encoding: Option<String>,
    #[prost(string, optional, tag = "7")]
    pub payload_type: Option<String>,
    #[prost(bytes, optional, tag = "8")]
    pub payload: Option<Vec<u8>>,
    #[prost(string, optional, tag = "9")]
    pub log_id_new: Option<String>,
}

struct FragEntry {
    frames: Vec<Option<Vec<u8>>>,
    created: Instant,
}

impl FragEntry {
    fn new(sum: usize) -> Self {
        Self {
            frames: vec![None; sum],
            created: Instant::now(),
        }
    }

    fn insert(&mut self, index: usize, data: Vec<u8>) {
        if index < self.frames.len() {
            self.frames[index] = Some(data);
        }
    }

    fn complete(&self) -> bool {
        self.frames.iter().all(|f| f.is_some())
    }

    fn assemble(self) -> Vec<u8> {
        self.frames.into_iter().flatten().flatten().collect()
    }

    fn expired(&self) -> bool {
        self.created.elapsed() >= FRAGMENT_TTL
    }
}

fn get_header(headers: &[Header], key: &str) -> Option<String> {
    headers
        .iter()
        .find(|h| h.key == key)
        .map(|h| h.value.clone())
}

fn get_header_int(headers: &[Header], key: &str) -> i32 {
    get_header(headers, key)
        .and_then(|v| v.parse().ok())
        .unwrap_or(0)
}

fn make_header(key: &str, value: &str) -> Header {
    Header {
        key: key.to_string(),
        value: value.to_string(),
    }
}

pub async fn run_session(
    ws_url: &str,
    service_id: i32,
    ping_interval: Duration,
    mut cancel: watch::Receiver<bool>,
) -> Result<(), ConnectFailureKind> {
    info!(gateway = %sanitize_ws_url(ws_url), "Feishu long-connection connecting");
    let (ws, resp) = tokio::select! {
        _ = cancel.changed() => return Ok(()),
        result = tokio::time::timeout(
            WS_CONNECT_TIMEOUT,
            tokio_tungstenite::connect_async_with_config(ws_url, Some(
                tokio_tungstenite::tungstenite::protocol::WebSocketConfig::default()
                    .max_message_size(Some(MAX_FRAME_BYTES))
                    .max_frame_size(Some(MAX_FRAME_BYTES)),
            ), false),
        ) => {
            match result {
                Ok(Ok(stream)) => stream,
                Ok(Err(err)) => {
                    warn!(
                        error = %redact_secrets(&err.to_string()),
                        "Feishu WebSocket connect failed"
                    );
                    return Err(ConnectFailureKind::Transient);
                }
                Err(_) => {
                    warn!(
                        timeout_secs = WS_CONNECT_TIMEOUT.as_secs(),
                        "Feishu WebSocket connect timed out"
                    );
                    return Err(ConnectFailureKind::Transient);
                }
            }
        }
    };
    if resp.status().as_u16() != 101 {
        return Err(classify_handshake(&resp));
    }

    crate::services::feishu_bot::publish_phase_online().await;
    info!("Feishu long-connection online");

    let (write, mut read) = ws.split();
    let write = Arc::new(Mutex::new(write));
    let ping_write = write.clone();
    let ping_secs = ping_interval.max(Duration::from_secs(1)).as_secs();
    let _ping_task = crate::services::channel_work::AbortTask(tokio::spawn(async move {
        let mut timer = tokio::time::interval(Duration::from_secs(ping_secs));
        timer.tick().await;
        loop {
            timer.tick().await;
            let frame = Frame {
                seq_id: 0,
                log_id: 0,
                service: service_id,
                method: METHOD_CONTROL,
                headers: vec![make_header(HEADER_TYPE, MSG_TYPE_PING)],
                payload_encoding: None,
                payload_type: None,
                payload: None,
                log_id_new: None,
            };
            let encoded = frame.encode_to_vec();
            let mut w = ping_write.lock().await;
            if (*w).send(Message::Binary(encoded.into())).await.is_err() {
                break;
            }
        }
    }));

    let mut pending_frags: HashMap<String, FragEntry> = HashMap::new();
    let mut expiry = tokio::time::interval(Duration::from_secs(1));
    expiry.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        tokio::select! {
            _ = cancel.changed() => {
                let mut w = write.lock().await;
                let _ = (*w).close().await;
                break Ok(());
            }
            _ = expiry.tick() => expire_fragments(&mut pending_frags),
            msg = read.next() => {
                match msg {
                    Some(Ok(Message::Binary(data))) => {
                        if let Err(kind) = handle_binary(
                            &data,
                            &mut pending_frags,
                            &write,
                        )
                        .await
                        {
                            break Err(kind);
                        }
                    }
                    Some(Ok(Message::Close(_))) => break Err(ConnectFailureKind::Transient),
                    Some(Ok(_)) => {}
                    Some(Err(err)) => {
                        warn!(
                            error = %redact_secrets(&err.to_string()),
                            "Feishu WebSocket stream error"
                        );
                        break Err(ConnectFailureKind::Transient);
                    }
                    None => break Err(ConnectFailureKind::Transient),
                }
            }
        }
    }
}

fn classify_handshake(
    resp: &tokio_tungstenite::tungstenite::handshake::client::Response,
) -> ConnectFailureKind {
    let headers = resp.headers();
    let status = headers
        .get(HEADER_HANDSHAKE_STATUS)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let auth_err = headers
        .get(HEADER_HANDSHAKE_AUTH_ERR_CODE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    let msg = headers
        .get(HEADER_HANDSHAKE_MSG)
        .and_then(|v| v.to_str().ok())
        .unwrap_or_default();
    warn!(status, auth_err, msg, "Feishu WebSocket handshake rejected");
    classify_feishu_handshake(status, auth_err)
}

async fn handle_binary<S>(
    data: &[u8],
    pending_frags: &mut HashMap<String, FragEntry>,
    write: &Arc<Mutex<S>>,
) -> Result<(), ConnectFailureKind>
where
    S: futures::Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin,
{
    expire_fragments(pending_frags);
    if data.len() > MAX_FRAME_BYTES {
        warn!("Feishu frame exceeds ingress byte limit; reconnecting without ACK");
        return Err(ConnectFailureKind::Transient);
    }
    let mut frame = Frame::decode(data).map_err(|_| ConnectFailureKind::Transient)?;
    match frame.method {
        METHOD_CONTROL => {
            let msg_type = get_header(&frame.headers, HEADER_TYPE).unwrap_or_default();
            if msg_type == MSG_TYPE_PING {
                let pong = Frame {
                    method: METHOD_CONTROL,
                    service: frame.service,
                    seq_id: frame.seq_id,
                    log_id: frame.log_id,
                    headers: vec![make_header(HEADER_TYPE, MSG_TYPE_PONG)],
                    payload_encoding: None,
                    payload_type: None,
                    payload: None,
                    log_id_new: None,
                };
                let encoded = pong.encode_to_vec();
                let mut w = write.lock().await;
                let _ = (*w).send(Message::Binary(encoded.into())).await;
            }
            Ok(())
        }
        METHOD_DATA => {
            let msg_type = get_header(&frame.headers, HEADER_TYPE).unwrap_or_default();
            if msg_type != MSG_TYPE_EVENT {
                return Ok(());
            }
            let sum = get_header_int(&frame.headers, HEADER_SUM);
            let seq = get_header_int(&frame.headers, HEADER_SEQ);
            let msg_id = get_header(&frame.headers, HEADER_MESSAGE_ID).unwrap_or_default();
            let fragment = frame.payload.take().unwrap_or_default();
            if sum < 0 || sum as usize > MAX_FRAGMENT_COUNT || fragment.len() > MAX_EVENT_BYTES {
                warn!("Feishu fragment exceeds count/size limit; reconnecting without ACK");
                return Err(ConnectFailureKind::Transient);
            }
            let payload = if sum <= 1 {
                fragment
            } else {
                if seq < 0 || seq >= sum || msg_id.is_empty() || msg_id.len() > 256 {
                    return Err(ConnectFailureKind::Transient);
                }
                let existing = pending_frags.get(&msg_id);
                if existing.is_some_and(|entry| entry.frames.len() != sum as usize) {
                    return Err(ConnectFailureKind::Transient);
                }
                if existing.is_none() && pending_frags.len() >= MAX_PENDING_MESSAGES {
                    warn!("Feishu pending fragment count exhausted; reconnecting without ACK");
                    return Err(ConnectFailureKind::Transient);
                }
                let replaced = existing
                    .and_then(|entry| entry.frames[seq as usize].as_ref())
                    .map_or(0, Vec::capacity);
                let message_bytes = existing.map_or(0, |entry| {
                    entry
                        .frames
                        .iter()
                        .flatten()
                        .map(Vec::capacity)
                        .sum::<usize>()
                }) - replaced
                    + fragment.capacity();
                let retained: usize = pending_frags
                    .iter()
                    .map(|(key, entry)| {
                        key.capacity()
                            + entry.frames.capacity() * std::mem::size_of::<Option<Vec<u8>>>()
                            + entry
                                .frames
                                .iter()
                                .flatten()
                                .map(Vec::capacity)
                                .sum::<usize>()
                    })
                    .sum();
                let additional_slots = if existing.is_none() {
                    msg_id.len() + sum as usize * std::mem::size_of::<Option<Vec<u8>>>()
                } else {
                    0
                };
                if message_bytes > MAX_EVENT_BYTES
                    || retained - replaced + fragment.capacity() + additional_slots
                        > MAX_PENDING_BYTES
                {
                    warn!("Feishu fragment byte budget exhausted; reconnecting without ACK");
                    return Err(ConnectFailureKind::Transient);
                }
                let entry = pending_frags
                    .entry(msg_id.clone())
                    .or_insert_with(|| FragEntry::new(sum as usize));
                entry.insert(seq as usize, fragment);
                if entry.complete() {
                    match pending_frags.remove(&msg_id) {
                        Some(e) => e.assemble(),
                        None => return Ok(()),
                    }
                } else {
                    return Ok(());
                }
            };
            let start = Instant::now();
            // ACK only after admission. On saturation reconnect so the upstream
            // can retry the unacknowledged message; never block the heartbeat.
            dispatch_event(payload)?;
            let biz_rt = start.elapsed().as_millis().to_string();
            let ack_payload =
                serde_json::to_vec(&serde_json::json!({ "code": 200u16 })).unwrap_or_default();
            let mut ack_headers = frame.headers.clone();
            ack_headers.push(make_header(HEADER_BIZ_RT, &biz_rt));
            let ack = Frame {
                seq_id: frame.seq_id,
                log_id: frame.log_id,
                service: frame.service,
                method: frame.method,
                headers: ack_headers,
                payload_encoding: frame.payload_encoding.clone(),
                payload_type: frame.payload_type.clone(),
                payload: Some(ack_payload),
                log_id_new: frame.log_id_new.clone(),
            };
            let encoded = ack.encode_to_vec();
            let mut w = write.lock().await;
            let _ = (*w).send(Message::Binary(encoded.into())).await;
            Ok(())
        }
        _ => Ok(()),
    }
}

fn dispatch_event(payload: Vec<u8>) -> Result<(), ConnectFailureKind> {
    let Some((event_type, event_id, event)) = parse_feishu_event_envelope(&payload) else {
        return Ok(());
    };
    if !matches!(
        event_type.as_str(),
        FEISHU_MESSAGE_RECEIVE_V1 | FEISHU_CARD_ACTION_TRIGGER
    ) {
        return Ok(());
    }
    let Some(permit) = crate::services::bot_ingress::try_acquire(
        crate::services::bot_ingress::Channel::Feishu,
        crate::services::bot_ingress::json_bytes(&event)
            .saturating_mul(2)
            .saturating_add(event_type.capacity())
            .saturating_add(event_id.capacity()),
    ) else {
        warn!("Feishu ingress busy; reconnecting without acknowledging event");
        return Err(ConnectFailureKind::Transient);
    };
    tokio::spawn(async move {
        let _permit = permit;
        crate::services::feishu_bot::mark_inbound().await;
        match event_type.as_str() {
            FEISHU_MESSAGE_RECEIVE_V1 => {
                if let Some(parsed) =
                    myriad_agent_rules::channel::parse_feishu_message_receive(&event_id, &event)
                {
                    crate::services::feishu_pairing::handle_inbound(parsed).await;
                }
            }
            FEISHU_CARD_ACTION_TRIGGER => {
                if let Some(parsed) =
                    myriad_agent_rules::channel::parse_feishu_card_callback(&event_id, &event)
                {
                    crate::services::feishu_pairing::handle_callback(parsed).await;
                }
            }
            _ => {}
        }
    });
    Ok(())
}

fn sanitize_ws_url(url: &str) -> String {
    match url.split_once('?') {
        Some((base, _)) => format!("{base}?<redacted>"),
        None => url.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use prost::Message as ProstMessage;

    #[test]
    fn frame_roundtrip_preserves_method_and_payload() {
        let frame = Frame {
            seq_id: 3,
            log_id: 9,
            service: 7,
            method: METHOD_DATA,
            headers: vec![make_header(HEADER_TYPE, MSG_TYPE_EVENT)],
            payload_encoding: None,
            payload_type: Some("json".into()),
            payload: Some(b"{\"a\":1}".to_vec()),
            log_id_new: None,
        };
        let bytes = frame.encode_to_vec();
        let decoded = Frame::decode(bytes.as_slice()).expect("decode");
        assert_eq!(decoded.method, METHOD_DATA);
        assert_eq!(decoded.service, 7);
        assert_eq!(
            get_header(&decoded.headers, HEADER_TYPE).as_deref(),
            Some(MSG_TYPE_EVENT)
        );
        assert_eq!(decoded.payload.as_deref(), Some(b"{\"a\":1}".as_slice()));
    }

    #[test]
    fn fragment_assembles_in_seq_order() {
        let mut entry = FragEntry::new(2);
        entry.insert(1, b"b".to_vec());
        entry.insert(0, b"a".to_vec());
        assert!(entry.complete());
        assert_eq!(entry.assemble(), b"ab");
    }

    #[tokio::test]
    async fn heartbeat_stops_when_session_parent_is_aborted() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let (_cancel_tx, cancel_rx) = watch::channel(false);
        let parent = tokio::spawn(async move {
            run_session(
                &format!("ws://{addr}"),
                1,
                Duration::from_secs(1),
                cancel_rx,
            )
            .await
        });
        let (socket, _) = listener.accept().await.unwrap();
        let mut ws = tokio_tungstenite::accept_async(socket).await.unwrap();
        let first = tokio::time::timeout(Duration::from_secs(3), ws.next())
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert!(first.is_binary());

        parent.abort();
        let _ = parent.await;
        let deadline = tokio::time::sleep(Duration::from_millis(1_500));
        tokio::pin!(deadline);
        loop {
            tokio::select! {
                _ = &mut deadline => break,
                after = ws.next() => match after {
                    Some(Ok(message)) => {
                        assert!(!message.is_binary(), "detached ping outlived run_session")
                    }
                    Some(Err(_)) | None => break,
                }
            }
        }
    }
    fn fragment_frame(id: &str, sum: i32, seq: i32, bytes: usize) -> Vec<u8> {
        Frame {
            seq_id: 1,
            log_id: 1,
            service: 1,
            method: METHOD_DATA,
            headers: vec![
                make_header(HEADER_TYPE, MSG_TYPE_EVENT),
                make_header(HEADER_SUM, &sum.to_string()),
                make_header(HEADER_SEQ, &seq.to_string()),
                make_header(HEADER_MESSAGE_ID, id),
            ],
            payload_encoding: None,
            payload_type: None,
            payload: Some(vec![b'x'; bytes]),
            log_id_new: None,
        }
        .encode_to_vec()
    }

    fn accepting_sink() -> Arc<
        Mutex<impl futures::Sink<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin>,
    > {
        Arc::new(Mutex::new(Box::pin(futures::sink::unfold(
            (),
            |(), _: Message| async { Ok::<(), tokio_tungstenite::tungstenite::Error>(()) },
        ))))
    }

    #[tokio::test]
    async fn rejects_fragment_counts_and_indexes_before_allocating() {
        let write = accepting_sink();
        for (sum, seq) in [(1_000_000, 0), (2, -1), (2, 2)] {
            let mut pending = HashMap::new();
            assert!(
                handle_binary(&fragment_frame("bad", sum, seq, 1), &mut pending, &write)
                    .await
                    .is_err()
            );
            assert!(pending.is_empty());
        }
    }

    #[tokio::test]
    async fn fragment_message_cannot_exceed_one_mib_or_change_count() {
        let write = accepting_sink();
        let mut pending = HashMap::new();
        handle_binary(&fragment_frame("big", 2, 0, 600_000), &mut pending, &write)
            .await
            .unwrap();
        assert!(
            handle_binary(&fragment_frame("big", 2, 1, 600_000), &mut pending, &write)
                .await
                .is_err()
        );
        pending.clear();
        handle_binary(&fragment_frame("changed", 2, 0, 1), &mut pending, &write)
            .await
            .unwrap();
        assert!(
            handle_binary(&fragment_frame("changed", 3, 1, 1), &mut pending, &write)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn pending_fragment_count_and_total_bytes_are_bounded() {
        let write = accepting_sink();
        let mut pending = HashMap::new();
        for id in 0..32 {
            handle_binary(
                &fragment_frame(&id.to_string(), 2, 0, 1),
                &mut pending,
                &write,
            )
            .await
            .unwrap();
        }
        assert!(
            handle_binary(&fragment_frame("overflow", 2, 0, 1), &mut pending, &write)
                .await
                .is_err()
        );
        pending.clear();
        for id in 0..6 {
            handle_binary(
                &fragment_frame(&id.to_string(), 2, 0, 600_000),
                &mut pending,
                &write,
            )
            .await
            .unwrap();
        }
        assert!(
            handle_binary(
                &fragment_frame("byte-overflow", 2, 0, 600_000),
                &mut pending,
                &write
            )
            .await
            .is_err()
        );
    }

    #[tokio::test]
    async fn expired_fragments_are_released_on_control_traffic() {
        let write = accepting_sink();
        let mut pending = HashMap::new();
        handle_binary(&fragment_frame("expired", 2, 0, 1), &mut pending, &write)
            .await
            .unwrap();
        pending.get_mut("expired").unwrap().created -= Duration::from_secs(6);
        let frame = Frame {
            seq_id: 1,
            log_id: 1,
            service: 1,
            method: METHOD_CONTROL,
            headers: vec![make_header(HEADER_TYPE, MSG_TYPE_PONG)],
            payload_encoding: None,
            payload_type: None,
            payload: None,
            log_id_new: None,
        };
        handle_binary(&frame.encode_to_vec(), &mut pending, &write)
            .await
            .unwrap();
        assert!(pending.is_empty());
    }
    #[test]
    fn idle_fragment_sweep_releases_expired_payloads_and_bucket_allocation() {
        let mut pending = HashMap::new();
        let mut entry = FragEntry::new(2);
        entry.insert(0, vec![0; 128]);
        entry.created -= Duration::from_secs(6);
        pending.insert("idle".into(), entry);
        expire_fragments(&mut pending);
        assert!(pending.is_empty());
        assert_eq!(pending.capacity(), 0);
    }

    #[tokio::test]
    async fn repeated_fragment_replaces_bytes_and_completion_is_acked_once() {
        let sent = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = sent.clone();
        let write = Arc::new(Mutex::new(Box::pin(futures::sink::unfold(
            (),
            move |(), _: Message| {
                let count = count.clone();
                async move {
                    count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Ok::<(), tokio_tungstenite::tungstenite::Error>(())
                }
            },
        ))));
        let mut pending = HashMap::new();
        let partial = fragment_frame("retry", 2, 0, 600_000);
        for _ in 0..10 {
            handle_binary(&partial, &mut pending, &write).await.unwrap();
        }
        assert_eq!(pending.len(), 1);
        assert_eq!(sent.load(std::sync::atomic::Ordering::SeqCst), 0);
        handle_binary(&fragment_frame("retry", 2, 1, 1), &mut pending, &write)
            .await
            .unwrap();
        assert!(pending.is_empty());
        assert_eq!(sent.load(std::sync::atomic::Ordering::SeqCst), 1);
    }
    #[tokio::test]
    async fn rejected_ingress_does_not_ack_feishu_event() {
        let sent = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let count = sent.clone();
        let write = Arc::new(Mutex::new(Box::pin(futures::sink::unfold(
            (),
            move |(), _: Message| {
                let count = count.clone();
                async move {
                    count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                    Ok::<(), tokio_tungstenite::tungstenite::Error>(())
                }
            },
        ))));
        let mut frame = Frame::decode(fragment_frame("busy", 1, 0, 0).as_slice()).unwrap();
        frame.payload = Some(
            serde_json::to_vec(&serde_json::json!({
                "header": {"event_type": FEISHU_MESSAGE_RECEIVE_V1, "event_id": "busy"},
                "event": {"dense": vec![0; 300_000]},
            }))
            .unwrap(),
        );
        let frame = frame.encode_to_vec();
        assert!(frame.len() < MAX_FRAME_BYTES);
        assert!(
            handle_binary(&frame, &mut HashMap::new(), &write)
                .await
                .is_err()
        );
        assert_eq!(sent.load(std::sync::atomic::Ordering::SeqCst), 0);
    }
}
