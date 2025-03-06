import express from 'express';
import { getCSDNStats } from '../controllers/csdn.controller';

const router = express.Router();

// CSDN 统计路由
router.get('/:userId', getCSDNStats);

export default router; 