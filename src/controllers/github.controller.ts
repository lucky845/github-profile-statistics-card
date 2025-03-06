import { Request, Response } from 'express';
import crypto from 'crypto';
import { getGitHubUserStats } from '../services/github.service';
import { generateCard, CardType } from '../services/svg.service';
import { ThemeOptions, defaultTheme } from '../config/theme.config';

// 生成访问者唯一标识
const generateVisitorId = (req: Request): string => {
  const userAgent = req.headers['user-agent'] || '';
  const ip = req.headers['x-forwarded-for'] ||
    req.socket.remoteAddress || '';

  // 使用用户代理和IP创建哈希
  const data = userAgent + ip;
  return crypto.createHash('md5').update(data).digest('hex');
};

// 获取GitHub访问统计
export const getGitHubStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const username = req.params.username;
    // 获取主题（从中间件或使用默认主题）
    const theme = (res.locals.theme || defaultTheme) as ThemeOptions;

    if (!username) {
      res.status(400).set('Content-Type', 'image/svg+xml').send(generateCard(CardType.ERROR, '未提供用户名', theme));
      return;
    }

    // 获取用户统计数据（包括头像和访问计数）
    const stats = await getGitHubUserStats(username);
    
    if (!stats.isValid) {
      res.status(404).set('Content-Type', 'image/svg+xml').send(generateCard(CardType.ERROR, '未找到GitHub用户', theme));
      return;
    }

    // 返回统计卡片SVG
    res.set('Content-Type', 'image/svg+xml');
    // 使用较长的缓存时间，减少请求频率，但仍能保持较新的数据
    res.set('Cache-Control', 'public, max-age=600'); // 10分钟缓存
    res.send(generateCard(CardType.GITHUB, {
      count: stats.visitCount,
      avatarUrl: stats.avatarUrl,
      username
    }, theme));

  } catch (error: any) {
    console.error(`GitHub控制器错误: ${error.message}`);
    // 获取主题（从中间件或使用默认主题）
    const theme = (res.locals.theme || defaultTheme) as ThemeOptions;
    res.set('Content-Type', 'image/svg+xml');
    res.status(500).send(generateCard(CardType.ERROR, `处理请求时出错: ${error.message}`, theme));
  }
}; 