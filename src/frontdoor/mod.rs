pub mod bilibili;
pub mod cache;
pub mod cors;
pub mod csdn;
pub mod github;
pub mod handlers;
pub mod headers;
pub mod json;
pub mod juejin;
pub mod keys;
pub mod leetcode;
pub mod metrics;
pub mod paths;
pub mod query;
pub mod r;
pub mod ratelimit;
pub mod registry;
pub mod remote;

pub use handlers::router;

/// Clear the process-wide platform health counters.
///
/// Exposed for the integration tests only: the counters are a static, so a test asserting
/// "one request moved one counter" cannot run against a map an earlier test already filled.
/// Production never calls this — the counters accumulate for the process's lifetime, which is
/// what makes them useful in the `/health` endpoint.
#[doc(hidden)]
pub fn platforms_reset_health_for_tests() {
    // The callers are tests; a poisoned mutex here means another test already panicked, and the
    // assertion that follows will say so more usefully than this could.
    let _ = platforms::port::reset_health();
}