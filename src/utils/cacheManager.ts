type CacheStore = {
    leetcode: Record<string, any>;
    github: Record<string, any>;
    csdn: Record<string, any>;
    juejin: Record<string, any>;
};

export const memoryCache: CacheStore = {
    leetcode: {},
    github: {},
    csdn: {},
    juejin: {},
};

export const clearExpiredCache = (ttl: number = 86400) => {
    const now = Date.now();

    Object.values(memoryCache).forEach((cache) => {
        Object.entries(cache).forEach(([key, value]) => {
            if ((now - new Date(value.lastUpdated).getTime()) / 1000 > ttl) {
                delete cache[key];
            }
        });
    });
};

// 启动定时清理任务
setInterval(() => clearExpiredCache(), 3600000); // 每小时清理一次