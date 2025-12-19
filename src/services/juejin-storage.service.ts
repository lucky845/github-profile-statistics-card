import { StorageStrategy, storageService } from './storage.service';
import { JuejinUserData } from '../types';
import getJuejinInfo from './juejin.service';
import { secureLogger } from '../utils/logger';

/**
 * 获取掘金用户数据，使用统一存储服务
 * @param userId 用户ID
 * @param cacheTimeInSeconds 缓存时间（秒）
 * @returns 用户数据和是否需要获取新数据的标志
 */
export const getJuejinUserData = async (
    userId: string,
    cacheTimeInSeconds: number = 120
): Promise<{ userData: JuejinUserData | null; needsFetch: boolean }> => {
    try {
        // 构建缓存键
        const cacheKey = `JUEJIN:${userId}`;

        // 先尝试从统一存储服务获取数据
        const cachedData = await storageService.get<JuejinUserData>(cacheKey);
        if (cachedData) {
            const now = new Date().getTime();
            const expireTime = cachedData.expireAt ? new Date(cachedData.expireAt).getTime() : 0;
            
            // 检查数据是否过期
            if (expireTime > now) {
                secureLogger.info(`掘金数据命中缓存: ${userId}`);
                return { userData: cachedData, needsFetch: false };
            } else {
                // 数据已过期，需要重新获取
                secureLogger.info(`掘金缓存已过期: ${userId}`);
                return { userData: cachedData, needsFetch: true };
            }
        }

        // 缓存未命中，需要从API获取数据
        secureLogger.info(`掘金缓存未命中，需要从API获取数据: ${userId}`);
        return { userData: null, needsFetch: true };
    } catch (error) {
        secureLogger.error('获取掘金用户数据失败:', error);
        return { userData: null, needsFetch: true };
    }
};

/**
 * 更新掘金用户数据到统一存储服务
 * @param userId 用户ID
 * @param data 用户数据
 * @param cacheTimeInSeconds 缓存时间（秒）
 */
export const updateJuejinUserData = async (
    userId: string,
    data: JuejinUserData,
    cacheTimeInSeconds: number = 120
): Promise<void> => {
    try {
        // 构建缓存键
        const cacheKey = `JUEJIN:${userId}`;
        
        // 使用统一存储服务更新数据
        await storageService.set(cacheKey, data, cacheTimeInSeconds);
        secureLogger.info(`掘金用户数据已更新到统一存储服务: ${userId}`);
    } catch (error) {
        secureLogger.error('更新掘金用户数据失败:', error);
        throw error;
    }
};