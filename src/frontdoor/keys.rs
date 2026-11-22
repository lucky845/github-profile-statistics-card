//! The cache keys the original stamps on every answer.
//!
//! Two generators are in play. defaultKeyGenerator covers the app-level middleware and every
//! path no platform router claims; each platform router replaces the key with its own
//! prefix:id:theme once it matches. Both then pass through generateKey, which replaces every
//! character outside [a-zA-Z0-9_.-] with an underscore — that second pass is why / shows up
//! as _ in the recorded keys.
//!
//! A platform key travels to the client as a header, and Node writes headers as latin1: any code
//! point above U+00FF makes setHeader throw, the platform middleware swallows it, and the
//! app-level key survives. Code points in U+0080..=U+00FF encode fine as latin1 but decode back
//! as UTF-8 garbage, so each one lands as U+FFFD. Both effects are reproduced exactly.

/// Percent-decode the way decodeURIComponent does, keeping it lossy on malformed input rather
/// than throwing.
pub fn decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let hex = |b: u8| -> Option<u8> {
                match b {
                    b'0'..=b'9' => Some(b - b'0'),
                    b'a'..=b'f' => Some(b - b'a' + 10),
                    b'A'..=b'F' => Some(b - b'A' + 10),
                    _ => None,
                }
            };
            if let (Some(hi), Some(lo)) = (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                out.push(hi * 16 + lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// The reducers are JavaScript, so they walk UTF-16 code units, not code points: one underscore
/// replaces one unit, and a character outside the BMP (an emoji, say) is two units and therefore
/// two underscores. Counting chars here would shorten every recorded key with an emoji in it.
fn replace_units(part: &str, keep: impl Fn(char) -> bool) -> String {
    let mut out = String::with_capacity(part.len());
    for unit in part.encode_utf16() {
        match char::from_u32(u32::from(unit)) {
            Some(c) if keep(c) => out.push(c),
            _ => out.push('_'),
        }
    }
    out
}

/// The two reducers differ by one character, and it is not the one you would guess.
///
/// safePath uses /[^a-zA-Z0-9_.-/]/g — the hyphen sits between . and /, so it forms a code point
/// range rather than a literal, and the class is really "alphanumeric, underscore, dot, slash".
/// A hyphen in the path therefore becomes an underscore.
///
/// generateKey uses /[^a-zA-Z0-9_.-]/g — there the hyphen is last, so it is literal and the slash
/// is what gets replaced. Applying both in order is what turns /a-b/c into _a_b_c rather than
/// _a-b_c.
fn sanitize_path(part: &str) -> String {
    replace_units(part, |c| {
        c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '/')
    })
}

/// generateKey's reducer: alphanumeric, underscore, dot and hyphen survive.
fn sanitize_part(part: &str) -> String {
    replace_units(part, |c| {
        c.is_ascii_alphanumeric() || matches!(c, '_' | '.' | '-')
    })
}

/// CacheKeyGenerator.generateKey: prefix plus the sanitised parts joined with colons.
fn generate(prefix: &str, parts: &[String]) -> String {
    let safe: Vec<String> = parts.iter().map(|p| sanitize_part(p)).collect();
    format!("{prefix}:{}", safe.join(":"))
}

/// Orders query keys the way Array.prototype.sort does: by UTF-16 code unit.
fn js_order(a: &str, b: &str) -> std::cmp::Ordering {
    let left: Vec<u16> = a.encode_utf16().collect();
    let right: Vec<u16> = b.encode_utf16().collect();
    left.cmp(&right)
}

/// defaultKeyGenerator: method, path and the sorted query string.
pub fn default_key(method: &str, raw_path: &str, query: &[(String, String)]) -> String {
    let mut pairs: Vec<&(String, String)> = query.iter().collect();
    pairs.sort_by(|a, b| js_order(&a.0, &b.0));
    let query_string = pairs
        .iter()
        .map(|(k, v)| format!("{k}={v}"))
        .collect::<Vec<_>>()
        .join("&");
    let safe_path = sanitize_path(raw_path);
    generate("http", &[method.to_string(), safe_path, query_string])
}

/// The platform generators: raw prefix:id:theme with no sanitising, then the latin1 round trip
/// a response header performs. None when a code point above U+00FF would have thrown.
///
/// The separators differ by platform and that is not cosmetic: github, leetcode and csdn go
/// through CacheKeyGenerator, which joins with colons, while the juejin and bilibili routers
/// hand-build their key with underscores. Both end up in the same X-Cache-Key header, so both
/// take the same latin-1 trip.
pub fn platform_key(prefix: &str, id: &str, theme: &str) -> Option<String> {
    header_key(&format!("{prefix}:{id}:{theme}"))
}

/// The juejin and bilibili shape: `{platform}_{id}_{theme}`, still unsanitised.
pub fn underscore_key(prefix: &str, id: &str, theme: &str) -> Option<String> {
    header_key(&format!("{prefix}_{id}_{theme}"))
}

/// A header value holding text above U+00FF cannot be sent at all — Node's setHeader throws, and
/// the platform middleware's catch means the key is simply never set. Below that, each code point
/// travels as one byte: `é` is 0xE9 on the wire, which is why the recorded cases read it back as
/// U+FFFD (their reader is UTF-8) while a latin-1 client sees `é`.
///
/// So the key is kept one-char-per-byte, in the latin-1 alphabet: `headers::latin1_bytes` turns it
/// back into exactly the bytes the original writes. Decoding it to a Rust String first would send
/// U+FFFD as three UTF-8 bytes and change the header the client receives.
fn header_key(key: &str) -> Option<String> {
    if key.chars().any(|c| c as u32 > 0xFF) {
        return None;
    }
    Some(key.chars().map(|c| c as u32 as u8 as char).collect())
}

// The platform list used to live here as a const PLATFORMS array, with a platform_of that walked
// it. It moved to super::registry, which also carries each platform's validator, sanitizer and card
// function, so the mount list and the dispatch table can no longer disagree. Callers that only need
// the mount use registry::platform_of.

#[cfg(test)]
mod tests {
    use super::{platform_key, underscore_key};

    #[test]
    fn the_platform_key_keeps_its_separator_and_every_character() {
        assert_eq!(platform_key("github", "octocat", "dark").as_deref(), Some("github:octocat:dark"));
        // No sanitising: a space and a less-than sign reach the header as they are.
        assert_eq!(
            platform_key("github", "octo cat", "&lt;dark>").as_deref(),
            Some("github:octo cat:&lt;dark>")
        );
        assert_eq!(
            platform_key("github", "octocat", "[object Object]").as_deref(),
            Some("github:octocat:[object Object]")
        );
    }

    #[test]
    fn juejin_and_bilibili_join_with_underscores() {
        assert_eq!(underscore_key("juejin", "abc", "dark").as_deref(), Some("juejin_abc_dark"));
        assert_eq!(
            underscore_key("bilibili", "a b", "default").as_deref(),
            Some("bilibili_a b_default")
        );
        // The id keeps its case; these two routers never lowercase it.
        assert_eq!(underscore_key("juejin", "TestUser", "dark").as_deref(), Some("juejin_TestUser_dark"));
    }

    #[test]
    fn a_code_point_above_ff_has_no_header_at_all() {
        // Node's setHeader throws and the middleware's catch leaves the key unwritten, so the
        // caller falls back to the app-level key.
        assert_eq!(platform_key("github", "中", "default"), None);
        assert_eq!(underscore_key("juejin", "中", "default"), None);
    }

    #[test]
    fn below_ff_each_character_is_one_latin1_character() {
        // é must leave here as one char so that headers::latin1_bytes sends one byte; keeping the
        // original code point is what makes that round trip work.
        let key = platform_key("github", "héllo", "default").unwrap();
        assert_eq!(key, "github:héllo:default");
        assert_eq!(key.chars().count(), "github:héllo:default".chars().count());
        assert!(key.chars().all(|c| c as u32 <= 0xFF));
    }
}
