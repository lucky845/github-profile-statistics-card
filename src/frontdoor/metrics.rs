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

use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::Request;
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use serde_json::{Value, json};

use super::cache;
use super::headers::Reply;
use super::registry;

/// prom-client's contentType for the text exposition format.
pub const TEXT_CONTENT_TYPE: &str = "text/plain; version=0.0.4; charset=utf-8";

/// What res.json() answers with, re-exported so the one definition lives in `r`.
pub use super::r::JSON_CONTENT_TYPE;

/// global.requestCount. metrics.middleware.ts bumps it for every request that reaches the
/// middleware, which means every request the cache did not answer: the cache layer runs first and
/// a HIT never calls next.
static REQUESTS_TOTAL: AtomicU64 = AtomicU64::new(0);

/// The bucket count of the rolling hour: one per minute, the newest 60 minutes of traffic.
const HOUR_BUCKETS: usize = 60;

/// `requests.lastHour` -- how many requests reached this middleware in the last hour.
///
/// The original bumps `global.requestCountLastHour` beside the total in metrics.middleware.ts and
/// never resets it, while metrics.routes.ts publishes it as `lastHour`. The two numbers were
/// therefore equal for the whole life of the process: a field whose name promises a window that
/// no code ever opened. A port that copies that is not being faithful, it is publishing a
/// mislabelled total -- the same defect as the V8 memory keys and the always-unhealthy status.
///
/// An hour is kept here as 60 per-minute buckets, rotated lazily on the way in and on the way out,
/// so a process that goes quiet for a day costs nothing until somebody asks. `minute` is the
/// newest minute the buckets describe, which makes the window the current minute plus the 59
/// before it: an hour to the minute, not to the second. That is the resolution the upstream
/// recording had, and pretending to second precision would be inventing numbers again.
struct HourWindow {
    minute: u64,
    buckets: [u64; HOUR_BUCKETS],
}

/// The one lock this module takes. It is what makes rotation exact: 60 atomics updated without
/// one would let a thread add to a bucket another thread is clearing, and the lost increment
/// would be invisible. An uncontended lock is a handful of nanoseconds against a request that
/// already walked through routing, caching and an SVG render.
static LAST_HOUR: Mutex<HourWindow> = Mutex::new(HourWindow {
    minute: 0,
    buckets: [0; HOUR_BUCKETS],
});

/// One outbound-call tally per registered platform, in `registry::PLATFORMS` order.
///
/// The length comes from the registry rather than a literal, so a platform added there has a
/// counter before anyone remembers to add one. The original had two counters -- one live
/// (leetcodeApiCallCount), one dead and returned as a constant 0 (githubApiCallCount) -- and the
/// port published those same two fields for all five platforms, so three of the five tallies were
/// decoration. The other half of that bug was fixed for `/health`'s `platforms` field; this is
/// the same disease in `/stats`' `externalApis`.
static EXTERNAL_API_CALLS: [AtomicU64; registry::PLATFORMS.len()] =
    [const { AtomicU64::new(0) }; registry::PLATFORMS.len()];

/// The only entry point to the window's state: every read and every charge takes this lock.
fn last_hour() -> std::sync::MutexGuard<'static, HourWindow> {
    LAST_HOUR.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// The unix minute this process is living in.
///
/// A clock that cannot be read before the epoch answers 0, which the rotation treats as "no time
/// has passed": the counts stay where they are instead of being thrown away over a bad read.
fn current_minute() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| elapsed.as_secs() / 60)
        .unwrap_or(0)
}

/// Move the window's newest minute forward to `minute`, clearing only the buckets that closed.
///
/// Runs on the way in and on the way out, so the number is right without a background task and a
/// process that idles for a week answers with its real (empty) hour the moment it is asked.
fn advance(window: &mut HourWindow, minute: u64) {
    // A clock that steps backwards must not erase counts that really happened. Clamping keeps the
    // window where it is; rewinding would answer with a smaller hour than the process observed,
    // and the lost minutes would never be restored.
    if minute <= window.minute {
        return;
    }
    let elapsed = minute - window.minute;
    if elapsed >= HOUR_BUCKETS as u64 {
        // The whole window fell out: everything it held is older than an hour.
        window.buckets = [0; HOUR_BUCKETS];
    } else {
        // Only the minutes that closed are cleared, so a bucket still holding a count from inside
        // the hour keeps it. A single `buckets = [0; _]` here would pass a fresh-window test and
        // silently drop the counts of the last 59 minutes.
        for step in 1..=elapsed {
            let index = ((window.minute + step) % HOUR_BUCKETS as u64) as usize;
            window.buckets[index] = 0;
        }
    }
    window.minute = minute;
}

/// Charge one request to the minute it arrived in.
fn charge(window: &mut HourWindow, minute: u64) {
    advance(window, minute);
    let index = (window.minute % HOUR_BUCKETS as u64) as usize;
    window.buckets[index] = window.buckets[index].saturating_add(1);
}

/// The rolling hour, as of `minute`.
fn windowed(window: &mut HourWindow, minute: u64) -> u64 {
    advance(window, minute);
    window
        .buckets
        .iter()
        .fold(0u64, |sum, bucket| sum.saturating_add(*bucket))
}

/// `requests.lastHour`: the requests this middleware answered in the last 60 minutes.
pub fn last_hour_requests() -> u64 {
    let mut window = last_hour();
    windowed(&mut window, current_minute())
}

/// Move the rolling hour forward as if `minutes` had passed.
///
/// Exposed for the integration test only. The roll-off is the one behaviour a test cannot reach
/// by waiting: proving at the endpoint that `lastHour` forgets would otherwise cost an hour of
/// CI, and the weaker assertion available instead -- "the hour is at most the total" -- is one
/// the defect this replaced also satisfies, since it published the total twice.
///
/// The window is left `minutes` ahead of the wall clock, so this belongs at the end of a test
/// process rather than in the middle of one: reads clamp to the newest minute they have, which
/// keeps the counts where they are instead of rewinding them.
#[doc(hidden)]
pub fn age_last_hour_for_tests(minutes: u64) {
    let mut window = last_hour();
    let ahead = window.minute.max(current_minute()).saturating_add(minutes);
    advance(&mut window, ahead);
}

/// Charge one request into the rolling hour.
///
/// A named function rather than a line in `middleware` so the guard's scope ends before the
/// `await`: a `MutexGuard` held across a yield point makes the middleware future `!Send`, and
/// axum refuses to layer it.
fn note_request() {
    let mut window = last_hour();
    charge(&mut window, current_minute());
}

/// The slot a platform's tally lives in, looked up by the same name the router matches.
fn external_slot(platform: &str) -> Option<usize> {
    registry::all().iter().position(|desc| desc.name == platform)
}

/// Charge one outbound call to a platform.
///
/// Called where the request is assembled, not where it succeeds: a call that times out still left
/// the process and still counted against the upstream's quota, so counting only successful ones
/// would under-report exactly when it matters. Retries inside one fetch are not charged again --
/// the tally answers "how much traffic did this platform receive", not "how many attempts".
///
/// An unregistered name is ignored rather than panicking. It cannot happen from the platform
/// modules -- each passes its own `PLATFORM` constant, and
/// `every_platform_module_names_a_registered_platform` proves those constants are all in the
/// registry -- so the only way to reach it is a future caller typing a name by hand. Failing the
/// request over a bookkeeping miss would be the wrong trade: the card is fine, the number is not.
pub fn note_external_call(platform: &str) {
    if let Some(index) = external_slot(platform) {
        EXTERNAL_API_CALLS[index].fetch_add(1, Ordering::Relaxed);
    }
}

/// The tally for one platform, or 0 when it is not registered.
pub fn external_calls(platform: &str) -> u64 {
    external_slot(platform).map_or(0, |index| EXTERNAL_API_CALLS[index].load(Ordering::Relaxed))
}

/// metricsMiddleware, reduced to the counters /stats reads. The duration and error instruments it
/// also fills go to the private registry, which has no HTTP route in the original either.
pub async fn middleware(req: Request, next: Next) -> Response {
    // The total is bumped first: the hour is a subset of it, and a reader that catches the two
    // mid-update must never see an hour larger than the process's whole life.
    REQUESTS_TOTAL.fetch_add(1, Ordering::Relaxed);
    note_request();
    next.run(req).await
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
///
/// Every registered platform gets a tally, built by walking `registry::PLATFORMS`, so the shape
/// follows the registry instead of a hand-written pair of keys. The original published two
/// counters for five platforms: one live, one never incremented. This endpoint now answers with
/// five numbers that all move.
pub fn stats_response() -> Response {
    // The counters keep the shape the original published; the envelope is what changed. /metrics
    // and /metrics/json are untouched on purpose -- a scraper parses those, and /metrics/json is
    // prom-client's own array format, not an answer this app has any business wrapping.
    let data = json!({
        "requests": {
            "total": REQUESTS_TOTAL.load(Ordering::Relaxed),
            "lastHour": last_hour_requests(),
        },
        "cache": cache::stats(),
        "externalApis": external_api_tallies(),
    });
    super::r::R::ok(data)
        .reply(StatusCode::OK)
        .cache_control(LIVE_CACHE_CONTROL)
        .into_response()
}

/// `{github: N, leetcode: N, csdn: N, juejin: N, bilibili: N}`, in registry order.
///
/// A Map (serde_json with preserve_order) keeps that order in the serialized body, which is what
/// makes the output diffable against a recorded case and readable by eye.
fn external_api_tallies() -> Value {
    let mut tallies = serde_json::Map::new();
    for desc in registry::all() {
        tallies.insert(
            desc.name.to_string(),
            Value::from(external_calls(desc.name)),
        );
    }
    Value::Object(tallies)
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

    /// The tallies are process-wide and these tests both read and write them. cargo runs a module's
    /// tests on several threads, so without this lock the "unknown name changes nothing" assertion
    /// races the test that charges slot 2 a thousand times -- observed as
    /// `left: [1, 0, 80, 0, 0] right: [1, 0, 125, 0, 0]`, which looks like a wiring bug and is
    /// only scheduling.
    static TALLY_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    fn tally_guard() -> std::sync::MutexGuard<'static, ()> {
        TALLY_LOCK.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

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
        let platform = registry::all()[0].name;
        let calls_before = external_calls(platform);
        note_external_call(platform);
        let body = stats_response().into_response();
        // The response is built from the same atomics the middleware bumps; read them directly so
        // a concurrently running test cannot make this flaky.
        assert!(REQUESTS_TOTAL.load(Ordering::Relaxed) >= before);
        assert!(external_calls(platform) > calls_before);
        assert_eq!(body.status(), StatusCode::OK);
    }

    /// A window as of `minute`, with nothing charged yet.
    fn window_at(minute: u64) -> HourWindow {
        HourWindow {
            minute,
            buckets: [0; HOUR_BUCKETS],
        }
    }

    #[test]
    fn the_hour_forgets_a_minute_once_sixty_minutes_have_closed() {
        // The defect this replaces could not fail here: the old counter never decreased, so a
        // test that only charged and read would pass against both implementations. Forgetting is
        // the property, and 60 minutes is where it has to happen.
        let mut window = window_at(100);
        for _ in 0..3 {
            charge(&mut window, 100);
        }
        assert_eq!(windowed(&mut window, 100), 3, "the minute that just closed is still inside");
        assert_eq!(windowed(&mut window, 159), 3, "minute 100 is inside a window ending at 159");
        assert_eq!(windowed(&mut window, 160), 0, "minute 100 left a window ending at 160");
    }

    #[test]
    fn only_the_buckets_that_closed_are_cleared() {
        // This is what tells a correct rotation from the two-line version that just zeroes the
        // whole array on every minute change: that one passes a single-charge test and drops the
        // previous 59 minutes of traffic every time.
        let mut window = window_at(100);
        charge(&mut window, 100);
        charge(&mut window, 130);
        assert_eq!(windowed(&mut window, 140), 2);
        assert_eq!(windowed(&mut window, 161), 1, "the 100 charge left the hour, the 130 charge stayed");
    }

    #[test]
    fn a_clock_that_steps_backwards_keeps_the_count() {
        // NTP steps an unvirtualised host backwards. Rewinding the window would report a smaller
        // hour than the process really served, and nothing would ever put the minutes back.
        let mut window = window_at(100);
        charge(&mut window, 100);
        charge(&mut window, 100);
        assert_eq!(windowed(&mut window, 90), 2, "a backwards step must not erase what happened");
        charge(&mut window, 95);
        assert_eq!(windowed(&mut window, 100), 3, "the charge lands in the minute the window is on");
    }

    #[test]
    fn a_long_silence_empties_the_window_instead_of_summing_stale_minutes() {
        let mut window = window_at(100);
        for _ in 0..5 {
            charge(&mut window, 100);
        }
        assert_eq!(windowed(&mut window, 160), 0, "an hour of silence leaves nothing in the hour");
        assert_eq!(windowed(&mut window, 10_000), 0, "a day of silence must not resurrect counts");
    }

    #[test]
    fn the_published_hour_is_never_larger_than_the_total() {
        // `lastHour` is a subset of `total` by construction. If a future edit wires the field
        // back to the total the two become equal and this cannot tell -- an hour always equal to
        // the life of the process needs 61 minutes of running to disprove, which is why the
        // rotation above is tested as a pure function. What this can catch is the hour counting
        // something the total does not.
        assert!(
            last_hour_requests() <= REQUESTS_TOTAL.load(Ordering::Relaxed),
            "the hour cannot hold more requests than the process has answered"
        );
    }

    #[test]
    fn every_registered_platform_has_its_own_slot() {
        // The tally table is indexed by registry position; this pins that mapping so a platform
        // cannot end up charging somebody else's counter.
        let slots: Vec<Option<usize>> = registry::all().iter().map(|desc| external_slot(desc.name)).collect();
        let expected: Vec<Option<usize>> = (0..registry::all().len()).map(Some).collect();
        assert_eq!(slots, expected, "every platform has exactly the slot its position says");
        assert_eq!(external_slot("definitely-not-a-platform"), None);
    }

    #[test]
    fn charging_a_platform_moves_that_tally_and_only_that_tally() {
        let _guard = tally_guard();
        let target = registry::all()[2].name;
        let before: Vec<u64> = registry::all().iter().map(|desc| external_calls(desc.name)).collect();
        for _ in 0..1000 {
            note_external_call(target);
        }
        let after: Vec<u64> = registry::all().iter().map(|desc| external_calls(desc.name)).collect();
        let charged = before[2];
        assert!(
            after[2] >= charged + 1000,
            "1000 calls to {target} moved its tally from {charged} to {}",
            after[2]
        );
        // Slots other than the target must not be the ones being charged. Other tests may add to
        // them concurrently, so this asserts "not decreased" rather than "unchanged" -- the exact
        // check above is what rules out a shared slot.
        for (index, (before, after)) in before.iter().zip(&after).enumerate() {
            if index != 2 {
                assert!(after >= before, "slot {index} went backwards: {before} -> {after}");
            }
        }
    }

    #[test]
    fn an_unregistered_name_is_ignored_rather_than_charged_to_someone() {
        // Called through the same path a platform module uses, so this is the "typo in the name"
        // case: it must not silently land on slot 0.
        let _guard = tally_guard();
        let before: Vec<u64> = registry::all().iter().map(|desc| external_calls(desc.name)).collect();
        note_external_call("definitely-not-a-platform");
        let after: Vec<u64> = registry::all().iter().map(|desc| external_calls(desc.name)).collect();
        assert_eq!(before, after, "an unknown name must not increment any real platform");
        assert_eq!(external_calls("definitely-not-a-platform"), 0);
    }

    #[test]
    fn every_platform_module_names_a_registered_platform() {
        // Each module passes its own PLATFORM constant to note_external_call. If a module's
        // constant were not in the registry table, its tally would go nowhere -- the same class of
        // bug as the three dead tallies this change removed. The list is enumerated rather than
        // derived because the modules are the thing being checked against the registry.
        // Paths are spelled from `crate::` because inside this test module `super` is `metrics`,
        // not `frontdoor`.
        let modules = [
            crate::frontdoor::github::PLATFORM,
            crate::frontdoor::leetcode::PLATFORM,
            crate::frontdoor::csdn::PLATFORM,
            crate::frontdoor::juejin::PLATFORM,
            crate::frontdoor::bilibili::PLATFORM,
        ];
        assert_eq!(
            modules.len(),
            registry::all().len(),
            "a platform module is missing from this check, or registered without one"
        );
        for platform in modules {
            assert!(
                external_slot(platform).is_some(),
                "{platform} is not in registry::PLATFORMS, so its calls are never counted"
            );
        }
    }

    #[test]
    fn the_stats_body_publishes_one_tally_per_registered_platform_in_order() {
        let tallies = external_api_tallies();
        let object = tallies.as_object().expect("externalApis is an object");
        let keys: Vec<&str> = object.keys().map(|key| key.as_str()).collect();
        let expected: Vec<&str> = registry::all().iter().map(|desc| desc.name).collect();
        assert_eq!(
            keys, expected,
            "externalApis must follow the registry, not a hand-written subset -- this is exactly \
             how github and leetcode ended up being the only two keys"
        );
        // Every value is a number, so a consumer can sum them without finding a null.
        for (key, value) in object {
            assert!(value.is_u64(), "{key} is not a number: {value}");
        }
    }
}
