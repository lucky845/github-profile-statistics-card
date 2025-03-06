import axios, { AxiosError } from 'axios';
import { IJuejinUserData, JuejinUserData } from '../types/juejin.types';
import { getJuejinUserData, updateJuejinUserData } from './mongodb.service';

interface JuejinApiResponseData {
    user_id: string,
    user_name: string,
    description: string,
    follower_count: number,
    got_digg_count: number,
    article_count: number,
    got_view_count: number,
};

interface JuejinApiResponse {
    err_no: number;
    err_msg: string;
    data: JuejinApiResponseData;
    count?: number;
}

async function getJuejinInfo(userId: string, cacheTimeInSeconds: number): Promise<JuejinUserData> {
    if (!userId) {
        throw new Error('用户ID不能为空');
    }

    let cachedUserData: any = null;

    try {
        const { userData, needsFetch } = await getJuejinUserData(userId, cacheTimeInSeconds);
        // 保存缓存数据，以便在catch块中可以访问
        cachedUserData = userData;

        // 如果有有效的缓存数据且不需要刷新，直接返回
        if (userData && !needsFetch) {
            console.log(`使用缓存的掘金用户数据: ${userId}`);
            return {...userData, isValid: true};
        }

        // 获取用户基本信息
        const userResponse = await axios.get<JuejinApiResponse>(
            `https://api.juejin.cn/user_api/v1/user/get?user_id=${userId}`
        );

        if (userResponse.data.err_no !== 0) {
            throw new Error(userResponse.data.err_msg || '获取用户信息失败');
        }

        const newUserData: JuejinApiResponseData = userResponse.data.data;
        const result = {
            userId: newUserData.user_id,
            username: newUserData.user_name,
            desc: newUserData.description || '',
            followers: newUserData.follower_count,
            likes: newUserData.got_digg_count,
            views: newUserData.got_view_count,
        };

        // 获取文章列表
        const articlesResponse = await axios.post<JuejinApiResponse>(
            'https://api.juejin.cn/content_api/v1/article/query_list',
            {
                user_id: userId,
                cursor: "0",
                sort_type: 2,
                limit: 20
            }
        );

        if (articlesResponse.data.err_no !== 0) {
            throw new Error(articlesResponse.data.err_msg || '获取文章列表失败');
        }

        cachedUserData = {
            ...cachedUserData,
            ...result,
            articleCount: articlesResponse.data.count || 0,
            lastUpdated: new Date(),
            expireAt: new Date(new Date().getTime() + cacheTimeInSeconds * 1000), // 设置过期时间
        };

        // 更新MongoDB数据
        updateJuejinUserData(cachedUserData.userId, cachedUserData)

        return {
            ...cachedUserData,
            isValid: true,
        };
    } catch (error) {
        if (error instanceof AxiosError) {
            throw new Error(`获取掘金数据失败: ${error.message}`);
        }
        
        // 判断是否存在缓存，存在缓存直接返回缓存即可
        if(cachedUserData) {
            return cachedUserData;
        }

        // 没有缓存，返回默认数据
        return {
            userId,
            username: userId,
            desc: '',
            followers: 0,
            likes: 0,
            views: 0,
            articleCount: 0,
            lastUpdated: new Date(),
            expireAt: new Date(new Date().getTime() + cacheTimeInSeconds * 1000), // 设置过期时间
            isValid: false,
        };
    }
}

export default getJuejinInfo; 