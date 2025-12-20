/**
 * 缓存管理服务
 * 提供统一的缓存接口，支持多种缓存策略
 */

import { createClientPool, RedisClientPoolType } from 'redis';
import { secureLogger } from '../utils/logger';

// 缓存配置类型
export interface CacheConfig {
  ttl: number; // 过期时间（秒）
  checkperiod?: number; // 检查周期（秒）
  maxKeys?: number; // 最大键数量
  maxMemory?: number; // 最大内存使用量（MB）
}

// 缓存策略枚举
export enum CacheStrategy {
  REDIS = 'redis',
  NOOP = 'noop' // 无操作缓存，用于开发或测试
}

// 缓存统计信息
export interface CacheStats {
  hits: number;
  misses: number;
  keys: number;
  groups: number;
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
  abstract deleteByPattern(pattern: string | RegExp): Promise<number>;
  abstract clearGroup(group: string): Promise<number>;
  abstract getStats(): CacheStats;
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
  
  async deleteByPattern(pattern: string | RegExp): Promise<number> {
    return 0;
  }
  
  async clearGroup(group: string): Promise<number> {
    return 0;
  }

  getStats(): CacheStats {
    return { hits: 0, misses: 0, keys: 0, groups: 0, hitsRate: 0 };
  }
}

/**
 * Redis缓存服务实现
 */
class RedisCacheService extends BaseCacheService {
  private client: RedisClientPoolType;
  private hits: number = 0;
  private misses: number = 0;
  private ttl: number;
  private isConnected: boolean = false;

  constructor(config: CacheConfig) {
    super();
    this.ttl = config.ttl;
    
    // 创建Redis连接池，限制最大连接数为10
    this.client = createClientPool({
      username: process.env.REDIS_USERNAME || 'default',
      password: process.env.REDIS_PASSWORD,
      socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379')
      }
    }, {
      minimum: 1,
      maximum: 10, // 限制最大连接数为10，避免超出免费服务限制
      acquireTimeout: 5000,
      cleanupDelay: 3000
    });

    // 连接Redis
    this.connect();
  }

  private async connect(): Promise<void> {
    try {
      await this.client.connect();
      this.isConnected = true;
      secureLogger.info('✅ Redis connected with connection pool');
    } catch (error) {
      secureLogger.error(`❌ Redis connection error: ${(error as Error).message}`);
      this.isConnected = false;
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.isConnected) {
      try {
        await this.connect();
      } catch (error) {
        secureLogger.error(`❌ Redis get error: ${(error as Error).message}`);
        this.misses++;
        return undefined;
      }
    }

    try {
      const value = await this.client.execute(client => client.get(key));
      if (value === null || value === undefined) {
        this.misses++;
        return undefined;
      }
      this.hits++;
      return JSON.parse(value) as T;
    } catch (error) {
      secureLogger.error(`❌ Redis get error for key ${key}: ${(error as Error).message}`);
      this.misses++;
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<boolean> {
    if (!this.isConnected) {
      try {
        await this.connect();
      } catch (error) {
        secureLogger.error(`❌ Redis set error: ${(error as Error).message}`);
        return false;
      }
    }

    try {
      const serializedValue = JSON.stringify(value);
      await this.client.execute(client => client.set(key, serializedValue, { 
        EX: ttl || this.ttl 
      }));
      secureLogger.debug(`Cache set: ${key}`);
      return true;
    } catch (error) {
      secureLogger.error(`❌ Redis set error for key ${key}: ${(error as Error).message}`);
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    if (!this.isConnected) {
      try {
        await this.connect();
      } catch (error) {
        secureLogger.error(`❌ Redis delete error: ${(error as Error).message}`);
        return false;
      }
    }

    try {
      const result = await this.client.execute(client => client.del(key));
      return result > 0;
    } catch (error) {
      secureLogger.error(`❌ Redis delete error for key ${key}: ${(error as Error).message}`);
      return false;
    }
  }

  async clear(): Promise<boolean> {
    if (!this.isConnected) {
      try {
        await this.connect();
      } catch (error) {
        secureLogger.error(`❌ Redis clear error: ${(error as Error).message}`);
        return false;
      }
    }

    try {
      await this.client.execute(client => client.flushAll());
      return true;
    } catch (error) {
      secureLogger.error(`❌ Redis clear error: ${(error as Error).message}`);
      return false;
    }
  }

  async deleteByPattern(pattern: string | RegExp): Promise<number> {
    if (!this.isConnected) {
      try {
        await this.connect();
      } catch (error) {
        secureLogger.error(`❌ Redis deleteByPattern error: ${(error as Error).message}`);
        return 0;
      }
    }

    try {
      let patternStr: string;
      if (typeof pattern === 'string') {
        patternStr = pattern;
      } else {
        patternStr = pattern.source;
      }
      
      const keys = await this.client.execute(client => client.keys(patternStr));
      if (keys.length === 0) return 0;
      
      const result = await this.client.execute(client => client.del(keys));
      return result;
    } catch (error) {
      secureLogger.error(`❌ Redis deleteByPattern error: ${(error as Error).message}`);
      return 0;
    }
  }

  async clearGroup(group: string): Promise<number> {
    if (!this.isConnected) {
      try {
        await this.connect();
      } catch (error) {
        secureLogger.error(`❌ Redis clearGroup error: ${(error as Error).message}`);
        return 0;
      }
    }

    try {
      const keys = await this.client.execute(client => client.keys(`${group}:*`));
      if (keys.length === 0) return 0;
      
      const result = await this.client.execute(client => client.del(keys));
      return result;
    } catch (error) {
      secureLogger.error(`❌ Redis clearGroup error for group ${group}: ${(error as Error).message}`);
      return 0;
    }
  }

  getStats(): CacheStats {
    const total = this.hits + this.misses;
    return {
      hits: this.hits,
      misses: this.misses,
      keys: 0, // Redis不支持直接获取键数量，需要单独实现
      groups: 0, // Redis不支持直接获取分组数量
      hitsRate: total > 0 ? (this.hits / total) * 100 : 0
    };
  }
}

/**
 * 缓存服务工厂
 */
export class CacheServiceFactory {
  static createCacheService(
    strategy: CacheStrategy = CacheStrategy.REDIS, // 默认使用Redis
    config: CacheConfig = { ttl: 300 }
  ): BaseCacheService {
    switch (strategy) {
      case CacheStrategy.REDIS:
        return new RedisCacheService(config);
      case CacheStrategy.NOOP:
        return new NoopCacheService();
      default:
        secureLogger.warn(`Unknown cache strategy: ${strategy}, using redis cache`);
        return new RedisCacheService(config);
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
  maxKeys: 10000,
  maxMemory: 512 // 最大使用 512MB 内存
};

// 导出单例缓存服务
export const cacheService = CacheServiceFactory.createCacheService(
  CacheStrategy.REDIS,
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
      
      try {
        // 尝试从缓存获取
        const cachedValue = await cacheService.get(key);
        if (cachedValue !== undefined && cachedValue !== null) {
          return cachedValue;
        }

        // 执行原始方法
        const result = await originalMethod.apply(this, args);
        
        // 只有在结果非空时才缓存
        if (result !== undefined && result !== null) {
          // 避免缓存过大的对象
          const serializedSize = JSON.stringify(result).length;
          if (serializedSize < 1024 * 1024) { // 小于 1MB 的结果才缓存
            await cacheService.set(key, result, ttl);
          }
        }
        
        return result;
      } catch (error) {
        secureLogger.error(`Cache decorator error for key ${key}:`, { error: error instanceof Error ? error.message : String(error) });
        // 缓存错误不应该影响正常功能，继续执行原方法
        return originalMethod.apply(this, args);
      }
    };

    return descriptor;
  };
}