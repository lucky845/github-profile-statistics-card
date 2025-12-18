import { Request, Response, NextFunction } from 'express';
import { secureLogger } from '../utils/logger';

// 日志中间件 - 使用专业日志服务
export const logger = (req: Request, res: Response, next: NextFunction) => {
  secureLogger.logRequest(req);
  next();
};