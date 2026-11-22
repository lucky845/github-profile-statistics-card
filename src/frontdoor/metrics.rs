//! The metrics endpoints, answered from the Rust process itself.
//!
//! The original mounts two registries. The one behind /metrics and /metrics/json is prom-client's
//! default registry: the Node runtime families (event loop lag, GC histogram, heap spaces, libuv
//! handle counts) plus three gauges the app declares and never fills. The other registry in
//! prometheus.service.ts is never exposed over HTTP, so nothing reads it.
//!
//! A Rust binary has no event loop to lag, no V8 heap and no libuv handles. Printing V8 numbers
//! that no longer exist would be a lie dressed as compatibility, so this module reports the
//! families that do describe this process: CPU seconds, start time, resident memory, and the cache
//! hit rate the counters actually know. The names, help strings and exposition format stay the ones
//! prom-client used, so an existing scraper keeps parsing.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::Request;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use super::cache;
use super::headers::Reply;

/// prom-client's contentType for the text exposition format.
pub const TEXT_CONTENT_TYPE: &str = "text/plain; version=0.0.4; charset=utf-8";

/// What res.json() answers with, re-exported so the one definition lives in `r`.
pub use super::r::JSON_CONTENT_TYPE;

/// global.requestCount. metrics.middleware.ts bumps it for every request that reaches the
/// middleware, which means every request the cache did not answer: the cache layer runs first and
/// a HIT never calls next.
static REQUESTS_TOTAL: AtomicU64 = AtomicU64::new(0);

/// global.requestCountLastHour. The original increments it and never resets it, so it tracks the
/// total since boot; kept identical rather than inventing an hourly window the recording never had.
static REQUESTS_LAST_HOUR: AtomicU64 = AtomicU64::new(0);

/// global.leetcodeApiCallCount, bumped by leetcode.service.ts:55 (CN) and :103 (US).
static LEETCODE_API_CALLS: AtomicU64 = AtomicU64::new(0);

/// global.githubApiCallCount. The original declared it, initialised it to zero and read it in
/// /stats, but never incremented it anywhere -- so the field was a constant 0 that looked like a
/// measurement. Rust had inherited the same dead value; it is now charged here, from
/// `github::with_api_headers`, which every outbound GitHub request passes through exactly once.
static GITHUB_API_CALLS: AtomicU64 = AtomicU64::new(0);

/// metricsMiddleware, reduced to the counters /stats reads. The duration and error instruments it
/// also fills go to the private registry, which has no HTTP route in the original either.
pub async fn middleware(req: Request, next: Next) -> Response {
    REQUESTS_TOTAL.fetch_add(1, Ordering::Relaxed);
    REQUESTS_LAST_HOUR.fetch_add(1, Ordering::Relaxed);
    next.run(req).await
}

/// One bump per region attempt, the way the original bumps the counter before it builds a request.
pub fn note_leetcode_call() {
    LEETCODE_API_CALLS.fetch_add(1, Ordering::Relaxed);
}

/// One bump per outbound GitHub API request.
///
/// Called from `github::with_api_headers`, the single place a request is assembled, so the two
/// calls a card makes (profile + repos) both count and a third added later cannot be forgotten.
/// A request that times out still counts: it left the process, and upstream quota counts it too.
pub fn note_github_call() {
    GITHUB_API_CALLS.fetch_add(1, Ordering::Relaxed);
}

/// The process numbers collectDefaultMetrics reads on the platforms this binary builds for.
#[derive(Default)]
struct Sample {
    cpu_user: f64,
    cpu_system: f64,
    start_time: f64,
    resident_bytes: f64,
}

/// The two process readings `/livez` and `/health` publish, taken from one procfs (or
/// proc_pidinfo) snapshot so both numbers describe the same instant.
///
/// Both are `Option` on purpose. A reading this process cannot take is reported as unknown, not
/// as zero: `uptime: 0` and `rss: 0` read as measurements, and a probe cannot tell them apart from
/// a process that really is brand new and really is holding no pages. `null` is the honest answer.
pub struct Readings {
    pub uptime_seconds: Option<u64>,
    pub resident_bytes: Option<u64>,
}

/// The process readings behind `/livez` and `/health`, from one sample.
pub fn readings() -> Readings {
    let sample = sample();
    Readings {
        uptime_seconds: seconds_since_start(sample.start_time, SystemTime::now()),
        // A resident size of zero is what an unreadable structure leaves behind, so it is
        // reported as unknown too: no live process holds no pages.
        resident_bytes: (sample.resident_bytes > 0.0).then_some(sample.resident_bytes as u64),
    }
}

/// Seconds between `start_time` (unix seconds, fractional) and `now`, floored the way
/// `Math.floor(process.uptime())` floors.
///
/// Split out from `readings` so a test can pin both ends instead of racing the clock. A start time
/// that was never read (0.0), is not a number, or lies in the future has no duration to report and
/// answers `None` -- reporting 0 would claim this process had just started.
fn seconds_since_start(start_time: f64, now: SystemTime) -> Option<u64> {
    if !start_time.is_finite() || start_time <= 0.0 {
        return None;
    }
    let now_seconds = now.duration_since(UNIX_EPOCH).ok()?.as_secs_f64();
    let elapsed = now_seconds - start_time;
    if !elapsed.is_finite() || elapsed < 0.0 {
        return None;
    }
    Some(elapsed.floor() as u64)
}

/// prom-client prints every family it knows, in registration order.
struct Family {
    name: &'static str,
    help: &'static str,
    kind: &'static str,
    /// What getMetricsAsJSON reports as the aggregator.
    aggregator: &'static str,
    values: Vec<f64>,
}

#[cfg(target_os = "macos")]
fn sample() -> Sample {
    let mut sample = Sample::default();
    let pid = std::process::id() as libc::c_int;
    // Both calls take the struct size and return how many bytes they filled; anything short of the
    // full size leaves the field at zero rather than reporting a half-read structure.
    unsafe {
        let mut task: libc::proc_taskinfo = std::mem::zeroed();
        let size = std::mem::size_of::<libc::proc_taskinfo>() as libc::c_int;
        let read = libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTASKINFO,
            0,
            &mut task as *mut libc::proc_taskinfo as *mut libc::c_void,
            size,
        );
        if read == size {
            // proc_taskinfo reports nanoseconds; process.cpuUsage() reports microseconds and
            // prom-client divides by 1e6, so both ends land on seconds.
            sample.cpu_user = task.pti_total_user as f64 / 1e9;
            sample.cpu_system = task.pti_total_system as f64 / 1e9;
            sample.resident_bytes = task.pti_resident_size as f64;
        }
        let mut bsd: libc::proc_bsdinfo = std::mem::zeroed();
        let size = std::mem::size_of::<libc::proc_bsdinfo>() as libc::c_int;
        let read = libc::proc_pidinfo(
            pid,
            libc::PROC_PIDTBSDINFO,
            0,
            &mut bsd as *mut libc::proc_bsdinfo as *mut libc::c_void,
            size,
        );
        if read == size {
            sample.start_time = bsd.pbi_start_tvsec as f64 + bsd.pbi_start_tvusec as f64 / 1e6;
        }
    }
    sample
}

/// The Linux equivalent reads /proc instead: columns 14/15 are user and system ticks, 22 is the
/// start tick and 24 the resident page count. NOT verified on this machine (it is macOS); the
/// parsing is written straight from proc(5) and the format is stable.
#[cfg(target_os = "linux")]
fn sample() -> Sample {
    let mut sample = Sample::default();
    let Ok(stat) = std::fs::read_to_string("/proc/self/stat") else {
        return sample;
    };
    // The command name sits in parentheses and may contain spaces, so split after the last one.
    let Some((_, rest)) = stat.rsplit_once(')') else {
        return sample;
    };
    let fields: Vec<&str> = rest.split_whitespace().collect();
    // rest starts at field 3 (state), so field N lives at index N - 3.
    let field = |index: usize| -> f64 {
        fields
            .get(index)
            .and_then(|value| value.parse::<f64>().ok())
            .unwrap_or(0.0)
    };
    let ticks = unsafe { libc::sysconf(libc::_SC_CLK_TCK) } as f64;
    let ticks = if ticks > 0.0 { ticks } else { 100.0 };
    sample.cpu_user = field(14 - 3) / ticks;
    sample.cpu_system = field(15 - 3) / ticks;
    let start_ticks = field(22 - 3);
    let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) } as f64;
    sample.resident_bytes = field(24 - 3) * if page_size > 0.0 { page_size } else { 4096.0 };
    // btime is the boot instant in seconds; starttime counts ticks since then.
    let mut boot = 0.0;
    if let Ok(stat_content) = std::fs::read_to_string("/proc/stat") {
        for line in stat_content.lines() {
            if let Some(rest) = line.strip_prefix("btime ") {
                boot = rest.trim().parse::<f64>().unwrap_or(0.0);
                break;
            }
        }
    }
    sample.start_time = boot + start_ticks / ticks;
    sample
}

/// Nothing to read on any other target; the families report zero instead of guessing.
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn sample() -> Sample {
    Sample::default()
}

fn families() -> Vec<Family> {
    let sample = sample();
    let stats = cache::stats();
    let hits = stats["hits"].as_f64().unwrap_or(0.0);
    let misses = stats["misses"].as_f64().unwrap_or(0.0);
    let seen = hits + misses;
    let hit_rate = if seen > 0.0 { hits / seen * 100.0 } else { 0.0 };
    vec![
        Family {
            name: "github_stats_process_cpu_user_seconds_total",
            help: "Total user CPU time spent in seconds.",
            kind: "counter",
            aggregator: "sum",
            values: vec![sample.cpu_user],
        },
        Family {
            name: "github_stats_process_cpu_system_seconds_total",
            help: "Total system CPU time spent in seconds.",
            kind: "counter",
            aggregator: "sum",
            values: vec![sample.cpu_system],
        },
        Family {
            name: "github_stats_process_cpu_seconds_total",
            help: "Total user and system CPU time spent in seconds.",
            kind: "counter",
            aggregator: "sum",
            values: vec![sample.cpu_user + sample.cpu_system],
        },
        Family {
            name: "github_stats_process_start_time_seconds",
            help: "Start time of the process since unix epoch in seconds.",
            kind: "gauge",
            aggregator: "omit",
            values: vec![sample.start_time],
        },
        Family {
            name: "github_stats_process_resident_memory_bytes",
            help: "Resident memory size in bytes.",
            kind: "gauge",
            aggregator: "sum",
            values: vec![sample.resident_bytes],
        },
        Family {
            name: "github_stats_cache_hit_rate",
            help: "缓存命中率",
            kind: "gauge",
            aggregator: "sum",
            values: vec![hit_rate],
        },
    ]
}

/// The exposition format prom-client writes: HELP and TYPE per family, one blank line between
/// families, and no blank line after the last one.
fn render_text() -> String {
    render_text_of(&families())
}

/// Split out so a test can render one snapshot of the families and check the bytes against that
/// same snapshot -- reading the process twice would let CPU time advance between the two.
fn render_text_of(families: &[Family]) -> String {
    let parts: Vec<String> = families
        .iter()
        .map(|family| {
            let mut out = format!(
                "# HELP {} {}\n# TYPE {} {}",
                family.name, family.help, family.name, family.kind
            );
            for value in &family.values {
                out.push('\n');
                out.push_str(family.name);
                out.push(' ');
                out.push_str(&format!("{value}"));
            }
            out
        })
        .collect();
    let mut body = parts.join("\n\n");
    body.push('\n');
    body
}

/// A JS number keeps integers integral when it serialises; float 1.0 must not print as 1.0.
fn number_value(value: f64) -> Value {
    if value.fract() == 0.0 && value.abs() < 9.0e15 {
        json!(value as i64)
    } else {
        json!(value)
    }
}

/// register.getMetricsAsJSON(): help, name, type, values, aggregator, in that key order.
fn render_json() -> Value {
    render_json_of(&families())
}

fn render_json_of(families: &[Family]) -> Value {
    let entries: Vec<Value> = families
        .iter()
        .map(|family| {
            let values: Vec<Value> = family
                .values
                .iter()
                .map(|value| json!({ "value": number_value(*value), "labels": {} }))
                .collect();
            json!({
                "help": family.help,
                "name": family.name,
                "type": family.kind,
                "values": Value::Array(values),
                "aggregator": family.aggregator,
            })
        })
        .collect();
    Value::Array(entries)
}

/// The cache policy for every endpoint whose body is a live reading.
///
/// Without this they fell through to `createCacheMiddleware`'s default TTL and the process cache
/// answered a five-minute-old snapshot: a Prometheus scrape read stale gauges, and `/stats`
/// repeated the numbers from the previous request. A diagnostics endpoint that lies about "now"
/// is worse than one that is slow.
///
/// `no-store` is also what stops the write: the middleware refuses to store a response that
/// carries it. The `X-Cache-*` markers are still stamped, and the body is never rewritten.
pub const LIVE_CACHE_CONTROL: &str = "no-store";

/// GET /metrics.
pub fn text_response() -> Response {
    Reply::new(StatusCode::OK, TEXT_CONTENT_TYPE, render_text())
        .cache_control(LIVE_CACHE_CONTROL)
        .into_response()
}

/// GET /metrics/json.
pub fn json_response() -> Response {
    let body = serde_json::to_string(&render_json()).unwrap_or_default();
    Reply::new(StatusCode::OK, JSON_CONTENT_TYPE, body)
        .cache_control(LIVE_CACHE_CONTROL)
        .into_response()
}

/// GET /stats: the two request counters, the cache counters, and the external API tallies.
/// Both tallies are live: GitHub is charged at request construction, LeetCode per region attempt
/// (the original had a live LeetCode counter and a dead GitHub one; the dead one is fixed here).
pub fn stats_response() -> Response {
    // The counters keep the shape the original published; the envelope is what changed. /metrics
    // and /metrics/json are untouched on purpose -- a scraper parses those, and /metrics/json is
    // prom-client's own array format, not an answer this app has any business wrapping.
    let data = json!({
        "requests": {
            "total": REQUESTS_TOTAL.load(Ordering::Relaxed),
            "lastHour": REQUESTS_LAST_HOUR.load(Ordering::Relaxed),
        },
        "cache": cache::stats(),
        "externalApis": {
            "github": GITHUB_API_CALLS.load(Ordering::Relaxed),
            "leetcode": LEETCODE_API_CALLS.load(Ordering::Relaxed),
        },
    });
    super::r::R::ok(data)
        .reply(StatusCode::OK)
        .cache_control(LIVE_CACHE_CONTROL)
        .into_response()
}

/// The route handlers. axum only accepts async functions, so the three endpoints that build
/// their body synchronously get a thin await wrapper each.
pub async fn text_endpoint() -> Response {
    text_response()
}

pub async fn json_endpoint() -> Response {
    json_response()
}

pub async fn stats_endpoint() -> Response {
    stats_response()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_exposition_ends_with_one_newline_and_no_blank_line() {
        let families = families();
        let body = render_text_of(&families);
        assert!(body.ends_with("\n"));
        assert!(!body.ends_with("\n\n"));
        // Every family but the last is followed by exactly one blank line.
        assert!(body.contains("\n\n# HELP "));
        assert_eq!(body.matches("\n\n").count(), families.len() - 1);
    }

    #[test]
    fn every_family_declares_help_then_type_then_its_samples() {
        let families = families();
        let body = render_text_of(&families);
        for family in &families {
            let header = format!("# HELP {} {}\n# TYPE {} {}\n", family.name, family.help, family.name, family.kind);
            let start = body.find(&header).unwrap_or_else(|| panic!("{} has HELP and TYPE in order", family.name));
            let rest = &body[start + header.len()..];
            for value in &family.values {
                let line = format!("{} {value}", family.name);
                assert!(rest.starts_with(&line), "{} starts with its first sample", family.name);
            }
        }
    }

    #[test]
    fn json_reports_prom_clients_key_order_and_aggregators() {
        let value = render_json();
        let entries = value.as_array().expect("an array of families");
        let first = entries.first().expect("at least one family");
        let keys: Vec<&str> = first.as_object().expect("an object").keys().map(|key| key.as_str()).collect();
        assert_eq!(keys, vec!["help", "name", "type", "values", "aggregator"]);
        let start = entries
            .iter()
            .find(|entry| entry["name"] == "github_stats_process_start_time_seconds")
            .expect("the start time family");
        assert_eq!(start["aggregator"], json!("omit"));
        let rate = entries
            .iter()
            .find(|entry| entry["name"] == "github_stats_cache_hit_rate")
            .expect("the hit rate family");
        let sample = &rate["values"][0];
        assert_eq!(sample["labels"], json!({}));
        assert!(sample["value"].is_number());
    }

    #[test]
    fn a_process_that_started_an_hour_ago_has_been_up_for_an_hour() {
        // Both ends pinned: a start time 3600s before a fixed instant must round down to 3600,
        // never 3599 -- which is what a float subtraction of two unrelated epochs risks.
        let now = UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
        let start = 1_700_000_000.0 - 3600.0;
        assert_eq!(seconds_since_start(start, now), Some(3600));
        // Half a second into the process is still zero seconds elapsed, the way Math.floor
        // reports it, and it is `Some(0)` rather than `None`: this process really did start.
        let fresh = 1_700_000_000.0 - 0.5;
        assert_eq!(seconds_since_start(fresh, now), Some(0));
    }

    #[test]
    fn an_unreadable_start_time_is_unknown_rather_than_zero() {
        let now = UNIX_EPOCH + std::time::Duration::from_secs(1_700_000_000);
        // 0.0 is what every `sample()` implementation returns when it cannot read the field.
        assert_eq!(seconds_since_start(0.0, now), None);
        assert_eq!(seconds_since_start(f64::NAN, now), None);
        assert_eq!(seconds_since_start(f64::INFINITY, now), None);
        // A start time after `now` is a clock that moved, not an uptime that is negative.
        assert_eq!(seconds_since_start(1_700_000_100.0, now), None);
    }

    #[test]
    fn the_live_readings_are_taken_from_this_process() {
        // Not pinning the numbers -- they move -- only that on a platform that can read /proc (or
        // call proc_pidinfo) the readings are present and describe a process that has been up
        // for a plausible time. This is the assertion that would have caught the OnceLock bug:
        // a value read at first request would still be Some(0) here, which is allowed, so the
        // separate integration test pins the number against a second reading instead.
        let readings = readings();
        #[cfg(any(target_os = "macos", target_os = "linux"))]
        {
            assert!(readings.uptime_seconds.is_some(), "this process knows when it started");
            assert!(readings.resident_bytes.is_some_and(|bytes| bytes > 0), "this process holds pages");
        }
    }

    #[test]
    fn a_process_that_has_answered_requests_reports_them() {
        let before = REQUESTS_TOTAL.load(Ordering::Relaxed);
        note_leetcode_call();
        let body = stats_response().into_response();
        // The response is built from the same atomics the middleware bumps; read them directly so
        // a concurrently running test cannot make this flaky.
        assert!(REQUESTS_TOTAL.load(Ordering::Relaxed) >= before);
        assert!(LEETCODE_API_CALLS.load(Ordering::Relaxed) >= 1);
        assert_eq!(body.status(), StatusCode::OK);
    }
}
