import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { secureLogger } from '../utils/logger';
import { renderGallery } from '../services/platforms/gallery';
import { snapshotHealth } from '../services/platforms/health';
import { themes } from '../config/theme.config';
import { DEFAULT_THEME_NAME } from '../services/svg/svgService';

/**
 * 处理首页请求
 * @param req Express请求对象
 * @param res Express响应对象
 */
export const handleHomePage = (req: Request, res: Response): void => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  try {
    // 尝试读取首页HTML文件
    const indexPath = path.join(__dirname, '../views/index.html');
    let indexHtml: string;

    if (fs.existsSync(indexPath)) {
      indexHtml = fs.readFileSync(indexPath, 'utf8');
      // 替换基础URL
      indexHtml = indexHtml.replace(/\$\{BASE_URL\}/g, baseUrl);
      // 卡片画廊由平台注册表生成，新增平台无需手改 HTML
      const activeTheme = typeof req.query.theme === 'string' && themes[req.query.theme] ? req.query.theme : DEFAULT_THEME_NAME;
      indexHtml = indexHtml.replace('<!-- GALLERY -->', renderGallery(baseUrl, activeTheme));
      // 主题名同样从配置生成：首页列出的主题一定是后端真实支持的
      indexHtml = indexHtml.replace(/\$\{THEME_OPTIONS\}/g, Object.keys(themes).join(' / '));
      indexHtml = indexHtml.replace(/\$\{THEME_PILLS\}/g, Object.keys(themes)
        .map(t => `<a class="theme-pill" href="?theme=${encodeURIComponent(t)}">${t}</a>`)
        .join(''));
    } else {
      // 如果文件不存在，则使用内联HTML作为后备
      indexHtml = generateFallbackHtml(baseUrl);
    }

    res.set('Content-Type', 'text/html');
    res.send(indexHtml);
  } catch (error) {
    secureLogger.error('读取首页错误:', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).send('服务器错误');
  }
};

/**
 * 生成后备HTML内容
 * @param baseUrl 基础URL
 * @returns HTML字符串
 */
function generateFallbackHtml(baseUrl: string): string {
  return `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>GitHub & LeetCode Stats</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        h1 { color: #2c3e50; }
        .code-block { background: #f5f5f5; padding: 10px; border-radius: 4px; }
      </style>
    </head>
    <body>
      <h1>GitHub & LeetCode Stats</h1>
      <p>服务正在运行。请访问以下端点获取统计数据：</p>
      <div class="code-block">
        <p>GitHub统计: ${baseUrl}/github/用户名</p>
        <p>LeetCode统计: ${baseUrl}/leetcode/用户名</p>
      </div>
    </body>
    </html>
  `;
}

/**
 * 处理健康检查请求
 * @param req Express请求对象
 * @param res Express响应对象
 */
export const handleHealthCheck = (req: Request, res: Response): void => {
  const mongoose = require('mongoose');
  const dbStatus = mongoose.connection.readyState === 1 ? 'healthy' : 'unhealthy';
  const poolStats = (mongoose.connection as any).poolMetrics || {};

  res.json({
    status: dbStatus,
    uptime: process.uptime(),
    database: {
      status: dbStatus,
      pool: poolStats
    },
    // 各平台数据源的真实调用情况：失败计数与最近一次错误，
    // 上游静默失效（如掘金返回空壳）时这里能直接看出来
    platforms: snapshotHealth(),
    memory: process.memoryUsage()
  });
};

/**
 * 存活探针：只回答"进程还在跑"，不看数据库
 *
 * 与 /health 分工——/health 报告连通性（DB 挂了就是 unhealthy，CI 干净环境里永远红），
 * /livez 给启动等待和平台存活检查用。两者混用会让"服务没起来"和"数据库没连上"
 * 变成同一个信号，CI 里分不清到底哪一块坏了。
 */
export const handleLivenessProbe = (_req: Request, res: Response): void => {
  res.json({ status: 'alive', uptime: Math.floor(process.uptime()) });
};

/**
 * 处理主题测试请求
 * @param req Express请求对象
 * @param res Express响应对象
 */
export const handleThemeTest = (req: Request, res: Response): void => {
  const { getThemeConfig } = require('../services/svg/svgService');
  const themeName = req.query.theme as string;
  const themeConfig = getThemeConfig(themeName);
  
  // 返回一个简单的测试卡片，展示主题样式
  res.set('Content-Type', 'image/svg+xml');
  res.send(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200">
    <rect width="400" height="200" fill="${themeConfig.colors.background}" rx="${themeConfig.card.borderRadius}" ry="${themeConfig.card.borderRadius}" stroke="${themeConfig.colors.border}" stroke-width="2"/>
    <circle cx="70" cy="70" r="40" fill="${themeConfig.colors.accent.primary}"/>
    <text x="230" y="60" font-family="${themeConfig.fonts.family}" font-size="${themeConfig.fonts.size.title}" font-weight="bold" fill="${themeConfig.colors.text.title}">测试用户</text>
    <text x="230" y="90" font-family="${themeConfig.fonts.family}" font-size="${themeConfig.fonts.size.normal}" fill="${themeConfig.colors.text.secondary}">这是主题测试卡片</text>
    <rect x="70" y="120" width="260" height="1" fill="${themeConfig.colors.border}"/>
    <text x="130" y="150" font-family="${themeConfig.fonts.family}" font-size="${themeConfig.fonts.size.normal}" fill="${themeConfig.colors.text.primary}">数据1: 123</text>
    <text x="250" y="150" font-family="${themeConfig.fonts.family}" font-size="${themeConfig.fonts.size.normal}" fill="${themeConfig.colors.text.primary}">数据2: 456</text>
    <text x="200" y="180" font-family="${themeConfig.fonts.family}" font-size="${themeConfig.fonts.size.small}" text-anchor="middle" fill="${themeConfig.colors.text.secondary}">主题: ${themeName || '默认'}</text>
  </svg>`);
};