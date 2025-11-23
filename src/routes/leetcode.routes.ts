import express, { Router } from 'express';
import { getLeetCodeStats } from '../controllers/leetcode.controller';
import { validateLeetCodeUsername, validateTheme, validateCacheTime } from '../middleware/validation.middleware';
import { leetcodeCacheMiddleware } from '../middleware/cache.middleware';

const leetcodeRouter: Router = express.Router();

// 应用缓存中间件和验证中间件
leetcodeRouter.get('/:username', leetcodeCacheMiddleware(), validateLeetCodeUsername, validateTheme, validateCacheTime, getLeetCodeStats);

export {leetcodeRouter};
