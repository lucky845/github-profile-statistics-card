import {IBilibiliUser} from '../types';
import {getBilibiliUserData, updateBilibiliUserData} from "./mongodb.service";
import axios from "axios";
import {bilibiliConfig} from "../config/bilibili.config";
import * as cheerio from 'cheerio';
// import {encWbi, getWbiKeys} from "../utils/bilibili.utils";

// API 接口路径
const API_PATHS = {
    // UP主信息（名称、性别、头像、描述、个人认证信息、大会员状态、直播间地址、预览图、标题、房间号、观看人数、直播间状态[开启/关闭]等）
    USER_INFO: 'https://api.bilibili.com/x/space/wbi/acc/info', // 该接口一直会出现-352风控异常，暂时先搁置
    USER_INFO_CRAWLER: 'https://m.bilibili.com/space/', // 个人主页
    // UP主粉丝数、关注数
    USER_STAT: 'https://api.bilibili.com/x/relation/stat',
    // UP主总播放数、总专栏浏览数
    USER_UPSTAT: 'https://api.bilibili.com/x/space/upstat',
};

// 获取完整的请求头
export const getBilibiliHeaders = (): Record<string, string> => {
    return {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 5.0; SM-G900P Build/LRX21T) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/88.0.4324.104 Mobile Safari/537.36',
        'Cookie': `SESSDATA=${bilibiliConfig.bilibiliSession}`,
        'Referer': 'https://space.bilibili.com'
    };
};

// 获取用户数据
export const getBilibiliInfo = async (
    uid: string,
    cacheTimeInSeconds: number
): Promise<IBilibiliUser> => {

    if (!uid) {
        throw new Error('用户ID不能为空');
    }

    let cachedUserData: any = null;

    try {
        const {data, needsFetch} = await getBilibiliUserData(uid, cacheTimeInSeconds);

        // 保存缓存数据，以便在catch块中可以访问
        cachedUserData = data;

        // 如果有有效的缓存数据且不需要刷新，直接返回
        if (data && !needsFetch) {
            console.log(`使用缓存的Bilibili用户数据: ${uid}`);
            return {...data, isValid: true};
        }

        // 获取用户基本信息
        const userData = await fetchBilibiliUserData(uid, cacheTimeInSeconds);

        if (!userData) {
            throw new Error('获取哔哩哔哩数据失败');
        }

        // 更新到缓存
        await updateBilibiliUserData(uid, userData);

        return {...userData, isValid: true};
    } catch (error: any) {
        console.error(`获取哔哩哔哩数据出错: ${error.message}`);

        // 判断是否存在缓存，存在缓存直接返回缓存即可
        if (cachedUserData) {
            console.log(`使用过期的缓存数据: ${uid}`);
            return {...cachedUserData, isValid: false};
        }

        // 没有缓存，返回默认数据
        console.log(`无法获取数据，返回默认数据: ${uid}`);
        return {
            uid,
            username: uid,
            level: 0,
            sign: '',
            followers: 0,
            following: 0,
            likes: 0,
            views: 0,
            lastUpdated: new Date(),
            isValid: false,
        };
    }
};

// 获取用户数据
const fetchBilibiliUserData = async (uid: string, cacheTimeInSeconds: number): Promise<IBilibiliUser | null> => {
    try {
        const headers = getBilibiliHeaders();
        let userInfo: any = {}, userStat: any = {}, upStat: any = {}, videoData: any = {};

        // 获取用户基本信息 (使用 wbi 签名)
        // try {
        //     const web_keys = await getWbiKeys(bilibiliConfig.bilibiliSession);
        //     const params = {mid: uid},
        //         img_key = web_keys.img_key,
        //         sub_key = web_keys.sub_key
        //
        //     const query = encWbi(params, img_key, sub_key);
        //     console.log('AAAAAA' + query)
        //
        //     const userInfoResponse = await axios.get(API_PATHS.USER_INFO + '?' + query, {
        //         headers
        //     });
        //     userInfo = userInfoResponse.data;
        //     console.log(`获取到的哔哩哔哩用户信息: ${JSON.stringify(userInfo)}`);
        // } catch (error: any) {
        //     console.error(`获取用户基本信息失败: ${error.message}`);
        //     throw error;
        // }

        // 爬取用户基本信息
        try {
            const userInfoResponse = await axios.get(API_PATHS.USER_INFO_CRAWLER + uid, {
                headers
            });

            let $ = cheerio.load(userInfoResponse.data);

            $('.base .name').each((_i, e) => {
                userInfo.name = $(e).text();
            });

            // todo 等级是svg，已经无法直接获取了
            $('.base .level i').each((_i, e) => {
                let classStr: any = $(e).attr('class');
                let level = classStr.substr(classStr.length - 1);
                userInfo.level = parseInt(level);
            });

            $('.desc .content').each((_i, e) => {
                userInfo.description = $(e).text();
            });

        } catch (error: any) {
            console.log(`获取用户基本信息失败: ${error.message}`)
            throw error;
        }

        // 获取用户统计信息
        try {
            const userStatResponse = await axios.get(API_PATHS.USER_STAT + '?vmid=' + uid, {
                headers
            });
            userStat = userStatResponse.data;
            console.log(`获取到的哔哩哔哩用户统计信息: ${JSON.stringify(userStat)}`);
        } catch (error: any) {
            console.error(`获取用户统计信息失败: ${error.message}`);
            userStat = {follower: 0, following: 0};
        }

        // 获取UP主数据
        try {
            const upStatResponse: { data: any } = await axios.get(API_PATHS.USER_UPSTAT + '?mid=' + uid, {
                headers
            });
            upStat = upStatResponse.data;
            console.log(`获取到的哔哩哔哩UP主数据: ${JSON.stringify(upStat)}`);
        } catch (error: any) {
            console.error(`获取UP主数据失败: ${error.message}`);
            upStat = {likes: 0};
        }

        // 整合数据
        return {
            uid,
            username: userInfo?.name || uid,
            level: userInfo?.level || 0,
            sign: userInfo?.description || '',
            followers: userStat?.data?.follower || 0,
            following: userStat?.data?.following || 0,
            likes: upStat?.data?.likes || 0,
            views: upStat?.data?.archive?.view || 0,
            lastUpdated: new Date(),
            expireAt: new Date(new Date().getTime() + cacheTimeInSeconds * 1000), // 设置过期时间
        };
    } catch (error: any) {
        console.error(`[Bilibili] 更新失败: ${error.message}`);
        return null;
    }
};
