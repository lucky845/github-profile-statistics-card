import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { generateCard, CardType } from '../services/svg.service';
import { ThemeOptions, defaultTheme } from '../config';

/**
 * 格式化错误信息为用户友好的消息
 */
const formatErrorMessage = (err: any): string => {
  if (err instanceof AppError) {
    return err.message;
  }
  
  // 根据错误类型返回友好的错误消息
  switch (err.name) {
    case 'ServiceUnavailable':
      return '服务暂时不可用，请稍后再试';
    case 'MongoError':
    case 'MongooseError':
      return '数据库操作失败';
    case 'SyntaxError':
      return '请求参数格式错误';
    default:
      return err.message || '发生未知错误';
  }
};

/**
 * 生成错误响应数据
 */
const generateErrorResponse = (err: any, req: Request): object => {
  const isProduction = process.env.NODE_ENV === 'production';
  const appError = err instanceof AppError;
  
  return {
    code: appError && err.errorCode ? err.errorCode : 'UNKNOWN_ERROR',
    message: formatErrorMessage(err),
    timestamp: new Date().toISOString(),
    path: req.path,
    ...(!isProduction && { 
      stack: err.stack,
      ...(appError && err.details && { details: err.details })
    })
  };
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
    // 获取主题（从中间件或使用默认主题）
    const theme = (res.locals.theme || defaultTheme) as ThemeOptions;
    res.set('Content-Type', 'image/svg+xml');
    res.status(statusCode).send(generateCard(CardType.ERROR, formatErrorMessage(err), theme));
    return;
  }
  
  // 对于API请求，返回JSON格式
  const response = generateErrorResponse(err, req);
  res.status(statusCode).json(response);
  
  // 记录错误日志
  console.error('Error details:', {
    method: req.method,
    path: req.path,
    statusCode,
    error: response
  });
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
    // 获取主题（从中间件或使用默认主题）
    const theme = (res.locals.theme || defaultTheme) as ThemeOptions;
    res.set('Content-Type', 'image/svg+xml');
    res.status(404).send(generateCard(CardType.ERROR, '请求的资源不存在', theme));
    return;
  }
  
  res.status(404).json({
    code: 'ROUTE_NOT_FOUND',
    message: '请求的路由不存在',
    timestamp: new Date().toISOString(),
    path: req.path
  });
};