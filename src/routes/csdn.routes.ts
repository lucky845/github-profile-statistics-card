import express, {Router} from 'express';
import {getCSDNStats} from '../controllers/csdn.controller';

const csdnRouter: Router = express.Router();

// CSDN 统计路由
csdnRouter.get('/:userId', getCSDNStats);

export {csdnRouter};
