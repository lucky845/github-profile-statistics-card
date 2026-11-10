/**
 * 统一存储服务
 * 提供统一的存储接口：Redis 做缓存，PostgreSQL 做持久化（MongoDB 已下线）
 */

import { BaseCacheService, CacheServiceFactory, CacheStrategy, cacheService } from './cache.service';
import { PostgreSQLManager } from '../utils/pgManager';
import { secureLogger } from '../utils/logger';

// 存储策略枚举
export enum StorageStrategy {
  REDIS = 'redis',
  HYBRID = 'hybrid' // Redis + PostgreSQL混合模式
}

// 存储配置接口
export interface StorageConfig {
  strategy: StorageStrategy;
  ttl?: number; // 过期时间（秒）
  redisEnabled?: boolean; // 是否启用Redis
}

// 统一存储接口
export interface StorageService {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttl?: number): Promise<boolean>;
  delete(key: string): Promise<boolean>;
  clear(): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  getStorageStatus(): Promise<{
    strategy: StorageStrategy;
    redisConnected: boolean;
    pgConnected: boolean;
    fallbackMode: 'redis' | 'postgres' | 'none';
  }>;
}

/**
 * 统一存储服务实现
 */
export class UnifiedStorageService implements StorageService {
  private cacheService: BaseCacheService;
  private pgManager: PostgreSQLManager;
  private strategy: StorageStrategy;
  private ttl: number;

  constructor(config: StorageConfig) {
    this.strategy = config.strategy;
    this.ttl = config.ttl || 300; // 默认5分钟
    
    // 使用现有的缓存服务单例
    this.cacheService = cacheService;
    
    // 初始化PostgreSQL管理器（作为主要存储）
    this.pgManager = PostgreSQLManager.getInstance();
    
    // 初始化PostgreSQL数据库表结构
    this.pgManager.initializeDatabase().catch(error => {
      secureLogger.warn('⚠️ Failed to initialize PostgreSQL database:', error);
    });
  }

  /**
   * 读取键值：Redis 优先，未命中再查 PostgreSQL 持久层
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      const cached = await this.cacheService.get(key);
      if (cached !== undefined && cached !== null) return cached as T;
    } catch (error) {
      secureLogger.warn(`⚠️ Redis get failed for ${key}:`, error);
    }
    try {
      return await this.pgManager.executeOperation(async (client) => {
        const res = await client.query(
          'SELECT value FROM key_value_store WHERE key = $1 AND (expire_at IS NULL OR expire_at > NOW())',
          [key]
        );
        if (res.rows.length === 0) return null;
        const raw = res.rows[0].value;
        return (typeof raw === 'string' ? JSON.parse(raw) : raw) as T;
      });
    } catch (error) {
      secureLogger.warn(`⚠️ PostgreSQL get failed for ${key}:`, error);
      return null;
    }
  }

  /**
   * 写入键值：Redis 与 PostgreSQL 双写，任一成功即视为成功
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<boolean> {
    const ttlSeconds = ttl || this.ttl;
    let ok = false;
    try {
      ok = await this.cacheService.set(key, value, ttlSeconds);
    } catch (error) {
      secureLogger.warn(`⚠️ Redis set failed for ${key}:`, error);
    }
    try {
      await this.pgManager.executeOperation(async (client) => {
        await client.query(
          `INSERT INTO key_value_store (key, value, ttl, expire_at)
           VALUES ($1, $2::jsonb, $3, NOW() + ($3 || ' seconds')::interval)
           ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, ttl = $3,
             expire_at = NOW() + ($3 || ' seconds')::interval, updated_at = NOW()`,
          [key, JSON.stringify(value), ttlSeconds]
        );
      });
      ok = true;
    } catch (error) {
      secureLogger.warn(`⚠️ PostgreSQL set failed for ${key}:`, error);
    }
    return ok;
  }

  /**
   * 删除键值：Redis 与 PostgreSQL 同时删除
   */
  async delete(key: string): Promise<boolean> {
    let ok = false;
    try {
      ok = await this.cacheService.delete(key);
    } catch (error) {
      secureLogger.warn(`⚠️ Redis delete failed for ${key}:`, error);
    }
    try {
      await this.pgManager.executeOperation(async (client) => {
        await client.query('DELETE FROM key_value_store WHERE key = $1', [key]);
      });
      ok = true;
    } catch (error) {
      secureLogger.warn(`⚠️ PostgreSQL delete failed for ${key}:`, error);
    }
    return ok;
  }

  /**
   * 清空所有数据
   * @returns 是否成功
   */
  async clear(): Promise<boolean> {
    try {
      switch (this.strategy) {
        case StorageStrategy.REDIS:
          return await this.cacheService.clear();
          
        case StorageStrategy.HYBRID:
          // 同时清空Redis
          const redisSuccess = await this.cacheService.clear();
          
          // 只清 Redis + PostgreSQL，MongoDB 已下线
          let persistentSuccess = false;
          try {
            persistentSuccess = await this.clearFromPostgreSQL();
          } catch (pgError) {
            secureLogger.warn('⚠️ PostgreSQL clear error:', pgError);
          }
          
          return redisSuccess && persistentSuccess;
          
        default:
          return await this.cacheService.clear();
      }
    } catch (error) {
      secureLogger.error('❌ Storage clear error:', error);
      return false;
    }
  }
  
  /**
   * 清空PostgreSQL中的所有数据
   */
  private async clearFromPostgreSQL(): Promise<boolean> {
    try {
      const isConnected = await this.pgManager.ensureConnection();
      if (!isConnected) {
        return false;
      }
      
      await this.pgManager.executeOperation(async (client) => {
        const query = 'TRUNCATE TABLE key_value_store';
        await client.query(query);
      });
      
      return true;
    } catch (error) {
      secureLogger.error('❌ PostgreSQL clear error:', error);
      throw error;
    }
  }
  
  /**
   * 检查键是否存在
   * @param key 键
   * @returns 是否存在
   */
  async exists(key: string): Promise<boolean> {
    try {
      switch (this.strategy) {
        case StorageStrategy.REDIS:
          // Redis不直接支持exists，我们通过get来判断
          const redisValue = await this.cacheService.get(key);
          return redisValue !== undefined && redisValue !== null;
          
        case StorageStrategy.HYBRID:
          // 只查Redis：MongoDB 已下线，不再有第二层
          return await this.existsInRedis(key);
          
        default:
          const value = await this.cacheService.get(key);
          return value !== undefined && value !== null;
      }
    } catch (error) {
      secureLogger.error(`❌ Storage exists check error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * 检查Redis中键是否存在
   */
  private async existsInRedis(key: string): Promise<boolean> {
    try {
      const value = await this.cacheService.get(key);
      return value !== undefined && value !== null;
    } catch (error) {
      return false;
    }
  }

  /**
   * 获取存储状态
   * @returns 存储状态信息
   */
  async getStorageStatus(): Promise<{
    strategy: StorageStrategy;
    redisConnected: boolean;
    pgConnected: boolean;
    fallbackMode: 'redis' | 'postgres' | 'none';
  }> {
    // 获取Redis连接状态
    let redisConnected = false;
    try {
      // 尝试执行一个简单的Redis操作来检查连接状态
      await this.cacheService.get('__connection_test__');
      redisConnected = true;
    } catch (error) {
      redisConnected = false;
    }

    // PostgreSQL 是持久层，连接状态直接取管理器缓存
    const pgConnected = this.pgManager.getConnectionStatus().isConnected;

    // 确定降级模式
    let fallbackMode: 'redis' | 'postgres' | 'none' = 'none';
    if (!redisConnected && pgConnected) {
      fallbackMode = 'postgres';
    } else if (redisConnected) {
      fallbackMode = 'redis';
    }

    return {
      strategy: this.strategy,
      redisConnected,
      pgConnected,
      fallbackMode
    };
  }

}

// 默认存储服务实例
const defaultStorageConfig: StorageConfig = {
  strategy: StorageStrategy.HYBRID, // Redis 缓存 + PostgreSQL 持久化
  ttl: 300, // 5分钟
  redisEnabled: true
};

// 导出单例存储服务
export const storageService = new UnifiedStorageService(defaultStorageConfig);