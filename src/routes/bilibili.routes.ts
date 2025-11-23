import express, { Router } from 'express';
import { fetchBilibiliUserData } from '../controllers/bilibili.controller';
import { validateGenericUsername, validateTheme, validateCacheTime } from '../middleware/validation.middleware';

// 自定义B站缓存中间件，适配uid参数
const bilibiliCacheMiddleware = () => {
  return (req: any, res: any, next: any) => {
    try {
      // 缓存实现简化版
      const uid = req.params.uid;
      const theme = req.query.theme || 'default';
      const cacheKey = `bilibili_${uid}_${theme}`;
      
      // 设置缓存头
      res.setHeader('X-Cache-Key', cacheKey);
      res.setHeader('X-Cache-Status', 'MISS'); // 简化处理，实际应该检查缓存
      
      next();
    } catch (error) {
      console.error('Bilibili cache middleware error:', error);
      next();
    }
  };
};

const bilibiliRouter: Router = express.Router();

// Bilibili 统计路由 - 应用缓存中间件和验证中间件
bilibiliRouter.get('/:uid', bilibiliCacheMiddleware(), validateGenericUsername, validateTheme, validateCacheTime, fetchBilibiliUserData);

export {bilibiliRouter};
