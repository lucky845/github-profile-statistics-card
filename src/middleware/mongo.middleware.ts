import {Request, Response, NextFunction} from 'express';
import {MongoDBManager} from '../utils/dbManager';
import {secureLogger} from '../utils/logger';

/** 单次连接尝试的硬超时：数据库不可达时不能把 HTTP 请求一起拖死 */
const CONNECT_TIMEOUT_MS = 800;

/** 连接失败后的冷却时间：避免每个请求都重新打一次数据库 */
const FAILURE_COOLDOWN_MS = 30_000;

let lastFailureAt = 0;

/**
 * MongoDB连接中间件
 * 检查MongoDB连接状态，如果连接失败则使用备用缓存机制。
 *
 * 注意：这里只做「快速判定」，绝不长时间等待数据库。
 * 早期实现每个请求都 await ensureConnection()（最长 5 秒），数据库不可达时
 * 首页/健康检查会被拖到超时，Vercel 上直接表现为函数调用失败。
 */
export const mongoConnectionMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    const dbManager = MongoDBManager.getInstance();

    // 已连接：零等待放行
    if (dbManager.isConnected) {
        (req as any).useFallbackCache = false;
        return next();
    }

    // 冷却期内：直接走降级，不在请求路径上重试
    if (Date.now() - lastFailureAt < FAILURE_COOLDOWN_MS) {
        (req as any).useFallbackCache = true;
        return next();
    }

    try {
        const isConnected = await Promise.race([
            dbManager.ensureConnection(),
            new Promise<boolean>(resolve => setTimeout(() => resolve(false), CONNECT_TIMEOUT_MS))
        ]);

        if (!isConnected) {
            lastFailureAt = Date.now();
            secureLogger.warn('MongoDB connection unavailable, using fallback cache');
            (req as any).useFallbackCache = true;
        } else {
            (req as any).useFallbackCache = false;
        }

        next();
    } catch (error) {
        lastFailureAt = Date.now();
        secureLogger.error('MongoDB connection check failed:', error);
        // 即使数据库连接检查失败，也继续处理请求
        (req as any).useFallbackCache = true;
        next();
    }
};
