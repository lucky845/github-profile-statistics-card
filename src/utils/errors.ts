/**
 * 自定义错误基类
 */
export class AppError extends Error {
  statusCode: number;
  isOperational: boolean;
  errorCode?: string;
  details?: any;

  constructor(
    message: string,
    statusCode: number,
    errorCode?: string,
    details?: any
  ) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true; // 标记为可操作的错误（非程序bug）
    this.errorCode = errorCode;
    this.details = details;
    
    // 捕获错误栈跟踪
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * 资源未找到错误
 */
export class NotFoundError extends AppError {
  constructor(resource: string, details?: any) {
    super(
      `未找到资源: ${resource}`,
      404,
      'RESOURCE_NOT_FOUND',
      details
    );
  }
}

/**
 * 验证错误
 */
export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(
      message,
      400,
      'VALIDATION_ERROR',
      details
    );
  }
}

/**
 * 数据库错误
 */
export class DatabaseError extends AppError {
  constructor(message: string, details?: any) {
    super(
      message,
      500,
      'DATABASE_ERROR',
      details
    );
  }
}

/**
 * 外部API错误
 */
export class ExternalApiError extends AppError {
  constructor(service: string, message: string, details?: any) {
    super(
      `外部API调用失败: ${service} - ${message}`,
      503,
      'EXTERNAL_API_ERROR',
      details
    );
  }
}

/**
 * 限流错误
 */
export class RateLimitError extends AppError {
  constructor(message: string = '请求过于频繁，请稍后再试') {
    super(
      message,
      429,
      'RATE_LIMIT_EXCEEDED'
    );
  }
}

/**
 * 安全错误
 */
export class SecurityError extends AppError {
  constructor(message: string, details?: any) {
    super(
      message,
      403,
      'SECURITY_ERROR',
      details
    );
  }
}
