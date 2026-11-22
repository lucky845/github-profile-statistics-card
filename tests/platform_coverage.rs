//! Every platform mount must answer a card on the paths the card prefixes cover.
//!
//! The platform list lives in `frontdoor::registry::PLATFORMS` (`src/frontdoor/registry.rs`). Other
//! places need the same knowledge: the 404 handler picks SVG versus JSON by it, the rate limiter
//! mounts on it, and the gallery renders one card per entry. Each used to keep its own copy, and
//! the copies drifted: juejin was registered everywhere except the 404 handler's hardcoded array,
//! so `GET /juejin/` answered `application/json` while every other platform answered a card. The
//! same defect shipped in the Node version (`src/middleware/error.middleware.ts:168`), which is why
//! it survived the port unnoticed. The registry now owns the one list; these tests are the check
//! that every consumer actually reads it.
//!
//! These tests drive the real router instead of comparing lists: one list can be made to agree
//! with another while the response stays wrong. What has to hold is the answer a client gets.

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

/// One GET, answered by the full layer stack.
fn get_with(uri: &str, host: &str) -> (StatusCode, String, Vec<u8>, axum::http::HeaderMap) {
    let request = Request::builder()
        .method("GET")
        .uri(uri)
        .header(axum::http::header::HOST, host)
        .body(Body::empty())
        .expect("a request");
    let response = blocked_on(app::router().oneshot(request)).expect("a response");
    let status = response.status();
    let content_type = response
        .headers()
        .get(axum::http::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    // Headers have to be read before the body takes the response apart.
    let headers = response.headers().clone();
    let body = blocked_on(axum::body::to_bytes(response.into_body(), usize::MAX))
        .expect("a body")
        .to_vec();
    (status, content_type, body, headers)
}

/// One GET, answered by the full layer stack.
fn get(uri: &str) -> (StatusCode, String, Vec<u8>) {
    let (status, content_type, body, _) = get_with(uri, "cards.example.com");
    (status, content_type, body)
}

/// `/<platform>/` has a mount but no id, so it never matches the `/:param` child route and lands in
/// the 404 handler. That handler owes every platform the same answer: a card. The path still looks
/// like one, and a card is what an `<img>` tag can actually show.
#[test]
fn every_platform_mount_answers_a_card_when_the_id_is_missing() {
    let mut wrong = Vec::new();
    for desc in app::frontdoor::registry::all() {
        let platform = desc.name;
        let (status, content_type, body) = get(&format!("/{platform}/"));
        if status != StatusCode::NOT_FOUND {
            wrong.push(format!("/{platform}/: status {status}, want 404"));
        }
        if !content_type.starts_with("image/svg+xml") {
            wrong.push(format!(
                "/{platform}/: content-type {content_type:?}, want image/svg+xml"
            ));
        }
        if !body.starts_with(b"<svg") {
            wrong.push(format!("/{platform}/: the body is not an SVG"));
        }
    }
    assert!(
        wrong.is_empty(),
        "a platform mount answered something an <img> tag cannot render:\n  {}",
        wrong.join("\n  ")
    );
}

/// The gallery is the home page's list of cards. A platform registered but never rendered there is
/// invisible to visitors: the same class of drift as the 404 handler's hardcoded array.
#[test]
fn the_gallery_renders_one_card_per_registered_platform() {
    let (status, _, body) = get("/");
    assert_eq!(status, StatusCode::OK);
    let html = String::from_utf8(body).expect("the home page is UTF-8");
    let missing: Vec<&str> = app::frontdoor::registry::all()
        .iter()
        .map(|desc| desc.name)
        .filter(|platform| !html.contains(&format!("/{platform}/")))
        .collect();
    assert!(
        missing.is_empty(),
        "the gallery has no card for {missing:?}, so those platforms are unreachable from /"
    );
}
