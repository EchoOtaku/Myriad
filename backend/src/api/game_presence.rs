//! 游戏平台公开状态 API（无用户 Cookie）
//!
//! 仅使用公开标识（UID / Gamertag / Online ID）拉取：
//! - Hoyoverse 展柜：Enka.Network（原神 / 星铁 / 绝区零）
//! - Xbox：OpenXBL（需服务端 OPENXBL_API_KEY）
//! - PlayStation：PSN 非公开 API（需服务端 PSN_NPSSO，只读他人公开资料）
//!
//! 标识符存在前端小组件 config 中，不在全局配置页新增设置项。

use axum::{extract::Query, http::StatusCode, Json};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use url::Url;

use crate::services::outbound_security::build_public_http_client;

// ---------------------------------------------------------------------------
// Response types
// ---------------------------------------------------------------------------

#[derive(Debug, Serialize, Clone)]
pub struct ApiResponse<T> {
    pub success: bool,
    pub data: Option<T>,
    pub message: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct GamePresenceData {
    pub platform: String,
    pub identity: GameIdentity,
    pub score: Option<GameScore>,
    pub presence: Option<GamePresenceInfo>,
    pub highlights: Vec<GameHighlight>,
    pub showcase: Vec<ShowcaseItem>,
    pub profile_url: Option<String>,
    pub fetched_at: String,
    /// 数据是否因服务端密钥缺失而降级
    pub degraded: bool,
    pub degrade_reason: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct GameIdentity {
    pub id: String,
    pub name: String,
    pub avatar: Option<String>,
    pub subtitle: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct GameScore {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct GamePresenceInfo {
    pub status: String,
    pub title: Option<String>,
    pub detail: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
pub struct GameHighlight {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct ShowcaseItem {
    pub name: String,
    pub level: Option<i64>,
    pub icon: Option<String>,
    pub rarity: Option<i64>,
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

#[derive(Debug, Deserialize)]
pub struct PresenceQuery {
    /// hoyolab | xbox | psn
    pub platform: String,
    /// UID / Gamertag / Online ID
    pub id: String,
    /// hoyolab 子游戏：genshin | hsr | zzz（默认 genshin）
    pub game: Option<String>,
}

// ---------------------------------------------------------------------------
// Cache (per platform+id+game, stale-while-revalidate style)
// ---------------------------------------------------------------------------

#[derive(Clone)]
enum CachedResult {
    Ok(Box<GamePresenceData>),
    Err(String),
}

struct CacheEntry {
    result: CachedResult,
    fetched_at: Instant,
}

static PRESENCE_CACHE: OnceLock<Mutex<HashMap<String, CacheEntry>>> = OnceLock::new();

fn cache_map() -> &'static Mutex<HashMap<String, CacheEntry>> {
    PRESENCE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

const CACHE_TTL: Duration = Duration::from_secs(120);
/// 失败结果（无效 id / 上游拒绝等）缓存更短，避免一直被当活的打上游，
/// 但也不会因为长期缓存把后来纠正过的 id 也一直判定失败。
const ERROR_CACHE_TTL: Duration = Duration::from_secs(30);

fn cache_key(platform: &str, id: &str, game: &str) -> String {
    format!("{}:{}:{}", platform.to_ascii_lowercase(), id, game)
}

fn read_cache(key: &str) -> Option<CachedResult> {
    let guard = cache_map().lock().ok()?;
    let entry = guard.get(key)?;
    let ttl = match &entry.result {
        CachedResult::Ok(_) => CACHE_TTL,
        CachedResult::Err(_) => ERROR_CACHE_TTL,
    };
    if entry.fetched_at.elapsed() < ttl {
        Some(entry.result.clone())
    } else {
        None
    }
}

fn store_cache(key: &str, result: CachedResult) {
    if let Ok(mut guard) = cache_map().lock() {
        guard.insert(
            key.to_string(),
            CacheEntry {
                result,
                fetched_at: Instant::now(),
            },
        );
        // 简单上限，避免无限增长
        if guard.len() > 256 {
            let oldest: Vec<String> = guard
                .iter()
                .filter(|(_, e)| e.fetched_at.elapsed() > CACHE_TTL * 2)
                .map(|(k, _)| k.clone())
                .collect();
            for k in oldest {
                guard.remove(&k);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Credential-spend guard (Xbox OpenXBL / PSN NPSSO)
// ---------------------------------------------------------------------------
//
// 这个接口本身必须公开（无 Cookie 的展示型小组件，访客不登录也要能看到），
// 不能像 /api/x/user 那样直接挂 auth_middleware。但 Xbox / PSN 分支花的是
// 服务端自己的第三方凭据（OPENXBL_API_KEY / PSN_NPSSO），换 IP 或换 id 就能绕开
// 按 IP 算的全局限流。这里单独给"真正花凭据的上游请求"加一个和调用方身份无关的
// 全局节流，兜底防止配额被刷爆或触发 Sony/Xbox 的异常访问检测。

#[derive(Clone, Copy)]
enum Platform {
    Xbox,
    Psn,
}

struct SpendWindow {
    window_start: Instant,
    count: usize,
}

static XBOX_SPEND: OnceLock<Mutex<SpendWindow>> = OnceLock::new();
static PSN_SPEND: OnceLock<Mutex<SpendWindow>> = OnceLock::new();

const SPEND_WINDOW: Duration = Duration::from_secs(60);
const SPEND_MAX: usize = 20;

fn try_spend_credential_call(platform: Platform) -> bool {
    let lock = match platform {
        Platform::Xbox => XBOX_SPEND.get_or_init(|| {
            Mutex::new(SpendWindow {
                window_start: Instant::now(),
                count: 0,
            })
        }),
        Platform::Psn => PSN_SPEND.get_or_init(|| {
            Mutex::new(SpendWindow {
                window_start: Instant::now(),
                count: 0,
            })
        }),
    };
    let Ok(mut state) = lock.lock() else {
        return true;
    };
    if state.window_start.elapsed() > SPEND_WINDOW {
        state.window_start = Instant::now();
        state.count = 0;
    }
    if state.count >= SPEND_MAX {
        false
    } else {
        state.count += 1;
        true
    }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

pub async fn get_game_presence(
    Query(q): Query<PresenceQuery>,
) -> Result<Json<ApiResponse<GamePresenceData>>, StatusCode> {
    let platform = q.platform.trim().to_ascii_lowercase();
    let account_id = q.id.trim().to_string();
    let game = q
        .game
        .as_deref()
        .unwrap_or("genshin")
        .trim()
        .to_ascii_lowercase();

    if account_id.is_empty() {
        return Ok(Json(ApiResponse {
            success: false,
            data: None,
            message: "Missing account id".to_string(),
        }));
    }

    // 基础校验，防滥用
    if account_id.len() > 64
        || !account_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | ' ' | '@' | '.'))
    {
        return Ok(Json(ApiResponse {
            success: false,
            data: None,
            message: "Invalid account id format".to_string(),
        }));
    }

    let key = cache_key(&platform, &account_id, &game);
    if let Some(cached) = read_cache(&key) {
        return Ok(Json(match cached {
            CachedResult::Ok(data) => ApiResponse {
                success: true,
                data: Some(*data),
                message: "ok (cache)".to_string(),
            },
            CachedResult::Err(msg) => ApiResponse {
                success: false,
                data: None,
                message: msg,
            },
        }));
    }

    let result = match platform.as_str() {
        "hoyolab" | "hoyoverse" | "miyoushe" | "enka" => fetch_enka(&account_id, &game).await,
        "xbox" => fetch_xbox(&account_id).await,
        "psn" | "playstation" => fetch_psn(&account_id).await,
        _ => Err(format!("Unsupported platform: {platform}")),
    };

    match result {
        Ok(data) => {
            store_cache(&key, CachedResult::Ok(Box::new(data.clone())));
            Ok(Json(ApiResponse {
                success: true,
                data: Some(data),
                message: "ok".to_string(),
            }))
        }
        Err(msg) => {
            tracing::warn!("game presence fetch failed ({platform}/{account_id}): {msg}");
            store_cache(&key, CachedResult::Err(msg.clone()));
            Ok(Json(ApiResponse {
                success: false,
                data: None,
                message: msg,
            }))
        }
    }
}

// ---------------------------------------------------------------------------
// Enka.Network (Hoyoverse showcase)
// ---------------------------------------------------------------------------

async fn fetch_enka(uid: &str, game: &str) -> Result<GamePresenceData, String> {
    if !uid.chars().all(|c| c.is_ascii_digit()) || uid.len() < 5 || uid.len() > 12 {
        return Err("UID must be 5–12 digits".to_string());
    }

    let (url, profile_url, game_label) = match game {
        "hsr" | "starrail" | "star_rail" => (
            format!("https://enka.network/api/hsr/uid/{uid}/?info"),
            format!("https://enka.network/hsr/{uid}"),
            "Honkai: Star Rail",
        ),
        "zzz" | "zenless" => (
            format!("https://enka.network/api/zzz/uid/{uid}/?info"),
            format!("https://enka.network/zzz/{uid}"),
            "Zenless Zone Zero",
        ),
        _ => (
            format!("https://enka.network/api/uid/{uid}/?info"),
            format!("https://enka.network/u/{uid}"),
            "Genshin Impact",
        ),
    };

    let body = http_get_json(&url, "Myriad/1.0 (game-presence; +https://github.com)").await?;
    parse_enka_response(uid, game, game_label, &profile_url, &body)
}

fn parse_enka_response(
    uid: &str,
    game: &str,
    game_label: &str,
    profile_url: &str,
    body: &Value,
) -> Result<GamePresenceData, String> {
    // Genshin uses playerInfo; HSR/ZZZ may nest differently
    let player = body
        .get("playerInfo")
        .or_else(|| body.get("detailInfo"))
        .cloned()
        .unwrap_or_else(|| body.clone());

    let nickname = player
        .get("nickname")
        .or_else(|| player.get("nickName"))
        .and_then(|v| v.as_str())
        .unwrap_or(uid)
        .to_string();

    let level = player.get("level").and_then(|v| v.as_i64()).or_else(|| {
        player
            .get("level")
            .and_then(|v| v.as_u64())
            .map(|u| u as i64)
    });

    let world_level = player
        .get("worldLevel")
        .or_else(|| player.get("world_level"))
        .and_then(|v| v.as_i64());

    let achievements = player
        .get("finishAchievementNum")
        .or_else(|| player.get("finish_achievement_num"))
        .or_else(|| {
            player
                .get("recordInfo")
                .and_then(|r| r.get("achievementCount"))
        })
        .and_then(|v| v.as_i64());

    let signature = player
        .get("signature")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let tower = match (
        player.get("towerFloorIndex").and_then(|v| v.as_i64()),
        player.get("towerLevelIndex").and_then(|v| v.as_i64()),
    ) {
        (Some(f), Some(l)) if f > 0 => Some(format!("{f}-{l}")),
        _ => None,
    };

    // Showcase avatars (summary only on ?info)
    let mut showcase = Vec::new();
    if let Some(arr) = player
        .get("showAvatarInfoList")
        .or_else(|| player.get("avatarDetailList"))
        .and_then(|v| v.as_array())
    {
        for item in arr.iter().take(6) {
            let name = item
                .get("name")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| {
                    item.get("avatarId")
                        .or_else(|| item.get("avatar_id"))
                        .map(|id| format!("#{id}"))
                })
                .unwrap_or_else(|| "—".to_string());
            let av_level = item.get("level").and_then(|v| v.as_i64());
            showcase.push(ShowcaseItem {
                name,
                level: av_level,
                icon: None,
                rarity: item.get("rarity").and_then(|v| v.as_i64()),
            });
        }
    }

    let mut highlights = Vec::new();
    if let Some(a) = achievements {
        highlights.push(GameHighlight {
            label: "Achievements".into(),
            value: a.to_string(),
        });
    }
    if let Some(wl) = world_level {
        highlights.push(GameHighlight {
            label: "World Lv".into(),
            value: wl.to_string(),
        });
    }
    if let Some(t) = tower {
        highlights.push(GameHighlight {
            label: "Abyss".into(),
            value: t,
        });
    }
    highlights.push(GameHighlight {
        label: "Game".into(),
        value: game_label.to_string(),
    });

    let score = level.map(|l| {
        let label = match game {
            "hsr" | "starrail" | "star_rail" => "Trailblaze",
            "zzz" | "zenless" => "Inter-Knot",
            _ => "AR",
        };
        GameScore {
            label: label.to_string(),
            value: l.to_string(),
        }
    });

    Ok(GamePresenceData {
        platform: "hoyolab".to_string(),
        identity: GameIdentity {
            id: uid.to_string(),
            name: nickname,
            avatar: None,
            subtitle: signature,
        },
        score,
        presence: None,
        highlights,
        showcase,
        profile_url: Some(profile_url.to_string()),
        fetched_at: chrono::Utc::now().to_rfc3339(),
        degraded: false,
        degrade_reason: None,
    })
}

// ---------------------------------------------------------------------------
// Xbox via OpenXBL
// ---------------------------------------------------------------------------

async fn fetch_xbox(gamertag: &str) -> Result<GamePresenceData, String> {
    let api_key = std::env::var("OPENXBL_API_KEY")
        .or_else(|_| std::env::var("XBL_API_KEY"))
        .unwrap_or_default();

    if api_key.trim().is_empty() {
        // 降级：仅返回标识 + 公开主页链接
        return Ok(GamePresenceData {
            platform: "xbox".to_string(),
            identity: GameIdentity {
                id: gamertag.to_string(),
                name: gamertag.to_string(),
                avatar: None,
                subtitle: Some("OpenXBL API key not configured".into()),
            },
            score: None,
            presence: None,
            highlights: vec![],
            showcase: vec![],
            profile_url: Some(format!(
                "https://www.xbox.com/play/user/{}",
                urlencoding_simple(gamertag)
            )),
            fetched_at: chrono::Utc::now().to_rfc3339(),
            degraded: true,
            degrade_reason: Some(
                "Set OPENXBL_API_KEY on the server to load Gamerscore and presence".into(),
            ),
        });
    }

    if !try_spend_credential_call(Platform::Xbox) {
        return Err("Too many Xbox lookups right now, try again in a bit".to_string());
    }

    // Search player
    let search_url = format!(
        "https://xbl.io/api/v2/search/{}",
        urlencoding_simple(gamertag)
    );
    let search = http_get_json_with_header(
        &search_url,
        "Myriad/1.0 (game-presence)",
        &[("X-Authorization", api_key.as_str())],
    )
    .await?;

    // OpenXBL search shapes vary; try common paths
    let person = search
        .get("people")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .cloned()
        .or_else(|| {
            search
                .get("profileUsers")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .cloned()
        })
        .unwrap_or(search.clone());

    let xuid = person
        .get("xuid")
        .or_else(|| person.get("id"))
        .and_then(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .or_else(|| v.as_u64().map(|n| n.to_string()))
        })
        .unwrap_or_default();

    let display_name = person
        .get("gamertag")
        .or_else(|| person.get("modernGamertag"))
        .or_else(|| person.get("uniqueModernGamertag"))
        .and_then(|v| v.as_str())
        .unwrap_or(gamertag)
        .to_string();

    let mut gamerscore: Option<String> = person
        .get("gamerScore")
        .or_else(|| person.get("gamerscore"))
        .and_then(|v| {
            v.as_str()
                .map(|s| s.to_string())
                .or_else(|| v.as_i64().map(|n| n.to_string()))
        });

    let mut avatar = person
        .get("displayPicRaw")
        .or_else(|| person.get("displayPicUri"))
        .or_else(|| person.get("gamerpic"))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    let mut presence_status: Option<String> = None;
    let mut presence_title: Option<String> = None;

    if !xuid.is_empty() {
        // Presence
        let presence_url = format!("https://xbl.io/api/v2/presence/{xuid}");
        if let Ok(pres) = http_get_json_with_header(
            &presence_url,
            "Myriad/1.0 (game-presence)",
            &[("X-Authorization", api_key.as_str())],
        )
        .await
        {
            // Array or object
            let node = pres
                .as_array()
                .and_then(|a| a.first())
                .cloned()
                .unwrap_or(pres);
            presence_status = node
                .get("state")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            if let Some(devices) = node.get("devices").and_then(|v| v.as_array()) {
                // 多设备同时在线时（比如手机开着 Xbox App、主机在玩游戏），
                // 一旦某个设备给出 Full/Fill 占位的 title 就认定是"正在玩"，
                // 不能让后面设备的 title 再覆盖掉——所以命中后要跳出外层循环，
                // 而不只是内层的 titles 循环。
                'devices: for dev in devices {
                    if let Some(titles) = dev.get("titles").and_then(|v| v.as_array()) {
                        for t in titles {
                            let name = t.get("name").and_then(|v| v.as_str());
                            let placement = t.get("placement").and_then(|v| v.as_str());
                            if placement == Some("Full") || placement == Some("Fill") {
                                if let Some(n) = name {
                                    presence_title = Some(n.to_string());
                                    break 'devices;
                                }
                            }
                            if presence_title.is_none() {
                                if let Some(n) = name {
                                    if n != "Home" {
                                        presence_title = Some(n.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        // Account details for gamerscore / avatar if missing
        if gamerscore.is_none() || avatar.is_none() {
            let acc_url = format!("https://xbl.io/api/v2/account/{xuid}");
            if let Ok(acc) = http_get_json_with_header(
                &acc_url,
                "Myriad/1.0 (game-presence)",
                &[("X-Authorization", api_key.as_str())],
            )
            .await
            {
                let settings = acc
                    .get("profileUsers")
                    .and_then(|v| v.as_array())
                    .and_then(|a| a.first())
                    .and_then(|u| u.get("settings"))
                    .and_then(|s| s.as_array());
                if let Some(settings) = settings {
                    for s in settings {
                        let id = s.get("id").and_then(|v| v.as_str()).unwrap_or("");
                        let val = s.get("value").and_then(|v| v.as_str()).unwrap_or("");
                        match id {
                            "Gamerscore" if gamerscore.is_none() => {
                                gamerscore = Some(val.to_string());
                            }
                            "GameDisplayPicRaw" | "PublicGamerpic" if avatar.is_none() => {
                                avatar = Some(val.to_string());
                            }
                            _ => {}
                        }
                    }
                }
            }
        }
    }

    let mut highlights = Vec::new();
    if let Some(ref gs) = gamerscore {
        highlights.push(GameHighlight {
            label: "Gamerscore".into(),
            value: gs.clone(),
        });
    }

    Ok(GamePresenceData {
        platform: "xbox".to_string(),
        identity: GameIdentity {
            id: if xuid.is_empty() {
                gamertag.to_string()
            } else {
                xuid
            },
            name: display_name,
            avatar,
            subtitle: None,
        },
        score: gamerscore.map(|v| GameScore {
            label: "GS".into(),
            value: v,
        }),
        presence: Some(GamePresenceInfo {
            status: presence_status.unwrap_or_else(|| "Unknown".into()),
            title: presence_title,
            detail: None,
        }),
        highlights,
        showcase: vec![],
        profile_url: Some(format!(
            "https://www.xbox.com/play/user/{}",
            urlencoding_simple(gamertag)
        )),
        fetched_at: chrono::Utc::now().to_rfc3339(),
        degraded: false,
        degrade_reason: None,
    })
}

// ---------------------------------------------------------------------------
// PlayStation (optional server NPSSO)
// ---------------------------------------------------------------------------

async fn fetch_psn(online_id: &str) -> Result<GamePresenceData, String> {
    let npsso = std::env::var("PSN_NPSSO").unwrap_or_default();

    if npsso.trim().is_empty() {
        return Ok(GamePresenceData {
            platform: "psn".to_string(),
            identity: GameIdentity {
                id: online_id.to_string(),
                name: online_id.to_string(),
                avatar: None,
                subtitle: Some("PSN_NPSSO not configured".into()),
            },
            score: None,
            presence: None,
            highlights: vec![],
            showcase: vec![],
            profile_url: Some(format!(
                "https://profile.playstation.com/{}",
                urlencoding_simple(online_id)
            )),
            fetched_at: chrono::Utc::now().to_rfc3339(),
            degraded: true,
            degrade_reason: Some(
                "Set PSN_NPSSO on the server to load trophies and presence (service account, not user cookie)".into(),
            ),
        });
    }

    if !try_spend_credential_call(Platform::Psn) {
        return Err("Too many PSN lookups right now, try again in a bit".to_string());
    }

    // NPSSO → access token（缓存 token 本身，不要每次 120s 缓存 miss 都重新走一遍 OAuth）
    let access_token = get_psn_access_token(&npsso).await?;

    // Resolve accountId by onlineId
    let profile_url = format!(
        "https://us-prof.np.community.playstation.net/userProfile/v1/users/{}/profile2?fields=onlineId,aboutMe,languagesUsed,plus,trophySummary(@default,progress,earnedTrophies),isOfficiallyVerified,personalDetail(@default,profilePictureUrls),personalDetailSharing,personalDetailSharingRequestMessageFlag,primaryOnlineStatus,presences(@titleInfo,hasBroadcastData),friendRelation,requestMessageFlag,blocking,mutualFriendsCount,following,followerCount,friendsCount,followingUsersCount&avatarSizes=s,m,l,xl&profilePictureSizes=s,m,l,xl&languagesUsedLanguageSet=set4&psVitaSupport=true&friendStatusSummary=true&npIdHash=true",
        urlencoding_simple(online_id)
    );

    // Prefer modern profile API
    let modern = format!(
        "https://m.np.playstation.com/api/userProfile/v1/internal/users/me/basicPresences?type=primary"
    );
    let _ = modern; // presence for self only; for others use profile by accountId

    // account search
    let search_url = format!(
        "https://m.np.playstation.com/api/search/v1/users?searchTerm={}",
        urlencoding_simple(online_id)
    );

    let mut identity_name = online_id.to_string();
    let mut avatar: Option<String> = None;
    let mut trophy_level: Option<String> = None;
    let mut platinum: Option<String> = None;
    let mut presence_status: Option<String> = None;
    let mut presence_title: Option<String> = None;
    let mut account_id: Option<String> = None;

    // Try legacy profile endpoint (still works with some tokens)
    if let Ok(legacy) = http_get_json_with_header(
        &profile_url,
        "Myriad/1.0 (game-presence)",
        &[("Authorization", &format!("Bearer {access_token}"))],
    )
    .await
    {
        if let Some(p) = legacy.get("profile") {
            identity_name = p
                .get("onlineId")
                .and_then(|v| v.as_str())
                .unwrap_or(online_id)
                .to_string();
            avatar = p
                .get("avatarUrls")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|u| u.get("avatarUrl"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());
            if let Some(ts) = p.get("trophySummary") {
                trophy_level = ts.get("level").and_then(|v| {
                    v.as_i64()
                        .map(|n| n.to_string())
                        .or_else(|| v.as_str().map(|s| s.to_string()))
                });
                platinum = ts
                    .get("earnedTrophies")
                    .and_then(|e| e.get("platinum"))
                    .and_then(|v| v.as_i64().map(|n| n.to_string()));
            }
            if let Some(pres) = p
                .get("presences")
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
            {
                presence_status = pres
                    .get("onlineStatus")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                presence_title = pres
                    .get("titleName")
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
            }
        }
    } else {
        // Fallback: search users
        if let Ok(search) = http_get_json_with_header(
            &search_url,
            "Myriad/1.0 (game-presence)",
            &[("Authorization", &format!("Bearer {access_token}"))],
        )
        .await
        {
            if let Some(domain) = search
                .get("domains")
                .and_then(|v| v.as_array())
                .and_then(|a| {
                    a.iter().find(|d| {
                        d.get("domain").and_then(|x| x.as_str()) == Some("SocialAllAccounts")
                    })
                })
            {
                if let Some(result) = domain
                    .get("results")
                    .and_then(|v| v.as_array())
                    .and_then(|a| a.first())
                    .and_then(|r| r.get("socialMetadata"))
                {
                    identity_name = result
                        .get("onlineId")
                        .and_then(|v| v.as_str())
                        .unwrap_or(online_id)
                        .to_string();
                    account_id = result
                        .get("accountId")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                    avatar = result
                        .get("avatarUrl")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
            }
        }

        if let Some(aid) = &account_id {
            // Trophy summary v2
            let trophy_url =
                format!("https://m.np.playstation.com/api/trophy/v1/users/{aid}/trophySummary");
            if let Ok(ts) = http_get_json_with_header(
                &trophy_url,
                "Myriad/1.0 (game-presence)",
                &[("Authorization", &format!("Bearer {access_token}"))],
            )
            .await
            {
                trophy_level = ts.get("trophyLevel").and_then(|v| {
                    v.as_str()
                        .map(|s| s.to_string())
                        .or_else(|| v.as_i64().map(|n| n.to_string()))
                });
                platinum = ts
                    .get("earnedTrophies")
                    .and_then(|e| e.get("platinum"))
                    .and_then(|v| v.as_i64().map(|n| n.to_string()));
            }

            let basic_presence_url = format!(
                "https://m.np.playstation.com/api/userProfile/v1/internal/users/{aid}/basicPresences?type=primary"
            );
            if let Ok(pres) = http_get_json_with_header(
                &basic_presence_url,
                "Myriad/1.0 (game-presence)",
                &[("Authorization", &format!("Bearer {access_token}"))],
            )
            .await
            {
                if let Some(bp) = pres.get("basicPresence") {
                    presence_status = bp
                        .get("primaryPlatformInfo")
                        .and_then(|p| p.get("onlineStatus"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                        .or_else(|| {
                            bp.get("availability")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                        });
                    presence_title = bp
                        .get("gameTitleInfoList")
                        .and_then(|v| v.as_array())
                        .and_then(|a| a.first())
                        .and_then(|t| t.get("titleName"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string());
                }
            }
        }
    }

    let mut highlights = Vec::new();
    if let Some(ref p) = platinum {
        highlights.push(GameHighlight {
            label: "Platinum".into(),
            value: p.clone(),
        });
    }

    Ok(GamePresenceData {
        platform: "psn".to_string(),
        identity: GameIdentity {
            id: account_id.unwrap_or_else(|| online_id.to_string()),
            name: identity_name,
            avatar,
            subtitle: None,
        },
        score: trophy_level.map(|v| GameScore {
            label: "Trophy Lv".into(),
            value: v,
        }),
        presence: Some(GamePresenceInfo {
            status: presence_status.unwrap_or_else(|| "Unknown".into()),
            title: presence_title,
            detail: None,
        }),
        highlights,
        showcase: vec![],
        profile_url: Some(format!(
            "https://profile.playstation.com/{}",
            urlencoding_simple(online_id)
        )),
        fetched_at: chrono::Utc::now().to_rfc3339(),
        degraded: false,
        degrade_reason: None,
    })
}

// ---------------------------------------------------------------------------
// PSN access token cache
// ---------------------------------------------------------------------------
//
// Sony 的 mobile access token 一般有效期在 1 小时左右。之前每次 120s 数据缓存 miss
// 都会重新跑一遍 NPSSO → code → token 的完整 OAuth 流程，相当于把"偶尔换一次 token"
// 变成了固定节奏高频换 token，对同一个 NPSSO 会话来说既浪费也容易被 Sony 判定为异常。
// 这里把 token 单独缓存，和数据缓存的 TTL 解耦。

struct PsnTokenEntry {
    access_token: String,
    fetched_at: Instant,
}

static PSN_TOKEN_CACHE: OnceLock<Mutex<Option<PsnTokenEntry>>> = OnceLock::new();

/// 留出安全余量，早于 token 实际过期时间刷新。
const PSN_TOKEN_TTL: Duration = Duration::from_secs(50 * 60);

fn psn_token_cache() -> &'static Mutex<Option<PsnTokenEntry>> {
    PSN_TOKEN_CACHE.get_or_init(|| Mutex::new(None))
}

async fn get_psn_access_token(npsso: &str) -> Result<String, String> {
    if let Ok(guard) = psn_token_cache().lock() {
        if let Some(entry) = guard.as_ref() {
            if entry.fetched_at.elapsed() < PSN_TOKEN_TTL {
                return Ok(entry.access_token.clone());
            }
        }
    }

    let access_token = psn_exchange_npsso(npsso).await?;

    if let Ok(mut guard) = psn_token_cache().lock() {
        *guard = Some(PsnTokenEntry {
            access_token: access_token.clone(),
            fetched_at: Instant::now(),
        });
    }

    Ok(access_token)
}

/// Exchange NPSSO cookie value for an access token.
/// Uses the same public client id employed by community PSN tools.
async fn psn_exchange_npsso(npsso: &str) -> Result<String, String> {
    // Step 1: NPSSO → authorization code
    let auth_url = "https://ca.account.sony.com/api/authz/v3/oauth/authorize?access_type=offline&client_id=09515159-7237-4370-9b40-3806e67c0891&redirect_uri=com.scee.psxandroid.scecompcall://redirect&response_type=code&scope=psn:mobile.v2.core psn:clientapp";

    let (_, client) = build_public_http_client(
        auth_url,
        Duration::from_secs(20),
        Some("Myriad/1.0 (game-presence)"),
    )
    .await
    .map_err(|e| e.to_string())?;

    let resp = client
        .get(auth_url)
        .header("Cookie", format!("npsso={npsso}"))
        .send()
        .await
        .map_err(|e| format!("PSN authorize request failed: {e}"))?;

    // With redirects disabled, Location holds the code
    let location = resp
        .headers()
        .get("location")
        .or_else(|| resp.headers().get("Location"))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();

    let code = extract_query_param(&location, "code").ok_or_else(|| {
        format!(
            "PSN NPSSO exchange failed (status {}). Cookie may be expired.",
            resp.status()
        )
    })?;

    // Step 2: code → access token
    let token_url = "https://ca.account.sony.com/api/authz/v3/oauth/token";
    let (_, token_client) = build_public_http_client(
        token_url,
        Duration::from_secs(20),
        Some("Myriad/1.0 (game-presence)"),
    )
    .await
    .map_err(|e| e.to_string())?;

    let form = [
        ("code", code.as_str()),
        ("redirect_uri", "com.scee.psxandroid.scecompcall://redirect"),
        ("grant_type", "authorization_code"),
        ("token_format", "jwt"),
    ];

    let token_resp = token_client
        .post(token_url)
        .header(
            "Authorization",
            "Basic MDk1MTUxNTktNzIzNy00MzcwLTliNDAtMzgwNmU2N2MwODkxOnVjUGprYTV0bnRCMktxc1A=",
        )
        .header("Content-Type", "application/x-www-form-urlencoded")
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("PSN token request failed: {e}"))?;

    if !token_resp.status().is_success() {
        return Err(format!("PSN token exchange HTTP {}", token_resp.status()));
    }

    let token_json: Value = token_resp
        .json()
        .await
        .map_err(|e| format!("PSN token parse failed: {e}"))?;

    token_json
        .get("access_token")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .ok_or_else(|| "PSN token response missing access_token".to_string())
}

/// 解析回调 URL 的 query 参数，走标准 percent-decoding。
/// 之前是手写按 `&`/`=` 切字符串，Sony 如果把 code 里的字符做了 percent-encode
/// （比如包含 `+`/`/` 这类需要转义的字符），拿到的就是没解码的原始 `%XX`，
/// 直接塞进 token 请求会导致换 token 失败。
fn extract_query_param(url: &str, key: &str) -> Option<String> {
    let parsed = Url::parse(url).ok()?;
    parsed
        .query_pairs()
        .find(|(k, _)| k == key)
        .map(|(_, v)| v.into_owned())
        .filter(|v| !v.is_empty())
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async fn http_get_json(url: &str, ua: &str) -> Result<Value, String> {
    http_get_json_with_header(url, ua, &[]).await
}

async fn http_get_json_with_header(
    url: &str,
    ua: &str,
    headers: &[(&str, &str)],
) -> Result<Value, String> {
    let (_, client) = build_public_http_client(url, Duration::from_secs(20), Some(ua))
        .await
        .map_err(|e| e.to_string())?;

    let mut req = client.get(url).header("User-Agent", ua);
    for (k, v) in headers {
        req = req.header(*k, *v);
    }

    let resp = req
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {e}"))?;

    let status = resp.status();
    if status.as_u16() == 404 {
        return Err("Player not found".to_string());
    }
    if status.as_u16() == 429 {
        return Err("Rate limited by upstream, try again later".to_string());
    }
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(format!(
            "Upstream HTTP {status}: {}",
            body.chars().take(200).collect::<String>()
        ));
    }

    resp.json::<Value>()
        .await
        .map_err(|e| format!("JSON parse failed: {e}"))
}

fn urlencoding_simple(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// Lightweight health/capabilities for the widget settings UI
pub async fn get_game_presence_capabilities() -> Json<Value> {
    let openxbl = std::env::var("OPENXBL_API_KEY")
        .or_else(|_| std::env::var("XBL_API_KEY"))
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let psn = std::env::var("PSN_NPSSO")
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);

    Json(json!({
        "platforms": {
            "hoyolab": {
                "public": true,
                "needs_server_key": false,
                "games": ["genshin", "hsr", "zzz"],
                "id_label": "UID"
            },
            "xbox": {
                "public": true,
                "needs_server_key": true,
                "server_key_ready": openxbl,
                "id_label": "Gamertag"
            },
            "psn": {
                "public": true,
                "needs_server_key": true,
                "server_key_ready": psn,
                "id_label": "Online ID"
            }
        }
    }))
}
