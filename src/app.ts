// 导入 polyfill，确保在所有其他导入之前
import './polyfill';

// 初始化全局变量
import './global-init';

// 加载环境变量
import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import express, { Request, Response } from 'express';
import { 
  errorHandler, 
  logger, 
  notFoundHandler,
  themeMiddleware,
  metricsMiddleware,
  cacheStatsHandler,
  manualCacheClearHandler,
  securityHeaders,
  corsMiddleware,
  xssProtection,
  hppProtection,
  apiRateLimiter
} from './middleware';
import { createCacheMiddleware } from './middleware/cache.middleware';
import {
  appConfig,
} from './config';
import { 
  bilibiliRouter, 
  csdnRouter, 
  githubRouter, 
  juejinRouter, 
  leetcodeRouter 
} from './routes';
import metricsRouter from './routes/metrics.routes';
import { PostgreSQLManager } from './utils/pgManager';
import prometheusService from './services/prometheus.service';
import { handleHomePage, handleHealthCheck, handleLivenessProbe, handleThemeTest } from './controllers/home.controller';

// 初始化数据库连接管理器
// PostgreSQL 是唯一持久层（MongoDB 已于 2026-11 下线）
const dbManager = PostgreSQLManager.getInstance();

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

// 应用业务中间件（MongoDB 已下线，不再有连接预热中间件）
app.use(themeMiddleware);
// 健康检查必须绕过缓存：/health 只读内存状态，若走缓存中间件就要等 Redis
// 连接（CI/Vercel 无 Redis 时每次请求挂 5 秒），启动阶段的探活会被一路拖慢。
app.use(createCacheMiddleware({
    skipCache: (req) => req.path === '/health'
}));

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
// 存活探针与 /health 分开：CI 干净环境没有数据库，用 /health 等启动会永远等不到
app.get('/livez', handleLivenessProbe);
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
        // 先监听端口，再把数据库连接放到后台执行。
        // 数据库不可达时（本地无 DB、Vercel 冷启动、CI 冒烟测试），pgManager.connect
        // 会阻塞 30~60 秒，之前 await 它导致 HTTP 服务迟迟不 ready，
        // CI 30 秒健康检查失败、Vercel 函数调用直接超时。
        // 连接逻辑本身是幂等的，中间件会按需触发 ensureConnection()。
        // 显式指定 0.0.0.0：缺省 host 时 Node 会走一次 dns.lookup（占用 libuv 线程池），
        // 在 CI 这类「PG/Mongo/Redis 同时连接失败、线程池被打满」的环境里，这次 lookup
        // 会排队 30 秒以上，表现为端口迟迟不监听、健康检查一路失败。
        server = app.listen(port, '0.0.0.0', () => {
            // 导入需要在运行时动态导入，避免循环依赖
            const { secureLogger } = require('./utils/logger');
            secureLogger.info(`🚀 服务已启动于端口 ${port}`);
            secureLogger.info(`📊 数据库状态: ${dbManager.getConnectionStatus().isConnected ? '已连接' : '未连接'}`);
        });

        // 后台连接数据库（即使失败也继续提供服务）
        void dbManager.connect().catch(error => {
            // 导入需要在运行时动态导入，避免循环依赖
            const { secureLogger } = require('./utils/logger');
            secureLogger.warn('⚠️  数据库连接失败，将在后台继续尝试连接:', error);
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
    const { cacheService } = require('./services/cache.service');
    secureLogger.info('🛑 接收到终止信号');

    try {
        // 1. 停止接受新请求
        server.close(() => {
            secureLogger.info('🚫 已停止接受新请求');
        });

        // 2. 关闭缓存服务
        await cacheService.close();
        secureLogger.info('✅ Redis连接已关闭');

        // 3. 关闭数据库连接
        await dbManager.disconnect();
        secureLogger.info('✅ PostgreSQL连接已关闭');

        // 4. 关闭现有连接
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

// 导出应用供Vercel使用
export default app;

// 初始化并启动服务（仅在直接运行时执行）
if (require.main === module) {
    startServer().then(serverInstance => {
        // 处理其他关闭信号
        process.on('SIGTERM', async () => {
            // 导入需要在运行时动态导入，避免循环依赖
            const { secureLogger } = require('./utils/logger');
            const { cacheService } = require('./services/cache.service');
            secureLogger.info('🛑 接收到SIGTERM信号');
            
            try {
                // 关闭缓存服务
                await cacheService.close();
                secureLogger.info('✅ Redis连接已关闭');
            } catch (error) {
                secureLogger.error('❌ 关闭Redis连接失败:', error);
            }
            
            serverInstance.close();
        });
        
        // 初始化Prometheus服务
        prometheusService.initialize();
        // 导入需要在运行时动态导入，避免循环依赖
        const { secureLogger } = require('./utils/logger');
        secureLogger.info('📊 Prometheus监控已初始化');
    });
}
