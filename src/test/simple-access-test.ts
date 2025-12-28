import axios from 'axios';

async function simpleAccessTest() {
  console.log('开始简单访问测试...');
  
  try {
    // 访问Bilibili服务
    const bilibiliResponse = await axios.get('http://localhost:3000/bilibili/292074455', {
      timeout: 10000
    });
    console.log(`Bilibili访问状态: ${bilibiliResponse.status}`);
    console.log(`响应大小: ${bilibiliResponse.data.length} 字符`);
    
    // 等待2秒
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // 再次访问
    const bilibiliResponse2 = await axios.get('http://localhost:3000/bilibili/292074455', {
      timeout: 10000
    });
    console.log(`第二次Bilibili访问状态: ${bilibiliResponse2.status}`);
    console.log(`响应大小: ${bilibiliResponse2.data.length} 字符`);
    
    // 访问缓存统计
    const cacheResponse = await axios.get('http://localhost:3000/api/cache/stats', {
      timeout: 5000
    });
    console.log(`缓存统计状态: ${cacheResponse.status}`);
    console.log(`缓存数据:`, cacheResponse.data);
    
    console.log('简单访问测试完成');
  } catch (error: any) {
    console.error('访问错误:', error.message || error);
  }
}

simpleAccessTest().catch(console.error);