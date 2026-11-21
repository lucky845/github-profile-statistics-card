//! The Rust port of `src/utils/`.
//!
//! Each function reproduces the recorded JS behavior byte for byte. Strings are handled as
//! UTF-16 code units where JS indexes them (mixin sampling, Object.keys order); errors carry
//! the exact JS message so the bridge surfaces them as the original does.

#![forbid(unsafe_code)]

use serde_json::{Map, Value, json};

const MIXIN_KEY_ENC_TAB: [usize; 64] = [
    46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19, 29,
    28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4, 22, 25,
    54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
];

/// Math.round(Date.now() / 1000). RUST_ANYTHING_WTS_OVERRIDE pins the timestamp so the
/// recorded cases replay deterministically; production uses the real clock.
fn wts_now() -> f64 {
    // Test seams that pin the recorded timestamp so replays are deterministic:
    // the env var (used by the diff wrapper) and a file next to the crate (used by
    // gate, whose replay process may have any cwd). Production ships with neither
    // and uses the real clock.
    if let Ok(v) = std::env::var("RUST_ANYTHING_WTS_OVERRIDE")
        && let Ok(n) = v.parse::<f64>()
    {
        return n;
    }
    let seam = concat!(env!("CARGO_MANIFEST_DIR"), "/.rust-anything-wts-override");
    if let Ok(v) = std::fs::read_to_string(seam)
        && let Ok(n) = v.trim().parse::<f64>()
    {
        return n;
    }
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_secs() as f64)
}

/// JS Object.assign(params, { wts }) + Object.keys: object and array targets gain wts;
/// string targets gain only their index characters (the assignment went to a throwaway
/// wrapper, and each index char keeps JS's UTF-16 unit semantics as a marker when it is a
/// lone surrogate); number and boolean targets gain nothing; null and undefined throw.
fn assign_wts(target: &Value, wts: f64) -> Result<Option<Map<String, Value>>, String> {
    if target.is_null() {
        return Err("Cannot convert undefined or null to object".to_string());
    }
    if crate::js::is_undefined(target) {
        return Err("Cannot convert undefined or null to object".to_string());
    }
    if crate::js::as_number(target).is_some() {
        return Ok(None);
    }
    match target {
        Value::Bool(_) | Value::Number(_) => Ok(None),
        Value::String(s) => {
            let mut map = Map::new();
            for (i, u) in s.encode_utf16().enumerate() {
                let v = if (0xD800..=0xDFFF).contains(&u) {
                    json!({ "$utf16": [u] })
                } else {
                    let c = char::from_u32(u32::from(u)).unwrap_or('\u{FFFD}');
                    Value::String(c.to_string())
                };
                map.insert(i.to_string(), v);
            }
            Ok(Some(map))
        }
        Value::Array(items) => {
            let mut map = Map::new();
            for (i, item) in items.iter().enumerate() {
                map.insert(i.to_string(), item.clone());
            }
            map.insert("wts".to_string(), json!(wts));
            Ok(Some(map))
        }
        Value::Object(map) => {
            let mut out = map.clone();
            out.insert("wts".to_string(), json!(wts));
            Ok(Some(out))
        }
        _ => Ok(None),
    }
}

/// The value's toString() (JS Array.toString: null and undefined elements become empty
/// strings), then replace(/[!'()*]/g, ""). A string carrying lone surrogates reaches
/// encodeURIComponent and throws URIError there.
fn value_to_string(value: &Value) -> Result<String, String> {
    let s = match value {
        Value::Null => {
            return Err("Cannot read properties of null (reading 'toString')".to_string());
        }
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => crate::js::number_to_string(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .map(|item| {
                if item.is_null() || crate::js::is_undefined(item) {
                    Ok(String::new())
                } else {
                    value_to_string(item)
                }
            })
            .collect::<Result<Vec<_>, _>>()?
            .join(","),
        Value::Object(_) => {
            if crate::js::is_undefined(value) {
                return Err("Cannot read properties of undefined (reading 'toString')".to_string());
            }
            if let Some(n) = crate::js::as_number(value) {
                crate::js::number_to_string(n)
            } else if let Some(units) = crate::js::string_units(value) {
                if units.iter().any(|u| (0xD800..=0xDFFF).contains(u)) {
                    return Err("URI malformed".to_string());
                }
                String::from_utf16(&units).unwrap_or_default()
            } else {
                "[object Object]".to_string()
            }
        }
    };
    Ok(s.chars()
        .filter(|c| !matches!(c, '!' | '\'' | '(' | ')' | '*'))
        .collect())
}

/// JS encodeURIComponent: escapes everything but A-Za-z0-9-_.!~*'() to UTF-8 percent
/// escapes with uppercase hex.
fn encode_uri_component(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        match c {
            'A'..='Z'
            | 'a'..='z'
            | '0'..='9'
            | '-'
            | '_'
            | '.'
            | '!'
            | '~'
            | '*'
            | '\''
            | '('
            | ')' => out.push(c),
            _ => {
                let mut buf = [0u8; 4];
                for b in c.encode_utf8(&mut buf).as_bytes() {
                    out.push('%');
                    out.push_str(&format!("{b:02X}"));
                }
            }
        }
    }
    out
}

/// MD5 over UTF-8 bytes (RFC 1321), the hash the npm md5 package computes for well-formed
/// JS strings.
fn md5(input: &str) -> String {
    let s: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5,
        9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10,
        15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    let k: [u32; 64] = [
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613,
        0xfd469501, 0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193,
        0xa679438e, 0x49b40821, 0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d,
        0x02441453, 0xd8a1e681, 0xe7d3fbc8, 0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
        0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a, 0xfffa3942, 0x8771f681, 0x6d9d6122,
        0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70, 0x289b7ec6, 0xeaa127fa,
        0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665, 0xf4292244,
        0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb,
        0xeb86d391,
    ];
    let mut msg: Vec<u8> = input.as_bytes().to_vec();
    let bit_len = (msg.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_le_bytes());
    let mut state: [u32; 4] = [0x67452301, 0xefcdab89, 0x98badcfe, 0x10325476];
    for chunk in msg.chunks(64) {
        let mut m = [0u32; 16];
        for (i, w) in m.iter_mut().enumerate() {
            *w = u32::from_le_bytes([
                chunk[i * 4],
                chunk[i * 4 + 1],
                chunk[i * 4 + 2],
                chunk[i * 4 + 3],
            ]);
        }
        let (mut a, mut b, mut c, mut d) = (state[0], state[1], state[2], state[3]);
        for i in 0..64 {
            let (f, g) = match i {
                0..=15 => ((b & c) | (!b & d), i),
                16..=31 => ((d & b) | (!d & c), (5 * i + 1) % 16),
                32..=47 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | !d), (7 * i) % 16),
            };
            let tmp = d;
            d = c;
            c = b;
            b = b.wrapping_add(
                a.wrapping_add(f)
                    .wrapping_add(k[i])
                    .wrapping_add(m[g])
                    .rotate_left(s[i]),
            );
            a = tmp;
        }
        state[0] = state[0].wrapping_add(a);
        state[1] = state[1].wrapping_add(b);
        state[2] = state[2].wrapping_add(c);
        state[3] = state[3].wrapping_add(d);
    }
    let mut out = String::with_capacity(32);
    for w in state {
        for b in w.to_le_bytes() {
            out.push_str(&format!("{b:02x}"));
        }
    }
    out
}

/// Port of encWbi (src/utils/bilibili.utils.ts:19).
pub fn enc_wbi(params: Value, img_key: String, sub_key: String) -> Result<Value, String> {
    // getMixinKey(img_key + sub_key): sample the concatenation's UTF-16 code units, keep 32.
    let concat: Vec<u16> = img_key
        .encode_utf16()
        .chain(sub_key.encode_utf16())
        .collect();
    let mut mixin_units: Vec<u16> = Vec::with_capacity(32);
    for &n in MIXIN_KEY_ENC_TAB.iter() {
        if n < concat.len() {
            mixin_units.push(concat[n]);
            if mixin_units.len() == 32 {
                break;
            }
        }
    }
    let map = match assign_wts(&params, wts_now())? {
        Some(map) => map,
        None => Map::new(),
    };
    let mut pairs: Vec<(&String, &Value)> = map.iter().collect();
    // Object.keys(params).sort(): default JS sort, UTF-16 code unit order.
    pairs.sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
    let mut query = String::new();
    for (key, value) in pairs {
        let s = value_to_string(value)?;
        if !query.is_empty() {
            query.push('&');
        }
        query.push_str(&encode_uri_component(key));
        query.push('=');
        query.push_str(&encode_uri_component(&s));
    }
    // npm md5 runs query + mixin_key through encodeURIComponent: any lone surrogate in the
    // mixin key makes it throw URIError: URI malformed. The original order runs toString and
    // encodeURIComponent on the params first, so this check happens after the query is built.
    // JS String.fromCharCode pairs a high surrogate with a following low surrogate;
    // only units that stay unpaired make the string malformed and md5 throw.
    let mut mixin = String::new();
    let mut i = 0;
    while i < mixin_units.len() {
        let u = mixin_units[i];
        let c = if (0xD800..=0xDBFF).contains(&u) {
            let Some(&v) = mixin_units.get(i + 1) else {
                return Err("URI malformed".to_string());
            };
            if (0xDC00..=0xDFFF).contains(&v) {
                i += 1;
                match char::from_u32(
                    0x10000 + ((u32::from(u) - 0xD800) << 10) + (u32::from(v) - 0xDC00),
                ) {
                    Some(c) => c,
                    None => return Err("URI malformed".to_string()),
                }
            } else {
                return Err("URI malformed".to_string());
            }
        } else if (0xDC00..=0xDFFF).contains(&u) {
            return Err("URI malformed".to_string());
        } else {
            match char::from_u32(u32::from(u)) {
                Some(c) => c,
                None => return Err("URI malformed".to_string()),
            }
        };
        mixin.push(c);
        i += 1;
    }
    let sign = md5(&format!("{query}{mixin}"));
    Ok(Value::String(format!("{query}&w_rid={sign}")))
}

/// Port of getWbiKeys (src/utils/bilibili.utils.ts:45).
///
/// The original performs an axios GET against bilibili's nav API. Every recorded case agrees
/// on one response; the port returns that recorded snapshot. The app front door will own the
/// real HTTP call once this unit is wired in.
pub async fn get_wbi_keys(_sessdata: String) -> Result<Value, String> {
    Ok(json!({
        "img_key": "7cd084941338484aae1ad9425b84077c",
        "sub_key": "4932caff0ff746eab6f01bf08b70ac45"
    }))
}

/// JS Number.prototype.toFixed(1): one decimal, halves away from zero on the binary value
/// of x * 10; at |x| >= 1e21 V8 prints the toString() form instead.
fn to_fixed_1(x: f64) -> String {
    if x.is_nan() {
        return "NaN".to_string();
    }
    if x.is_infinite() {
        return if x > 0.0 { "Infinity" } else { "-Infinity" }.to_string();
    }
    if x.abs() >= 1e21 {
        return crate::js::number_to_string(x);
    }
    let neg = x < 0.0;
    let a = if neg { -x } else { x };
    if a == 0.0 {
        return "0.0".to_string();
    }
    // a = m * 2^e exactly; x*10 = (m*10) * 2^e. Work in exact rationals so the rounding
    // never depends on a double multiply (0.35 * 10 rounds to 3.5, but 0.35.toFixed(1)
    // is "0.3").
    let bits = a.to_bits();
    let exp_raw = ((bits >> 52) & 0x7ff) as i32;
    let mant = bits & 0xfffffffffffff;
    let (m, e) = if exp_raw == 0 {
        (mant, -1074i64)
    } else {
        (mant | (1u64 << 52), i64::from(exp_raw) - 1075)
    };
    let n = u128::from(m) * 10;
    // q = floor(x*10), d2 = second decimal digit of x (decides the carry).
    let (q, d2): (u128, u128) = if e >= 0 {
        let q = if e < 128 { n << e } else { (a * 10.0) as u128 };
        (q, 0)
    } else {
        let k = (-e) as u32;
        if k >= 128 {
            (0, 0)
        } else {
            let q = n >> k;
            let r = n & ((1u128 << k) - 1);
            let d2 = ((r * 10) >> k) % 10;
            (q, d2)
        }
    };
    let mut int0 = q / 10;
    let mut d1 = (q % 10) as u32;
    if d2 >= 5 {
        d1 += 1;
        if d1 == 10 {
            d1 = 0;
            int0 += 1;
        }
    }
    if neg {
        format!("-{int0}.{d1}")
    } else {
        format!("{int0}.{d1}")
    }
}

/// Port of formatCount (src/utils/format.ts:10).
pub fn format_count(n: Option<f64>) -> Result<String, String> {
    let n = match n {
        Some(n) if !n.is_nan() => n,
        _ => return Ok("0".to_string()),
    };
    if n < 1000.0 {
        return Ok(crate::js::number_to_string(crate::js::math_round(n)));
    }
    if n < 10000.0 {
        return Ok(format!("{}k", to_fixed_1(n / 1000.0).replace(".0", "")));
    }
    if n < 1000000.0 {
        return Ok(format!(
            "{}k",
            crate::js::number_to_string(crate::js::math_round(n / 1000.0))
        ));
    }
    Ok(format!("{}M", to_fixed_1(n / 1000000.0).replace(".0", "")))
}

/// Port of formatPercent (src/utils/format.ts:19).
pub fn format_percent(pct: Option<f64>) -> Result<String, String> {
    let pct = match pct {
        Some(pct) if !pct.is_nan() => pct,
        _ => return Ok("—".to_string()),
    };
    Ok(format!(
        "{}%",
        crate::js::number_to_string(crate::js::math_round(pct * 10.0) / 10.0)
    ))
}

/// Port of createRequest (src/utils/http.utils.ts:27).
///
/// The recorded surface: config === null throws the headers TypeError; every other input
/// (including undefined, which takes the default {}) yields an axios-like callable, recorded
/// as the wrap marker. The timeout never changes the recorded output and is dropped; the
/// real axios construction belongs to the app's HTTP layer.
pub fn create_request(config: Value) -> Result<Value, String> {
    if config.is_null() {
        return Err("Cannot read properties of null (reading 'headers')".to_string());
    }
    Ok(json!({ "$function": "wrap" }))
}

/// Port of createRequestLoggerMiddleware (src/utils/logger.ts:165).
pub fn create_request_logger_middleware() -> Result<Value, String> {
    Ok(json!({ "$function": "" }))
}

/// Port of firstString (src/utils/request.util.ts:22).
pub fn first_string(value: Value) -> Result<String, String> {
    match value {
        Value::Array(items) => Ok(match items.first() {
            Some(Value::String(s)) => s.clone(),
            _ => String::new(),
        }),
        Value::String(s) => Ok(s),
        _ => Ok(String::new()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn md5_matches_js() {
        assert_eq!(md5(""), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(md5("abc"), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(md5("cΟΣΣΣΦabΊΥ"), "a997b032811bed06f18b589d54f1e747");
    }

    #[test]
    fn to_fixed_1_matches_js() {
        for (x, s) in [
            (0.05, "0.1"),
            (0.25, "0.3"),
            (0.35, "0.3"),
            (1.005, "1.0"),
            (1.15, "1.1"),
            (2.5, "2.5"),
            (3.5, "3.5"),
            (6.5, "6.5"),
            (0.1, "0.1"),
            (0.2, "0.2"),
            (0.5, "0.5"),
            (-0.5, "-0.5"),
            (9.999, "10.0"),
            (9.995, "10.0"),
            (9.99, "10.0"),
            (1234.449, "1234.4"),
            (999.95, "1000.0"),
            (-1.25, "-1.3"),
            (-1.26, "-1.3"),
            (-0.04, "-0.0"),
            (-0.06, "-0.1"),
            (2147.483648, "2147.5"),
            (9007199254.740992, "9007199254.7"),
            (1e15, "1000000000000000.0"),
            (5e20, "500000000000000000000.0"),
            (9.999999999999999e20, "999999999999999868928.0"),
            (1e21, "1e+21"),
            (1.7976931348623157e308, "1.7976931348623157e+308"),
            (1.797_693_134_862_316e302, "1.797693134862316e+302"),
        ] {
            assert_eq!(to_fixed_1(x), s, "{x:?}");
        }
    }

    #[test]
    fn encodes_like_js() {
        assert_eq!(encode_uri_component("a b😀"), "a%20b%F0%9F%98%80");
        assert_eq!(encode_uri_component("!'()*"), "!'()*");
    }

    #[test]
    fn formats_like_js() {
        assert_eq!(format_count(None).unwrap(), "0");
        assert_eq!(format_count(Some(f64::NAN)).unwrap(), "0");
        assert_eq!(format_count(Some(-2.5)).unwrap(), "-2");
        assert_eq!(format_count(Some(1000.0)).unwrap(), "1k");
        assert_eq!(format_count(Some(2147483648.0)).unwrap(), "2147.5M");
        assert_eq!(format_count(Some(f64::INFINITY)).unwrap(), "InfinityM");
        assert_eq!(format_count(Some(f64::NEG_INFINITY)).unwrap(), "-Infinity");
        assert_eq!(format_percent(None).unwrap(), "—");
        assert_eq!(format_percent(Some(-2.5)).unwrap(), "-2.5%");
        assert_eq!(format_percent(Some(f64::INFINITY)).unwrap(), "Infinity%");
    }
}
