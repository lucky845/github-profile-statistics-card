import express, {Router} from 'express';
import {getGitHubStats} from '../controllers/github.controller';

const githubRouter: Router = express.Router();

// GitHub统计路由
githubRouter.get('/:username', getGitHubStats);

export {githubRouter};
