import { Request, Response, NextFunction } from 'express';
import { getThemeConfig, generateCard, CardType } from '../services/svg.service';
import { secureLogger } from '../utils/logger';

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
 * 确保主题名称只包含安全字符，并在无效时使用默认主题
 */
export const validateTheme = (req: Request, res: Response, next: NextFunction): void => {
  const theme = req.query.theme as string;

  // 允许的主题列表 - 使用与配置文件一致的主题名称
  const validThemes = ['default', 'light', 'dark', 'blue', 'green', 'purple', 'orange', 'red'];

  if (theme) {
    // 过滤掉潜在的恶意字符，只允许字母、数字和连字符
    const sanitizedTheme = theme.replace(/[^a-zA-Z0-9-]/g, '');
    
    // 检查是否有字符被过滤掉
    if (sanitizedTheme !== theme) {
      secureLogger.warn(`主题参数包含不允许的字符: ${theme} -> ${sanitizedTheme}`);
      // 直接使用净化后的主题名称
      (req.query as any).theme = sanitizedTheme;
    }

    // 验证净化后的主题是否在有效列表中
    if (!validThemes.includes(sanitizedTheme)) {
      res.locals.invalidTheme = true;
      // 不阻止请求，而是使用默认主题
      delete (req.query as any).theme;
    }
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
 * 通用用户名验证中间件
 * 适用于CSDN、掘金、B站等平台
 */
export const validateGenericUsername = (req: Request, res: Response, next: NextFunction): void => {
  try {
    // 直接从params中获取对应的参数，而不是通过路径判断
    const username = req.params.userId || req.params.uid || req.params.username;

    if (!username || username.trim() === '') {
      // 检查是否是SVG卡片请求
      if (req.path.includes('/csdn/') || req.path.includes('/bilibili/') ||
        req.path.includes('/github/') || req.path.includes('/juejin/') ||
        req.path.includes('/leetcode/')) {
        // 返回SVG格式的错误卡片
        const themeName = req.query.theme as string;
        res.status(400).set('Content-Type', 'image/svg+xml')
          .send(generateCard(CardType.ERROR, '未提供用户名', themeName));
        return;
      }
      res.status(400).send('未提供用户名');
      return;
    }

    // 过滤掉潜在的恶意字符
    const sanitizedUsername = username.replace(/[^a-zA-Z0-9_\-]/g, '');
    if (sanitizedUsername !== username) {
      secureLogger.warn(`用户名包含不允许的字符: ${username} -> ${sanitizedUsername}`);
    }

    // 将净化后的用户名保存回对应的参数中
    if (req.params.userId !== undefined) {
      req.params.userId = sanitizedUsername;
    }
    if (req.params.uid !== undefined) {
      req.params.uid = sanitizedUsername;
    }
    if (req.params.username !== undefined) {
      req.params.username = sanitizedUsername;
    }

    next();
  } catch (error) {
    secureLogger.error('用户名验证失败:', error);
    res.status(500).send('服务器内部错误');
  }
};
