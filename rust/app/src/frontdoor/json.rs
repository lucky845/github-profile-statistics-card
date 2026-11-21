//! The coercions every platform module needs, written once so the five copies cannot drift.
//!
//! They are here rather than in a crate because each one exists to match a specific piece of the
//! original's behaviour, and the alternative — five identical private copies — is exactly how the
//! copies stop being identical.

use serde_json::Value;

/// `Number(v) || 0` over a JSON field, as the original calls it on every numeric stat.
pub fn js_number(value: Option<&Value>) -> f64 {
    match value {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        Some(Value::String(s)) => s.trim().parse::<f64>().unwrap_or(0.0),
        // Number(true) is 1 and Number(false) is 0.
        Some(Value::Bool(b)) => f64::from(u8::from(*b)),
        _ => 0.0,
    }
}
