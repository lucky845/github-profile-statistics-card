import express, { Router } from 'express';
import { getCSDNStats } from '../controllers/csdn.controller';
import { validateGenericUsername, validateTheme, validateCacheTime } from '../middleware/validation.middleware';
import { csdnCacheMiddleware } from '../middleware/cache.middleware';

const csdnRouter: Router = express.Router();

// 应用缓存中间件和验证中间件
csdnRouter.get('/:userId', csdnCacheMiddleware(), validateGenericUsername, validateTheme, validateCacheTime, getCSDNStats);

export {csdnRouter};
