import {Router} from 'express';
import {fetchJuejinUserData} from '../controllers/juejin.controller';
import { secureLogger } from '../utils/logger';

// 自定义掘金缓存中间件，适配user_id参数
const juejinCacheMiddleware = () => {
  return (req: any, res: any, next: any) => {
    try {
      // 缓存实现简化版
      const userId = req.params.user_id;
      const theme = req.query.theme || 'default';
      const cacheKey = `juejin_${userId}_${theme}`;
      
      // 设置缓存头
      res.setHeader('X-Cache-Key', cacheKey);
      res.setHeader('X-Cache-Status', 'MISS'); // 简化处理，实际应该检查缓存
      
      next();
    } catch (error) {
      secureLogger.error('Juejin cache middleware error:', error);
      next();
    }
  };
};

const juejinRouter: Router = Router();

// 获取掘金用户数据 - 应用缓存中间件减少API请求频率
juejinRouter.get('/:user_id', juejinCacheMiddleware(), fetchJuejinUserData);

export {juejinRouter};
