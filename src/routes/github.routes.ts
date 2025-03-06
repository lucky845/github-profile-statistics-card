import express, { Router } from 'express';
import { getGitHubStats } from '../controllers/github.controller';

const router: Router = express.Router();

// GitHub统计路由
router.get('/:username', getGitHubStats);

export default router; 