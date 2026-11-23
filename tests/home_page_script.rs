//! The home page's copy buttons, and the script that wires them.
//!
//! The page used to carry the handler as an inline `<script>`. Every answer is served under
//! `script-src 'self'` with no hash and no nonce, so the browser refused to run it: the buttons did
//! nothing and the only symptom was a console error on load. The fix moves the code to `/app.js`,
//! which the same policy allows.
//!
//! Both halves of that fix are asserted here, because either one alone can regress silently:
//!
//! - the page must contain no inline script (a new inline block would be blocked just as the old
//!   one was), and
//! - every script the page names must actually be served by this router (a page pointing at a 404
//!   looks exactly like a page pointing at working code until someone clicks).

use axum::body::Body;
use axum::http::{HeaderMap, Request, StatusCode};
use tower::ServiceExt;

fn blocked_on<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("test runtime")
        .block_on(future)
}

fn get(uri: &str) -> (StatusCode, HeaderMap, Vec<u8>) {
    let request = Request::builder()
        .method("GET")
        .uri(uri)
        .header(axum::http::header::HOST, "localhost")
        .body(Body::empty())
        .expect("a request");
    let response = blocked_on(app::router().oneshot(request)).expect("a response");
    let status = response.status();
    // Read the headers before the body takes the response apart.
    let headers = response.headers().clone();
    let body = blocked_on(axum::body::to_bytes(response.into_body(), usize::MAX))
        .expect("a body")
        .to_vec();
    (status, headers, body)
}

fn home() -> String {
    let (status, _, body) = get("/");
    assert_eq!(status, StatusCode::OK);
    String::from_utf8(body).expect("utf-8 html")
}

/// Every `<script ...>` opening tag in the page, with its attributes.
fn script_tags(html: &str) -> Vec<&str> {
    html.match_indices("<script")
        .map(|(at, _)| {
            let rest = &html[at..];
            let end = rest.find('>').expect("an unterminated script tag");
            &rest[..end]
        })
        .collect()
}

#[test]
fn the_page_carries_no_inline_script() {
    let html = home();
    let tags = script_tags(&html);
    assert!(
        !tags.is_empty(),
        "the page is expected to load its copy-button script; if the buttons were dropped, delete \
         this test rather than the assertion"
    );
    for tag in tags {
        assert!(
            tag.contains("src="),
            "an inline script would be blocked by script-src 'self' and the buttons would do \
             nothing: {tag}"
        );
    }
}

#[test]
fn every_script_the_page_names_is_served_here() {
    let html = home();
    let sources: Vec<&str> = script_tags(&html)
        .iter()
        .filter_map(|tag| {
            let at = tag.find("src=\"")? + "src=\"".len();
            tag[at..].split('"').next()
        })
        .collect();
    assert!(!sources.is_empty(), "the page names no script at all");
    for source in sources {
        assert!(source.starts_with('/'), "not same-origin: {source}");
        let (status, headers, body) = get(source);
        assert_eq!(status, StatusCode::OK, "{source} is referenced but not served");
        assert!(!body.is_empty(), "{source} is served empty");
        let content_type = headers
            .get(axum::http::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        assert!(
            content_type.starts_with("text/javascript"),
            "{source} is served as {content_type:?}, which a browser refuses to execute under a \
             strict script-src"
        );
    }
}

#[test]
fn the_script_it_names_is_the_one_that_wires_the_buttons() {
    let (status, _, body) = get("/app.js");
    assert_eq!(status, StatusCode::OK);
    let script = String::from_utf8(body).expect("utf-8 script");
    // Not a shape assertion: these are the two things the page needs the script to do.
    assert!(script.contains("copy-btn"), "the handler never looks for the buttons");
    assert!(
        script.contains("navigator.clipboard"),
        "the handler never writes to the clipboard"
    );
}

#[test]
fn the_buttons_the_script_looks_for_are_the_buttons_the_page_renders() {
    // The handler is delegated: it looks for .copy-btn and then for the id in data-target. Both
    // halves of that contract live in the gallery renderer, so a rename there would leave a script
    // that runs, finds nothing, and reports no error -- the same silent failure as before, one
    // layer down.
    let html = home();
    assert!(
        html.contains("class=\"copy-btn\""),
        "the page renders no buttons for the script to wire"
    );
    let targets: Vec<&str> = html
        .match_indices("data-target=\"")
        .map(|(at, marker)| {
            let rest = &html[at + marker.len()..];
            rest.split('"').next().expect("an unterminated attribute")
        })
        .collect();
    assert!(!targets.is_empty(), "no button names a target");
    for target in targets {
        assert!(
            html.contains(&format!("id=\"{target}\"")),
            "a button points at {target:?}, which the page never renders"
        );
    }
}

#[test]
fn the_script_route_follows_the_same_path_rules_as_the_other_fixed_routes() {
    // Express matches case-insensitively and tolerates one trailing slash, and the rewrite layer in
    // src/frontdoor/paths.rs is what teaches axum that. A route registered in the router but missing
    // from paths::FIXED answers /app.js and 404s /APP.JS -- a difference no browser shows until a
    // deploy starts spelling the URL differently.
    let (_, _, expected) = get("/app.js");
    for spelling in ["/APP.JS", "/App.Js", "/app.js/"] {
        let (status, _, body) = get(spelling);
        assert_eq!(status, StatusCode::OK, "{spelling} did not reach the handler");
        assert_eq!(body, expected, "{spelling} answered with a different body");
    }
}

#[test]
fn the_script_is_cached_like_the_static_file_it_is() {
    // A query string keeps the key unique to this test: the cache is process-wide, so a bare
    // /app.js may already be stored by the tests above.
    let uri = format!("/app.js?v={}", std::process::id());
    let (_, _, first) = get(&uri);
    let (status, headers, second) = get(&uri);
    assert_eq!(status, StatusCode::OK);
    assert_eq!(first, second);
    let cache_status = headers
        .get("x-cache-status")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    assert_eq!(cache_status, "HIT", "the script is re-rendered on every request");
    let cache_control = headers
        .get(axum::http::header::CACHE_CONTROL)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    assert!(
        cache_control.contains("s-maxage"),
        "a shared cache has no TTL for the script: {cache_control:?}"
    );
}

#[test]
fn the_policy_that_forbade_the_inline_script_is_still_in_force() {
    // The page no longer needs an inline script, but the reason it could not have one is the
    // header. If someone relaxes script-src to 'unsafe-inline', that trade should be a deliberate
    // one with this test deleted -- not a side effect that quietly re-opens the hole.
    let (_, headers, _) = get("/");
    let csp = headers
        .get("content-security-policy")
        .and_then(|value| value.to_str().ok())
        .expect("the home page carries no CSP");
    let directive = csp
        .split(';')
        .map(str::trim)
        .find(|part| part.starts_with("script-src "))
        .expect("no script-src directive");
    assert!(directive.contains("'self'"), "{directive}");
    assert!(!directive.contains("unsafe-inline"), "{directive}");
    assert!(!directive.contains("unsafe-eval"), "{directive}");
}
