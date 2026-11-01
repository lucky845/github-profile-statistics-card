# ---------- 构建阶段 ----------
# 必须在构建阶段安装 devDependencies，否则 tsc / tsc-alias 不存在，
# 构建会静默失败（老版本这里写了 `|| true`，把致命错误吞掉了）。
FROM node:20-slim AS builder

WORKDIR /app

COPY package*.json ./
# 用 npm ci 保证锁文件一致；显式包含 devDeps 供 tsc 使用
RUN npm ci --include=dev

COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src

# 构建失败必须中断镜像构建，不允许静默通过
RUN npm run build

# ---------- 运行阶段 ----------
FROM node:20-slim AS runner

WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 只拷贝编译产物（含 copy-assets 搬过来的 views/public）
COPY --from=builder /app/dist ./dist

# 云平台会注入 PORT，app.config.ts 已读取 process.env.PORT
EXPOSE 3000

CMD ["node", "dist/src/app.js"]
