//! Vercel entry point.
//!
//! Vercel's Rust runtime compiles each file in `api/` into one serverless function and hands it
//! requests through a bridge. `api/index.rs` is the only one: `vercel.json` rewrites every path
//! to it, so the router in `app::router()` — the exact same stack `src/main.rs` serves over TCP —
//! answers the whole surface (cards, cache endpoints, metrics, 404s) from one function.
//!
//! The reason it is one function and not one-per-route: this app is a front door whose behaviour
//! depends on the path being *unmatched* in specific ways (case-insensitive mounts, one trailing
//! slash, `//` folding, a 404 that inspects the original path). Splitting it across functions
//! would move routing into Vercel's rewrite table, and the semantics being reproduced here are
//! precisely the ones a rewrite table cannot express.

use app::{router, servers};
use tower::ServiceBuilder;
use vercel_runtime::axum::VercelLayer;
use vercel_runtime::run;

#[tokio::main]
async fn main() -> Result<(), vercel_runtime::Error> {
    // Same bookkeeping the TCP binary does: replay asks a build to prove it counts fallbacks, and
    // this one proves it by answering none.
    servers::report_fallbacks();

    let app = ServiceBuilder::new()
        .layer(VercelLayer::new())
        .service(router());
    run(app).await
}
