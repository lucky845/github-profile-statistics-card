import getJuejinInfo from '../services/juejin.service';
import { secureLogger } from '../utils/logger';

async function testJuejinParallelRequests() {
    try {
        const startTime = Date.now();
        secureLogger.info('开始测试掘金并行请求');
        const userId = '2564503943252237'; // 替换为你的掘金用户ID
        const cacheTimeInSeconds = 0; // 强制刷新缓存
        
        const result = await getJuejinInfo(userId, cacheTimeInSeconds);
        
        secureLogger.info('请求结果:', JSON.stringify(result, null, 2));
        const endTime = Date.now();
        secureLogger.info(`测试掘金并行请求耗时: ${endTime - startTime}ms`);
    } catch (error) {
        secureLogger.error('测试失败:', error);
    }
}

testJuejinParallelRequests();