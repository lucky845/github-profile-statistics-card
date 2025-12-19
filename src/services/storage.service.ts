/**
 * 统一存储服务
 * 提供统一的存储接口，支持多种存储策略（Redis、MongoDB等）
 */

import { BaseCacheService, CacheServiceFactory, CacheStrategy } from './cache.service';
import { MongoDBManager } from '../utils/dbManager';
import { secureLogger } from '../utils/logger';

// 存储策略枚举
export enum StorageStrategy {
  REDIS = 'redis',
  MONGODB = 'mongodb',
  HYBRID = 'hybrid' // Redis + MongoDB混合模式
}

// 存储配置接口
export interface StorageConfig {
  strategy: StorageStrategy;
  ttl?: number; // 过期时间（秒）
  mongoEnabled?: boolean; // 是否启用MongoDB
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
    mongoConnected: boolean;
    fallbackMode: 'redis' | 'mongo' | 'none';
  }>;
}

/**
 * 统一存储服务实现
 */
export class UnifiedStorageService implements StorageService {
  private cacheService: BaseCacheService;
  private mongoManager: MongoDBManager;
  private strategy: StorageStrategy;
  private ttl: number;

  constructor(config: StorageConfig) {
    this.strategy = config.strategy;
    this.ttl = config.ttl || 300; // 默认5分钟
    
    // 初始化缓存服务
    this.cacheService = CacheServiceFactory.createCacheService(
      CacheStrategy.REDIS,
      { ttl: this.ttl }
    );
    
    // 初始化MongoDB管理器
    this.mongoManager = MongoDBManager.getInstance();
  }

  /**
   * 获取数据
   * @param key 键
   * @returns 数据或null
   */
  async get<T>(key: string): Promise<T | null> {
    try {
      switch (this.strategy) {
        case StorageStrategy.REDIS:
          return await this.getFromRedis<T>(key);
          
        case StorageStrategy.MONGODB:
          return await this.getFromMongoDB<T>(key);
          
        case StorageStrategy.HYBRID:
          // 先从Redis获取，如果没有再从MongoDB获取
          const redisResult = await this.getFromRedis<T>(key);
          if (redisResult !== null) {
            return redisResult;
          }
          return await this.getFromMongoDB<T>(key);
          
        default:
          // 默认使用Redis
          return await this.getFromRedis<T>(key);
      }
    } catch (error) {
      secureLogger.error(`❌ Storage get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * 从Redis获取数据
   */
  private async getFromRedis<T>(key: string): Promise<T | null> {
    try {
      const result = await this.cacheService.get<T>(key);
      return result !== undefined ? result : null;
    } catch (error) {
      secureLogger.error(`❌ Redis get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * 从MongoDB获取数据
   */
  private async getFromMongoDB<T>(key: string): Promise<T | null> {
    try {
      const isConnected = await this.mongoManager.ensureConnection();
      if (!isConnected) {
        return null;
      }

      const result = await this.mongoManager.executeOperation(async (conn) => {
        // 动态导入模型以避免循环依赖
        const { KeyValueStore } = await import('../models/mongodb.models');
        
        // 查找记录
        const record = await KeyValueStore.findOne({ key }).lean();
        return record ? record.value : null;
      });

      return result;
    } catch (error) {
      secureLogger.error(`❌ MongoDB get error for key ${key}:`, error);
      return null;
    }
  }

  /**
   * 设置数据
   * @param key 键
   * @param value 值
   * @param ttl 过期时间（秒）
   * @returns 是否成功
   */
  async set<T>(key: string, value: T, ttl?: number): Promise<boolean> {
    try {
      const effectiveTtl = ttl || this.ttl;
      
      switch (this.strategy) {
        case StorageStrategy.REDIS:
          return await this.setInRedis<T>(key, value, effectiveTtl);
          
        case StorageStrategy.MONGODB:
          return await this.setInMongoDB<T>(key, value);
          
        case StorageStrategy.HYBRID:
          // 同时存储到Redis和MongoDB
          const redisSuccess = await this.setInRedis<T>(key, value, effectiveTtl);
          const mongoSuccess = await this.setInMongoDB<T>(key, value);
          return redisSuccess && mongoSuccess;
          
        default:
          // 默认存储到Redis
          return await this.setInRedis<T>(key, value, effectiveTtl);
      }
    } catch (error) {
      secureLogger.error(`❌ Storage set error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * 存储到Redis
   */
  private async setInRedis<T>(key: string, value: T, ttl: number): Promise<boolean> {
    try {
      return await this.cacheService.set(key, value, ttl);
    } catch (error) {
      secureLogger.error(`❌ Redis set error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * 存储到MongoDB
   */
  private async setInMongoDB<T>(key: string, value: T): Promise<boolean> {
    try {
      const isConnected = await this.mongoManager.ensureConnection();
      if (!isConnected) {
        return false;
      }

      await this.mongoManager.executeOperation(async (conn) => {
        // 动态导入模型以避免循环依赖
        const { KeyValueStore } = await import('../models/mongodb.models');
        
        // Upsert操作：如果存在则更新，否则插入新记录
        await KeyValueStore.findOneAndUpdate(
          { key },
          { 
            key,
            value,
            ttl: this.ttl
          },
          { upsert: true, new: true }
        );
      });

      return true;
    } catch (error) {
      secureLogger.error(`❌ MongoDB set error for key ${key}:`, error);
      return false;
    }
  }

  /**
   * 删除数据
   * @param key 键
   * @returns 是否成功
   */
  async delete(key: string): Promise<boolean> {
    try {
      switch (this.strategy) {
        case StorageStrategy.REDIS:
          return await this.cacheService.delete(key);
          
        case StorageStrategy.MONGODB:
          // MongoDB删除逻辑
          return await this.mongoManager.executeOperation(async (conn) => {
            // 动态导入模型以避免循环依赖
            const { KeyValueStore } = await import('../models/mongodb.models');
            
            // 删除记录
            const result = await KeyValueStore.deleteOne({ key });
            return result.deletedCount > 0;
          });
          
        case StorageStrategy.HYBRID:
          // 同时从Redis和MongoDB删除
          const redisSuccess = await this.cacheService.delete(key);
          // MongoDB删除逻辑
          const mongoSuccess = await this.mongoManager.executeOperation(async (conn) => {
            // 动态导入模型以避免循环依赖
            const { KeyValueStore } = await import('../models/mongodb.models');
            
            // 删除记录
            const result = await KeyValueStore.deleteOne({ key });
            return result.deletedCount > 0;
          });
          return redisSuccess || mongoSuccess;
          
        default:
          return await this.cacheService.delete(key);
      }
    } catch (error) {
      secureLogger.error(`❌ Storage delete error for key ${key}:`, error);
      return false;
    }
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
          
        case StorageStrategy.MONGODB:
          // MongoDB清空逻辑
          return await this.mongoManager.executeOperation(async (conn) => {
            // 动态导入模型以避免循环依赖
            const { KeyValueStore } = await import('../models/mongodb.models');
            
            // 清空所有记录
            const result = await KeyValueStore.deleteMany({});
            return result.deletedCount >= 0; // 返回true表示操作成功执行
          });
          
        case StorageStrategy.HYBRID:
          // 同时清空Redis和MongoDB
          const redisSuccess = await this.cacheService.clear();
          // MongoDB清空逻辑
          const mongoSuccess = await this.mongoManager.executeOperation(async (conn) => {
            // 动态导入模型以避免循环依赖
            const { KeyValueStore } = await import('../models/mongodb.models');
            
            // 清空所有记录
            const result = await KeyValueStore.deleteMany({});
            return result.deletedCount >= 0; // 返回true表示操作成功执行
          });
          return redisSuccess && mongoSuccess;
          
        default:
          return await this.cacheService.clear();
      }
    } catch (error) {
      secureLogger.error('❌ Storage clear error:', error);
      return false;
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
          
        case StorageStrategy.MONGODB:
          // MongoDB检查逻辑需要根据具体模型实现
          return await this.mongoManager.executeOperation(async (conn) => {
            // 示例代码
            return false;
          });
          
        case StorageStrategy.HYBRID:
          // 先检查Redis，再检查MongoDB
          const redisExists = await this.existsInRedis(key);
          if (redisExists) return true;
          return await this.existsInMongoDB(key);
          
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
   * 检查MongoDB中键是否存在
   */
  private async existsInMongoDB(key: string): Promise<boolean> {
    try {
      const isConnected = await this.mongoManager.ensureConnection();
      if (!isConnected) {
        return false;
      }

      return await this.mongoManager.executeOperation(async (conn) => {
        // 动态导入模型以避免循环依赖
        const { KeyValueStore } = await import('../models/mongodb.models');
        
        // 检查记录是否存在
        const count = await KeyValueStore.countDocuments({ key });
        return count > 0;
      });
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
    mongoConnected: boolean;
    fallbackMode: 'redis' | 'mongo' | 'none';
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

    // 获取MongoDB连接状态
    const mongoStatus = this.mongoManager.getConnectionStatus();
    const mongoConnected = mongoStatus.isConnected;

    // 确定降级模式
    let fallbackMode: 'redis' | 'mongo' | 'none' = 'none';
    if (!redisConnected && mongoConnected) {
      fallbackMode = 'mongo';
    } else if (redisConnected && !mongoConnected) {
      fallbackMode = 'redis';
    }

    return {
      strategy: this.strategy,
      redisConnected,
      mongoConnected,
      fallbackMode
    };
  }
}

// 默认存储服务实例
const defaultStorageConfig: StorageConfig = {
  strategy: StorageStrategy.HYBRID, // 默认使用混合模式
  ttl: 300, // 5分钟
  mongoEnabled: true,
  redisEnabled: true
};

// 导出单例存储服务
export const storageService = new UnifiedStorageService(defaultStorageConfig);