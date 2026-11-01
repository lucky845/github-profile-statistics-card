import axios, {AxiosRequestConfig} from 'axios';
import https from 'https';
import { secureLogger } from './logger';

// 随机用户代理列表
const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.159 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.2 Safari/605.1.15',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.107 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:90.0) Gecko/20100101 Firefox/90.0',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:90.0) Gecko/20100101 Firefox/90.0',
];

// 获取随机用户代理
const getRandomUserAgent = (): string => {
    return userAgents[Math.floor(Math.random() * userAgents.length)];
};

// 生成随机IP地址
const getRandomIP = (): string => {
    return `${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
};

// 创建带有增强反爬虫措施的HTTP请求
export const createRequest = (timeout = 10000, config: AxiosRequestConfig = {}) => {
    const randomIP = getRandomIP();

    return axios.create({
        timeout,
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Cache-Control': 'max-age=0',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'DNT': '1',
            'TE': 'Trailers',
            'X-Forwarded-For': randomIP,
            'X-Real-IP': randomIP,
            'Referer': 'https://www.baidu.com/',
            ...config.headers,
        },
        // 添加代理支持（可选）
        proxy: config.proxy,
        // 禁用SSL验证（仅开发环境使用）
        httpsAgent: new https.Agent({ rejectUnauthorized: config.httpsAgent?.rejectUnauthorized ?? true }),
        ...config
    });
};

/**
 * 判断错误是否属于"重试也没用"的确定性失败。
 *
 * 4xx 表示请求本身有问题（用户不存在 404、被风控 403、参数错误 400），
 * 重试只会把一次快速失败拖成几十秒的等待，在云平台上直接触发网关超时，
 * 让用户看到"服务挂了"而不是"这个用户名不存在"。
 */
const isNonRetryable = (error: any): boolean => {
    const status = error?.response?.status;
    return typeof status === 'number' && status >= 400 && status < 500;
};

// 创建带有重试机制的请求函数
export const createRequestWithRetry = async (
    requestFn: () => Promise<any>,
    maxRetries = 2,
    delay = 1000
): Promise<any> => {
    let lastError: any;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await requestFn();
        } catch (error: any) {
            lastError = error;

            // 确定性失败立即抛出，不浪费时间重试
            if (isNonRetryable(error)) {
                secureLogger.warn(`请求返回 ${error.response.status}，属于确定性失败，不再重试: ${error.message}`);
                throw error;
            }

            secureLogger.warn(`请求失败，尝试重试 (${attempt + 1}/${maxRetries}): ${error.message}`);

            // 如果不是最后一次尝试，则等待一段时间后重试
            if (attempt < maxRetries - 1) {
                // 指数退避策略，每次失败后等待时间增加
                const waitTime = delay * Math.pow(2, attempt);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }
        }
    }

    throw lastError;
};
