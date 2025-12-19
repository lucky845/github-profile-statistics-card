import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { generateCard, CardType } from '../services/svg.service';
import { ThemeOptions, defaultTheme } from '../config';
import { secureLogger } from '../utils/logger';

/**
 * 格式化错误信息为用户友好的消息，避免泄露敏感信息
 */
const formatErrorMessage = (err: any): string => {
  const isProduction = process.env.NODE_ENV === 'production';
  
  if (err instanceof AppError) {
    // 仅在非生产环境显示详细错误信息
    if (isProduction && err.isPrivate) {
      return '操作失败，请稍后再试';
    }
    return err.message;
  }
  
  // 敏感错误类型处理 - 避免在生产环境泄露细节
  switch (err.name) {
    case 'ServiceUnavailable':
    case 'MongoError':
    case 'MongooseError':
      return isProduction ? '服务器暂时不可用' : '数据库操作失败';
    case 'SyntaxError':
      return isProduction ? '请求格式错误' : '请求参数格式错误';
    case 'ValidationError':
      return isProduction ? '输入验证失败' : '请求参数验证错误';
    case 'TypeError':
    case 'RangeError':
      return isProduction ? '服务器处理错误' : err.message || '参数类型错误';
    default:
      return isProduction ? '发生未知错误' : (err.message || '发生未知错误');
  }
};

/**
 * 生成错误响应数据，确保不泄露敏感信息
 */
const generateErrorResponse = (err: any, req: Request): object => {
  const isProduction = process.env.NODE_ENV === 'production';
  const appError = err instanceof AppError;
  
  // 基础响应 - 所有环境都包含
  const baseResponse = {
    code: appError && err.errorCode ? err.errorCode : 'UNKNOWN_ERROR',
    message: formatErrorMessage(err),
    timestamp: new Date().toISOString(),
    path: req.path
  };
  
  // 仅在非生产环境添加调试信息
  if (!isProduction) {
    // 创建安全的错误详情 - 移除可能的敏感信息
    const safeStack = err.stack ? err.stack.split('\n').slice(0, 5).join('\n') : undefined;
    
    return {
      ...baseResponse,
      stack: safeStack,
      ...(appError && err.details && { 
        details: sanitizeErrorDetails(err.details) 
      })
    };
  }
  
  return baseResponse;
};

/**
 * 清理错误详情中的敏感信息
 */
const sanitizeErrorDetails = (details: any): any => {
  // 处理常见的敏感字段
  if (typeof details === 'object' && details !== null) {
    const result = { ...details };
    const sensitiveFields = ['password', 'token', 'secret', 'key', 'api_key', 'auth'];
    
    for (const field of sensitiveFields) {
      if (result[field]) {
        result[field] = '******';
      }
    }
    
    return result;
  }
  return details;
};

/**
 * 错误处理中间件 - 支持JSON和SVG两种响应格式
 */
export const errorHandler = (err: any, req: Request, res: Response, next: NextFunction) => {
  const statusCode = err instanceof AppError ? err.statusCode : (err.statusCode || 500);
  
  // 判断是否需要返回SVG格式响应（通常是统计卡片请求）
  const isSvgRequest = 
    req.path.includes('/github/') || 
    req.path.includes('/leetcode/') || 
    req.path.includes('/csdn/') || 
    req.path.includes('/bilibili/');
  
  if (isSvgRequest) {
    // 获取主题名称（从中间件或使用默认主题名）
    const themeName = typeof res.locals.themeName === 'string' ? res.locals.themeName : 'default';
    res.set('Content-Type', 'image/svg+xml');
    res.status(statusCode).send(generateCard(CardType.ERROR, formatErrorMessage(err), themeName));
    return;
  }
  
  // 对于API请求，返回JSON格式
  const response = generateErrorResponse(err, req) as { code: string; message: string; timestamp: string };
  res.status(statusCode).json(response);
  
  // 使用安全日志记录错误，避免记录敏感信息
  const sanitizedRequest = {
    method: req.method,
    path: req.path,
    // 移除请求体中的敏感信息
    body: sanitizeRequestBody(req.body),
    // 不记录headers中的认证信息
    headers: { 'content-type': req.headers['content-type'] },
    ip: req.ip
  };
  
  // 根据错误级别记录日志
  if (statusCode >= 500) {
    secureLogger.error('Server error:', {
      statusCode,
      request: sanitizedRequest,
      // 安全的错误信息 - 不包含敏感内容
      errorCode: response.code,
      errorName: err.name
    });
  } else {
    secureLogger.warn('Client error:', {
      statusCode,
      request: sanitizedRequest,
      errorCode: response.code
    });
  };
  
  // 仅在非生产环境记录完整错误堆栈
  if (process.env.NODE_ENV !== 'production') {
    secureLogger.error('Error stack trace:', { stack: err.stack });
  }

/**
 * 清理请求体中的敏感信息
 */
function sanitizeRequestBody(body: any): any {
  if (!body || typeof body !== 'object') return body;
  
  const sensitiveFields = ['password', 'token', 'secret', 'key', 'api_key', 'auth', 'Authorization'];
  const sanitized = { ...body };
  
  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '******';
    }
  }
  
  return sanitized;
}
};

/**
 * 未处理路由中间件
 */
export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
  const isSvgRequest = 
    req.path.includes('/github/') || 
    req.path.includes('/leetcode/') || 
    req.path.includes('/csdn/') || 
    req.path.includes('/bilibili/');
  
  if (isSvgRequest) {
    // 获取主题名称，确保传递的是字符串而不是ThemeOptions对象
    const themeName = typeof res.locals.themeName === 'string' ? res.locals.themeName : 'default';
    res.set('Content-Type', 'image/svg+xml');
    res.status(404).send(generateCard(CardType.ERROR, '请求的资源不存在', themeName));
    return;
  }
  
  res.status(404).json({
    code: 'ROUTE_NOT_FOUND',
    message: '请求的路由不存在',
    timestamp: new Date().toISOString(),
    path: req.path
  });
};