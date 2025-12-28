import dotenv from 'dotenv';
dotenv.config();

// 数据库连接配置
export const dbConfig = {
    // MongoDB连接配置
    mongo: {
        // 从环境变量获取MongoDB URI，如果没有则使用默认值
        uri: process.env.MONGODB_URI || "mongodb://localhost:27017/profile-stats",
        
        // MongoDB连接选项 - 增强的稳定性和错误处理
        options: {
            // 增加服务器选择超时时间到30秒
            serverSelectionTimeoutMS: 30000,
            
            // 增加Socket超时时间到2分钟
            socketTimeoutMS: 120000,
            
            // 增加连接超时时间到1分钟
            connectTimeoutMS: 60000,
            
            // 调整连接池大小
            maxPoolSize: 10,
            minPoolSize: 5,
            
            // 启用重试写入和读取
            retryWrites: true,
            retryReads: true,
            
            // 设置心跳频率为10秒
            heartbeatFrequencyMS: 10000,
            
            // 使用新的URL解析器
            useNewUrlParser: true,
            
            // 使用统一的拓扑引擎
            useUnifiedTopology: true,
            
            // 连接失败时的最大重试次数
            maxConnecting: 3
        }
    },
    
    // PostgreSQL连接配置
    postgres: {
        // 从环境变量获取PostgreSQL URI，如果没有则使用本地默认值
        uri: process.env.DATABASE_URL || "postgresql://localhost:5432/profile-stats",
        
        // PostgreSQL连接选项
        options: {
            // 连接池大小设置
            max: 10, // 连接池最大连接数
            min: 5, // 连接池最小连接数
            
            // 连接超时设置
            connectionTimeoutMillis: 60000, // 增加连接超时时间到1分钟
            idleTimeoutMillis: 300000, // 增加空闲超时时间到5分钟
            
            // 其他选项
            keepAlive: true,
            keepAliveInitialDelayMillis: 30000, // 保持连接的初始延迟
            
            // SSL配置 - 连接Supabase需要SSL
            ssl: {
                rejectUnauthorized: false // 允许自签名证书
            }
        }
    }
};