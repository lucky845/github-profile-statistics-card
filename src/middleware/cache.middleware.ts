/**
 * 缓存中间件
 * 提供HTTP响应缓存功能
 */

import { Request, Response, NextFunction } from 'express';
import { cacheService, CacheKeyGenerator } from '../services/cache.service';
import { secureLogger } from '../utils/logger';

/**
 * 缓存中间件配置选项
 */
export interface CacheMiddlewareOptions {
  ttl?: number; // 缓存过期时间（秒）
  keyGenerator?: (req: Request) => string; // 自定义键生成器
  skipCache?: (req: Request) => boolean; // 跳过缓存的条件
}

/**
 * 创建缓存中间件
 * @param options 缓存配置选项
 * @returns 中间件函数
 */
export function createCacheMiddleware(options: CacheMiddlewareOptions = {}) {
  const ttl = options.ttl || 300;
  const keyGenerator = options.keyGenerator || defaultKeyGenerator;
  const skipCache = options.skipCache || (() => false);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 如果需要跳过缓存，直接继续
      if (skipCache(req)) {
        return next();
      }

      // 生成缓存键
      const cacheKey = keyGenerator(req);

      // 尝试从缓存获取响应
      const cachedResponse = await cacheService.get<{body: any; headers: any}>(cacheKey);
      
      if (cachedResponse) {
        // 设置缓存命中的头部信息
        res.setHeader('X-Cache-Status', 'HIT');
        res.setHeader('X-Cache-Key', cacheKey);
        
        // 设置缓存中的响应头
        Object.entries(cachedResponse.headers).forEach(([key, value]: any[]) => {
          if (!res.hasHeader(key)) {
            res.setHeader(key, value);
          }
        });
        
        // 返回缓存的响应体
        res.status(200).send(cachedResponse.body);
        return;
      }

      // 缓存未命中，记录缓存键
      res.setHeader('X-Cache-Status', 'MISS');
      res.setHeader('X-Cache-Key', cacheKey);

      // 保存原始的send方法
      const originalSend = res.send;

      // 重写send方法，在发送响应时缓存
      res.send = function(body) {
        // 只缓存成功的响应
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // 获取需要缓存的响应头
          const headersToCache = getCacheableHeaders(res.getHeaders());
          
          // 异步缓存响应
          // 避免缓存过大的响应体
          const bodySize = typeof body === 'string' ? body.length : JSON.stringify(body).length;
          if (bodySize < 1024 * 512) { // 小于 512KB 的响应才缓存
            cacheService.set(
              cacheKey, 
              { 
                body: body, 
                headers: headersToCache 
              }, 
              ttl
            ).catch(err => {
              secureLogger.error('Failed to cache response:', { error: err.message, cacheKey });
            });
          } else {
            secureLogger.debug('Skipping cache for large response:', { 
              cacheKey, 
              bodySize: `${(bodySize / 1024).toFixed(2)}KB` 
            });
          }
        }

        // 调用原始的send方法
        return originalSend.call(this, body);
      };

      // 继续处理请求
      next();
    } catch (error) {
      console.error('Cache middleware error:', error);
      // 即使缓存出错，也继续处理请求
      next();
    }
  };
}

/**
 * 默认的缓存键生成器
 * @param req Express请求对象
 * @returns 缓存键
 */
function defaultKeyGenerator(req: Request): string {
  // 使用请求方法、路径和查询参数生成缓存键
  const { method, path, query } = req;
  const queryString = Object.keys(query)
    .sort()
    .map(key => `${key}=${query[key]}`)
    .join('&');
  
  // 安全处理路径，移除可能导致问题的字符
  const safePath = path.replace(/[^a-zA-Z0-9_.-/]/g, '_');
  
  return CacheKeyGenerator.generateKey('http', method, safePath, queryString);
}

/**
 * 获取可缓存的响应头
 * 只缓存安全的响应头，避免缓存敏感信息
 */
function getCacheableHeaders(headers: Record<string, any>): Record<string, any> {
  const cacheableHeaderNames = [
    'content-type',
    'content-length',
    'x-powered-by',
    'access-control-allow-origin'
  ];
  
  const cacheableHeaders: Record<string, any> = {};
  
  Object.entries(headers).forEach(([key, value]) => {
    if (cacheableHeaderNames.includes(key.toLowerCase())) {
      cacheableHeaders[key] = value;
    }
  });
  
  return cacheableHeaders;
}

/**
 * 清理特定缓存的中间件
 * 用于在数据更新后清理相关缓存
 */
export function clearCacheMiddleware(pattern: string | RegExp) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 先处理请求
      next();
      
      // 请求处理完成后清理缓存（异步，不阻塞响应）
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const deletedCount = await cacheService.deleteByPattern(pattern);
          secureLogger.info('Cache invalidation completed', { 
            pattern: String(pattern), 
            deletedCount 
          });
          
          // 将删除的缓存数量添加到响应头
          res.setHeader('X-Cache-Clear-Count', String(deletedCount));
        } catch (err) {
          secureLogger.error('Failed to clear cache pattern:', {
                error: err instanceof Error ? err.message : String(err),
                pattern: String(pattern)
            });
        }
      }
    } catch (error) {
      secureLogger.error('Clear cache middleware error:', { error: error instanceof Error ? error.message : String(error) });
      next();
    }
  };
}

/**
 * 清除指定组的缓存中间件
 */
export function clearCacheGroupMiddleware(group: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // 先处理请求
      next();
      
      // 请求处理完成后清理缓存组（异步，不阻塞响应）
      if (res.statusCode >= 200 && res.statusCode < 300) {
        try {
          const deletedCount = await cacheService.clearGroup(group);
          secureLogger.info('Cache group cleared', { group, deletedCount });
          res.setHeader('X-Cache-Group-Clear-Count', String(deletedCount));
        } catch (err) {
          secureLogger.error('Failed to clear cache group:', {
                error: err instanceof Error ? err.message : String(err),
                group
            });
        }
      }
    } catch (error) {
      secureLogger.error('Clear cache group middleware error:', { error: error instanceof Error ? error.message : String(error) });
      next();
    }
  };
}

/**
 * 缓存统计端点处理器
 */
export function cacheStatsHandler(req: Request, res: Response): void {
  try {
    const stats = cacheService.getStats();
    res.json({
      status: 'success',
      data: stats,
      message: 'Cache statistics retrieved successfully'
    });
  } catch (error) {
    secureLogger.error('Failed to retrieve cache stats:', { error: error instanceof Error ? error.message : String(error) });
    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve cache statistics'
    });
  }
}

/**
 * 手动清除缓存端点处理器
 */
export function manualCacheClearHandler(req: Request, res: Response): void {
  const { pattern, group, all } = req.query;
  
  // 确保只允许管理员操作（实际项目中应该有更严格的权限控制）
  // 这里简化处理，实际项目中应该检查认证令牌或IP地址
  
  (async () => {
    try {
      let deletedCount = 0;
      let action = '';
      
      if (all === 'true') {
        await cacheService.clear();
        action = 'Cleared all cache';
      } else if (group) {
        deletedCount = await cacheService.clearGroup(String(group));
        action = `Cleared cache group: ${group}`;
      } else if (pattern) {
        deletedCount = await cacheService.deleteByPattern(String(pattern));
        action = `Cleared cache by pattern: ${pattern}`;
      } else {
        return res.status(400).json({
          status: 'error',
          message: 'Must provide one of: pattern, group, or all=true'
        });
      }
      
      secureLogger.info(action, { deletedCount });
      
      res.json({
        status: 'success',
        message: action,
        deletedCount: all === 'true' ? 'all' : deletedCount
      });
    } catch (error) {
      secureLogger.error('Failed to clear cache manually:', { error: error instanceof Error ? error.message : String(error) });
      res.status(500).json({
        status: 'error',
        message: 'Failed to clear cache'
      });
    }
  })();
}

/**
 * GitHub API缓存中间件
 */
export function githubCacheMiddleware() {
  return createCacheMiddleware({
    ttl: 600, // 10分钟缓存
    keyGenerator: (req: Request) => {
      const username = req.params.username;
      const theme = req.query.theme as string || 'default';
      return CacheKeyGenerator.generateGitHubKey(username, theme);
    },
    skipCache: (req: Request) => {
      // 如果有nocache参数，则跳过缓存
      return req.query.nocache === 'true';
    }
  });
}

/**
 * LeetCode API缓存中间件
 */
export function leetcodeCacheMiddleware() {
  return createCacheMiddleware({
    ttl: 900, // 15分钟缓存
    keyGenerator: (req: Request) => {
      const username = req.params.username;
      const theme = req.query.theme as string || 'default';
      return CacheKeyGenerator.generateLeetCodeKey(username, theme);
    },
    skipCache: (req: Request) => {
      return req.query.nocache === 'true';
    }
  });
}

/**
 * CSDN API缓存中间件
 */
export function csdnCacheMiddleware() {
  return createCacheMiddleware({
    ttl: 1800, // 30分钟缓存
    keyGenerator: (req: Request): string => {
      const userId = req.params.userId || 'unknown';
      const theme = req.query.theme as string || 'default';
      return CacheKeyGenerator.generateCSDNKey(userId, theme);
    },
    skipCache: (req: Request) => {
      return req.query.nocache === 'true';
    }
  });
}

/**
 * 掘金 API缓存中间件
 */
export function juejinCacheMiddleware() {
  return createCacheMiddleware({
    ttl: 1800, // 30分钟缓存
    keyGenerator: (req: Request): string => {
      const userId = req.params.userId || 'unknown';
      const theme = req.query.theme as string || 'default';
      return CacheKeyGenerator.generateJuejinKey(userId, theme);
    },
    skipCache: (req: Request) => {
      return req.query.nocache === 'true';
    }
  });
}

/**
 * B站 API缓存中间件
 */
export function bilibiliCacheMiddleware() {
  return createCacheMiddleware({
    ttl: 1800, // 30分钟缓存
    keyGenerator: (req: Request): string => {
      const uid = req.params.uid || 'unknown';
      const theme = req.query.theme as string || 'default';
      return CacheKeyGenerator.generateBilibiliKey(uid, theme);
    },
    skipCache: (req: Request) => {
      return req.query.nocache === 'true';
    }
  });
}