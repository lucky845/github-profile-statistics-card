import { Request, Response } from 'express';
import { CardType, generateCard } from '../services/svg.service';
import { getLeetCodeUserData, updateLeetCodeUserData } from '../services/leetcode-storage.service';
import { fetchLeetCodeStats } from '../services/leetcode.service';
import { secureLogger } from '../utils/logger';

// 获取LeetCode统计
export const getLeetCodeStats = async (req: Request, res: Response): Promise<void> => {
    try {
        const username = req.params.username;
        // 从查询参数获取主题名称，支持主题参数
        const themeName = (req.query.theme as string) || 'default';
        // 获取区域参数，默认为非中国区
        const useCN = req.query.cn === 'true';
        // 获取缓存时间
        const cacheTimeInSeconds = req.query.cacheSeconds ? parseInt(req.query.cacheSeconds as string) : 120;
        secureLogger.debug(`处理LeetCode请求: 用户名=${username}, 区域=${useCN ? 'CN' : 'US'}, 缓存时间=${cacheTimeInSeconds}秒, 主题=${themeName}`);


        if (!username) {
            res.status(400).set('Content-Type', 'image/svg+xml').send(generateCard(CardType.ERROR, '未提供用户名', themeName));
            return;
        }

        // 从统一存储服务获取用户数据
        const { userData } = await getLeetCodeUserData(username, useCN);

        // 确保当请求的区域与存储的数据区域不一致时，始终从API重新获取数据
        const regionMismatch = userData && ((useCN && userData.region !== 'CN') || (!useCN && userData.region === 'CN'));
        if (!userData || regionMismatch) {
            // 从LeetCode API获取数据，传入区域参数
            const result = await fetchLeetCodeStats(username, useCN);

            if (result.success && result.data) {
                // 将数据存入统一存储服务
                await updateLeetCodeUserData(username, result.data, cacheTimeInSeconds);

                // 返回SVG
                res.set('Content-Type', 'image/svg+xml');
                res.set('Cache-Control', 'max-age=1800'); // 30分钟缓存
                res.send(generateCard(CardType.LEETCODE, result.data, themeName));
                return;
            }
        }

        // 如果已有缓存数据或无法获取新数据，使用缓存数据
        res.set('Content-Type', 'image/svg+xml');
        res.set('Cache-Control', 'max-age=1800'); // 30分钟缓存
        res.send(generateCard(CardType.LEETCODE, userData, themeName));

    } catch (error: any) {
        secureLogger.error(`LeetCode控制器错误: ${error instanceof Error ? error.message : String(error)}`, { error });
        // 从查询参数获取主题名称，支持主题参数
        const themeName = (req.query.theme as string) || 'default';
        res.set('Content-Type', 'image/svg+xml');
        res.status(500).send(generateCard(CardType.ERROR, `处理请求时出错: ${error instanceof Error ? error.message : String(error)}`, themeName));
    }
};
