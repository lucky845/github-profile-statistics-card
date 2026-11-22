//! The one place a platform is described.
//!
//! Before this module the same fact — "which platforms exist" — lived in six places:
//!
//! - `keys::PLATFORMS`, the mount list the router walks
//! - the `if platform == "..."` chain in `handlers::dispatch`, which picked the card function
//! - `ratelimit::PREFIXES`, which decided whether the limiter applies
//! - `platforms::port::ENTRIES`, which rendered the home page gallery
//! - the `match key.as_str()` in `svg::port::generate_card`
//! - the validator table in `handlers::not_found`'s hardcoded prefix array
//!
//! They drifted, and the drift was not theoretical: juejin was registered in `PLATFORMS` and in
//! the gallery, but not in the 404 handler's copy, so `GET /juejin/` answered JSON where every
//! other platform answered a card (fixed in #52). The Node original had the same shape of bug
//! (`src/services/platforms/registry.ts` plus a hardcoded list in `error.middleware.ts:168`), so
//! this is a structural problem rather than a porting accident.
//!
//! The descriptor is a `const` table of function pointers, not a trait object. The reasoning is in
//! the port notes, but the short version: this is one binary that is compiled with every platform
//! known, there is no plugin loading, and dynamic dispatch would buy nothing but a vtable.
//!
//! Layering: this module lives in the app crate because validators (`is_github_name`,
//! `sanitize_id`) and card functions (`github::card` …) are app-crate items. That means
//! `platforms::port::render_gallery` must take its entries as an argument instead of holding its
//! own copy — otherwise the `platforms` crate would have to depend on `frontdoor`, which is the
//! wrong direction.

use std::future::Future;
use std::pin::Pin;

use axum::response::Response;

use super::{bilibili, csdn, github, juejin, keys, leetcode};

/// The future a card function returns. Boxed because the descriptor stores a plain `fn`, and a
/// bare `async fn` has an unnameable return type that cannot appear in a `const` table.
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// What a card function needs from the request besides the id and the cache key.
pub struct CardCtx<'a> {
    pub theme: Option<&'a str>,
    /// LeetCode's `?cn=true`; every other platform ignores it.
    pub use_cn: bool,
}

pub type CardFn = for<'a> fn(&'a str, CardCtx<'a>, String) -> BoxFuture<'a, Response>;

/// How the platform middleware spells its cache key. Not cosmetic: github/leetcode/csdn go through
/// CacheKeyGenerator, which joins with colons, while juejin/bilibili hand-build `{p}_{id}_{theme}`.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum KeyStyle {
    Colon,
    Underscore,
}

/// Everything the rest of the app needs to know about one platform.
pub struct PlatformDesc {
    /// The path segment: `/github/:username`.
    pub name: &'static str,
    /// The route parameter's name, quoted in documentation.
    pub param: &'static str,
    // --- gallery ---
    pub title: &'static str,
    pub sample: &'static str,
    pub extra_query: &'static str,
    pub height: u32,
    // --- request handling ---
    pub key_style: KeyStyle,
    /// The 400 body when `valid` rejects the decoded id; `None` means no validator runs.
    pub rejects: Option<&'static str>,
    pub valid: fn(&str) -> bool,
    /// Rewrites the id before the upstream fetch. `None` hands the id over untouched.
    pub sanitize: Option<fn(&str) -> String>,
    /// Whether `?nocache=true` suppresses the platform key. Only the three routers built by
    /// createCacheMiddleware carry that option; juejin and bilibili hand-roll their middleware.
    pub nocache_skips_platform_key: bool,
    /// Whether a container-valued `?theme=` throws before the handler. `validateTheme` calls
    /// `.replace` on whatever the query holds; juejin's router has no `validateTheme`.
    pub container_theme_fatal: bool,
    pub card: CardFn,
}

// The wrappers exist so the table can hold one fn pointer per platform while the async fns keep
// their own signatures (LeetCode's extra `use_cn`, for instance).

fn card_github<'a>(id: &'a str, ctx: CardCtx<'a>, key: String) -> BoxFuture<'a, Response> {
    Box::pin(github::card(id, ctx.theme, key))
}

fn card_leetcode<'a>(id: &'a str, ctx: CardCtx<'a>, key: String) -> BoxFuture<'a, Response> {
    Box::pin(leetcode::card(id, ctx.theme, key, ctx.use_cn))
}

fn card_csdn<'a>(id: &'a str, ctx: CardCtx<'a>, key: String) -> BoxFuture<'a, Response> {
    Box::pin(csdn::card(id, ctx.theme, key))
}

fn card_juejin<'a>(id: &'a str, ctx: CardCtx<'a>, key: String) -> BoxFuture<'a, Response> {
    Box::pin(juejin::card(id, ctx.theme, key))
}

fn card_bilibili<'a>(id: &'a str, ctx: CardCtx<'a>, key: String) -> BoxFuture<'a, Response> {
    Box::pin(bilibili::card(id, ctx.theme, key))
}

fn no_validation(_: &str) -> bool {
    true
}

fn accepts_generic_id(id: &str) -> bool {
    !sanitize_id(id).is_empty()
}

/// The GitHub username rule: two to thirty-nine characters, alphanumeric with inner hyphens.
pub fn is_github_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    if bytes.len() < 2 || bytes.len() > 39 {
        return false;
    }
    bytes[0].is_ascii_alphanumeric()
        && bytes[bytes.len() - 1].is_ascii_alphanumeric()
        && bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b'-')
}

/// The LeetCode username rule: one to thirty word characters or hyphens.
pub fn is_leetcode_name(name: &str) -> bool {
    let bytes = name.as_bytes();
    !bytes.is_empty()
        && bytes.len() <= 30
        && bytes
            .iter()
            .all(|b| b.is_ascii_alphanumeric() || *b == b'_' || *b == b'-')
}

/// Keep only the characters the generic validator accepts.
pub fn sanitize_id(name: &str) -> String {
    name.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect()
}

/// Every platform, in gallery order.
///
/// Order is observable on the home page, whose recorded body has github first. It does not affect
/// routing: no name is a prefix of another, so `platform_of` finds the same entry in any order.
///
/// `name` is not a literal here but the platform module's own `PLATFORM` constant. That constant
/// is also what the module passes to `metrics::note_external_call`, so the route name and the
/// /stats tally key are the same string by construction -- renaming one cannot leave the other
/// counting into a key nobody publishes.
pub const PLATFORMS: [PlatformDesc; 5] = [
    PlatformDesc {
        name: github::PLATFORM,
        param: "username",
        title: "GitHub 统计",
        sample: "lucky845",
        extra_query: "",
        height: 200,
        key_style: KeyStyle::Colon,
        rejects: Some("无效的GitHub用户名格式"),
        valid: is_github_name,
        sanitize: None,
        nocache_skips_platform_key: true,
        container_theme_fatal: true,
        card: card_github,
    },
    PlatformDesc {
        name: leetcode::PLATFORM,
        param: "username",
        title: "LeetCode 统计",
        sample: "lucky845",
        extra_query: "&cn=true",
        height: 200,
        key_style: KeyStyle::Colon,
        rejects: Some("无效的LeetCode用户名格式"),
        valid: is_leetcode_name,
        sanitize: None,
        nocache_skips_platform_key: true,
        container_theme_fatal: true,
        card: card_leetcode,
    },
    PlatformDesc {
        name: csdn::PLATFORM,
        param: "userId",
        title: "CSDN 统计",
        sample: "testuser",
        extra_query: "",
        height: 200,
        key_style: KeyStyle::Colon,
        rejects: Some("用户 ID 非法"),
        valid: accepts_generic_id,
        // validateGenericUsername rewrites the route parameter before the handler runs, so the
        // upstream fetch sees the clean id.
        sanitize: Some(sanitize_id),
        nocache_skips_platform_key: true,
        container_theme_fatal: true,
        card: card_csdn,
    },
    PlatformDesc {
        name: juejin::PLATFORM,
        param: "user_id",
        title: "掘金统计",
        sample: "testuser",
        extra_query: "",
        height: 200,
        key_style: KeyStyle::Underscore,
        // This router carries no validators, so the id reaches the service as it arrived.
        rejects: None,
        valid: no_validation,
        sanitize: None,
        nocache_skips_platform_key: false,
        container_theme_fatal: false,
        card: card_juejin,
    },
    PlatformDesc {
        name: bilibili::PLATFORM,
        param: "uid",
        title: "哔哩哔哩统计",
        sample: "89389361",
        extra_query: "",
        height: 200,
        key_style: KeyStyle::Underscore,
        rejects: Some("用户 ID 非法"),
        valid: accepts_generic_id,
        sanitize: Some(sanitize_id),
        nocache_skips_platform_key: false,
        container_theme_fatal: true,
        card: card_bilibili,
    },
];

/// Every registered platform, in gallery order.
pub fn all() -> &'static [PlatformDesc] {
    &PLATFORMS
}

/// The `X-Cache-Key` a platform answers with, built the way its own middleware builds it.
///
/// Extracted from the dispatcher so the separator rule is testable without a request: the two
/// key styles differ only in which character joins the parts, and that is exactly the kind of
/// detail a new platform gets wrong in one line and no test notices.
///
/// `theme_text` is the query's stringified theme (CacheKeyGenerator's reading); `theme_first` is
/// its first element (firstString's reading). The routers that join with underscores use the
/// latter, which is why both are taken here rather than resolved by the caller.
pub fn cache_key_for(
    desc: &PlatformDesc,
    id: &str,
    theme_text: &str,
    theme_first: &str,
) -> Option<String> {
    match desc.key_style {
        KeyStyle::Underscore => keys::underscore_key(
            desc.name,
            id,
            if theme_first.is_empty() {
                "default"
            } else {
                theme_first
            },
        ),
        KeyStyle::Colon => keys::platform_key(
            desc.name,
            id,
            if theme_text.is_empty() {
                "default"
            } else {
                theme_text
            },
        ),
    }
}

/// The platform a raw path belongs to, if any. Express mounts each router on a prefix with a
/// segment boundary, so `/githubx` belongs to no one while `/github` and `/github/…` belong to github.
pub fn platform_of(raw_path: &str) -> Option<&'static PlatformDesc> {
    PLATFORMS.iter().find(|desc| {
        raw_path == format!("/{}", desc.name) || raw_path.starts_with(&format!("/{}/", desc.name))
    })
}

/// The gallery rows, derived from the same table so a new platform shows up on the home page
/// without a second edit.
pub fn gallery_entries() -> [platforms::port::GalleryEntry; 5] {
    PLATFORMS.map(|desc| platforms::port::GalleryEntry {
        title: desc.title,
        path: desc.name,
        sample: desc.sample,
        extra_query: desc.extra_query,
        height: desc.height,
    })
}

/// Prefix matching for the rate limiter, without allocating a `/name` string per comparison.
pub fn under_a_mount(path: &str) -> bool {
    let bytes = path.as_bytes();
    if bytes.first() != Some(&b'/') {
        return false;
    }
    PLATFORMS.iter().any(|desc| {
        let name = desc.name.as_bytes();
        if bytes.len() < name.len() + 1 {
            return false;
        }
        if !bytes[1..1 + name.len()].eq_ignore_ascii_case(name) {
            return false;
        }
        // A segment boundary: end of path, or a slash.
        bytes.len() == 1 + name.len() || bytes[1 + name.len()] == b'/'
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The table is what makes a new platform reach the router, the limiter, the 404 handler and
    /// the gallery at once. If two entries claim one name, one of them is dead and nothing fails.
    #[test]
    fn no_two_platforms_share_a_name() {
        for (i, a) in PLATFORMS.iter().enumerate() {
            for b in &PLATFORMS[i + 1..] {
                assert_ne!(a.name, b.name, "duplicate platform name {}", a.name);
            }
        }
    }

    /// `platform_of` walks the table in order, so a name that prefixes another would shadow it.
    #[test]
    fn no_platform_name_prefixes_another() {
        for a in &PLATFORMS {
            for b in &PLATFORMS {
                if a.name == b.name {
                    continue;
                }
                assert!(
                    !b.name.starts_with(a.name),
                    "{} would shadow {} in platform_of",
                    a.name,
                    b.name
                );
            }
        }
    }

    #[test]
    fn a_mount_matches_only_on_a_segment_boundary() {
        assert!(under_a_mount("/github"));
        assert!(under_a_mount("/github/octocat"));
        assert!(
            under_a_mount("/GitHub/octocat"),
            "mounts are case-insensitive"
        );
        assert!(!under_a_mount("/githubx/octocat"));
        assert!(!under_a_mount("/GitHubx"));
        assert!(!under_a_mount("/health"));
        assert!(!under_a_mount("github"));
    }

    #[test]
    fn platform_of_takes_the_mount_and_leaves_the_rest() {
        assert_eq!(
            platform_of("/github/octocat").map(|d| d.name),
            Some("github")
        );
        assert_eq!(platform_of("/github").map(|d| d.name), Some("github"));
        assert_eq!(platform_of("/githubx/octocat").map(|d| d.name), None);
        assert_eq!(platform_of("/health").map(|d| d.name), None);
    }

    /// The separator is a field, so a new platform can pick the wrong one in a single line.
    ///
    /// The expected string is spelled out per platform on purpose. Deriving it from `key_style`
    /// would only prove the field agrees with itself — flipping juejin to `Colon` still passed
    /// when this test read the separator back out of the descriptor.
    #[test]
    fn a_cache_key_uses_the_separator_the_original_used() {
        let expected = [
            ("github", "github:someone:dark"),
            ("leetcode", "leetcode:someone:dark"),
            ("csdn", "csdn:someone:dark"),
            // These two hand-roll their middleware and join with underscores.
            ("juejin", "juejin_someone_dark"),
            ("bilibili", "bilibili_someone_dark"),
        ];
        for (name, want) in expected {
            let desc = platform_of(&format!("/{name}/someone")).expect("a registered platform");
            let key = cache_key_for(desc, "someone", "dark", "dark").expect("a header-safe key");
            assert_eq!(key, want, "{name} joins its cache key the wrong way");
        }
    }

    /// An empty theme falls back to "default" in every style.
    #[test]
    fn an_empty_theme_falls_back_to_default() {
        for desc in PLATFORMS.iter() {
            let key = cache_key_for(desc, "someone", "", "").expect("a header-safe key");
            assert!(
                key.ends_with("someone:default") || key.ends_with("someone_default"),
                "{} produced {key:?} for an empty theme",
                desc.name
            );
        }
    }

    /// The gallery is derived from the table, so the two cannot drift apart again.
    #[test]
    fn the_gallery_has_one_row_per_platform_in_order() {
        let entries = gallery_entries();
        assert_eq!(entries.len(), PLATFORMS.len());
        for (entry, desc) in entries.iter().zip(PLATFORMS.iter()) {
            assert_eq!(entry.path, desc.name);
            assert_eq!(entry.title, desc.title);
        }
        assert_eq!(
            entries[0].path, "github",
            "the recorded home page starts with github"
        );
    }
}
