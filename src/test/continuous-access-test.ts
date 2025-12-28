import axios from 'axios';

async function continuousAccessTest() {
  console.log('开始连续访问测试...');
  
  // 测试100次访问
  for (let i = 0; i < 100; i++) {
    try {
      // 访问Bilibili服务
      const bilibiliResponse = await axios.get('http://localhost:3000/bilibili/292074455', {
        timeout: 10000
      });
      console.log(`[${new Date().toISOString()}] Bilibili访问 ${i + 1}: ${bilibiliResponse.status}`);
      
      // 访问缓存统计
      const cacheResponse = await axios.get('http://localhost:3000/api/cache/stats', {
        timeout: 5000
      });
      console.log(`[${new Date().toISOString()}] 缓存统计 ${i + 1}: ${cacheResponse.status}`);
      
      // 等待1秒
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error: any) {
      console.error(`[${new Date().toISOString()}] 访问错误 ${i + 1}:`, error.message || error);
    }
  }
  
  console.log('连续访问测试完成');
}

continuousAccessTest().catch(console.error);