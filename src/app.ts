// 导入 polyfill，确保在所有其他导入之前
import './polyfill';

import express, { Request, Response } from 'express';
import path from 'path';
import { 
  errorHandler, 
  logger, 
  mongoMiddleware, 
  notFoundHandler,
  themeMiddleware,
  metricsMiddleware,
  cacheMiddleware,
  cacheStatsHandler,
  manualCacheClearHandler,
  securityHeaders,
  corsMiddleware,
  xssProtection,
  hppProtection,
  apiRateLimiter
} from './middleware';
import {
  appConfig,
  dbConfig
} from './config';
import { 
  bilibiliRouter, 
  csdnRouter, 
  githubRouter, 
  juejinRouter, 
  leetcodeRouter 
} from './routes';
import metricsRouter from './routes/metrics.routes';
import mongoose from 'mongoose';
import { MongoDBManager } from './utils/dbManager';
import prometheusService from './services/prometheus.service';
import { handleHomePage, handleHealthCheck, handleThemeTest } from './controllers/home.controller';

// 初始化数据库连接管理器
const dbManager = MongoDBManager.getInstance();

// 初始化Express应用
const app = express();
const port = appConfig.port;

// 应用安全中间件 - 尽早应用以保护所有后续处理
app.use(securityHeaders);
app.use(corsMiddleware);
app.use(xssProtection);
app.use(hppProtection);

// 应用日志和数据处理中间件
app.use(logger);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 应用业务中间件
app.use(mongoMiddleware);
app.use(themeMiddleware);
app.use(cacheMiddleware);

// 性能监控中间件 - 放在所有路由之前以捕获所有请求
app.use(metricsMiddleware);

// API路由使用更严格的速率限制
app.use('/leetcode', apiRateLimiter);
app.use('/github', apiRateLimiter);
app.use('/csdn', apiRateLimiter);
app.use('/juejin', apiRateLimiter);
app.use('/bilibili', apiRateLimiter);

// 设置静态文件目录
app.use(express.static(path.join(__dirname, 'public')));

// 基本路由
app.get('/', handleHomePage);
app.get('/health', handleHealthCheck);
app.get('/api/theme/test', handleThemeTest);

// 缓存管理API（建议在生产环境中添加访问控制）
app.get('/api/cache/stats', cacheStatsHandler);
app.delete('/api/cache/clear', manualCacheClearHandler);

// 平台相关路由
app.use('/leetcode', leetcodeRouter);
app.use('/github', githubRouter);
app.use('/csdn', csdnRouter);
app.use('/juejin', juejinRouter);
app.use('/bilibili', bilibiliRouter);

// 监控相关路由
app.use('/', metricsRouter);

// 捕获404错误的中间件，必须在所有路由后、错误处理前设置
app.use(notFoundHandler);

// 404处理（备用）
app.use((req: Request, res: Response) => {
    res.status(404).send('找不到请求的资源');
});

// 启动服务器
let server: ReturnType<typeof app.listen>;

const startServer = async () => {
    try {
        // 检查是否配置了使用内存缓存，如果是，不尝试连接MongoDB
        if (dbConfig.useMemoryCache) {
            // 导入需要在运行时动态导入，避免循环依赖
            const { secureLogger } = require('./utils/logger');
            secureLogger.info('📊 使用内存缓存模式，跳过MongoDB连接');
        } else {
            // 尝试初始化数据库连接（即使失败也继续启动服务器）
            await dbManager.connect().catch(error => {
                // 导入需要在运行时动态导入，避免循环依赖
                const { secureLogger } = require('./utils/logger');
                secureLogger.warn('⚠️  数据库连接失败，将在后台继续尝试连接:', error);
            });
        }

        server = app.listen(port, () => {
            // 导入需要在运行时动态导入，避免循环依赖
            const { secureLogger } = require('./utils/logger');
            secureLogger.info(`🚀 服务已启动于端口 ${port}`);
            secureLogger.info(`📊 数据库状态: ${dbConfig.useMemoryCache ? '内存缓存模式' : (mongoose.connection.readyState === 1 ? '已连接' : '未连接')}`);
        });

        return server;
    } catch (error) {
        // 导入需要在运行时动态导入，避免循环依赖
        const { secureLogger } = require('./utils/logger');
        secureLogger.error('🔴 服务启动失败:', error);
        process.exit(1);
    }
};

// 处理未捕获的异常
process.on('unhandledRejection', (reason, promise) => {
    // 导入需要在运行时动态导入，避免循环依赖
    const { secureLogger } = require('./utils/logger');
    secureLogger.error('🔴 未处理的Promise拒绝:', reason);
});

process.on('uncaughtException', (error) => {
    // 导入需要在运行时动态导入，避免循环依赖
    const { secureLogger } = require('./utils/logger');
    secureLogger.error('🔴 未捕获的异常:', error);
    // 对于严重错误，可能需要优雅地关闭应用
    process.exit(1);
});

// 优雅终止
process.on('SIGINT', async () => {
    // 导入需要在运行时动态导入，避免循环依赖
    const { secureLogger } = require('./utils/logger');
    secureLogger.info('🛑 接收到终止信号');

    try {
        // 1. 停止接受新请求
        server.close(() => {
            secureLogger.info('🚫 已停止接受新请求');
        });

        // 2. 关闭数据库连接
        await dbManager.disconnect();
        secureLogger.info('✅ MongoDB连接已关闭');

        // 3. 关闭现有连接
        server.close(() => {
            secureLogger.info('🛑 HTTP服务完全停止');
            process.exit(0);
        });

        // 强制退出保护
        setTimeout(() => {
            secureLogger.error('⏰ 关闭超时，强制退出');
            process.exit(1);
        }, 10000); // 10秒超时

    } catch (error) {
        secureLogger.error('❌ 关闭资源失败:', error);
        process.exit(1);
    }
});

// 错误处理中间件应该放在所有路由和处理函数之后
app.use(errorHandler);

// 初始化并启动服务
startServer().then(serverInstance => {
    // 处理其他关闭信号
    process.on('SIGTERM', () => {
        // 导入需要在运行时动态导入，避免循环依赖
        const { secureLogger } = require('./utils/logger');
        secureLogger.info('🛑 接收到SIGTERM信号');
        serverInstance.close();
    });
    
    // 初始化Prometheus服务
    prometheusService.initialize();
    // 导入需要在运行时动态导入，避免循环依赖
    const { secureLogger } = require('./utils/logger');
    secureLogger.info('📊 Prometheus监控已初始化');
});

// 导出Express应用，用于Vercel部署
module.exports = app;

// 额外导出一个请求处理函数，确保Vercel可以正确处理所有请求
module.exports.default = async (req: Request, res: Response) => {
  await app(req, res);
};
