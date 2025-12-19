import { Request, Response } from 'express';
import { getCSDNUserStats } from '../services/csdn.service';
import { generateCard, CardType } from '../services/svg.service';
import { activeTheme } from '../config/theme.config';
import { secureLogger } from '../utils/logger';

// 获取CSDN统计信息
export const getCSDNStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = req.params.userId;
    // 从查询参数获取主题名称，支持主题参数
    const themeName = (req.query.theme as string) || 'default';
    // 获取缓存时间
    const cacheTimeInSeconds = req.query.cacheSeconds ? parseInt(req.query.cacheSeconds as string) : 120;

    if (!userId) {
      res.status(400).set('Content-Type', 'image/svg+xml').send(generateCard(CardType.ERROR, '未提供用户名', themeName));
      return;
    }

    // 获取CSDN用户统计数据
    const stats = await getCSDNUserStats(userId, cacheTimeInSeconds);

    if (!stats.isValid) {
      res.status(404).set('Content-Type', 'image/svg+xml').send(generateCard(CardType.ERROR, '未找到CSDN用户', themeName));
      return;
    }

    // 返回统计卡片SVG
    res.set('Content-Type', 'image/svg+xml');
    // 使用较长的缓存时间，减少请求频率，但仍能保持较新的数据
    res.set('Cache-Control', 'public, max-age=600'); // 10分钟缓存
    res.send(generateCard(CardType.CSDN, {
      articleCount: stats.articleCount,
      followers: stats.followers,
      likes: stats.likes,
      views: stats.views,
      comments: stats.comments,
      points: stats.points,
      username: stats.username,
      rank: stats.rank,
      codeAge: stats.codeAge,
      level: stats.level,
      monthPoints: stats.monthPoints
    }, themeName));

  } catch (error: any) {
      secureLogger.error(`CSDN控制器错误: ${error instanceof Error ? error.message : String(error)}`, { error });
      // 从查询参数获取主题名称，支持主题参数
      const themeName = (req.query.theme as string) || 'default';
      res.set('Content-Type', 'image/svg+xml');
      res.status(500).send(generateCard(CardType.ERROR, `处理请求时出错: ${error instanceof Error ? error.message : String(error)}`, themeName));
    }
};
