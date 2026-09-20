//! Bounded, typed playlist loading for the player; never populates the raw JSON cache.
use super::*;
use crate::services::music_player_view::PlayerMusicSource;
use serde::{Deserialize, de::DeserializeOwned};

// Per-response limit: initial detail has up to 1000 tracks; later batches have
// 200. Two public playlists fetched to 5000 tracks peaked at 3.23 MiB per response.
const MAX_PLAYLIST_BODY_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug)]
struct PlaylistBodyError(String);

impl std::fmt::Display for PlaylistBodyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}
impl std::error::Error for PlaylistBodyError {}

pub(super) async fn read_playlist_json<T: DeserializeOwned>(
    response: reqwest::Response,
) -> Result<T> {
    let body = crate::services::outbound_security::read_limited_body(
        response.error_for_status()?,
        MAX_PLAYLIST_BODY_BYTES,
    )
    .await
    .map_err(PlaylistBodyError)?;
    Ok(serde_json::from_slice(&body)?)
}

#[derive(Deserialize)]
struct PlaylistResponse {
    code: i64,
    playlist: PlaylistDetail,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PlaylistDetail {
    #[serde(default)]
    track_count: usize,
    #[serde(default)]
    track_ids: Vec<TrackId>,
    #[serde(default)]
    tracks: Vec<Track>,
}

#[derive(Deserialize)]
struct TrackId {
    id: i64,
}

#[derive(Deserialize)]
struct SongResponse {
    code: i64,
    #[serde(default)]
    songs: Vec<Track>,
}

#[derive(Deserialize)]
struct Named {
    name: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Album {
    name: Option<String>,
    pic_url: Option<String>,
    blur_pic_url: Option<String>,
}

#[derive(Deserialize)]
struct Track {
    id: Option<Value>,
    name: Option<String>,
    #[serde(alias = "artists")]
    ar: Option<Vec<Named>>,
    #[serde(alias = "album")]
    al: Option<Album>,
    #[serde(alias = "duration")]
    dt: Option<i64>,
    fee: Option<i64>,
    #[serde(rename = "isVip")]
    is_vip: Option<bool>,
}

impl Track {
    fn into_song(self) -> Option<PlayerSong> {
        let id = match self.id? {
            Value::String(id) if !id.trim().is_empty() => id.trim().to_owned(),
            Value::Number(id) if id.is_i64() || id.is_u64() => id.to_string(),
            _ => return None,
        };
        let artists = self.ar.unwrap_or_default();
        let names: Vec<_> = artists
            .iter()
            .filter_map(|artist| artist.name.as_deref())
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .collect();
        let artist = if names.is_empty() {
            "Unknown".into()
        } else {
            names.join(", ")
        };
        let (album, cover) = self
            .al
            .map(|album| {
                (
                    album.name.unwrap_or_default(),
                    album.pic_url.or(album.blur_pic_url).unwrap_or_default(),
                )
            })
            .unwrap_or_default();
        Some(PlayerSong {
            id,
            name: self.name.unwrap_or_default(),
            artist,
            album,
            cover: if cover.is_empty() {
                cover
            } else {
                ensure_https_url(&cover)
            },
            duration: self.dt.unwrap_or(0).max(0) / 1000,
            is_vip: self.is_vip.unwrap_or(matches!(self.fee, Some(1 | 4))),
        })
    }
}

impl NeteaseService {
    /// The caller coalesces misses, checks the limiter once, and caches the result.
    pub async fn fetch_player_playlist(&self, playlist_id: i64) -> Result<PlayerPlaylist> {
        let url =
            format!("https://music.163.com/api/v6/playlist/detail?id={playlist_id}&n=1000&s=0&t=0");
        let response = self
            .request_playlist_json(&url, Duration::from_secs(30))
            .await?;
        let detail: PlaylistResponse = read_playlist_json(response).await?;
        if detail.code != 200 {
            return Err(anyhow!("Netease API returned error code {}", detail.code));
        }
        complete_playlist(playlist_id, detail.playlist, |url| async move {
            tokio::time::sleep(Duration::from_millis(150 + rand::random::<u64>() % 150)).await;
            let response = self
                .request_playlist_json(&url, Duration::from_secs(15))
                .await?;
            read_playlist_json::<SongResponse>(response).await
        })
        .await
    }
}

async fn complete_playlist<F, Fut>(
    playlist_id: i64,
    detail: PlaylistDetail,
    mut fetch_batch: F,
) -> Result<PlayerPlaylist>
where
    F: FnMut(String) -> Fut,
    Fut: std::future::Future<Output = Result<SongResponse>>,
{
    let PlaylistDetail {
        track_count,
        track_ids,
        tracks,
    } = detail;
    let loaded_tracks = tracks.len();
    let mut songs: Vec<_> = tracks
        .into_iter()
        .take(MAX_TRACKS_LIMIT)
        .filter_map(Track::into_song)
        .collect();
    let target = track_count.min(track_ids.len()).min(MAX_TRACKS_LIMIT);
    if loaded_tracks >= 1000 && target > loaded_tracks {
        let mut failures = 0;
        for ids in track_ids[loaded_tracks..target].chunks(200) {
            let ids = ids
                .iter()
                .map(|track| track.id.to_string())
                .collect::<Vec<_>>()
                .join(",");
            let url = format!("https://music.163.com/api/song/detail?ids=[{ids}]");
            let batch = fetch_batch(url).await;
            match batch {
                Ok(batch) if batch.code == 200 => {
                    songs.extend(
                        batch
                            .songs
                            .into_iter()
                            .take(MAX_TRACKS_LIMIT.saturating_sub(songs.len()))
                            .filter_map(Track::into_song),
                    );
                }
                Err(error) if error.downcast_ref::<PlaylistBodyError>().is_some() => {
                    return Err(error);
                }
                _ => {
                    // Preserve the existing best-effort behavior for unavailable batches.
                    failures += 1;
                    tracing::warn!(playlist_id, failures, "Failed to load playlist song batch");
                    if failures >= 3 {
                        break;
                    }
                }
            }
        }
    }
    Ok(PlayerPlaylist {
        code: 200,
        source: PlayerMusicSource::Netease,
        playlist_id: playlist_id.to_string(),
        songs,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::services::music_player_view::project_netease_player_playlist;

    #[test]
    fn typed_tracks_match_existing_player_fields() {
        let tracks = json!([
            {"id": 111, "name": "Song", "ar": [{"name": " A "}, {"name": "B"}],
             "al": {"name": "Album", "picUrl": "http://p1.music.126.net/x.jpg"}, "dt": 240000, "fee": 1,
             "unused": {"large": [1, 2, 3]}},
            {"id": "222", "artists": [{"name": "C"}], "album": {"blurPicUrl": "http://p1.music.126.net/y.jpg"},
             "duration": 61000, "fee": 4, "isVip": false},
            {"id": 333, "dt": -100, "ar": null, "al": null},
            {"name": "missing id"}, {"id": " "}
        ]);
        let expected =
            project_netease_player_playlist("42", &json!({"playlist": {"tracks": tracks}}));
        let typed: Vec<Track> = serde_json::from_value(tracks).unwrap();
        assert_eq!(
            typed
                .into_iter()
                .filter_map(Track::into_song)
                .collect::<Vec<_>>(),
            expected.songs
        );
    }

    fn detail(count: usize) -> PlaylistDetail {
        serde_json::from_value(json!({
            "trackCount": count,
            "trackIds": (0..count).map(|id| json!({"id": id})).collect::<Vec<_>>(),
            "tracks": (0..count.min(1000)).map(|id| json!({"id": id})).collect::<Vec<_>>(),
        }))
        .unwrap()
    }

    #[tokio::test]
    async fn large_playlists_fill_in_order_and_stop_at_existing_limit() {
        for count in [10, 1000, 1201, 5000, 5100] {
            let mut calls = 0;
            let playlist = complete_playlist(42, detail(count), |url| {
                calls += 1;
                let ids: Vec<i64> =
                    serde_json::from_str(url.split("ids=").nth(1).unwrap()).unwrap();
                assert!(ids.len() <= 200);
                async move {
                    Ok(SongResponse {
                        code: 200,
                        songs: ids
                            .into_iter()
                            .map(|id| serde_json::from_value(json!({"id": id})).unwrap())
                            .collect(),
                    })
                }
            })
            .await
            .unwrap();
            let expected = count.min(MAX_TRACKS_LIMIT);
            assert_eq!(playlist.songs.len(), expected);
            assert_eq!(calls, expected.saturating_sub(1000).div_ceil(200));
            assert!(
                playlist
                    .songs
                    .iter()
                    .enumerate()
                    .all(|(id, song)| song.id == id.to_string())
            );
        }
    }

    #[tokio::test]
    async fn unavailable_batches_keep_existing_partial_result_but_body_errors_fail() {
        let mut calls = 0;
        let playlist = complete_playlist(42, detail(5000), |_| {
            calls += 1;
            async { Err(anyhow!("upstream unavailable")) }
        })
        .await
        .unwrap();
        assert_eq!(calls, 3);
        assert_eq!(playlist.songs.len(), 1000);
        let result = complete_playlist(42, detail(1200), |_| async {
            Err(PlaylistBodyError("Response exceeds limit".into()).into())
        })
        .await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn bounded_reader_rejects_declared_and_streamed_oversize_bodies() {
        let response = axum::http::Response::builder()
            .header("content-length", MAX_PLAYLIST_BODY_BYTES + 1)
            .body(vec![b' '; MAX_PLAYLIST_BODY_BYTES + 1])
            .unwrap();
        assert!(
            read_playlist_json::<PlaylistResponse>(response.into())
                .await
                .err()
                .unwrap()
                .downcast_ref::<PlaylistBodyError>()
                .is_some()
        );
        use http_body_util::{BodyStream, Full, StreamBody};
        let chunks = futures::StreamExt::chain(
            BodyStream::new(Full::new(axum::body::Bytes::from(
                vec![b' '; MAX_PLAYLIST_BODY_BYTES],
            ))),
            BodyStream::new(Full::new(axum::body::Bytes::from_static(b" "))),
        );
        let response = axum::http::Response::new(reqwest::Body::wrap(StreamBody::new(chunks)));
        assert!(
            read_playlist_json::<PlaylistResponse>(response.into())
                .await
                .err()
                .unwrap()
                .downcast_ref::<PlaylistBodyError>()
                .is_some()
        );
        let response =
            axum::http::Response::new(br#"{"code":200,"playlist":{"tracks":[{"id":1}]}}"#.to_vec());
        let result: PlaylistResponse = read_playlist_json(response.into()).await.unwrap();
        assert_eq!(result.playlist.tracks.len(), 1);
    }
}
