import { Request, Response, NextFunction } from 'express';

/**
 * 验证GitHub用户名格式
 * GitHub用户名规则：字母数字、连字符（不能开头或结尾）、最多39个字符
 */
export const validateGitHubUsername = (req: Request, res: Response, next: NextFunction): void => {
  const username = req.params.username;
  
  if (!username) {
      res.status(400).send('未提供GitHub用户名');
      return;
    }
  
  // 严格的GitHub用户名验证规则
  const usernameRegex = /^[a-zA-Z0-9]([a-zA-Z0-9-]){0,37}[a-zA-Z0-9]$/;
  
  if (!usernameRegex.test(username)) {
      res.status(400).send('无效的GitHub用户名格式');
      return;
    }
  
  next();
};

/**
 * 验证LeetCode用户名格式
 * LeetCode用户名规则：字母数字、下划线、连字符，长度限制1-30
 */
export const validateLeetCodeUsername = (req: Request, res: Response, next: NextFunction): void => {
  const username = req.params.username;
  
  if (!username) {
      res.status(400).send('未提供LeetCode用户名');
      return;
    }
  
  // LeetCode用户名验证规则
  const usernameRegex = /^[a-zA-Z0-9_-]{1,30}$/;
  
  if (!usernameRegex.test(username)) {
      res.status(400).send('无效的LeetCode用户名格式');
      return;
    }
  
  next();
};

/**
 * 验证主题参数
 */
export const validateTheme = (req: Request, res: Response, next: NextFunction): void => {
  const theme = req.query.theme as string;
  
  // 允许的主题列表
  const validThemes = ['light', 'dark', 'merko', 'gruvbox', 'tokyonight'];
  
  if (theme && !validThemes.includes(theme)) {
    res.locals.invalidTheme = true;
    // 不阻止请求，而是使用默认主题
  }
  
  next();
};

/**
 * 验证缓存时间参数
 */
export const validateCacheTime = (req: Request, res: Response, next: NextFunction): void => {
  const cacheSeconds = req.query.cacheSeconds as string;
  
  if (cacheSeconds) {
    const seconds = parseInt(cacheSeconds, 10);
    
    // 验证是否为有效数字且在合理范围内（1秒到24小时）
    if (isNaN(seconds) || seconds < 1 || seconds > 86400) {
      // 设置默认缓存时间为120秒
      (req.query as any).cacheSeconds = '120';
    }
  }
  
  next();
};

/**
 * 通用的用户名验证中间件
 * 适用于其他平台如CSDN、掘金等
 */
export const validateGenericUsername = (req: Request, res: Response, next: NextFunction): void => {
  const username = req.params.username;
  
  if (!username) {
      res.status(400).send('未提供用户名');
      return;
    }
  
  // 基本的用户名安全检查，过滤潜在的恶意字符
  const unsafeChars = /[<>"'&]/;
  const maxLength = 50;
  
  if (unsafeChars.test(username)) {
      res.status(400).send('用户名包含非法字符');
      return;
    }
  
  if (username.length > maxLength) {
      res.status(400).send('用户名长度超过限制');
      return;
    }
  
  next();
};
