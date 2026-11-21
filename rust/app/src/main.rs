use std::net::SocketAddr;

use axum::serve::ListenerExt;
use app::{router, servers};

#[tokio::main]
async fn main() {
    // Every route app.ts mounts is answered in Rust now, so there is no original process left to
    // start and no fallback to count. `report_fallbacks` still runs: replay asks a build to prove
    // it counts fallbacks, and this one proves it by answering none.
    servers::report_fallbacks();
    // The stack itself lives in `lib.rs`: Vercel's entry point builds the same one, so what runs
    // in a container and what runs in a serverless function cannot drift apart.
    let app = router();
    let port = std::env::var("PORT")
        .ok()
        .and_then(|p| p.parse().ok())
        .unwrap_or(8080);
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port)))
        .await
        .expect("binding the port");
    let listener = listener.tap_io(|tcp| {
        let _ = tcp.set_nodelay(true);
    });
    // The limiter keys its bucket by X-Forwarded-For when present and by the peer address
    // otherwise, so the service has to expose the peer to the layers above it.
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
        .with_graceful_shutdown(servers::shutdown_signal())
        .await
        .expect("serving");
}
