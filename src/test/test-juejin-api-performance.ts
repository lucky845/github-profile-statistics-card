import { createRequest, createRequestWithRetry } from '../utils/http.utils';

// 测试并行请求性能
async function testParallelRequests() {
    try {
        console.time('并行请求耗时');
        
        const userId = '2564503943252237';
        const request = createRequest(10000);
        
        // 并行执行两个请求
        const [userResponse, articlesResponse] = await Promise.all([
            // 获取用户基本信息
            createRequestWithRetry(() => request.get(
                `https://api.juejin.cn/user_api/v1/user/get?user_id=${userId}`
            ), 3, 1000),
            // 获取文章列表
            createRequestWithRetry(() => request.post(
                'https://api.juejin.cn/content_api/v1/article/query_list',
                {
                    user_id: userId,
                    cursor: "0",
                    sort_type: 2,
                    limit: 20
                }
            ), 3, 1000)
        ]);
        
        console.log('用户信息请求状态:', userResponse.status);
        console.log('文章列表请求状态:', articlesResponse.status);
        console.log('用户信息:', userResponse.data.data.user_name);
        console.log('文章数量:', articlesResponse.data.count || 0);
        
        console.timeEnd('并行请求耗时');
    } catch (error) {
        console.error('并行请求失败:', error);
    }
}

// 测试串行请求性能
async function testSequentialRequests() {
    try {
        console.time('串行请求耗时');
        
        const userId = '2564503943252237';
        const request = createRequest(10000);
        
        // 串行执行两个请求
        const userResponse = await createRequestWithRetry(() => request.get(
            `https://api.juejin.cn/user_api/v1/user/get?user_id=${userId}`
        ), 3, 1000);
        
        const articlesResponse = await createRequestWithRetry(() => request.post(
            'https://api.juejin.cn/content_api/v1/article/query_list',
            {
                user_id: userId,
                cursor: "0",
                sort_type: 2,
                limit: 20
            }
        ), 3, 1000);
        
        console.log('用户信息请求状态:', userResponse.status);
        console.log('文章列表请求状态:', articlesResponse.status);
        console.log('用户信息:', userResponse.data.data.user_name);
        console.log('文章数量:', articlesResponse.data.count || 0);
        
        console.timeEnd('串行请求耗时');
    } catch (error) {
        console.error('串行请求失败:', error);
    }
}

// 运行测试
async function runTests() {
    console.log('=== 测试开始 ===');
    
    await testParallelRequests();
    console.log('\n' + '='.repeat(50) + '\n');
    await testSequentialRequests();
    
    console.log('\n=== 测试结束 ===');
}

runTests();