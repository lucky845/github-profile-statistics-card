import { MongoDBManager } from '../utils/dbManager';

export const mongoMiddleware = async (req: any, res: any, next: any) => {
    try {
        // 确保连接可用（内部自动处理重连逻辑）
        await MongoDBManager.getInstance().ensureConnection();
        next();
    } catch (error) {
        res.status(503).json({
            code: 'DB_UNAVAILABLE',
            message: '数据库服务不可用'
        });
    }
};