import dotenv from 'dotenv';
import { createClientPool } from 'redis';

// 加载环境变量
dotenv.config();

async function testRedisConnection() {
  console.log('Testing Redis Connection with Environment Variables...');
  
  try {
    console.log(`Environment variables:`);
    console.log(`  REDIS_HOST: ${process.env.REDIS_HOST}`);
    console.log(`  REDIS_PORT: ${process.env.REDIS_PORT}`);
    console.log(`  REDIS_USERNAME: ${process.env.REDIS_USERNAME}`);
    console.log(`  REDIS_PASSWORD: ${process.env.REDIS_PASSWORD ? '[SET]' : '[NOT SET]'}`);
    
    // 创建Redis连接池，使用环境变量中的配置
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
    
    console.log(`Connecting to Redis at ${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`);
    
    // 连接Redis
    await client.connect();
    console.log('✅ Redis connected successfully');
    
    // 测试设置值
    console.log('Testing SET operation...');
    await client.execute(c => c.set('test_key', 'Hello Redis!', { EX: 60 }));
    console.log('SET operation successful');
    
    // 测试获取值
    console.log('Testing GET operation...');
    const value = await client.execute(c => c.get('test_key'));
    console.log('GET operation result:', value);
    
    // 测试删除值
    console.log('Testing DEL operation...');
    const delResult = await client.execute(c => c.del('test_key'));
    console.log('DEL operation result:', delResult);
    
    // 关闭连接
    await client.close();
    console.log('Redis connection closed');
    
    console.log('Redis Connection test completed successfully!');
  } catch (error) {
    console.error('Redis Connection test failed:', error);
  }
}

// 运行测试
testRedisConnection().catch(console.error);