// Redis连接稳定性测试
// 测试修复后的Socket closed unexpectedly错误

import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 在环境变量加载后再导入cacheService
import { cacheService } from '../services/cache.service';
import { secureLogger } from '../utils/logger';

/**
 * 模拟长时间运行的Redis连接测试
 * 测试修复后的Socket closed unexpectedly错误
 */
async function testRedisConnectionStability() {
  console.log('Starting Redis Connection Stability Test...');
  console.log('This test will run for 10 minutes, simulating long-running service behavior.');
  console.log('Testing fix for: "Socket closed unexpectedly" error\n');
  
  try {
    // 设置日志级别为debug，查看详细的Redis连接信息
    // secureLogger.setLogLevel('debug');
    
    // 测试开始时间
    const startTime = Date.now();
    const endTime = startTime + 10 * 60 * 1000; // 10分钟
    let testIterations = 0;
    let errorCount = 0;
    
    console.log(`[${new Date().toISOString()}] Test started`);
    console.log(`[${new Date().toISOString()}] Environment: REDIS_HOST=${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);
    
    // 初始连接测试
    console.log(`[${new Date().toISOString()}] Testing initial connection...`);
    const initialSetResult = await cacheService.set('stability_test_initial', { message: 'Initial test', timestamp: Date.now() }, 60);
    console.log(`[${new Date().toISOString()}] Initial set result: ${initialSetResult}`);
    
    const initialGetResult = await cacheService.get<{ message: string; timestamp: number }>('stability_test_initial');
    console.log(`[${new Date().toISOString()}] Initial get result: ${JSON.stringify(initialGetResult)}`);
    
    // 长时间运行测试循环
    while (Date.now() < endTime) {
      try {
        // 每30秒执行一次操作
        await new Promise(resolve => setTimeout(resolve, 30000));
        
        const currentTime = Date.now();
        const elapsedMinutes = ((currentTime - startTime) / 1000 / 60).toFixed(1);
        
        console.log(`\n[${new Date().toISOString()}] Test iteration (${elapsedMinutes} minutes elapsed)`);
        
        // 测试基本的set/get操作
        const testKey = `stability_test_${Date.now()}`;
        const testValue = { 
          message: `Stability test at ${new Date().toISOString()}`,
          timestamp: Date.now(),
          iteration: testIterations + 1
        };
        
        console.log(`[${new Date().toISOString()}] Setting key: ${testKey}`);
        const setResult = await cacheService.set(testKey, testValue, 60);
        console.log(`[${new Date().toISOString()}] Set result: ${setResult}`);
        
        console.log(`[${new Date().toISOString()}] Getting key: ${testKey}`);
        const getResult = await cacheService.get<typeof testValue>(testKey);
        console.log(`[${new Date().toISOString()}] Get result: ${JSON.stringify(getResult)}`);
        
        // 测试删除操作
        console.log(`[${new Date().toISOString()}] Deleting key: ${testKey}`);
        const deleteResult = await cacheService.delete(testKey);
        console.log(`[${new Date().toISOString()}] Delete result: ${deleteResult}`);
        
        // 测试缓存统计
        const stats = cacheService.getStats();
        console.log(`[${new Date().toISOString()}] Cache stats: hits=${stats.hits}, misses=${stats.misses}, hit rate=${stats.hitsRate.toFixed(1)}%`);
        
      } catch (error) {
        errorCount++;
        console.error(`\n[${new Date().toISOString()}] ERROR during test iteration:`, error);
        console.error(`[${new Date().toISOString()}] Error count: ${errorCount}`);
        
        // 如果出现Socket closed unexpectedly错误，记录详细信息
        if ((error as Error).message.includes('Socket closed unexpectedly')) {
          console.error('❌ FAILED: "Socket closed unexpectedly" error still occurring!');
          console.error('Details:', error);
          return;
        }
        
        // 继续测试，不中断
      }
    }
    
    // 测试结束
    const totalTime = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`\n\n[${new Date().toISOString()}] Test completed successfully!`);
    console.log(`Total duration: ${totalTime} minutes`);
    console.log(`Total errors encountered: ${errorCount}`);
    
    if (errorCount === 0) {
      console.log('✅ SUCCESS: No "Socket closed unexpectedly" errors occurred during the test!');
    } else {
      console.log('⚠️  WARNING: Some errors occurred, but no "Socket closed unexpectedly" errors.');
      console.log('Please check the error logs above for details.');
    }
    
  } catch (error) {
    console.error('\n❌ Test initialization failed:', error);
  } finally {
    // 关闭Redis连接
    try {
      await cacheService.close();
      console.log('✅ Redis connection closed after test');
    } catch (error) {
      console.error('❌ Error closing Redis connection after test:', error);
    }
  }
}

// 运行测试
testRedisConnectionStability().catch(console.error);
