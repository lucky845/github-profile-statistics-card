import { createLogger, format, transports } from 'winston';
import { appConfig } from '../config/app.config';

// 定义日志级别
export type LogLevel = 'error' | 'warn' | 'info' | 'http' | 'verbose' | 'debug' | 'silly';

// 配置日志格式化器
const logFormat = format.combine(
  format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss'
  }),
  format.printf(({ timestamp, level, message, ...metadata }) => {
    let logMessage = `[${timestamp}] [${level.toUpperCase()}]: ${message}`;
    
    // 添加元数据（如果存在），同时过滤敏感信息
    if (Object.keys(metadata).length > 0) {
      const sanitizedMetadata = sanitizeSensitiveData(metadata);
      logMessage += ` ${JSON.stringify(sanitizedMetadata)}`;
    }
    
    return logMessage;
  })
);

// 清理敏感信息
function sanitizeSensitiveData(data: any): any {
  if (!data || typeof data !== 'object') {
    return data;
  }
  
  // 深拷贝数据，避免修改原始数据
  const result = Array.isArray(data) ? [...data] : { ...data };
  
  // 定义需要过滤的敏感字段
  const sensitiveFields = [
    'password', 'pass', 'secret', 'key', 'api_key', 'auth', 
    'authorization', 'token', 'credential', 'hash', 'certificate'
  ];
  
  // 递归清理对象
  for (const key in result) {
    if (result.hasOwnProperty(key)) {
      // 检查是否包含敏感字段名
      const hasSensitiveField = sensitiveFields.some(field => 
        key.toLowerCase().includes(field)
      );
      
      if (hasSensitiveField && result[key]) {
        result[key] = '******';
      } 
      // 递归处理嵌套对象
      else if (typeof result[key] === 'object' && result[key] !== null) {
        result[key] = sanitizeSensitiveData(result[key]);
      }
    }
  }
  
  return result;
}

// 创建控制台传输
const consoleTransport = new transports.Console({
  format: format.combine(
    format.colorize(),
    logFormat
  ),
  level: process.env.LOG_LEVEL || 'info'
});

// 创建日志记录器实例
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: logFormat,
  transports: [consoleTransport]
});

// 如果是生产环境，可以添加文件传输
if (process.env.NODE_ENV === 'production') {
  const errorTransport = new transports.File({
    filename: 'logs/error.log',
    level: 'error',
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    tailable: true
  });
  
  const combinedTransport = new transports.File({
    filename: 'logs/combined.log',
    maxsize: 5242880, // 5MB
    maxFiles: 5,
    tailable: true
  });
  
  logger.add(errorTransport);
  logger.add(combinedTransport);
}

// 导出增强版的日志记录器，添加请求记录功能
export const secureLogger = {
  // 基础日志方法
  error: (message: string, meta?: any) => logger.error(message, meta),
  warn: (message: string, meta?: any) => logger.warn(message, meta),
  info: (message: string, meta?: any) => logger.info(message, meta),
  http: (message: string, meta?: any) => logger.http(message, meta),
  verbose: (message: string, meta?: any) => logger.verbose(message, meta),
  debug: (message: string, meta?: any) => logger.debug(message, meta),
  silly: (message: string, meta?: any) => logger.silly(message, meta),
  
  // 记录请求信息的方法
  logRequest: (req: any, additionalInfo?: any) => {
    const requestInfo = {
      method: req.method,
      url: req.originalUrl,
      headers: {
        'user-agent': req.headers['user-agent'],
        'accept': req.headers['accept']
        // 注意：不记录认证相关头
      },
      ip: req.ip,
      ...additionalInfo
    };
    logger.http('Request received', requestInfo);
  },
  
  // 记录响应信息的方法
  logResponse: (req: any, res: any, responseTime: number) => {
    const responseInfo = {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      responseTime: `${responseTime}ms`,
      contentLength: res.get('content-length') || 'unknown'
    };
    
    // 根据状态码选择日志级别
    if (res.statusCode >= 500) {
      logger.error('Error response', responseInfo);
    } else if (res.statusCode >= 400) {
      logger.warn('Client error response', responseInfo);
    } else {
      logger.info('Success response', responseInfo);
    }
  },
  
  // 记录API调用信息
  logApiCall: (service: string, endpoint: string, status: 'success' | 'error', meta?: any) => {
    const apiInfo = {
      service,
      endpoint,
      status,
      timestamp: new Date().toISOString(),
      ...meta
    };
    
    if (status === 'error') {
      logger.error(`API call failed: ${service}.${endpoint}`, apiInfo);
    } else {
      logger.info(`API call success: ${service}.${endpoint}`, apiInfo);
    }
  }
};

// 导出用于创建请求日志中间件的函数
export const createRequestLoggerMiddleware = () => {
  return (req: any, res: any, next: any) => {
    const startTime = Date.now();
    
    // 记录请求开始
    secureLogger.logRequest(req);
    
    // 监听响应结束
    res.on('finish', () => {
      const responseTime = Date.now() - startTime;
      secureLogger.logResponse(req, res, responseTime);
    });
    
    next();
  };
};

// 确保日志目录存在（如果使用文件传输）
if (process.env.NODE_ENV === 'production') {
  const fs = require('fs');
  const path = require('path');
  
  const logDir = path.join(process.cwd(), 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}