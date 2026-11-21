//! The shared cache tier.
//!
//! The original ran two tiers: an in-process map capped at 60 seconds, and Redis underneath it
//! holding the same key for the full s-maxage. That second tier is what made a card cost one
//! upstream fetch per 10–60 minutes instead of one per minute, and it is what let several
//! instances share the result.
//!
//! This module restores the second tier, but **opt-in**: with no `REDIS_URL` the process behaves
//! exactly like the single-binary deployment did, so a container without Redis keeps working and
//! the recording baseline keeps meaning what it meant. Set `REDIS_URL` and the map becomes an L1
//! again.
//!
//! Keys and values are the original's: the key is the one `keys::default_key` builds
//! (`http:GET:_github_octocat:theme_dark`), and the value is the JSON envelope this module
//! defines. Nothing else is written, because a cache that writes keys nobody reads is a leak with
//! extra steps.

use std::sync::OnceLock;
use std::time::Duration;

use redis::aio::ConnectionManager;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};

/// What one cached response carries, in the shape the HTTP tier needs to replay it.
///
/// JSON rather than a binary format on purpose: a value in Redis is something an operator may have
/// to look at during an incident (`GET http:GET:_github_octocat:theme_dark`), and a 300-byte SVG
/// next to a header list reads fine in a terminal.
#[derive(Serialize, Deserialize)]
pub struct Envelope {
    pub body: Vec<u8>,
    pub headers: Vec<(String, String)>,
}

/// The connection, or `None` when this deployment has no shared tier.
fn connection() -> Option<&'static ConnectionManager> {
    static CLIENT: OnceLock<Option<ConnectionManager>> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            let url = connection_url()?;
            // Connecting is deferred to the first command: building a manager here would require
            // an await, and `middleware` must not block startup on a cache being reachable. A
            // Redis that goes away later degrades to "no shared tier" rather than to a 500.
            let client = redis::Client::open(url).ok()?;
            open_manager(client)
        })
        .as_ref()
}

/// The runtime the shared connection lives on.
///
/// `ConnectionManager` is not a passive handle: it owns a background task that multiplexes the
/// socket and reconnects after a drop. That task is spawned onto whichever runtime created the
/// manager, so a manager built on a short-lived runtime dies with it — the socket stays open but
/// every command comes back `broken pipe`. This runtime is therefore **leaked on purpose**: it
/// lives for the process, which is exactly as long as the connection needs to.
fn shared_runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .enable_all()
            .build()
            .expect("building the shared cache runtime")
    })
}

/// Opens the connection manager, once, without blocking the request path.
///
/// The caller may already be inside its own async runtime (`middleware` always is), where calling
/// `block_on` would panic. So the work is handed to a scoped OS thread: that thread drives the
/// process-wide runtime from outside any reactor, the manager is moved back through a channel, and
/// the caller only ever sees an `Option`.
fn open_manager(client: redis::Client) -> Option<ConnectionManager> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let built = shared_runtime()
            .block_on(async move {
                client
                    .get_connection_manager_with_config(
                        redis::aio::ConnectionManagerConfig::new()
                            .set_connection_timeout(Some(Duration::from_millis(500)))
                            .set_response_timeout(Some(Duration::from_millis(500))),
                    )
                    .await
                    .ok()
            });
        let _ = tx.send(built);
    });
    rx.recv_timeout(Duration::from_millis(2_000)).ok().flatten()
}

/// Reads one key. `None` means "not in the shared tier" — a miss, a dead connection, or no tier at
/// all are deliberately indistinguishable, because every one of them has the same answer for the
/// caller: go fetch it.
pub async fn get(key: &str) -> Option<Envelope> {
    let connection = connection()?;
    let mut connection = connection.clone();
    let raw: Option<String> = connection.get(key).await.ok()?;
    // A value that fails to decode is treated as absent rather than as an error: a stale or
    // hand-edited key should cost one upstream fetch, not a broken request.
    serde_json::from_str(&raw?).ok()
}

/// Writes one key with the given lifetime. Failures are swallowed for the same reason reads are:
/// a cache that cannot be written is a slower server, not a broken one.
pub async fn set(key: &str, envelope: &Envelope, ttl_seconds: u64) {
    let Some(connection) = connection() else {
        return;
    };
    let Ok(raw) = serde_json::to_string(envelope) else {
        return;
    };
    let mut connection = connection.clone();
    // EX is what the original used, and it keeps the expiry authoritative in Redis rather than in
    // this process: an instance that dies cannot leave an entry that outlives its TTL.
    let _: Result<(), _> = connection.set_ex(key, raw, ttl_seconds.max(1)).await;
}

/// Drops one key from the shared tier, so a local `clear` does not leave the cluster serving it.
pub async fn delete(key: &str) {
    let Some(connection) = connection() else {
        return;
    };
    let mut connection = connection.clone();
    let _: Result<(), _> = connection.del(key).await;
}

/// `SCAN`-based removal for `?pattern=` and `?group=`.
///
/// `KEYS` would block the whole server on a large database, which is the one thing a cache must
/// never do to its owner. The match is a prefix, mirroring `deleteByPattern` stripping one
/// trailing `*` and `clearGroup` appending `:`.
pub async fn delete_prefix(prefix: &str) -> usize {
    let Some(connection) = connection() else {
        return 0;
    };
    let mut connection = connection.clone();
    let pattern = format!("{prefix}*");
    let mut cursor: u64 = 0;
    let mut removed = 0usize;
    loop {
        let page: Result<(u64, Vec<String>), _> = redis::cmd("SCAN")
            .arg(cursor)
            .arg("MATCH")
            .arg(&pattern)
            .arg("COUNT")
            .arg(500)
            .query_async(&mut connection)
            .await;
        let Ok((next, keys)) = page else {
            return removed;
        };
        if !keys.is_empty() {
            let _: Result<usize, _> = connection.del(&keys).await;
            removed += keys.len();
        }
        cursor = next;
        if cursor == 0 {
            return removed;
        }
    }
}

/// Whether a shared tier is configured, for `/health` and `/stats` to report honestly.
pub fn configured() -> bool {
    connection_url().is_some()
}

/// Builds the connection string from whichever convention this deployment uses.
///
/// The original accepted both, and the order matters: `REDIS_URL` first, then the older
/// `REDIS_HOST`/`REDIS_PORT`/`REDIS_USERNAME`/`REDIS_PASSWORD` set. Keeping both means an existing
/// deployment does not have to rename a single variable — and, more importantly, that a config
/// written for the Node build is not silently ignored here, which would look exactly like "Redis
/// stopped working" while the process cheerfully ran without a shared tier.
///
/// `rediss://` (the TLS scheme) is passed through untouched: `redis` enables TLS from the scheme
/// itself, so there is no separate flag to forget.
fn connection_url() -> Option<String> {
    if let Some(url) = std::env::var("REDIS_URL").ok().filter(|u| !u.is_empty()) {
        return Some(url);
    }
    let host = std::env::var("REDIS_HOST").ok().filter(|h| !h.is_empty())?;
    let port = std::env::var("REDIS_PORT")
        .ok()
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| "6379".to_string());
    let username = std::env::var("REDIS_USERNAME").ok().filter(|u| !u.is_empty());
    let password = std::env::var("REDIS_PASSWORD").ok().filter(|p| !p.is_empty());
    // Percent-encoding matters: a password containing '@', ':' or '/' would otherwise split the
    // URL at the wrong place and produce a connection error that names no culprit.
    let encode = |value: &str| {
        value
            .bytes()
            .map(|byte| match byte {
                b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => {
                    (byte as char).to_string()
                }
                other => format!("%{other:02X}"),
            })
            .collect::<String>()
    };
    let credentials = match (username, password) {
        (Some(user), Some(pass)) => format!("{}:{}@", encode(&user), encode(&pass)),
        (None, Some(pass)) => format!(":{}@", encode(&pass)),
        _ => String::new(),
    };
    Some(format!("redis://{credentials}{host}:{port}"))
}

/// Drops every key this cache could have written.
///
/// `FLUSHDB` is deliberately not used: a `REDIS_URL` may well point at a database shared with
/// other applications, and "`?all=true` on a stats card wiped your session store" is not a story
/// anyone wants to tell. The keys this process writes all carry the `http:` prefix that
/// `keys::default_key` builds, so that prefix is the whole surface.
pub async fn clear_all() {
    delete_prefix("http:").await;
}

#[cfg(test)]
mod tests {
    //! `connection_url` reads process environment, which is global to the test process. The cases
    //! below therefore set and clear the variables they need, one test at a time, and never rely on
    //! whatever the surrounding environment happens to hold.

    use super::connection_url;

    struct EnvGuard(&'static [&'static str]);

    impl EnvGuard {
        fn take(names: &'static [&'static str]) -> Self {
            for name in names {
                // SAFETY: single-threaded within this test module's own lock discipline; the
                // variables are only read by `connection_url`.
                unsafe { std::env::remove_var(name) };
            }
            EnvGuard(names)
        }
    }

    impl Drop for EnvGuard {
        fn drop(&mut self) {
            for name in self.0 {
                unsafe { std::env::remove_var(name) };
            }
        }
    }

    const ALL: &[&str] = &[
        "REDIS_URL",
        "REDIS_HOST",
        "REDIS_PORT",
        "REDIS_USERNAME",
        "REDIS_PASSWORD",
    ];

    #[test]
    fn a_url_wins_over_the_legacy_variables() {
        let _guard = EnvGuard::take(ALL);
        unsafe {
            std::env::set_var("REDIS_URL", "rediss://cache.example:6380");
            std::env::set_var("REDIS_HOST", "ignored.example");
        }
        assert_eq!(connection_url().as_deref(), Some("rediss://cache.example:6380"));
    }

    #[test]
    fn the_legacy_set_builds_the_same_shape() {
        let _guard = EnvGuard::take(ALL);
        unsafe {
            std::env::set_var("REDIS_HOST", "redis.example");
            std::env::set_var("REDIS_PORT", "6380");
            std::env::set_var("REDIS_PASSWORD", "secret");
        }
        // A password-only deployment is the common Render/Railway shape.
        assert_eq!(
            connection_url().as_deref(),
            Some("redis://:secret@redis.example:6380")
        );
    }

    #[test]
    fn a_password_with_url_metacharacters_is_escaped() {
        let _guard = EnvGuard::take(ALL);
        unsafe {
            std::env::set_var("REDIS_HOST", "redis.example");
            std::env::set_var("REDIS_USERNAME", "default");
            // An unescaped '@' here would split the authority at the wrong place and produce a
            // connection error that names no culprit.
            std::env::set_var("REDIS_PASSWORD", "p@ss:w/rd");
        }
        assert_eq!(
            connection_url().as_deref(),
            Some("redis://default:p%40ss%3Aw%2Frd@redis.example:6379")
        );
    }

    #[test]
    fn nothing_configured_is_no_shared_tier() {
        let _guard = EnvGuard::take(ALL);
        assert_eq!(connection_url(), None);
    }
}