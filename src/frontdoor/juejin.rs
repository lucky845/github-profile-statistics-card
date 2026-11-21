//! The Juejin card, answered in Rust.
//!
//! juejin.service.ts asks two endpoints in parallel, refuses the empty shell the API now returns,
//! and rethrows the upstream error message; registry.ts then sorts that message into a reason by
//! keyword. Today every call lands in the "no data" branch, but the sorting is reproduced so the
//! card keeps following the upstream instead of pinning today's answer.

use std::sync::OnceLock;
use std::time::Duration;

use axum::response::Response;
use serde_json::{Value, json};

use super::github::theme_name;
use super::handlers::{CardOutcome, card_reply};
use super::json::js_number;

/// The cache policy juejin.controller.ts asks for on success.
const SUCCESS_CACHE: &str = "public, max-age=300, s-maxage=600, stale-while-revalidate=86400";

/// createRequest(5000): a single attempt may take five seconds.
const UPSTREAM_TIMEOUT_MS: u64 = 5000;

/// createRequestWithRetry(.., 3, 1000): three attempts, backing off 1s then 2s.
const ATTEMPTS: u32 = 3;
const RETRY_DELAY_MS: u64 = 1000;

const USER_URL: &str = "https://api.juejin.cn/user_api/v1/user/get?user_id=";
const ARTICLES_URL: &str = "https://api.juejin.cn/content_api/v1/article/query_list";

/// registry.ts treats these messages as "the API is alive, this person just has no data".
const NO_DATA_HINTS: [&str; 7] = [
    "空壳数据",
    "参数错误",
    "用户不存在",
    "不存在",
    "安全验证页",
    "风控",
    "已失效",
];

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_millis(UPSTREAM_TIMEOUT_MS))
            .build()
            .unwrap_or_default()
    })
}

/// A GET with the original's retry policy: a 4xx is deterministic and stops immediately, anything
/// else gets another attempt after an exponentially growing delay.
async fn get_json(url: &str, referer: &str) -> Option<Value> {
    for attempt in 0..ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(RETRY_DELAY_MS << (attempt - 1))).await;
        }
        let Ok(response) = client()
            .get(url)
            .header("Origin", "https://juejin.cn")
            .header("Referer", referer)
            .send()
            .await
        else {
            continue;
        };
        let status = response.status().as_u16();
        if (400..500).contains(&status) {
            return None;
        }
        if !response.status().is_success() {
            continue;
        }
        if let Ok(parsed) = response.json::<Value>().await {
            return Some(parsed);
        }
    }
    None
}

/// The article list POST, same retry policy as the user call.
async fn post_json(referer: &str, user_id: &str) -> Option<Value> {
    let body = json!({
        "user_id": user_id,
        "cursor": "0",
        "sort_type": 2,
        "limit": 20,
    });
    for attempt in 0..ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(RETRY_DELAY_MS << (attempt - 1))).await;
        }
        let Ok(response) = client()
            .post(ARTICLES_URL)
            .header("Origin", "https://juejin.cn")
            .header("Referer", referer)
            .json(&body)
            .send()
            .await
        else {
            continue;
        };
        let status = response.status().as_u16();
        if (400..500).contains(&status) {
            return None;
        }
        if !response.status().is_success() {
            continue;
        }
        if let Ok(parsed) = response.json::<Value>().await {
            return Some(parsed);
        }
    }
    None
}

/// err_no / err_msg from the response envelope, defaulting the way the original's || does.
fn err_no(body: &Value) -> f64 {
    js_number(body.get("err_no"))
}

fn err_msg(body: &Value) -> Option<&str> {
    body.get("err_msg").and_then(Value::as_str)
}

/// The whole fetch, reduced to the payload the renderer wants or the message registry.ts reads.
async fn fetch(user_id: &str) -> Result<Value, String> {
    let referer = format!("https://juejin.cn/user/{user_id}");
    let user_url = format!("{USER_URL}{user_id}");
    let (user_response, articles_response) =
        tokio::join!(get_json(&user_url, &referer), post_json(&referer, user_id));

    let Some(user_response) = user_response else {
        return Err("获取掘金数据失败: 用户信息接口无响应".to_string());
    };
    if err_no(&user_response) != 0.0 {
        return Err(err_msg(&user_response).unwrap_or("获取用户信息失败").to_string());
    }
    // The shape guard: the API answers err_no 0 with user_id '0' and every counter zero.
    let probe = user_response.get("data").filter(|value| value.is_object());
    let probe_ok = probe
        .map(|data| {
            let raw_id = data.get("user_id").cloned().unwrap_or(Value::Null);
            let id_is_zero = match &raw_id {
                Value::Number(n) => n.as_f64().unwrap_or(0.0) == 0.0,
                Value::String(s) => s == "0",
                Value::Null => true,
                _ => false,
            };
            let has_name = data
                .get("user_name")
                .and_then(Value::as_str)
                .map(|name| !name.is_empty())
                .unwrap_or(false);
            !id_is_zero && has_name
        })
        .unwrap_or(false);
    if !probe_ok {
        return Err("掘金接口已失效：返回空壳数据（user_id=0）".to_string());
    }
    let data = probe.expect("checked above");

    let Some(articles_response) = articles_response else {
        return Err("获取文章列表失败".to_string());
    };
    if err_no(&articles_response) != 0.0 {
        return Err(err_msg(&articles_response).unwrap_or("获取文章列表失败").to_string());
    }

    let count = match articles_response.get("count") {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
        _ => 0.0,
    };
    let escaped_user_id = data.get("user_id").cloned().unwrap_or(Value::Null);
    Ok(json!({
        "userId": escaped_user_id,
        "username": data.get("user_name").cloned().unwrap_or(Value::Null),
        "desc": data.get("description").cloned().unwrap_or(Value::String(String::new())),
        "followers": js_number(data.get("follower_count")),
        "likes": js_number(data.get("got_digg_count")),
        "views": js_number(data.get("got_view_count")),
        "articleCount": count,
    }))
}

/// registry.ts's classification of a thrown message.
fn classify(message: &str) -> CardOutcome {
    if message.contains("超时") {
        return CardOutcome::UpstreamError;
    }
    if is_no_data(message) {
        return CardOutcome::UpstreamUnavailable;
    }
    CardOutcome::UpstreamError
}

/// GET /juejin/:user_id. There is no validation middleware on this route, so the id reaches the
/// service untouched.
pub async fn card(id: &str, raw_theme: Option<&str>, key: String) -> Response {
    let theme = theme_name(raw_theme);
    let outcome = match fetch(id).await {
        Ok(payload) => CardOutcome::Rendered(payload),
        Err(message) => classify(&message),
    };
    card_reply("juejin", outcome, theme, key, SUCCESS_CACHE)
}

fn is_no_data(message: &str) -> bool {
    NO_DATA_HINTS.iter().any(|hint| message.contains(hint))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_no_data_hints_are_the_ones_registry_lists() {
        assert!(is_no_data("参数错误"));
        assert!(is_no_data("掘金接口已失效：返回空壳数据（user_id=0）"));
        assert!(!is_no_data("获取掘金数据失败: connect ECONNREFUSED"));
    }

    #[test]
    fn a_parameter_error_becomes_the_no_data_card() {
        assert!(matches!(classify("参数错误"), CardOutcome::UpstreamUnavailable));
        assert!(matches!(
            classify("获取掘金数据失败且无缓存: 网络异常"),
            CardOutcome::UpstreamError
        ));
        assert!(matches!(classify("掘金数据获取超时"), CardOutcome::UpstreamError));
    }

    #[test]
    fn the_shape_guard_rejects_the_empty_shell() {
        let shell = json!({ "err_no": 0, "data": { "user_id": "0", "user_name": "" } });
        assert_eq!(err_no(&shell), 0.0);
        let data = shell.get("data").unwrap();
        assert_eq!(data.get("user_id").and_then(Value::as_str), Some("0"));
    }
}