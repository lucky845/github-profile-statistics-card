// 测试主应用程序中的Redis连接
import dotenv from 'dotenv';

// 加载环境变量
dotenv.config();

// 在环境变量加载后再导入cacheService
import { cacheService } from '../services/cache.service';

async function testAppRedisConnection() {
  console.log('Testing Redis Connection in Main App Context...');
  
  try {
    console.log(`Environment variables:`);
    console.log(`  REDIS_HOST: ${process.env.REDIS_HOST}`);
    console.log(`  REDIS_PORT: ${process.env.REDIS_PORT}`);
    console.log(`  REDIS_USERNAME: ${process.env.REDIS_USERNAME}`);
    console.log(`  REDIS_PASSWORD: ${process.env.REDIS_PASSWORD ? '[SET]' : '[NOT SET]'}`);
    
    console.log(`Connecting to Redis at ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);
    
    // 测试设置值
    console.log('Testing SET operation...');
    const setResult = await cacheService.set('app_test_key', { message: 'Hello from App!', timestamp: Date.now() }, 60);
    console.log('Set result:', setResult);
    
    // 测试获取值
    console.log('Testing GET operation...');
    const getResult = await cacheService.get<{ message: string; timestamp: number }>('app_test_key');
    console.log('Get result:', getResult);
    
    // 测试删除值
    console.log('Testing DELETE operation...');
    const deleteResult = await cacheService.delete('app_test_key');
    console.log('Delete result:', deleteResult);
    
    console.log('App Redis Connection test completed successfully!');
  } catch (error) {
    console.error('App Redis Connection test failed:', error);
  }
}

// 运行测试
testAppRedisConnection().catch(console.error);