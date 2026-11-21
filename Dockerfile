# ---------- 构建阶段 ----------
# 整个仓库已经是纯 Rust。workspace 落在仓库根，因为 Vercel 的 Rust 框架要求根上有
# Cargo.toml + src/main.rs；那个 src/main.rs 是 Vercel 入口，容器不用它，但 cargo 解析
# 根清单时必须能看见它，所以下面一并复制。
FROM rust:1.100-slim-bookworm AS builder

WORKDIR /build

COPY Cargo.toml Cargo.lock ./
# Vercel 入口的源文件：只为让根清单可解析，不参与 -p app 的构建。
COPY src/main.rs ./src/main.rs
# rust/ 是成员 crate 与首页模板（include_str! 的编译期输入）。
COPY rust/ ./rust/

# --locked：Cargo.lock 是构建契约，依赖漂移必须中断镜像构建而不是悄悄换版本。
# -p app：只编服务端二进制，不编 Vercel 入口（它不是容器的运行目标）。
RUN cargo build --release --locked -p app

# ---------- 运行阶段 ----------
# 与 builder 同为 bookworm，glibc 版本一致；二进制在 ldd 层面只依赖 libc。
FROM debian:bookworm-slim AS runner

# rustls 走 webpki-roots（根证书已编进二进制），系统证书不是必需；
# 装证书是为了运维在容器里用 curl 排查时行为正常，curl 同时给下面的 HEALTHCHECK 用。
RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates curl \
 && rm -rf /var/lib/apt/lists/* \
 && useradd --system --uid 10001 --no-create-home app

COPY --from=builder /build/target/release/app /usr/local/bin/app

ENV PORT=3000
EXPOSE 3000

USER app

# 云平台会注入 PORT；二进制自己读它。没有外部依赖，探针只问本进程是否还能应答。
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -fsS "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["/usr/local/bin/app"]
