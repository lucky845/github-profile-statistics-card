import {AxiosError} from 'axios';
import {JuejinApiResponse, JuejinApiResponseData, JuejinUserData} from '../types';
import {getJuejinUserData, updateJuejinUserData} from './juejin-storage.service';
import {createRequestWithRetry, createRequest} from '../utils/http.utils';
import { asyncDbUpdate } from '../utils/db-update.utils';
import { secureLogger } from '../utils/logger';


// 重试会重置单次 5 秒超时，两个请求叠加重试可远超客户端等待上限，
// 这里给整次抓取设总预算，避免路由挂死（缓存命中或读库时不受影响）
const TOTAL_TIMEOUT_MS = 15000;

async function getJuejinInfoInner(userId: string, cacheTimeInSeconds: number): Promise<JuejinUserData> {
    if (!userId) {
        throw new Error('用户ID不能为空');
    }

    let cachedUserData: JuejinUserData | null = null;

    try {
        const {userData, needsFetch} = await getJuejinUserData(userId, cacheTimeInSeconds);
        // 保存缓存数据，以便在catch块中可以访问
        cachedUserData = userData;

        // 如果有有效的缓存数据且不需要刷新，直接返回
        if (userData && !needsFetch) {
            secureLogger.info(`使用缓存的掘金用户数据: ${userId}`);
            return {...userData, isValid: true};
        }

        // 创建带有反爬虫措施的请求实例
        const request = createRequest(5000,{
                headers: {
                    'Origin': 'https://juejin.cn',
                    'Referer': `https://juejin.cn/user/${userId}`
                }
            });

        // 并行执行两个请求以提高速度
        const [userResponse, articlesResponse] = await Promise.all([
            // 获取用户基本信息
            createRequestWithRetry(() => request.get<JuejinApiResponse>(
                `https://api.juejin.cn/user_api/v1/user/get?user_id=${userId}`
            ), 3, 1000),
            // 获取文章列表
            createRequestWithRetry(() => request.post<JuejinApiResponse>(
                'https://api.juejin.cn/content_api/v1/article/query_list',
                {
                    user_id: userId,
                    cursor: "0",
                    sort_type: 2,
                    limit: 20
                }
            ), 3, 1000)
        ]);

        // 检查用户信息请求结果
        if (userResponse.data.err_no !== 0) {
            throw new Error(userResponse.data.err_msg || '获取用户信息失败');
        }

        // shape guard：掘金官方 API 已静默失效，会返回 err_no:0 但 user_id='0'、
        // user_name 为空、所有计数为 0 的空壳。这种"看起来成功"的响应必须拒绝，
        // 否则卡片会显示一张全 0 的假数据。
        const probe = userResponse.data?.data;
        if (!probe || !probe.user_id || String(probe.user_id) === '0' || !probe.user_name) {
            throw new Error('掘金接口已失效：返回空壳数据（user_id=0）');
        }

        // 检查文章列表请求结果。
        // 注意：文章列表接口对「没发过文章的账号」会返回 err_no:0 / data:null / count:0，
        // 这是正常的空集合，不是失败。之前把它当失败抛出，整次抓取被丢弃退回
        // 旧缓存，卡片就一直显示过期的 0。
        if (articlesResponse.data.err_no !== 0) {
            throw new Error(articlesResponse.data.err_msg || '获取文章列表失败');
        }

        const newUserData: JuejinApiResponseData = userResponse.data.data;
        
        cachedUserData = {
            ...(cachedUserData || {}), // 确保有一个基础对象
            userId: newUserData.user_id,
            username: newUserData.user_name,
            desc: newUserData.description || '',
            followers: newUserData.follower_count,
            likes: newUserData.got_digg_count,
            views: newUserData.got_view_count,
            articleCount: (typeof articlesResponse.data.count === 'number' ? articlesResponse.data.count : 0),
            lastUpdated: new Date(),
            expireAt: new Date(new Date().getTime() + cacheTimeInSeconds * 1000), // 设置过期时间
            isValid: true // 确保isValid属性存在且为布尔值
        };

        // 异步更新数据库，不阻塞返回
        if (cachedUserData && cachedUserData.userId) {
            asyncDbUpdate(updateJuejinUserData, [cachedUserData.userId, cachedUserData], 'Juejin');
        }

        return {
            ...cachedUserData,
            isValid: true,
        };
    } catch (error) {
        if (error instanceof AxiosError) {
            throw new Error(`获取掘金数据失败: ${error.message}`);
        }

        // 抓取失败时回落到过期缓存：数据是旧的，必须标记无效，
        // 否则上层会当作最新数据再缓存一层 HTTP 结果
        if (cachedUserData) {
            return {...cachedUserData, isValid: false};
        }

        // 没有缓存，抛出错误
        throw new Error(`获取掘金数据失败且无缓存: ${error instanceof Error ? error.message : '未知错误'}`);
    }
}

async function getJuejinInfo(userId: string, cacheTimeInSeconds: number): Promise<JuejinUserData> {
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('掘金数据获取超时')), TOTAL_TIMEOUT_MS);
        timer.unref?.();
    });
    try {
        return await Promise.race([getJuejinInfoInner(userId, cacheTimeInSeconds), timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export default getJuejinInfo;
