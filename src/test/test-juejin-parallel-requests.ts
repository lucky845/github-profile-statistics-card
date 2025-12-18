import getJuejinInfo from '../services/juejin.service';

async function testJuejinParallelRequests() {
    try {
        console.time('测试掘金并行请求耗时');
        const userId = '2564503943252237'; // 替换为你的掘金用户ID
        const cacheTimeInSeconds = 0; // 强制刷新缓存
        
        const result = await getJuejinInfo(userId, cacheTimeInSeconds);
        
        console.log('请求结果:', JSON.stringify(result, null, 2));
        console.timeEnd('测试掘金并行请求耗时');
    } catch (error) {
        console.error('测试失败:', error);
    }
}

testJuejinParallelRequests();