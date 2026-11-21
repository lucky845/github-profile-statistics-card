//! `src/utils/` 的 Rust 实现。
//!
//! 纯 Rust 库：napi 绑定、wire 桥与 cdylib 已移除，理由见 `svg/src/lib.rs` 的模块注释。
//! 服务端只经 `port::` 调用。

#![forbid(unsafe_code)]

pub mod js;
pub mod port;

pub use port::{
    create_request, create_request_logger_middleware, enc_wbi, first_string, format_count,
    format_percent,
};
