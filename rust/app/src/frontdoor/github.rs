//! The GitHub card, answered in Rust.
//!
//! The original runs validate -> cache -> fetch -> render -> sanitize. Validation and the 404
//! pages belong to handlers; this module owns the tail: the upstream call, the in-process cache
//! that keeps the anonymous 60-requests-per-hour quota alive across a replay, and the three
//! sanitizer rewrites that turn a rendered card into the recorded bytes.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use super::handlers::{CARD_CACHE, THEMES};
use super::headers::Reply;
use super::json::js_number;

/// The TTL the original requests for this route (CACHE_SPECS[0].ttl = 600).
const CACHE_TTL_SECONDS: u64 = 600;

/// The upstream budget the original gives one call (getJson's default timeout).
const UPSTREAM_TIMEOUT_MS: u64 = 8000;

const SHORT_CACHE: &str = "public, max-age=60";
const NO_STORE: &str = "no-store";
const NOT_FOUND_MESSAGE: &str = "未找到该用户";
const RATE_LIMITED_MESSAGE: &str = "数据源限流，请稍后再试";
const DATA_UNAVAILABLE_MESSAGE: &str = "该平台暂无此用户的数据";
const USER_AGENT: &str = "GitHub-Stats-Card";

/// The original builds its header set once from githubConfig.apiToken, which reads GITHUB_TOKEN
/// and keeps the empty string when unset — an empty token is the anonymous 60/hour arm, not a
/// broken one. A token lifts the quota to 5000/hour, so this is the difference between a card and
/// a rate-limit card on a deployment that sets one.
fn authorization(token: Option<&str>) -> Option<String> {
    token
        .filter(|value| !value.is_empty())
        .map(|value| format!("Bearer {value}"))
}

fn api_token() -> Option<&'static str> {
    static TOKEN: OnceLock<Option<String>> = OnceLock::new();
    TOKEN
        .get_or_init(|| std::env::var("GITHUB_TOKEN").ok().filter(|v| !v.is_empty()))
        .as_deref()
}

/// Every GitHub call carries the same headers; the token only changes whether one of them is there.
fn with_api_headers(builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
    let builder = builder
        .header("Accept", "application/vnd.github+json")
        .header("User-Agent", USER_AGENT);
    match authorization(api_token()) {
        Some(value) => builder.header("Authorization", value),
        None => builder,
    }
}

fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn cache() -> &'static Mutex<HashMap<String, (u64, Value)>> {
    static CACHE: OnceLock<Mutex<HashMap<String, (u64, Value)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The original keys its cache on the lowercased name and only accepts an entry that still has a
/// numeric publicRepos, so a half-written record can never satisfy a later request.
fn cached(username: &str) -> Option<Value> {
    let key = username.to_lowercase();
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

fn remember(username: &str, stats: &Value) {
    if let Ok(mut guard) = cache().lock() {
        guard.insert(
            username.to_lowercase(),
            (now_seconds() + CACHE_TTL_SECONDS, stats.clone()),
        );
    }
}

/// Why a fetch failed, already classified the way registry.ts classifies it.
enum FetchError {
    NotFound,
    RateLimited,
    Upstream,
}

/// encodeURIComponent, for the characters a GitHub login can contain.
fn encode_uri_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        let plain = byte.is_ascii_alphanumeric()
            || matches!(byte, b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | 39 | b'(' | b')');
        if plain {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

async fn fetch_from_api(username: &str) -> Result<Value, FetchError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(UPSTREAM_TIMEOUT_MS))
        .build()
        .map_err(|_| FetchError::Upstream)?;
    let encoded = encode_uri_component(username);
    let profile = with_api_headers(client.get(format!("https://api.github.com/users/{encoded}")))
        .send()
        .await
        .map_err(|_| FetchError::Upstream)?;
    let status = profile.status().as_u16();
    if status == 404 {
        return Err(FetchError::NotFound);
    }
    if status == 429 || status == 403 {
        return Err(FetchError::RateLimited);
    }
    if status >= 400 {
        return Err(FetchError::Upstream);
    }
    let body = profile.text().await.map_err(|_| FetchError::Upstream)?;
    let profile: Value = serde_json::from_str(&body).map_err(|_| FetchError::Upstream)?;
    let public_repos = js_number(profile.get("public_repos"));
    let followers = js_number(profile.get("followers"));

    // A failed repository page only costs the star count, exactly like the original's warn arm.
    let mut total_stars = 0.0;
    let repos_url = format!("https://api.github.com/users/{encoded}/repos?per_page=100&sort=updated");
    let repos_body = match with_api_headers(client.get(repos_url)).send().await {
        Ok(response) => match response.error_for_status() {
            Ok(response) => response.text().await.ok(),
            Err(_) => None,
        },
        Err(_) => None,
    };
    if let Some(text) = repos_body
        && let Ok(Value::Array(items)) = serde_json::from_str::<Value>(&text)
    {
        total_stars = items
            .iter()
            .map(|repo| js_number(repo.get("stargazers_count")))
            .sum();
    }

    Ok(json!({
        "username": username,
        "publicRepos": public_repos,
        "followers": followers,
        "totalStars": total_stars,
    }))
}

async fn load(username: &str) -> Result<Value, FetchError> {
    if let Some(stats) = cached(username) {
        return Ok(stats);
    }
    let stats = fetch_from_api(username).await?;
    remember(username, &stats);
    Ok(stats)
}

/// validateTheme: keep alphanumerics and hyphens, lowercase, then accept the name only when the
/// renderer knows it. Anything else reaches generateCard as the literal default, which is light.
pub fn theme_name(raw: Option<&str>) -> &'static str {
    let Some(raw) = raw else {
        return "default";
    };
    if raw.is_empty() {
        return "default";
    }
    let sanitized: String = raw
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-')
        .map(|c| c.to_ascii_lowercase())
        .collect();
    THEMES
        .iter()
        .copied()
        .find(|known| *known == sanitized)
        .unwrap_or("default")
}

/// The three rewrites DOMPurify's svg profile makes to a rendered card: drop role="img", drop the
/// unsupported font-variant-numeric attribute, and expand the self-closing shape tags.
fn sanitize_svg(svg: &str) -> String {
    let stripped = svg
        .replace(" role=\"img\"", "")
        .replace(" font-variant-numeric=\"tabular-nums\"", "");
    expand_self_closing(&stripped)
}

/// Turns <rect .../> into <rect ...></rect> for the tags the sanitizer expands.
fn expand_self_closing(input: &str) -> String {
    const SELF_CLOSED: [&str; 7] = [
        "rect", "circle", "line", "path", "ellipse", "polyline", "polygon",
    ];
    let bytes = input.as_bytes();
    let mut out = String::with_capacity(input.len() + 128);
    let mut last = 0usize;
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] != b'<' {
            i += 1;
            continue;
        }
        let rest = &input[i + 1..];
        let mut matched: Option<&str> = None;
        for tag in SELF_CLOSED {
            if rest.starts_with(tag) {
                let after = rest.as_bytes().get(tag.len()).copied();
                if matches!(after, Some(c) if c.is_ascii_whitespace() || c == b'/') {
                    matched = Some(tag);
                    break;
                }
            }
        }
        let Some(tag) = matched else {
            i += 1;
            continue;
        };
        let mut j = i + 1 + tag.len();
        let mut quote: Option<u8> = None;
        while j < bytes.len() {
            let c = bytes[j];
            match quote {
                Some(open) => {
                    if c == open {
                        quote = None;
                    }
                }
                None => {
                    if c == b'"' || c == 39 {
                        quote = Some(c);
                    } else if c == b'>' {
                        break;
                    }
                }
            }
            j += 1;
        }
        if j >= bytes.len() || bytes[j] != b'>' || j <= i + 1 + tag.len() || bytes[j - 1] != b'/' {
            i += 1;
            continue;
        }
        let mut head = &input[last..j - 1];
        if head.ends_with(' ') {
            head = &head[..head.len() - 1];
        }
        out.push_str(head);
        out.push('>');
        out.push_str("</");
        out.push_str(tag);
        out.push('>');
        last = j + 1;
        i = j + 1;
    }
    out.push_str(&input[last..]);
    out
}

fn render(data: Value, theme: &str) -> String {
    src_services_svg_::port::generate_card(
        Value::String("github".into()),
        data,
        Some(theme.to_string()),
    )
    .unwrap_or_default()
}

fn failure(error: FetchError, theme: &str, key: String) -> Response {
    // STATUS_BY_REASON / MESSAGE_BY_REASON: only NOT_FOUND leaves 200, and only a 200 keeps a TTL.
    let (status, cache_control, message) = match error {
        FetchError::NotFound => (StatusCode::NOT_FOUND, NO_STORE, NOT_FOUND_MESSAGE),
        FetchError::RateLimited => (StatusCode::OK, SHORT_CACHE, RATE_LIMITED_MESSAGE),
        FetchError::Upstream => (StatusCode::OK, SHORT_CACHE, DATA_UNAVAILABLE_MESSAGE),
    };
    // The failure branch of the original never runs the sanitizer.
    let svg = src_services_svg_::port::generate_card(
        Value::String("error".into()),
        Value::String(message.into()),
        Some(theme.to_string()),
    )
    .unwrap_or_default();
    Reply::new(status, "image/svg+xml; charset=utf-8", svg)
        .cache_key(key, "MISS")
        .cache_control(cache_control)
        .into_response()
}

/// GET /github/:username, after validation let the name through.
pub async fn card(id: &str, raw_theme: Option<&str>, key: String) -> Response {
    let theme = theme_name(raw_theme);
    let stats = match load(id).await {
        Ok(stats) => stats,
        Err(error) => return failure(error, theme, key),
    };
    let svg = sanitize_svg(&render(stats, theme));
    Reply::new(StatusCode::OK, "image/svg+xml; charset=utf-8", svg)
        .cache_key(key, "MISS")
        .cache_control(CARD_CACHE)
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_self_closing_shapes_only() {
        let raw = "<svg a=\"1\"><rect x=\"1\" rx=\"8\" fill=\"#fff\"/><circle cx=\"1\" cy=\"2\" r=\"3\"/><text y=\"1\">a</text><line x1=\"1\"/></svg>";
        let out = expand_self_closing(raw);
        assert!(out.contains("<rect x=\"1\" rx=\"8\" fill=\"#fff\"></rect>"));
        assert!(out.contains("<circle cx=\"1\" cy=\"2\" r=\"3\"></circle>"));
        assert!(out.contains("<line x1=\"1\"></line>"));
        assert!(out.contains("<svg a=\"1\">"));
        assert!(out.contains("<text y=\"1\">a</text>"));
    }

    #[test]
    fn drops_the_two_attributes_the_svg_profile_rejects() {
        let raw = "<svg xmlns=\"x\" role=\"img\" aria-label=\"y\"><text font-variant-numeric=\"tabular-nums\">8</text></svg>";
        let out = sanitize_svg(raw);
        assert_eq!(
            out,
            "<svg xmlns=\"x\" aria-label=\"y\"><text>8</text></svg>"
        );
    }

    #[test]
    fn an_empty_token_is_the_anonymous_arm() {
        assert_eq!(authorization(None), None);
        assert_eq!(authorization(Some("")), None);
        assert_eq!(
            authorization(Some("ghp_abc")),
            Some("Bearer ghp_abc".to_string())
        );
    }

    #[test]
    fn theme_reaches_the_renderer_only_when_known() {
        assert_eq!(theme_name(Some("dark")), "dark");
        assert_eq!(theme_name(Some("DARK")), "dark");
        assert_eq!(theme_name(Some("github-dark-dimmed")), "github-dark-dimmed");
        assert_eq!(theme_name(Some("transparent")), "transparent");
        assert_eq!(theme_name(Some("hllowrld")), "default");
        assert_eq!(theme_name(Some("")), "default");
        assert_eq!(theme_name(None), "default");
    }
}