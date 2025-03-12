import {IBilibiliUser, ICSDNUser, IGitHubUser, ILeetCodeUser, JuejinUserData} from '../types';
import {BilibiliUser, CSDNUser, GitHubUser, JueJinUser, LeetCodeUser} from '../models/mongodb.models';
import {memoryCache} from '../utils/cacheManager';
import {MongoDBManager} from '../utils/dbManager';

// 初始化数据库管理器
const dbManager = MongoDBManager.getInstance();
const CACHE_TTL = 86400; // 默认缓存24小时

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

// 统一数据库操作处理器
const handleDbOperation = async <T>(
    operation: () => Promise<T>,
    fallback?: () => T
): Promise<T> => {
    try {
        await dbManager.ensureConnection();
        return await operation();
    } catch (error: any) {
        console.warn(`Database operation failed: ${error.message}`);
        if (fallback) return fallback();
        throw error;
    }
};

// LeetCode 服务
export const getLeetCodeUserData = async (
    username: string,
    cacheTime = CACHE_TTL
): Promise<{ data: ILeetCodeUser | null; needsFetch: boolean }> => {
    try {
        // 尝试数据库查询
        const dbResult: any = await handleDbOperation(async () => {
            const data = await LeetCodeUser.findOne({username}).lean();
            return validateCache(data, cacheTime);
        });

        if (dbResult.data) return dbResult;

        // 回退到内存缓存
        const cacheResult = validateCache(
            memoryCache.leetcode[username],
            cacheTime
        );

        return cacheResult;

    } catch (error: any) {
        console.error(`[LeetCode] 获取数据失败: ${error.message}`);
        return {data: null, needsFetch: true};
    }
};

export const updateLeetCodeData = async (
    username: string,
    userData: ILeetCodeUser,
    cacheTime = CACHE_TTL
) => {
    try {
        // 优先更新数据库
        await handleDbOperation(async () => {
            await LeetCodeUser.findOneAndUpdate(
                {username},
                {...userData, lastUpdated: new Date()},
                {upsert: true, new: true}
            );
        });

        // 更新缓存
        memoryCache.leetcode[username] = {
            ...userData,
            lastUpdated: new Date()
        };

        return true;

    } catch (error: any) {
        console.error(`[LeetCode] 更新失败: ${error.message}`);
        return false;
    }
};

// GitHub 服务
export const getGitHubUserData = async (username: string) => {
    try {
        // 尝试数据库查询
        const dbResult = await handleDbOperation(async () => {
            const data = await GitHubUser.findOne({username}).lean();
            return data ? {...data, avatarUpdatedAt: data.avatarUpdatedAt || new Date()} : null;
        });

        if (dbResult) return {userData: dbResult};

        // 回退到内存缓存
        const cachedData = memoryCache.github[username];
        return {
            userData: cachedData ? {
                ...cachedData,
                avatarUpdatedAt: cachedData.avatarUpdatedAt || new Date()
            } : null
        };

    } catch (error: any) {
        console.error(`[GitHub] 获取数据失败: ${error.message}`);
        return {userData: null};
    }
};

export const updateGitHubUserData = async (
    username: string,
    oldUserData: IGitHubUser | null,
    avatarUrl?: string
) => {
    const now = new Date();
    const newUserData = oldUserData ? {
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

    try {
        // 数据库操作
        await handleDbOperation(async () => {
            if (oldUserData) {
                await GitHubUser.findOneAndUpdate(
                    {username},
                    newUserData,
                    {upsert: true, new: true}
                );
            } else {
                await GitHubUser.create(newUserData);
            }
        });

        // 更新缓存
        memoryCache.github[username] = {
            ...(oldUserData || {}),
            ...(oldUserData ? newUserData.$set : newUserData),
            visitCount: oldUserData ? oldUserData.visitCount + 1 : 1
        };

        return true;

    } catch (error: any) {
        console.error(`[GitHub] 更新失败: ${error.message}`);
        return false;
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
        });

        if (dbResult.data) return dbResult;

        // 回退到内存缓存
        const cacheResult = validateCache(
            memoryCache.csdn[userId],
            cacheTime
        );

        return cacheResult;

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
        // 尝试数据库查询
        const dbResult = await handleDbOperation(async () => {
            const data = await JueJinUser.findOne({userId}).lean();
            return validateCache(data, cacheTime);
        });

        if (dbResult.data) return dbResult;

        // 回退到内存缓存
        const cacheResult = validateCache(
            memoryCache.juejin[userId],
            cacheTime
        );

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
export const getBilibiliUserData = async (userId: string, cacheTime: number = CACHE_TTL) => {
    try {
        // 尝试数据库查询
        const dbResult = await handleDbOperation(async () => {
            const data = await BilibiliUser.findOne({userId}).lean();
            return validateCache(data, cacheTime);
        });

        if (dbResult) return dbResult;

        // 回退到内存缓存
        const cacheResult = validateCache(
            memoryCache.bilibili[userId],
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

