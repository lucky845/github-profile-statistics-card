import { Request, Response, NextFunction } from 'express';
import prometheusService from '../services/prometheus.service';

// 扩展全局变量类型
declare global {
  var requestCount: number;
  var requestCountLastHour: number;
}

/**
 * 性能监控中间件
 * 用于收集API请求相关的指标并发送到Prometheus
 */
export function metricsMiddleware(req: Request, res: Response, next: NextFunction): void {
  // 标准化端点名称，移除参数部分以便更好地聚合
  const normalizeEndpoint = (): string => {
    // 提取路由路径模板（如果存在）
    if (req.route && req.route.path) {
      return req.route.path.toString();
    }
    
    // 否则基于路径进行标准化
    const path = req.path;
    
    // 处理不同平台的路由参数
    let normalizedPath = path;
    
    // 替换常见的参数格式
    normalizedPath = normalizedPath
      .replace(/\/[^/]+?(?=\/|$)/g, (match) => {
        // 检查是否为用户名、ID等参数
        if (/\/(?:[a-zA-Z0-9_-]+|\d+)$/.test(match)) {
          // 根据上下文判断参数类型
          if (req.path.includes('/github/') || req.path.includes('/csdn/') || 
              req.path.includes('/juejin/') || req.path.includes('/bilibili/')) {
            return '/:username';
          } else if (req.path.includes('/leetcode/')) {
            return '/:username';
          } else if (req.path.includes('/stats/')) {
            return '/:id';
          }
        }
        return match;
      });
    
    return normalizedPath || '/unknown';
  };

  const endpoint = normalizeEndpoint();
  const method = req.method;
  
  // 增加请求计数器
  global.requestCount = (global.requestCount || 0) + 1;
  
  // 增加最近一小时请求计数器
  global.requestCountLastHour = (global.requestCountLastHour || 0) + 1;
  
  // 增加活跃请求计数
  prometheusService.incrementActiveRequests(method, endpoint);
  
  // 创建计时器记录响应时间
  const timer = prometheusService.createTimer();
  
  // 保存原始的send和json方法
  const originalSend = res.send;
  const originalJson = res.json;
  
  // 重写send方法以捕获响应数据大小
  res.send = function(this: Response, body?: any): Response {
    const result = originalSend.call(this, body);
    return result;
  };
  
  // 重写json方法以捕获JSON响应
  res.json = function(this: Response, body?: any): Response {
    const result = originalJson.call(this, body);
    return result;
  };
  
  // 当响应完成时记录指标
  res.on('finish', () => {
    // 减少活跃请求计数
    prometheusService.decrementActiveRequests(method, endpoint);
    
    // 计算响应时间
    const duration = timer.end();
    
    // 获取状态码
    const statusCode = res.statusCode;
    
    // 记录请求计数
    prometheusService.recordApiRequest(method, endpoint, statusCode);
    
    // 记录响应时间
    prometheusService.recordResponseTime(method, endpoint, statusCode, duration);
    
    // 记录错误（如果状态码表示错误）
    if (statusCode >= 400) {
      const errorType = statusCode >= 500 ? 'server_error' : 'client_error';
      prometheusService.recordApiError(method, endpoint, errorType);
    }
  });
  
  // 处理未捕获的错误
  res.on('error', (error) => {
    // 减少活跃请求计数
    prometheusService.decrementActiveRequests(method, endpoint);
    
    // 记录错误
    prometheusService.recordApiError(method, endpoint, 'response_error');
  });
  
  // 继续请求处理链
  next();
}

/**
 * 缓存监控中间件
 * 用于监控缓存命中率和未命中率
 */
export function cacheMetricsMiddleware(cacheType: string) {
  return function(req: Request, res: Response, next: NextFunction): void {
    // 标准化端点
    const normalizeEndpoint = (): string => {
      if (req.route && req.route.path) {
        return req.route.path.toString();
      }
      return req.path.split('/').filter(Boolean)[0] || 'unknown';
    };
    
    const endpoint = normalizeEndpoint();
    
    // 保存原始的send方法
    const originalSend = res.send;
    
    // 重写send方法以检查缓存头
    res.send = function(this: Response, body?: any): Response {
      // 检查缓存状态头
      const cacheStatus = res.getHeader('X-Cache-Status');
      
      if (cacheStatus === 'HIT') {
        prometheusService.recordCacheHit(cacheType, endpoint);
      } else if (cacheStatus === 'MISS') {
        prometheusService.recordCacheMiss(cacheType, endpoint);
      }
      
      return originalSend.call(this, body);
    };
    
    next();
  };
}

/**
 * 外部API调用监控包装函数
 * 用于包装外部API调用并收集性能指标
 */
export async function monitorExternalApiCall<T>(
  apiName: string,
  endpoint: string,
  callFn: () => Promise<T>
): Promise<T> {
  // 创建计时器
  const timer = prometheusService.createTimer();
  
  try {
    // 执行API调用
    const result = await callFn();
    
    // 计算执行时间
    const duration = timer.end();
    
    // 记录成功的API调用
    prometheusService.recordExternalApiCall(apiName, endpoint, 'success');
    prometheusService.recordExternalApiResponseTime(apiName, endpoint, duration);
    
    return result;
  } catch (error) {
    // 计算执行时间
    const duration = timer.end();
    
    // 记录失败的API调用
    prometheusService.recordExternalApiCall(apiName, endpoint, 'error');
    prometheusService.recordExternalApiResponseTime(apiName, endpoint, duration);
    
    // 重新抛出错误
    throw error;
  }
}