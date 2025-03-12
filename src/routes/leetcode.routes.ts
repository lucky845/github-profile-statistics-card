import express, {Router} from 'express';
import {getLeetCodeStats} from '../controllers/leetcode.controller';

const leetcodeRouter: Router = express.Router();

// LeetCode统计路由
leetcodeRouter.get('/:username', getLeetCodeStats);

export {leetcodeRouter};
