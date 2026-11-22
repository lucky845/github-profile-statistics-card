//! The response cache the original puts in front of every route.
//!
//! cache.middleware.ts wraps each GET/HEAD in a read-through cache and cache.service.ts keeps the
//! counters that /api/cache/stats reports. The original also feeds those same counters from the
//! per-platform storage layer, which is why one cold bilibili request costs two misses: one for the
//! HTTP response and one for the storage entry. Both layers live here so the numbers keep meaning
//! what they meant.
//!
//! The original backs the local map with Redis, and so does this port — but only when `REDIS_URL`
//! is set. Without it the local map is the whole cache, which is what a single-binary deployment
//! wants and what the recording baseline describes. With it, the map becomes the L1 fast path and
//! `remote` holds the same key for the full s-maxage, so a card costs one upstream fetch per
//! 10–60 minutes and several instances share the result.

use std::collections::{HashMap, VecDeque};
use std::sync::{Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::body::Body;
use axum::extract::Request;
use axum::http::{HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use super::headers::SECURITY;

/// The ceiling for one cache entry.
///
/// The original had two tiers: `localSet` capped the **L1** map at 60 seconds, while the Redis
/// tier stored the entry for the full TTL the caller asked for. Cards declare s-maxage between
/// 600 and 3600 seconds, so L1 was only ever a 60-second fast path in front of a 10-to-60-minute
/// store.
///
/// This port has no Redis tier, so keeping the 60-second L1 cap would make every card refetch an
/// upstream every minute — a 10x-to-60x increase in upstream traffic over the original. With
/// GitHub's anonymous budget at 60 requests/hour/IP and a single `/github/:user` costing two of
/// them, one steady visitor would exhaust the quota on their own. The cap therefore moves up to
/// the longest TTL any card declares (bilibili's 3600s), which is what the Redis tier used to
/// provide.
const LOCAL_TTL_CAP_MS: u64 = 3_600_000;

/// cache.service.ts keeps at most 500 entries and evicts the oldest insertion first.
const LOCAL_MAX_ENTRIES: usize = 500;

/// createCacheMiddleware's default TTL, in seconds, used when the response declares no s-maxage.
const DEFAULT_TTL_SECONDS: u64 = 300;

/// The lifetime the response itself asks a shared cache to keep it for.
///
/// Cards answer with `max-age=300, s-maxage=600, stale-while-revalidate=86400` and friends, and
/// the original's Redis tier honoured that s-maxage. Reading it here keeps one number in one
/// place: changing a platform's s-maxage changes both the header the CDN sees and the entry this
/// process keeps, so they cannot drift apart. `max-age` is deliberately not used — it is the
/// browser-facing value (300s), not the shared-cache one.
fn shared_ttl_seconds(cache_control: &str) -> u64 {
    cache_control
        .split(',')
        .filter_map(|directive| {
            let (name, value) = directive.trim().split_once('=')?;
            // Header directives arrive as written: "S-MaxAge = 1800" is the same directive as
            // "s-maxage=1800", so both the name and the value are trimmed before comparison.
            name.trim()
                .eq_ignore_ascii_case("s-maxage")
                .then(|| value.trim().parse::<u64>().ok())
                .flatten()
        })
        .next()
        .unwrap_or(DEFAULT_TTL_SECONDS)
}

/// Bodies of 512KB and up are never cached.
const MAX_BODY_BYTES: usize = 1024 * 512;

/// The five headers a cached response replays. Anything else is dropped on purpose: cache-control
/// has to survive, otherwise a HIT loses the s-maxage the card asked for.
const CACHEABLE_HEADERS: [&str; 5] = [
    "content-type",
    "content-length",
    "x-powered-by",
    "access-control-allow-origin",
    "cache-control",
];

struct Entry {
    body: Vec<u8>,
    headers: Vec<(String, String)>,
    expire_at_ms: u64,
}

#[derive(Default)]
struct Inner {
    entries: HashMap<String, Entry>,
    /// Insertion order, so the oldest key is the one evicted when the map is full.
    order: VecDeque<String>,
    hits: u64,
    misses: u64,
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// The process-wide cache and its counters.
fn cache() -> &'static Mutex<Inner> {
    static CACHE: OnceLock<Mutex<Inner>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(Inner::default()))
}

/// A cached response, already copied out of the lock.
pub struct Hit {
    pub body: Vec<u8>,
    pub headers: Vec<(String, String)>,
}

/// cacheService.get: a live entry is a hit, anything else (missing or expired) is a miss.
pub fn get(key: &str) -> Option<Hit> {
    let mut inner = cache().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let now = now_ms();
    let expired = inner
        .entries
        .get(key)
        .map(|entry| entry.expire_at_ms <= now)
        .unwrap_or(false);
    if expired {
        inner.entries.remove(key);
        inner.order.retain(|existing| existing != key);
    }
    let hit = inner.entries.get(key).map(|entry| Hit {
        body: entry.body.clone(),
        headers: entry.headers.clone(),
    });
    match hit {
        Some(hit) => {
            inner.hits += 1;
            Some(hit)
        }
        None => {
            inner.misses += 1;
            None
        }
    }
}

/// cacheService.set: store unconditionally, capping the TTL and evicting the oldest key.
pub fn set(key: &str, body: Vec<u8>, headers: Vec<(String, String)>, ttl_seconds: u64) {
    let mut inner = cache().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let ttl_ms = ttl_seconds.saturating_mul(1000).min(LOCAL_TTL_CAP_MS);
    if !inner.entries.contains_key(key) {
        inner.order.push_back(key.to_string());
    }
    inner.entries.insert(
        key.to_string(),
        Entry {
            body,
            headers,
            expire_at_ms: now_ms() + ttl_ms,
        },
    );
    while inner.order.len() > LOCAL_MAX_ENTRIES {
        if let Some(oldest) = inner.order.pop_front() {
            inner.entries.remove(&oldest);
        }
    }
}

/// storage.service.ts reads and writes through the same cache instance as the HTTP layer, so a
/// storage lookup costs one miss and its key counts towards `keys` exactly like a response entry.
/// That is why one cold bilibili request shows up as two misses in the recorded statistics.
pub fn storage_get(key: &str) -> Option<Value> {
    let hit = get(key)?;
    serde_json::from_slice(&hit.body).ok()
}

pub fn storage_set(key: &str, value: &Value, ttl_seconds: u64) {
    if let Ok(body) = serde_json::to_vec(value) {
        set(key, body, Vec::new(), ttl_seconds);
    }
}

/// Emit a number the way JSON.stringify does: no trailing .0 for integral values.
fn js_number(value: f64) -> Value {
    if value.fract() == 0.0 && value.abs() < 9.0e15 {
        json!(value as i64)
    } else {
        json!(value)
    }
}

/// cacheService.getStats.
pub fn stats() -> Value {
    let inner = cache().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let hits = inner.hits as f64;
    let misses = inner.misses as f64;
    let total = hits + misses;
    let rate = if total > 0.0 { hits / total * 100.0 } else { 0.0 };
    json!({
        "hits": js_number(hits),
        "misses": js_number(misses),
        "keys": js_number(inner.entries.len() as f64),
        "groups": 0,
        "hitsRate": js_number(rate),
    })
}

/// cacheService.clear: drop every entry, keep the counters (the original never resets them either).
pub fn clear() {
    let mut inner = cache().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    inner.entries.clear();
    inner.order.clear();
}

/// Test seam: counters are process-wide and cumulative, so a test needs a clean slate to read
/// absolute numbers. Runtime code never calls this.
#[cfg(test)]
fn reset() {
    let mut inner = cache().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    inner.entries.clear();
    inner.order.clear();
    inner.hits = 0;
    inner.misses = 0;
}

/// The headers a cached response is allowed to carry back.
fn cacheable(headers: &[(String, String)]) -> Vec<(String, String)> {
    headers
        .iter()
        .filter(|(name, _)| CACHEABLE_HEADERS.contains(&name.to_ascii_lowercase().as_str()))
        .cloned()
        .collect()
}

/// Stamp the 13 security headers onto a response the handler did not build. Express runs
/// securityHeaders before the cache middleware, so a HIT carries them just like a MISS.
fn with_security(mut response: Response) -> Response {
    for (name, value) in SECURITY {
        if !response.headers().contains_key(name)
            && let Ok(header_name) = name.parse::<header::HeaderName>()
        {
            response
                .headers_mut()
                .insert(header_name, HeaderValue::from_static(value));
        }
    }
    response
}

/// The cache middleware: read-through in front of every route, exactly where Express puts it.
pub async fn middleware(req: Request, next: Next) -> Response {
    let method = req.method().clone();
    if method != axum::http::Method::GET && method != axum::http::Method::HEAD {
        return next.run(req).await;
    }
    // The key is built from the path the client sent, not the one the router matched: Express keys
    // on req.path, and the rewrite that makes /Health match also runs before it would ever be seen
    // here. Two spellings of one route therefore get two cache entries, which is what the original
    // does (X-Cache-Key carries /Health while the handler still runs).
    let path = super::paths::original(&req);
    // health is the one path the original excludes, so its probing never pollutes the counters. The
    // comparison is exact on purpose: /health/ and /Health are ordinary cacheable paths.
    if path == "/health" {
        return next.run(req).await;
    }
    // The homepage bakes the request's Host into every gallery image URL, so its body varies with
    // the host. The cache key is host-agnostic (method:path:query), so storing it would let the
    // first host's URLs answer every other host -- the "only the first URL renders" bug. The page is
    // a cheap static render, so it is served fresh and never enters the process cache; its
    // Cache-Control still lets shared caches cache it, keyed by the full URL (which carries the
    // host). Security headers and the cache markers are still stamped, so only the read and write
    // below are skipped.
    let host_dependent = path == "/";
    let query = super::handlers::parse_query(req.uri().query());
    let key = super::keys::default_key(method.as_str(), &path, &query);

    // L1 first. A hit here is the cheapest possible answer and never touches the network, which is
    // why the local map still earns its place in front of Redis.
    if !host_dependent && let Some(hit) = get(&key) {
        return replay(hit, &key, "HIT");
    }

    // L2. Only reached when L1 has no live entry, and only when a shared tier is configured —
    // without `REDIS_URL` this is the same local miss the single-binary build already took, so the
    // counters keep meaning what they meant.
    if !host_dependent
        && super::remote::configured()
        && let Some(remote) = super::remote::get(&key).await
    {
        // Warm L1 from L2 so the next request in this process skips Redis too. The TTL used for
        // the warm entry is the response's own s-maxage, read back from the envelope.
        let ttl = remote
            .headers
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case("cache-control"))
            .map(|(_, value)| shared_ttl_seconds(value))
            .unwrap_or(DEFAULT_TTL_SECONDS);
        set(&key, remote.body.clone(), remote.headers.clone(), ttl);
        return replay(
            Hit {
                body: remote.body,
                headers: remote.headers,
            },
            &key,
            "HIT",
        );
    }

    let response = next.run(req).await;
    let status = response.status();
    let cache_control = response
        .headers()
        .get(header::CACHE_CONTROL)
        .and_then(|value| value.to_str().ok())
        .unwrap_or("")
        .to_string();
    let headers: Vec<(String, String)> = response
        .headers()
        .iter()
        .filter_map(|(name, value)| {
            value
                .to_str()
                .ok()
                .map(|text| (name.as_str().to_string(), text.to_string()))
        })
        .collect();

    let (parts, body) = response.into_parts();
    let Ok(bytes) = axum::body::to_bytes(body, MAX_BODY_BYTES * 4).await else {
        return with_security(Response::from_parts(parts, Body::empty()));
    };
    let cacheable_body = status.is_success()
        && !cache_control.contains("no-store")
        && bytes.len() < MAX_BODY_BYTES;
    if cacheable_body && !host_dependent {
        let ttl = shared_ttl_seconds(&cache_control);
        let stored = cacheable(&headers);
        set(&key, bytes.to_vec(), stored.clone(), ttl);
        // Dual-write, exactly like the original's set(): local map immediately, shared tier for
        // the same TTL. Awaiting it keeps one entry out of a half-written state; the body is
        // already buffered, so this is one round trip and not a second fetch.
        if super::remote::configured() {
            super::remote::set(
                &key,
                &super::remote::Envelope {
                    body: bytes.to_vec(),
                    headers: stored,
                },
                ttl,
            )
            .await;
        }
    }
    let mut response = Response::from_parts(parts, Body::from(bytes));
    // Express sets these two before `next()`, so a platform router that replaces the key wins.
    // Writing them here must therefore only fill a gap, never overwrite the handler's own key.
    if !response.headers().contains_key("x-cache-status") {
        response
            .headers_mut()
            .insert("x-cache-status", HeaderValue::from_static("MISS"));
    }
    if !response.headers().contains_key("x-cache-key")
        && let Ok(value) = HeaderValue::from_str(&key)
    {
        response.headers_mut().insert("x-cache-key", value);
    }
    with_security(response)
}

/// Rebuilds a cached response. Shared by the L1 and L2 hit paths so a HIT looks the same
/// regardless of which tier answered it — the client cannot tell, and should not be able to.
fn replay(hit: Hit, key: &str, status: &'static str) -> Response {
    let mut response = Response::new(Body::from(hit.body));
    for (name, value) in &hit.headers {
        if let (Ok(header_name), Ok(header_value)) = (
            name.parse::<header::HeaderName>(),
            HeaderValue::from_str(value),
        ) {
            response.headers_mut().insert(header_name, header_value);
        }
    }
    response
        .headers_mut()
        .insert("x-cache-status", HeaderValue::from_static(status));
    if let Ok(value) = HeaderValue::from_str(key) {
        response.headers_mut().insert("x-cache-key", value);
    }
    with_security(response)
}

/// Drop every key starting with `prefix` and report how many went. `deleteByPattern` strips one
/// trailing `*` from the pattern the client sent and does exactly this in the L1 map.
fn drop_prefix(prefix: &str) -> usize {
    let mut inner = cache().lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    let doomed: Vec<String> = inner
        .entries
        .keys()
        .filter(|key| key.starts_with(prefix))
        .cloned()
        .collect();
    for key in &doomed {
        inner.entries.remove(key);
    }
    inner
        .order
        .retain(|key| !doomed.iter().any(|gone| gone == key));
    doomed.len()
}

/// The DELETE /api/cache/clear body: the original reports what it dropped per selector.
///
/// The three selectors are not interchangeable, and the ordering is the original's: `all=true`
/// is checked first, so it wins over a group or a pattern sent alongside it. `deletedCount` is
/// the string "all" for that branch because manualCacheClearHandler writes a literal there, not
/// the number of keys it dropped.
pub async fn clear_response(
    all: bool,
    group: Option<&str>,
    pattern: Option<&str>,
) -> (StatusCode, super::r::R) {
    if all {
        clear();
        // The shared tier has to go too: leaving it behind would let the cluster keep serving
        // exactly what the caller asked to be dropped.
        super::remote::clear_all().await;
        return (
            StatusCode::OK,
            super::r::R::ok_msg(json!({ "deletedCount": "all" }), "Cleared all cache"),
        );
    }
    // group and pattern are interpolated into the message verbatim, the way the original's
    // template literals do.
    if let Some(group) = group {
        let prefix = format!("{group}:");
        let dropped = drop_prefix(&prefix) + super::remote::delete_prefix(&prefix).await;
        return (
            StatusCode::OK,
            super::r::R::ok_msg(
                json!({ "deletedCount": js_number(dropped as f64) }),
                format!("Cleared cache group: {group}"),
            ),
        );
    }
    if let Some(pattern) = pattern {
        // deleteByPattern turns a trailing glob into a plain prefix before matching.
        let prefix = pattern.strip_suffix('*').unwrap_or(pattern);
        let dropped = drop_prefix(prefix) + super::remote::delete_prefix(prefix).await;
        return (
            StatusCode::OK,
            super::r::R::ok_msg(
                json!({ "deletedCount": js_number(dropped as f64) }),
                format!("Cleared cache by pattern: {pattern}"),
            ),
        );
    }
    (
        StatusCode::BAD_REQUEST,
        super::r::R::err(
            StatusCode::BAD_REQUEST,
            "Must provide one of: pattern, group, or all=true",
        ),
    )
}

/// GET /api/cache/stats, answered from the same counters the middleware feeds.
pub fn stats_response() -> Response {
    // The counters were already nested under `data`, so the envelope takes the old outer shell's
    // place and `stats()` does not move: a client reading `data.hits` still finds it.
    super::r::R::ok_msg(stats(), "Cache statistics retrieved successfully")
        .reply(StatusCode::OK)
        .into_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The cache is a process-wide singleton and Rust runs tests in threads, so every test here
    /// holds this lock and resets the counters first; otherwise one test reads another's misses.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    /// Drives the async `clear_response` from a plain test.
    ///
    /// The mutex those tests hold is a `std` one, so blocking inside this runtime is safe: there
    /// is no async lock to deadlock on, and `block_on` here is only standing in for the `await`
    /// the request path would use.
    fn block_on_async<F: std::future::Future>(future: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("test runtime")
            .block_on(future)
    }

    fn guarded() -> std::sync::MutexGuard<'static, ()> {
        let guard = TEST_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        reset();
        guard
    }

    #[test]
    fn clearing_everything_reports_all_as_a_string() {
        // The guard is held across the block_on: the runtime is only used to drive the async
        // signatures, the lock itself is a plain mutex and does not care which thread takes it.
        let _guard = guarded();
        set("a:1", b"x".to_vec(), Vec::new(), 60);
        let (status, envelope) = block_on_async(clear_response(true, None, None));
        assert_eq!(status, StatusCode::OK);
        assert_eq!(envelope.code, 200);
        assert_eq!(envelope.msg, "Cleared all cache");
        // manualCacheClearHandler writes the literal "all", not the number of keys it dropped.
        assert_eq!(envelope.data["deletedCount"], "all");
        let inner = cache().lock().unwrap_or_else(|p| p.into_inner());
        assert!(inner.entries.is_empty());
    }

    #[test]
    fn a_group_drops_only_its_own_prefix_and_echoes_the_name() {
        let _guard = guarded();
        set("g1:one", b"x".to_vec(), Vec::new(), 60);
        set("g1:two", b"x".to_vec(), Vec::new(), 60);
        set("g2:three", b"x".to_vec(), Vec::new(), 60);
        let (status, envelope) = block_on_async(clear_response(false, Some("g1"), None));
        assert_eq!(status, StatusCode::OK);
        assert_eq!(envelope.msg, "Cleared cache group: g1");
        assert_eq!(envelope.data["deletedCount"], 2);
        let inner = cache().lock().unwrap_or_else(|p| p.into_inner());
        assert!(inner.entries.contains_key("g2:three"));
        assert!(!inner.entries.contains_key("g1:one"));
    }

    #[test]
    fn a_pattern_treats_a_trailing_glob_as_a_prefix_and_echoes_it_whole() {
        let _guard = guarded();
        set("p:1", b"x".to_vec(), Vec::new(), 60);
        set("p:2", b"x".to_vec(), Vec::new(), 60);
        set("q:3", b"x".to_vec(), Vec::new(), 60);
        // deleteByPattern strips one trailing '*' before matching, but the message keeps it.
        let (_, envelope) = block_on_async(clear_response(false, None, Some("p:*")));
        assert_eq!(envelope.msg, "Cleared cache by pattern: p:*");
        assert_eq!(envelope.data["deletedCount"], 2);
        let inner = cache().lock().unwrap_or_else(|p| p.into_inner());
        assert!(inner.entries.contains_key("q:3"));
    }

    #[test]
    fn no_selector_at_all_is_the_bad_request() {
        let _guard = guarded();
        let (status, envelope) = block_on_async(clear_response(false, None, None));
        assert_eq!(status, StatusCode::BAD_REQUEST);
        // The envelope's code mirrors the status, and there is nothing to report beyond the copy.
        assert_eq!(envelope.code, 400);
        assert_eq!(envelope.data, Value::Null);
    }

    #[test]
    fn the_shared_ttl_comes_from_s_maxage_not_max_age() {
        // Cards declare both: max-age is what the browser may keep, s-maxage is what a shared
        // cache may keep. The one that governs this process is s-maxage.
        assert_eq!(
            shared_ttl_seconds("public, max-age=300, s-maxage=3600, stale-while-revalidate=86400"),
            3600
        );
        assert_eq!(
            shared_ttl_seconds("public, max-age=300, s-maxage=600, stale-while-revalidate=86400"),
            600
        );
        // A failure card declares only max-age=60; that is the whole lifetime it wants.
        assert_eq!(shared_ttl_seconds("public, max-age=60"), 300);
        assert_eq!(shared_ttl_seconds("no-store"), 300);
        assert_eq!(shared_ttl_seconds(""), 300);
        // Case and spacing are not part of the grammar.
        assert_eq!(shared_ttl_seconds("S-MaxAge = 1800"), 1800);
    }

    #[test]
    fn a_declared_ttl_survives_the_cap_that_used_to_be_sixty_seconds() {
        // The regression this guards: the L1 cap used to be 60s, so a 3600s card refetched its
        // upstream every minute. Nothing below the cap may be truncated any more.
        let _guard = guarded();
        set("slow", b"x".to_vec(), Vec::new(), shared_ttl_seconds("public, s-maxage=3600"));
        let inner = cache().lock().unwrap_or_else(|p| p.into_inner());
        let entry = inner.entries.get("slow").expect("entry");
        let lifetime = entry.expire_at_ms.saturating_sub(now_ms());
        assert!(
            lifetime > 3_000_000,
            "a 3600s entry kept only {lifetime}ms, the 60s cap is back"
        );
    }

    #[test]
    fn an_expired_entry_is_a_miss() {
        let _guard = guarded();
        set("k", b"body".to_vec(), Vec::new(), 0);
        // A zero-second TTL expires immediately, so the very next read counts a miss.
        assert!(get("k").is_none());
    }

    #[test]
    fn a_live_entry_replays_its_body_and_headers() {
        let _guard = guarded();
        let headers = vec![
            ("content-type".to_string(), "image/svg+xml".to_string()),
            ("x-secret".to_string(), "drop me".to_string()),
        ];
        set("k2", b"<svg/>".to_vec(), cacheable(&headers), 300);
        let hit = get("k2").expect("a live entry");
        assert_eq!(hit.body, b"<svg/>");
        assert_eq!(hit.headers.len(), 1);
        assert_eq!(hit.headers[0].0, "content-type");
    }

    #[test]
    fn stats_count_each_read_once() {
        let _guard = guarded();
        get("absent");
        set("present", b"x".to_vec(), Vec::new(), 300);
        get("present");
        let value = stats();
        assert_eq!(value["misses"], json!(1));
        assert_eq!(value["hits"], json!(1));
        assert_eq!(value["keys"], json!(1));
        assert_eq!(value["hitsRate"], json!(50));
    }

    #[test]
    fn an_integral_rate_prints_without_a_decimal_point() {
        let _guard = guarded();
        assert_eq!(stats()["hitsRate"], json!(0));
        assert_eq!(serde_json::to_string(&stats()["hitsRate"]).unwrap(), "0");
    }
}