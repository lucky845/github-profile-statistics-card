//! Server-level plumbing.
//!
//! This module is what is left of `original.rs`, which started the Node build on a free port and
//! proxied the requests Rust had not ported. Nothing is left to proxy, so the process no longer
//! spawns anything; what survives is the two pieces of operating discipline that were useful on
//! their own: telling replay that this build reports fallbacks, and stopping cleanly on a signal.

/// The environment variable `rust-anything app replay` sets to read a build's fallback log.
const FALLBACK_LOG: &str = "RUST_ANYTHING_FALLBACK_LOG";

/// Opens the fallback log so replay can see the build counts fallbacks -- here, always zero.
pub fn report_fallbacks() {
    let _ = log();
}

fn log() -> Option<std::fs::File> {
    let path = std::env::var_os(FALLBACK_LOG)?;
    std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .ok()
}

/// Ctrl-C or SIGTERM: stop taking requests and finish the open ones.
pub async fn shutdown_signal() {
    #[cfg(unix)]
    {
        let mut term = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("a SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = term.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
