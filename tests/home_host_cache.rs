//! The homepage gallery embeds the request's Host in every card URL, so two hosts must never
//! share one cached body.
//!
//! This is a regression test for the "only the first URL renders" bug: the cache key is
//! `method:path:query` (`src/frontdoor/keys.rs:92`), which carries no host. The first request to
//! `/` used to store its HTML under `http:GET:_:` and every later host replayed that body, so the
//! gallery kept pointing at whichever domain happened to arrive first.
//!
//! Driving the real router is deliberate: the defect lived in the interaction between
//! `cache::middleware` and `handlers::home`, and either half in isolation looks correct.

use axum::body::Body;
use axum::http::{Request, StatusCode};
use tower::ServiceExt;

/// `public_base_url` reads `PUBLIC_BASE_URL` and would make both hosts resolve identically. The
/// variable is process-wide, and Rust runs tests in threads, so this test owns it for its duration.
static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// These are plain `#[test]`s driving a current-thread runtime rather than `#[tokio::test]`s: the
/// env guard has to be held across the whole scenario, and a `std` `MutexGuard` cannot cross an
/// `await`. `block_on` is a synchronous call, so the guard stays on one stack frame — the same
/// shape `src/frontdoor/cache.rs:501` already uses for the same reason.
fn blocked_on<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("test runtime")
        .block_on(future)
}

fn env_guard() -> std::sync::MutexGuard<'static, ()> {
    let guard = ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    // SAFETY: edition 2024 makes mutating the environment unsafe because another thread could be
    // reading it. ENV_LOCK serialises every test in this file that touches PUBLIC_BASE_URL, so no
    // other reader can race with this write for the length of the guard.
    unsafe {
        std::env::remove_var("PUBLIC_BASE_URL");
    }
    guard
}

/// One GET carrying the given Host, answered by the full layer stack.
fn get(uri: &str, host: Option<&str>) -> (StatusCode, axum::http::HeaderMap, Vec<u8>) {
    let mut builder = Request::builder().method("GET").uri(uri);
    if let Some(host) = host {
        builder = builder.header(axum::http::header::HOST, host);
    }
    let request = builder.body(Body::empty()).expect("a request");
    let response = blocked_on(app::router().oneshot(request)).expect("a response");
    let status = response.status();
    let headers = response.headers().clone();
    let body = blocked_on(axum::body::to_bytes(response.into_body(), usize::MAX))
        .expect("a body")
        .to_vec();
    (status, headers, body)
}

fn home_with_host(host: &str) -> String {
    let (status, _, body) = get("/", Some(host));
    assert_eq!(status, StatusCode::OK);
    String::from_utf8(body).expect("utf-8 html")
}

#[test]
fn two_hosts_get_their_own_gallery_urls() {
    let _env = env_guard();

    // The order matters: the bug only shows when a second host arrives after the first one has
    // already filled the cache entry.
    let first = home_with_host("alpha.example");
    let second = home_with_host("beta.example");

    // Every card URL in the gallery is built from `public_base_url`, so the host has to appear in
    // the markup -- and the two bodies cannot be the same string.
    assert!(
        first.contains("http://alpha.example/github/"),
        "the first host should appear in its own gallery; got: {}",
        first.chars().take(200).collect::<String>()
    );
    assert!(
        second.contains("http://beta.example/github/"),
        "the second host should appear in its own gallery, not replay the first host's cached body"
    );
    assert_ne!(first, second, "two hosts must not share one cached homepage");
}

/// The flip side: skipping the process cache for `/` must not turn it off everywhere.
///
/// `/livez` is the probe of choice because it answers 200 with no upstream call and no counter of
/// its own. A 404 would not do: `cache::middleware` only stores successful responses
/// (`src/frontdoor/cache.rs:324`), so a 404 is a MISS on every request and would prove nothing
/// about the guard's scope.
#[test]
fn other_paths_still_use_the_cache() {
    let _env = env_guard();

    let status_of = || {
        let (status, headers, _) = get("/livez", None);
        assert_eq!(status, StatusCode::OK);
        headers
            .get("x-cache-status")
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default()
            .to_string()
    };

    assert_eq!(status_of(), "MISS", "a cold path is a miss");
    assert_eq!(
        status_of(),
        "HIT",
        "a non-homepage path must still be served from the process cache"
    );
}
