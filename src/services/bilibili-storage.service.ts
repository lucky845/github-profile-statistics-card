import { StorageStrategy, storageService } from './storage.service';
import { IBilibiliUser } from '../types';
import { getBilibiliInfo } from './bilibili.service';
import { secureLogger } from '../utils/logger';

/**
 * 获取Bilibili用户数据，使用统一存储服务
 * @param uid 用户ID
 * @param cacheTimeInSeconds 缓存时间（秒）
 * @returns 用户数据和是否需要获取新数据的标志
 */
export const getBilibiliUserData = async (
    uid: string,
    cacheTimeInSeconds: number = 120
): Promise<{ data: IBilibiliUser | null; needsFetch: boolean }> => {
    try {
        // 构建缓存键
        const cacheKey = `BILIBILI:${uid}`;

        // 先尝试从统一存储服务获取数据
        const cachedData = await storageService.get<IBilibiliUser>(cacheKey);
        if (cachedData) {
            const now = new Date().getTime();
            const expireTime = cachedData.expireAt ? new Date(cachedData.expireAt).getTime() : 0;
            
            // 检查数据是否过期
            if (expireTime > now) {
                secureLogger.info(`Bilibili数据命中缓存: ${uid}`);
                return { data: cachedData, needsFetch: false };
            } else {
                // 数据已过期，需要重新获取
                secureLogger.info(`Bilibili缓存已过期: ${uid}`);
                return { data: cachedData, needsFetch: true };
            }
        }

        // 缓存未命中，需要从API获取数据
        secureLogger.info(`Bilibili缓存未命中，需要从API获取数据: ${uid}`);
        return { data: null, needsFetch: true };    
    } catch (error) {
        secureLogger.error('获取Bilibili用户数据失败:', error);
        return { data: null, needsFetch: true };
    }
};

/**
 * 更新Bilibili用户数据到统一存储服务
 * @param uid 用户ID
 * @param data 用户数据
 * @param cacheTimeInSeconds 缓存时间（秒）
 */
export const updateBilibiliUserData = async (
    uid: string,
    data: IBilibiliUser,
    cacheTimeInSeconds: number = 120
): Promise<void> => {
    try {
        // 构建缓存键
        const cacheKey = `BILIBILI:${uid}`;
        
        // 使用统一存储服务更新数据
        await storageService.set(cacheKey, data, cacheTimeInSeconds);
        secureLogger.info(`Bilibili用户数据已更新到统一存储服务: ${uid}`);
    } catch (error) {
        secureLogger.error('更新Bilibili用户数据失败:', error);
        throw error;
    }
};