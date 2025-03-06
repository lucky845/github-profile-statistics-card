import { Request, Response, NextFunction } from 'express';
import mongoose from 'mongoose';
import { dbConfig } from '../config';

let client: mongoose.Connection | null = null;

// 连接MongoDB数据库
export const connectDB = async (): Promise<boolean> => {
    if (client) {
        console.log('MongoDB 已连接，重用连接');
        return true;
    }
    try {
        // 检查是否有MongoDB URI
        if (!dbConfig.mongoURI) {
            console.error("MongoDB URI 未设置，使用内存模式");
            return false;
        }

        const conn = await mongoose.connect(dbConfig.mongoURI, dbConfig.options);
        client = conn.connection;
        console.log(`MongoDB Connected: ${client.host}`);
        return true;
    } catch (error: any) {
        console.error(`MongoDB Connection Error: ${error.message}`);
        return false;
    }
};

export const mongoMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const isMongoConnected = mongoose.connection.readyState === 1;
        if (!isMongoConnected) {
            await connectDB();
        }
        next(); // 继续处理请求
    } catch (error: any) {
        console.error(`MongoDB连接失败: ${error.message}`);
        res.status(500).send('数据库连接失败'); // 返回错误响应
    }
}; 