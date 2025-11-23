/**
 * 缓存管理服务
 * 提供统一的缓存接口，支持多种缓存策略
 */

import NodeCache from 'node-cache';

// 缓存配置类型
export interface CacheConfig {
  ttl: number; // 过期时间（秒）
  checkperiod?: number; // 检查周期（秒）
  maxKeys?: number; // 最大键数量
}

// 缓存策略枚举
export enum CacheStrategy {
  MEMORY = 'memory',
  REDIS = 'redis', // 预留用于未来扩展
  NOOP = 'noop' // 无操作缓存，用于开发或测试
}

// 缓存统计信息
export interface CacheStats {
  hits: number;
  misses: number;
  keys: number;
  hitsRate: number;
}

/**
 * 缓存服务抽象接口
 */
export abstract class BaseCacheService {
  abstract get<T>(key: string): Promise<T | undefined>;
  abstract set<T>(key: string, value: T, ttl?: number): Promise<boolean>;
  abstract delete(key: string): Promise<boolean>;
  abstract clear(): Promise<boolean>;
  abstract getStats(): CacheStats;
}

/**
 * 内存缓存服务实现
 */
class MemoryCacheService extends BaseCacheService {
  private cache: NodeCache;
  private hits: number = 0;
  private misses: number = 0;

  constructor(config: CacheConfig) {
    super();
    this.cache = new NodeCache({
      stdTTL: config.ttl,
      checkperiod: config.checkperiod || 60,
      maxKeys: config.maxKeys || -1,
      useClones: false
    });
  }

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.cache.get<T>(key);
    if (value === undefined) {
      this.misses++;
      return undefined;
    }
    this.hits++;
    return value;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<boolean> {
    return this.cache.set(key, value, ttl || 0);
  }

  async delete(key: string): Promise<boolean> {
    return this.cache.del(key) > 0;
  }

  async clear(): Promise<boolean> {
    this.cache.flushAll();
    return true;
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      keys: this.cache.keys().length,
      hitsRate: total > 0 ? (this.hits / total) * 100 : 0
    };
  }
}

/**
 * 无操作缓存服务实现（用于开发或测试）
 */
class NoopCacheService extends BaseCacheService {
  async get<T>(key: string): Promise<T | undefined> {
    return undefined;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<boolean> {
    return true;
  }

  async delete(key: string): Promise<boolean> {
    return true;
  }

  async clear(): Promise<boolean> {
    return true;
  }

  getStats(): CacheStats {
    return { hits: 0, misses: 0, keys: 0, hitsRate: 0 };
  }
}

/**
 * 缓存服务工厂
 */
export class CacheServiceFactory {
  static createCacheService(
    strategy: CacheStrategy = CacheStrategy.MEMORY,
    config: CacheConfig = { ttl: 300 }
  ): BaseCacheService {
    switch (strategy) {
      case CacheStrategy.MEMORY:
        return new MemoryCacheService(config);
      case CacheStrategy.NOOP:
        return new NoopCacheService();
      default:
        console.warn(`Unknown cache strategy: ${strategy}, using memory cache`);
        return new MemoryCacheService(config);
    }
  }
}

/**
 * 缓存键生成器
 */
export class CacheKeyGenerator {
  /**
   * 生成GitHub缓存键
   */
  static generateGitHubKey(username: string, theme: string = 'default'): string {
    return `github:${username}:${theme}`;
  }

  /**
   * 生成LeetCode缓存键
   */
  static generateLeetCodeKey(username: string, theme: string = 'default'): string {
    return `leetcode:${username}:${theme}`;
  }

  /**
   * 生成CSDN缓存键
   */
  static generateCSDNKey(userId: string, theme: string = 'default'): string {
    return `csdn:${userId}:${theme}`;
  }

  /**
   * 生成掘金缓存键
   */
  static generateJuejinKey(userId: string, theme: string = 'default'): string {
    return `juejin:${userId}:${theme}`;
  }

  /**
   * 生成B站缓存键
   */
  static generateBilibiliKey(uid: string, theme: string = 'default'): string {
    return `bilibili:${uid}:${theme}`;
  }

  /**
   * 生成通用缓存键
   */
  static generateKey(prefix: string, ...parts: string[]): string {
    // 安全处理键名，移除可能导致问题的字符
    const safeParts = parts.map(part => 
      part.replace(/[^a-zA-Z0-9_.-]/g, '_')
    );
    return `${prefix}:${safeParts.join(':')}`;
  }
}

// 默认缓存服务实例
const defaultCacheConfig: CacheConfig = {
  ttl: 300, // 5分钟
  checkperiod: 60,
  maxKeys: 10000
};

// 导出单例缓存服务
export const cacheService = CacheServiceFactory.createCacheService(
  CacheStrategy.MEMORY,
  defaultCacheConfig
);

/**
 * 缓存装饰器
 * 用于简化缓存逻辑
 */
export function Cacheable(
  keyGenerator: (...args: any[]) => string,
  ttl: number = 300
) {
  return function(
    target: Object,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;

    descriptor.value = async function(...args: any[]) {
      const key = keyGenerator(...args);
      
      // 尝试从缓存获取
      const cachedValue = await cacheService.get(key);
      if (cachedValue !== null) {
        return cachedValue;
      }

      // 执行原始方法
      const result = await originalMethod.apply(this, args);
      
      // 缓存结果
      await cacheService.set(key, result, ttl);
      
      return result;
    };

    return descriptor;
  };
}