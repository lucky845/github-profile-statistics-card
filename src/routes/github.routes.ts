import express, {Router} from 'express';
import {getGitHubStats} from '../controllers/github.controller';
import {validateGitHubUsername, validateTheme, validateCacheTime} from '../middleware/validation.middleware';
import { githubCacheMiddleware } from '../middleware/cache.middleware';

const githubRouter: Router = express.Router();

// 应用缓存中间件和验证中间件
githubRouter.get('/:username', githubCacheMiddleware(), validateGitHubUsername, validateTheme, validateCacheTime, getGitHubStats);

export {githubRouter};
