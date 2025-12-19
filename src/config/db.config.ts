import dotenv from 'dotenv';
dotenv.config();

// MongoDB连接配置
export const dbConfig = {
    // 从环境变量获取MongoDB URI，如果没有则使用默认值
    mongoURI: process.env.MONGODB_URI || "mongodb://localhost:27017/profile-stats",
    
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
}; 