//! The LeetCode card, answered in Rust.
//!
//! registry.ts asks the region the request named first (US unless ?cn=true), then the other one,
//! and only reports failure when both regions miss. Both endpoints are a single GraphQL POST, so
//! the whole path lives here; validation and the 404 pages belong to handlers.

use std::sync::OnceLock;
use std::time::Duration;

use axum::response::Response;
use serde_json::{Map, Value, json};

use super::github::theme_name;
use super::handlers::{CardOutcome, card_reply};
use super::json::js_number;

/// The cache policy leetcode.controller.ts asks for (its CACHE_SPECS entry is 1800s).
const SUCCESS_CACHE: &str = "public, max-age=300, s-maxage=1800, stale-while-revalidate=86400";

/// createRequest(5000): a single attempt may take five seconds.
const UPSTREAM_TIMEOUT_MS: u64 = 5000;

/// This platform's name in `registry`. Both the route and the /stats tally read it, so a
/// rename cannot update one and leave the other counting into a name nobody publishes.
pub const PLATFORM: &str = "leetcode";

/// createRequestWithRetry(.., 2, 800): two attempts, 800ms apart.
const ATTEMPTS: u32 = 2;
const RETRY_DELAY_MS: u64 = 800;

const US_URL: &str = "https://leetcode.com/graphql";
const CN_URL: &str = "https://leetcode.cn/graphql";

const US_QUERY: &str = "query userProblemsSolved($username: String!) { matchedUser(username: $username) { submitStats { acSubmissionNum { difficulty count submissions } totalSubmissionNum { difficulty count submissions } } } }";

const CN_QUERY: &str = "query userProfileUserQuestionProgress($userSlug: String!) { userProfileUserQuestionProgress(userSlug: $userSlug) { numAcceptedQuestions { difficulty count } numFailedQuestions { difficulty count } numUntouchedQuestions { difficulty count } } }";

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_millis(UPSTREAM_TIMEOUT_MS))
            .build()
            .unwrap_or_default()
    })
}

/// The acceptance rate string the original builds: one decimal place, or a bare 0% when the user
/// never submitted anything.
fn acceptance_rate(accepted: f64, submissions: f64) -> String {
    if submissions > 0.0 {
        format!("{:.1}%", accepted / submissions * 100.0)
    } else {
        "0%".to_string()
    }
}

/// The sum of one submission list, the way forEach over submissions || 0 adds it up.
fn submissions_total(items: &Value) -> f64 {
    items
        .as_array()
        .map(|rows| {
            rows.iter()
                .map(|row| js_number(row.get("submissions")))
                .sum()
        })
        .unwrap_or(0.0)
}

/// count for one difficulty in an acSubmissionNum list.
fn count_of(items: &Value, difficulty: &str) -> f64 {
    items
        .as_array()
        .and_then(|rows| {
            rows.iter()
                .find(|row| row.get("difficulty").and_then(Value::as_str) == Some(difficulty))
        })
        .map(|row| js_number(row.get("count")))
        .unwrap_or(0.0)
}

/// processUSLeetCodeResponse: only matchedUser.submitStats.acSubmissionNum has to be present; the
/// rate is summed over every difficulty, not read off the All row.
fn process_us(user_data: &Value, username: &str) -> Result<Value, String> {
    let accepted = user_data
        .get("submitStats")
        .and_then(|stats| stats.get("acSubmissionNum"))
        .filter(|value| value.is_array());
    let Some(accepted) = accepted else {
        return Err("用户数据格式无效".to_string());
    };
    let totals = user_data
        .get("submitStats")
        .and_then(|stats| stats.get("totalSubmissionNum"))
        .unwrap_or(&Value::Null);
    Ok(json!({
        "region": "US",
        "username": username,
        "totalSolved": count_of(accepted, "All"),
        "easySolved": count_of(accepted, "Easy"),
        "mediumSolved": count_of(accepted, "Medium"),
        "hardSolved": count_of(accepted, "Hard"),
        "acceptanceRate": acceptance_rate(submissions_total(accepted), submissions_total(totals)),
    }))
}

/// processCNLeetCodeResponse: the CN endpoint reports solved / failed / untouched per difficulty,
/// so the headline total is their sum and totalProblems only exists when that sum is non-zero.
fn process_cn(progress: &Value, username: &str) -> Result<Value, String> {
    let accepted = progress
        .get("numAcceptedQuestions")
        .filter(|value| value.is_array());
    let Some(accepted) = accepted else {
        return Err("用户数据格式无效".to_string());
    };
    let rows = |list: Option<&Value>| -> Vec<Value> {
        list.and_then(Value::as_array).cloned().unwrap_or_default()
    };
    let failed = rows(progress.get("numFailedQuestions"));
    let untouched = rows(progress.get("numUntouchedQuestions"));

    let total_solved: f64 = accepted
        .as_array()
        .map(|items| items.iter().map(|row| js_number(row.get("count"))).sum())
        .unwrap_or(0.0);
    let failed_total: f64 = failed.iter().map(|row| js_number(row.get("count"))).sum();
    let total_attempted = total_solved + failed_total;

    let sum_for = |difficulty: &str| -> f64 {
        [Some(accepted), Some(&Value::Array(failed.clone())), Some(&Value::Array(untouched.clone()))]
            .into_iter()
            .flatten()
            .map(|list| count_of(list, difficulty))
            .sum()
    };
    let easy_total = sum_for("EASY");
    let medium_total = sum_for("MEDIUM");
    let hard_total = sum_for("HARD");

    let mut payload = Map::new();
    payload.insert("region".into(), Value::String("CN".into()));
    payload.insert("username".into(), Value::String(username.into()));
    payload.insert("totalSolved".into(), json!(total_solved));
    payload.insert("easySolved".into(), json!(count_of(accepted, "EASY")));
    payload.insert("mediumSolved".into(), json!(count_of(accepted, "MEDIUM")));
    payload.insert("hardSolved".into(), json!(count_of(accepted, "HARD")));
    payload.insert(
        "acceptanceRate".into(),
        Value::String(acceptance_rate(total_solved, total_attempted)),
    );
    if easy_total + medium_total + hard_total > 0.0 {
        payload.insert(
            "totalProblems".into(),
            json!({ "easy": easy_total, "medium": medium_total, "hard": hard_total }),
        );
    }
    Ok(Value::Object(payload))
}

/// One GraphQL POST with the original's retry policy: a 4xx is a deterministic failure and stops
/// immediately, anything else gets a second attempt after 800ms.
async fn post(url: &str, origin: &str, referer: &str, query: &str, variables: Value) -> Option<Value> {
    let body = json!({ "query": query, "variables": variables });
    // One bump per region attempt, which is where the original puts it: inside the region's try
    // block, ahead of createRequestWithRetry, so the retries inside a region do not count again.
    super::metrics::note_external_call(PLATFORM);
    for attempt in 0..ATTEMPTS {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(RETRY_DELAY_MS)).await;
        }
        let Ok(response) = client()
            .post(url)
            .header("Content-Type", "application/json")
            .header("Origin", origin)
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

/// fetchLeetCodeStats for one region, already reduced to its data payload.
async fn fetch_region(username: &str, use_cn: bool) -> Result<Value, String> {
    let (url, origin, referer, query) = if use_cn {
        (
            CN_URL,
            "https://leetcode.cn",
            format!("https://leetcode.cn/u/{username}/"),
            CN_QUERY,
        )
    } else {
        (
            US_URL,
            "https://leetcode.com",
            format!("https://leetcode.com/{username}/"),
            US_QUERY,
        )
    };
    let variables = if use_cn {
        json!({ "userSlug": username })
    } else {
        json!({ "username": username })
    };
    let missing = if use_cn {
        "未找到中国区LeetCode用户数据"
    } else {
        "未找到美国区LeetCode用户数据"
    };
    let Some(body) = post(url, origin, &referer, query, variables).await else {
        return Err(missing.to_string());
    };
    if use_cn {
        match body.pointer("/data/userProfileUserQuestionProgress") {
            Some(progress) => process_cn(progress, username),
            None => Err(missing.to_string()),
        }
    } else {
        match body.pointer("/data/matchedUser") {
            Some(user_data) => process_us(user_data, username),
            None => Err(missing.to_string()),
        }
    }
}

/// The registry's two-region probe: ask the requested region, then the other one, and give up only
/// after both miss. The region label always names the region that actually answered.
async fn load(username: &str, use_cn: bool) -> Option<Value> {
    if let Ok(data) = fetch_region(username, use_cn).await {
        return Some(data);
    }
    fetch_region(username, !use_cn).await.ok()
}

/// GET /leetcode/:username, after validateLeetCodeUsername let the name through.
pub async fn card(
    id: &str,
    raw_theme: Option<&str>,
    key: String,
    use_cn: bool,
) -> Response {
    let theme = theme_name(raw_theme);
    match load(id, use_cn).await {
        Some(payload) => card_reply(
            "leetcode",
            CardOutcome::Rendered(payload),
            theme,
            key,
            SUCCESS_CACHE,
        ),
        // Both regions failed, so registry.ts reports UPSTREAM_ERROR: 200, a short TTL and the
        // generic unavailable copy -- not the per-platform no-data card.
        None => card_reply(
            "leetcode",
            CardOutcome::UpstreamError,
            theme,
            key,
            SUCCESS_CACHE,
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sums_every_difficulty_for_the_rate() {
        let accepted = json!([
            { "difficulty": "All", "count": 45, "submissions": 64 },
            { "difficulty": "Easy", "count": 12, "submissions": 24 },
            { "difficulty": "Medium", "count": 22, "submissions": 26 },
            { "difficulty": "Hard", "count": 11, "submissions": 14 }
        ]);
        assert_eq!(submissions_total(&accepted), 128.0);
        assert_eq!(acceptance_rate(128.0, 235.0), "54.5%");
        assert_eq!(acceptance_rate(0.0, 0.0), "0%");
    }

    #[test]
    fn reads_the_all_row_for_the_us_headline() {
        let payload = json!({
            "submitStats": {
                "acSubmissionNum": [
                    { "difficulty": "All", "count": 45, "submissions": 64 },
                    { "difficulty": "Easy", "count": 12, "submissions": 24 }
                ],
                "totalSubmissionNum": [ { "difficulty": "All", "count": 60, "submissions": 118 } ]
            }
        });
        let data = process_us(&payload, "leetcode").expect("a complete payload");
        assert_eq!(data["totalSolved"], json!(45.0));
        assert_eq!(data["easySolved"], json!(12.0));
        assert_eq!(data["region"], json!("US"));
    }

    #[test]
    fn a_us_payload_without_submit_stats_is_an_error() {
        assert!(process_us(&json!({}), "leetcode").is_err());
        assert!(process_us(&json!({ "submitStats": { "acSubmissionNum": null } }), "x").is_err());
    }

    #[test]
    fn the_cn_headline_adds_all_three_buckets() {
        let progress = json!({
            "numAcceptedQuestions": [
                { "difficulty": "EASY", "count": 12 },
                { "difficulty": "MEDIUM", "count": 22 },
                { "difficulty": "HARD", "count": 11 }
            ],
            "numFailedQuestions": [
                { "difficulty": "EASY", "count": 3 },
                { "difficulty": "MEDIUM", "count": 12 }
            ],
            "numUntouchedQuestions": [ { "difficulty": "EASY", "count": 7 } ]
        });
        let data = process_cn(&progress, "leetcode").expect("a complete payload");
        assert_eq!(data["totalSolved"], json!(45.0));
        assert_eq!(data["acceptanceRate"], json!("75.0%"));
        assert_eq!(data["totalProblems"]["easy"], json!(22.0));
    }

    #[test]
    fn the_cn_progress_omits_total_problems_when_nothing_is_known() {
        let progress = json!({ "numAcceptedQuestions": [] });
        let data = process_cn(&progress, "nobody").expect("an empty progress is valid");
        assert!(data.get("totalProblems").is_none());
    }
}