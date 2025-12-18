import { MongoDBManager } from '../utils/dbManager';
import { secureLogger } from '../utils/logger';

export const mongoMiddleware = async (req: any, res: any, next: any) => {
    try {
        // 尝试确保连接可用，但即使失败也继续处理请求
        const isConnected = await MongoDBManager.getInstance().ensureConnection();
        
        if (!isConnected) {
            secureLogger.warn('⚠️  数据库连接不可用，将使用内存缓存');
        }
        
        next();
    } catch (error) {
        secureLogger.error('数据库连接检查失败:', error);
        // 即使发生错误，也继续处理请求
        next();
    }
};