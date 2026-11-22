//! The routes Rust answers itself.
//!
//! Everything here needs no upstream: static markup, probes, the theme preview, validation
//! rejections, the 404 pages, the cache counters and the metrics exposition. Every route the app
//! mounts is answered here or by the platform modules beside it, which is why this module carries
//! no state: there used to be a Node process behind a reverse proxy for the unported paths, and
//! nothing is left for it to answer.

use std::time::{SystemTime, UNIX_EPOCH};

use axum::Router;
use axum::extract::Request;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde_json::Value;

use super::headers::Reply;
use super::keys;

/// The theme names the original exposes, in the order it declares them.
pub const THEMES: [&str; 4] = ["light", "dark", "github-dark-dimmed", "transparent"];

/// The default theme, DEFAULT_THEME_NAME in the original.
pub const DEFAULT_THEME: &str = "light";

/// The cache policy every successful card carries.
pub const CARD_CACHE: &str = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

/// The cache policy the home page carries.
pub const HOME_CACHE: &str = "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400";

/// The home page template. Production used to read it out of dist/, which meant the binary could
/// not serve the page without a Node build next to it; the file is static, so it ships inside.
const INDEX_HTML: &str = include_str!("../../views/index.html");

pub fn router() -> Router {
    Router::new()
        .route("/", axum::routing::get(home))
        .route("/health", axum::routing::get(health))
        .route("/livez", axum::routing::get(livez))
        .route("/api/theme/test", axum::routing::get(theme_test))
        .route("/api/cache/stats", axum::routing::get(cache_stats))
        .route("/api/cache/clear", axum::routing::delete(cache_clear))
        .route("/metrics", axum::routing::get(super::metrics::text_endpoint))
        .route(
            "/metrics/json",
            axum::routing::get(super::metrics::json_endpoint),
        )
        .route("/stats", axum::routing::get(super::metrics::stats_endpoint))
        // A matched path with the wrong method is not a 405 in the original: Express simply has no
        // handler for it, so it lands in notFoundHandler. The fallback keeps that answer.
        .method_not_allowed_fallback(method_not_allowed)
}

/// Everything the routes above did not claim: the platform cards, and the 404 for the rest.
pub async fn dispatch(req: Request) -> Response {
    // The path the client sent, and the path the router was given: the rewrite layer turned
    // "/GitHub//OctoCat" into "/github/OctoCat" so a route would match it, but the 404 body quotes
    // the request and the cache keyed on it, so both of those read the original.
    let asked = super::paths::original(&req);
    let path = req.uri().path().to_string();
    // Kept alongside the parsed pairs: the theme and nocache readings below need the tree before
    // it collapses to key=value, because two of the original's readers disagree about a container.
    let raw_query = req.uri().query().map(str::to_string);
    let query = parse_query(raw_query.as_deref());

    // Express matches on path and method together. A platform route is registered for GET only,
    // so `POST /github/octocat` never reaches the card handler — it reaches notFoundHandler, which
    // still answers with an SVG because the path looks like a card. Serving the card for any method
    // would be a different server from the one the cases recorded.
    if !matches!(req.method().as_str(), "GET" | "HEAD") {
        return not_found(&asked, &query, false);
    }

    // A platform router owns one path segment. Anything with an id reaches its validators; a
    // missing id never matches the /:param pattern, so it lands in the 404 handler below.
    if let Some(desc) = super::registry::platform_of(&path) {
        // "/github" alone matches the mount but carries no parameter, so there is no rest to read.
        // Slicing it would index past the end of the string. What follows is what the mount left
        // behind, still led by the slash the mount did not eat.
        let rest = &path[desc.name.len() + 1..];
        let id = rest.strip_prefix('/').unwrap_or(rest);
        // The child router only registers /:param, so anything deeper than one segment never
        // matches a route there and lands in its 404 handler.
        if !id.is_empty() && !id.contains('/') {
            let decoded = keys::decode(id);
            // The theme reaches three different readers in the original and they do not agree:
            // the platform cache key stringifies it, juejin and bilibili run firstString over it,
            // and validateTheme calls .replace on it. Ask the query tree once for all three.
            let theme = super::query::folded(raw_query.as_deref(), "theme");
            let theme_text = theme.as_ref().map_or("", |t| t.text.as_str());
            let theme_first = theme.as_ref().map_or("", |t| t.first.as_str());
            // skipCache is the first thing the platform middleware checks, so a nocache=true
            // request never gets a platform key at all — the app-level key answers instead.
            // Only the three routers built by createCacheMiddleware carry that option; juejin and
            // bilibili hand-roll their middleware and have no skipCache. Which ones those are is
            // now a field on the descriptor rather than a list repeated here.
            let nocache = super::query::folded(raw_query.as_deref(), "nocache")
                .is_some_and(|flag| flag.text_valued && flag.text == "true");
            let skip_platform_key = nocache && desc.nocache_skips_platform_key;
            // When the id cannot be spelled in a latin-1 header the platform key is never set, so
            // the cache middleware's own key — built from the path as it arrived — is what answers.
            let platform_key = if skip_platform_key {
                None
            } else {
                super::registry::cache_key_for(desc, &decoded, theme_text, theme_first)
            };
            let key = platform_key.unwrap_or_else(|| keys::default_key("GET", &asked, &query));
            // A platform with no validator carries rejects: None, and its valid fn is never asked.
            let rejected = desc.rejects.filter(|_| !(desc.valid)(&decoded));
            if let Some(message) = rejected {
                // res.send('...') types a bare string as HTML.
                return Reply::new(
                    StatusCode::BAD_REQUEST,
                    "text/html; charset=utf-8",
                    message.to_string(),
                )
                .cache_key(key, "MISS")
                .into_response();
            }
            // validateTheme calls theme.replace(...) on whatever the query holds. A container is not
            // a string, so the call throws before the handler ever runs, and errorHandler turns the
            // TypeError into an SVG card. juejin's router has no validateTheme in its chain, which
            // is why it is the one platform a container theme cannot knock over.
            let theme_is_container = theme.as_ref().is_some_and(|theme| !theme.text_valued);
            if theme_is_container && desc.container_theme_fatal {
                let body = svg::port::generate_card(
                    Value::String("error".into()),
                    Value::String("theme.replace is not a function".into()),
                    Some("default".into()),
                )
                .unwrap_or_default();
                return Reply::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "image/svg+xml; charset=utf-8",
                    body,
                )
                .cache_key(key, "MISS")
                .into_response();
            }
            // A container never reaches a card: it is either a 500 above, or — for juejin, which
            // has no validators — a theme themeMiddleware already refused, so it reads as default.
            let card_theme = theme
                .as_ref()
                .filter(|theme| !theme.text.is_empty())
                .map(|theme| theme.text.as_str());
            // validateGenericUsername rewrites the route parameter with the sanitized name before
            // the handler runs, so the upstream fetch sees the clean id. Platforms without that
            // middleware carry sanitize: None and get the id as it arrived.
            let clean = desc
                .sanitize
                .map_or_else(|| decoded.clone(), |f| f(&decoded));
            // The route only validates the shape of a LeetCode name; the handler gets it untouched
            // and picks the region from ?cn=true. Every other platform ignores the flag.
            let use_cn = query.iter().any(|(k, v)| k == "cn" && v == "true");
            return (desc.card)(
                &clean,
                super::registry::CardCtx {
                    theme: card_theme,
                    use_cn,
                },
                key,
            )
            .await;
        }
    }

    not_found(&asked, &query, true)
}

/// The wrong-method answer: same notFoundHandler, reached through axum's fallback instead of the
/// path fallback. The original's 404 for a non-GET carries no cache markers, because its cache
/// middleware only runs for GET and HEAD.
async fn method_not_allowed(req: Request) -> Response {
    let path = super::paths::original(&req);
    let query = parse_query(req.uri().query());
    not_found(&path, &query, false)
}

/// notFoundHandler: any path that names a platform mount gets an SVG, everything else gets JSON.
///
/// The list is derived from `registry::PLATFORMS` rather than spelled out again. A second
/// hardcoded copy used to live here, and it drifted: juejin was added to the platform list but
/// never to this array, so `GET /juejin/` answered a JSON 404 where every other platform answered
/// a card. The defect survived the Node-to-Rust port because the original
/// (src/middleware/error.middleware.ts:168) had the same four-entry list. Deriving it here means
/// the next platform is covered by the one registration it already needs.
///
/// `cacheable` is false for anything the cache middleware would not have handled: it only runs for
/// GET and HEAD, so it never stamped X-Cache-Key on the others.
fn not_found(path: &str, query: &[(String, String)], cacheable: bool) -> Response {
    let key = keys::default_key("GET", path, query);
    // Same test as before — a mount appears anywhere in the path as a whole segment — but the
    // names come from the registry, so a new platform is covered without a second edit.
    let is_svg = super::registry::all()
        .iter()
        .any(|desc| path.contains(&format!("/{}/", desc.name)));
    if is_svg {
        // res.locals.themeName is never set, so the theme is always the literal "default".
        let body = svg::port::generate_card(
            Value::String("error".into()),
            Value::String("请求的资源不存在".into()),
            Some("default".into()),
        )
        .unwrap_or_default();
        let reply = Reply::new(StatusCode::NOT_FOUND, "image/svg+xml; charset=utf-8", body);
        return with_cache_key(reply, key, cacheable).into_response();
    }
    // The 404 is a failure envelope: the reason code and the path live under `data`, the sentence
    // moves up into `msg`. The HTTP status stays 404 -- curl -f and every probe that reads only the
    // status must keep seeing the failure.
    let body = super::r::R::fail(
        StatusCode::NOT_FOUND,
        "请求的路由不存在",
        serde_json::json!({
            "reason": "ROUTE_NOT_FOUND",
            "path": path,
            "timestamp": iso_now(),
        }),
    )
    .body();
    let reply = Reply::new(StatusCode::NOT_FOUND, super::r::JSON_CONTENT_TYPE, body);
    with_cache_key(reply, key, cacheable).into_response()
}

/// The cache markers are optional, so a 404 that never went through the cache middleware omits them.
fn with_cache_key(reply: Reply, key: String, cacheable: bool) -> Reply {
    if cacheable {
        reply.cache_key(key, "MISS")
    } else {
        reply
    }
}

/// What a platform card handler managed to get from its upstream.
pub enum CardOutcome {
    /// A profile worth rendering.
    Rendered(Value),
    /// The user exists but the platform has nothing to show. The original answers 200 so that
    /// GitHub's camo never caches a broken image into a README.
    UpstreamUnavailable,
    /// The platform positively said this user does not exist.
    NotFound,
    /// The upstream failed outright: registry.ts reports UPSTREAM_ERROR, which the original answers
    /// with 200 and the generic copy so a README never caches a broken image.
    UpstreamError,
}

/// The tail every platform card shares: pick the status, the cache policy and the copy from the
/// outcome, then render either the real card or the matching error card.
///
/// The original maps a failure through STATUS_BY_REASON and MESSAGE_BY_REASON: only NOT_FOUND
/// leaves 200, and only a 200 keeps a TTL. Error cards skip the SVG sanitizer, exactly as in
/// cardHandler.ts, because they are ours and carry no upstream text.
pub fn card_reply(
    card_type: &str,
    outcome: CardOutcome,
    theme: &str,
    key: String,
    success_cache_control: &'static str,
) -> Response {
    record_health(card_type, &outcome);
    let (status, cache_control, body) = match outcome {
        CardOutcome::Rendered(payload) => (
            StatusCode::OK,
            Some(success_cache_control),
            svg::port::generate_card(
                Value::String(card_type.to_string()),
                payload,
                Some(theme.to_string()),
            )
            .unwrap_or_default(),
        ),
        CardOutcome::UpstreamUnavailable => (
            StatusCode::OK,
            Some("public, max-age=60"),
            error_card("该平台暂无此用户的数据", theme),
        ),
        CardOutcome::NotFound => (
            StatusCode::NOT_FOUND,
            Some("no-store"),
            error_card("未找到该用户", theme),
        ),
        CardOutcome::UpstreamError => (
            StatusCode::OK,
            Some("public, max-age=60"),
            error_card("数据暂时不可用", theme),
        ),
    };
    let mut reply = Reply::new(status, "image/svg+xml; charset=utf-8", body).cache_key(key, "MISS");
    if let Some(cache_control) = cache_control {
        reply = reply.cache_control(cache_control);
    }
    reply.into_response()
}

/// Charge the outcome to its platform's health counters.
///
/// This is the Rust replacement for `registry.ts`'s decorator, which wrapped every
/// `PlatformStatsSource.fetch` and counted `ok`/`fail` around it. The port dropped that layer, so
/// `record_ok` / `record_fail` existed with tests but no caller and `/health` hardcoded an empty
/// `platforms` object — an operator asking "is CSDN quietly failing" got `{}`.
///
/// The choke point here is the shared tail rather than the fetch: every platform's outcome passes
/// through `card_reply` (or `github::failure`, which has its own tail for the same reasons the
/// original's GitHub adapter did). Counting here means a platform cannot be added without its
/// counters working.
fn record_health(card_type: &str, outcome: &CardOutcome) {
    match outcome {
        CardOutcome::Rendered(_) => record_platform_ok(card_type),
        CardOutcome::UpstreamUnavailable => record_platform_fail(card_type, "DATA_UNAVAILABLE"),
        CardOutcome::NotFound => record_platform_fail(card_type, "NOT_FOUND"),
        CardOutcome::UpstreamError => record_platform_fail(card_type, "UPSTREAM_ERROR"),
    }
}

/// One successful fetch, charged to its platform.
///
/// A failed counter write must not fail the request: the card is the product, the counters are
/// diagnostics. These only fail if the map's mutex was poisoned, which would make every later
/// call fail identically.
pub(super) fn record_platform_ok(card_type: &str) {
    let _ = platforms::port::record_ok(card_type.to_string());
}

/// One failed fetch, charged to its platform with the reason the original recorded.
///
/// `reason` is the same vocabulary `registry.ts` used (NOT_FOUND / DATA_UNAVAILABLE /
/// UPSTREAM_ERROR / RATE_LIMITED), because `/health`'s `lastError` is what an operator greps when
/// a card starts rendering the fallback copy.
pub(super) fn record_platform_fail(card_type: &str, reason: &str) {
    let _ = platforms::port::record_fail(card_type.to_string(), reason.to_string());
}

fn error_card(message: &str, theme: &str) -> String {
    svg::port::generate_card(
        Value::String("error".to_string()),
        Value::String(message.to_string()),
        Some(theme.to_string()),
    )
    .unwrap_or_default()
}

/// cacheStatsHandler: reports the counters the cache middleware has been feeding.
async fn cache_stats() -> Response {
    super::cache::stats_response()
}

/// manualCacheClearHandler: DELETE /api/cache/clear?all=true|group=..|pattern=..
async fn cache_clear(req: Request) -> Response {
    let query = parse_query(req.uri().query());
    let take = |name: &str| {
        query
            .iter()
            .find(|(key, _)| key == name)
            .map(|(_, value)| value.clone())
    };
    let all = take("all").as_deref() == Some("true");
    // The original destructures req.query and then tests `else if (group)`, so an empty string is
    // as absent as a missing key: `?group=` must fall through to the 400, not clear a group named
    // "". Filtering here is what keeps that distinction in one place.
    let selector = |name: &str| take(name).filter(|value| !value.is_empty());
    let group = selector("group");
    let pattern = selector("pattern");
    // Express answers res.json(), which is JSON typed as UTF-8.
    let (status, envelope) =
        super::cache::clear_response(all, group.as_deref(), pattern.as_deref()).await;
    // The cache middleware only touches GET/HEAD, so this response carries no X-Cache-* pair.
    envelope.reply(status).into_response()
}

async fn livez() -> Response {
    let body = super::r::R::ok(serde_json::json!({
        "status": "alive",
        "uptime": process_uptime(),
    }))
    .body();
    // No X-Cache-Key here: the middleware stamps one from the path the client sent, and a key
    // spelled from the canonical route instead would disagree on /livez/ and /LIVEZ.
    Reply::new(StatusCode::OK, "application/json; charset=utf-8", body).into_response()
}

/// The original reports database and platform health; the recording wildcards the body, so the
/// shape matters and the values do not.
async fn health() -> Response {
    // `database` keeps its shape for probes that parse it, and stays unhealthy because there is
    // no database. `cache` is the honest answer for the layer that replaced it: whether a shared
    // tier is configured, which decides if two instances see each other's entries.
    // `status` stays inside `data` on purpose: the envelope's `code` mirrors the HTTP status, which
    // is 200 because the process answered at all, while `data.status` is the upstream verdict.
    // Folding the two together would make a rate-limited upstream look like a dead process to
    // anything that parses the body.
    let body = super::r::R::ok(serde_json::json!({
        "status": "unhealthy",
        "uptime": process_uptime(),
        "database": {
            "status": "unhealthy",
            "pool": { "isConnected": false, "poolSize": 0 },
        },
        "cache": { "shared": super::remote::configured() },
        // The real counters, not an empty object. registry.ts used to decorate every source with
        // recordOk/recordFail and home.controller.ts reported snapshotHealth() here; the port kept
        // the counters and dropped the wiring, so this endpoint claimed no platform had ever been
        // called. It is the one place an operator can see a source failing silently.
        "platforms": platforms::port::snapshot_health().unwrap_or(Value::Null),
        "memory": {
            "rss": 0,
            "heapTotal": 0,
            "heapUsed": 0,
            "external": 0,
            "arrayBuffers": 0,
        },
    }))
    .body();
    // skipCache keeps /health out of the cache middleware, so it carries no X-Cache-* headers.
    Reply::new(StatusCode::OK, "application/json; charset=utf-8", body).into_response()
}

async fn theme_test(req: Request) -> Response {
    let query = parse_query(req.uri().query());
    let theme = query
        .iter()
        .find(|(k, _)| k == "theme")
        .map(|(_, v)| v.clone());
    let config = svg::port::get_theme_config(theme.clone()).unwrap_or(Value::Null);
    let pick = |path: &[&str]| -> String {
        let mut node = &config;
        for step in path {
            node = match node.get(step) {
                Some(next) => next,
                None => return String::new(),
            };
        }
        match node {
            Value::String(text) => text.clone(),
            other => other.to_string(),
        }
    };
    let name = theme.unwrap_or_else(|| "默认".to_string());
    let body = format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"400\" height=\"200\" viewBox=\"0 0 400 200\">
    <rect width=\"400\" height=\"200\" fill=\"{}\" rx=\"{}\" ry=\"{}\" stroke=\"{}\" stroke-width=\"2\"/>
    <circle cx=\"70\" cy=\"70\" r=\"40\" fill=\"{}\"/>
    <text x=\"230\" y=\"60\" font-family=\"{}\" font-size=\"{}\" font-weight=\"bold\" fill=\"{}\">测试用户</text>
    <text x=\"230\" y=\"90\" font-family=\"{}\" font-size=\"{}\" fill=\"{}\">这是主题测试卡片</text>
    <rect x=\"70\" y=\"120\" width=\"260\" height=\"1\" fill=\"{}\"/>
    <text x=\"130\" y=\"150\" font-family=\"{}\" font-size=\"{}\" fill=\"{}\">数据1: 123</text>
    <text x=\"250\" y=\"150\" font-family=\"{}\" font-size=\"{}\" fill=\"{}\">数据2: 456</text>
    <text x=\"200\" y=\"180\" font-family=\"{}\" font-size=\"{}\" text-anchor=\"middle\" fill=\"{}\">主题: {}</text>
  </svg>",
        pick(&["colors", "background"]),
        pick(&["card", "borderRadius"]),
        pick(&["card", "borderRadius"]),
        pick(&["colors", "border"]),
        pick(&["colors", "accent", "primary"]),
        pick(&["fonts", "family"]),
        pick(&["fonts", "size", "title"]),
        pick(&["colors", "text", "title"]),
        pick(&["fonts", "family"]),
        pick(&["fonts", "size", "normal"]),
        pick(&["colors", "text", "secondary"]),
        pick(&["colors", "border"]),
        pick(&["fonts", "family"]),
        pick(&["fonts", "size", "normal"]),
        pick(&["colors", "text", "primary"]),
        pick(&["fonts", "family"]),
        pick(&["fonts", "size", "normal"]),
        pick(&["colors", "text", "primary"]),
        pick(&["fonts", "family"]),
        pick(&["fonts", "size", "small"]),
        pick(&["colors", "text", "secondary"]),
        name
    );
    Reply::new(StatusCode::OK, "image/svg+xml; charset=utf-8", body).into_response()
}

/// The origin the gallery should embed in its example URLs.
///
/// The original used `${req.protocol}://${req.get('host')}`, and that is still the fallback. It
/// breaks on Vercel, and the breakage is easy to misread as "the server returns 302":
///
/// - Vercel answers on a per-deployment hostname
///   (`<project>-<hash>-<team>.vercel.app`), and that hostname sits behind SSO. A card URL built
///   from it redirects to `vercel.com/sso-api` — a 302 for every image on the page.
/// - The `Host` header carries that same per-deployment hostname, so trusting it produces the
///   unusable links. Vercel does not send `x-forwarded-host`, so there is nothing better to read
///   from the request.
///
/// Hence `PUBLIC_BASE_URL`: set it to the production domain and every generated link is stable
/// across deployments. When it is unset (local runs, plain Docker) the request's own host is the
/// right answer again, so the fallback stays.
fn public_base_url(req: &Request) -> String {
    if let Some(value) = std::env::var("PUBLIC_BASE_URL")
        .ok()
        .map(|value| value.trim().trim_end_matches('/').to_string())
        .filter(|value| !value.is_empty())
    {
        return value;
    }
    let host = req
        .headers()
        .get(axum::http::header::HOST)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("localhost");
    let scheme = req
        .headers()
        .get("x-forwarded-proto")
        .and_then(|value| value.to_str().ok())
        .unwrap_or("http");
    format!("{scheme}://{host}")
}

/// The gallery and the theme pills come from the same two ported units the card routes use, so
/// the home page needs nothing from the original.
async fn home(req: Request) -> Response {
    let query = parse_query(req.uri().query());
    let base_url = public_base_url(&req);
    let requested = query
        .iter()
        .find(|(k, _)| k == "theme")
        .map(|(_, v)| v.as_str());
    let active = requested
        .filter(|name| THEMES.contains(name))
        .unwrap_or(DEFAULT_THEME);

    // The template is compiled in rather than read from dist/: the binary has to serve the home
    // page with no Node build beside it, and src/views/index.html is the copy copy-assets.js
    // duplicates into dist anyway.
    let mut html = INDEX_HTML.to_string();
    // The rows come from the registry, so a platform registered there appears here too.
    let entries = super::registry::gallery_entries();
    let gallery =
        platforms::port::render_gallery(base_url.clone(), Some(active.to_string()), &entries)
            .unwrap_or_default();
    html = html.replace("<!-- GALLERY -->", &gallery);
    html = html.replace("${THEME_OPTIONS}", &THEMES.join(" / "));
    html = html.replace(
        "${THEME_PILLS}",
        &THEMES
            .iter()
            .map(|name| {
                format!(
                    "<a class=\"theme-pill\" href=\"?theme={}\">{name}</a>",
                    encode_uri_component(name)
                )
            })
            .collect::<Vec<_>>()
            .join(""),
    );
    Reply::new(StatusCode::OK, "text/html; charset=utf-8", html)
        .cache_control(HOME_CACHE)
        .into_response()
}

/// encodeURIComponent, for the characters a theme name can contain.
fn encode_uri_component(input: &str) -> String {
    let mut out = String::with_capacity(input.len());
    for byte in input.bytes() {
        let plain = byte.is_ascii_alphanumeric()
            || matches!(byte, b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')');
        if plain {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

// The three validators moved to `super::registry` along with the platform table: a platform's
// validator is a field on its descriptor now, so it cannot be missing from the list that uses it.

/// The query a handler reads, folded the way the original's middleware chain folds it.
///
/// Express parses with qs' extended syntax, xss-clean rewrites the tree, and hpp keeps the last
/// element of every array — so by the time a route runs there is no tree left, only strings.
pub fn parse_query(raw: Option<&str>) -> Vec<(String, String)> {
    super::query::parse(raw)
}

/// Seconds since the process started, floored the way Math.floor(process.uptime()) does.
fn process_uptime() -> u64 {
    use std::sync::OnceLock;
    static START: OnceLock<SystemTime> = OnceLock::new();
    let start = START.get_or_init(SystemTime::now);
    SystemTime::now()
        .duration_since(*start)
        .map(|elapsed| elapsed.as_secs())
        .unwrap_or(0)
}

/// new Date().toISOString(), to the millisecond.
fn iso_now() -> String {
    let elapsed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let seconds = elapsed.as_secs() as i64;
    let millis = elapsed.subsec_millis();
    let days = seconds.div_euclid(86_400);
    let seconds_of_day = seconds.rem_euclid(86_400);
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!(
        "{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        seconds_of_day / 3600,
        (seconds_of_day % 3600) / 60,
        seconds_of_day % 60
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The three cases below read and write the same process-wide variable, and cargo runs tests
    /// on several threads. Without this lock they interleave and fail in ways that look like bugs
    /// in `public_base_url` but are only test scheduling.
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn env_guard() -> std::sync::MutexGuard<'static, ()> {
        ENV_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// Builds a request the way a proxy hands it over, so public_base_url can be exercised against
    /// real headers instead of a hand-made struct.
    fn request(host: &str, proto: Option<&str>) -> Request {
        let mut builder = axum::http::Request::builder()
            .uri("/")
            .header(axum::http::header::HOST, host);
        if let Some(proto) = proto {
            builder = builder.header("x-forwarded-proto", proto);
        }
        builder.body(axum::body::Body::empty()).expect("request")
    }

    #[test]
    fn a_plain_request_falls_back_to_its_own_host() {
        let _guard = env_guard();
        // The local and Docker case: no PUBLIC_BASE_URL, so the request's host is the truth.
        unsafe { std::env::remove_var("PUBLIC_BASE_URL") };
        assert_eq!(
            public_base_url(&request("127.0.0.1:8080", None)),
            "http://127.0.0.1:8080"
        );
        assert_eq!(
            public_base_url(&request("example.com", Some("https"))),
            "https://example.com"
        );
    }

    #[test]
    fn a_configured_origin_wins_over_the_host_header() {
        let _guard = env_guard();
        // This is the Vercel case: the Host header carries a per-deployment hostname behind SSO,
        // and emitting it turns every gallery image into a 302. PUBLIC_BASE_URL overrides it.
        unsafe { std::env::set_var("PUBLIC_BASE_URL", "https://cards.example.com/") };
        assert_eq!(
            public_base_url(&request("project-abc123-team.vercel.app", Some("https"))),
            "https://cards.example.com",
            "a trailing slash must be trimmed, or every generated URL gets a double slash"
        );
        unsafe { std::env::remove_var("PUBLIC_BASE_URL") };
    }

    #[test]
    fn an_empty_configured_origin_is_the_same_as_unset() {
        let _guard = env_guard();
        // Deployments often define a variable with an empty value; that must not produce a bare
        // "https://" prefix.
        unsafe { std::env::set_var("PUBLIC_BASE_URL", "   ") };
        assert_eq!(
            public_base_url(&request("fallback.example", Some("https"))),
            "https://fallback.example"
        );
        unsafe { std::env::remove_var("PUBLIC_BASE_URL") };
    }
}