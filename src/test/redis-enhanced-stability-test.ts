// 加载环境变量
import dotenv from 'dotenv';
dotenv.config();

import { createClientPool } from 'redis';
import { secureLogger } from '../utils/logger';

async function testEnhancedRedisStability() {
  console.log('Testing enhanced Redis connection stability...');
  console.log('Redis Config:', {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD ? '[REDACTED]' : 'undefined'
  });

  try {
    // 创建Redis连接池
    const client = createClientPool({
      username: process.env.REDIS_USERNAME || 'default',
      password: process.env.REDIS_PASSWORD,
      socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        reconnectStrategy: (retries: number) => {
          console.log(`[Reconnect Strategy] Attempt ${retries}`);
          // 重连策略：最多重试20次，每次间隔增加
          if (retries > 20) {
            console.error('❌ Redis重连次数超过限制');
            return new Error('Retry time exhausted');
          }
          // 渐进式延迟重连
          const delay = Math.min(retries * 1000, 10000);
          console.log(`[Reconnect Strategy] Waiting ${delay}ms before reconnect`);
          return delay;
        },
        connectTimeout: 10000, // 10秒连接超时
      }
    }, {
      minimum: 1,
      maximum: 10,
      acquireTimeout: 5000,
      cleanupDelay: 3000
    });

    console.log('Attempting to connect to Redis...');
    await client.connect();
    console.log('✅ Redis connected successfully!');

    // 模拟长时间运行的应用程序
    console.log('Starting enhanced stability test for 10 minutes...');
    const endTime = Date.now() + 10 * 60 * 1000; // 10分钟
    
    let counter = 0;
    let errorCount = 0;
    
    while (Date.now() < endTime) {
      try {
        // 每5秒执行一次操作
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        // 测试ping命令
        const pingResult = await client.execute(client => client.ping());
        console.log(`[${new Date().toISOString()}] Ping result: ${pingResult}`);
        
        // 测试set/get命令
        const testKey = `enhanced_stability_test_${counter}`;
        await client.execute(client => client.set(testKey, `test_value_${counter}`));
        const getResult = await client.execute(client => client.get(testKey));
        console.log(`[${new Date().toISOString()}] Set/Get test ${counter}: ${getResult}`);
        
        counter++;
      } catch (error) {
        errorCount++;
        console.error(`[${new Date().toISOString()}] Operation failed (${errorCount} errors so far):`, error);
        
        // 如果错误太多，提前退出
        if (errorCount > 10) {
          console.error('Too many errors, stopping test');
          break;
        }
      }
    }
    
    console.log(`Test completed. Total operations: ${counter}, Errors: ${errorCount}`);
    
    // 关闭连接
    await client.close();
    console.log('✅ Redis connection closed');

  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    secureLogger.error('❌ Redis connection test failed:', error);
  }
}

testEnhancedRedisStability().catch(console.error);