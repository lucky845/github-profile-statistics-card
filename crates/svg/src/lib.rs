//! `src/services/svg/` 的 Rust 实现。
//!
//! 这个 crate 现在是**纯 Rust 库**：没有 napi 绑定、没有 wire 桥、没有 cdylib。
//! 历史上它是 rust-anything 生成的桥接层——`lib.rs` 导出 `#[napi]` 函数给 `index.cjs`，
//! `wire.rs` 用共享内存传参，`build.rs` 调 `napi-build`。那三样东西的唯一消费者是
//! **录制/diff 工具**，而录制脚本指向的 `dist/`（原始 TS 编译产物）在本轮已经删除，
//! 桥接因此既不能运行也没有存在意义。
//!
//! 服务端（`rust/app`）从来只调用 `port::` 里的函数——`port.rs` 里 napi 出现次数是 0——
//! 所以删掉桥接对运行行为没有任何影响。

#![forbid(unsafe_code)]

pub mod js;
pub mod port;

// 便捷 re-export：app 里 `src_services_svg_::port::generate_card` 的写法保持可用。
pub use port::{generate_card, get_theme_config};
