//! DELETE /api/cache/clear is a closed door until a deployment holds a key for it.
//!
//! The endpoint arrived with no credential check at all (`bae577b^:src/app.ts:92` registers
//! `manualCacheClearHandler` bare), and that was survivable in the original because clearing only
//! emptied one process's in-memory map. This port added a shared Redis tier behind it, so one
//! anonymous DELETE now empties every instance at once and sends the whole fleet at an upstream
//! that allows 60 anonymous requests an hour.
//!
//! Every refusal test below asserts two things, and the second is the one that matters: the status
//! code, and that the cache **still answers HIT**. A handler that clears first and refuses after
//! satisfies any status-only assertion while doing exactly the damage this change exists to
//! prevent, and a status-only test would call it fixed.

use std::sync::Mutex;

use axum::body::Body;
use axum::http::{HeaderMap, Request, StatusCode};
use serde_json::Value;
use tower::ServiceExt;

/// The environment variable and the process-wide cache are both shared state, and cargo runs the
/// tests in one file on several threads. Without this lock one test clears the cache another one
/// is using as its witness and the failure looks like a bug in the handler.
static TEST_LOCK: Mutex<()> = Mutex::new(());

fn guard() -> std::sync::MutexGuard<'static, ()> {
    TEST_LOCK
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

/// Edition 2024 makes the environment unsafe to write: a concurrent reader could observe a
/// half-updated value. Every test here takes TEST_LOCK first, which is what makes it sound.
fn set_token(value: Option<&str>) {
    match value {
        Some(value) => unsafe { std::env::set_var("CACHE_CLEAR_TOKEN", value) },
        None => unsafe { std::env::remove_var("CACHE_CLEAR_TOKEN") },
    }
}

/// One request through the full layer stack, answering the status, the headers and the raw body.
fn call(method: &str, uri: &str, authorization: Option<&str>) -> (StatusCode, HeaderMap, String) {
    let mut builder = Request::builder()
        .method(method)
        .uri(uri)
        .header(axum::http::header::HOST, "cards.example.com");
    if let Some(value) = authorization {
        builder = builder.header(axum::http::header::AUTHORIZATION, value);
    }
    let request = builder.body(Body::empty()).expect("a request");
    let response = blocked_on(app::router().oneshot(request)).expect("a response");
    let status = response.status();
    // Headers have to be read before the body takes the response apart.
    let headers = response.headers().clone();
    let body = blocked_on(axum::body::to_bytes(response.into_body(), usize::MAX))
        .expect("a body");
    (status, headers, String::from_utf8_lossy(&body).to_string())
}

fn envelope(body: &str) -> Value {
    serde_json::from_str(body).unwrap_or_else(|error| panic!("not JSON ({error}): {body}"))
}

fn message(body: &str) -> String {
    envelope(body)["msg"].as_str().unwrap_or_default().to_string()
}

fn cache_status(headers: &HeaderMap) -> String {
    headers
        .get("x-cache-status")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("<none>")
        .to_string()
}

/// A probe path nothing else in this file touches, so one test cannot see another's entries.
fn probe_path(label: &str) -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static SEQ: AtomicU64 = AtomicU64::new(0);
    let seq = SEQ.fetch_add(1, Ordering::Relaxed);
    // /api/theme/test is a real cacheable route: 200, no Cache-Control of its own, so it takes the
    // default TTL and enters the process cache. A 404 would never be cached, and /livez is no-store.
    format!("/api/theme/test?probe={label}-{seq}")
}

/// Reads the cache marker twice: the first answer is the entry being written, the second is the
/// cache proving it still holds one.
fn markers(uri: &str) -> (String, String) {
    let (_, first, _) = call("GET", uri, None);
    let (_, second, _) = call("GET", uri, None);
    (cache_status(&first), cache_status(&second))
}

/// Seeds the cache and asserts it is warm, so a later "still HIT" cannot be mistaken for "never
/// cached in the first place".
fn warm(uri: &str) {
    assert_eq!(
        markers(uri),
        ("MISS".to_string(), "HIT".to_string()),
        "the witness route did not enter the cache, so the test below would prove nothing"
    );
}

#[test]
fn an_unconfigured_endpoint_refuses_and_says_which_variable_is_missing() {
    let _guard = guard();
    // Default-deny: a deployment that forgot the variable gets a closed door, not an open one.
    set_token(None);
    let uri = probe_path("unconfigured");
    warm(&uri);

    let (status, headers, body) = call("DELETE", "/api/cache/clear?all=true", None);
    assert_eq!(status, StatusCode::FORBIDDEN, "body: {body}");
    let msg = message(&body);
    assert!(
        msg.contains("CACHE_CLEAR_TOKEN"),
        "the refusal has to name the variable that would open the door, got: {msg}"
    );
    assert_eq!(
        headers.get("cache-control").and_then(|v| v.to_str().ok()),
        Some("no-store"),
        "a refusal that a shared cache keeps would outlive the setting that produced it"
    );

    // The damage check. A handler that clears and then refuses passes every assertion above.
    assert_eq!(
        markers(&uri),
        ("HIT".to_string(), "HIT".to_string()),
        "the refused request cleared the cache anyway"
    );
}

#[test]
fn a_missing_credential_is_unauthorized_but_leaves_the_cache_alone() {
    let _guard = guard();
    set_token(Some("s3cret-token"));
    let uri = probe_path("missing");
    warm(&uri);

    let (status, headers, body) = call("DELETE", "/api/cache/clear?all=true", None);
    assert_eq!(status, StatusCode::UNAUTHORIZED, "body: {body}");
    assert_eq!(
        headers.get("www-authenticate").and_then(|v| v.to_str().ok()),
        Some("Bearer"),
        "RFC 9110 requires a 401 to name the scheme the client should present"
    );
    assert_eq!(
        headers.get("cache-control").and_then(|v| v.to_str().ok()),
        Some("no-store")
    );

    assert_eq!(
        markers(&uri),
        ("HIT".to_string(), "HIT".to_string()),
        "the rejected request cleared the cache anyway"
    );
    set_token(None);
}

#[test]
fn a_wrong_credential_is_unauthorized_but_leaves_the_cache_alone() {
    let _guard = guard();
    set_token(Some("s3cret-token"));
    let uri = probe_path("wrong");
    warm(&uri);

    let (status, _, body) = call("DELETE", "/api/cache/clear?all=true", Some("Bearer not-the-token"));
    assert_eq!(status, StatusCode::UNAUTHORIZED, "body: {body}");
    assert_eq!(
        markers(&uri),
        ("HIT".to_string(), "HIT".to_string()),
        "a wrong guess cleared the cache anyway"
    );
    set_token(None);
}

#[test]
fn a_credential_with_the_wrong_scheme_is_unauthorized() {
    let _guard = guard();
    set_token(Some("s3cret-token"));
    let uri = probe_path("scheme");
    warm(&uri);

    // The token is right; only the scheme is wrong. Accepting it would mean the check reads
    // "some word, then the secret" rather than "a bearer credential", and Basic would work.
    let (status, _, body) = call("DELETE", "/api/cache/clear?all=true", Some("Basic s3cret-token"));
    assert_eq!(status, StatusCode::UNAUTHORIZED, "body: {body}");
    assert_eq!(
        markers(&uri),
        ("HIT".to_string(), "HIT".to_string()),
        "a wrong scheme cleared the cache anyway"
    );
    set_token(None);
}

#[test]
fn a_blank_configured_token_is_unset_rather_than_an_empty_password() {
    let _guard = guard();
    // Platforms routinely define a variable with an empty value. Reading that as "the expected
    // token is the empty string" would accept a bearer credential with nothing after it.
    set_token(Some("   "));
    let uri = probe_path("blank");
    warm(&uri);

    let (status, _, body) = call("DELETE", "/api/cache/clear?all=true", None);
    assert_eq!(status, StatusCode::FORBIDDEN, "body: {body}");

    let (status, _, body) = call("DELETE", "/api/cache/clear?all=true", Some("Bearer "));
    assert_eq!(
        status,
        StatusCode::FORBIDDEN,
        "a blank setting must stay closed, got: {body}"
    );
    assert_eq!(markers(&uri), ("HIT".to_string(), "HIT".to_string()));
    set_token(None);
}

#[test]
fn the_right_credential_clears_the_cache() {
    let _guard = guard();
    set_token(Some("s3cret-token"));
    let uri = probe_path("granted");
    warm(&uri);

    let (status, _, body) = call(
        "DELETE",
        "/api/cache/clear?all=true",
        Some("Bearer s3cret-token"),
    );
    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert_eq!(message(&body), "Cleared all cache");
    assert_eq!(envelope(&body)["data"]["deletedCount"], "all");

    // The positive control for every assertion above: a cleared cache answers MISS again, so
    // "still HIT" in the refusal tests is really evidence the entry survived.
    assert_eq!(
        markers(&uri),
        ("MISS".to_string(), "HIT".to_string()),
        "the granted request did not actually clear anything"
    );
    set_token(None);
}

#[test]
fn an_authorised_clear_still_runs_the_selector_logic() {
    let _guard = guard();
    set_token(Some("s3cret-token"));
    // Two independent witnesses. If the gate short-circuited to a cheerful 200, both would still
    // answer HIT and the status code alone would never tell.
    let doomed = probe_path("selector-doomed");
    let kept = probe_path("selector-kept");
    warm(&doomed);
    warm(&kept);

    // The pattern is taken from the key the cache itself reported, so this test does not hardcode
    // the key format: whatever the cache calls its entries, this asks it to drop exactly one.
    let (_, headers, _) = call("GET", &doomed, None);
    let key = headers
        .get("x-cache-key")
        .and_then(|value| value.to_str().ok())
        .expect("a warm entry reports its key")
        .to_string();
    let url = format!("/api/cache/clear?pattern={key}*");
    let (status, _, body) = call("DELETE", &url, Some("Bearer s3cret-token"));
    assert_eq!(status, StatusCode::OK, "body: {body}");
    assert_eq!(message(&body), format!("Cleared cache by pattern: {key}*"));

    // Exactly one entry went. A handler that ignored the selector and cleared everything would
    // take the kept entry too, which is the damage an unauthenticated caller used to be able to do.
    assert_eq!(
        markers(&doomed).0,
        "MISS",
        "the authorised clear missed the entry it named"
    );
    assert_eq!(
        markers(&kept),
        ("HIT".to_string(), "HIT".to_string()),
        "the authorised clear went past the selector and emptied the cache"
    );
    set_token(None);
}

#[test]
fn a_prefix_of_the_token_is_not_the_token() {
    let _guard = guard();
    set_token(Some("s3cret-token"));
    let uri = probe_path("prefix");
    warm(&uri);

    // Both directions matter, and they fail for different reasons.
    //
    // A short guess is caught by the loop itself: it reads 0 past the end of the guess, so the
    // bytes the guess is missing never match. A long guess slips through unless the length
    // difference is folded into the accumulator -- the loop only ever walks the expected value, so
    // it never looks at the extra bytes and "s3cret-tokenEXTRA" compares equal to "s3cret-token".
    // That is the regression a hand-written constant-time comparison invites, and only the long
    // direction catches it.
    for guess in ["s3cret", "s3cret-tokenEXTRA", "s3cret-token-"] {
        let (status, _, body) = call(
            "DELETE",
            "/api/cache/clear?all=true",
            Some(&format!("Bearer {guess}")),
        );
        assert_eq!(
            status,
            StatusCode::UNAUTHORIZED,
            "{guess:?} must not authenticate, got: {body}"
        );
        assert_eq!(
            markers(&uri),
            ("HIT".to_string(), "HIT".to_string()),
            "{guess:?} cleared the cache"
        );
    }
    set_token(None);
}

#[test]
fn the_refusal_answers_the_json_envelope_the_rest_of_the_api_uses() {
    let _guard = guard();
    set_token(None);
    let (_, headers, body) = call("DELETE", "/api/cache/clear?all=true", None);
    assert_eq!(
        headers.get("content-type").and_then(|v| v.to_str().ok()),
        Some("application/json; charset=utf-8")
    );
    let envelope = envelope(&body);
    assert_eq!(envelope["code"], 403, "the code mirrors the status: {body}");
    assert!(envelope["msg"].is_string());
    assert!(envelope["data"].is_null(), "a refusal carries no data: {body}");
}
