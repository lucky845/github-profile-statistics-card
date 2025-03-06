import dotenv from 'dotenv';

dotenv.config();

export const dbConfig = {
    mongoURI: process.env.MONGODB_URI || '',
    options: {
        serverSelectionTimeoutMS: 10000, // 增加超时时间到10秒
        socketTimeoutMS: 45000, // 增加socket超时
    }
}; 