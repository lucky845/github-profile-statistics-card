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
# 我这一改有没有搞坏东西？111 条纯本地，必须全绿。CI 跑的就是这一档。
./scripts/replay.sh gate

# 录制行为有没有漂移？全量 153 条，基线 148/153。依赖上游，会波动。
./scripts/replay.sh

# 只跑单个 case（快速迭代）
./scripts/replay.sh home
```

| 档位 | 条数 | 打上游 | 判定 | 用途 |
| --- | --- | --- | --- | --- |
| `gate` | 111 | 否 | 必须 111/111 | 改代码后的硬门，CI |
| 全量 | 153 | 是 | ≥148/153 | 查录制漂移 |

**为什么 `gate` 排掉 42 条**：41 条是**成功渲染的**卡片（每张都要打 GitHub / CSDN / 力扣），外加 `cache-stats`（上报本次 run 的 `hits`/`misses`/`keys`，天然依赖跑过哪些 case）。这 42 条与会话无关地依赖匿名配额、上游存活状态和录制当天日期——实测**同样的代码连跑两遍能给出 148 和 147 两种结果**（`trap-112-get-csdn` 在 CSDN 回 521 时渲染成"暂无数据"错误卡）。拿它当 CI 门只会制造与代码无关的红灯。

**但 404 的卡片必须留在 gate 里。** 它们由 404 处理器直接渲染，一个字节都不打上游，稳定可复现。这 6 条（github 2 条，其余四家各 1 条）守的正是「某个平台挂载了、但 404 该回卡片却回了 JSON」这一类缺陷——`trap-124-get-juejin` 当年钉的就是 juejin 的错误 `Content-Type`。曾经 gate 按 `image/svg` 无差别排掉全部 47 条，结果是：把 juejin 的修复撤掉，gate 依然全绿。现在它留在门内，撤掉修复立刻 `110/111`。

排除后剩下的 111 条可复现到什么程度：把 `x-frame-options` 从 `DENY` 改成 `SAMEORIGIN`，立刻全红；把 404 的 `is_svg` 列表改回硬编码四家，立刻 `110/111`。它会红，也会绿，所以不是装饰。

注意这 111 条**不需要钉时钟**（它们不断言卡片 footer），脚本仍然钉着，是为了让快照行为与全量档一致。

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

另外，JSON 端点的 body 现在统一包在 `{code,msg,data}` 信封里（见 README 的「JSON 响应统一信封」）。录制的 73 条 404 body 已同步改写，但 `/stats`、`/metrics/json`、`DELETE /api/cache/clear` 这五个端点**没有任何用例**——改它们的形状，replay 一个字都不会变，只能手工 `curl` 对拍。

改动这些地方时，**必须手工对拍**，不能拿"replay 还是绿的"当证据。

诊断端点的 `Cache-Control: no-store` 也是 replay 抓不到的一类：录制时 `x-cache-status` 是 `[..]` 通配，把 `no-store` 删掉 replay 照样全绿，但 `/stats` 会开始返回五分钟前的读数。这类"中间件默认值 + 处理函数没设策略"的缺陷，只有直接驱动 `app::router()` 的集成测试抓得住——见 `tests/live_diagnostics.rs`（连打两次断言不得 `HIT`）与 `tests/home_host_cache.rs`（两个 Host 断言不得同体）。

**共享缓存（L2）也是这样。** `gate` 与全量 replay 都在 `REDIS_*` 未配置的状态下跑，所以 `remote.rs` 里 `get`/`set`/`delete`/`delete_prefix`/`clear_all` 这五个函数**没有任何 replay 覆盖**——录制时它们一律走 `connection() -> None` 的早退分支。`tests/remote_cache.rs` 补这一块：它在测试进程里起一个只讲 RESP 的假服务器，`TcpListener::bind("127.0.0.1:0")` 拿随机端口后写入 `REDIS_URL`，于是 CI 不需要 Redis service 也能跑。

那个 fake 实现的是 `remote.rs` 实际发出的命令，并且**保留收到的命令序列供断言**：`SETEX` 有没有带 `EX`、`EX` 的值是不是调用方给的 TTL、`SCAN` 有没有带 `COUNT`。其中 `delete_prefix_walks_every_page_the_server_hands_back` 塞 520 个键（超过 `COUNT 500`），断言删除后该前缀**一个不剩**——那个 `SCAN` 分页循环只会在超过一页时出错，少于 500 个键的测试永远发现不了。改坏它（第一页就 `return`）立刻红。

注意 fake 的 SCAN 游标是**插入序列号**而不是"排序后第几个键"：后者在删掉前一页之后会让游标整体前移，看起来像被测代码漏删，实际是 fake 自己的缺陷。写这类替身时，游标的语义要跟真服务器一致——它是一个位置，不是一个偏移量。

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

平台清单只有一处：`src/frontdoor/registry.rs` 的 `PLATFORMS` 表。路由分派、限流前缀、404 的 SVG/JSON 判定、首页画廊、缓存键分隔符全部从这张表派生，所以要加一个平台：

1. `src/frontdoor/` 下新建模块，照抄 `github.rs` 的结构（validate → 上游取数 → `generate_card` → 响应头）
2. 写一个 `fn card_<平台><'a>(id, ctx, key) -> BoxFuture<'a, Response>` 薄包装，签名对齐 `registry::CardFn`
3. 在 `registry.rs` 的 `PLATFORMS` 里追加一行 `PlatformDesc`——这是唯一必须改的地方

`PlatformDesc` 的字段就是那个平台与其余代码的全部契约：

| 字段 | 作用 | 写错的后果 |
| --- | --- | --- |
| `name` | 挂载路径段 | 路由、限流、画廊一起失配 |
| `title` / `sample` / `extra_query` / `height` | 首页画廊那一行卡片 | 首页文案或示例链接错 |
| `key_style` | 缓存键用冒号还是下划线 | `X-Cache-Key` 形状变（有单测钉住） |
| `rejects` + `valid` | 400 文案与校验器；`None` 表示不校验 | 非法 id 被放行或合法 id 被拒 |
| `sanitize` | 取数前清洗 id；`None` 表示原样透传 | 上游收到脏 id |
| `nocache_skips_platform_key` | `?nocache=true` 是否跳过平台键 | 缓存键语义漂移 |
| `container_theme_fatal` | `?theme=` 为容器时是否抛 500 | 错误码变 |
| `card` | 取数并渲染的入口 | — |

加完之后这几处会**自动**跟上，不需要再改：`handlers::dispatch` 的分派、`handlers::not_found` 的 SVG 判定、`ratelimit` 的挂载前缀、`paths::canonical` 的路由改写、首页画廊。

验证方式：

- `cargo test --workspace` —— `tests/platform_coverage.rs` 会遍历这张表，逐个断言 `/<平台>/` 返回 `image/svg+xml` 且首页出现该平台；漏改任何一处立刻红
- `./scripts/replay.sh gate` —— 行为门，111 条纯本地用例必须全绿。**加平台会让 `home` 用例失败**（首页多一张卡片），这是预期的：用 `./scripts/replay.sh home` 看 diff 后更新 `rust/app-cases/http/home.body`

> 历史教训：这张表以前是六份互不相干的清单，juejin 加进了其中五份、漏了 404 判定那一份，于是 `GET /juejin/` 回 JSON 而不是卡片，同一个缺陷在 Node 版就存在并活过了整个 Rust 迁移。现在清单只有一份，出错的形状从"漏改一处"变成"表里写错一行"，而那一行有单测盯着。

## 报告 Bug

请在 GitHub Issues 中报告，并附上：

- 请求的完整路径与 query（含 `theme` 参数）
- 期望的响应与实际响应
- 如果涉及卡片渲染，贴出 SVG 或截图

## 功能请求

欢迎在 GitHub Issues 中提出。