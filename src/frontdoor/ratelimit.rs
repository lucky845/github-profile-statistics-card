//! apiRateLimiter: the 300-per-15-minutes gate in front of the five platform prefixes.
//!
//! Express mounts one limiter instance on five prefixes (app.ts:74-78), so all five share a single
//! bucket per client. The bucket is a fixed window that opens when the process starts and rolls
//! over every fifteen minutes, and it is keyed by the raw X-Forwarded-For header when the caller
//! sends one and by the peer address otherwise.
//!
//! Three consequences are load-bearing and each was observed against the original:
//!
//! - the limiter sits *inside* the cache middleware, so a cache HIT returns before the bucket is
//!   charged and carries no RateLimit-* headers at all;
//! - the first request past the limit is answered 200 with an SVG error card, not 429: GitHub's
//!   camo caches a 429 into a permanent broken image in a README, so the original degrades the card
//!   instead of refusing it;
//! - a request the limiter turns away still carries the cache middleware's X-Cache-Key and
//!   X-Cache-Status, because Express stamps those before the limiter runs.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::{ConnectInfo, Request};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::Response;
use serde_json::Value;

use super::headers::SECURITY;

/// windowMs: 15 * 60 * 1000 in the original.
const WINDOW: Duration = Duration::from_secs(15 * 60);

/// max: 300 in the original.
const MAX_HITS: u64 = 300;

/// Retry-After is ceil(windowMs / 1000), a constant.
const RETRY_AFTER: &str = "900";

/// The copy the limiter's handler renders. It says API, unlike the unmounted global limiter.
const MESSAGE: &str = "API请求过于频繁，请稍后再试";

/// The five prefixes app.use() mounts the limiter on.
const PREFIXES: [&str; 5] = ["/leetcode", "/github", "/csdn", "/juejin", "/bilibili"];

struct Bucket {
    started: Instant,
    hits: HashMap<String, u64>,
}

/// MemoryStore: one map and one window for the whole process, exactly as the module keeps it.
fn store() -> &'static Mutex<Bucket> {
    static STORE: OnceLock<Mutex<Bucket>> = OnceLock::new();
    STORE.get_or_init(|| {
        Mutex::new(Bucket {
            started: Instant::now(),
            hits: HashMap::new(),
        })
    })
}

/// Charge one request to `key` and report the bucket the original would report: the running total
/// and the seconds left in the window.
fn charge(key: &str) -> (u64, u64) {
    let mut bucket = store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let now = Instant::now();
    if now.duration_since(bucket.started) >= WINDOW {
        bucket.started = now;
        bucket.hits.clear();
    }
    let hits = bucket.hits.entry(key.to_string()).or_insert(0);
    *hits += 1;
    let total = *hits;
    let left = WINDOW.saturating_sub(now.duration_since(bucket.started));
    // Math.ceil((resetTime - Date.now()) / 1000), with Math.max(0, ..) applied by the original.
    let reset = (left.as_millis() as u64).div_ceil(1000);
    (total, reset)
}

/// Express mounts a router on a prefix with a segment boundary and matches it case-insensitively,
/// so /GitHub/octocat counts and /githubx does not.
fn under_a_platform_prefix(path: &str) -> bool {
    PREFIXES.iter().any(|prefix| {
        path.is_char_boundary(prefix.len())
            && path.len() >= prefix.len()
            && path[..prefix.len()].eq_ignore_ascii_case(prefix)
            && (path.len() == prefix.len() || path.as_bytes()[prefix.len()] == b'/')
    })
}

/// keyGenerator: the raw X-Forwarded-For value, else the peer address, else the literal fallback.
fn client_key(req: &Request) -> String {
    if let Some(value) = req
        .headers()
        .get("x-forwarded-for")
        .and_then(|value| value.to_str().ok())
    {
        return value.to_string();
    }
    req.extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|peer| peer.0.ip().to_string())
        .unwrap_or_else(|| "unknown-client".to_string())
}

fn insert(head: &mut HeaderMap, name: &str, value: &str) {
    if let (Ok(name), Ok(value)) = (
        name.parse::<header::HeaderName>(),
        HeaderValue::from_str(value),
    ) {
        head.insert(name, value);
    }
}

fn write_quota(head: &mut HeaderMap, remaining: u64, reset: u64) {
    insert(head, "ratelimit-limit", &MAX_HITS.to_string());
    insert(head, "ratelimit-remaining", &remaining.to_string());
    insert(head, "ratelimit-reset", &reset.to_string());
}

/// The limiter's handler: a 200 with the error card, no-store, and Retry-After.
fn over_limit(reset: u64) -> Response {
    let body = svg::port::generate_card(
        Value::String("error".to_string()),
        Value::String(MESSAGE.to_string()),
        None,
    )
    .unwrap_or_default();
    let mut response = Response::new(Body::from(body));
    let head = response.headers_mut();
    write_quota(head, 0, reset);
    insert(head, "retry-after", RETRY_AFTER);
    insert(head, "content-type", "image/svg+xml; charset=utf-8");
    insert(head, "cache-control", "no-store");
    for (name, value) in SECURITY {
        insert(head, name, value);
    }
    *response.status_mut() = StatusCode::OK;
    response
}

/// Charge the bucket, answer the card when it is empty, and stamp the quota on everything else.
pub async fn middleware(req: Request, next: Next) -> Response {
    if !under_a_platform_prefix(req.uri().path()) {
        return next.run(req).await;
    }
    let key = client_key(&req);
    let (total, reset) = charge(&key);
    if total > MAX_HITS {
        return over_limit(reset);
    }
    let mut response = next.run(req).await;
    write_quota(response.headers_mut(), MAX_HITS - total, reset);
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bucket is process-wide, so the tests that read absolute numbers take turns.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn guarded() -> std::sync::MutexGuard<'static, ()> {
        let guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut bucket = store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        bucket.started = Instant::now();
        bucket.hits.clear();
        guard
    }

    #[test]
    fn the_first_request_of_a_window_sees_the_whole_quota() {
        let _guard = guarded();
        let (total, reset) = charge("1.2.3.4");
        assert_eq!(total, 1);
        assert_eq!(reset, 900);
        assert_eq!(MAX_HITS - total, 299);
    }

    #[test]
    fn one_bucket_is_shared_by_every_prefix_and_split_by_key() {
        let _guard = guarded();
        charge("1.2.3.4");
        let (second, _) = charge("1.2.3.4");
        assert_eq!(second, 2);
        // A different client starts its own count.
        let (other, _) = charge("9.9.9.9");
        assert_eq!(other, 1);
    }

    #[test]
    fn the_request_past_the_limit_is_the_one_that_is_refused() {
        let _guard = guarded();
        for _ in 0..MAX_HITS {
            let (total, _) = charge("probe");
            assert!(total <= MAX_HITS);
        }
        let (total, _) = charge("probe");
        assert_eq!(total, MAX_HITS + 1);
    }

    #[test]
    fn a_prefix_matches_its_own_segment_only_and_ignores_case() {
        for path in [
            "/github",
            "/github/octocat",
            "/GitHub/OctoCat",
            "/GITHUB/octocat",
            "/bilibili/1",
            "/leetcode/x/y",
        ] {
            assert!(under_a_platform_prefix(path), "{path}");
        }
        for path in ["/githubx", "/github-style/x", "/nope", "/", "/health", "/api/github"] {
            assert!(!under_a_platform_prefix(path), "{path}");
        }
    }

    #[test]
    fn the_refusal_is_a_two_hundred_carrying_the_error_card() {
        let _guard = guarded();
        let response = over_limit(890);
        assert_eq!(response.status(), StatusCode::OK);
        let headers = response.headers();
        assert_eq!(headers["ratelimit-limit"], "300");
        assert_eq!(headers["ratelimit-remaining"], "0");
        assert_eq!(headers["ratelimit-reset"], "890");
        assert_eq!(headers["retry-after"], "900");
        assert_eq!(headers["cache-control"], "no-store");
        assert_eq!(headers["content-type"], "image/svg+xml; charset=utf-8");
    }
}
