//! The platform health counters have to be reachable from `/health`.
//!
//! `record_ok` / `record_fail` shipped with unit tests but no caller: the port dropped the
//! `registry.ts` decorator that used to wrap every fetch, so the counters could never move and
//! `/health` answered `"platforms": {}` forever. An operator asking "is CSDN failing quietly"
//! got an empty object. These tests drive the real router and then read `/health`, because that
//! round trip is what was missing -- the counters were never wrong, they were unwired.
//!
//! The counters are process-wide, so every test here takes `COUNTER_LOCK` and resets them first.
//! cargo runs the tests in one file on several threads; without the lock they would read each
//! other's numbers and fail in ways that look like a wiring bug.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

static COUNTER_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Serialises the tests and clears the counters, so each one starts from a known state.
fn guarded() -> std::sync::MutexGuard<'static, ()> {
    let guard = COUNTER_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    app::frontdoor::platforms_reset_health_for_tests();
    guard
}

/// A single-thread runtime, so a test can drive the whole stack without `#[tokio::test]`.
fn blocked_on<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("test runtime")
        .block_on(future)
}

/// One GET, answered by the full layer stack.
fn get(uri: &str) -> (StatusCode, String) {
    let request = Request::builder()
        .method("GET")
        .uri(uri)
        .header(axum::http::header::HOST, "cards.example.com")
        .body(Body::empty())
        .expect("a request");
    let response = blocked_on(app::router().oneshot(request)).expect("a response");
    let status = response.status();
    let body = blocked_on(axum::body::to_bytes(response.into_body(), usize::MAX))
        .expect("a body");
    (status, String::from_utf8_lossy(&body).to_string())
}

/// The `platforms` object `/health` reports.
fn platforms() -> serde_json::Value {
    let (status, body) = get("/health");
    assert_eq!(status, StatusCode::OK);
    let envelope: serde_json::Value = serde_json::from_str(&body).expect("a JSON envelope");
    envelope["data"]["platforms"].clone()
}

/// A request that reaches a platform and comes back with *some* card has to leave a counter
/// behind, whichever way the upstream felt that second. juejin is the useful platform here: it has
/// no validators, so nothing short of a network failure keeps the request from reaching it.
#[test]
fn a_card_request_leaves_a_counter_behind() {
    let _guard = guarded();
    assert_eq!(platforms(), serde_json::json!({}), "counters start empty");

    let (_, _) = get("/juejin/definitely-not-a-real-user-xyz");

    let health = platforms();
    let entry = health
        .get("juejin")
        .unwrap_or_else(|| panic!("juejin never reached /health: {health}"));
    let counted = entry["ok"].as_u64().unwrap_or(0) + entry["fail"].as_u64().unwrap_or(0);
    assert_eq!(counted, 1, "one request, one counter: {entry}");
}

/// A rejected id never reaches the platform, so it must not be charged to it. Getting this wrong
/// would make a typo in a README look like a failing upstream.
#[test]
fn a_rejected_id_does_not_move_the_counters() {
    let _guard = guarded();
    let (status, _) = get("/github/a");
    assert_eq!(status, StatusCode::BAD_REQUEST);

    assert_eq!(
        platforms(),
        serde_json::json!({}),
        "validation happens before the fetch, so nothing was fetched"
    );
}

/// `/health` is excluded from the cache middleware precisely so probing it does not produce
/// events of its own. If it ever moved a counter, every monitoring poll would look like traffic.
#[test]
fn probing_health_does_not_move_the_counters() {
    let _guard = guarded();
    let first = platforms();
    let second = platforms();
    assert_eq!(first, second);
    assert_eq!(first, serde_json::json!({}));
}

/// The shape `/health` promises: an entry per platform that has been called, with the counters the
/// health module maintains. A wrong key here is invisible until someone greps it during an
/// incident.
#[test]
fn a_platform_entry_carries_the_counters_the_health_module_maintains() {
    let _guard = guarded();
    get("/juejin/some-user");

    let health = platforms();
    let entry = health.get("juejin").expect("an entry");
    assert!(entry.get("ok").is_some(), "no ok counter: {entry}");
    assert!(entry.get("fail").is_some(), "no fail counter: {entry}");
    // Whichever branch ran left exactly one of the two timestamps behind.
    let stamped = entry.get("lastOkAt").is_some() || entry.get("lastFailureAt").is_some();
    assert!(stamped, "neither timestamp was written: {entry}");
}
