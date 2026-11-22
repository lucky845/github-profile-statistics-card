# GitHub Profile Statistics Card

<div align="center">
  <img src="https://img.shields.io/github/license/lucky845/github-profile-statistics-card?style=for-the-badge" alt="License">
  <img src="https://img.shields.io/github/issues/lucky845/github-profile-statistics-card?style=for-the-badge" alt="Issues">
  <img src="https://img.shields.io/github/stars/lucky845/github-profile-statistics-card?style=for-the-badge" alt="Stars">
  <img src="https://img.shields.io/badge/Rust-1.88+-dea584?style=for-the-badge&logo=rust" alt="Rust">
</div>

## 🚀 项目简介

把 GitHub、LeetCode、CSDN、掘金、哔哩哔哩的统计数据渲染成一张 **SVG 卡片**，一行 Markdown 嵌进你的 README。

整个后端是**一个 Rust 二进制**：没有 Node 运行时、没有 `package.json`、没有数据库。缓存默认在进程内，可选接入 Redis 做跨实例共享。启动即服务，一次请求拿到一张自包含的 SVG。

## ✨ 特性

- **五个平台**：GitHub / LeetCode / CSDN / 掘金 / 哔哩哔哩
- **四个主题**：light / dark / github-dark-dimmed / transparent
- **单二进制**：约 158 MB 的镜像里只有一个静态链接的可执行文件，非 root 运行
- **自包含 SVG**：卡内不嵌任何外部图片（理由见下），一次请求即完整内容
- **行为有契约**：153 条录制的 HTTP case 做重放比对，不是手写断言
- **双部署**：Docker 单二进制，或 Vercel 官方 Rust runtime

## 🚀 使用方法

把下面这行的 `用户名` 换成你的，粘进 README：

```markdown
![GitHub](https://你的域名/github/用户名?theme=dark)
```

各平台路径：

| 平台 | 路径 | 参数 |
| --- | --- | --- |
| GitHub | `/github/{username}` | `theme` |
| LeetCode | `/leetcode/{username}` | `theme`、`cn=true` 走中国站 |
| CSDN | `/csdn/{userId}` | `theme` |
| 掘金 | `/juejin/{user_id}` | `theme` |
| 哔哩哔哩 | `/bilibili/{uid}` | `theme` |

公共参数：

| 参数 | 说明 |
| --- | --- |
| `theme` | `light`（默认）/ `dark` / `github-dark-dimmed` / `transparent`。传未知主题回落 `light`，不报错 |
| `nocache=true` | 绕开**平台取数缓存**，让这一次真的回源（排查上游数据问题时用）。注意它不绕开 HTTP 响应缓存：它只是换了一个缓存键（`?` 带着 `nocache=true`），所以同一个 URL 连打第二次仍然命中 HTTP 缓存。要每次都回源，得换 key（例如加时间戳）或先 `DELETE /api/cache/clear?all=true` |

### 各平台卡片包含什么

- **GitHub**：仓库数、总 Star（含所有仓库累加）、关注者、Following
- **LeetCode**：通过题数（按难度分档）、总提交、通过率、竞赛排名
- **CSDN**：原创、粉丝、获赞、访问量、积分、等级
- **掘金**：文章数、获赞、浏览量、收藏、掘力值、等级
- **哔哩哔哩**：粉丝、关注、获赞、播放量、等级、签名

### 已知限制

- **哔哩哔哩等级**在上游是 SVG 图片，卡片里只显示数字等级
- **部分用户数据**因平台隐私设置会缺失，此时显示 `0` 而不是报错
- **哔哩哔哩不带 `SESSDATA`** 时上游返回 `-352` 风控码，卡片显示**全 0 的真实数据**（不是错误卡）

## 🎨 主题

| 参数 | 说明 |
| --- | --- |
| `theme=light` | 明亮主题（默认） |
| `theme=dark` | 暗黑主题 |
| `theme=github-dark-dimmed` | GitHub 暗色变体 `#22272e` |
| `theme=transparent` | 透明背景，贴合页面自身底色 |

所有主题可在[首页](/)实时预览与切换。

## 🖼️ 为什么卡片里没有头像

早期版本会在左上角画用户头像，现在去掉了。这不是省事，而是**头像会让卡片在 README 里更容易裂、更慢**：

| 问题 | 说明 |
| --- | --- |
| 防盗链 | 哔哩哔哩图床对错误的 `Referer` 直接返回 **403**。SVG 里的 `<image>` 指向外站图床时，浏览器发出的 `Referer` 不可能是 `bilibili.com`，头像必然碎 |
| 体积 | GitHub 头像原图约 **25 KB**，而 48px 显示尺寸只需 2.7 KB（`?s=96&v=4`），9 倍浪费 |
| 额外一跳 | README 里的图片都会经过 GitHub 的 camo 代理，卡内再嵌外链图片，等于在 camo 之外再多一个会超时、会失败的请求 |

去掉之后，每张卡从「一个 SVG + 一个外部图片」变成**单一自包含 SVG**：一次请求拿到全部内容，没有额外失败点。

## 🔌 API

| 端点 | 方法 | 说明 |
| --- | --- | --- |
| `/` | GET | 首页（主题预览与卡片画廊） |
| `/livez` | GET | 存活探针：进程还在吗。**健康检查用这个** |
| `/health` | GET | 连通性：上游平台都通吗。`data.status` 三态：`healthy`（问过的平台最近一次都成功）/ `unhealthy`（至少一个最近一次失败）/ `unknown`（启动后还没人问过）。`data.platforms` 是各平台真实调用计数（`ok`/`fail`/`lastError`），能看出静默失效 |
| `/api/theme/test` | GET | 单主题样例卡，用于调样式（`?theme=`） |
| `/metrics` | GET | Prometheus 文本格式指标 |
| `/metrics/json` | GET | 同上，JSON 格式 |
| `/stats` | GET | 进程内统计（请求数、缓存命中率、外部 API 调用数）。`data.externalApis` 为每个已注册平台各给一个计数，全部是真实出站请求数 |
| `/api/cache/stats` | GET | 缓存计数器 |
| `/api/cache/clear` | DELETE | 清空缓存，支持 `?all=true` / `?group=` / `?pattern=` |

**探针语义要分清**：`/livez` 恒 200，`/health` 反映上游状态。用 `/health` 当存活探针会让平台在 GitHub 限流时反复重启一个本来健康的实例。

**诊断端点都不缓存**：`/livez`、`/health`、`/metrics`、`/metrics/json`、`/stats`、`/api/cache/stats` 一律带 `Cache-Control: no-store`。响应体是当前读数，缓存住等于把上一秒的数字再发一次——Prometheus 会抓到陈旧指标，`/stats` 连读两次数字不动。

### JSON 响应统一信封

除 `/metrics`（Prometheus 文本）与 `/metrics/json`（prom-client 的数组格式，解析方是抓取器）外，所有 JSON 端点都返回同一个信封：

```json
{ "code": 200, "msg": "ok", "data": { } }
```

- `code` —— 与 HTTP 状态码一致（不是恒定 200）。`Dockerfile` 的 `HEALTHCHECK`、`render.yaml` 的 `healthCheckPath`、CI 的冒烟步骤都只读 `curl -fsS` 的退出码，也就是状态码；把它一律改成 200 会直接废掉这些探针。
- `msg` —— 一句给人看的话。
- `data` —— 原来的响应体原样下移一层。所以 `/livez` 的 `uptime` 现在在 `data.uptime`，`/api/cache/stats` 的计数在 `data.hits` 等，`/health` 的 `status` 在 `data.status`。`uptime` 是进程真实年龄（内核记录的启动时刻），`/health` 的 `memory` 只报真实的 `rss`。

`/health` 上 `code:200` 与 `data.status:"unhealthy"` 并存是刻意的：前者说「进程答话了」，后者说「上游不健康」。合并成一个字段会让限流期的 `/health` 看起来像进程已死。

`data.status` 只看**最近一次**：一个平台失败后恢复，字段会跟着回到 `healthy`——这正是 `record_ok` / `record_fail` 各自打时间戳的用途。所以它不是「有没有出过错」，而是「现在通不通」。

## 🛠️ 技术栈

- **Rust** — Axum + Tokio + reqwest
- **缓存** — 两层：进程内 L1（始终）+ Redis L2（配了 `REDIS_*` 才启用）。无 PostgreSQL / MongoDB。L2 的五个操作由 `tests/remote_cache.rs` 用进程内 RESP 假服务器覆盖，CI 不需要 Redis service
- **渲染** — 手写 SVG 生成，无模板引擎
- **首页** — HTML 在编译期用 `include_str!` 编进二进制
- **平台扩展** — 一张 `PlatformDesc` 常量表（`src/frontdoor/registry.rs`）描述每个平台，路由分派／限流前缀／404 判定／首页画廊／缓存键分隔符全部从它派生。加平台只改这一处，见 [CONTRIBUTING.md](CONTRIBUTING.md#添加新平台)
- **部署** — 多阶段 Docker 单二进制，或 Vercel Rust runtime

## 🚀 部署

Docker 与 Vercel 跑的是**同一份二进制**——两者的区别只是由谁来转发流量，所以行为不可能漂移。

### 环境变量

核心三个，全部可选：

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `PORT` | `8080` | 监听端口，云平台会自动注入 |
| `GITHUB_TOKEN` | 空 | GitHub 个人访问令牌。**强烈推荐**：匿名额度只有 60 次/小时/出口 IP，共享出口上几分钟就打满，之后 GitHub 卡片退化成「暂无数据」。配置后 5000 次/小时 |
| `BILIBILI_SESSDATA` | 空 | 哔哩哔哩登录 Cookie 里的 `SESSDATA`。不带时上游返回 `-352` 风控码 |
| `PUBLIC_BASE_URL` | 空 | **Vercel 必配**。首页画廊用公开域名拼示例链接。留空则用请求的 `Host` 头——Vercel 的 `Host` 是带部署哈希的预览域名，位于 SSO 后面，用它拼出的图片会全部返回 302 |
| `REDIS_URL` 或 `REDIS_HOST`/`REDIS_PORT`/`REDIS_USERNAME`/`REDIS_PASSWORD` | 空 | **可选**。配置后启用 Redis 共享缓存层：TTL 按响应的 `s-maxage`（10–60 分钟），跨实例/跨冷启动共享。多实例部署强烈建议配上。两种写法任选，与原版 Node 兼容 |

### Docker（推荐）

```bash
docker build -t github-stats-card .
docker run -d -p 3000:3000 \
  -e GITHUB_TOKEN=ghp_xxx \
  --name github-stats-card \
  github-stats-card
```

镜像约 158 MB，`command -v node` 返回空，非 root（uid 10001）运行。

### Vercel

走 **官方 Rust 框架**。Vercel 按 `Cargo.toml` + `src/main.rs` 两个文件检测项目，构建器是 `@vercel/rust`：

```bash
vercel deploy
```

**Framework Preset 必须选 `Rust`，不能选 `Other` 或 `Container`**：

| 选项 | 结果 |
|---|---|
| `Rust` | ✅ 用 `@vercel/rust` 构建，进程监听 `$PORT`，proxy 转换协议 |
| `Other` | ❌ 检测不到 Rust，构建器不会被挂上，服务不启动 |
| `Container` | ❌ 会去构建根 `Dockerfile`，与 `src/main.rs` 入口无关 |

`vercel.json` 里已写死顶层字段 `"framework": "rust"`（**不是** `projectSettings.framework` —— 那是无效 schema，会直接让构建失败），正常情况下不需要手动选。

⚠️ **Vercel 与 Docker 有一处真实差异**：进程内缓存与限流计数**随实例存活**，冷启动即清空、多实例各算各的。所以限流的 300/15min 实际会被实例数放大，`/api/cache/stats` 也只代表当前实例。

**配上 Redis 可以消除前半部分**：卡片缓存会跨实例共享（实测 5 次冷启动只回源 1 次）。限流计数仍按实例计——那是另一层。

### 托管平台

- **Vercel**：`vercel.json` 已配顶层 `"framework": "rust"`
- **Render**：`render.yaml` 已配 `runtime: docker` + `healthCheckPath: /livez`
- **Railway**：`railway.json` 已配 `build.builder: DOCKERFILE`

完整说明（compose、Nginx、观测端点、缓存语义、故障排查）见 [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)。

## 🤝 参与贡献

见 [CONTRIBUTING.md](CONTRIBUTING.md)。核心规矩先放这里：

```bash
# workspace 在仓库根
cargo build   --workspace
cargo test    --workspace
cargo clippy  --all-targets --workspace -- -D warnings   # 硬门，CI 会因此失败
```

- **正确性由 replay 定义**，不是手写断言。两档：`./scripts/replay.sh gate` 是 111 条纯本地 case，必须全绿，CI 跑的就是它；`./scripts/replay.sh` 是全量 153 条、基线 **148/153**，5 条失败是录制工具的采样副作用导致的 `x-cache-status` 差异（`record` 每条跑两遍，第二遍撞上进程内 L1），非移植缺陷。全量档**别直接调 `rust-anything app replay`**——卡片的 `更新于 2026-11-21` 是录制当天写死的，不钉时钟直接跑会得到 127/153 的假回归。
- **别拿「replay 还是绿的」当证据**：`/health` 的 body、`/api/cache/stats` 的数值、卡片的 `x-cache-key`/`x-cache-status` 在录制时都被归一化成了通配，等于没有断言。动这些地方必须手工对拍。
- **有些东西 replay 和单元测试都盖不到，只能跨进程验**。进程年龄（`/livez` 的 `uptime`）是例子：单元测试的参考读数与「首次探活才起表」那个缺陷的起点几乎同时，两种实现都能通过。`scripts/process-age.sh` 起进程、静默等 5 秒、只探一次，缺陷实现回答 `0` 而真实现回答 `5`。CI 里它就是这一步。

## 🔜 即将支持

知乎与微博处于可行性评估阶段，**尚未排期接入**。两者对未登录流量均全面封锁，实测（2026-11-22）如下：

- **知乎**：`/people/:id` 返回 403 `zh-zse-ck` 反爬页；`api/v4/members/:id` 返回 403 `need_login`；热榜接口 401；移动端 `m.zhihu.com` 的 `js-initialData` 为登录页（`logged=false`，所有实体为空）。需真实登录会话（`z_c0` + `d_c0` 双 cookie）。
- **微博**：`weibo.com/u/:uid` 返回 `Sina Visitor System` 游客验证页；`m.weibo.cn/api/container/getIndex` 返回 432 风控码；`weibo.cn` 移动版用户页为空壳（无统计数据）。

接入需引入需用户自备、会过期的登录态，与项目「匿名可跑、凭据可选」的现有模式冲突，暂不实施。

## 📝 开源协议

[Apache 2.0](LICENSE)

---

如果这个项目对你有帮助，请给个 Star ⭐️