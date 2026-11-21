//! The Bilibili card, answered in Rust.
//!
//! bilibili.service.ts fans out to four endpoints in parallel; every one of them is allowed to
//! fail, and a profile assembled entirely from failed calls is still a valid profile. That is why
//! the recorded card for a non-numeric uid is a real card full of zeros rather than an error card:
//! the endpoints answer 200 with a business error code, axios never throws, and the service returns
//! isValid:true over defaulted fields.

use std::sync::OnceLock;
use std::time::Duration;

use axum::response::Response;
use dom_query::Document;
use serde_json::{Value, json};

use super::github::theme_name;
use super::handlers::{CardOutcome, card_reply};
use super::json::js_number;

/// The cache policy bilibili.controller.ts asks for.
const SUCCESS_CACHE: &str = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

/// createRequest(5000): a single attempt may take five seconds.
/// bilibili-storage.service.ts caches a profile for 120 seconds.
const STORAGE_TTL_SECONDS: u64 = 120;

const UPSTREAM_TIMEOUT_MS: u64 = 5000;

/// createRequestWithRetry(.., 2, 1000) at the caller's default: two attempts, 1s apart.
const ATTEMPTS: u32 = 2;
const RETRY_DELAY_MS: u64 = 1000;

const USER_AGENT: &str = "Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.104 Mobile Safari/537.36";

const SPACE_URL: &str = "https://m.bilibili.com/space/";
const STAT_URL: &str = "https://api.bilibili.com/x/relation/stat?vmid=";
const UPSTAT_URL: &str = "https://api.bilibili.com/x/space/upstat?mid=";
const CARD_URL: &str = "https://api.bilibili.com/x/web-interface/card?mid=";

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_millis(UPSTREAM_TIMEOUT_MS))
            .build()
            .unwrap_or_default()
    })
}

/// The original reads bilibiliConfig.bilibiliSession from BILIBILI_SESSDATA and still sends the
/// cookie header when it is empty, because the API answers anonymous callers the same way as a
/// session-less one. Keeping the header unconditional matters: the recorded cards were made with
/// no session at all, and a missing header is a different request to the upstream.
fn session_cookie() -> &'static str {
    static COOKIE: OnceLock<String> = OnceLock::new();
    COOKIE.get_or_init(|| {
        let session = std::env::var("BILIBILI_SESSDATA").unwrap_or_default();
        format!("SESSDATA={session}")
    })
}

/// A GET whose failure is a value: the original wraps each call in .catch(.. => null).
async fn fetch_text(url: &str) -> Option<String> {
    for attempt in 0..ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(RETRY_DELAY_MS << (attempt - 1))).await;
        }
        let Ok(response) = client()
            .get(url)
            .header("User-Agent", USER_AGENT)
            .header("Cookie", session_cookie())
            .header("Referer", "https://space.bilibili.com")
            .send()
            .await
        else {
            continue;
        };
        let status = response.status().as_u16();
        if (400..500).contains(&status) {
            return None;
        }
        if !response.status().is_success() {
            continue;
        }
        if let Ok(text) = response.text().await {
            return Some(text);
        }
    }
    None
}

async fn fetch_json(url: &str) -> Option<Value> {
    fetch_text(url)
        .await
        .and_then(|text| serde_json::from_str::<Value>(&text).ok())
}

/// The login page m.bilibili.com redirects to has no .base block, so every lookup below misses and
/// the caller keeps its defaults, exactly like the cheerio walk in the original.
struct Crawled {
    name: Option<String>,
    level: Option<f64>,
    description: Option<String>,
}

fn crawl(html: &str) -> Crawled {
    let document = Document::from(html);
    let mut name = None;
    for node in document.select(".base .name").nodes() {
        name = Some(node.text().trim().to_string());
    }
    let mut level = None;
    for node in document.select(".base .level i").nodes() {
        if let Some(class) = node.attr("class") {
            let last: String = class.chars().last().into_iter().collect();
            level = last.parse::<f64>().ok();
        }
    }
    let mut description = None;
    for node in document.select(".desc .content").nodes() {
        description = Some(node.text().trim().to_string());
    }
    Crawled {
        name,
        level,
        description,
    }
}

/// The whole fetch. Every arm defaults, so this returns a profile even when all four calls fail —
/// which is what the original does and what the recording shows.
async fn fetch(uid: &str) -> Value {
    let space_url = format!("{SPACE_URL}{uid}");
    let stat_url = format!("{STAT_URL}{uid}");
    let upstat_url = format!("{UPSTAT_URL}{uid}");
    let card_url = format!("{CARD_URL}{uid}");
    let (space, stat, upstat, card) = tokio::join!(
        fetch_text(&space_url),
        fetch_json(&stat_url),
        fetch_json(&upstat_url),
        fetch_json(&card_url),
    );

    let mut name = None;
    let mut level: Option<f64> = None;
    let mut description = None;
    let mut face: Option<String> = None;
    if let Some(html) = space {
        let crawled = crawl(&html);
        name = crawled.name;
        level = crawled.level;
        description = crawled.description;
    }

    // The card endpoint, when it answers, is authoritative for the name, the level and the avatar.
    if let Some(card) = card
        .as_ref()
        .and_then(|body| body.pointer("/data/card"))
        .filter(|value| value.is_object())
    {
        if let Some(card_name) = card
            .get("name")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            name = Some(card_name.to_string());
        }
        if let Some(current) = card.pointer("/level_info/current_level") {
            level = Some(js_number(Some(current)));
        }
        if let Some(card_face) = card
            .get("face")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
        {
            face = Some(card_face.to_string());
        }
    }

    let followers = js_number(stat.as_ref().and_then(|body| body.pointer("/data/follower")));
    let following = js_number(stat.as_ref().and_then(|body| body.pointer("/data/following")));
    let likes = js_number(upstat.as_ref().and_then(|body| body.pointer("/data/likes")));
    let views = js_number(upstat.as_ref().and_then(|body| body.pointer("/data/archive/view")));

    let username = name
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| uid.to_string());
    json!({
        "uid": uid,
        "username": username,
        "level": level.unwrap_or(0.0),
        "avatarUrl": face,
        "sign": description.unwrap_or_default(),
        "followers": followers,
        "following": following,
        "likes": likes,
        "views": views,
    })
}

/// GET /bilibili/:uid, after validateGenericUsername let the uid through.
pub async fn card(id: &str, raw_theme: Option<&str>, key: String) -> Response {
    let theme = theme_name(raw_theme);
    if id.is_empty() {
        // The service refuses an empty uid before it ever calls upstream.
        return card_reply(
            "bilibili",
            CardOutcome::UpstreamUnavailable,
            theme,
            key,
            SUCCESS_CACHE,
        );
    }
    // bilibili.service.ts reads through storage first (bilibili-storage.service.ts, key
    // BILIBILI:<uid>, 120s), and that lookup is counted by the same cache instance the HTTP layer
    // uses. Reproducing it here is what makes a cold card cost two misses, not one.
    let storage_key = format!("BILIBILI:{id}");
    let payload = match super::cache::storage_get(&storage_key) {
        Some(cached) => cached,
        None => {
            let fresh = fetch(id).await;
            super::cache::storage_set(&storage_key, &fresh, STORAGE_TTL_SECONDS);
            fresh
        }
    };
    card_reply(
        "bilibili",
        CardOutcome::Rendered(payload),
        theme,
        key,
        SUCCESS_CACHE,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_login_page_fills_nothing() {
        let crawled = crawl("<html><body><form id=\"login\"></form></body></html>");
        assert!(crawled.name.is_none());
        assert!(crawled.level.is_none());
        assert!(crawled.description.is_none());
    }

    #[test]
    fn the_level_comes_from_the_last_class_character() {
        let html = "<div class=\"base\"><div class=\"name\">Alice</div><div class=\"level\"><i class=\"level lv-6\"></i></div></div>";
        let crawled = crawl(html);
        assert_eq!(crawled.name.as_deref(), Some("Alice"));
        assert_eq!(crawled.level, Some(6.0));
    }

    #[test]
    fn a_missing_field_reads_as_zero() {
        assert_eq!(js_number(None), 0.0);
        assert_eq!(js_number(Some(&json!("3"))), 3.0);
        assert_eq!(js_number(Some(&json!(false))), 0.0);
    }
}