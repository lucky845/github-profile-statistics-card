import {Request, Response} from 'express';
import {IBilibiliUser} from '../types';
import {CardType, generateCard} from '../services/svg.service';
import {defaultTheme, ThemeOptions} from '../config';
import {getBilibiliInfo} from "../services/bilibili.service";

// 获取Bilibilis用户数据的控制器
export const fetchBilibiliUserData = async (req: Request, res: Response): Promise<void> => {
    const uid = req.params.uid;
    // 获取主题（从中间件或使用默认主题）
    const theme = (res.locals.theme || defaultTheme) as ThemeOptions;
    // 获取缓存时间
    const cacheTimeInSeconds = req.query.cacheSeconds ? parseInt(req.query.cacheSeconds as string) : 120;
    console.debug(`处理Bilibili请求: 用户ID=${uid}`);

    if (!uid) {
        res.status(400).set('Content-Type', 'image/svg+xml')
            .send(generateCard(CardType.ERROR, '未提供用户UID', theme));
        return;
    }

    // 获取掘金统计数据
    const stats = await getBilibiliInfo(uid, cacheTimeInSeconds);

    if (!stats.isValid) {
        res.status(404)
            .set('Content-Type', 'image/svg+xml')
            .send(generateCard(CardType.ERROR, '未找到哔哩哔哩用户', theme));
        return;
    }

    // 返回统计卡片
    // 返回统计卡片SVG
    res.set('Content-Type', 'image/svg+xml');
    // 使用较长的缓存时间，减少请求频率，但仍能保持较新的数据
    res.set('Cache-Control', 'public, max-age=600'); // 10分钟缓存
    res.send(generateCard(CardType.BILIBLI, {
        uid,
        username: stats?.username || uid,
        level: stats?.level || 0,
        sign: stats?.sign || '',
        followers: stats?.followers || 0,
        following: stats?.following || 0,
        likes: stats?.likes || 0,
        views: stats?.views || 0,
        lastUpdated: stats.lastUpdated,
        expireAt: stats.expireAt,
    } as IBilibiliUser, theme));
};
