import {AxiosError} from 'axios';
import {JuejinApiResponse, JuejinApiResponseData, JuejinUserData} from '../types';
import {getJuejinUserData, updateJuejinUserData} from './mongodb.service';
import {createRequestWithRetry, createRequest} from '../utils/http.utils';
import { asyncDbUpdate } from '../utils/db-update.utils';


async function getJuejinInfo(userId: string, cacheTimeInSeconds: number): Promise<JuejinUserData> {
    if (!userId) {
        throw new Error('用户ID不能为空');
    }

    let cachedUserData: any = null;

    try {
        const {data, needsFetch} = await getJuejinUserData(userId, cacheTimeInSeconds);
        // 保存缓存数据，以便在catch块中可以访问
        cachedUserData = data;

        // 如果有有效的缓存数据且不需要刷新，直接返回
        if (data && !needsFetch) {
            console.log(`使用缓存的掘金用户数据: ${userId}`);
            return {...data, isValid: true};
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

        // 检查文章列表请求结果
        if (articlesResponse.data.err_no !== 0) {
            throw new Error(articlesResponse.data.err_msg || '获取文章列表失败');
        }

        const newUserData: JuejinApiResponseData = userResponse.data.data;
        
        cachedUserData = {
            ...cachedUserData,
            userId: newUserData.user_id,
            username: newUserData.user_name,
            desc: newUserData.description || '',
            followers: newUserData.follower_count,
            likes: newUserData.got_digg_count,
            views: newUserData.got_view_count,
            articleCount: articlesResponse.data.count || 0,
            lastUpdated: new Date(),
            expireAt: new Date(new Date().getTime() + cacheTimeInSeconds * 1000), // 设置过期时间
        };

        // 异步更新数据库，不阻塞返回
        asyncDbUpdate(updateJuejinUserData, [cachedUserData.userId, cachedUserData], 'Juejin');

        return {
            ...cachedUserData,
            isValid: true,
        };
    } catch (error) {
        if (error instanceof AxiosError) {
            throw new Error(`获取掘金数据失败: ${error.message}`);
        }

        // 判断是否存在缓存，存在缓存直接返回缓存即可
        if (cachedUserData) {
            return cachedUserData;
        }

        // 没有缓存，抛出错误
        throw new Error(`获取掘金数据失败且无缓存: ${error instanceof Error ? error.message : '未知错误'}`);
    }
}

export default getJuejinInfo;
