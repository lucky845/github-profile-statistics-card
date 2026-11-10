/**
 * CSDN 用户统计
 *
 * 数据只走 Redis（cacheService）+ 上游页面，不再落 MongoDB。
 * 页面解析逻辑与之前完全一致：优先读 window.__INITIAL_STATE__，
 * 退回 DOM 标签配对，避免 CSDN 统计条顺序变化时把粉丝数当排名。
 */
import * as cheerio from 'cheerio';
import { createRequest, createRequestWithRetry } from '../utils/http.utils';
import { cacheService } from './cache.service';
import { CSDNUserStats } from '../types';
import { secureLogger } from '../utils/logger';

const CACHE_PREFIX = 'csdn_data';
const CACHE_TTL = 30 * 60;

export const csdnCacheKey = (userId: string): string =>
  `${CACHE_PREFIX}:${userId.toLowerCase()}`;

/**
 * 从页面里取出 window.__INITIAL_STATE__ 的 JSON。
 * CSDN 把服务端渲染的数据直接塞进脚本变量，比 DOM 结构稳定得多
 * （统计条历史上在不同账号上项数和顺序都不一样）。
 * 解析失败返回 null，调用方全部走 DOM 兜底。
 */
function readInitialState(html: string): any {
    try {
        const at = html.indexOf('window.__INITIAL_STATE__');
        if (at < 0) return null;
        const eq = html.indexOf('=', at);
        const start = eq + 1;
        let depth = 0, end = -1, inStr = false, esc = false;
        for (let k = start; k < html.length; k++) {
            const c = html[k];
            if (inStr) {
                if (esc) esc = false;
                else if (c === '\\') esc = true;
                else if (c === '"') inStr = false;
                continue;
            }
            if (c === '"') { inStr = true; continue; }
            if (c === '{') depth++;
            else if (c === '}') { depth--; if (depth === 0) { end = k + 1; break; } }
        }
        if (end < 0) return null;
        return JSON.parse(html.slice(start, end));
    } catch {
        return null;
    }
}

/**
 * 解析CSDN用户页面
 * @param html HTML内容
 * @param userId 用户ID
 * @returns 解析后的用户数据
 */
function parseCSDNUserPage(html: string, userId: string): Partial<CSDNUserStats> {
    try {
        // 使用cheerio加载HTML
        const $ = cheerio.load(html);

        // 添加调试信息
        secureLogger.debug(`========== CSDN解析调试 ==========`);
        secureLogger.debug(`解析CSDN用户页面: ${userId}`);

        // 不存在的用户 CSDN 也回 200，只是页面里没有统计条。
        // 不判这个的话会解析出一张全 0 的"正常"卡，比降级卡更误导
        if ($('.user-profile-statistics-num').length === 0) {
            secureLogger.warn(`CSDN 页面不含用户统计: ${userId}`);
            throw new Error(`CSDN 页面不含用户统计（用户可能不存在）: ${userId}`);
        }

        // 获取用户名
        const username = $('.user-profile-head-name div').eq(0).text().trim() || userId;
        secureLogger.debug(`用户名: ${username}`);

        // 获取码龄
        const codeAgeText = $('.person-code-age span').text().trim();
        const codeAge = codeAgeText.replace('码龄', '') || 0;
        secureLogger.debug(`码龄: ${codeAgeText} -> ${codeAge}`);

        // 原力等级模块
        const powerLevelInfo = $('.influence-bottom-box .influence-bottom dt');

        // 获取当前等级
        const levelText = powerLevelInfo.eq(0).text().trim();
        const level = parseInt(levelText.replace(/,/g, '')) || 0;
        secureLogger.debug(`当前等级: ${levelText} -> ${level}`);

        // 获取当月分
        const monthPointsText = powerLevelInfo.eq(2).text().trim();
        const monthPoints = parseInt(monthPointsText.replace(/,/g, '')) || 0;
        secureLogger.debug(`当月积分: ${monthPointsText} -> ${monthPoints}`);

        // 获取总分
        const totalPointsText = powerLevelInfo.eq(1).text().trim();
        const totalPoints = parseInt(totalPointsText.replace(/,/g, '')) || 0;
        secureLogger.debug(`当前总分: ${totalPointsText} -> ${totalPoints}`);

        // 统计项必须按标签名配对取值，不能用 li:nth-child(N)。
        // CSDN 的统计区项数和顺序随账号状态变化：没发过文章的号只有
        // 【原创 / 粉丝 / 关注】三项（外加一个空 li），写死 nth-child(4) 会取到
        // “关注”的数字当成粉丝，nth-child(3) 把粉丝数当成排名。
        const statByLabel = (label: string): number => {
            const item = $('.user-profile-head-info-r-c li')
                .filter((_i, el) => $(el).find('.user-profile-statistics-name').text().trim() === label);
            const raw = item.find('.user-profile-statistics-num').text().trim();
            // “暂无” / 空文本都按 0 处理，不要再套一层 parseInt 撞 NaN
            return parseInt(raw.replace(/,/g, ''), 10) || 0;
        };

        const fans = statByLabel('粉丝');
        secureLogger.debug(`粉丝数: ${fans}`);

        const rank = statByLabel('排名');
        secureLogger.debug(`排名: ${rank}`);

        const originalCount = statByLabel('原创');
        secureLogger.debug(`原创文章数: ${originalCount}`);

        // 总访问量：优先读页面内嵌的 window.__INITIAL_STATE__（服务端渲染的
        // 权威数据），退回 .user-profile-statistics-views 块，再退回统计条上的
        // “访问”项，都没有就是 0。主页 DOM 在很多账号上根本不含访问量。
        const state = readInitialState(html);
        const stateViews = state?.pageData?.data?.baseInfo?.blogModule?.visitedTimes;
        const viewsText = $('.user-profile-statistics-views:contains("总访问量")').text().trim();
        const views = (typeof stateViews === 'number' && stateViews) || 
            parseInt(viewsText.replace(/,/g, '')) || statByLabel('访问');
        secureLogger.debug(`总访问量: state=${stateViews} dom=${viewsText} -> ${views}`);

        // 从成就模块
        const achievementInfo = $('.user-profile-aside-common-box .aside-common-box-achievement span');

        let commentsText = achievementInfo.eq(1).text().trim();
        let likesText = achievementInfo.eq(0).text().trim();
        let collectsText = achievementInfo.eq(2).text().trim();

        const comments = parseInt(commentsText.replace(/,/g, '')) || 0;
        secureLogger.debug(`评论数: ${commentsText} -> ${comments}`);

        const likes = parseInt(likesText.replace(/,/g, '')) || 0;
        secureLogger.debug(`点赞数: ${likesText} -> ${likes}`);

        const collects = parseInt(collectsText.replace(/,/g, '')) || 0;
        secureLogger.debug(`收藏数: ${collectsText} -> ${collects}`);

        secureLogger.debug(`解析完成的用户数据:`, {
            userId,
            username,
            articleCount: originalCount,
            followers: fans,
            likes,
            views,
            comments,
            points: totalPoints,
            rank,
            codeAge,
            level,
            monthPoints
        });
        secureLogger.debug(`========== CSDN解析结束 ==========`);

        return {
            userId,
            username,
            articleCount: originalCount,
            followers: fans,
            likes,
            views,
            comments,
            points: totalPoints,
            rank,
            codeAge,
            level,
            monthPoints,
            isValid: true
        };
    } catch (error) {
    secureLogger.error(`解析CSDN用户页面失败: ${error}`);
    return { userId, isValid: false };
  }
}
/**
 * 抓取并解析 CSDN 主页。
 * 不存在的用户 CSDN 也回 200，只是页面里没有统计条；这种情况抛
 * USER_NOT_FOUND，交给上层映射成 404。
 */
const fetchFromPage = async (userId: string): Promise<CSDNUserStats> => {
    const parsedUserData = await createRequestWithRetry(
        async () => {
            const httpClient = createRequest(8000, {
                headers: {
                    'Referer': `https://blog.csdn.net/${userId}`,
                    'Cookie': 'uuid_tt_dd=xxx-xxx-xxx;',
                    // 91 版 UA 会被 CSDN 直接丢到安全验证页，升到近两年的主版本
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
                }
            });

            const response = await httpClient.get(`https://blog.csdn.net/${userId}`);

            if (typeof response.data === 'string' &&
                response.data.includes('Security Verification') &&
                !response.data.includes('user-profile-statistics-num')) {
                throw new Error(`CSDN返回安全验证页（风控拦截）: ${userId}`);
            }

            const parsedData = parseCSDNUserPage(response.data, userId);

            if (!parsedData.isValid) {
                throw new Error(`USER_NOT_FOUND:${userId}`);
            }

            return parsedData as CSDNUserStats;
        },
        2, // 最大重试2次：4xx 会直接快速失败，5xx 才有必要重试
        800 // 初始延迟800ms
    );

    return {
        ...parsedUserData,
        expireAt: new Date(Date.now() + CACHE_TTL * 1000),
    } as CSDNUserStats;
};

/**
 * 对外入口：缓存优先。只缓存成功结果，失败留给上层出降级卡。
 */
export async function getCSDNUserStats(userId: string, cacheSeconds: number = CACHE_TTL): Promise<CSDNUserStats> {
    const key = csdnCacheKey(userId);

    try {
        const cached = await cacheService.get<CSDNUserStats>(key);
        if (cached && typeof cached.views === 'number') {
            secureLogger.info(`使用缓存的CSDN用户数据: ${userId}`);
            return cached;
        }
    } catch (error) {
        secureLogger.warn(`读取CSDN缓存失败: ${userId}`);
    }

    const stats = await fetchFromPage(userId);

    try {
        await cacheService.set(key, stats, cacheSeconds);
    } catch (error) {
        secureLogger.warn(`写入CSDN缓存失败: ${userId}`);
    }

    return stats;
}
