#!/usr/bin/env node
/**
 * 构建后资源拷贝脚本。
 *
 * 背景：tsc 只负责编译 .ts 文件，不会把 .html / .css / .png 等非 TS 资源
 * 搬到 outDir。而本项目 src/views/index.html 是通过
 * path.join(__dirname, '../views/index.html') 在运行时读取的，
 * 编译后 __dirname 变成 dist/src/controllers，指向 dist/src/views。
 * 不拷贝就会出现"首页读不到、退化成 fallback HTML"的问题。
 *
 * 同时兼容 tsconfig 的 rootDir 设置：产物可能在 dist/ 或 dist/src/，
 * 这里两种布局都处理。
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const distDir = path.join(root, 'dist');

/** 需要跟着编译产物一起走的静态资源目录（相对 src/） */
const ASSET_DIRS = ['views', 'public', 'assets', 'templates'];

/** 递归拷贝目录 */
function copyDir(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(from, to);
    } else {
      fs.copyFileSync(from, to);
    }
  }
  return true;
}

function main() {
  if (!fs.existsSync(distDir)) {
    console.error('[copy-assets] dist/ 不存在，请先运行 tsc。');
    process.exit(1);
  }

  // 判断实际产物根：有 dist/src 说明 rootDir 是项目根，产物在 dist/src
  const outRoot = fs.existsSync(path.join(distDir, 'src'))
    ? path.join(distDir, 'src')
    : distDir;

  let copied = 0;
  for (const dir of ASSET_DIRS) {
    const src = path.join(root, 'src', dir);
    const dest = path.join(outRoot, dir);
    if (copyDir(src, dest)) {
      console.log(`[copy-assets] ${path.relative(root, src)} -> ${path.relative(root, dest)}`);
      copied++;
    }
  }

  if (copied === 0) {
    console.log('[copy-assets] 没有需要拷贝的资源目录，跳过。');
  }
  console.log(`[copy-assets] 完成，产物根目录: ${path.relative(root, outRoot)}`);
}

main();
