import dotenv from 'dotenv';

dotenv.config();

export const dbConfig = {
    mongoURI: process.env.MONGODB_URI || '',
    options: {
        serverSelectionTimeoutMS: 15000, // 增加超时时间到15秒
        socketTimeoutMS: 60000, // 增加socket超时到60秒
        maxPoolSize: 10, // 设置最大连接池大小
    }
}; 