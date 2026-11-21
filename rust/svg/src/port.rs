//! The Rust port of `src/services/svg/` (svgService + generators + components + themes).
//!
//! Every template is reproduced byte for byte against the recorded SVGs. Strings are UTF-16
//! where JS measures or slices them; numbers print with V8's shortest round-trip.

#![forbid(unsafe_code)]

use serde_json::{Value, json};

// ---- design tokens ---------------------------------------------------------

const CARD_W: f64 = 495.0;
const CARD_H: f64 = 200.0;
const COL_W: f64 = 113.75; // (495 - 40) / 4
const RADIUS_CARD: u32 = 8;
const RADIUS_BAR: u32 = 4;
const TYPE_DISPLAY: u32 = 26;
const TYPE_HEADING: u32 = 16;
const TYPE_VALUE: u32 = 18;
const TYPE_LABEL: u32 = 11;
const TYPE_CAPTION: u32 = 10;
const W_REGULAR: u32 = 400;
const W_MEDIUM: u32 = 500;
const W_SEMIBOLD: u32 = 600;
const FONT_FAMILY: &str = "-apple-system,BlinkMacSystemFont,Segoe UI,Noto Sans SC,PingFang SC,Microsoft YaHei,Helvetica,Arial,sans-serif";

// ---- JS string/number semantics -------------------------------------------

fn units_len(s: &str) -> usize {
    s.encode_utf16().count()
}

/// JS `slice(0, max) + '…'` on UTF-16 code units.
fn truncate(s: &str, max: usize) -> String {
    if s.is_empty() {
        return String::new();
    }
    let units: Vec<u16> = s.encode_utf16().collect();
    if units.len() > max {
        let mut out = String::from_utf16_lossy(&units[..max]);
        out.push('…');
        out
    } else {
        s.to_string()
    }
}

/// JS `String(v)` for template interpolation.
fn js_string_of(v: &Value) -> String {
    match v {
        Value::Null => "null".to_string(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => crate::js::number_to_string(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(s) => s.clone(),
        Value::Array(items) => items.iter().map(js_string_of).collect::<Vec<_>>().join(","),
        Value::Object(_) => {
            if crate::js::is_undefined(v) {
                "undefined".to_string()
            } else if let Some(n) = crate::js::as_number(v) {
                crate::js::number_to_string(n)
            } else if let Some(units) = crate::js::string_units(v) {
                String::from_utf16_lossy(&units)
            } else {
                "[object Object]".to_string()
            }
        }
    }
}

/// JS falsiness of a received value.
fn is_falsy(v: &Value) -> bool {
    match v {
        Value::Null => true,
        Value::Bool(b) => !b,
        Value::Number(n) => {
            let f = n.as_f64().unwrap_or(f64::NAN);
            f == 0.0 || f.is_nan()
        }
        Value::String(s) => s.is_empty(),
        Value::Array(a) => a.is_empty(),
        Value::Object(_) => crate::js::is_undefined(v),
    }
}

/// JS `Number(v)` for comparisons; strings parse like JS, anything else NaN (null → NaN is
/// close enough for the `x > 0` guards the generators use).
fn js_number_of(v: &Value) -> f64 {
    match v {
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => s.trim().parse::<f64>().unwrap_or(f64::NAN),
        Value::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Value::Null => 0.0,
        _ => crate::js::as_number(v).unwrap_or(f64::NAN),
    }
}

/// JS `Math.round` on a value (used by pill widths and bar fills).
fn js_round(x: f64) -> f64 {
    crate::js::math_round(x)
}

/// JS `formatCount` from `src/utils/format.ts`.
fn format_count(n: f64) -> String {
    if n.is_nan() {
        return "0".to_string();
    }
    if n < 1000.0 {
        return crate::js::number_to_string(js_round(n));
    }
    if n < 10000.0 {
        return format!("{}k", to_fixed_1(n / 1000.0).replace(".0", ""));
    }
    if n < 1000000.0 {
        return format!("{}k", crate::js::number_to_string(js_round(n / 1000.0)));
    }
    format!("{}M", to_fixed_1(n / 1000000.0).replace(".0", ""))
}

/// JS `Number.prototype.toFixed(1)`, exact rational rounding (see `rust/utils`).
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
    let bits = a.to_bits();
    let exp_raw = ((bits >> 52) & 0x7ff) as i32;
    let mant = bits & 0xfffffffffffff;
    let (m, e) = if exp_raw == 0 {
        (mant, -1074i64)
    } else {
        (mant | (1u64 << 52), i64::from(exp_raw) - 1075)
    };
    let n = u128::from(m) * 10;
    let (q, d2): (u128, u128) = if e >= 0 {
        ((a * 10.0) as u128, 0)
    } else {
        let k = (-e) as u32;
        if k >= 128 {
            (0, 0)
        } else {
            let q = n >> k;
            let r = n & ((1u128 << k) - 1);
            (q, ((r * 10) >> k) % 10)
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

// ---- clock / date ----------------------------------------------------------

fn now_ms() -> f64 {
    if let Ok(v) = std::env::var("RUST_ANYTHING_WTS_OVERRIDE")
        && let Ok(n) = v.parse::<f64>()
    {
        return n * 1000.0;
    }
    let seam = concat!(env!("CARGO_MANIFEST_DIR"), "/.rust-anything-wts-override");
    if let Ok(v) = std::fs::read_to_string(seam)
        && let Ok(n) = v.trim().parse::<f64>()
    {
        return n * 1000.0;
    }
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0.0, |d| d.as_millis() as f64)
}

/// UTC civil date from days-since-epoch (Howard Hinnant's algorithm). The original runs on
/// Vercel (UTC); the recording machine (+08:00) agrees with UTC on the recorded timestamps.
fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m as u32, d as u32)
}

/// JS `formatDate(Date.now())` → `YYYY-MM-DD` (UTC).
fn format_date_now() -> String {
    let ms = now_ms() as i64;
    let days = ms.div_euclid(86_400_000);
    let (y, m, d) = civil_from_days(days);
    format!("{y:04}-{m:02}-{d:02}")
}

// ---- sanitize / escape -----------------------------------------------------

/// JS `SvgSanitizerService.sanitizeUserContent`.
fn sanitize_user_content(content: &str) -> String {
    if content.is_empty() {
        return String::new();
    }
    let mut s = content
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#x27;")
        .replace('/', "&#x2F;");
    for pat in ["javascript:", "data:", "expression("] {
        s = s.replace(pat, "");
    }
    s
}

/// JS `escapeText` / `escapeAttr`.
fn escape_text(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

// ---- themes ----------------------------------------------------------------

fn theme(name: Option<&str>) -> Value {
    match name {
        Some("dark") => dark_theme(),
        Some("github-dark-dimmed") => dimmed_theme(),
        Some("transparent") => transparent_theme(),
        _ => light_theme(),
    }
}

fn light_theme() -> Value {
    json!({
        "colors": {"background":"#ffffff","border":"#e1e4e8",
            "text":{"primary":"#24292e","secondary":"#586069","title":"#24292e"},
            "accent":{"primary":"#0366d6","secondary":"#28a745"},
            "stats":{"easy":"#66bb6a","medium":"#ffca28","hard":"#ef5350","total":"#4287f5","count":"#9c27b0"}},
        "fonts":{"family":"Segoe UI, Tahoma, Geneva, Verdana, sans-serif","size":{"small":"12px","normal":"14px","title":"18px"}},
        "card":{"borderRadius":"6px"}
    })
}

fn dark_theme() -> Value {
    json!({
        "colors": {"background":"#1e1e1e","border":"#30363d",
            "text":{"primary":"#c9d1d9","secondary":"#8b949e","title":"#f0f6fc"},
            "accent":{"primary":"#58a6ff","secondary":"#3fb950"},
            "stats":{"easy":"#57ab5a","medium":"#d29922","hard":"#f85149","total":"#4287f5","count":"#b084cc"}},
        "fonts":{"family":"Segoe UI, Tahoma, Geneva, Verdana, sans-serif","size":{"small":"12px","normal":"14px","title":"18px"}},
        "card":{"borderRadius":"6px"}
    })
}

fn dimmed_theme() -> Value {
    json!({
        "colors": {"background":"#22272e","border":"#444c56",
            "text":{"primary":"#adbac7","secondary":"#768390","title":"#cdd9e5"},
            "accent":{"primary":"#539bf5","secondary":"#6cb6ff"},
            "stats":{"easy":"#57ab5a","medium":"#c69026","hard":"#e5534b","total":"#539bf5","count":"#adbac7"}},
        "fonts":{"family":"-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans SC, sans-serif","size":{"small":"12px","normal":"14px","title":"18px"}},
        "card":{"borderRadius":"6px"}
    })
}

fn transparent_theme() -> Value {
    json!({
        "colors": {"background":"transparent","border":"#d0d7de",
            "text":{"primary":"#1f2328","secondary":"#59636e","title":"#1f2328"},
            "accent":{"primary":"#0969da","secondary":"#1a7f37"},
            "stats":{"easy":"#1a7f37","medium":"#9a6700","hard":"#cf222e","total":"#0969da","count":"#1f2328"}},
        "fonts":{"family":"-apple-system, BlinkMacSystemFont, Segoe UI, Noto Sans SC, sans-serif","size":{"small":"12px","normal":"14px","title":"18px"}},
        "card":{"borderRadius":"6px"}
    })
}

fn bg(theme: &Value) -> String {
    theme["colors"]["background"]
        .as_str()
        .unwrap_or("#ffffff")
        .to_string()
}
fn border(theme: &Value) -> String {
    theme["colors"]["border"]
        .as_str()
        .unwrap_or("#e1e4e8")
        .to_string()
}
fn text_primary(theme: &Value) -> String {
    theme["colors"]["text"]["primary"]
        .as_str()
        .unwrap_or("#24292e")
        .to_string()
}
fn text_secondary(theme: &Value) -> String {
    theme["colors"]["text"]["secondary"]
        .as_str()
        .unwrap_or("#586069")
        .to_string()
}
fn stat_easy(theme: &Value) -> String {
    theme["colors"]["stats"]["easy"]
        .as_str()
        .unwrap_or("#66bb6a")
        .to_string()
}
fn stat_medium(theme: &Value) -> String {
    theme["colors"]["stats"]["medium"]
        .as_str()
        .unwrap_or("#ffca28")
        .to_string()
}
fn stat_hard(theme: &Value) -> String {
    theme["colors"]["stats"]["hard"]
        .as_str()
        .unwrap_or("#ef5350")
        .to_string()
}

// ---- components ------------------------------------------------------------

fn num(x: f64) -> String {
    crate::js::number_to_string(x)
}

#[allow(clippy::too_many_arguments)]
fn text(
    x: f64,
    y: f64,
    value: &str,
    size: u32,
    weight: u32,
    fill: &str,
    anchor: Option<&str>,
    mono: bool,
) -> String {
    let attrs = format!(
        "x=\"{x}\" y=\"{y}\" font-family=\"{FONT_FAMILY}\" font-size=\"{size}\" font-weight=\"{weight}\" fill=\"{fill}\"",
        x = num(x),
        y = num(y)
    );
    let _ = attrs;
    let mut attrs = vec![
        format!("x=\"{}\"", num(x)),
        format!("y=\"{}\"", num(y)),
        format!("font-family=\"{FONT_FAMILY}\"",),
        format!("font-size=\"{size}\""),
        format!("font-weight=\"{weight}\""),
        format!("fill=\"{fill}\""),
    ];
    if let Some(a) = anchor
        && a != "start"
    {
        attrs.push(format!("text-anchor=\"{a}\""));
    }
    if mono {
        attrs.push("font-variant-numeric=\"tabular-nums\"".to_string());
    }
    format!("<text {}>{}</text>", attrs.join(" "), escape_text(value))
}

fn frame(theme: &Value) -> String {
    format!(
        "<rect width=\"{}\" height=\"{}\" rx=\"{}\" ry=\"{}\" fill=\"{}\" stroke=\"{}\" stroke-width=\"1\"/>",
        num(CARD_W),
        num(CARD_H),
        RADIUS_CARD,
        RADIUS_CARD,
        bg(theme),
        border(theme)
    )
}

fn header(theme: &Value, title: &str, subtitle: &str, dot: Option<&str>, right: &str) -> String {
    let mut parts: Vec<String> = Vec::new();
    if let Some(dot) = dot {
        let cy = 42.0 - TYPE_HEADING as f64 * 0.35;
        parts.push(format!(
            "<circle cx=\"{}\" cy=\"{}\" r=\"3\" fill=\"{dot}\"/>",
            num(23.0),
            num(cy)
        ));
    }
    parts.push(text(
        32.0,
        42.0,
        title,
        TYPE_HEADING,
        W_SEMIBOLD,
        &text_primary(theme),
        None,
        false,
    ));
    if !subtitle.is_empty() {
        parts.push(text(
            20.0,
            62.0,
            &truncate(subtitle, 42),
            TYPE_LABEL,
            W_REGULAR,
            &text_secondary(theme),
            None,
            false,
        ));
    }
    if !right.is_empty() {
        parts.push(right.to_string());
    }
    parts.join("\n    ")
}

fn divider(y: f64, theme: &Value) -> String {
    format!(
        "<line x1=\"20\" y1=\"{y}\" x2=\"475\" y2=\"{y}\" stroke=\"{}\" stroke-width=\"1\"/>",
        border(theme)
    )
}

fn footer(theme: &Value, left: &str, right: &str) -> String {
    let mut parts = vec![text(
        20.0,
        186.0,
        left,
        TYPE_CAPTION,
        W_REGULAR,
        &text_secondary(theme),
        None,
        false,
    )];
    if !right.is_empty() {
        parts.push(text(
            475.0,
            186.0,
            right,
            TYPE_CAPTION,
            W_REGULAR,
            &text_secondary(theme),
            Some("end"),
            false,
        ));
    }
    parts.join("\n    ")
}

fn badge(_theme: &Value, label: &str, color: &str) -> String {
    let width = (units_len(label) as f64) * 8.0 + 12.0;
    format!(
        "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"18\" rx=\"9\" fill=\"{}\" opacity=\"0.12\"/>
    {}",
        num(475.0 - width),
        num(26.0),
        num(width),
        color,
        text(
            475.0 - width / 2.0,
            39.0,
            label,
            TYPE_CAPTION,
            W_MEDIUM,
            color,
            Some("middle"),
            false
        )
    )
}

fn progress_bar(x: f64, y: f64, width: f64, pct: f64, color: &str, track: &str) -> String {
    let clamped = pct.clamp(0.0, 1.0);
    let filled = js_round(width * clamped);
    let fill = if filled > 0.0 {
        format!(
            "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"6\" rx=\"{}\" fill=\"{color}\"/>",
            num(x),
            num(y),
            num(filled),
            RADIUS_BAR
        )
    } else {
        String::new()
    };
    format!(
        "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"6\" rx=\"{}\" fill=\"{}\" opacity=\"0.6\"/>{fill}",
        num(x),
        num(y),
        num(width),
        RADIUS_BAR,
        track
    )
}

fn pill(x: f64, y: f64, label: &str, color: &str) -> (String, f64) {
    let width = js_round(units_len(label) as f64 * 11.0 * 0.62 + 12.0);
    let svg =
        format!(
        "<rect x=\"{}\" y=\"{}\" width=\"{}\" height=\"18\" rx=\"9\" fill=\"{}\" opacity=\"0.12\"/>
    {}",
        num(x), num(y), num(width), color,
        text(x + width / 2.0, y + 13.0, label, TYPE_CAPTION, W_MEDIUM, color, Some("middle"), false)
    );
    (svg, width + 8.0)
}

// ---- error card ------------------------------------------------------------

fn error_card(message: &str, theme: &Value) -> String {
    let safe = escape_text(&truncate(&sanitize_user_content(message), 40));
    let accent = "#cf222e";
    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"495\" height=\"200\" viewBox=\"0 0 495 200\">
  <rect width=\"495\" height=\"200\" fill=\"{}\" rx=\"8\" ry=\"8\" stroke=\"{}\" stroke-width=\"1\"/>
  <circle cx=\"247.5\" cy=\"66\" r=\"14\" fill=\"none\" stroke=\"{}\" stroke-width=\"2\"/>
  <text x=\"247.5\" y=\"71\" font-family=\"{FONT_FAMILY}\" font-size=\"16\" font-weight=\"700\" text-anchor=\"middle\" fill=\"{}\">!</text>
  <text x=\"247.5\" y=\"108\" font-family=\"{FONT_FAMILY}\" font-size=\"13\" text-anchor=\"middle\" fill=\"{}\">{}</text>
  <text x=\"247.5\" y=\"130\" font-family=\"{FONT_FAMILY}\" font-size=\"10\" text-anchor=\"middle\" fill=\"{}\">稍后会自动恢复</text>
</svg>",
        bg(theme), border(theme), accent, accent, text_primary(theme), safe, text_secondary(theme)
    )
}

// ---- generators ------------------------------------------------------------

fn get_str<'a>(data: &'a Value, key: &str) -> Option<&'a str> {
    data.get(key).and_then(|v| v.as_str())
}

fn get_field<'a>(data: &'a Value, key: &str) -> Option<&'a Value> {
    data.get(key)
}

fn gen_github(data: &Value, theme: &Value) -> Result<String, String> {
    let username = get_str(data, "username").unwrap_or("Unknown");
    let public_repos = js_number_of(get_field(data, "publicRepos").unwrap_or(&Value::Null));
    let followers = js_number_of(get_field(data, "followers").unwrap_or(&Value::Null));
    let total_stars = js_number_of(get_field(data, "totalStars").unwrap_or(&Value::Null));
    let avg = if public_repos > 0.0 {
        js_round(total_stars / public_repos)
    } else {
        0.0
    };
    let stats: Vec<(&str, String)> = vec![
        ("仓库", format_count(public_repos)),
        ("星标", format_count(total_stars)),
        ("关注者", format_count(followers)),
        ("均值星标", format_count(avg)),
    ];
    let right = format!(
        "<text x=\"475\" y=\"42\" font-family=\"inherit\" font-size=\"11\" fill=\"{}\" text-anchor=\"end\">@{}</text>",
        text_secondary(theme),
        escape_text(username)
    );
    let cols: Vec<String> = stats
        .iter()
        .enumerate()
        .map(|(i, (label, value))| {
            format!(
                "{}\n    {}",
                text(
                    20.0 + i as f64 * COL_W,
                    124.0,
                    value,
                    TYPE_VALUE,
                    W_SEMIBOLD,
                    &text_primary(theme),
                    None,
                    true
                ),
                text(
                    20.0 + i as f64 * COL_W,
                    142.0,
                    label,
                    TYPE_LABEL,
                    W_REGULAR,
                    &text_secondary(theme),
                    None,
                    false
                )
            )
        })
        .collect();
    Ok(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"495\" height=\"200\" viewBox=\"0 0 495 200\" role=\"img\" aria-label=\"GitHub 统计卡片\">
    <title>{} 的 GitHub 统计</title>
    {}
    {}
    {}
    {}
    {}
    {}
  </svg>",
        escape_text(username),
        frame(theme),
        header(theme, "GitHub", "开源仓库与影响力", Some("#1f2328"), &right),
        divider(76.0, theme),
        cols.join("\n    "),
        divider(160.0, theme),
        footer(theme, "GitHub Profile Statistics", &format!("更新于 {}", format_date_now()))
    ))
}

fn gen_leetcode(data: &Value, theme: &Value) -> Result<String, String> {
    let username = get_str(data, "username").unwrap_or("Unknown");
    let total_solved = js_number_of(get_field(data, "totalSolved").unwrap_or(&Value::Null));
    let easy_solved = js_number_of(get_field(data, "easySolved").unwrap_or(&Value::Null));
    let medium_solved = js_number_of(get_field(data, "mediumSolved").unwrap_or(&Value::Null));
    let hard_solved = js_number_of(get_field(data, "hardSolved").unwrap_or(&Value::Null));
    let acceptance_rate = get_str(data, "acceptanceRate").unwrap_or("—").to_string();
    let region = get_str(data, "region").unwrap_or("");
    let ranking = js_number_of(get_field(data, "ranking").unwrap_or(&Value::Null));
    let tp = get_field(data, "totalProblems")
        .cloned()
        .unwrap_or(Value::Null);
    let tp_easy = js_number_of(tp.get("easy").unwrap_or(&Value::Null));
    let tp_medium = js_number_of(tp.get("medium").unwrap_or(&Value::Null));
    let tp_hard = js_number_of(tp.get("hard").unwrap_or(&Value::Null));

    let region_label = if region == "CN" {
        "中国站"
    } else if region == "US" {
        "国际站"
    } else {
        ""
    };
    let right = if region_label.is_empty() {
        String::new()
    } else {
        format!(
            "<rect x=\"417\" y=\"26\" width=\"58\" height=\"18\" rx=\"9\" fill=\"#ffa116\" opacity=\"0.14\"/>
       {}",
            text(446.0, 39.0, region_label, TYPE_CAPTION, W_MEDIUM, "#ffa116", Some("middle"), false)
        )
    };

    let total_known = if !tp.is_null() {
        tp_easy + tp_medium + tp_hard
    } else {
        0.0
    };
    let solved_headline = if total_known > 0.0 {
        format!(
            "{}/{}",
            format_count(total_solved),
            format_count(total_known)
        )
    } else {
        format_count(total_solved)
    };

    let col_w = COL_W * 1.4;
    let mut main_row: Vec<String> = vec![
        text(
            20.0,
            108.0,
            "已解决",
            TYPE_LABEL,
            W_REGULAR,
            &text_secondary(theme),
            None,
            false,
        ),
        text(
            20.0,
            136.0,
            &solved_headline,
            TYPE_DISPLAY,
            W_SEMIBOLD,
            &text_primary(theme),
            None,
            true,
        ),
        text(
            20.0 + col_w,
            108.0,
            "通过率",
            TYPE_LABEL,
            W_REGULAR,
            &text_secondary(theme),
            None,
            false,
        ),
        text(
            20.0 + col_w,
            128.0,
            &acceptance_rate,
            TYPE_VALUE,
            W_SEMIBOLD,
            &stat_easy(theme),
            None,
            true,
        ),
    ];
    if ranking > 0.0 {
        main_row.push(text(
            20.0 + col_w * 2.0,
            108.0,
            "排名",
            TYPE_LABEL,
            W_REGULAR,
            &text_secondary(theme),
            None,
            false,
        ));
        main_row.push(text(
            20.0 + col_w * 2.0,
            128.0,
            &format_count(ranking),
            TYPE_VALUE,
            W_SEMIBOLD,
            &text_primary(theme),
            None,
            true,
        ));
    }

    let rows = [
        ("简单", easy_solved, tp_easy, stat_easy(theme)),
        ("中等", medium_solved, tp_medium, stat_medium(theme)),
        ("困难", hard_solved, tp_hard, stat_hard(theme)),
    ];
    let bars: Vec<String> = rows
        .iter()
        .enumerate()
        .map(|(i, (label, solved, total, color))| {
            let x = 20.0 + i as f64 * COL_W;
            let pct = if *total > 0.0 { solved / total } else { 0.0 };
            let count_label = if *total > 0.0 {
                format!("{}/{}", format_count(*solved), format_count(*total))
            } else {
                format_count(*solved)
            };
            [
                text(
                    x,
                    150.0,
                    label,
                    TYPE_LABEL,
                    W_REGULAR,
                    &text_secondary(theme),
                    None,
                    false,
                ),
                text(
                    x + 108.0,
                    150.0,
                    &count_label,
                    TYPE_CAPTION,
                    W_MEDIUM,
                    color,
                    Some("end"),
                    true,
                ),
                progress_bar(x, 158.0, 108.0, pct, color, &border(theme)),
            ]
            .join("\n      ")
        })
        .collect();

    Ok(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"495\" height=\"200\" viewBox=\"0 0 495 200\" role=\"img\" aria-label=\"LeetCode 统计卡片\">
    <title>{} 的 LeetCode 统计</title>
    {}
    {}
    {}
    {}
    {}
    {}
    {}
  </svg>",
        escape_text(username),
        frame(theme),
        header(theme, "LeetCode", "刷题进度与通过率", Some("#ffa116"), &right),
        divider(76.0, theme),
        main_row.join("\n    "),
        bars.join("\n    "),
        divider(160.0, theme),
        footer(theme, "LeetCode Statistics", &format!("更新于 {}", format_date_now()))
    ))
}

fn gen_csdn(data: &Value, theme: &Value) -> Result<String, String> {
    let username = get_str(data, "username").unwrap_or("Unknown");
    let article_count = js_number_of(get_field(data, "articleCount").unwrap_or(&Value::Null));
    let followers = js_number_of(get_field(data, "followers").unwrap_or(&Value::Null));
    let rank = js_number_of(get_field(data, "rank").unwrap_or(&Value::Null));
    let views = js_number_of(get_field(data, "views").unwrap_or(&Value::Null));
    let points = js_number_of(get_field(data, "points").unwrap_or(&Value::Null));
    let code_age = get_field(data, "codeAge").cloned().unwrap_or(Value::Null);
    let level = get_field(data, "level").cloned().unwrap_or(Value::Null);

    let level_text =
        if !level.is_null() && !crate::js::is_undefined(&level) && js_string_of(&level) != "N/A" {
            format!("Lv.{}", js_string_of(&level))
        } else {
            String::new()
        };
    let right = if level_text.is_empty() {
        String::new()
    } else {
        badge(theme, &level_text, "#fc5531")
    };

    let stats: Vec<(&str, String)> = vec![
        ("原创", format_count(article_count)),
        ("粉丝", format_count(followers)),
        (
            "排名",
            if rank > 0.0 {
                format_count(rank)
            } else {
                "—".to_string()
            },
        ),
        ("总访问量", format_count(views)),
    ];

    let mut chips: Vec<String> = Vec::new();
    let mut chip_x = 20.0;
    let code_age_text = if !code_age.is_null() && !crate::js::is_undefined(&code_age) {
        let s = js_string_of(&code_age)
            .replace("码龄", "")
            .trim()
            .to_string();
        if s.is_empty() {
            String::new()
        } else {
            format!("码龄 {s}")
        }
    } else {
        String::new()
    };
    if !code_age_text.is_empty() {
        let (svg, w) = pill(chip_x, 160.0, &code_age_text, &text_secondary(theme));
        chips.push(svg);
        chip_x += w;
    }
    if points > 0.0 {
        let (svg, _w) = pill(
            chip_x,
            160.0,
            &format!("原力 {}", format_count(points)),
            "#fc5531",
        );
        chips.push(svg);
        let _ = chip_x;
    }

    let cols: Vec<String> = stats
        .iter()
        .enumerate()
        .map(|(i, (label, value))| {
            format!(
                "{}\n      {}",
                text(
                    20.0 + i as f64 * COL_W,
                    124.0,
                    value,
                    TYPE_VALUE,
                    W_SEMIBOLD,
                    &text_primary(theme),
                    None,
                    true
                ),
                text(
                    20.0 + i as f64 * COL_W,
                    142.0,
                    label,
                    TYPE_LABEL,
                    W_REGULAR,
                    &text_secondary(theme),
                    None,
                    false
                )
            )
        })
        .collect();

    Ok(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"495\" height=\"200\" viewBox=\"0 0 495 200\" role=\"img\" aria-label=\"CSDN 统计卡片\">
    <title>{} 的 CSDN 统计</title>
    {}
    {}
    {}
    {}
    {}
    {}
  </svg>",
        escape_text(username),
        frame(theme),
        header(theme, "CSDN", "技术博客影响力", Some("#fc5531"), &right),
        divider(76.0, theme),
        cols.join("\n    "),
        chips.join("\n    "),
        footer(theme, "CSDN Statistics", &format!("更新于 {}", format_date_now()))
    ))
}

fn gen_juejin(data: &Value, theme: &Value) -> Result<String, String> {
    let username = get_str(data, "username").unwrap_or("Unknown");
    let desc_raw = get_field(data, "desc").cloned().unwrap_or(Value::Null);
    let followers = js_number_of(get_field(data, "followers").unwrap_or(&Value::Null));
    let article_count = js_number_of(get_field(data, "articleCount").unwrap_or(&Value::Null));
    let likes = js_number_of(get_field(data, "likes").unwrap_or(&Value::Null));
    let views = js_number_of(get_field(data, "views").unwrap_or(&Value::Null));

    let desc = match &desc_raw {
        Value::String(s) => s.clone(),
        v if is_falsy(v) => String::new(),
        _ => return Err("desc is not a string".to_string()),
    };
    let desc_line = if desc.is_empty() {
        String::new()
    } else {
        text(
            20.0,
            168.0,
            &if units_len(&desc) > 56 {
                truncate(&desc, 56)
            } else {
                desc.clone()
            },
            TYPE_LABEL,
            W_REGULAR,
            &text_secondary(theme),
            None,
            false,
        )
    };

    let stats: Vec<(&str, String)> = vec![
        ("文章", format_count(article_count)),
        ("浏览", format_count(views)),
        ("点赞", format_count(likes)),
        ("粉丝", format_count(followers)),
    ];
    let cols: Vec<String> = stats
        .iter()
        .enumerate()
        .map(|(i, (label, value))| {
            format!(
                "{}\n      {}",
                text(
                    20.0 + i as f64 * COL_W,
                    124.0,
                    value,
                    TYPE_VALUE,
                    W_SEMIBOLD,
                    &text_primary(theme),
                    None,
                    true
                ),
                text(
                    20.0 + i as f64 * COL_W,
                    142.0,
                    label,
                    TYPE_LABEL,
                    W_REGULAR,
                    &text_secondary(theme),
                    None,
                    false
                )
            )
        })
        .collect();

    Ok(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"495\" height=\"200\" viewBox=\"0 0 495 200\" role=\"img\" aria-label=\"掘金统计卡片\">
    <title>{} 的掘金统计</title>
    {}
    {}
    {}
    {}
    {}
    {}
  </svg>",
        escape_text(username),
        frame(theme),
        header(theme, "掘金", "技术内容创作", Some("#1e80ff"), ""),
        divider(76.0, theme),
        cols.join("\n    "),
        desc_line,
        footer(theme, "Juejin Statistics", &format!("更新于 {}", format_date_now()))
    ))
}

fn gen_bilibili(data: &Value, theme: &Value) -> Result<String, String> {
    let uid = get_str(data, "uid").unwrap_or("");
    let username_raw = get_field(data, "username").cloned().unwrap_or(Value::Null);
    let level = js_number_of(get_field(data, "level").unwrap_or(&Value::Null));
    let sign_raw = get_field(data, "sign").cloned().unwrap_or(Value::Null);
    let followers = js_number_of(get_field(data, "followers").unwrap_or(&Value::Null));
    let following = js_number_of(get_field(data, "following").unwrap_or(&Value::Null));
    let likes = js_number_of(get_field(data, "likes").unwrap_or(&Value::Null));
    let views = js_number_of(get_field(data, "views").unwrap_or(&Value::Null));

    let display_name = match &username_raw {
        Value::String(s) if !s.is_empty() => s.clone(),
        v if is_falsy(v) => {
            if uid.is_empty() {
                "Unknown".to_string()
            } else {
                uid.to_string()
            }
        }
        Value::Number(n) => crate::js::number_to_string(n.as_f64().unwrap_or(f64::NAN)),
        _ => {
            if uid.is_empty() {
                "Unknown".to_string()
            } else {
                uid.to_string()
            }
        }
    };

    let sign = match &sign_raw {
        Value::String(s) => s.clone(),
        v if is_falsy(v) => String::new(),
        _ => return Err("sign is not a string".to_string()),
    };
    let sign_line = if sign.is_empty() {
        String::new()
    } else {
        text(
            20.0,
            168.0,
            &if units_len(&sign) > 56 {
                truncate(&sign, 56)
            } else {
                sign.clone()
            },
            TYPE_LABEL,
            W_REGULAR,
            &text_secondary(theme),
            None,
            false,
        )
    };

    let right = if level > 0.0 {
        badge(
            theme,
            &format!("Lv.{}", crate::js::number_to_string(level)),
            "#00aeec",
        )
    } else {
        String::new()
    };

    let stats: Vec<(&str, String)> = vec![
        ("粉丝", format_count(followers)),
        ("关注", format_count(following)),
        ("获赞", format_count(likes)),
        ("播放", format_count(views)),
    ];
    let cols: Vec<String> = stats
        .iter()
        .enumerate()
        .map(|(i, (label, value))| {
            format!(
                "{}\n      {}",
                text(
                    20.0 + i as f64 * COL_W,
                    124.0,
                    value,
                    TYPE_VALUE,
                    W_SEMIBOLD,
                    &text_primary(theme),
                    None,
                    true
                ),
                text(
                    20.0 + i as f64 * COL_W,
                    142.0,
                    label,
                    TYPE_LABEL,
                    W_REGULAR,
                    &text_secondary(theme),
                    None,
                    false
                )
            )
        })
        .collect();

    Ok(format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\" width=\"495\" height=\"200\" viewBox=\"0 0 495 200\" role=\"img\" aria-label=\"哔哩哔哩统计卡片\">
    <title>{} 的哔哩哔哩统计</title>
    {}
    {}
    {}
    {}
    {}
    {}
  </svg>",
        escape_text(&display_name),
        frame(theme),
        header(theme, "哔哩哔哩", "UP 主数据", Some("#00aeec"), &right),
        divider(76.0, theme),
        cols.join("\n    "),
        sign_line,
        footer(theme, "Bilibili Statistics", &format!("更新于 {}", format_date_now()))
    ))
}

// ---- ported entry points ---------------------------------------------------

/// Port of `getThemeConfig` (`src/services/svg/svgService.ts:21`).
pub fn get_theme_config(theme_name: Option<String>) -> Result<Value, String> {
    Ok(theme(theme_name.as_deref()))
}

/// Port of `generateCard` (`src/services/svg/svgService.ts:49`).
pub fn generate_card(
    card_type: Value,
    data: Value,
    theme_name: Option<String>,
) -> Result<String, String> {
    let theme = theme(theme_name.as_deref());
    let key = js_string_of(&card_type);
    let attempt: Result<String, String> = match key.as_str() {
        "leetcode" | "github" | "csdn" | "juejin" | "bilibili" => {
            if is_falsy(&data) {
                let msg = match key.as_str() {
                    "leetcode" => "无法获取LeetCode数据",
                    "github" => "无法获取GitHub数据",
                    "csdn" => "无法获取CSDN数据",
                    "juejin" => "无法获取掘金数据",
                    _ => "无法获取哔哩哔哩数据",
                };
                Ok(error_card(msg, &theme))
            } else {
                match key.as_str() {
                    "leetcode" => gen_leetcode(&data, &theme),
                    "github" => gen_github(&data, &theme),
                    "csdn" => gen_csdn(&data, &theme),
                    "juejin" => gen_juejin(&data, &theme),
                    _ => gen_bilibili(&data, &theme),
                }
            }
        }
        "error" => match &data {
            Value::String(s) => Ok(error_card(s, &theme)),
            _ => Err("data is not a string".to_string()),
        },
        _ => Ok(error_card(&format!("不支持的卡片类型: {key}"), &theme)),
    };
    match attempt {
        Ok(svg) => Ok(svg),
        Err(e) => {
            eprintln!("generateCard error: {e}");
            Ok(error_card("卡片生成失败", &theme))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn themes_are_stable() {
        let t = get_theme_config(None).unwrap();
        assert_eq!(t["colors"]["background"], "#ffffff");
        let d = get_theme_config(Some("dark".to_string())).unwrap();
        assert_eq!(d["colors"]["background"], "#1e1e1e");
        let g = get_theme_config(Some("github-dark-dimmed".to_string())).unwrap();
        assert_eq!(g["colors"]["background"], "#22272e");
        let tr = get_theme_config(Some("transparent".to_string())).unwrap();
        assert_eq!(tr["colors"]["background"], "transparent");
        let bogus = get_theme_config(Some("bogus".to_string())).unwrap();
        assert_eq!(bogus["colors"]["background"], "#ffffff");
    }

    #[test]
    fn truncates_in_utf16() {
        assert_eq!(truncate("abc", 2), "ab…");
        assert_eq!(truncate("ab", 2), "ab");
        assert_eq!(truncate("", 5), "");
    }

    #[test]
    fn escapes_and_sanitizes() {
        assert_eq!(escape_text("<a>&'\""), "&lt;a&gt;&amp;&#39;&quot;");
        assert_eq!(sanitize_user_content("</a>"), "&lt;&#x2F;a&gt;");
    }

    #[test]
    fn formats_counts_like_js() {
        assert_eq!(format_count(0.0), "0");
        assert_eq!(format_count(1000.0), "1k");
        assert_eq!(format_count(3200.0), "3.2k");
        assert_eq!(format_count(15000.0), "15k");
        assert_eq!(format_count(100000.0), "100k");
        assert_eq!(format_count(2147483648.0), "2147.5M");
    }
}
