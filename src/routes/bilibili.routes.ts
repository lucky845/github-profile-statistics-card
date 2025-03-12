import express, {Router} from 'express';
import {fetchBilibiliUserData} from '../controllers/bilibili.controller';

const bilibiliRouter: Router = express.Router();

// Bilibili 统计路由
bilibiliRouter.get('/:uid', fetchBilibiliUserData);

export {bilibiliRouter};
