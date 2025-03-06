import { Router } from 'express';
import { fetchJuejinUserData } from '../controllers/juejin.controller';

const router = Router();

// 获取掘金用户数据
router.get('/:user_id', fetchJuejinUserData);

export default router;
