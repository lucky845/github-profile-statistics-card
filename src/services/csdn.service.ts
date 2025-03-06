import * as cheerio from 'cheerio';
import { createRequest, createRequestWithRetry } from '../utils/http.utils';
import { getCSDNUserData, updateCSDNUserData } from './mongodb.service';
import * as fs from 'fs';
import * as path from 'path';

// CSDN用户数据接口
export interface CSDNUserStats {
    userId: string;
    username: string;
    articleCount: number;
    followers: number;
    likes: number;
    views: number;
    comments: number;
    points: number;
    rank?: number;
    codeAge?: string | number;
    level?: number | string;
    monthPoints?: number;
    isValid: boolean;
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
        console.debug(`========== CSDN解析调试 ==========`);
        console.debug(`解析CSDN用户页面: ${userId}`);

        // 获取用户名
        const username = $('.user-profile-head-name div').eq(0).text().trim() || userId;
        console.debug(`用户名: ${username}`);

        // 总访问量
        const viewsText = $('.user-profile-statistics-views:contains("总访问量")').text().trim();
        const views = parseInt(viewsText.replace(/,/g, '')) || 0;
        console.debug(`总访问量: ${viewsText} -> ${views}`);

        // 获取码龄
        const codeAgeText = $('.person-code-age span').text().trim();
        const codeAge = codeAgeText.replace('码龄', '') || 0;
        console.debug(`码龄: ${codeAgeText} -> ${codeAge}`);

        // 原力等级模块
        const powerLevelInfo = $('.influence-bottom-box .influence-bottom dt');

        // 获取当前等级
        const levelText = powerLevelInfo.eq(0).text().trim();
        const level = parseInt(levelText.replace(/,/g, '')) || 0;
        console.debug(`当前等级: ${levelText} -> ${level}`);

        // 获取当月分
        const monthPointsText = powerLevelInfo.eq(2).text().trim();
        const monthPoints = parseInt(monthPointsText.replace(/,/g, '')) || 0;
        console.debug(`当月积分: ${monthPointsText} -> ${monthPoints}`);

        // 获取总分
        const totalPointsText = powerLevelInfo.eq(1).text().trim();
        const totalPoints = parseInt(totalPointsText.replace(/,/g, '')) || 0;
        console.debug(`当前总分: ${totalPointsText} -> ${totalPoints}`);

        // 获取粉丝数
        const fansText = $('.user-profile-statistics-num:contains("粉丝")').text().trim() ||
            $('.user-profile-head-info-r-c li:nth-child(4) .user-profile-statistics-num').text().trim();
        const fans = parseInt(fansText.replace(/,/g, '')) || 0;
        console.debug(`粉丝数: ${fansText} -> ${fans}`);

        // 获取排名
        const rankText = $('.user-profile-statistics-num:contains("排名")').text().trim() ||
            $('.user-profile-head-info-r-c li:nth-child(3) .user-profile-statistics-num').text().trim();
        const rank = parseInt(rankText.replace(/,/g, '')) || 0;
        console.debug(`排名: ${rankText} -> ${rank}`);

        // 获取原创文章数
        const originalCountText = $('.user-profile-statistics-num:contains("原创")').text().trim() ||
            $('.user-profile-head-info-r-c li:nth-child(2) .user-profile-statistics-num').text().trim();
        const originalCount = parseInt(originalCountText.replace(/,/g, '')) || 0;
        console.debug(`原创文章数: ${originalCountText} -> ${originalCount}`);

        // 从成就模块
        const achievementInfo = $('.user-profile-aside-common-box .aside-common-box-achievement span');

        let commentsText = achievementInfo.eq(1).text().trim();
        let likesText = achievementInfo.eq(0).text().trim();
        let collectsText = achievementInfo.eq(2).text().trim();

        const comments = parseInt(commentsText.replace(/,/g, '')) || 0;
        console.debug(`评论数: ${commentsText} -> ${comments}`);

        const likes = parseInt(likesText.replace(/,/g, '')) || 0;
        console.debug(`点赞数: ${likesText} -> ${likes}`);

        const collects = parseInt(collectsText.replace(/,/g, '')) || 0;
        console.debug(`收藏数: ${collectsText} -> ${collects}`);

        console.debug(`解析完成的用户数据:`, {
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
        console.debug(`========== CSDN解析结束 ==========`);

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
        console.error(`解析CSDN用户页面失败: ${error}`);
        return { userId, isValid: false };
    }
}

/**
 * 获取CSDN用户统计数据
 * @param userId CSDN用户ID
 * @returns 用户统计数据
 */
export async function getCSDNUserStats(userId: string): Promise<CSDNUserStats> {
    // 声明userData变量，以便在catch块中可以访问
    let cachedUserData: any = null;

    try {
        // 先从MongoDB中获取缓存的数据
        const { userData, needsFetch } = await getCSDNUserData(userId);
        // 保存缓存数据，以便在catch块中可以访问
        cachedUserData = userData;

        // 如果有有效的缓存数据且不需要刷新，直接返回
        if (userData && !needsFetch) {
            console.log(`使用缓存的CSDN用户数据: ${userId}`);
            return {
                userId,
                username: userData.username || userId,
                articleCount: userData.articleCount || 0,
                followers: userData.followers || 0,
                likes: userData.likes || 0,
                views: userData.views || 0,
                comments: userData.comments || 0,
                points: userData.points || 0,
                rank: userData.rank || 0,
                codeAge: userData.codeAge || 0,
                level: userData.level !== undefined ? userData.level : 'N/A',
                monthPoints: userData.monthPoints || 0,
                isValid: true
            };
        }

        // 需要从CSDN网站获取最新数据
        console.log(`从CSDN获取用户数据: ${userId}`);

        // 使用带有重试机制的请求函数
        const parsedUserData = await createRequestWithRetry(
            async () => {
                // 创建请求客户端，添加特定的请求配置
                const httpClient = createRequest(15000, {
                    headers: {
                        'Referer': `https://blog.csdn.net/${userId}`,
                        'Cookie': 'uuid_tt_dd=xxx-xxx-xxx;',  // 使用模拟的Cookie
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
                    }
                });

                // 添加随机延迟，模拟人类行为
                const randomDelay = Math.floor(Math.random() * 2000) + 1000; // 1-3秒延迟
                await new Promise(resolve => setTimeout(resolve, randomDelay));

                // 获取用户主页数据
                const response = await httpClient.get(`https://blog.csdn.net/${userId}`);

                if (response.status !== 200) {
                    throw new Error(`获取CSDN用户页面失败: ${userId}, 状态码: ${response.status}`);
                }

                // 解析HTML页面
                const parsedData = parseCSDNUserPage(response.data, userId);

                if (!parsedData.isValid) {
                    throw new Error(`解析CSDN用户页面失败: ${userId}`);
                }

                return parsedData;
            },
            5, // 最大重试5次
            2000 // 初始延迟2秒
        );

        // 构建用户数据，包含访问计数和更新时间
        const csdnUserData = {
            ...parsedUserData,
            visitCount: cachedUserData?.visitCount ? cachedUserData.visitCount + 1 : 1,
            lastUpdated: new Date()
        };

        // 更新数据库
        // await updateCSDNUserData(userId, csdnUserData);

        return {
            ...csdnUserData,
            isValid: true
        } as CSDNUserStats;
    } catch (error: any) {
        console.error(`获取CSDN用户数据失败: ${error.message}`);

        // 如果有缓存数据，即使过期也返回
        if (cachedUserData) {
            console.log(`返回过期的缓存数据: ${userId}`);
            return {
                userId,
                username: cachedUserData.username || userId,
                articleCount: cachedUserData.articleCount || 0,
                followers: cachedUserData.followers || 0,
                likes: cachedUserData.likes || 0,
                views: cachedUserData.views || 0,
                comments: cachedUserData.comments || 0,
                points: cachedUserData.points || 0,
                rank: cachedUserData.rank || 0,
                codeAge: cachedUserData.codeAge || 0,
                level: cachedUserData.level !== undefined ? cachedUserData.level : 'N/A',
                monthPoints: cachedUserData.monthPoints || 0,
                isValid: true
            };
        }

        // 否则返回默认数据
        return {
            userId,
            username: userId,
            articleCount: 0,
            followers: 0,
            likes: 0,
            views: 0,
            comments: 0,
            points: 0,
            rank: 0,
            codeAge: 0,
            level: 'N/A',
            monthPoints: 0,
            isValid: false
        };
    }
} 