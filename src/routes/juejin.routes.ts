import {Router} from 'express';
import {fetchJuejinUserData} from '../controllers/juejin.controller';

const juejinRouter: Router = Router();

// 获取掘金用户数据
juejinRouter.get('/:user_id', fetchJuejinUserData);

export {juejinRouter};
