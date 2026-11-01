// 加载环境变量
import dotenv from 'dotenv';
dotenv.config();

import { createClientPool } from 'redis';
import { secureLogger } from '../utils/logger';

async function testRedisConnection() {
  console.log('Testing Redis connection...');
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
        port: parseInt(process.env.REDIS_PORT || '6379')
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
    
    // 测试ping命令
    const pingResult = await client.execute(client => client.ping());
    console.log('Ping result:', pingResult);
    
    // 测试set命令
    await client.execute(client => client.set('test_key', 'test_value'));
    console.log('Set command executed');
    
    // 测试get命令
    const getResult = await client.execute(client => client.get('test_key'));
    console.log('Get result:', getResult);
    
    // 关闭连接
    await client.close();
    console.log('✅ Redis connection closed');
    
  } catch (error) {
    console.error('❌ Redis connection failed:', error);
    secureLogger.error('❌ Redis connection test failed:', error);
  }
}

testRedisConnection().catch(console.error);