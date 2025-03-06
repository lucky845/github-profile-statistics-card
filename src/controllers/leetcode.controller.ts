import { Request, Response } from 'express';
import { fetchLeetCodeStats } from '../services/leetcode.service';
import { getLeetCodeUserData, updateUserData } from '../services/mongodb.service';
import { ILeetCodeUser } from '../types';
import { generateCard, CardType } from '../services/svg.service';
import { ThemeOptions, defaultTheme } from '../config/theme.config';

// 获取LeetCode统计
export const getLeetCodeStats = async (req: Request, res: Response): Promise<void> => {
  try {
    const username = req.params.username;
    // 获取主题（从中间件或使用默认主题）
    const theme = (res.locals.theme || defaultTheme) as ThemeOptions;
    // 获取区域参数，默认为非中国区
    const useCN = req.query.cn === 'true';
    console.debug(`处理LeetCode请求: 用户名=${username}, 区域=${useCN ? 'CN' : 'US'}`);
    

    if (!username) {
      res.status(400).set('Content-Type', 'image/svg+xml').send(generateCard(CardType.ERROR, '未提供用户名', theme));
      return;
    }

    // 从缓存/数据库获取用户数据
    const { userData, needsFetch } = await getLeetCodeUserData(username);

    // 确保当请求的区域与存储的数据区域不一致时，始终从API重新获取数据
    const regionMismatch = userData && ((useCN && userData.region !== 'CN') || (!useCN && userData.region === 'CN'));
    if (!userData || regionMismatch || needsFetch) {
      // 从LeetCode API获取数据，传入区域参数
      const result = await fetchLeetCodeStats(username, useCN);

      if (result.success && result.data) {
        // 将数据存入数据库/缓存
        const leetcodeData: ILeetCodeUser = {
          username: result.data.username,
          totalSolved: result.data.totalSolved,
          easySolved: result.data.easySolved,
          mediumSolved: result.data.mediumSolved,
          hardSolved: result.data.hardSolved,
          acceptanceRate: result.data.acceptanceRate,
          lastUpdated: result.data.lastUpdated,
          region: result.data.region  // 保存区域信息
        };

        await updateUserData(username, leetcodeData);
        
        // 返回SVG
        res.set('Content-Type', 'image/svg+xml');
        res.set('Cache-Control', 'max-age=1800'); // 30分钟缓存
        res.send(generateCard(CardType.LEETCODE, leetcodeData, theme));
        return;
      }
    }

    // 如果已有缓存数据或无法获取新数据，使用缓存数据
    res.set('Content-Type', 'image/svg+xml');
    res.set('Cache-Control', 'max-age=1800'); // 30分钟缓存
    res.send(generateCard(CardType.LEETCODE, userData, theme));

  } catch (error: any) {
    console.error(`LeetCode控制器错误: ${error.message}`);
    // 获取主题（从中间件或使用默认主题）
    const theme = (res.locals.theme || defaultTheme) as ThemeOptions;
    res.set('Content-Type', 'image/svg+xml');
    res.status(500).send(generateCard(CardType.ERROR, `处理请求时出错: ${error.message}`, theme));
  }
}; 