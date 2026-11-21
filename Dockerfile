# ---------- 构建阶段 ----------
# 仓库根就是主 crate：src/ 是 HTTP 前端，views/ 是编译期模板，crates/ 是三个移植单元。
FROM rust:1.100-slim-bookworm AS builder

WORKDIR /build

# 只需要 Rust 源码。没有 Node、没有 package.json、没有 node_modules。
COPY Cargo.toml Cargo.lock ./
COPY src/ ./src/
COPY views/ ./views/
COPY crates/ ./crates/

# --locked：Cargo.lock 是构建契约，依赖漂移必须中断镜像构建而不是悄悄换版本。
RUN cargo build --release --locked --bin app

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
