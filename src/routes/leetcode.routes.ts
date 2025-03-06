import express, { Router } from 'express';
import { getLeetCodeStats } from '../controllers/leetcode.controller';

const router: Router = express.Router();

// LeetCode统计路由
router.get('/:username', getLeetCodeStats);

export default router; 