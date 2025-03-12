import dotenv from 'dotenv';

dotenv.config();

export const bilibiliConfig = {
    bilibiliSession: process.env.BILIBILI_SESSDATA || '',
}; 