import {Request, Response, NextFunction} from 'express';
import {MongoDBManager} from '../utils/dbManager';
import {secureLogger} from '../utils/logger';

/**
 * MongoDB连接中间件
 * 检查MongoDB连接状态，如果连接失败则使用备用缓存机制
 */
export const mongoConnectionMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        // 检查数据库连接状态，设置更长的超时时间
        const dbManager = MongoDBManager.getInstance();
        const isConnected = await Promise.race([
            dbManager.ensureConnection(),
            new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5000)) // 5秒超时
        ]);
        
        if (!isConnected) {
            secureLogger.warn('MongoDB connection failed or timed out, using memory cache as fallback');
            // 设置标志表示使用备用缓存
            (req as any).useFallbackCache = true;
        } else {
            (req as any).useFallbackCache = false;
        }
        
        next();
    } catch (error) {
        secureLogger.error('MongoDB connection check failed:', error);
        // 即使数据库连接检查失败，也继续处理请求
        (req as any).useFallbackCache = true;
        next();
    }
};