import dotenv from 'dotenv';

dotenv.config();

export const dbConfig = {
    mongoURI: process.env.MONGODB_URI || '',
    options: {
        serverSelectionTimeoutMS: parseInt(process.env.MONGODB_SERVER_SELECTION_TIMEOUT || '15000'), // 增加超时时间到15秒
        socketTimeoutMS: parseInt(process.env.MONGODB_SOCKET_TIMEOUT || '60000'), // 增加socket超时到60秒
        connectTimeoutMS: parseInt(process.env.MONGODB_CONNECT_TIMEOUT || '30000'), // 连接超时时间
        maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE || '10'), // 设置最大连接池大小
        minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE || '5'), // 设置最小连接池大小
    },
    // 本地开发时设置为true使用内存缓存，线上环境未配置时默认使用MongoDB
    useMemoryCache: process.env.USE_MEMORY_CACHE === 'true'
}; 