//! The shared tier, driven against a Redis that lives in this test process.
//!
//! remote.rs shipped with four tests, all of them about parsing REDIS_URL / REDIS_HOST into a
//! connection string. Nothing ever opened a socket: get, set, delete, delete_prefix and clear_all
//! -- five async functions in a 319-line module -- had no coverage at all, and the 111-case
//! behaviour gate never turns the shared tier on, so nothing else exercised them either.
//!
//! A real redis-server would make these tests unrunnable in CI, which has no Redis service and is
//! not getting one for a cache tier a deployment may not even use. So this file speaks the wire
//! protocol instead. It is not a Redis emulator: it implements exactly the commands remote.rs
//! sends, and it can be asked afterwards what those commands were, because for a cache client the
//! command on the wire is the contract. Where this fake and the real server would disagree the
//! tests would fail loudly here rather than pretend to pass.
//!
//! remote::connection() memoises the manager in a OnceLock, so the tier is configured once per
//! process and never again. Every test therefore starts by calling fake(), which starts the server
//! and sets REDIS_URL under a single guarded initialisation: whichever test runs first binds the
//! address, and the rest share it.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use app::frontdoor::remote::{self, Envelope};

/// One stored value, with the expiry Redis itself would enforce.
struct Entry {
    value: String,
    expires_at: Option<Instant>,
    /// Insertion order, used as the SCAN cursor. Deletions must not renumber the survivors: a
    /// cursor that means "the Nth key in sorted order" skips entries as soon as an earlier page is
    /// deleted, which is a property of the fake and not of the code under test.
    seq: u64,
}

fn next_seq() -> u64 {
    static SEQ: AtomicU64 = AtomicU64::new(1);
    SEQ.fetch_add(1, Ordering::Relaxed)
}

type Store = Arc<Mutex<HashMap<String, Entry>>>;

/// Every command received, in order. The assertions about EX and about SCAN paging read this.
type Log = Arc<Mutex<Vec<Vec<String>>>>;

struct Fake {
    store: Store,
    log: Log,
    tag: String,
}

/// The process-wide fake: one listener, one store, one configuration of REDIS_URL.
fn fake() -> &'static Fake {
    static FAKE: OnceLock<Fake> = OnceLock::new();
    FAKE.get_or_init(|| {
        let store: Store = Arc::new(Mutex::new(HashMap::new()));
        let log: Log = Arc::new(Mutex::new(Vec::new()));
        // Port 0 lets the OS pick, so parallel test binaries cannot collide.
        let listener = TcpListener::bind("127.0.0.1:0").expect("a loopback listener");
        let address = listener.local_addr().expect("a bound address");
        let server_store = Arc::clone(&store);
        let server_log = Arc::clone(&log);
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let store = Arc::clone(&server_store);
                let log = Arc::clone(&server_log);
                std::thread::spawn(move || serve(stream, store, log));
            }
        });
        // SAFETY: this runs inside get_or_init, before any test in this binary can reach remote,
        // and REDIS_URL is read only by that module.
        unsafe { std::env::set_var("REDIS_URL", format!("redis://127.0.0.1:{}", address.port())) };
        Fake { store, log, tag: address.port().to_string() }
    })
}

impl Fake {
    fn commands(&self) -> Vec<Vec<String>> {
        self.log.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).clone()
    }

    /// Writes a value behind remote's back, to stand in for a stale or hand-edited key.
    fn put_raw(&self, key: &str, value: &str) {
        self.store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .insert(key.to_string(), Entry { value: value.to_string(), expires_at: None, seq: next_seq() });
    }

    fn keys(&self) -> Vec<String> {
        let mut keys: Vec<String> = self
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .keys()
            .cloned()
            .collect();
        keys.sort();
        keys
    }

    /// A key no other test in this binary will use, so tests cannot inherit each other's entries.
    fn unique(&self, label: &str) -> String {
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        format!("http:{}:{}-{}-{n}", label, self.tag, label.len())
    }
}

fn blocked_on<F: std::future::Future>(future: F) -> F::Output {
    tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("test runtime")
        .block_on(future)
}

fn envelope(body: &str) -> Envelope {
    Envelope {
        body: body.as_bytes().to_vec(),
        headers: vec![("content-type".to_string(), "image/svg+xml".to_string())],
    }
}

/// Answers one connection until the client hangs up.
fn serve(stream: TcpStream, store: Store, log: Log) {
    let mut reader = BufReader::new(stream.try_clone().expect("a clone of the socket"));
    let mut writer = stream;
    loop {
        let Some(command) = read_command(&mut reader) else {
            return;
        };
        if command.is_empty() {
            continue;
        }
        log.lock().unwrap_or_else(|poisoned| poisoned.into_inner()).push(command.clone());
        let reply = dispatch(&command, &store);
        if writer.write_all(&reply).is_err() || writer.flush().is_err() {
            return;
        }
    }
}

/// Applies one command and returns the bytes to send back.
fn dispatch(command: &[String], store: &Store) -> Vec<u8> {
    let verb = command[0].to_ascii_uppercase();
    let mut entries = store.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    // Reading an expired key has to behave like a miss, exactly as Redis would.
    entries.retain(|_, entry| entry.expires_at.is_none_or(|deadline| deadline > Instant::now()));
    match verb.as_str() {
        // The connection setup. redis-rs announces itself and may negotiate a protocol before the
        // first real command; answering +OK to those keeps this a cache test, not a protocol test.
        "HELLO" | "CLIENT" | "PING" | "AUTH" | "SELECT" => ok(),
        "GET" => match entries.get(&command[1]) {
            Some(entry) => bulk(Some(entry.value.as_bytes())),
            None => bulk(None),
        },
        // set_ex lands here as SETEX (key ttl value) on redis-rs 1.8; the SET ... EX form is the
        // same command spelled the other way, and older or newer clients pick either.
        "SETEX" => {
            let seconds: u64 = command[2].parse().unwrap_or(0);
            let expires_at = Instant::now() + Duration::from_secs(seconds);
            entries.insert(
                command[1].clone(),
                Entry { value: command[3].clone(), expires_at: Some(expires_at), seq: next_seq() },
            );
            ok()
        }
        "SET" => {
            // SET key value EX n -- accepted as well, so this fake is not pinned to one client.
            let mut expires_at = None;
            let mut index = 3;
            while index + 1 < command.len() {
                if command[index].eq_ignore_ascii_case("EX") {
                    let seconds: u64 = command[index + 1].parse().unwrap_or(0);
                    expires_at = Some(Instant::now() + Duration::from_secs(seconds));
                }
                index += 2;
            }
            entries.insert(
                command[1].clone(),
                Entry { value: command[2].clone(), expires_at, seq: next_seq() },
            );
            ok()
        }
        "DEL" => {
            let mut removed = 0;
            for key in &command[1..] {
                if entries.remove(key).is_some() {
                    removed += 1;
                }
            }
            format!(":{removed}\r\n").into_bytes()
        }
        "SCAN" => {
            // The only shape remote.rs sends: SCAN <cursor> MATCH <pattern> COUNT <n>. The cursor is
            // an index into the sorted key list, so a second page is genuinely reachable.
            let cursor: usize = command[1].parse().unwrap_or(0);
            let mut pattern = String::from("*");
            let mut count = 10usize;
            let mut index = 2;
            while index + 1 < command.len() {
                if command[index].eq_ignore_ascii_case("MATCH") {
                    pattern = command[index + 1].clone();
                } else if command[index].eq_ignore_ascii_case("COUNT") {
                    count = command[index + 1].parse().unwrap_or(10);
                }
                index += 2;
            }
            // The cursor is the highest sequence number already handed out, the way Redis' cursor
            // is a position in the keyspace rather than an offset into a list: deleting an earlier
            // page must not shift the rest.
            let cursor = cursor as u64;
            let mut matched: Vec<(u64, String)> = entries
                .iter()
                .filter(|(key, entry)| entry.seq > cursor && glob(key, &pattern))
                .map(|(key, entry)| (entry.seq, key.clone()))
                .collect();
            matched.sort();
            let page: Vec<(u64, String)> = matched.into_iter().take(count).collect();
            let next = if page.len() < count { 0 } else { page.last().map(|(seq, _)| *seq).unwrap_or(0) };
            let page: Vec<String> = page.into_iter().map(|(_, key)| key).collect();
            let mut out = b"*2\r\n".to_vec();
            out.extend(bulk(Some(next.to_string().as_bytes())));
            out.extend(format!("*{}\r\n", page.len()).into_bytes());
            for key in &page {
                out.extend(bulk(Some(key.as_bytes())));
            }
            out
        }
        other => format!("-ERR unknown command '{}'\r\n", other).into_bytes(),
    }
}

fn ok() -> Vec<u8> {
    b"+OK\r\n".to_vec()
}

/// Redis glob matching, for the subset the tests use: '*' and '?'.
fn glob(value: &str, pattern: &str) -> bool {
    fn walk(value: &[u8], pattern: &[u8]) -> bool {
        match pattern.split_first() {
            None => value.is_empty(),
            Some((&b'*', rest)) => (0..=value.len()).any(|skip| walk(&value[skip..], rest)),
            Some((&b'?', rest)) => !value.is_empty() && walk(&value[1..], rest),
            Some((literal, rest)) => value.first() == Some(literal) && walk(&value[1..], rest),
        }
    }
    walk(value.as_bytes(), pattern.as_bytes())
}

fn bulk(payload: Option<&[u8]>) -> Vec<u8> {
    match payload {
        None => b"$-1\r\n".to_vec(),
        Some(bytes) => {
            let mut framed = format!("{}", bytes.len()).into_bytes();
            framed.insert(0, b'$');
            framed.extend_from_slice(b"\r\n");
            framed.extend_from_slice(bytes);
            framed.extend_from_slice(b"\r\n");
            framed
        }
    }
}

/// Reads one request. None means the peer closed the connection.
fn read_command(reader: &mut impl BufRead) -> Option<Vec<String>> {
    let header = read_line(reader)?;
    // Some clients send inline commands; redis-rs uses arrays, but tolerating both costs three
    // lines and turns a protocol surprise into a readable test failure.
    let Some(count) = header.strip_prefix('*') else {
        return Some(header.split_whitespace().map(str::to_string).collect());
    };
    let count: usize = count.parse().ok()?;
    let mut parts = Vec::with_capacity(count);
    for _ in 0..count {
        let length = read_line(reader)?;
        let length: usize = length.strip_prefix('$')?.parse().ok()?;
        let mut payload = vec![0u8; length + 2];
        reader.read_exact(&mut payload).ok()?;
        payload.truncate(length);
        parts.push(String::from_utf8_lossy(&payload).to_string());
    }
    Some(parts)
}

fn read_line(reader: &mut impl BufRead) -> Option<String> {
    let mut line = String::new();
    if reader.read_line(&mut line).ok()? == 0 {
        return None;
    }
    Some(line.trim_end_matches(['\r', '\n']).to_string())
}

// ---------------------------------------------------------------------------------------------
// The tests
// ---------------------------------------------------------------------------------------------

#[test]
fn configuring_a_url_is_enough_to_have_a_shared_tier() {
    fake();
    assert!(remote::configured(), "REDIS_URL points at the fake, so the tier must report itself on");
}

#[test]
fn a_value_survives_a_round_trip_with_its_headers() {
    let fake = fake();
    let key = fake.unique("round-trip");
    let written = envelope("<svg><!-- round trip --></svg>");

    blocked_on(remote::set(&key, &written, 600));
    let read = blocked_on(remote::get(&key)).expect("the value that was just written");

    assert_eq!(read.body, written.body, "the body must come back byte for byte");
    assert_eq!(read.headers, written.headers, "the headers ride along with the body");
}

/// The write the client sent for this key, whichever way it spelled it. Filtering by key keeps
/// the assertion honest when tests run in parallel against the one shared server.
fn last_write(fake: &Fake, key: &str) -> Vec<String> {
    fake.commands()
        .into_iter()
        .rev()
        .find(|command| {
            let verb = command.first().map(String::as_str).unwrap_or_default();
            let writes = verb.eq_ignore_ascii_case("SET") || verb.eq_ignore_ascii_case("SETEX");
            writes && command.get(1).is_some_and(|written| written == key)
        })
        .unwrap_or_else(|| panic!("no write of {key} reached the server"))
}

/// The ttl a write carried. redis-rs 1.8 sends SETEX (key ttl value); the SET ... EX form means
/// the same thing, and the assertion should not care which one the client chose.
fn expiry_of(command: &[String]) -> Option<&str> {
    match command.first()?.to_ascii_uppercase().as_str() {
        "SETEX" => command.get(2).map(String::as_str),
        "SET" => {
            let index = command.iter().position(|word| word.eq_ignore_ascii_case("EX"))?;
            command.get(index + 1).map(String::as_str)
        }
        _ => None,
    }
}

#[test]
fn a_set_carries_its_expiry_because_only_redis_knows_the_time() {
    let fake = fake();
    let key = fake.unique("expiry");

    blocked_on(remote::set(&key, &envelope("x"), 600));

    let command = last_write(fake, &key);
    assert_eq!(command[1], key, "it wrote the key it was given: {command:?}");
    assert_eq!(
        expiry_of(&command),
        Some("600"),
        "a shared cache entry without an expiry is a leak, and the caller's ttl must survive: {command:?}"
    );
}

#[test]
fn a_ttl_of_zero_is_still_a_ttl() {
    let fake = fake();
    let key = fake.unique("zero-ttl");

    // set_ex refuses nothing, and Redis rejects a zero expiry outright, so the floor has to exist
    // on this side of the socket.
    blocked_on(remote::set(&key, &envelope("x"), 0));

    let command = last_write(fake, &key);
    assert_eq!(expiry_of(&command), Some("1"), "zero is clamped to one second: {command:?}");
}

#[test]
fn a_key_that_was_never_written_is_absent_rather_than_an_error() {
    let fake = fake();
    let key = fake.unique("never-written");

    assert!(blocked_on(remote::get(&key)).is_none(), "a miss is None, not an error");
}

#[test]
fn a_corrupt_value_reads_as_a_miss_rather_than_a_panic() {
    let fake = fake();
    let key = fake.unique("corrupt");
    // Someone changed the envelope shape, or pointed two versions of the app at one database.
    fake.put_raw(&key, "{\"body\": \"not base64\", \"headers\": 3}");

    assert!(blocked_on(remote::get(&key)).is_none(), "an undecodable entry is a miss, so the next render fills it");
}

#[test]
fn delete_removes_one_key_and_leaves_its_neighbours() {
    let fake = fake();
    let target = fake.unique("delete-target");
    let neighbour = fake.unique("delete-neighbour");
    blocked_on(remote::set(&target, &envelope("a"), 600));
    blocked_on(remote::set(&neighbour, &envelope("b"), 600));

    blocked_on(remote::delete(&target));

    assert!(blocked_on(remote::get(&target)).is_none(), "the deleted key is gone");
    assert!(blocked_on(remote::get(&neighbour)).is_some(), "delete must not sweep the whole tier");
}

#[test]
fn delete_prefix_removes_the_group_and_nothing_else() {
    let fake = fake();
    let group = fake.unique("group");
    let inside = [format!("{group}:one"), format!("{group}:two")];
    let outside = fake.unique("outside");

    for key in &inside {
        blocked_on(remote::set(key, &envelope("x"), 600));
    }
    blocked_on(remote::set(&outside, &envelope("y"), 600));

    let removed = blocked_on(remote::delete_prefix(&format!("{group}:")));

    assert_eq!(removed, 2, "both members of the group are accounted for");
    for key in &inside {
        assert!(blocked_on(remote::get(key)).is_none(), "{key} should be gone");
    }
    assert!(blocked_on(remote::get(&outside)).is_some(), "a prefix delete must not touch another group");
}

#[test]
fn a_prefix_that_matches_nothing_is_a_quiet_zero() {
    let fake = fake();
    let untouched = fake.unique("untouched");
    blocked_on(remote::set(&untouched, &envelope("x"), 600));

    let removed = blocked_on(remote::delete_prefix(&format!("{}-no-such-group:", untouched)));

    assert_eq!(removed, 0, "nothing matched, so nothing was deleted");
    assert!(blocked_on(remote::get(&untouched)).is_some(), "and the neighbour survived");
}

#[test]
fn delete_prefix_walks_every_page_the_server_hands_back() {
    let fake = fake();
    // The COUNT in remote::delete_prefix is 500, so a group larger than that is the only way to
    // reach the second page. Writing them straight into the store keeps the test fast.
    let group = fake.unique("paged");
    let total = 520;
    for index in 0..total {
        fake.put_raw(&format!("{group}:{index:04}"), "{\"body\":[],\"headers\":[]}");
    }
    let scoped_before = fake.keys().iter().filter(|key| key.starts_with(&group)).count();
    assert_eq!(scoped_before, total, "the fixture is in place");

    let removed = blocked_on(remote::delete_prefix(&format!("{group}:")));

    // Scoped to this group's pattern: other tests delete other prefixes concurrently.
    let scans: Vec<Vec<String>> = fake
        .commands()
        .into_iter()
        .filter(|command| {
            command.first().is_some_and(|word| word.eq_ignore_ascii_case("SCAN"))
                && command.iter().any(|word| word.contains(&group))
        })
        .collect();
    assert!(
        scans.len() >= 2,
        "a group bigger than one page must cost more than one SCAN, got {}: {scans:?}",
        scans.len()
    );
    for command in &scans {
        assert!(command.iter().any(|word| word == "COUNT"), "paging keeps its bound: {command:?}");
    }
    // The contract is "this group is gone", not "some of it went away": a loop that stops after
    // the first page leaves the tail behind and nothing else notices.
    let survivors = fake.keys().iter().filter(|key| key.starts_with(&group)).count();
    assert_eq!(survivors, 0, "a prefix delete must not stop at the first page: {survivors} keys left");
    assert_eq!(removed, total, "every key it deleted and every key it left must add up: removed={removed}");
}



/// The L1 ceiling is decided by whether this process has a shared tier, and this is the only
/// test file where `remote::configured()` answers true for real: `fake()` sets `REDIS_URL` before
/// anything else runs. Without this case the wiring `set` -> `configured()` -> ceiling is only
/// exercised on its `false` side, and a port that forgot to ask would look fully covered.
#[test]
fn the_l1_ceiling_drops_to_a_minute_once_a_shared_tier_exists() {
    let fake = fake();
    let key = fake.unique("l1-ceiling");
    // A card's own TTL: 3600 seconds. With nothing behind L1 that is what it keeps; with the
    // shared tier present L1 may only hold it for the staleness window the original bounded.
    app::frontdoor::cache::set(&key, b"body".to_vec(), Vec::new(), 3600);
    let lifetime =
        app::frontdoor::cache::lifetime_ms_for_tests(&key).expect("the entry must be stored");
    assert!(
        lifetime <= 60_000,
        "with a shared tier an L1 entry may live 60s, got {lifetime}ms"
    );
    // The other direction: the ceiling must not clamp everything to zero, or L1 would never hit.
    assert!(
        lifetime > 50_000,
        "an L1 entry kept only {lifetime}ms, the ceiling is too tight"
    );
}