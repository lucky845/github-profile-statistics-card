/**
 * 统一存储服务
 * 提供统一的存储接口，支持多种存储策略（Redis、MongoDB等）
 */

import { BaseCacheService, CacheServiceFactory, CacheStrategy, cacheService } from './cache.service';
import { MongoDBManager } from '../utils/dbManager';
import { PostgreSQLManager } from '../utils/pgManager';
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
  
  // GitHub用户访问数据相关方法
  getGitHubUserVisit(username: string): Promise<{
    username: string;
    visit_count: number;
    last_visited: Date;
    avatar_url?: string;
    avatar_updated_at?: Date;
  } | null>;
  
  updateGitHubUserVisit(
    username: string, 
    data: {
      visit_count?: number;
      avatar_url?: string;
      avatar_updated_at?: Date;
    }
  ): Promise<{
    username: string;
    visit_count: number;
    last_visited: Date;
    avatar_url?: string;
    avatar_updated_at?: Date;
  } | null>;
}

/**
 * 统一存储服务实现
 */
export class UnifiedStorageService implements StorageService {
  private cacheService: BaseCacheService;
  private mongoManager: MongoDBManager;
  private pgManager: PostgreSQLManager;
  private strategy: StorageStrategy;
  private ttl: number;

  constructor(config: StorageConfig) {
    this.strategy = config.strategy;
    this.ttl = config.ttl || 300; // 默认5分钟
    
    // 使用现有的缓存服务单例
    this.cacheService = cacheService;
    
    // 初始化MongoDB管理器（作为备份）
    this.mongoManager = MongoDBManager.getInstance();
    
    // 初始化PostgreSQL管理器（作为主要存储）
    this.pgManager = PostgreSQLManager.getInstance();
    
    // 初始化PostgreSQL数据库表结构
    this.pgManager.initializeDatabase().catch(error => {
      secureLogger.warn('⚠️ Failed to initialize PostgreSQL database:', error);
    });
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
          // 先从Redis获取，如果没有再从PostgreSQL获取，如果PostgreSQL失败则回退到MongoDB
          const redisResult = await this.getFromRedis<T>(key);
          if (redisResult !== null) {
            return redisResult;
          }
          
          try {
            const pgResult = await this.getFromPostgreSQL<T>(key);
            if (pgResult !== null) {
              return pgResult;
            }
          } catch (pgError) {
            secureLogger.warn(`⚠️ PostgreSQL get error for key ${key}, falling back to MongoDB:`, pgError);
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
   * 从PostgreSQL获取数据
   */
  private async getFromPostgreSQL<T>(key: string): Promise<T | null> {
    try {
      const isConnected = await this.pgManager.ensureConnection();
      if (!isConnected) {
        return null;
      }

      const result = await this.pgManager.executeOperation(async (client) => {
        // 从PostgreSQL中获取记录
        const query = 'SELECT value FROM key_value_store WHERE key = $1 AND (expire_at IS NULL OR expire_at > CURRENT_TIMESTAMP)';
        const res = await client.query(query, [key]);
        return res.rows.length > 0 ? res.rows[0].value : null;
      });

      return result;
    } catch (error) {
      secureLogger.error(`❌ PostgreSQL get error for key ${key}:`, error);
      throw error; // 抛出错误，让调用者可以回退到MongoDB
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
          // 同时存储到Redis（缓存）
          const redisSuccess = await this.setInRedis<T>(key, value, effectiveTtl);
          
          // 优先存储到PostgreSQL（主要存储），如果失败则回退到MongoDB（备份存储）
          let persistentSuccess = false;
          try {
            persistentSuccess = await this.setInPostgreSQL<T>(key, value, effectiveTtl);
          } catch (pgError) {
            secureLogger.warn(`⚠️ PostgreSQL set error for key ${key}, falling back to MongoDB:`, pgError);
            persistentSuccess = await this.setInMongoDB<T>(key, value);
          }
          
          return redisSuccess || persistentSuccess;
          
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
   * 存储到PostgreSQL
   */
  private async setInPostgreSQL<T>(key: string, value: T, ttl: number): Promise<boolean> {
    try {
      const isConnected = await this.pgManager.ensureConnection();
      if (!isConnected) {
        return false;
      }

      await this.pgManager.executeOperation(async (client) => {
        // 计算过期时间
        const expireAt = ttl ? new Date(Date.now() + ttl * 1000) : null;
        
        // Upsert操作：如果存在则更新，否则插入新记录
        const query = `
          INSERT INTO key_value_store (key, value, ttl, expire_at, updated_at)
          VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
          ON CONFLICT (key)
          DO UPDATE SET
            value = $2,
            ttl = $3,
            expire_at = $4,
            updated_at = CURRENT_TIMESTAMP
        `;
        
        await client.query(query, [key, value, ttl, expireAt]);
      });

      return true;
    } catch (error) {
      secureLogger.error(`❌ PostgreSQL set error for key ${key}:`, error);
      throw error; // 抛出错误，让调用者可以回退到MongoDB
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
          // 同时从Redis删除
          const redisSuccess = await this.cacheService.delete(key);
          
          // 优先从PostgreSQL删除，失败则回退到MongoDB
          let persistentSuccess = false;
          try {
            persistentSuccess = await this.deleteFromPostgreSQL(key);
          } catch (pgError) {
            secureLogger.warn(`⚠️ PostgreSQL delete error for key ${key}, falling back to MongoDB:`, pgError);
            persistentSuccess = await this.deleteFromMongoDB(key);
          }
          
          return redisSuccess || persistentSuccess;
          
        default:
          return await this.cacheService.delete(key);
      }
    } catch (error) {
      secureLogger.error(`❌ Storage delete error for key ${key}:`, error);
      return false;
    }
  }
  
  /**
   * 从PostgreSQL删除数据
   */
  private async deleteFromPostgreSQL(key: string): Promise<boolean> {
    try {
      const isConnected = await this.pgManager.ensureConnection();
      if (!isConnected) {
        return false;
      }
      
      await this.pgManager.executeOperation(async (client) => {
        const query = 'DELETE FROM key_value_store WHERE key = $1';
        await client.query(query, [key]);
      });
      
      return true;
    } catch (error) {
      secureLogger.error(`❌ PostgreSQL delete error for key ${key}:`, error);
      throw error;
    }
  }
  
  /**
   * 从MongoDB删除数据
   */
  private async deleteFromMongoDB(key: string): Promise<boolean> {
    try {
      const isConnected = await this.mongoManager.ensureConnection();
      if (!isConnected) {
        return false;
      }
      
      return await this.mongoManager.executeOperation(async (conn) => {
        // 动态导入模型以避免循环依赖
        const { KeyValueStore } = await import('../models/mongodb.models');
        
        // 删除记录
        const result = await KeyValueStore.deleteOne({ key });
        return result.deletedCount > 0;
      });
    } catch (error) {
      secureLogger.error(`❌ MongoDB delete error for key ${key}:`, error);
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
          // 同时清空Redis
          const redisSuccess = await this.cacheService.clear();
          
          // 优先清空PostgreSQL，失败则回退到MongoDB
          let persistentSuccess = false;
          try {
            persistentSuccess = await this.clearFromPostgreSQL();
          } catch (pgError) {
            secureLogger.warn('⚠️ PostgreSQL clear error, falling back to MongoDB:', pgError);
            persistentSuccess = await this.clearFromMongoDB();
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
   * 清空MongoDB中的所有数据
   */
  private async clearFromMongoDB(): Promise<boolean> {
    try {
      const isConnected = await this.mongoManager.ensureConnection();
      if (!isConnected) {
        return false;
      }
      
      return await this.mongoManager.executeOperation(async (conn) => {
        // 动态导入模型以避免循环依赖
        const { KeyValueStore } = await import('../models/mongodb.models');
        
        // 清空所有记录
        const result = await KeyValueStore.deleteMany({});
        return result.deletedCount >= 0; // 返回true表示操作成功执行
      });
    } catch (error) {
      secureLogger.error('❌ MongoDB clear error:', error);
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

  /**
   * 获取GitHub用户访问数据
   * 优先从PostgreSQL获取，如果失败则回退到MongoDB
   * @param username GitHub用户名
   * @returns 用户访问数据或null
   */
  async getGitHubUserVisit(username: string): Promise<{
    username: string;
    visit_count: number;
    last_visited: Date;
    avatar_url?: string;
    avatar_updated_at?: Date;
  } | null> {
    try {
      // 优先从PostgreSQL获取
      const pgResult = await this.pgManager.getGitHubUserVisit(username);
      if (pgResult) {
        return pgResult;
      }

      // PostgreSQL失败时回退到MongoDB
      secureLogger.warn(`PostgreSQL getGitHubUserVisit failed for ${username}, falling back to MongoDB`);
      
      const isMongoConnected = await this.mongoManager.ensureConnection();
      if (!isMongoConnected) {
        return null;
      }

      // 从MongoDB获取GitHub用户数据
      const mongoResult = await this.mongoManager.executeOperation(async (conn) => {
        const { GitHubUser } = await import('../models/mongodb.models');
        const user = await GitHubUser.findOne({ username }).lean();
        if (user) {
          return {
            username: user.username,
            visit_count: user.visitCount || 0,
            last_visited: user.lastVisited || new Date(),
            avatar_url: user.avatarUrl,
            avatar_updated_at: user.avatarUpdatedAt
          };
        }
        return null;
      });

      return mongoResult;
    } catch (error) {
      secureLogger.error(`getGitHubUserVisit failed for ${username}:`, error);
      return null;
    }
  }

  /**
   * 更新GitHub用户访问数据
   * 优先更新PostgreSQL，如果失败则回退到MongoDB
   * @param username GitHub用户名
   * @param data 要更新的数据
   * @returns 更新后的用户访问数据或null
   */
  async updateGitHubUserVisit(
    username: string, 
    data: {
      visit_count?: number;
      avatar_url?: string;
      avatar_updated_at?: Date;
    }
  ): Promise<{
    username: string;
    visit_count: number;
    last_visited: Date;
    avatar_url?: string;
    avatar_updated_at?: Date;
  } | null> {
    try {
      // 优先更新PostgreSQL
      const pgResult = await this.pgManager.updateGitHubUserVisit(username, data);
      if (pgResult) {
        return pgResult;
      }

      // PostgreSQL失败时回退到MongoDB
      secureLogger.warn(`PostgreSQL updateGitHubUserVisit failed for ${username}, falling back to MongoDB`);
      
      const isMongoConnected = await this.mongoManager.ensureConnection();
      if (!isMongoConnected) {
        return null;
      }

      // 更新MongoDB中的GitHub用户数据
      const mongoResult = await this.mongoManager.executeOperation(async (conn) => {
        const { GitHubUser } = await import('../models/mongodb.models');
        
        // 计算要更新的数据
        const updateData: any = {
          lastVisited: new Date(),
          lastUpdated: new Date()
        };
        
        if (data.visit_count !== undefined) {
          updateData.visitCount = data.visit_count;
        } else {
          updateData.$inc = { visitCount: 1 };
        }
        
        if (data.avatar_url !== undefined) {
          updateData.avatarUrl = data.avatar_url;
        }
        
        if (data.avatar_updated_at !== undefined) {
          updateData.avatarUpdatedAt = data.avatar_updated_at;
        }

        // 执行更新
        const user = await GitHubUser.findOneAndUpdate(
          { username },
          updateData,
          { upsert: true, new: true }
        );

        if (user) {
          return {
            username: user.username,
            visit_count: user.visitCount || 0,
            last_visited: user.lastVisited || new Date(),
            avatar_url: user.avatarUrl,
            avatar_updated_at: user.avatarUpdatedAt
          };
        }
        return null;
      });

      return mongoResult;
    } catch (error) {
      secureLogger.error(`updateGitHubUserVisit failed for ${username}:`, error);
      return null;
    }
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