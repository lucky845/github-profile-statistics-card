# 贡献指南

感谢你考虑为 github-profile-statistics-card 项目做出贡献！

## 如何贡献

1. Fork 这个仓库
2. 创建特性分支（`git checkout -b feature/amazing-feature`）
3. 提交更改（`git commit -m 'Add some amazing feature'`）
4. 推送分支（`git push origin feature/amazing-feature`）
5. 开启一个 Pull Request

## 开发环境

**这是一个纯 Rust 项目。** 没有任何 `npm install`、没有 Node 运行时、没有 `node_modules`。

```bash
# 只需要 Rust 工具链（1.97+）。仓库根就是主 crate。
cargo build --workspace
cargo test  --workspace

# 启动本地服务（端口由 PORT 决定，缺省 8080）
PORT=8080 cargo run -p app
```

### 提交前必须全部通过

```bash
cargo build   --workspace
cargo test    --workspace
cargo clippy  --all-targets --workspace -- -D warnings
```

`-D warnings` 是硬门：CI 会因任何一条 lint 失败。**不要用 `#[allow]` 压掉警告**，按语义修。

### 行为契约：replay，不是手写断言

这个项目的正确性由 **153 条录制的 HTTP case** 定义，位于 `rust/app-cases/`：

```bash
# 用 rust-anything 重放，比对状态码、响应头与 body
# workspace 在仓库根，产物在 target/debug/app（不是 crates/ 下的 target）
rust-anything app replay --repo . --build target/debug/app
```

当前基线 **148/153**，5 条失败是录制期 Redis 残留键导致的 `x-cache-status HIT vs MISS`，**原始 Node 实现同样失败这 5 条**。

注意：这条基线是在**不配置 Redis** 的前提下录的。跑 replay 时不要设 `REDIS_*`，否则会读到真实缓存，`x-cache-status` 与录制值不符（那不是 bug）。

**改动前后都要跑一次 replay。** 如果你让分数下降，那不是"差一点"，是回归。

### 通配断言：别以为 replay 全绿就安全

有些端点的 body 在录制时被归一化成 `[..]`（完全通配），等于**没有断言**：

- `/health` 的 body（含 `database` 字段）
- `/api/cache/stats` 的数值
- 平台卡片的 `x-cache-key` / `x-cache-status` / `x-xss-protection`

改动这些地方时，**必须手工对拍**，不能拿"replay 还是绿的"当证据。

## 代码风格

- 注释写**为什么**，不写**做了什么**。一个解释"这行在干嘛"的注释是噪音；解释"为什么必须这样而不是那样"的注释才是资产。
- 与原始 Express 实现对齐的地方，**在注释里点名原始文件与行号**，否则下一个人会"顺手优化"掉一个刻意保留的怪行为。
- 纯函数优先，副作用收敛在 `frontdoor/` 的中间件里。

## 添加新主题

主题定义在 `crates/svg/src/port.rs` 的 `get_theme_config` 附近。加完主题后：

1. 在 `src/frontdoor/handlers.rs` 的 `THEMES` 常量里登记名字（否则会被当成未知主题回落到默认色）
2. 跑 `cargo test --workspace`
3. 手工开一次 `/api/theme/test?theme=你的主题` 确认渲染

## 添加新平台

1. `src/frontdoor/` 下新建模块，照抄 `github.rs` 的结构（validate → 上游取数 → `generate_card` → 响应头）
2. 在 `handlers.rs::dispatch` 里接线——**不接线就是 404**，这是刻意的：让遗漏暴露在测试里，而不是被静默吞掉
3. `keys.rs` 的 `PLATFORMS` 加上平台名与参数名
4. 若是新的缓存键形态，同步 `keys.rs` 的键生成；若是新的平台层缓存语义，同步缓存文档

## 报告 Bug

请在 GitHub Issues 中报告，并附上：

- 请求的完整路径与 query（含 `theme` 参数）
- 期望的响应与实际响应
- 如果涉及卡片渲染，贴出 SVG 或截图

## 功能请求

欢迎在 GitHub Issues 中提出。