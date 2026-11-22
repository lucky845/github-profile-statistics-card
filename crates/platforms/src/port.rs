//! The Rust port of src/services/platforms/.
//!
//! Each function reproduces the recorded JS behavior byte for byte: the gallery markup is
//! assembled from the same fixed entry table and the same four-character HTML escape, and the
//! health counters keep a JS Map's insertion order (serde_json's preserve_order) so that a
//! snapshot serializes with the keys in the order the original first assigned them.

#![forbid(unsafe_code)]

use std::sync::{Mutex, OnceLock};

use serde_json::{Map, Value, json};

/// One row of the gallery: the platform, its heading, route segment, sample user, extra query
/// string and the reserved card height.
///
/// The rows are supplied by the caller rather than kept here. The platform list is owned by
/// `frontdoor::registry` — it has to be, because a row carries the platform's validator and card
/// function, which are app-crate items. Holding a copy of the list in this crate is what let the
/// gallery and the 404 handler disagree about whether juejin existed.
#[derive(Clone, Copy)]
pub struct GalleryEntry {
    pub title: &'static str,
    pub path: &'static str,
    pub sample: &'static str,
    pub extra_query: &'static str,
    pub height: u32,
}

/// The four characters escapeHtml replaces, & first so nothing is escaped twice.
fn escape_html(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
    out
}

/// encodeURIComponent: everything but the unreserved set becomes an upper-case %XX of the UTF-8
/// bytes. Rust strings cannot hold lone surrogates, so the URIError path is unreachable.
fn encode_uri_component(s: &str) -> Result<String, String> {
    let mut out = String::with_capacity(s.len());
    for byte in s.bytes() {
        let keep = byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | 0x27 | b'(' | b')'
            );
        if keep {
            out.push(byte as char);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    Ok(out)
}

/// Port of renderGallery (src/services/platforms/gallery.ts:36).
///
/// `entries` is the caller's platform list: the app crate derives it from its registry, so a
/// platform added there appears in the gallery without a second edit.
pub fn render_gallery(
    base_url: String,
    theme: Option<String>,
    entries: &[GalleryEntry],
) -> Result<String, String> {
    // theme = 'light' is a default parameter, so only an omitted argument falls back; the bridge
    // hands undefined over as None.
    let theme = theme.unwrap_or_else(|| "light".to_string());
    let encoded_theme = encode_uri_component(&theme)?;

    // Every entry has a registered source, so the filtered list is never empty; the branch stays
    // to keep the original's early return.
    if entries.is_empty() {
        return Ok(String::new());
    }

    let mut cards = String::new();
    for (i, e) in entries.iter().enumerate() {
        let url = format!(
            "{}/{}/{}?theme={}{}",
            base_url, e.path, e.sample, encoded_theme, e.extra_query
        );
        let markdown = format!("![]({url})");
        let id = format!("code-{i}");
        let title = escape_html(e.title);
        cards.push_str(&format!(
            r#"
      <figure class="card">
        <figcaption>{title}</figcaption>
        <img src="{url}" alt="{title}示例卡片" height="{height}" loading="lazy">
        <div class="copy-row">
          <code id="{id}">{markdown}</code>
          <button class="copy-btn" data-target="{id}" type="button">复制</button>
        </div>
      </figure>"#,
            url = escape_html(&url),
            height = e.height,
            markdown = escape_html(&markdown),
        ));
    }

    Ok(format!(
        r#"<section class="gallery">
    <h2>卡片预览</h2>
    <div class="gallery-grid">{cards}</div>
  </section>"#
    ))
}

/// The process-wide counter map. A JS Map keeps insertion order, which a snapshot turns into
/// object key order, so the map uses serde_json's ordered representation.
fn stats() -> &'static Mutex<Map<String, Value>> {
    static STATS: OnceLock<Mutex<Map<String, Value>>> = OnceLock::new();
    STATS.get_or_init(|| Mutex::new(Map::new()))
}

/// ensure: a new platform starts at { ok: 0, fail: 0 } with exactly those two keys.
fn ensure<'m>(map: &'m mut Map<String, Value>, platform: &str) -> &'m mut Map<String, Value> {
    if !map.contains_key(platform) {
        let mut entry = Map::new();
        entry.insert("ok".to_string(), json!(0));
        entry.insert("fail".to_string(), json!(0));
        map.insert(platform.to_string(), Value::Object(entry));
    }
    map.get_mut(platform)
        .and_then(Value::as_object_mut)
        .expect("the entry was just inserted")
}

fn counter(entry: &Map<String, Value>, key: &str) -> u64 {
    entry.get(key).and_then(Value::as_u64).unwrap_or(0)
}

/// Date.now() in milliseconds. RUST_ANYTHING_WTS_OVERRIDE (seconds) pins the timestamp so
/// recorded cases replay deterministically; a file next to the crate does the same for gate,
/// whose replay process may have any cwd. Production ships neither and uses the real clock.
fn now_ms() -> u64 {
    if let Ok(v) = std::env::var("RUST_ANYTHING_WTS_OVERRIDE")
        && let Ok(seconds) = v.parse::<f64>()
    {
        return (seconds * 1000.0) as u64;
    }
    let seam = concat!(env!("CARGO_MANIFEST_DIR"), "/.rust-anything-wts-override");
    if let Ok(v) = std::fs::read_to_string(seam)
        && let Ok(seconds) = v.trim().parse::<f64>()
    {
        return (seconds * 1000.0) as u64;
    }
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// Port of recordOk (src/services/platforms/health.ts:26).
pub fn record_ok(platform: String) -> Result<(), String> {
    let mut guard = stats().lock().unwrap_or_else(|e| e.into_inner());
    let entry = ensure(&mut guard, &platform);
    let ok = counter(entry, "ok") + 1;
    entry.insert("ok".to_string(), json!(ok));
    entry.insert("lastOkAt".to_string(), json!(now_ms()));
    Ok(())
}

/// Port of recordFail (src/services/platforms/health.ts:32).
pub fn record_fail(platform: String, reason: String) -> Result<(), String> {
    let mut guard = stats().lock().unwrap_or_else(|e| e.into_inner());
    let entry = ensure(&mut guard, &platform);
    let fail = counter(entry, "fail") + 1;
    entry.insert("fail".to_string(), json!(fail));
    entry.insert("lastError".to_string(), json!(reason));
    entry.insert("lastFailureAt".to_string(), json!(now_ms()));
    Ok(())
}

/// Port of snapshotHealth (src/services/platforms/health.ts:39): a shallow copy of every entry,
/// keyed in the map's iteration order.
pub fn snapshot_health() -> Result<Value, String> {
    let guard = stats().lock().unwrap_or_else(|e| e.into_inner());
    let mut out = Map::new();
    for (platform, entry) in guard.iter() {
        out.insert(platform.clone(), entry.clone());
    }
    Ok(Value::Object(out))
}

/// Port of resetHealth (src/services/platforms/health.ts:46).
pub fn reset_health() -> Result<(), String> {
    let mut guard = stats().lock().unwrap_or_else(|e| e.into_inner());
    guard.clear();
    Ok(())
}

/// Port of fail (src/services/platforms/types.ts:37). The reason is passed through untouched:
/// the original does not validate it, so neither does the port.
pub fn fail(reason: Value, message: String) -> Result<Value, String> {
    Ok(json!({
        "ok": false,
        "reason": reason,
        "message": message,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn escape_html_replaces_only_four_characters() {
        assert_eq!(escape_html("&"), "&amp;");
        assert_eq!(escape_html("<"), "&lt;");
        assert_eq!(escape_html(">"), "&gt;");
        assert_eq!(escape_html("\""), "&quot;");
        assert_eq!(escape_html("it's"), "it's");
        assert_eq!(escape_html("&amp;"), "&amp;amp;");
    }

    #[test]
    fn encode_uri_component_matches_js() {
        assert_eq!(
            encode_uri_component("Hello World").unwrap(),
            "Hello%20World"
        );
        assert_eq!(encode_uri_component("light").unwrap(), "light");
        assert_eq!(encode_uri_component("straße").unwrap(), "stra%C3%9Fe");
        assert_eq!(encode_uri_component("😀").unwrap(), "%F0%9F%98%80");
        assert_eq!(encode_uri_component("-_.!~*'()").unwrap(), "-_.!~*'()");
        assert_eq!(encode_uri_component("a&b=c").unwrap(), "a%26b%3Dc");
    }

    /// The app crate owns the real list; these rows only have to exercise the template.
    const TEST_ENTRIES: [GalleryEntry; 2] = [
        GalleryEntry {
            title: "GitHub 统计",
            path: "github",
            sample: "lucky845",
            extra_query: "",
            height: 200,
        },
        GalleryEntry {
            title: "哔哩哔哩统计",
            path: "bilibili",
            sample: "89389361",
            extra_query: "",
            height: 200,
        },
    ];

    #[test]
    fn gallery_markup_matches_the_original_template() {
        let html = render_gallery("http://x".to_string(), None, &TEST_ENTRIES).unwrap();
        assert!(html.starts_with("<section class=\"gallery\">\n    <h2>卡片预览</h2>\n    <div class=\"gallery-grid\">\n      <figure class=\"card\">"));
        assert!(html.ends_with("</figure></div>\n  </section>"));
        assert!(html.contains("<img src=\"http://x/github/lucky845?theme=light\" alt=\"GitHub 统计示例卡片\" height=\"200\" loading=\"lazy\">"));
        assert!(
            html.contains("<code id=\"code-1\">![](http://x/bilibili/89389361?theme=light)</code>")
        );
        assert_eq!(html.matches("<figure class=\"card\">").count(), 2);
    }

    /// The app crate's own table is the one that must keep &cn=true and its order; this only
    /// proves the extra query string reaches the URL through the HTML escape.
    #[test]
    fn an_extra_query_string_is_escaped_not_dropped() {
        const WITH_QUERY: [GalleryEntry; 1] = [GalleryEntry {
            title: "LeetCode 统计",
            path: "leetcode",
            sample: "lucky845",
            extra_query: "&cn=true",
            height: 200,
        }];
        let html = render_gallery("http://x".to_string(), None, &WITH_QUERY).unwrap();
        assert!(html.contains("http://x/leetcode/lucky845?theme=light&amp;cn=true"));
    }

    #[test]
    fn an_empty_entry_list_renders_nothing() {
        assert_eq!(
            render_gallery("http://x".to_string(), None, &[]).unwrap(),
            ""
        );
    }

    #[test]
    fn theme_is_percent_encoded() {
        let html = render_gallery("u".to_string(), Some("a b".to_string()), &TEST_ENTRIES).unwrap();
        assert!(html.contains("?theme=a%20b\""));
    }

    #[test]
    fn health_counters_keep_js_key_order() {
        // One test drives the whole lifecycle so the process-wide map is never raced.
        reset_health().unwrap();
        record_ok("github".to_string()).unwrap();
        record_ok("github".to_string()).unwrap();
        record_fail("github".to_string(), "UPSTREAM_ERROR: x".to_string()).unwrap();
        record_fail("csdn".to_string(), "boom".to_string()).unwrap();

        let snap = snapshot_health().unwrap();
        let keys: Vec<&String> = snap.as_object().unwrap().keys().collect();
        assert_eq!(keys, vec!["github", "csdn"]);

        let github = snap.get("github").unwrap().as_object().unwrap();
        let entry_keys: Vec<&String> = github.keys().collect();
        assert_eq!(
            entry_keys,
            vec!["ok", "fail", "lastOkAt", "lastError", "lastFailureAt"]
        );
        assert_eq!(github["ok"], json!(2));
        assert_eq!(github["fail"], json!(1));

        // A later success keeps lastOkAt in its original slot instead of moving it last.
        record_ok("github".to_string()).unwrap();
        let snap = snapshot_health().unwrap();
        let entry_keys: Vec<&String> = snap["github"].as_object().unwrap().keys().collect();
        assert_eq!(
            entry_keys,
            vec!["ok", "fail", "lastOkAt", "lastError", "lastFailureAt"]
        );

        reset_health().unwrap();
        assert_eq!(snapshot_health().unwrap(), json!({}));
    }

    #[test]
    fn failure_result_passes_the_reason_through() {
        let out = fail(json!("NOT_FOUND"), "nope".to_string()).unwrap();
        let keys: Vec<&String> = out.as_object().unwrap().keys().collect();
        assert_eq!(keys, vec!["ok", "reason", "message"]);
        assert_eq!(out["ok"], json!(false));
        assert_eq!(out["reason"], json!("NOT_FOUND"));

        // fail does not validate the reason, exactly like the original.
        let out = fail(Value::Null, "m".to_string()).unwrap();
        assert!(out["reason"].is_null());
        let out = fail(json!([1, 2]), "m".to_string()).unwrap();
        assert_eq!(out["reason"], json!([1, 2]));
    }
}
