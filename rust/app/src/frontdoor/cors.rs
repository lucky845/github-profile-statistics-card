//! The two things `cors` does to every request, split into the two places they have to run.
//!
//! `cors` answers an `OPTIONS` before any other middleware sees it, and on everything else it
//! stamps `Access-Control-Allow-Origin` onto a response object the later middlewares still share.
//! Express gets both from one function because it mutates `res`; here they are two layers, and the
//! split is load-bearing:
//!
//! * `preflight` runs outside the cache and the metrics counters, because a preflight must neither
//!   be served from cache nor counted as an API request.
//! * `headers` runs inside them, so the allowance is stamped before the cache middleware decides
//!   what to store — `access-control-allow-origin` is one of the five headers it keeps.

use axum::extract::Request;
use axum::http::{HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

use super::headers::SECURITY;

/// `cors({ methods: ['GET','OPTIONS'] })`.
pub const ALLOW_METHODS: &str = "GET,OPTIONS";

/// `cors({ allowedHeaders: ['Content-Type','Authorization'] })`.
pub const ALLOW_HEADERS: &str = "Content-Type,Authorization";

/// `cors({ maxAge: 86400 })`: a browser may reuse the preflight for a day.
pub const MAX_AGE: &str = "86400";

fn origin(req: &Request) -> Option<HeaderValue> {
    req.headers().get(header::ORIGIN).cloned()
}

/// The answer to `OPTIONS`: 204, the security headers, and the allowance.
///
/// `cors` short-circuits every `OPTIONS` request, whether or not it carries
/// `Access-Control-Request-Method`, so an unadorned `OPTIONS` gets the same reply as a real
/// preflight. Without an `Origin` there is nothing to echo and the allowance is omitted, which is
/// what the original does too.
fn preflight_reply(origin: Option<HeaderValue>) -> Response {
    let mut response = StatusCode::NO_CONTENT.into_response();
    let head = response.headers_mut();
    for (name, value) in SECURITY {
        if let Ok(header_name) = name.parse::<axum::http::HeaderName>() {
            head.insert(header_name, HeaderValue::from_static(value));
        }
    }
    if let Some(origin) = origin {
        head.insert(
            "access-control-allow-origin",
            HeaderValue::from_maybe_shared(origin).unwrap_or(HeaderValue::from_static("*")),
        );
    }
    head.insert(
        "access-control-allow-methods",
        HeaderValue::from_static(ALLOW_METHODS),
    );
    head.insert(
        "access-control-allow-headers",
        HeaderValue::from_static(ALLOW_HEADERS),
    );
    head.insert("access-control-max-age", HeaderValue::from_static(MAX_AGE));
    response
}

/// Outermost: answer `OPTIONS`, and take `Allow` off everything else.
///
/// This has to be mounted *outside* the routed service, not as a `Router::layer`: axum's route
/// future inserts `Allow` after the handler returns, so a layer inside the router can set or clear
/// headers only for them to be overwritten a moment later. Express never sends `Allow` at all — it
/// answers a wrong method from notFoundHandler, with no method table involved.
pub async fn preflight(req: Request, next: Next) -> Response {
    let origin = origin(&req);
    if req.method() == axum::http::Method::OPTIONS {
        return preflight_reply(origin);
    }
    let mut response = next.run(req).await;
    response.headers_mut().remove(header::ALLOW);
    response
}

/// Innermost: echo the request's origin, so a browser preflight and the real request agree.
///
/// `origin: (origin, cb) => cb(null, true)` allows everyone, and with `credentials: false` the
/// allowed origin is the request's own origin rather than `*`.
pub async fn headers(req: Request, next: Next) -> Response {
    let origin = origin(&req);
    let mut response = next.run(req).await;
    if let Some(origin) = origin
        && let Ok(value) = HeaderValue::from_maybe_shared(origin)
    {
        response
            .headers_mut()
            .insert("access-control-allow-origin", value);
    }
    response
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Body;
    use axum::http::Request as HttpRequest;

    fn request(method: &str, headers: &[(&str, &str)]) -> Request {
        let mut request = HttpRequest::builder()
            .method(method)
            .uri("/github/octocat")
            .body(Body::empty())
            .expect("a request");
        for (name, value) in headers {
            let name = axum::http::HeaderName::try_from(*name).expect("a header name");
            request
                .headers_mut()
                .insert(name, HeaderValue::from_str(value).expect("a header value"));
        }
        request
    }

    #[tokio::test]
    async fn a_preflight_is_204_with_the_allowance_and_no_body() {
        let response = preflight_reply(Some(HeaderValue::from_static("https://a.test")));
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert_eq!(
            response.headers().get("access-control-allow-origin").unwrap(),
            "https://a.test"
        );
        assert_eq!(
            response.headers().get("access-control-allow-methods").unwrap(),
            "GET,OPTIONS"
        );
        assert_eq!(
            response.headers().get("access-control-allow-headers").unwrap(),
            "Content-Type,Authorization"
        );
        // helmet runs first, so even the preflight carries the security headers.
        assert_eq!(
            response.headers().get("x-frame-options").unwrap(),
            "DENY"
        );
    }

    #[tokio::test]
    async fn a_preflight_without_an_origin_echoes_nothing() {
        let response = preflight_reply(None);
        assert!(response.headers().get("access-control-allow-origin").is_none());
        // The rest of the allowance is still there; only the echo depends on the request.
        assert_eq!(
            response.headers().get("access-control-max-age").unwrap(),
            "86400"
        );
    }

    /// The layers as the server mounts them: `preflight` outside, `headers` inside, over a route
    /// that always answers 200. Driving the real stack is what proves the split works, because
    /// `Next` cannot be constructed by hand outside the middleware machinery.
    fn stack() -> axum::Router {
        axum::Router::new()
            .route("/github/octocat", axum::routing::get(|| async { StatusCode::OK }))
            .layer(axum::middleware::from_fn(headers))
            .layer(axum::middleware::from_fn(preflight))
    }

    /// A path the router really registers answers OPTIONS through the same layer; axum would
    /// otherwise add `Allow: GET,HEAD` to a method it cannot serve, and the original sends no such
    /// header because cors short-circuits the request before Express consults a route table.
    #[tokio::test]
    async fn a_registered_route_answers_options_without_an_allow_header() {
        use tower::ServiceExt;

        let routes = axum::Router::new().route("/health", axum::routing::get(|| async { StatusCode::OK }));
        let router = axum::Router::new()
            .fallback_service(routes)
            .layer(axum::middleware::from_fn(preflight));

        let response = router
            .oneshot(
                HttpRequest::builder()
                    .method("OPTIONS")
                    .uri("/health")
                    .body(Body::empty())
                    .expect("a request"),
            )
            .await
            .expect("a response");
        assert_eq!(response.status(), StatusCode::NO_CONTENT);
        assert!(response.headers().get("allow").is_none());
    }

    #[tokio::test]
    async fn the_preflight_layer_claims_options_and_passes_everything_else_through() {
        use tower::ServiceExt;

        let claimed = stack()
            .oneshot(request("OPTIONS", &[("origin", "https://a.test")]))
            .await
            .expect("a response");
        assert_eq!(claimed.status(), StatusCode::NO_CONTENT);

        let passed = stack()
            .oneshot(request("GET", &[("origin", "https://a.test")]))
            .await
            .expect("a response");
        assert_eq!(passed.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn the_header_layer_echoes_the_origin_onto_the_answer() {
        use tower::ServiceExt;

        let response = stack()
            .oneshot(request("GET", &[("origin", "https://a.test")]))
            .await
            .expect("a response");
        assert_eq!(
            response.headers().get("access-control-allow-origin").unwrap(),
            "https://a.test"
        );

        let bare = stack()
            .oneshot(request("GET", &[]))
            .await
            .expect("a response");
        assert!(bare.headers().get("access-control-allow-origin").is_none());
    }
}