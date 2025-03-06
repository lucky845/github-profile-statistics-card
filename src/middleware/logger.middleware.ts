import { Request, Response, NextFunction } from 'express';

// 日志中间件
export const logger = (req: Request, res: Response, next: NextFunction) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.originalUrl}`);
  next();
}; 