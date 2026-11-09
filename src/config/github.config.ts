import dotenv from 'dotenv';

dotenv.config();

export const githubConfig = {
    // 不带 token 时配额仅 60 次/小时，带 token 为 5000 次/小时
    apiToken: process.env.GITHUB_TOKEN || '',
};
