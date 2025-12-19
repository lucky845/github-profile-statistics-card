import { fetchLeetCodeStats } from './leetcode.service';
import { LeetCodeStats } from '../types';
import { storageService } from './storage.service';
import { secureLogger } from '../utils/logger';

// 缓存前缀
const CACHE_PREFIX = 'LEETCODE';

// 缓存时间 (24小时)
const CACHE_TTL = 24 * 60 * 60;

// 获取LeetCode用户数据
export const getLeetCodeUserData = async (username: string, useCN: boolean = false) => {
  try {
    // 使用统一存储服务获取数据
    const cacheKey = `${CACHE_PREFIX}:${username}:${useCN ? 'cn' : 'us'}`;
    const cachedData = await storageService.get<LeetCodeStats>(cacheKey);

    // 如果存储服务中有数据，直接返回
    if (cachedData) {
      secureLogger.info(`LeetCode数据命中缓存: ${username}`);
      return { userData: cachedData };
    }

    // 如果存储服务中没有数据，从API获取
    secureLogger.info(`LeetCode缓存未命中，从API获取数据: ${username}`);
    const result = await fetchLeetCodeStats(username, useCN);
    
    if (result.success && result.data) {
      // 将数据存储到统一存储服务中
      await storageService.set(cacheKey, result.data, CACHE_TTL);
      return { userData: result.data };
    }

    return { userData: null };
  } catch (error: any) {
    secureLogger.error(`[LeetCode] 获取数据失败: ${error.message}`);
    return { userData: null };
  }
};

/**
 * 更新LeetCode用户数据到统一存储服务
 * @param username 用户名
 * @param data 用户数据
 * @param cacheTimeInSeconds 缓存时间（秒）
 */
export const updateLeetCodeUserData = async (
  username: string,
  data: LeetCodeStats,
  cacheTimeInSeconds: number = CACHE_TTL
): Promise<void> => {
  try {
    // 构建缓存键
    const cacheKey = `LEETCODE:${username}:${data.region === 'CN' ? 'cn' : 'us'}`;
    
    // 使用统一存储服务更新数据
    await storageService.set(cacheKey, data, cacheTimeInSeconds);
    secureLogger.info(`LeetCode用户数据已更新到统一存储服务: ${username}`);
  } catch (error: any) {
    secureLogger.error('[LeetCode] 更新数据失败:', error);
    throw error;
  }
};