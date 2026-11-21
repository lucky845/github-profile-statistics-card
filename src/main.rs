//! Vercel 入口（也是本 crate 的默认二进制）。
//!
//! Vercel 的 Rust 框架按 `Cargo.toml` + `src/main.rs` 两个文件检测项目，检测到之后由
//! `@vercel/rust` 构建器负责编译，并用它的 IPC proxy 与这个进程通信 —— 进程只需要监听
//! `$PORT`，协议由 proxy 转换，**不需要 `vercel_runtime` crate**。
//!
//! 之前用 `api/index.rs` + `vercel_runtime` 是照文档的 "api handler" 路线写的，但那条路要求
//! 项目被识别成 Rust 框架；而检测条件是 `Cargo.toml` 与 `src/main.rs` 同时存在，两者缺一
//! 就检测不到，手动选 `Other` 也不会挂上 Rust 构建器 —— 表现就是"选了也不运行"。
//!
//! 现在文件放在 `src/main.rs`，满足检测条件；监听逻辑与 `rust/app` 的 TCP 二进制完全一样，
//! 它们共用 `app::router()` 那一份路由栈，所以两条部署路径的行为不会漂移。

use std::net::SocketAddr;

use axum::serve::ListenerExt;
use app::{router, servers};

#[tokio::main]
async fn main() {
    // 与 TCP 二进制做同样的记账：replay 需要一个 build 证明它会数 fallback，
    // 这个 build 用"一个都不转发"来证明。
    servers::report_fallbacks();

    // Vercel 通过 PORT 注入端口；本地直接跑时缺省 8080。
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(8080);

    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port)))
        .await
        .expect("binding the port");
    // 限流按 X-Forwarded-For 分桶，缺省回落到对端地址，所以这里要把对端暴露给上层。
    let listener = listener.tap_io(|tcp| {
        let _ = tcp.set_nodelay(true);
    });

    axum::serve(
        listener,
        router().into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(servers::shutdown_signal())
    .await
    .expect("serving");
}
