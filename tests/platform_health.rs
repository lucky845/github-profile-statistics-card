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

/// An id nobody has asked for before in this process.
///
/// `guarded()` clears the health counters but not the response cache, and the cache is process-wide.
/// Two tests asking for the same path would see the second one answered from L1 -- no fetch, no
/// counter, and a test that fails only when it happens to run second. A per-call nonce makes every
/// request a real one.
fn fresh_id(label: &str) -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or(0);
    format!("{label}-{nanos}")
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

/// The whole `data` object `/health` publishes.
fn health_data() -> serde_json::Value {
    let (status, body) = get("/health");
    assert_eq!(status, StatusCode::OK);
    let envelope: serde_json::Value = serde_json::from_str(&body).expect("a JSON envelope");
    envelope["data"].clone()
}

/// `data.status` used to be the literal string `"unhealthy"` for the life of every process, because
/// the original read it off a PostgreSQL connection this port does not have. The field now answers
/// the question the process can actually answer -- are the sources it depends on reachable -- and
/// that answer has to move when the counters move. A status that cannot change is not a status.
#[test]
fn the_verdict_starts_unknown_and_follows_the_counters() {
    let _guard = guarded();
    assert_eq!(
        health_data()["status"],
        serde_json::json!("unknown"),
        "nothing has been asked since boot, so nobody knows yet"
    );

    // juejin has no validators, so this reaches the upstream and leaves a stamp either way. Which
    // of the two branches ran depends on the network, and both are legitimate: a rendered card is
    // healthy, a failed fetch is unhealthy. What must not happen is a third answer.
    let target = format!("/juejin/{}", fresh_id("verdict"));
    get(&target);

    let data = health_data();
    let verdict = data["status"]
        .as_str()
        .unwrap_or_else(|| panic!("no status string: {data}"));
    let entry = data["platforms"]
        .get("juejin")
        .unwrap_or_else(|| panic!("juejin never reached /health: {}", data["platforms"]));
    let ok_at = entry["lastOkAt"].as_u64().unwrap_or(0);
    let fail_at = entry["lastFailureAt"].as_u64().unwrap_or(0);
    let expected = if fail_at >= ok_at { "unhealthy" } else { "healthy" };
    assert_eq!(
        verdict, expected,
        "the verdict and the evidence it is drawn from disagree: {data}"
    );
    assert_ne!(verdict, "unknown", "a platform was asked: {data}");
}

/// `status` and `platforms` are one snapshot, not two reads. If they were two, a request landing
/// between them could publish a verdict that contradicts the object printed beside it.
#[test]
fn the_verdict_is_derived_from_the_platforms_printed_beside_it() {
    let _guard = guarded();
    let csdn = format!("/csdn/{}", fresh_id("verdict-evidence"));
    let juejin = format!("/juejin/{}", fresh_id("verdict-evidence"));
    get(&csdn);
    get(&juejin);

    let data = health_data();
    let platforms = data["platforms"]
        .as_object()
        .unwrap_or_else(|| panic!("no platforms object: {data}"));
    assert!(!platforms.is_empty(), "two platforms were asked: {data}");

    let any_failed_last = platforms.values().any(|entry| {
        let ok_at = entry["lastOkAt"].as_u64().unwrap_or(0);
        let fail_at = entry["lastFailureAt"].as_u64().unwrap_or(0);
        (ok_at > 0 || fail_at > 0) && fail_at >= ok_at
    });
    let expected = if any_failed_last { "unhealthy" } else { "healthy" };
    assert_eq!(data["status"], serde_json::json!(expected), "{data}");
}

/// There is no database in this port. Saying `"unhealthy"` claims one exists and is broken, and an
/// operator reading that goes looking for a connection string that was never meant to exist.
#[test]
fn the_database_says_it_is_not_configured_rather_than_broken() {
    let _guard = guarded();
    let data = health_data();
    assert_eq!(
        data["database"]["status"],
        serde_json::json!("not_configured"),
        "no database is wired, so its status must say so: {data}"
    );
    // The shape stays, so a probe that parses it keeps working; the pool is honestly empty.
    assert_eq!(data["database"]["pool"]["isConnected"], serde_json::json!(false));
    assert_eq!(data["database"]["pool"]["poolSize"], serde_json::json!(0));
}
