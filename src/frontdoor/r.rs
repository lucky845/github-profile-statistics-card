//! The envelope every JSON endpoint answers with: `code`, `msg`, `data`.
//!
//! The three fields sit in that order because `serde_json` runs with `preserve_order` and the
//! recorded baselines compare bytes: a field inserted in the middle would shift every later byte
//! of every recorded body.
//!
//! `code` mirrors the HTTP status rather than replacing it. A Java-style envelope that answers 200
//! for everything would break the three consumers that never parse a body -- the `HEALTHCHECK` in
//! the Dockerfile, `render.yaml`'s `healthCheckPath`, and the smoke workflow -- all of which test
//! `curl -fsS`'s exit code, and that is the status. Keeping the two in step costs nothing and
//! leaves `curl -f` meaning what it always meant.

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;
use serde_json::Value;

use super::headers::Reply;

/// What `res.json()` answers with.
pub const JSON_CONTENT_TYPE: &str = "application/json; charset=utf-8";

/// The copy a plain success carries in `msg`.
pub const OK: &str = "ok";

/// The uniform body: a status code, a human sentence, and the payload that used to be the body.
#[derive(Serialize)]
pub struct R {
    /// The HTTP status as a number, so a client reading only the body still sees the outcome.
    pub code: u16,
    /// A sentence aimed at whoever is reading the response or the logs.
    pub msg: String,
    /// The old response body, unchanged, now nested one level down.
    pub data: Value,
}

impl R {
    /// A success whose `msg` is the default "ok".
    pub fn ok(data: Value) -> Self {
        R {
            code: 200,
            msg: OK.to_string(),
            data,
        }
    }

    /// A success with copy of its own, which is what the cache endpoints report.
    pub fn ok_msg(data: Value, msg: impl Into<String>) -> Self {
        R {
            code: 200,
            msg: msg.into(),
            data,
        }
    }

    /// A failure that carries details: the 404 reports which path it looked at and when.
    pub fn fail(status: StatusCode, msg: impl Into<String>, data: Value) -> Self {
        R {
            code: status.as_u16(),
            msg: msg.into(),
            data,
        }
    }

    /// A failure with nothing to add beyond the sentence.
    pub fn err(status: StatusCode, msg: impl Into<String>) -> Self {
        R::fail(status, msg, Value::Null)
    }

    pub fn body(&self) -> String {
        serde_json::to_string(self).unwrap_or_default()
    }

    /// The envelope as a `Reply`, so callers can still chain a cache marker onto it.
    pub fn reply(self, status: StatusCode) -> Reply {
        Reply::new(status, JSON_CONTENT_TYPE, self.body())
    }

    pub fn response(self, status: StatusCode) -> Response {
        self.reply(status).into_response()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_fields_come_out_code_msg_data_in_that_order() {
        let body = R::ok(json!({ "status": "alive", "uptime": 3 })).body();
        assert_eq!(
            body,
            r#"{"code":200,"msg":"ok","data":{"status":"alive","uptime":3}}"#
        );
    }

    #[test]
    fn the_code_mirrors_the_status_it_is_answered_with() {
        let failure = R::err(StatusCode::BAD_REQUEST, "Must provide one of: pattern, group, or all=true");
        assert_eq!(failure.code, 400);
        assert!(failure.reply(StatusCode::BAD_REQUEST).status == StatusCode::BAD_REQUEST);
    }

    #[test]
    fn a_failure_without_details_reports_null_rather_than_a_missing_field() {
        let body = R::err(StatusCode::BAD_REQUEST, "nope").body();
        assert_eq!(body, r#"{"code":400,"msg":"nope","data":null}"#);
    }

    #[test]
    fn a_failure_with_details_nests_them_under_data() {
        let body = R::fail(
            StatusCode::NOT_FOUND,
            "请求的路由不存在",
            json!({ "path": "/nope", "reason": "ROUTE_NOT_FOUND" }),
        )
        .body();
        // serde_json escapes nothing here: the copy is written as raw UTF-8, exactly as the
        // Express responses wrote it.
        assert!(body.starts_with(r#"{"code":404,"msg":"请求的路由不存在","data":{"path":"/nope""#));
    }
}
