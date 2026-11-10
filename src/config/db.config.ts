import dotenv from 'dotenv';
dotenv.config();

// 数据库连接配置
export const dbConfig = {
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