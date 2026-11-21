//! The whole front door, in one place.
//!
//! Two entry points share this: `src/main.rs` serves it over TCP (Docker, local dev), and
//! `api/index.rs` hands it to Vercel's Rust runtime. Keeping the stack here rather than in
//! `main.rs` is what guarantees the two deployments answer identically — a layer added in one
//! place cannot be forgotten in the other.

pub mod frontdoor;
pub mod servers;
pub mod units;

/// The routed stack, in the order the original Express app mounts it.
///
/// axum wraps with the last layer added, so the routed stack reads from the outside in as: origin
/// echo, cache, metrics, ratelimit.
///
/// - `preflight` answers OPTIONS before anything else, which is what the cors package does:
///   express registers the cors middleware app-wide, so an OPTIONS request is short-circuited to
///   204 and never reaches a route, the cache or the counter.
/// - cache then metrics mirror createCacheMiddleware before metricsMiddleware, so a cache HIT
///   returns before it is ever counted.
/// - ratelimit sits next, mirroring the five `app.use('/prefix', apiRateLimiter)` mounts: inside
///   the cache, so a HIT never charges the bucket, and outside the routes, so a refused request is
///   answered with the degraded card instead of ever reaching a handler.
/// - the origin echo sits outermost of the four, so a HIT still carries the ACAO: the original's
///   cors runs at app.use time, before the cache can short-circuit, and the header survives the
///   replay because the cache only overwrites what it stored.
pub fn router() -> axum::Router {
    let routes = frontdoor::router()
        .merge(units::router())
        .layer(axum::middleware::from_fn(frontdoor::ratelimit::middleware))
        .layer(axum::middleware::from_fn(frontdoor::metrics::middleware))
        .layer(axum::middleware::from_fn(frontdoor::cache::middleware))
        // The origin echo wraps the cache rather than sitting under it, because a HIT never
        // reaches anything inside the cache: the original's cors runs at app.use time, so res
        // already carries Access-Control-Allow-Origin when the cache short-circuits and replays it.
        .layer(axum::middleware::from_fn(frontdoor::cors::headers));
    // `preflight` goes around the routed service rather than into it: axum writes `Allow` onto a
    // response after the route's handler returns, so a layer mounted inside the router would have
    // its correction overwritten. Wrapping the router as a fallback service puts this layer after
    // every route has finished, which is where Express's cors middleware effectively sits.
    //
    // The path rewrite has to sit out here as well, for a reason that is not obvious: layers
    // applied to a Router run per route, after axum has already decided which route the path
    // belongs to. A rewrite inside that stack could change the URL a handler sees but never the
    // match, and the match is the whole point. Out here it runs before any matching happens at
    // all, so the cache and the routes both see one path — the rewritten one — while the cache
    // remembers the original in the request extensions and keys on that, exactly as req.path does
    // in the original.
    axum::Router::new()
        .fallback_service(routes)
        .layer(axum::middleware::from_fn(frontdoor::paths::middleware))
        .layer(axum::middleware::from_fn(frontdoor::cors::preflight))
}
