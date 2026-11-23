//! The response headers Express' `helmet` + `cors` + `express-rate-limit` put on every
//! answer. Recorded verbatim from the original; the replay compares them byte for byte.

use axum::http::{StatusCode, header};
use axum::response::{IntoResponse, Response};

/// `helmet`'s content security policy, joined the way it serialises directives.
pub const CSP: &str = "default-src 'self';script-src 'self';style-src 'self';img-src 'self' data: *;base-uri 'self';font-src 'self' https: data:;form-action 'self';frame-ancestors 'self';object-src 'none';script-src-attr 'none';upgrade-insecure-requests";

/// The headers `helmet` sets, in the order it sets them.
pub const SECURITY: [(&str, &str); 13] = [
    ("content-security-policy", CSP),
    ("cross-origin-opener-policy", "same-origin"),
    ("cross-origin-resource-policy", "same-origin"),
    ("origin-agent-cluster", "?1"),
    ("referrer-policy", "no-referrer"),
    ("strict-transport-security", "max-age=15552000; includeSubDomains"),
    ("vary", "Origin"),
    ("x-content-type-options", "nosniff"),
    ("x-dns-prefetch-control", "off"),
    ("x-download-options", "noopen"),
    ("x-frame-options", "DENY"),
    ("x-permitted-cross-domain-policies", "none"),
    ("x-xss-protection", "0"),
];

/// An answer built the way the Express app builds one: security headers on everything, plus the
/// cache markers when the request went through the cache middleware.
///
/// The RateLimit-* triple is not here on purpose. It comes from `ratelimit`, which charges the
/// bucket and stamps the real remaining/reset after the route has answered; writing a placeholder
/// here would mean two places could disagree about the same header.
pub struct Reply {
    pub status: StatusCode,
    pub content_type: &'static str,
    pub cache_control: Option<&'static str>,
    /// `(X-Cache-Key, X-Cache-Status)`; absent on `/health`, which skips the cache middleware.
    pub cache: Option<(String, &'static str)>,
    pub body: String,
}

impl Reply {
    pub fn new(status: StatusCode, content_type: &'static str, body: String) -> Self {
        Reply {
            status,
            content_type,
            cache_control: None,
            cache: None,
            body,
        }
    }

    pub fn cache_key(mut self, key: String, status: &'static str) -> Self {
        self.cache = Some((key, status));
        self
    }

    pub fn cache_control(mut self, value: &'static str) -> Self {
        self.cache_control = Some(value);
        self
    }

}

/// The bytes a header value carries, matching what Node writes.
///
/// Node stores header values in latin-1, so a code point below U+0100 travels as one byte. A Rust
/// string holding such a code point would otherwise be sent as two or three UTF-8 bytes, and a
/// client reading the header back as latin-1 would see mojibake. Keys built by `keys::header_key`
/// are already one-char-per-byte, so this is the inverse of that encoding.
pub fn latin1_bytes(value: &str) -> Vec<u8> {
    if value.chars().all(|c| c as u32 <= 0xFF) {
        value.chars().map(|c| c as u32 as u8).collect()
    } else {
        value.as_bytes().to_vec()
    }
}

impl IntoResponse for Reply {
    fn into_response(self) -> Response {
        let mut response = (self.status, self.body).into_response();
        let head = response.headers_mut();
        let mut set = |name: &'static str, value: &str| {
            if let Ok(value) = axum::http::HeaderValue::from_str(value) {
                head.insert(axum::http::HeaderName::from_static(name), value);
            }
        };
        set(header::CONTENT_TYPE.as_str(), self.content_type);
        for (name, value) in SECURITY {
            set(name, value);
        }
        if let Some(value) = self.cache_control {
            set(header::CACHE_CONTROL.as_str(), value);
        }
        // The cache key is written last and by hand rather than through `set`: it is the one
        // header that can hold non-ASCII, because a platform key embeds the user id verbatim, and
        // the original sends it as latin-1 bytes.
        let cache_key = self
            .cache
            .as_ref()
            .and_then(|(key, _)| axum::http::HeaderValue::from_bytes(&latin1_bytes(key)).ok());
        if let Some((_, status)) = &self.cache {
            set("x-cache-status", status);
        }
        if let Some(value) = cache_key {
            head.insert(axum::http::HeaderName::from_static("x-cache-key"), value);
        }
        response
    }
}
