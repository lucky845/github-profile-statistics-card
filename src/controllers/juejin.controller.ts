import { Request, Response } from 'express';
import getJuejinInfo from '../services/juejin.service';
import { JuejinUserData } from '../types';
import { generateCard, CardType } from '../services/svg.service';
import { secureLogger } from '../utils/logger';
import { firstString } from '../utils/request.util';

// 获取掘金用户数据的控制器
export const fetchJuejinUserData = async (req: Request, res: Response): Promise<void> => {
    const userId = firstString(req.params.user_id);
    // 从查询参数获取主题名称，支持主题参数
    const themeName = (req.query.theme as string) || 'default';
    // 获取缓存时间
    const cacheTimeInSeconds = req.query.cacheSeconds ? parseInt(req.query.cacheSeconds as string) : 120;
    secureLogger.debug(`处理掘金请求: 用户ID=${userId}`);

    if (!userId) {
        res.status(400).set('Content-Type', 'image/svg+xml')
            .send(generateCard(CardType.ERROR, '未提供用户ID', themeName));
        return;
    }

    // 获取掘金统计数据（无 try/catch 会让异常变成未处理的 Promise 拒绝，请求永不返回）
    let stats;
    try {
        stats = await getJuejinInfo(userId, cacheTimeInSeconds);
    } catch (error) {
        secureLogger.error(`获取掘金数据失败: ${error instanceof Error ? error.message : String(error)}`);
        res.status(503).set('Content-Type', 'image/svg+xml').set('Cache-Control', 'no-store')
            .send(generateCard(CardType.ERROR, '掘金数据暂时不可用', themeName));
        return;
    }

    if (!stats.isValid) {
        res.status(404)
            .set('Content-Type', 'image/svg+xml')
            .send(generateCard(CardType.ERROR, '未找到掘金用户', themeName));
        return;
    }

    // 返回统计卡片
    // 返回统计卡片SVG
    res.set('Content-Type', 'image/svg+xml');
    // 使用较长的缓存时间，减少请求频率，但仍能保持较新的数据
    res.set('Cache-Control', 'public, max-age=600'); // 10分钟缓存
    res.send(generateCard(CardType.JUEJIN, {
        articleCount: stats.articleCount,
        followers: stats.followers,
        likes: stats.likes,
        views: stats.views,
        username: stats.username,
        desc: stats.desc,
    } as JuejinUserData, themeName));
};
