//! The CSDN card, answered in Rust.
//!
//! The original scrapes blog.csdn.net: fetch the profile page, read the statistics strip and the
//! embedded window.__INITIAL_STATE__, then render. The page is somebody else's HTML, so the
//! selectors here are a contract with CSDN, not with our own code — they are copied verbatim from
//! csdn.service.ts, including the label-based pairing that survives the strip changing shape.

use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::response::{IntoResponse, Response};
use dom_query::{Document, Selection};
use serde_json::{Value, json};

use super::github::theme_name;
use super::handlers::{CardOutcome, card_reply};

/// How long a profile stays hot in this process. The original keeps the rendered response in its
/// HTTP cache for 300s and the parsed profile in Redis for 1800s; one TTL is enough here because
/// both exist only to keep repeat traffic off CSDN.
const CACHE_TTL_SECONDS: u64 = 300;

const UPSTREAM_TIMEOUT_MS: u64 = 8000;
const RETRY_DELAY_MS: u64 = 800;
const PROFILE_URL: &str = "https://blog.csdn.net/";
const USER_AGENT: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/// An expiry paired with the parsed profile, or `None` when the page proved the user absent.
type CacheEntry = (u64, Option<Value>);
type ProfileCache = Mutex<std::collections::HashMap<String, CacheEntry>>;

/// The values a rendered card needs, already shaped like the original's stats object.
fn cache() -> &'static ProfileCache {
    static CACHE: OnceLock<ProfileCache> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn cached(user_id: &str) -> Option<Option<Value>> {
    let key = user_id.to_lowercase();
    let now = now_seconds();
    let mut guard = cache().lock().ok()?;
    match guard.get(&key) {
        Some((expire_at, value)) if *expire_at > now => Some(value.clone()),
        Some(_) => {
            guard.remove(&key);
            None
        }
        None => None,
    }
}

/// Failures are remembered too: the original caches the degraded card for the same 300s, so a
/// missing profile costs one upstream round trip per TTL, not one per request.
fn remember(user_id: &str, value: Option<&Value>) {
    if let Ok(mut guard) = cache().lock() {
        guard.insert(
            user_id.to_lowercase(),
            (now_seconds() + CACHE_TTL_SECONDS, value.cloned()),
        );
    }
}

/// parseInt over an already comma-stripped string. NaN becomes 0, as every call site does.
fn js_parse_int(raw: &str) -> f64 {
    let trimmed = raw.trim_start();
    let (sign, rest) = match trimmed.as_bytes().first() {
        Some(b'-') => (-1.0, &trimmed[1..]),
        Some(b'+') => (1.0, &trimmed[1..]),
        _ => (1.0, trimmed),
    };
    let mut digits = String::new();
    for c in rest.chars() {
        if c.is_ascii_digit() {
            digits.push(c);
        } else {
            break;
        }
    }
    if digits.is_empty() {
        return 0.0;
    }
    // The recorded pages stay far below i64 range; saturating keeps a hostile page from wrapping.
    match digits.parse::<i64>() {
        Ok(value) => sign * value as f64,
        Err(_) => 0.0,
    }
}

/// parseInt(text.replace(/,/g, "")) || 0
fn number_from(text: &str) -> f64 {
    js_parse_int(&text.replace(',', ""))
}

/// The statistics strip pairs each label with its number, and the order differs per account, so
/// the label is the only stable key. Multiple matching rows concatenate, like cheerio's filter.
fn stat_by_label(doc: &Document, label: &str) -> f64 {
    let items = doc.select(".user-profile-head-info-r-c li");
    let mut raw = String::new();
    for node in items.nodes() {
        let item = Selection::from(*node);
        let name = item.select(".user-profile-statistics-name").text().trim().to_string();
        if name == label {
            raw.push_str(item.select(".user-profile-statistics-num").text().trim());
        }
    }
    number_from(&raw)
}

/// window.__INITIAL_STATE__ carries the authoritative visit count; the DOM often does not.
fn read_initial_state(html: &str) -> Option<Value> {
    let at = html.find("window.__INITIAL_STATE__")?;
    let eq = html[at..].find('=')? + at;
    let start = eq + 1;
    let bytes = html.as_bytes();
    let mut depth = 0i32;
    let mut end = None;
    let mut in_str = false;
    let mut esc = false;
    for (offset, c) in html[start..].char_indices() {
        let index = start + offset;
        if in_str {
            if esc {
                esc = false;
            } else if c == '\\' {
                esc = true;
            } else if c == '"' {
                in_str = false;
            }
            continue;
        }
        if c == '"' {
            in_str = true;
        } else if c == '{' {
            depth += 1;
        } else if c == '}' {
            depth -= 1;
            if depth == 0 {
                end = Some(index + 1);
                break;
            }
        }
    }
    let end = end?;
    let _ = bytes;
    serde_json::from_str(&html[start..end]).ok()
}

/// parseCSDNUserPage. None means the page has no statistics strip at all: CSDN answers 200 for a
/// user that does not exist, so the strip is the only thing separating "missing" from "empty".
fn parse_profile(html: &str, user_id: &str) -> Option<Value> {
    let doc = Document::from(html);
    if doc.select(".user-profile-statistics-num").length() == 0 {
        return None;
    }

    let username = {
        // .eq(0): the first matching div only. Concatenating the whole selection would glue the
        // "码龄25年" badge onto the name.
        let heads = doc.select(".user-profile-head-name div");
        let raw = heads
            .get(0)
            .map(|node| node.text().trim().to_string())
            .unwrap_or_default();
        if raw.is_empty() {
            user_id.to_string()
        } else {
            raw
        }
    };

    let code_age_text = doc.select(".person-code-age span").text().trim().to_string();
    let code_age = if code_age_text.is_empty() {
        Value::from(0)
    } else {
        Value::String(code_age_text.replacen("码龄", "", 1))
    };

    let power = doc.select(".influence-bottom-box .influence-bottom dt");
    let level = number_from(&power.get(0).map(|n| n.text().trim().to_string()).unwrap_or_default());
    let total_points = number_from(&power.get(1).map(|n| n.text().trim().to_string()).unwrap_or_default());
    let month_points = number_from(&power.get(2).map(|n| n.text().trim().to_string()).unwrap_or_default());

    let article_count = stat_by_label(&doc, "原创");
    let followers = stat_by_label(&doc, "粉丝");
    let rank = stat_by_label(&doc, "排名");

    // (typeof stateViews === "number" && stateViews) || parseInt(viewsText) || statByLabel("访问")
    let state_views = read_initial_state(html)
        .and_then(|state| state.pointer("/pageData/data/baseInfo/blogModule/visitedTimes").cloned())
        .and_then(|value| value.as_f64());
    let views_text = doc
        .select(".user-profile-statistics-views:contains(\"总访问量\")")
        .text()
        .trim()
        .to_string();
    let views = match state_views {
        Some(value) if value != 0.0 => value,
        _ => {
            let from_dom = number_from(&views_text);
            if from_dom != 0.0 {
                from_dom
            } else {
                stat_by_label(&doc, "访问")
            }
        }
    };

    let achievements = doc.select(".user-profile-aside-common-box .aside-common-box-achievement span");
    let pick = |index: usize| {
        achievements
            .get(index)
            .map(|node| number_from(node.text().trim()))
            .unwrap_or(0.0)
    };
    let likes = pick(0);
    let comments = pick(1);

    Some(json!({
        "userId": user_id,
        "username": username,
        "articleCount": article_count,
        "followers": followers,
        "likes": likes,
        "views": views,
        "comments": comments,
        "points": total_points,
        "rank": rank,
        "codeAge": code_age,
        "level": level,
        "monthPoints": month_points,
    }))
}

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_millis(UPSTREAM_TIMEOUT_MS))
            .build()
            .unwrap_or_default()
    })
}

/// createRequestWithRetry(fn, 2, 800): two retries, 800ms apart, only for transport-level failures.
async fn fetch_page(user_id: &str) -> Option<String> {
    let url = format!("{PROFILE_URL}{user_id}");
    let referer = format!("{PROFILE_URL}{user_id}");
    let mut last: Option<String> = None;
    for attempt in 0..3u32 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(RETRY_DELAY_MS)).await;
        }
        let response = client()
            .get(&url)
            .header("Referer", &referer)
            .header("Cookie", "uuid_tt_dd=xxx-xxx-xxx;")
            .header("User-Agent", USER_AGENT)
            .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
            .header("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8")
            .send()
            .await;
        match response {
            Ok(response) => {
                if !response.status().is_success() {
                    // CSDN answers 404 for an unknown login; the original lets that surface as a
                    // transport failure, which ends up as the degraded card rather than a 404.
                    return None;
                }
                match response.text().await {
                    Ok(body) => return Some(body),
                    Err(_) => last = None,
                }
            }
            Err(_) => last = None,
        }
    }
    last
}

/// What the upstream told us: a profile, "this user does not exist", or "CSDN is not answering".
///
/// The distinction is load-bearing. CSDN serves a full 200 page without the statistics strip for
/// an unknown login, and that is the only signal that separates a missing user (404) from a
/// blocked or broken fetch (200 degraded card). A non-2xx status is the latter: the original lets
/// axios reject and never reaches the USER_NOT_FOUND branch.
enum Loaded {
    Profile(Value),
    Missing,
    Unavailable,
}

async fn load(user_id: &str) -> Loaded {
    if let Some(value) = cached(user_id) {
        return match value {
            Some(value) => Loaded::Profile(value),
            None => Loaded::Unavailable,
        };
    }
    match fetch_page(user_id).await {
        Some(html) => match parse_profile(&html, user_id) {
            Some(profile) => {
                remember(user_id, Some(&profile));
                Loaded::Profile(profile)
            }
            None => {
                remember(user_id, None);
                Loaded::Missing
            }
        },
        None => Loaded::Unavailable,
    }
}

/// GET /csdn/:userId, after validateGenericUsername let the sanitized name through.
pub async fn card(user_id: &str, raw_theme: Option<&str>, key: String) -> Response {
    let theme = theme_name(raw_theme);
    let outcome = match load(user_id).await {
        Loaded::Profile(profile) => CardOutcome::Rendered(profile),
        Loaded::Missing => CardOutcome::NotFound,
        Loaded::Unavailable => CardOutcome::UpstreamUnavailable,
    };
    card_reply("csdn", outcome, theme, key, "public, max-age=300, s-maxage=600, stale-while-revalidate=86400").into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ints_the_way_javascript_does() {
        assert_eq!(js_parse_int(" 1,234".replace(',', "").as_str()), 1234.0);
        assert_eq!(js_parse_int("25年"), 25.0);
        assert_eq!(js_parse_int("暂无"), 0.0);
        assert_eq!(js_parse_int(""), 0.0);
        assert_eq!(js_parse_int("-3"), -3.0);
    }

    #[test]
    fn a_page_without_the_statistics_strip_is_not_a_profile() {
        assert!(parse_profile("<html><body>nothing here</body></html>", "nobody").is_none());
    }

    #[test]
    fn pairs_each_statistic_with_its_label() {
        let html = "<div class=\"user-profile-head-info-r-c\"><ul>\
            <li><span class=\"user-profile-statistics-name\">原创</span><span class=\"user-profile-statistics-num\">7</span></li>\
            <li><span class=\"user-profile-statistics-name\">粉丝</span><span class=\"user-profile-statistics-num\">1,024</span></li>\
            </ul></div>";
        let profile = parse_profile(html, "someone").expect("strip present");
        assert_eq!(profile["articleCount"], 7.0);
        assert_eq!(profile["followers"], 1024.0);
        assert_eq!(profile["rank"], 0.0);
        assert_eq!(profile["username"], "someone");
    }

    #[test]
    fn reads_the_embedded_state_for_visits() {
        let html = "<div class=\"user-profile-statistics-num\">0</div>\
            <script>window.__INITIAL_STATE__ = {\"pageData\":{\"data\":{\"baseInfo\":{\"blogModule\":{\"visitedTimes\":4321}}}}};</script>";
        let profile = parse_profile(html, "someone").expect("strip present");
        assert_eq!(profile["views"], 4321.0);
    }
}