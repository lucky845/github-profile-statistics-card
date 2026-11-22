//! `/stats.externalApis` has to publish one live tally per platform.
//!
//! The port published two keys for five platforms: `github` (never incremented anywhere, so a
//! constant 0 dressed as a measurement) and `leetcode` (live). The other three platforms were
//! absent, which reads as "no traffic" rather than "not counted" -- the worst of the three
//! possible messages. `/health`'s `platforms` field had the same disease and was fixed by wiring
//! the counters up; this is the same fix for the same counters' other reader.
//!
//! These tests drive the real router rather than calling the counters directly, because the bug
//! was never in a counter: it was in a response shape that did not follow the platform list. The
//! assertions therefore ask the endpoint, not the atomics.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

/// The tallies are process-wide and this file's tests run on several threads, so one test's card
/// request would land between another's before/after readings. Serialising them is what makes
/// "no other tally moved" a meaningful assertion rather than a race that fails once a week.
static TALLY_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn guarded() -> std::sync::MutexGuard<'static, ()> {
    TALLY_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

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
    let body = blocked_on(axum::body::to_bytes(response.into_body(), usize::MAX))
        .expect("a body");
    (status, String::from_utf8_lossy(&body).to_string())
}

/// The `externalApis` object out of `/stats`, in the order the body publishes it.
fn tallies() -> Vec<(String, u64)> {
    let (status, body) = get("/stats");
    assert_eq!(status, StatusCode::OK);
    let envelope: serde_json::Value = serde_json::from_str(&body).expect("a JSON envelope");
    envelope["data"]["externalApis"]
        .as_object()
        .unwrap_or_else(|| panic!("no externalApis object in /stats: {body}"))
        .iter()
        .map(|(key, value)| {
            let count = value
                .as_u64()
                .unwrap_or_else(|| panic!("{key} is not a number in /stats: {body}"));
            (key.clone(), count)
        })
        .collect()
}

/// The tally for one platform, read out of the same list the endpoint publishes.
fn tally(list: &[(String, u64)], platform: &str) -> u64 {
    list.iter()
        .find(|(key, _)| key == platform)
        .unwrap_or_else(|| panic!("/stats publishes no {platform} tally"))
        .1
}

/// The published keys are the registered platforms, in the registry's order. A hand-written pair
/// of keys for five platforms is exactly how three of them went missing, so this compares against
/// the registry itself.
#[test]
fn stats_publishes_one_tally_per_registered_platform() {
    let _guard = guarded();
    let keys: Vec<String> = tallies().into_iter().map(|(key, _)| key).collect();
    let expected: Vec<String> = app::frontdoor::registry::all()
        .iter()
        .map(|desc| desc.name.to_string())
        .collect();
    assert_eq!(
        keys, expected,
        "/stats externalApis must follow the platform registry, not a hand-written subset"
    );
}

/// Requesting a card charges that platform exactly as many calls as the card really makes, and
/// charges nobody else.
///
/// The numbers are not "at least one": a card that makes four upstream calls is four requests
/// against the upstream's quota, and a tally that says one is as wrong as a tally that says zero.
/// Each count below is the number of distinct HTTP requests the platform module issues per card,
/// which is also why removing a single bump fails this test rather than still passing on the
/// other bumps of the same card.
///
/// The ids carry a per-run suffix so no request can be answered from the process cache: a cache
/// HIT never reaches the platform, and this test is about what happens when it does.
#[test]
fn a_card_request_charges_the_calls_that_card_really_makes() {
    let _guard = guarded();
    // Unique per run, so the process cache cannot turn the request into a HIT.
    let nonce = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|elapsed| elapsed.as_nanos())
        .unwrap_or_default();

    for (platform, path, expected) in [
        // csdn: one profile page fetch, retries are the same request repeated.
        ("csdn", format!("/csdn/nobody-{nonce}"), 1),
        // juejin: the user GET and the article list POST run concurrently, one call each.
        ("juejin", format!("/juejin/nobody{nonce}"), 2),
        // bilibili: space page + stat + upstat + card, one call each.
        ("bilibili", format!("/bilibili/{}", nonce % 100_000_000), 4),
    ] {
        let before = tallies();
        let (status, _) = get(&path);
        assert_eq!(status, StatusCode::OK, "{path} did not answer a card");
        let after = tallies();

        let from = tally(&before, platform);
        let to = tally(&after, platform);
        assert_eq!(
            to - from,
            expected,
            "{path} makes {expected} upstream calls per card, but its tally moved {from} -> {to}"
        );

        // The other tallies must not be the ones absorbing the count: a wrong key in one platform
        // module would land here.
        for (key, _) in &before {
            if key == platform {
                continue;
            }
            assert_eq!(
                tally(&before, key),
                tally(&after, key),
                "{path} moved the {key} tally, so {platform}'s calls are charged to it"
            );
        }
    }
}

/// A rejected id stops before the fetch, so it must not produce traffic -- the number would
/// otherwise make a typo look like a failing upstream.
#[test]
fn a_rejected_id_does_not_move_any_tally() {
    let _guard = guarded();
    let before = tallies();
    let (status, _) = get("/github/a");
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(tallies(), before, "validation runs before the fetch");
}
