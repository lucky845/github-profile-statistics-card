import { Request, Response } from 'express';
import { generateCard, CardType } from '../services/svg.service';
import { secureLogger } from '../utils/logger';
import { SvgSanitizerService } from '../services/svg-sanitizer.service';
import { githubService } from '../services/github.service';

/**
 * 获取GitHub用户统计信息并生成SVG卡片
 */
export const getGitHubStats = async (req: Request, res: Response): Promise<void> => {
  try {
    // 从请求参数中获取用户名
    const username = req.params.username;
    const theme = req.query.theme as string || 'default';

    // 验证用户名是否存在
    if (!username || typeof username !== 'string' || username.trim() === '') {
      res.status(400).json({ error: '无效的用户名', message: '用户名不能为空' });
      return;
    }

    // 记录日志
    secureLogger.info(`Generating GitHub stats card`);

    // 净化用户输入
    const svgSanitizerService = new SvgSanitizerService();
    const sanitizedUsername = svgSanitizerService.sanitizeUserContent(username.trim());

    // 获取GitHub用户统计信息
    const userData = await githubService.getGitHubUserStats(sanitizedUsername);

    // 生成SVG卡片
    const svg = await generateCard(CardType.GITHUB, {
      username: sanitizedUsername,
      count: userData.visitCount,
      avatarUrl: userData.avatarUrl
    }, theme);
    const sanitizedSvg = svgSanitizerService.sanitize(svg);

    // 设置响应头并发送SVG内容
    res.set('Content-Type', 'image/svg+xml');
    res.send(sanitizedSvg);
  } catch (error: any) {
    // 处理GitHub API错误
    if (error.message === 'User not found') {
      secureLogger.error('User not found');
      res.status(404).json({
        error: 'GitHub 用户不存在或无法访问',
        message: 'User not found'
      });
      return;
    }

    // 处理数据库连接错误
    if (error.message === 'Database connection failed') {
      secureLogger.error('Database connection failed');
      res.status(500).json({
        error: '服务器内部错误',
        message: 'Database connection failed'
      });
      return;
    }

    // 处理其他错误
    secureLogger.error(`Error generating GitHub stats card: ${error.message}`);
    res.status(500).json({
      error: '服务器内部错误',
      message: 'An unexpected error occurred'
    });
    return;
  }
};
