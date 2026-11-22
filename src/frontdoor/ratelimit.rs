//! apiRateLimiter: the 300-per-15-minutes gate in front of the five platform prefixes.
//!
//! Express mounts one limiter instance on five prefixes (app.ts:74-78), so all five share a single
//! bucket per client. The bucket is a fixed window that opens when the process starts and rolls
//! over every fifteen minutes, and it is keyed by the client address.
//!
//! The original keyed it by the *raw* X-Forwarded-For header whenever a caller sent one, which let
//! any caller mint a fresh bucket per request: four requests carrying four different values each
//! saw 299 remaining. That header is now read only from a peer entitled to speak for the client,
//! and only the entries that peer appended are read — see `client_key`.
//!
//! Three consequences are load-bearing and each was observed against the original:
//!
//! - the limiter sits *inside* the cache middleware, so a cache HIT returns before the bucket is
//!   charged and carries no RateLimit-* headers at all;
//! - the first request past the limit is answered 200 with an SVG error card, not 429: GitHub's
//!   camo caches a 429 into a permanent broken image in a README, so the original degrades the card
//!   instead of refusing it;
//! - a request the limiter turns away still carries the cache middleware's X-Cache-Key and
//!   X-Cache-Status, because Express stamps those before the limiter runs.

use std::collections::{HashMap, VecDeque};
use std::net::{IpAddr, SocketAddr};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::{ConnectInfo, Request};
use axum::http::{HeaderMap, HeaderValue, StatusCode, header};
use axum::middleware::Next;
use axum::response::Response;
use serde_json::Value;

use super::headers::SECURITY;

/// windowMs: 15 * 60 * 1000 in the original.
const WINDOW: Duration = Duration::from_secs(15 * 60);

/// max: 300 in the original.
const MAX_HITS: u64 = 300;

/// Retry-After is ceil(windowMs / 1000), a constant.
const RETRY_AFTER: &str = "900";

/// The copy the limiter's handler renders. It says API, unlike the unmounted global limiter.
const MESSAGE: &str = "API请求过于频繁，请稍后再试";

/// The most clients one window will remember. A key that comes from a request header can be minted
/// at will, so the map needs a ceiling: without one a caller rotating values grows it forever. At
/// roughly a hundred bytes a slot this caps the whole structure near a megabyte.
const MAX_TRACKED_CLIENTS: usize = 10_000;

struct Bucket {
    started: Instant,
    hits: HashMap<String, u64>,
    /// Insertion order, so eviction takes the client that has been quiet the longest rather than an
    /// arbitrary one.
    order: VecDeque<String>,
}

/// MemoryStore: one map and one window for the whole process, exactly as the module keeps it.
fn store() -> &'static Mutex<Bucket> {
    static STORE: OnceLock<Mutex<Bucket>> = OnceLock::new();
    STORE.get_or_init(|| {
        Mutex::new(Bucket {
            started: Instant::now(),
            hits: HashMap::new(),
            order: VecDeque::new(),
        })
    })
}

/// Charge one request to `key` and report the bucket the original would report: the running total
/// and the seconds left in the window.
fn charge(key: &str) -> (u64, u64) {
    let mut bucket = store()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let now = Instant::now();
    if now.duration_since(bucket.started) >= WINDOW {
        bucket.started = now;
        bucket.hits.clear();
        bucket.order.clear();
    }
    if !bucket.hits.contains_key(key) {
        while bucket.order.len() >= MAX_TRACKED_CLIENTS {
            if let Some(oldest) = bucket.order.pop_front() {
                bucket.hits.remove(&oldest);
            }
        }
        bucket.order.push_back(key.to_string());
    }
    let hits = bucket.hits.entry(key.to_string()).or_insert(0);
    *hits += 1;
    let total = *hits;
    let left = WINDOW.saturating_sub(now.duration_since(bucket.started));
    // Math.ceil((resetTime - Date.now()) / 1000), with Math.max(0, ..) applied by the original.
    let reset = (left.as_millis() as u64).div_ceil(1000);
    (total, reset)
}

/// Express mounts a router on a prefix with a segment boundary and matches it case-insensitively,
/// so /GitHub/octocat counts and /githubx does not.
fn under_a_platform_prefix(path: &str) -> bool {
    super::registry::under_a_mount(path)
}

/// How many proxies sit in front of this process. Zero means none, which is also the default: see
/// `ClientKey::trusted_hops`.
const TRUST_PROXY: &str = "TRUST_PROXY";

/// The number of hops in front of this process that may speak for a client, from `TRUST_PROXY`.
///
/// The default is zero, and that is the whole point. The original keyed the bucket by the raw
/// X-Forwarded-For header, so any caller could mint a fresh bucket per request by sending a
/// different value: four requests with four values each saw 299 remaining. Nothing a request
/// carries can be trusted until an operator says which hop writes it, and the answer differs by
/// deployment — `docker run -p 3000:3000` (`Dockerfile` EXPOSE 3000) reaches the process directly,
/// while `render.yaml` terminates TLS on a proxy that appends the header. Guessing either way is
/// wrong for the other, so the safe answer is the peer address until told otherwise.
///
/// A non-numeric or unparsable value is read as zero: a typo should cost accuracy, not safety.
fn trusted_hops() -> usize {
    std::env::var(TRUST_PROXY)
        .ok()
        .and_then(|value| value.trim().parse::<usize>().ok())
        .unwrap_or(0)
}

/// The address of the peer that opened the connection, when the transport told us.
fn peer_ip(req: &Request) -> Option<IpAddr> {
    req.extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|peer| peer.0.ip())
}

/// keyGenerator: the client address, never a header value the client itself controls.
///
/// With `TRUST_PROXY=<n>`, the rightmost `n` entries were appended by proxies we operate, so the
/// client is the entry immediately left of them (`entries[len - n]`). A chain shorter than `n`
/// means the request did not cross every hop we expected, so it is not treated as proxied at all.
/// A single entry that is not an address makes the whole chain unusable — discarding just that entry
/// would shift every later position one to the left and let a caller reach a different client's
/// bucket by padding its own header with junk. An unusable chain falls back to the peer address,
/// then to the literal fallback.
fn client_key(req: &Request) -> String {
    client_key_at(req, trusted_hops())
}

/// `client_key` with the hop count given, so the address arithmetic can be tested without the
/// environment deciding it.
fn client_key_at(req: &Request, hops: usize) -> String {
    let peer = peer_ip(req);
    if hops > 0
        && let Some(chain) = req
            .headers()
            .get("x-forwarded-for")
            .and_then(|value| value.to_str().ok())
    {
        let addresses: Option<Vec<IpAddr>> = chain
            .split(',')
            .map(|entry| entry.trim().parse::<IpAddr>().ok())
            .collect();
        if let Some(addresses) = addresses
            && let Some(client) = addresses.len().checked_sub(hops).map(|at| addresses[at])
        {
            return client.to_string();
        }
    }
    // No trusted proxy, or a chain that does not reach back far enough: the socket is the only
    // thing the caller cannot forge.
    peer.map(|address| address.to_string())
        .unwrap_or_else(|| "unknown-client".to_string())
}

fn insert(head: &mut HeaderMap, name: &str, value: &str) {
    if let (Ok(name), Ok(value)) = (
        name.parse::<header::HeaderName>(),
        HeaderValue::from_str(value),
    ) {
        head.insert(name, value);
    }
}

fn write_quota(head: &mut HeaderMap, remaining: u64, reset: u64) {
    insert(head, "ratelimit-limit", &MAX_HITS.to_string());
    insert(head, "ratelimit-remaining", &remaining.to_string());
    insert(head, "ratelimit-reset", &reset.to_string());
}

/// The limiter's handler: a 200 with the error card, no-store, and Retry-After.
fn over_limit(reset: u64) -> Response {
    let body = svg::port::generate_card(
        Value::String("error".to_string()),
        Value::String(MESSAGE.to_string()),
        None,
    )
    .unwrap_or_default();
    let mut response = Response::new(Body::from(body));
    let head = response.headers_mut();
    write_quota(head, 0, reset);
    insert(head, "retry-after", RETRY_AFTER);
    insert(head, "content-type", "image/svg+xml; charset=utf-8");
    insert(head, "cache-control", "no-store");
    for (name, value) in SECURITY {
        insert(head, name, value);
    }
    *response.status_mut() = StatusCode::OK;
    response
}

/// Charge the bucket, answer the card when it is empty, and stamp the quota on everything else.
pub async fn middleware(req: Request, next: Next) -> Response {
    if !under_a_platform_prefix(req.uri().path()) {
        return next.run(req).await;
    }
    let key = client_key(&req);
    let (total, reset) = charge(&key);
    if total > MAX_HITS {
        return over_limit(reset);
    }
    let mut response = next.run(req).await;
    write_quota(response.headers_mut(), MAX_HITS - total, reset);
    response
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bucket is process-wide, so the tests that read absolute numbers take turns.
    static TEST_LOCK: Mutex<()> = Mutex::new(());

    fn guarded() -> std::sync::MutexGuard<'static, ()> {
        let guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut bucket = store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        bucket.started = Instant::now();
        bucket.hits.clear();
        bucket.order.clear();
        guard
    }

    #[test]
    fn the_first_request_of_a_window_sees_the_whole_quota() {
        let _guard = guarded();
        let (total, reset) = charge("1.2.3.4");
        assert_eq!(total, 1);
        assert_eq!(reset, 900);
        assert_eq!(MAX_HITS - total, 299);
    }

    #[test]
    fn one_bucket_is_shared_by_every_prefix_and_split_by_key() {
        let _guard = guarded();
        charge("1.2.3.4");
        let (second, _) = charge("1.2.3.4");
        assert_eq!(second, 2);
        // A different client starts its own count.
        let (other, _) = charge("9.9.9.9");
        assert_eq!(other, 1);
    }

    #[test]
    fn the_request_past_the_limit_is_the_one_that_is_refused() {
        let _guard = guarded();
        for _ in 0..MAX_HITS {
            let (total, _) = charge("probe");
            assert!(total <= MAX_HITS);
        }
        let (total, _) = charge("probe");
        assert_eq!(total, MAX_HITS + 1);
    }

    #[test]
    fn a_prefix_matches_its_own_segment_only_and_ignores_case() {
        for path in [
            "/github",
            "/github/octocat",
            "/GitHub/OctoCat",
            "/GITHUB/octocat",
            "/bilibili/1",
            "/leetcode/x/y",
        ] {
            assert!(under_a_platform_prefix(path), "{path}");
        }
        for path in ["/githubx", "/github-style/x", "/nope", "/", "/health", "/api/github"] {
            assert!(!under_a_platform_prefix(path), "{path}");
        }
    }

    /// A request as axum hands it to middleware, with the peer the transport reported.
    fn request_from(peer: &str, forwarded_for: Option<&str>) -> Request {
        let mut builder = Request::builder().method("GET").uri("/github/octocat");
        if let Some(value) = forwarded_for {
            builder = builder.header("x-forwarded-for", value);
        }
        let mut request = builder.body(Body::empty()).expect("a request");
        let address: SocketAddr = peer.parse().expect("a socket address");
        request.extensions_mut().insert(ConnectInfo(address));
        request
    }

    #[test]
    fn a_header_the_caller_writes_does_not_become_the_bucket() {
        // The defect: four requests with four values each saw 299 remaining. Without a declared
        // proxy every value has to collapse onto the one thing the caller cannot choose.
        let mut seen = Vec::new();
        for forged in ["1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4"] {
            seen.push(client_key_at(&request_from("10.0.0.7:5000", Some(forged)), 0));
        }
        assert_eq!(seen, ["10.0.0.7"; 4]);
    }

    #[test]
    fn one_declared_hop_reads_the_rightmost_entry() {
        // A single proxy appends the address it saw, so the client is the last entry.
        let request = request_from("10.0.0.7:5000", Some("203.0.113.9, 198.51.100.4"));
        assert_eq!(client_key_at(&request, 1), "198.51.100.4");
    }

    #[test]
    fn two_declared_hops_read_the_entry_left_of_both_of_them() {
        // Two proxies we operate append two entries; everything left of them is the client's own
        // claim and must not be read even when it looks like an address.
        let request = request_from("10.0.0.7:5000", Some("6.6.6.6, 203.0.113.9, 198.51.100.4"));
        assert_eq!(client_key_at(&request, 2), "203.0.113.9");
    }

    #[test]
    fn a_chain_shorter_than_the_declared_hops_is_not_treated_as_proxied() {
        // `TRUST_PROXY=3` but only two entries: the request did not cross every hop the operator
        // declared, so the header says nothing trustworthy and the socket decides.
        let request = request_from("10.0.0.7:5000", Some("203.0.113.9, 198.51.100.4"));
        assert_eq!(client_key_at(&request, 3), "10.0.0.7");
    }

    #[test]
    fn one_unparsable_entry_voids_the_whole_chain_rather_than_shifting_it() {
        // Dropping the junk and keeping the rest would slide `203.0.113.9` into the position the
        // real client occupies, so a caller could aim the bucket at someone else's address. The
        // whole chain is unusable instead.
        let request = request_from("10.0.0.7:5000", Some("not-an-ip, 203.0.113.9"));
        assert_eq!(client_key_at(&request, 1), "10.0.0.7");
        // With a clean chain the same hop count does reach the address.
        let clean = request_from("10.0.0.7:5000", Some("203.0.113.9"));
        assert_eq!(client_key_at(&clean, 1), "203.0.113.9");
    }

    #[test]
    fn a_request_with_no_header_and_no_peer_still_gets_a_key() {
        let request = Request::builder()
            .uri("/github/octocat")
            .body(Body::empty())
            .expect("a request");
        assert_eq!(client_key_at(&request, 0), "unknown-client");
        assert_eq!(client_key_at(&request, 2), "unknown-client");
    }

    #[test]
    fn a_nonsense_trust_proxy_setting_is_read_as_no_proxy_at_all() {
        let _guard = TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        for value in ["", "  ", "yes", "-1", "1.5"] {
            // SAFETY: TEST_LOCK serialises every test that touches the environment here.
            unsafe { std::env::set_var(TRUST_PROXY, value) };
            assert_eq!(trusted_hops(), 0, "{value:?} should not declare a proxy");
        }
        unsafe { std::env::set_var(TRUST_PROXY, " 2 ") };
        assert_eq!(trusted_hops(), 2, "surrounding space should not break the count");
        unsafe { std::env::remove_var(TRUST_PROXY) };
        assert_eq!(trusted_hops(), 0, "unset means no proxy");
    }

    #[test]
    fn the_bucket_evicts_the_quietest_client_instead_of_growing_forever() {
        // A key minted per request used to grow the map without bound. The ceiling is what stops
        // that, so it has to actually evict.
        let _guard = guarded();
        for index in 0..MAX_TRACKED_CLIENTS + 5 {
            charge(&format!("client-{index}"));
        }
        let bucket = store()
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        assert_eq!(bucket.hits.len(), MAX_TRACKED_CLIENTS);
        assert_eq!(bucket.order.len(), MAX_TRACKED_CLIENTS);
        assert!(!bucket.hits.contains_key("client-0"), "the oldest should be gone");
        assert!(!bucket.hits.contains_key("client-4"), "five more clients arrived after it");
        assert!(bucket.hits.contains_key("client-5"), "the first survivor should be kept");
        assert!(bucket.hits.contains_key(&format!("client-{}", MAX_TRACKED_CLIENTS + 4)));
        drop(bucket);
    }

    #[test]
    fn the_refusal_is_a_two_hundred_carrying_the_error_card() {
        let _guard = guarded();
        let response = over_limit(890);
        assert_eq!(response.status(), StatusCode::OK);
        let headers = response.headers();
        assert_eq!(headers["ratelimit-limit"], "300");
        assert_eq!(headers["ratelimit-remaining"], "0");
        assert_eq!(headers["ratelimit-reset"], "890");
        assert_eq!(headers["retry-after"], "900");
        assert_eq!(headers["cache-control"], "no-store");
        assert_eq!(headers["content-type"], "image/svg+xml; charset=utf-8");
    }
}
