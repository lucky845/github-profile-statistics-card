import { Request, Response, NextFunction } from 'express';
import { themes, defaultTheme } from '../config';
import { secureLogger } from '../utils/logger';

/**
 * 主题中间件
 * 从查询参数获取主题并设置到响应本地变量中
 */
export const themeMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // 从查询参数获取主题
    const themeName = req.query.theme as string;
    
    // 设置主题到响应本地变量
    if (themeName && themes[themeName as keyof typeof themes]) {
      res.locals.theme = themes[themeName as keyof typeof themes];
    } else {
      // 使用默认主题
      res.locals.theme = defaultTheme;
    }
    
    next();
  } catch (error) {
    secureLogger.error('主题中间件错误:', error);
    // 出错时使用默认主题
    res.locals.theme = defaultTheme;
    next();
  }
};

/**
 * 获取请求的主题配置
 * @param req Express请求对象
 * @returns 主题配置
 */
export const getRequestTheme = (req: Request): any => {
  // 先从响应本地变量获取主题
  if (req['res'] && req['res'].locals && req['res'].locals.theme) {
    return req['res'].locals.theme;
  }
  
  // 如果没有，则根据查询参数获取
  const themeName = req.query.theme as string;
  return themeName && themes[themeName as keyof typeof themes] ? 
    themes[themeName as keyof typeof themes] : 
    defaultTheme;
};