import { Request, Response } from 'express';
import getJuejinInfo from '../services/juejin.service';
import { JuejinUserData } from '../types';
import { generateCard, CardType } from '../services/svg.service';
import { defaultTheme, ThemeOptions } from '../config';

// 获取掘金用户数据的控制器
export const fetchJuejinUserData = async (req: Request, res: Response): Promise<void> => {
    const userId = req.params.user_id;
    // 获取主题（从中间件或使用默认主题）
    const theme = (res.locals.theme || defaultTheme) as ThemeOptions;
    // 获取缓存时间
    const cacheTimeInSeconds = req.query.cacheSeconds ? parseInt(req.query.cacheSeconds as string) : 120;
    console.debug(`处理掘金请求: 用户ID=${userId}`);

    if (!userId) {
        res.status(400).set('Content-Type', 'image/svg+xml')
            .send(generateCard(CardType.ERROR, '未提供用户ID', theme));
        return;
    }

    // 获取掘金统计数据
    const stats = await getJuejinInfo(userId, cacheTimeInSeconds);

    if (!stats.isValid) {
        res.status(404)
            .set('Content-Type', 'image/svg+xml')
            .send(generateCard(CardType.ERROR, '未找到掘金用户', theme));
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
    } as JuejinUserData, theme));
};
