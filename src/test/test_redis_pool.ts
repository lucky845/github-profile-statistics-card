import { CacheServiceFactory, CacheStrategy, cacheService } from '../services/cache.service';

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testRedisConnectionPool() {
  console.log('Testing Redis Connection Pool...');
  
  try {
    // 等待一段时间确保连接建立
    console.log('Waiting for Redis connection to establish...');
    await sleep(2000);
    
    // 测试设置值
    console.log('Testing SET operation...');
    const setResult = await cacheService.set('test_key', { message: 'Hello Redis Pool!', timestamp: Date.now() }, 60);
    console.log('Set result:', setResult);
    
    // 测试获取值
    console.log('Testing GET operation...');
    const getResult = await cacheService.get<{ message: string; timestamp: number }>('test_key');
    console.log('Get result:', getResult);
    
    // 测试删除值
    console.log('Testing DELETE operation...');
    const deleteResult = await cacheService.delete('test_key');
    console.log('Delete result:', deleteResult);
    
    // 测试并发连接
    console.log('Testing concurrent connections...');
    const promises = [];
    for (let i = 0; i < 5; i++) {
      promises.push(cacheService.set(`concurrent_test_${i}`, { index: i, timestamp: Date.now() }, 60));
    }
    
    const results = await Promise.all(promises);
    console.log(`Concurrent set operations completed. Success: ${results.filter(r => r).length}/${results.length}`);
    
    console.log('Redis Connection Pool test completed successfully!');
  } catch (error) {
    console.error('Redis Connection Pool test failed:', error);
  }
}

// 运行测试
testRedisConnectionPool().catch(console.error);