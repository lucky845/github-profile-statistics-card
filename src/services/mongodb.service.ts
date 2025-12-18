import {IBilibiliUser, ICSDNUser, IGitHubUser, ILeetCodeUser, JuejinUserData} from '../types';
import {BilibiliUser, CSDNUser, GitHubUser, JueJinUser, LeetCodeUser} from '../models/mongodb.models';
import {memoryCache} from '../utils/cacheManager';
import {MongoDBManager} from '../utils/dbManager';
import {secureLogger} from '../utils/logger';
import mongoose from 'mongoose';
import {dbConfig} from '../config/db.config';

// 初始化数据库管理器
const dbManager = MongoDBManager.getInstance();
const CACHE_TTL = 86400; // 默认缓存24小时

// 数据库操作重试配置
const DB_RETRY_CONFIG = {
    maxRetries: 3,
    baseDelay: 100, // 基础延迟时间（毫秒）
    maxDelay: 2000 // 最大延迟时间（毫秒）
};

// 计算重试延迟时间
const calculateRetryDelay = (attempt: number): number => {
    return Math.min(DB_RETRY_CONFIG.baseDelay * Math.pow(2, attempt), DB_RETRY_CONFIG.maxDelay);
};

// 统一缓存验证方法
const validateCache = <T extends { lastUpdated: Date | number | string }>(
    data: T | null,
    ttl: number
): { data: T | null; needsFetch: boolean } => {
    if (!data) return {data: null, needsFetch: true};

    const now = Date.now();
    const lastUpdated = data.lastUpdated instanceof Date
        ? data.lastUpdated.getTime()
        : typeof data.lastUpdated === 'string'
            ? new Date(data.lastUpdated).getTime()
            : data.lastUpdated;

    return {
        data,
        needsFetch: (now - lastUpdated) / 1000 > ttl
    };
};

// 统一数据库操作处理器（支持重试）
const handleDbOperation = async <T>(
    operation: () => Promise<T>,
    fallback?: () => T,
    operationName: string = 'database'
): Promise<T> => {
    // 检查是否配置了使用内存缓存，如果是，直接使用fallback或者返回默认值
    if (dbConfig.useMemoryCache) {
        secureLogger.info(`[${operationName}] 使用内存缓存模式，跳过数据库操作`);
        if (fallback) {
            return fallback();
        }
        // 如果没有fallback，返回适当的默认值
        return null as unknown as T;
    }
    
    // 快速检查数据库连接状态，如果未连接且有fallback，直接使用fallback
    if (fallback && !dbManager.isConnected) {
        secureLogger.warn(`[${operationName}] 数据库未连接，直接使用fallback`);
        return fallback();
    }
    
    let lastError: Error | null = null;
    
    for (let attempt = 0; attempt <= DB_RETRY_CONFIG.maxRetries; attempt++) {
        try {
            // 快速检查连接状态，避免在每次尝试时都等待连接超时
            if (!dbManager.isConnected) {
                // 尝试建立连接，但设置一个短超时
                const connectPromise = dbManager.ensureConnection();
                const timeoutPromise = new Promise<boolean>((_, reject) => 
                    setTimeout(() => reject(new Error('Database connection timeout')), 3000)
                );
                
                try {
                    await Promise.race([connectPromise, timeoutPromise]);
                } catch (connectError) {
                    secureLogger.warn(`[${operationName}] 数据库连接失败: ${(connectError as Error).message}`);
                    if (fallback) {
                        return fallback();
                    }
                    continue;
                }
            }
            
            secureLogger.debug(`Executing ${operationName} operation, attempt ${attempt + 1}`);
            const result = await operation();
            return result;
        } catch (error: any) {
            lastError = error;
            secureLogger.error(`Database operation error (attempt ${attempt + 1}/${DB_RETRY_CONFIG.maxRetries + 1}): ${error.message}`);
            
            // 如果是最后一次尝试，或者有fallback函数，不进行重试
            if (attempt >= DB_RETRY_CONFIG.maxRetries || fallback) break;
            
            // 计算重试延迟并等待
            const delay = calculateRetryDelay(attempt);
            secureLogger.info(`Retrying ${operationName} operation in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    
    // 如果有fallback函数，使用fallback
    if (fallback) {
        secureLogger.warn(`Using fallback for ${operationName} operation`);
        return fallback();
    }
    
    // 所有重试都失败，抛出最后一个错误
    throw lastError || new Error('Database operation failed without error information');
};

// LeetCode 服务
export const getLeetCodeUserData = async (
    username: string,
    cacheTime = CACHE_TTL
): Promise<{ data: ILeetCodeUser | null; needsFetch: boolean }> => {
    try {
        // 先尝试内存缓存
        const cacheResult = validateCache(
            memoryCache.leetcode[username],
            cacheTime
        );

        // 如果内存缓存有数据且未过期，直接返回
        if (cacheResult.data && !cacheResult.needsFetch) {
            return cacheResult;
        }

        // 尝试数据库查询（作为补充）
        try {
            const dbResult: any = await handleDbOperation(async () => {
                const data = await LeetCodeUser.findOne({username}).lean();
                const dbValidation = validateCache(data, cacheTime);
                
                // 如果数据库有更新的数据，同步到内存缓存
                if (dbValidation.data && !dbValidation.needsFetch) {
                    memoryCache.leetcode[username] = dbValidation.data;
                    return dbValidation;
                }
                
                return dbValidation;
            }, () => cacheResult, `getLeetCodeUserData for ${username}`);

            if (dbResult.data) return dbResult;
        } catch (dbError) {
            secureLogger.warn(`[LeetCode] 数据库查询失败，将使用内存缓存: ${(dbError as Error).message}`);
        }

        return cacheResult;

    } catch (error: any) {
        secureLogger.error(`[LeetCode] 获取数据失败: ${error.message}`);
        return {data: null, needsFetch: true};
    }
};

export const updateLeetCodeData = async (
    username: string,
    userData: ILeetCodeUser,
    cacheTime = CACHE_TTL
) => {
    try {
        // 先更新内存缓存（确保响应迅速）
        memoryCache.leetcode[username] = {
            ...userData,
            lastUpdated: new Date()
        };

        // 尝试更新数据库（异步，不阻塞）
        handleDbOperation(async () => {
            await LeetCodeUser.findOneAndUpdate(
                {username},
                {...userData, lastUpdated: new Date()},
                {upsert: true, new: true}
            );
        }, undefined, `updateLeetCodeData for ${username}`).catch(dbError => {
            secureLogger.warn(`[LeetCode] 数据库更新失败，仅内存缓存已更新: ${dbError.message}`);
        });

        return true;

    } catch (error: any) {
        console.error(`[LeetCode] 更新失败: ${error.message}`);
        return false;
    }
};

// GitHub 服务
export const getGitHubUserData = async (username: string) => {
    try {
        // 先检查内存缓存
        const cachedData = memoryCache.github[username];
        const fallbackResult = cachedData ? {
            userData: {
                ...cachedData,
                avatarUpdatedAt: cachedData.avatarUpdatedAt || new Date()
            }
        } : {userData: null};

        // 如果内存缓存有数据，直接返回
        if (cachedData) {
            return fallbackResult;
        }

        // 尝试数据库查询（作为补充）
        try {
            const dbResult = await handleDbOperation(async () => {
                const data = await GitHubUser.findOne({username}).lean();
                const result = data ? {...data, avatarUpdatedAt: data.avatarUpdatedAt || new Date()} : null;
                
                // 如果数据库有数据，同步到内存缓存
                if (result) {
                    memoryCache.github[username] = result;
                }
                
                return result;
            }, () => null, `getGitHubUserData for ${username}`);

            if (dbResult) return {userData: dbResult};
        } catch (dbError) {
            secureLogger.warn(`[GitHub] 数据库查询失败，将使用内存缓存: ${(dbError as Error).message}`);
        }

        return fallbackResult;

    } catch (error: any) {
        secureLogger.error(`[GitHub] 获取数据失败: ${error.message}`);
        return {userData: null};
    }
};

export const updateGitHubUserData = async (
    username: string,
    oldUserData: IGitHubUser | null,
    avatarUrl?: string
) => {
    const now = new Date();
    
    // 先更新内存缓存
    const currentCacheData = memoryCache.github[username] || oldUserData;
    const newCacheData = {
        ...(currentCacheData || {}),
        username,
        visitCount: (currentCacheData?.visitCount || 0) + 1,
        lastVisited: now,
        lastUpdated: now,
        avatarUrl: avatarUrl || (currentCacheData?.avatarUrl || ''),
        avatarUpdatedAt: avatarUrl ? now : (currentCacheData?.avatarUpdatedAt || now)
    };
    
    memoryCache.github[username] = newCacheData;

    try {
        // 尝试更新数据库（异步，不阻塞）
        const dbUserData = oldUserData ? {
            $inc: {visitCount: 1},
            $set: {
                lastVisited: now,
                lastUpdated: now,
                ...(avatarUrl && {
                    avatarUrl,
                    avatarUpdatedAt: now
                })
            }
        } : {
            username,
            visitCount: 1,
            lastVisited: now,
            lastUpdated: now,
            avatarUrl: avatarUrl || '',
            avatarUpdatedAt: now
        };
        
        handleDbOperation(async () => {
            if (oldUserData) {
                await GitHubUser.findOneAndUpdate(
                    {username},
                    dbUserData,
                    {upsert: true, new: true}
                );
            } else {
                await GitHubUser.create(dbUserData);
            }
        }, undefined, `updateGitHubUserData for ${username}`).catch(dbError => {
            secureLogger.warn(`[GitHub] 数据库更新失败，仅内存缓存已更新: ${dbError.message}`);
        });

        return true;

    } catch (error: any) {
        console.error(`[GitHub] 更新失败: ${error.message}`);
        // 即使数据库更新失败，内存缓存已经更新，所以仍然返回true
        return true;
    }
};

// CSDN 服务
export const getCSDNUserData = async (
    userId: string,
    cacheTime = CACHE_TTL
) => {
    try {
        // 尝试数据库查询
        const dbResult = await handleDbOperation(async () => {
            const data = await CSDNUser.findOne({userId}).lean();
            return validateCache(data, cacheTime);
        }, () => {
            // 回退到内存缓存
            const cacheResult = validateCache(
                memoryCache.csdn[userId],
                cacheTime
            );
            return cacheResult;
        }, 'CSDNUserData');

        return dbResult;

    } catch (error: any) {
        console.error(`[CSDN] 获取数据失败: ${error.message}`);
        return {data: null, needsFetch: true};
    }
};

export const updateCSDNUserData = async (
    userId: string,
    userData: Partial<ICSDNUser>
) => {
    const updatedData = {...userData, userId};

    try {
        // 数据库操作
        await handleDbOperation(async () => {
            await CSDNUser.findOneAndUpdate(
                {userId},
                updatedData,
                {upsert: true, new: true}
            );
        });

        // 更新缓存
        memoryCache.csdn[userId] = {
            ...(memoryCache.csdn[userId] || {
                userId,
                username: userId,
                articleCount: 0,
                followers: 0,
                likes: 0,
                views: 0,
                comments: 0,
                points: 0,
                visitCount: 0
            }),
            ...updatedData,
            lastUpdated: new Date()
        };

        return true;

    } catch (error: any) {
        console.error(`[CSDN] 更新失败: ${error.message}`);
        return false;
    }
};

// 掘金服务
export const getJuejinUserData = async (
    userId: string,
    cacheTime = CACHE_TTL
) => {
    try {
        // 先尝试内存缓存（快速响应）
        const cacheResult = validateCache(
            memoryCache.juejin[userId],
            cacheTime
        );
        
        // 如果内存缓存有数据且未过期，直接返回
        if (cacheResult.data && !cacheResult.needsFetch) {
            return cacheResult;
        }

        // 尝试数据库查询（作为补充）
        try {
            const dbResult = await handleDbOperation(async () => {
                const data = await JueJinUser.findOne({userId}).lean();
                // 使用类型断言确保数据符合validateCache的泛型约束
                return validateCache(data as { lastUpdated: Date | number | string } | null, cacheTime);
            });

            if (dbResult.data && !dbResult.needsFetch) {
                // 如果数据库有更新的数据，同步到内存缓存
                memoryCache.juejin[userId] = dbResult.data;
                return dbResult;
            }
        } catch (dbError) {
            secureLogger.warn(`[掘金] 数据库查询失败，将使用内存缓存: ${(dbError as Error).message}`);
        }

        return cacheResult;

    } catch (error: any) {
        console.error(`[掘金] 获取数据失败: ${error.message}`);
        return {data: null, needsFetch: true};
    }
};

export const updateJuejinUserData = async (
    userId: string,
    userData: JuejinUserData
) => {
    try {
        // 数据库操作
        await handleDbOperation(async () => {
            await JueJinUser.findOneAndUpdate(
                {userId},
                {...userData, lastUpdated: new Date()},
                {upsert: true, new: true}
            );
        });

        // 更新缓存
        memoryCache.juejin[userId] = {
            ...userData,
            lastUpdated: new Date()
        };

        return true;

    } catch (error: any) {
        console.error(`[掘金] 更新失败: ${error.message}`);
        return false;
    }
};

// Bilibili服务
export const getBilibiliUserData = async (uid: string, cacheTime: number = CACHE_TTL) => {
    try {
        // 尝试数据库查询
        const dbResult = await handleDbOperation(async () => {
            const data = await BilibiliUser.findOne({uid}).lean();
            return validateCache(data, cacheTime);
        });

        if (dbResult) return dbResult;

        // 回退到内存缓存
        const cacheResult = validateCache(
            memoryCache.bilibili[uid],
            cacheTime
        );

        return cacheResult;

    } catch (error: any) {
        console.error(`[Bilibili] 获取数据失败: ${error.message}`);
        return {data: null, needsFetch: true};
    }
};

// 更新Bilibili数据
export const updateBilibiliUserData = async (
    uid: string,
    userData: Partial<IBilibiliUser>
) => {
    try {
        // 数据库操作
        await handleDbOperation(async () => {
            await BilibiliUser.findOneAndUpdate(
                {uid},
                {...userData, lastUpdated: new Date()},
                {upsert: true, new: true}
            );
        });

        // 更新缓存
        memoryCache.bilibili[uid] = {
            ...userData,
            lastUpdated: new Date()
        };

        return true;

    } catch (error: any) {
        console.error(`[Bilibili] 更新失败: ${error.message}`);
        return false;
    }
};

