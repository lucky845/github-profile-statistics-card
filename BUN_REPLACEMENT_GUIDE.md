# 将 npm 替换为 Bun 运行时指南

## 1. Bun 简介

Bun 是一个高性能的 JavaScript 运行时，内置了打包器、转译器、任务运行器和 npm 客户端。它的主要优势包括：

- 比 Node.js 更快的性能
- 更小的安装体积
- 原生支持 TypeScript 和 JSX
- 兼容 npm 生态系统
- 内置了大多数常用工具

## 2. npm 与 Bun 命令对照表

| npm 命令 | Bun 命令 | 说明 |
|---------|---------|------|
| `npm install` | `bun install` | 安装依赖 |
| `npm run [script]` | `bun run [script]` | 运行脚本 |
| `npm test` | `bun test` | 运行测试 |
| `npm start` | `bun start` | 运行 start 脚本 |
| `npm build` | `bun build` | 构建项目（Bun 原生构建器） |
| `npx [package]` | `bunx [package]` | 运行一次性包命令 |
| `npm add [package]` | `bun add [package]` | 添加依赖 |
| `npm remove [package]` | `bun remove [package]` | 移除依赖 |

## 3. 项目替换步骤

### 3.1 安装 Bun（基于当前环境）

由于系统权限限制，我们使用 npx 来临时使用 Bun：

```bash
npx bun --version
```

### 3.2 替换现有 npm 命令

在项目中，您可以将现有的 npm 命令替换为对应的 bun 命令：

#### 安装依赖
```bash
npx bun install
```

#### 运行开发服务器
```bash
npx bun run dev
```

#### 运行测试
```bash
npx bun run test
```

#### 启动应用
```bash
npx bun run start
```

### 3.3 更新 package.json 脚本（可选）

您可以在 package.json 中创建使用 Bun 的替代脚本：

```json
{
  "scripts": {
    "start": "ts-node src/app.ts",
    "dev": "nodemon src/app.ts",
    "test": "jest --coverage",
    "test:watch": "jest --watch",
    "bun:start": "bun run src/app.ts",
    "bun:dev": "bun --watch src/app.ts",
    "bun:test": "bun test"
  }
}
```

## 4. 注意事项和兼容性问题

### 4.1 已知兼容性问题

- **ts-node**：Bun 原生支持 TypeScript，可以直接使用 `bun run file.ts`，无需 ts-node
- **nodemon**：可以使用 Bun 的 `--watch` 标志代替
- **Jest**：Bun 有自己的测试运行器 `bun test`，但也兼容 Jest（需要额外配置）
- **依赖兼容性**：大部分 npm 包在 Bun 中可以正常工作，但某些底层依赖可能需要调整

### 4.2 性能提升

- 安装依赖速度提升 2-10 倍
- 脚本执行速度提升 5-50%
- 内存使用减少 15-30%

## 5. 完整迁移建议

### 5.1 开发环境迁移

1. 首先使用 npx 临时使用 Bun 测试项目
2. 逐步替换 package.json 中的脚本命令
3. 针对 Bun 优化配置（利用原生 TypeScript 支持等）

### 5.2 生产环境迁移

1. 在 CI/CD 流程中添加 Bun 支持
2. 监控性能和兼容性问题
3. 考虑使用 Docker 容器确保环境一致性

## 6. 故障排除

### 6.1 常见错误

- **依赖安装失败**：尝试 `npx bun install --force`
- **TypeScript 编译错误**：Bun 的 TypeScript 编译器可能与 tsc 有细微差别，检查 tsconfig.json
- **原生模块错误**：某些原生 Node.js 模块可能需要 Bun 特定的替代方案

### 6.2 回滚方案

如果遇到无法解决的兼容性问题，可以随时回退到使用 npm：

```bash
npm install
npm run dev
```

## 7. 结论

将 npm 替换为 Bun 可以显著提升开发效率和应用性能。虽然还有一些兼容性问题需要注意，但对于大多数现代 JavaScript/TypeScript 项目来说，Bun 是一个值得尝试的高性能替代方案。

---

*本指南基于 Bun v1.3.3 和项目当前配置生成。随着 Bun 的发展，某些信息可能需要更新。*