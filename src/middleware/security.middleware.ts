import { Request } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import xss from 'xss-clean';
import hpp from 'hpp';
import { createRequestLoggerMiddleware } from '../utils/logger';
import { generateErrorCard } from '../services/svg/generators/errorCardGenerator';
import { getThemeConfig } from '../services/svg/svgService';

/**
 * 限流命中同样返回 200 + 错误卡。
 * GitHub camo 会把 429/5xx 缓存成坏图，README 里就是永久裂图 —— 宁可给一张降级卡。
 */
const TOO_MANY_REQUESTS_CARD = '请求过于频繁，请稍后再试';
const RATE_LIMIT_HEADERS = (res: any) => {
  res.set('Content-Type', 'image/svg+xml');
  res.set('Cache-Control', 'no-store');
};

/**
 * 安全HTTP头配置
 */
export const securityHeaders = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', '*'], // 允许任何来源的图片，因为这是一个图片生成服务
    },
  },
  xFrameOptions: { action: 'deny' },
  hidePoweredBy: true,
});

/**
 * CORS配置
 */
export const corsMiddleware = cors({
  origin: (origin, callback) => {
    // 允许所有来源，因为这是一个公共API服务
    callback(null, true);
  },
  methods: ['GET', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge: 86400, // 预检请求结果缓存24小时
});

/**
 * 全局请求速率限制
 */
export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟窗口
  max: 1000, // 每IP每15分钟1000个请求
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    RATE_LIMIT_HEADERS(res);
    res.status(200).send(generateErrorCard(TOO_MANY_REQUESTS_CARD, getThemeConfig()));
  },
  keyGenerator: (req: Request): string => {
    // 使用X-Forwarded-For头或IP地址作为限流键，确保总是返回字符串
    return (req.headers['x-forwarded-for'] as string) || (req.ip as string) || 'unknown-client';
  },
});

/**
 * API请求速率限制（更严格）
 */
export const apiRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15分钟窗口
  max: 300, // 每IP每15分钟300个API请求
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => {
    RATE_LIMIT_HEADERS(res);
    res.status(200).send(generateErrorCard('API请求过于频繁，请稍后再试', getThemeConfig()));
  },
  keyGenerator: (req: Request): string => {
    return (req.headers['x-forwarded-for'] as string) || (req.ip as string) || 'unknown-client';
  },
});

/**
 * XSS保护中间件
 */
export const xssProtection = xss();

/**
 * 防止参数污染攻击
 */
export const hppProtection = hpp();

/**
 * 请求日志中间件 - 使用专业的日志服务
 */
export const requestLogger = createRequestLoggerMiddleware();

/**
 * 组合安全中间件
 */
export const applySecurityMiddleware = (app: any) => {
  app.use(securityHeaders);
  app.use(corsMiddleware);
  app.use(globalRateLimiter);
  app.use(xssProtection);
  app.use(hppProtection);
};
