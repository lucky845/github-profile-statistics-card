//! Express's route matching, reproduced.
//!
//! The original registers every route with `app.get`/`app.use`, which are case-insensitive and
//! tolerate a single trailing slash. Its platform routers are mounted with `app.use('/github', ...)`
//! and the mount trims itself off the front of the URL — one slash included — which is why
//! `/github//octocat` reaches `/:param` while `/github///octocat` does not.
//!
//! Rewriting the path here, in a layer outside the router, is what lets axum (which matches exactly)
//! answer the same requests. The handlers still see the path the client sent, because the original
//! echoes it back in the 404 body.

use axum::extract::Request;
use axum::http::Uri;
use axum::http::uri::PathAndQuery;
use axum::middleware::Next;
use axum::response::Response;

/// The paths app.ts registers with `app.get` or `app.delete`.
const FIXED: [&str; 10] = [
    "/",
    // Served rather than inlined because the CSP forbids inline script; see handlers::app_js.
    "/app.js",
    "/health",
    "/livez",
    "/api/theme/test",
    "/api/cache/stats",
    "/api/cache/clear",
    "/metrics",
    "/metrics/json",
    "/stats",
];

/// The path the client sent, kept because the 404 body quotes it verbatim.
#[derive(Clone, Debug)]
pub struct OriginalPath(pub String);

/// The route a fixed path lands on, matched the way `/^\/health\/?$/i` matches: case-insensitively,
/// with one optional trailing slash and nothing else.
fn fixed(path: &str) -> Option<&'static str> {
    FIXED.iter().copied().find(|route| {
        if *route == "/" {
            // /^\/?$/ never matches "//": the optional slash is the whole pattern.
            return path == "/";
        }
        path.eq_ignore_ascii_case(route)
            || path
                .strip_suffix('/')
                .is_some_and(|trimmed| trimmed.eq_ignore_ascii_case(route))
    })
}

/// Where `app.use('/name', router)` stops matching, for `/^\/name\/?(?=\/|$)/i`.
///
/// The optional slash is greedy, so it is taken whenever the lookahead still passes: that is what
/// makes `/github//octocat` arrive at the child router as `/octocat` rather than `//octocat`.
fn mount(path: &str, name: &str) -> Option<usize> {
    let head = path.get(..1 + name.len())?;
    if !head.get(1..)?.eq_ignore_ascii_case(name) {
        return None;
    }
    let len = 1 + name.len();
    match path.as_bytes().get(len) {
        None => Some(len),
        Some(b'/') => match path.as_bytes().get(len + 1) {
            None | Some(b'/') => Some(len + 1),
            _ => Some(len),
        },
        _ => None,
    }
}

/// The id `/:param` captures, for `/^(?:\/([^/]+?))\/?$/i` applied to the trimmed URL.
fn param(rest: &str) -> Option<&str> {
    let inner = rest.strip_prefix('/')?;
    let id = inner.strip_suffix('/').unwrap_or(inner);
    if id.is_empty() || id.contains('/') {
        return None;
    }
    Some(id)
}

/// The canonical path the router should match, or None when no route claims the request.
pub fn canonical(path: &str) -> Option<String> {
    if let Some(route) = fixed(path) {
        return Some(route.to_string());
    }
    for desc in super::registry::all() {
        let name = desc.name;
        let Some(mount_len) = mount(path, name) else {
            continue;
        };
        let Some(id) = param(&path[mount_len..]) else {
            continue;
        };
        // The id keeps the case it arrived in: it is the cache key's middle segment.
        return Some(format!("/{name}/{id}"));
    }
    None
}

/// Rewrites the path to its canonical form before axum matches on it.
pub async fn middleware(mut req: Request, next: Next) -> Response {
    let original = req.uri().path().to_string();
    if let Some(route) = canonical(&original) {
        let target = match req.uri().query() {
            Some(query) => format!("{route}?{query}"),
            None => route,
        };
        if let Ok(target) = PathAndQuery::try_from(target) {
            let mut parts = req.uri().clone().into_parts();
            parts.path_and_query = Some(target);
            if let Ok(uri) = Uri::from_parts(parts) {
                *req.uri_mut() = uri;
            }
        }
    }
    req.extensions_mut().insert(OriginalPath(original));
    next.run(req).await
}

/// The path the client sent, read back by the handlers that quote it.
pub fn original(req: &Request) -> String {
    req.extensions()
        .get::<OriginalPath>()
        .map(|path| path.0.clone())
        .unwrap_or_else(|| req.uri().path().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_fixed_route_ignores_case_and_one_trailing_slash() {
        assert_eq!(canonical("/health").as_deref(), Some("/health"));
        assert_eq!(canonical("/Health").as_deref(), Some("/health"));
        assert_eq!(canonical("/health/").as_deref(), Some("/health"));
        assert_eq!(canonical("/API/CACHE/STATS").as_deref(), Some("/api/cache/stats"));
        assert_eq!(canonical("/Stats/").as_deref(), Some("/stats"));
        assert_eq!(canonical("/metrics/JSON").as_deref(), Some("/metrics/json"));
    }

    #[test]
    fn the_root_route_is_the_slash_alone() {
        assert_eq!(canonical("/").as_deref(), Some("/"));
        assert_eq!(canonical("//"), None);
        assert_eq!(canonical("/health//"), None);
    }

    #[test]
    fn a_mounted_router_trims_one_slash_and_then_matches_its_parameter() {
        assert_eq!(canonical("/github/octocat").as_deref(), Some("/github/octocat"));
        assert_eq!(canonical("/github//octocat").as_deref(), Some("/github/octocat"));
        assert_eq!(canonical("/github/octocat/").as_deref(), Some("/github/octocat"));
        assert_eq!(canonical("/GitHub/OctoCat").as_deref(), Some("/github/OctoCat"));
        // Only one slash is absorbed, and only before the parameter.
        assert_eq!(canonical("/github///octocat"), None);
        assert_eq!(canonical("/github/octocat//"), None);
        assert_eq!(canonical("/github/a/b"), None);
    }

    #[test]
    fn a_mount_without_a_parameter_is_not_a_route() {
        assert_eq!(canonical("/github"), None);
        assert_eq!(canonical("/github/"), None);
        assert_eq!(canonical("/github//"), None);
        assert_eq!(canonical("/githubx/octocat"), None);
    }

    #[test]
    fn every_platform_answers_the_same_way() {
        for desc in crate::frontdoor::registry::all() {
            let name = desc.name;
            let path = format!("/{name}/someone");
            assert_eq!(canonical(&path), Some(path.clone()));
            assert_eq!(canonical(&format!("/{name}//someone")), Some(path.clone()));
            assert_eq!(canonical(&format!("/{name}/someone/")), Some(path.clone()));
            // The mount is matched case-insensitively; the id keeps the case it arrived in.
            assert_eq!(
                canonical(&format!("/{}/SOMEONE", name.to_uppercase())),
                Some(format!("/{name}/SOMEONE"))
            );
        }
    }
}
