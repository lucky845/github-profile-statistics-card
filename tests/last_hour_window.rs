//! `/stats.requests.lastHour` has to be an hour, not a copy of the total.
//!
//! The original bumped `global.requestCount` and `global.requestCountLastHour` in the same
//! middleware line and reset neither, so the field named `lastHour` published the process's
//! whole life. Two numbers that are always equal, one of them mislabelled.
//!
//! A test cannot wait out an hour, and the assertion that fits in CI -- "the hour is at most the
//! total" -- is satisfied by the defect itself. So the window is aged through the same rotation
//! code that ages it in production, and the assertion is that the hour drops to zero while the
//! total does not move. That is the one property the old implementation cannot produce.
//!
//! One test per process: ageing leaves the window ahead of the wall clock, which is harmless for
//! a single test and confusing for a second one sharing the process.

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

/// One GET answered by the full layer stack.
fn get(uri: &str) -> (StatusCode, String) {
    let request = Request::builder()
        .method("GET")
        .uri(uri)
        .header(axum::http::header::HOST, "cards.example.com")
        .body(Body::empty())
        .expect("a request");
    let response = blocked_on(app::router().oneshot(request)).expect("a response");
    let status = response.status();
    let body = blocked_on(axum::body::to_bytes(response.into_body(), usize::MAX)).expect("a body");
    (status, String::from_utf8_lossy(&body).to_string())
}

/// The two request counters out of `/stats`, in the order the body publishes them.
fn counters() -> (u64, u64) {
    let (status, body) = get("/stats");
    assert_eq!(status, StatusCode::OK);
    let envelope: serde_json::Value = serde_json::from_str(&body).expect("a JSON envelope");
    let number = |key: &str| {
        envelope["data"]["requests"][key]
            .as_u64()
            .unwrap_or_else(|| panic!("no numeric requests.{key} in /stats: {body}"))
    };
    (number("total"), number("lastHour"))
}

/// The hour forgets; the total does not.
#[test]
fn the_published_hour_forgets_requests_without_rewinding_the_total() {
    // Unique per run, so nothing below can be answered from the process cache.
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();
    for step in 0..5 {
        let (status, _) = get(&format!("/api/theme/test?probe=last-hour-{nonce}-{step}"));
        assert_eq!(status, StatusCode::OK, "the probe request must reach the metrics layer");
    }

    // Both numbers include the `/stats` call that reads them: the middleware runs before the
    // handler, which is the same reason a request to /stats counts itself.
    let (total_before, hour_before) = counters();
    assert!(
        hour_before >= 5,
        "five requests plus the read itself must be inside the hour, got {hour_before}"
    );
    assert!(
        total_before >= hour_before,
        "the hour is a subset of the total: hour {hour_before}, total {total_before}"
    );

    // An hour and a minute: enough for the whole window to fall out.
    app::frontdoor::metrics::age_last_hour_for_tests(61);

    let (total_after, hour_after) = counters();
    assert_eq!(
        hour_after, 1,
        "only the /stats call that read the window may be left in it, got {hour_after}"
    );
    assert_eq!(
        total_after,
        total_before + 1,
        "forgetting an hour must not rewind the lifetime total (before {total_before})"
    );
}
