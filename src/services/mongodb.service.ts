import { IBilibiliUser, ICSDNUser, IGitHubUser, ILeetCodeUser, JuejinUserData } from '../types';
import { BilibiliUser, CSDNUser, GitHubUser, JueJinUser, LeetCodeUser } from '../models/mongodb.models';
import { MongoDBManager } from '../utils/dbManager';
import { secureLogger } from '../utils/logger';

// 导入新的统一存储服务
import { storageService } from './storage.service';
import { cacheService } from './cache.service';

// 初始化数据库管理器
const dbManager = MongoDBManager.getInstance();

// 缓存键前缀配置
const CACHE_PREFIX = {
  LEETCODE: 'leetcode_data',
  GITHUB: 'github_data',
  JUEJIN: 'juejin_data',
  BILIBILI: 'bilibili_data',
  CSDN: 'csdn_data'
};

// 缓存过期时间配置（秒）
const CACHE_TTL = 30 * 60; // 30分钟

// 缓存验证函数
const validateCache = <T>(data: T): boolean => {
  if (!data) return false;
  
  // 对于用户数据对象，检查关键字段
  if (typeof data === 'object' && data !== null) {
    const userData = data as any;
    // 如果有时间戳，检查是否过期（假设数据中包含timestamp字段）
    if (userData.timestamp) {
      const now = Date.now();
      const dataTime = new Date(userData.timestamp).getTime();
      // 如果数据超过1小时，则认为过期
      if (now - dataTime > 60 * 60 * 1000) {
        return false;
      }
    }
    
    // 检查是否有必需的用户字段（根据不同平台调整）
    if ('userId' in userData || 'id' in userData) {
      return true;
    }
    
    // 如果是空对象，认为无效
    return Object.keys(userData).length > 0;
  }
  
  // 对于基本类型，只要不是null/undefined就认为有效
  return true;
};

// 数据库操作重试配置
const DB_RETRY_CONFIG = {
  maxRetries: 3,
  baseDelay: 1000,
  maxDelay: 10000,
  backoffMultiplier: 2
};

// 数据库操作错误类型枚举
enum DbErrorType {
  CONNECTION_ERROR = 'CONNECTION_ERROR',
  TIMEOUT_ERROR = 'TIMEOUT_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  DUPLICATE_ERROR = 'DUPLICATE_ERROR',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

// 数据库操作结果类型
interface DbOperationResult<T> {
  success: boolean;
  data?: T;
  error?: {
    type: DbErrorType;
    message: string;
    originalError: any;
  };
  shouldRetry: boolean;
}

// 通用数据库操作处理函数（带重试机制和详细的错误分类）
const handleDbOperation = async <T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<DbOperationResult<T>> => {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= DB_RETRY_CONFIG.maxRetries; attempt++) {
    try {
      const result = await operation();
      return {
        success: true,
        data: result,
        shouldRetry: false
      };
    } catch (error: any) {
      lastError = error;
      
      // 分析错误类型
      let errorType = DbErrorType.UNKNOWN_ERROR;
      let shouldRetry = true;
      
      // 根据错误信息判断错误类型
      if (error.message && error.message.includes('ECONNREFUSED')) {
        errorType = DbErrorType.CONNECTION_ERROR;
      } else if (error.message && error.message.includes('timeout')) {
        errorType = DbErrorType.TIMEOUT_ERROR;
      } else if (error.name === 'ValidationError') {
        errorType = DbErrorType.VALIDATION_ERROR;
        shouldRetry = false; // 验证错误通常不需要重试
      } else if (error.code === 11000) {
        errorType = DbErrorType.DUPLICATE_ERROR;
        shouldRetry = false; // 重复键错误通常不需要重试
      }
      
      secureLogger.warn(`数据库操作 "${operationName}" 第 ${attempt} 次尝试失败:`, {
        errorType,
        error: error.message,
        stack: error.stack
      });
      
      // 如果是验证错误或重复键错误，不重试
      if (!shouldRetry) {
        return {
          success: false,
          error: {
            type: errorType,
            message: error.message,
            originalError: error
          },
          shouldRetry: false
        };
      }
      
      // 如果不是最后一次尝试，则等待后重试
      if (attempt < DB_RETRY_CONFIG.maxRetries) {
        const delay = Math.min(
          DB_RETRY_CONFIG.baseDelay * Math.pow(DB_RETRY_CONFIG.backoffMultiplier, attempt - 1),
          DB_RETRY_CONFIG.maxDelay
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      } else {
        // 最后一次尝试失败
        return {
          success: false,
          error: {
            type: errorType,
            message: error.message,
            originalError: error
          },
          shouldRetry: false
        };
      }
    }
  }
  
  // 所有重试都失败了
  secureLogger.error(`数据库操作 "${operationName}" 在 ${DB_RETRY_CONFIG.maxRetries} 次尝试后仍然失败:`, {
    error: lastError?.message,
    stack: lastError?.stack
  });
  
  return {
    success: false,
    error: {
      type: DbErrorType.UNKNOWN_ERROR,
      message: lastError?.message || 'Unknown error',
      originalError: lastError
    },
    shouldRetry: false
  };
};

// 带重试机制的数据库操作包装函数
const withRetry = async <T>(
  operation: () => Promise<T>,
  context: string
): Promise<T | null> => {
  const result = await handleDbOperation(operation, context);
  return result.success && result.data !== undefined ? result.data : null;
};

// LeetCode 用户数据获取和更新函数 - 仅使用Redis缓存
export const getLeetCodeUserData = async (
  userId: string,
  cacheTime: number = CACHE_TTL
): Promise<{ userData: ILeetCodeUser | null, needsFetch: boolean }> => {
  try {
    // 参数验证
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId provided');
    }

    // 构造缓存键
    const cacheKey = `${CACHE_PREFIX.LEETCODE}:${userId}`;

    // 尝试从缓存获取数据
    const cachedData = await cacheService.get<ILeetCodeUser>(cacheKey);

    // 如果缓存中有有效数据，直接返回
    if (cachedData && validateCache(cachedData)) {
      return { userData: cachedData, needsFetch: false };
    }

    // 如果缓存没有数据，需要重新抓取
    return { userData: null, needsFetch: true };
  } catch (error: any) {
    secureLogger.error('获取LeetCode用户数据失败:', {
      userId,
      error: error.message,
      stack: error.stack
    });
    return { userData: null, needsFetch: true }; // 出错时也返回需要抓取，避免缓存错误状态
  }
};

export const updateLeetCodeData = async (
  userId: string,
  userData: Partial<ILeetCodeUser>
): Promise<boolean> => {
  try {
    // 参数验证
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId provided');
    }

    if (!userData || typeof userData !== 'object') {
      throw new Error('Invalid userData provided');
    }

    // 仅更新缓存
    const cacheKey = `${CACHE_PREFIX.LEETCODE}:${userId}`;
    await cacheService.set(cacheKey, userData, CACHE_TTL);
    return true;
  } catch (error: any) {
    secureLogger.error('更新LeetCode用户数据失败:', {
      userId,
      error: error.message,
      stack: error.stack
    });
    return false;
  }
};

// GitHub 用户数据获取和更新函数
export const getGitHubUserData = async (
  username: string,
  cacheTime: number = CACHE_TTL
): Promise<{ userData: IGitHubUser | null, needsFetch: boolean }> => {
  try {
    // 参数验证
    if (!username || typeof username !== 'string') {
      throw new Error('Invalid username provided');
    }

    // 构造缓存键
    const cacheKey = `${CACHE_PREFIX.GITHUB}:${username}`;

    // 尝试从缓存获取数据
    const cachedData = await cacheService.get<IGitHubUser>(cacheKey);

    // 如果缓存中有有效数据，直接返回
    if (cachedData && validateCache(cachedData)) {
      return { userData: cachedData, needsFetch: false };
    }

    // 使用统一存储服务获取GitHub用户访问数据
    const visitData = await storageService.getGitHubUserVisit(username);
    
    if (visitData) {
      // 转换为IGitHubUser格式
      const dbData: IGitHubUser = {
        username: visitData.username,
        visitCount: visitData.visit_count,
        lastVisited: visitData.last_visited,
        lastUpdated: visitData.last_visited,
        avatarUrl: visitData.avatar_url,
        avatarUpdatedAt: visitData.avatar_updated_at
      };
      
      // 更新缓存并返回
      await cacheService.set(cacheKey, dbData, cacheTime);
      return { userData: dbData, needsFetch: false };
    }

    // 如果缓存和数据库都没有数据，需要重新抓取
    return { userData: null, needsFetch: true };
  } catch (error: any) {
    secureLogger.error('获取GitHub用户数据失败:', {
      username,
      error: error.message,
      stack: error.stack
    });
    return { userData: null, needsFetch: true };
  }
};

export const updateGitHubUserData = async (
  username: string,
  userData: Partial<IGitHubUser>
): Promise<boolean> => {
  try {
    // 参数验证
    if (!username || typeof username !== 'string') {
      throw new Error('Invalid username provided');
    }

    if (!userData || typeof userData !== 'object') {
      throw new Error('Invalid userData provided');
    }

    // 准备要更新的数据
    const updateData: {
      visit_count?: number;
      avatar_url?: string;
      avatar_updated_at?: Date;
    } = {};
    
    if (userData.visitCount !== undefined) {
      updateData.visit_count = userData.visitCount;
    }
    
    if (userData.avatarUrl !== undefined) {
      updateData.avatar_url = userData.avatarUrl;
    }
    
    if (userData.avatarUpdatedAt !== undefined) {
      updateData.avatar_updated_at = userData.avatarUpdatedAt;
    }
    
    // 使用统一存储服务更新GitHub用户访问数据
    const updatedData = await storageService.updateGitHubUserVisit(username, updateData);
    
    if (updatedData) {
      // 更新缓存
      const cacheKey = `${CACHE_PREFIX.GITHUB}:${username}`;
      await cacheService.set(cacheKey, {
        username: updatedData.username,
        visitCount: updatedData.visit_count,
        lastVisited: updatedData.last_visited,
        lastUpdated: updatedData.last_visited,
        avatarUrl: updatedData.avatar_url,
        avatarUpdatedAt: updatedData.avatar_updated_at
      }, CACHE_TTL);
      
      return true;
    }

    return false;
  } catch (error: any) {
    secureLogger.error('更新GitHub用户数据失败:', {
      username,
      error: error.message,
      stack: error.stack
    });
    return false;
  }
};

// Juejin 用户数据获取和更新函数 - 仅使用Redis缓存
export const getJuejinUserData = async (
  userId: string,
  cacheTime: number = CACHE_TTL
): Promise<{ userData: JuejinUserData | null, needsFetch: boolean }> => {
  try {
    // 参数验证
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId provided');
    }

    // 构造缓存键
    const cacheKey = `${CACHE_PREFIX.JUEJIN}:${userId}`;

    // 尝试从缓存获取数据
    const cachedData = await cacheService.get<JuejinUserData>(cacheKey);

    // 如果缓存中有有效数据，直接返回
    if (cachedData && validateCache(cachedData)) {
      return { userData: cachedData, needsFetch: false };
    }

    // 如果缓存没有数据，需要重新抓取
    return { userData: null, needsFetch: true };
  } catch (error: any) {
    secureLogger.error('获取掘金用户数据失败:', {
      userId,
      error: error.message,
      stack: error.stack
    });
    return { userData: null, needsFetch: true };
  }
};

export const updateJuejinUserData = async (
  userId: string,
  userData: JuejinUserData
): Promise<boolean> => {
  try {
    // 参数验证
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId provided');
    }

    if (!userData || typeof userData !== 'object') {
      throw new Error('Invalid userData provided');
    }

    // 仅更新缓存
    const cacheKey = `${CACHE_PREFIX.JUEJIN}:${userId}`;
    await cacheService.set(cacheKey, userData, CACHE_TTL);
    return true;
  } catch (error: any) {
    secureLogger.error('更新掘金用户数据失败:', {
      userId,
      error: error.message,
      stack: error.stack
    });
    return false;
  }
};

// 为避免重复，移除重复的 updateJuejinUserData 函数定义
// 上面已经定义了一个完整的 updateJuejinUserData 函数

// Bilibili 用户数据获取和更新函数 - 仅使用Redis缓存
export const getBilibiliUserData = async (
  userId: string,
  cacheTime: number = CACHE_TTL
): Promise<{ userData: IBilibiliUser | null, needsFetch: boolean }> => {
  try {
    // 参数验证
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId provided');
    }

    // 构造缓存键
    const cacheKey = `${CACHE_PREFIX.BILIBILI}:${userId}`;

    // 尝试从缓存获取数据
    const cachedData = await cacheService.get<IBilibiliUser>(cacheKey);

    // 如果缓存中有有效数据，直接返回
    if (cachedData && validateCache(cachedData)) {
      return { userData: cachedData, needsFetch: false };
    }

    // 如果缓存没有数据，需要重新抓取
    return { userData: null, needsFetch: true };
  } catch (error: any) {
    secureLogger.error('获取Bilibili用户数据失败:', {
      userId,
      error: error.message,
      stack: error.stack
    });
    return { userData: null, needsFetch: true };
  }
};

export const updateBilibiliUserData = async (
  userId: string,
  userData: Partial<IBilibiliUser>
): Promise<boolean> => {
  try {
    // 参数验证
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId provided');
    }

    if (!userData || typeof userData !== 'object') {
      throw new Error('Invalid userData provided');
    }

    // 仅更新缓存
    const cacheKey = `${CACHE_PREFIX.BILIBILI}:${userId}`;
    await cacheService.set(cacheKey, userData, CACHE_TTL);
    return true;
  } catch (error: any) {
    secureLogger.error('更新Bilibili用户数据失败:', {
      userId,
      error: error.message,
      stack: error.stack
    });
    return false;
  }
};

// CSDN 用户数据获取和更新函数 - 仅使用Redis缓存
export const getCSDNUserData = async (
  userId: string,
  cacheTime: number = CACHE_TTL
): Promise<{ userData: ICSDNUser | null, needsFetch: boolean }> => {
  try {
    // 参数验证
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId provided');
    }

    // 构造缓存键
    const cacheKey = `${CACHE_PREFIX.CSDN}:${userId}`;

    // 尝试从缓存获取数据
    const cachedData = await cacheService.get<ICSDNUser>(cacheKey);

    // 如果缓存中有有效数据，直接返回
    if (cachedData && validateCache(cachedData)) {
      return { userData: cachedData, needsFetch: false };
    }

    // 如果缓存没有数据，需要重新抓取
    return { userData: null, needsFetch: true };
  } catch (error: any) {
    secureLogger.error('获取CSDN用户数据失败:', {
      userId,
      error: error.message,
      stack: error.stack
    });
    return { userData: null, needsFetch: true };
  }
};

export const updateCSDNUserData = async (
  userId: string,
  userData: Partial<ICSDNUser>
): Promise<boolean> => {
  try {
    // 参数验证
    if (!userId || typeof userId !== 'string') {
      throw new Error('Invalid userId provided');
    }

    if (!userData || typeof userData !== 'object') {
      throw new Error('Invalid userData provided');
    }

    // 仅更新缓存
    const cacheKey = `${CACHE_PREFIX.CSDN}:${userId}`;
    await cacheService.set(cacheKey, userData, CACHE_TTL);
    return true;
  } catch (error: any) {
    secureLogger.error('更新CSDN用户数据失败:', {
      userId,
      error: error.message,
      stack: error.stack
    });
    return false;
  }
};