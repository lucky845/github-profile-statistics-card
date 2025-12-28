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
  abstract close(): Promise<void>;
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

  async close(): Promise<void> {
    // 无操作，因为这是一个模拟的缓存服务
    return;
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

  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(config: CacheConfig) {
    super();
    this.ttl = config.ttl;
    
    // 创建Redis连接池，限制最大连接数为10
    this.client = createClientPool({
      username: process.env.REDIS_USERNAME || 'default',
      password: process.env.REDIS_PASSWORD,
      socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        reconnectStrategy: (retries: number) => {
          // 重连策略：最多重试10次，每次间隔增加
          if (retries > 10) {
            secureLogger.error('❌ Redis重连次数超过限制');
            return new Error('Retry time exhausted');
          }
          // 渐进式延迟重连
          return Math.min(retries * 500, 3000);
        },
        connectTimeout: 10000, // 10秒连接超时
      }
    }, {
      minimum: 1,
      maximum: 10, // 限制最大连接数为10，避免超出免费服务限制
      acquireTimeout: 5000,
      cleanupDelay: 3000
    });

    // 添加错误事件监听器，捕获未预期的错误事件
    this.client.on('error', (error) => {
      // 检查是否是连接已关闭的错误，这类错误可以忽略
      const errorMessage = error.message;
      const errorName = (error as any).name || '';
      
      if (errorMessage.includes('Socket closed unexpectedly') || 
          errorMessage.includes('Connection closed') ||
          errorMessage.includes('Cannot send commands on a closed connection') ||
          errorMessage.includes('The client is closed') ||
          errorName === 'ClientClosedError' || // 添加对ClientClosedError错误类型的检查
          error.code === 'ECONNRESET' || // 连接重置错误
          error.code === 'ECONNREFUSED' || // 连接被拒绝错误
          error.code === 'ETIMEDOUT') { // 连接超时错误
        // 这些是在关闭连接或网络不稳定时可能发生的正常错误，可以忽略
        secureLogger.debug(`Redis error event (ignored): ${errorName || 'Error'} - ${errorMessage}${error.code ? ` (${error.code})` : ''}`);
      } else {
        // 记录其他类型的错误
        secureLogger.error(`❌ Redis error event: ${errorName || 'Error'} - ${errorMessage}${error.code ? ` (${error.code})` : ''}`);
      }
    });

    // 连接Redis
    this.connect();
    
    // 启动心跳检测
    this.startHeartbeat();
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

  /**
   * 检查并确保Redis连接有效
   * 如果连接断开，尝试重新连接
   */
  private async ensureConnection(): Promise<boolean> {
    // 如果已经连接，尝试执行一个简单的命令来验证连接
    if (this.isConnected) {
      try {
        await this.client.execute(client => client.ping());
        return true;
      } catch (error) {
        secureLogger.warn('Redis connection lost, attempting to reconnect...', { error: (error as Error).message });
        this.isConnected = false;
      }
    }

    // 尝试重新连接，最多重试3次
    let retries = 0;
    const maxRetries = 3;
    
    while (retries < maxRetries) {
      try {
        await this.connect();
        if (this.isConnected) {
          secureLogger.info(`✅ Redis reconnected successfully after ${retries + 1} attempts`);
          return true;
        }
      } catch (error) {
        secureLogger.warn(`Redis reconnect attempt ${retries + 1} failed: ${(error as Error).message}`);
      }
      
      retries++;
      // 等待一段时间再重试
      if (retries < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * retries));
      }
    }
    
    secureLogger.error(`❌ Redis reconnect failed after ${maxRetries} attempts`);
    return false;
  }

  /**
   * 启动心跳检测
   * 定期检查Redis连接状态
   */
  private startHeartbeat(): void {
    // 每30秒检查一次连接状态
    this.heartbeatInterval = setInterval(async () => {
      if (this.isConnected) {
        try {
          await this.client.execute(client => client.ping());
          secureLogger.debug('Redis heartbeat check: OK');
        } catch (error) {
          secureLogger.warn('Redis heartbeat check failed, connection may be lost', { error: (error as Error).message });
          this.isConnected = false;
          
          // 立即尝试重新连接
          const reconnected = await this.ensureConnection();
          if (reconnected) {
            secureLogger.info('✅ Redis reconnected through heartbeat check');
          } else {
            secureLogger.error('❌ Redis reconnection failed through heartbeat check');
          }
        }
      } else {
        // 如果连接已断开，尝试重新连接
        const reconnected = await this.ensureConnection();
        if (reconnected) {
          secureLogger.info('✅ Redis reconnected through heartbeat check (was disconnected)');
        }
      }
    }, 30000); // 30秒间隔
  }

  /**
   * 停止心跳检测
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  async get<T>(key: string): Promise<T | undefined> {
    // 确保连接有效
    if (!await this.ensureConnection()) {
      this.misses++;
      return undefined;
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
      // 检查是否是连接错误，如果是则标记连接失效
      if ((error as Error).message.includes('Socket closed unexpectedly') || 
          (error as Error).message.includes('Connection closed')) {
        this.isConnected = false;
      }
      secureLogger.error(`❌ Redis get error for key ${key}: ${(error as Error).message}`);
      this.misses++;
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<boolean> {
    // 确保连接有效
    if (!await this.ensureConnection()) {
      return false;
    }

    try {
      const serializedValue = JSON.stringify(value);
      await this.client.execute(client => client.set(key, serializedValue, { 
        EX: ttl || this.ttl 
      }));
      secureLogger.debug(`Cache set: ${key}`);
      return true;
    } catch (error) {
      // 检查是否是连接错误，如果是则标记连接失效
      if ((error as Error).message.includes('Socket closed unexpectedly') || 
          (error as Error).message.includes('Connection closed')) {
        this.isConnected = false;
      }
      secureLogger.error(`❌ Redis set error for key ${key}: ${(error as Error).message}`);
      return false;
    }
  }

  async delete(key: string): Promise<boolean> {
    // 确保连接有效
    if (!await this.ensureConnection()) {
      return false;
    }

    try {
      const result = await this.client.execute(client => client.del(key));
      return result > 0;
    } catch (error) {
      // 检查是否是连接错误，如果是则标记连接失效
      if ((error as Error).message.includes('Socket closed unexpectedly') || 
          (error as Error).message.includes('Connection closed')) {
        this.isConnected = false;
      }
      secureLogger.error(`❌ Redis delete error for key ${key}: ${(error as Error).message}`);
      return false;
    }
  }

  async clear(): Promise<boolean> {
    // 确保连接有效
    if (!await this.ensureConnection()) {
      return false;
    }

    try {
      await this.client.execute(client => client.flushAll());
      return true;
    } catch (error) {
      // 检查是否是连接错误，如果是则标记连接失效
      if ((error as Error).message.includes('Socket closed unexpectedly') || 
          (error as Error).message.includes('Connection closed')) {
        this.isConnected = false;
      }
      secureLogger.error(`❌ Redis clear error: ${(error as Error).message}`);
      return false;
    }
  }

  async deleteByPattern(pattern: string | RegExp): Promise<number> {
    // 确保连接有效
    if (!await this.ensureConnection()) {
      return 0;
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
      // 检查是否是连接错误，如果是则标记连接失效
      if ((error as Error).message.includes('Socket closed unexpectedly') || 
          (error as Error).message.includes('Connection closed')) {
        this.isConnected = false;
      }
      secureLogger.error(`❌ Redis deleteByPattern error: ${(error as Error).message}`);
      return 0;
    }
  }

  async clearGroup(group: string): Promise<number> {
    // 确保连接有效
    if (!await this.ensureConnection()) {
      return 0;
    }

    try {
      const keys = await this.client.execute(client => client.keys(`${group}:*`));
      if (keys.length === 0) return 0;
      
      const result = await this.client.execute(client => client.del(keys));
      return result;
    } catch (error) {
      // 检查是否是连接错误，如果是则标记连接失效
      if ((error as Error).message.includes('Socket closed unexpectedly') || 
          (error as Error).message.includes('Connection closed')) {
        this.isConnected = false;
      }
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

  /**
   * 优雅关闭Redis连接
   */
  async close(): Promise<void> {
    this.stopHeartbeat();
    
    // 如果客户端不存在，则直接返回
    if (!this.client) {
      secureLogger.debug('Redis client not initialized');
      return;
    }

    try {
      // 标记连接为断开状态，防止重复关闭
      this.isConnected = false;
      
      // 使用close()方法优雅关闭连接池
      // close()会等待所有待处理的命令完成后再关闭连接
      await this.client.close();
      
      secureLogger.info('✅ Redis connection closed gracefully');
      
      // 清空客户端引用，防止后续操作
      this.client = null as any;
    } catch (error) {
      // 检查是否是连接已关闭的错误，这类错误可以忽略
      const errorMessage = (error as Error).message;
      if (errorMessage.includes('Socket closed unexpectedly') || 
          errorMessage.includes('Connection closed') ||
          errorMessage.includes('Cannot send commands on a closed connection') ||
          errorMessage.includes('The client is closed') ||
          errorMessage.includes('Pool is closing') ||
          errorMessage.includes('ClientClosedError')) {
        secureLogger.debug('Redis connection already closed or closing, ignoring close error');
      } else {
        // 记录其他类型的错误
        secureLogger.error(`❌ Error closing Redis connection: ${errorMessage}${(error as any).code ? ` (${(error as any).code})` : ''}`);
      }
      
      // 无论如何都清空客户端引用
      this.client = null as any;
    }
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