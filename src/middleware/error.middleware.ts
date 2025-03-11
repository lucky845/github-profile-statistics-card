import { Request, Response, NextFunction } from 'express';
import { ErrorServiceUnavailable } from '../errors';

// 错误中间件
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {

  console.error(`错误: ${err.message}`);

  if (err instanceof ErrorServiceUnavailable) {
    res.status(503).json({
      code: 'SERVICE_UNAVAILABLE',
      message: err.message
    });
  } else {
    const statusCode = res.statusCode === 200 ? 500 : res.statusCode;
    res.status(statusCode);
    res.json({
      message: err.message,
      stack: process.env.NODE_ENV === 'production' ? null : err.stack,
    });
  }

}; 