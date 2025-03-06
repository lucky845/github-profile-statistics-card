import dotenv from 'dotenv';

dotenv.config();

export const appConfig = {
  port: process.env.PORT || 3000,
  cacheTimeout: 24, // 数据缓存时间（小时）
}; 