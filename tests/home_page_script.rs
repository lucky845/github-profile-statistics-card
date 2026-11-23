//! The home page's copy buttons, its stylesheet, and the CSP that governs both.
//!
//! The page used to carry the click handler as an inline `<script>` and its rules in an inline
//! `<style>`. The CSP allowed the script not at all (`script-src 'self'`, no hash, no nonce) and
//! the style through a blanket `'unsafe-inline'`. The browser refused the script (buttons dead,
//! console error on every load) while accepting every inline style an injected card might bring.
//! Both are now files under the same origin, `/app.js` and `/app.css`, and the policy is strict for
//! both.
//!
//! The assertions come in pairs because either half alone can regress silently: the page must name
//! no inline resource, every resource it names must actually be served with an executable/applicable
//! content type, and both `script-src` and `style-src` must stay free of `'unsafe-inline'`.

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

/// Every `<link ...>` opening tag in the page, with its attributes.
fn link_tags(html: &str) -> Vec<&str> {
    html.match_indices("<link")
        .map(|(at, _)| {
            let rest = &html[at..];
            let end = rest.find('>').expect("an unterminated link tag");
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
fn the_page_carries_no_inline_style() {
    let html = home();
    assert!(
        !html.contains("<style"),
        "an inline <style> would need style-src 'unsafe-inline' to be re-opened"
    );
    assert!(
        !html.contains("style="),
        "an inline style= attribute is also gated by style-src-attr / style-src"
    );
    assert!(
        !link_tags(&html).is_empty(),
        "the page is expected to link its stylesheet; if the rules were dropped, delete this test \
         rather than the assertion"
    );
}

#[test]
fn every_stylesheet_the_page_names_is_served_here() {
    let html = home();
    let sheets: Vec<&str> = link_tags(&html)
        .iter()
        .filter(|tag| tag.contains("stylesheet"))
        .filter_map(|tag| {
            let at = tag.find("href=\"")? + "href=\"".len();
            tag[at..].split('"').next()
        })
        .collect();
    assert!(!sheets.is_empty(), "the page links no stylesheet at all");
    for sheet in sheets {
        assert!(sheet.starts_with('/'), "not same-origin: {sheet}");
        let (status, headers, body) = get(sheet);
        assert_eq!(status, StatusCode::OK, "{sheet} is referenced but not served");
        assert!(!body.is_empty(), "{sheet} is served empty");
        let content_type = headers
            .get(axum::http::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .unwrap_or_default();
        assert!(
            content_type.starts_with("text/css"),
            "{sheet} is served as {content_type:?}; a browser refuses to apply a stylesheet with \
             the wrong MIME type under strict CSS loading"
        );
    }
}

#[test]
fn the_rules_the_page_lost_are_the_rules_the_file_carries() {
    // Not a byte-for-byte copy of the old inline block -- that would pin whitespace. These are the
    // three rule families the rendered page actually relies on: the copy buttons, the theme pills,
    // and the responsive gallery grid. If any is lost in the extraction the page still loads with a
    // 200 for /app.css, but the layout silently changes.
    let (status, _, body) = get("/app.css");
    assert_eq!(status, StatusCode::OK);
    let css = String::from_utf8(body).expect("utf-8 css");
    for rule in ["button.copy-btn", "theme-pill", "gallery-grid", "@media"] {
        assert!(css.contains(rule), "the stylesheet lost its {rule:?} rules");
    }
    assert!(
        css.contains(":root") && css.contains("--accent"),
        "the stylesheet lost its theme variables"
    );
}

#[test]
fn the_stylesheet_route_follows_the_same_path_rules_as_the_other_fixed_routes() {
    let (_, _, expected) = get("/app.css");
    for spelling in ["/APP.CSS", "/App.Css", "/app.css/"] {
        let (status, _, body) = get(spelling);
        assert_eq!(status, StatusCode::OK, "{spelling} did not reach the handler");
        assert_eq!(body, expected, "{spelling} answered with a different body");
    }
}

#[test]
fn the_stylesheet_is_cached_like_the_static_file_it_is() {
    let uri = format!("/app.css?v={}", std::process::id());
    let (_, _, first) = get(&uri);
    let (status, headers, second) = get(&uri);
    assert_eq!(status, StatusCode::OK);
    assert_eq!(first, second);
    let cache_status = headers
        .get("x-cache-status")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    assert_eq!(cache_status, "HIT", "the stylesheet is re-rendered on every request");
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
    // The stylesheet moved out for exactly the same reason: leaving 'unsafe-inline' here would let
    // any injected inline style through. Deleting this assertion should be a deliberate decision to
    // accept that exposure, not a side effect of moving the CSS.
    let style_directive = csp
        .split(';')
        .map(str::trim)
        .find(|part| part.starts_with("style-src "))
        .expect("no style-src directive");
    assert!(style_directive.contains("'self'"), "{style_directive}");
    assert!(
        !style_directive.contains("unsafe-inline"),
        "{style_directive}"
    );
}
