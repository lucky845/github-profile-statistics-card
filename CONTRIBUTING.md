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
# 只需要 Rust 工具链（1.88+）。仓库根就是主 crate。
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

这个项目的正确性由 **153 条录制的 HTTP case** 定义，位于 `rust/app-cases/`。它们回答两个不同的问题，用两个不同的档位：

```bash
# 我这一改有没有搞坏东西？106 条纯本地，必须全绿。CI 跑的就是这一档。
./scripts/replay.sh gate

# 录制行为有没有漂移？全量 153 条，基线 148/153。依赖上游，会波动。
./scripts/replay.sh

# 只跑单个 case（快速迭代）
./scripts/replay.sh home
```

| 档位 | 条数 | 打上游 | 判定 | 用途 |
| --- | --- | --- | --- | --- |
| `gate` | 106 | 否 | 必须 106/106 | 改代码后的硬门，CI |
| 全量 | 153 | 是 | ≥148/153 | 查录制漂移 |

**为什么 `gate` 排掉 47 条**：46 条是卡片（每张都要打 GitHub / CSDN / 力扣），外加 `cache-stats`（上报本次 run 的 `hits`/`misses`/`keys`，天然依赖跑过哪些 case）。这 47 条与会话无关地依赖匿名配额、上游存活状态和录制当天日期——实测**同样的代码连跑两遍能给出 148 和 147 两种结果**（`trap-112-get-csdn` 在 CSDN 回 521 时渲染成"暂无数据"错误卡）。拿它当 CI 门只会制造与代码无关的红灯。

排除后剩下的 106 条可复现到什么程度：连跑 5 次全部 106/106；把 `x-frame-options` 从 `DENY` 改成 `SAMEORIGIN`，立刻 0/106。它会红，也会绿，所以不是装饰。

注意这 106 条**不需要钉时钟**（它们不断言卡片 footer），脚本仍然钉着，是为了让快照行为与全量档一致。

**基线 148/153**，5 条失败是 `x-cache-status` 的 `HIT` vs `MISS`——录制工具对每条 case 跑两遍，第二遍命中了第一遍写下的进程内 L1，于是基线里钉死的是 `HIT`。这是**采样副作用，不是行为差异**：在干净进程里录同一条路径，落下来的是 `MISS`（已实测，见下）。

### 为什么必须用脚本跑，而不是直接 `rust-anything app replay`

卡片的 footer 是 `更新于 {format_date_now()}`（`crates/svg/src/port.rs:213`），录制时把 **2026-11-21** 写死进了 25 个 `.body` 文件。日期一过，直接跑就是 **127/153**——而基线是 148/153。

`scripts/replay.sh` 通过 `crates/svg/src/port.rs:181` 已有的时钟注入点 `RUST_ANYTHING_WTS_OVERRIDE`（单位秒）把时钟钉回录制日（`1795219200` = 2026-11-21T00:00:00Z），26 条日期漂移的假失败随即消失，只剩下那 5 条已知差异。

另外两件脚本替你挡掉的事：

- **GitHub 匿名配额**：未设 `GITHUB_TOKEN` 时只有 60 次/小时。配额耗尽后，11 条 github case 会渲染成"数据源限流"错误卡，看上去像大面积回归。脚本会在配额低于 20 时警告。
- **别配 Redis**：这 5 条基线值来自进程内 L1，与 Redis 无关；但跑 replay 时设 `REDIS_*` 会让 L2 也参与读写，`x-cache-status` 更不稳定。保持不配即可。

**改动前后都要跑一次 replay。** 如果你让分数低于 148，那不是"差一点"，是回归——脚本会直接以非零码退出。

想自己验证那 5 条是采样副作用而不是缺陷，单跑一条并看它的 `x-cache-status`：

```bash
./scripts/replay.sh csdn-user          # 0/1，diff 只有 HIT -> MISS
```

再用干净进程录同一个路径，看落下来的是 `MISS` 还是 `HIT`：

```bash
echo '{"name":"probe","args":[],"method":"GET","path":"/csdn/testuser"}' > /tmp/probe.jsonl
rust-anything app record /tmp/rec-probe --http --inputs /tmp/probe.jsonl \
  -- env RUST_ANYTHING_WTS_OVERRIDE=1795219200 target/debug/app
grep x-cache-status /tmp/rec-probe/rust/app-cases/http/probe.toml   # MISS
```

`record` 对每条 case 跑两遍（工具自述：*Run the original twice on every case*），第二遍命中了第一遍写在进程内 L1 的条目。基线的 `HIT` 就是那次命中被记下来的结果。

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