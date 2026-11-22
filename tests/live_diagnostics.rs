//! The diagnostics endpoints have to answer for *now*, not for five minutes ago.
//!
//! None of `/metrics`, `/metrics/json`, `/stats`, `/api/cache/stats` or `/livez` set a
//! `Cache-Control`, so `cache::middleware` gave each of them the default 300-second TTL and stored
//! the first answer to every following request. Measured before the fix, on a fresh process, each
//! of those paths answered `MISS` then `HIT` -- which means a Prometheus scrape read the gauges
//! from before the previous scrape, and `/stats` kept handing back the counters it had already
//! printed while the counters behind it moved on.
//!
//! `no-store` is the fix, and it is the right one rather than another path in the middleware's
//! exclusion list: these endpoints say out loud that their body is a reading, and the middleware
//! already refuses to store anything carrying that word. `/health` is in the list too even though
//! it escaped the process cache by name -- escaping the in-process map says nothing about the
//! shared tiers a CDN is allowed to put in front of it.
//!
//! Every assertion drives the real router, because the defect lived in the interaction between a
//! handler that sets no policy and a middleware that has a default one.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

/// A single-thread runtime, so a test can drive the whole stack without `#[tokio::test]`.
fn blocked_on<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("test runtime")
        .block_on(future)
}

/// One GET answered by the full layer stack, keeping the headers.
fn get(uri: &str) -> (StatusCode, Vec<(String, String)>, String) {
    let request = Request::builder()
        .method("GET")
        .uri(uri)
        .header(axum::http::header::HOST, "cards.example.com")
        .body(Body::empty())
        .expect("a request");
    let response = blocked_on(app::router().oneshot(request)).expect("a response");
    let status = response.status();
    let headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|text| (name.as_str().to_string(), text.to_string()))
        })
        .collect();
    let body = blocked_on(axum::body::to_bytes(response.into_body(), usize::MAX)).expect("a body");
    (status, headers, String::from_utf8_lossy(&body).to_string())
}

fn header<'a>(headers: &'a [(String, String)], name: &str) -> &'a str {
    headers
        .iter()
        .find(|(key, _)| key.eq_ignore_ascii_case(name))
        .map(|(_, value)| value.as_str())
        .unwrap_or("")
}

fn cache_status(headers: &[(String, String)]) -> String {
    header(headers, "x-cache-status").to_string()
}

/// Every endpoint that reports a live reading. The paths are spelled out rather than derived from
/// a constant so that adding a route to this list is a conscious act -- the failure mode this test
/// guards against is precisely a route nobody remembered.
const LIVE_ENDPOINTS: [&str; 6] = [
    "/metrics",
    "/metrics/json",
    "/stats",
    "/api/cache/stats",
    "/livez",
    "/health",
];

/// The word that makes the cache middleware skip the write.
#[test]
fn every_live_endpoint_answers_no_store() {
    for path in LIVE_ENDPOINTS {
        let (status, headers, _) = get(path);
        assert_eq!(status, StatusCode::OK, "{path} answered {status}");
        assert!(
            header(&headers, "cache-control").contains("no-store"),
            "{path} is a live reading but does not forbid storing it: cache-control={:?}",
            header(&headers, "cache-control")
        );
    }
}

/// The consequence that matters: the second read must not be the first read's leftovers, and
/// `/stats` must show a counter that moved between the two calls.
#[test]
fn a_second_read_is_a_fresh_answer_rather_than_a_replay() {
    // Two calls to each; a stored response would answer HIT on the second.
    for path in LIVE_ENDPOINTS {
        let _ = get(path);
        let (_, headers, _) = get(path);
        assert_ne!(
            cache_status(&headers),
            "HIT",
            "{path} was served from the process cache; its body is a reading, not a document"
        );
    }
}

/// `/stats.externalApis.github` used to be the literal 0: the original declared the counter and
/// never incremented it. The port kept the declaration, so the field was decoration. Charging the
/// counter where the outbound request is built means a card request moves it even when the upstream
/// then fails -- which is the honest number, since the call was made.
#[test]
fn a_github_card_request_moves_the_github_call_counter() {
    let before = github_calls();
    let _ = get("/github/lucky845");
    let after = github_calls();
    assert!(
        after > before,
        "a GitHub card request made outbound calls but the tally stayed at {before}"
    );
}

/// The `github` tally out of `/stats`, placed where the envelope nests it.
fn github_calls() -> u64 {
    let (status, _, body) = get("/stats");
    assert_eq!(status, StatusCode::OK);
    let envelope: serde_json::Value = serde_json::from_str(&body).expect("a JSON envelope");
    envelope["data"]["externalApis"]["github"]
        .as_u64()
        .unwrap_or_else(|| panic!("no github tally in /stats: {body}"))
}

/// The three endpoints whose body is a live reading were also reachable through the *shared* tier,
/// which is why the policy has to forbid the write rather than just skip the read. A response that
/// says `no-store` is not stored by either tier; this test pins the word itself so a future
/// refactor cannot quietly swap it for `no-cache` (which allows storing, and revalidating).
#[test]
fn the_policy_is_no_store_rather_than_no_cache() {
    for path in ["/stats", "/livez", "/api/cache/stats"] {
        let (_, headers, _) = get(path);
        let policy = header(&headers, "cache-control");
        assert!(
            policy.split(',').any(|part| part.trim() == "no-store"),
            "{path} says {policy:?}; no-cache still allows a store to keep a copy"
        );
    }
}
