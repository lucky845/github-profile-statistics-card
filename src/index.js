const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// 优化MongoDB连接
const connectDB = async () => {
  try {
    // 检查是否有MongoDB URI
    if (!process.env.MONGODB_URI) {
      console.error('MongoDB URI 未设置，使用内存模式');
      return false;
    }
    
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 10000, // 增加超时时间到10秒
      socketTimeoutMS: 45000, // 增加socket超时
    });
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    return true;
  } catch (error) {
    console.error(`MongoDB Connection Error: ${error.message}`);
    return false;
  }
};

// 更新访问统计模型，添加唯一访问者记录
const Visit = mongoose.model('Visit', {
  username: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 },
  uniqueVisitors: { type: Number, default: 0 },
  visitors: { type: [String], default: [] } // 存储访问者的唯一标识
});

// 内存中的访问计数（作为MongoDB不可用时的备用）
const memoryVisits = {};
const memoryVisitors = {};

// 生成访问者唯一标识
const generateVisitorId = (req) => {
  const userAgent = req.headers['user-agent'] || '';
  const ip = req.headers['x-forwarded-for'] || 
             req.connection.remoteAddress || 
             req.socket.remoteAddress || 
             req.connection.socket.remoteAddress || '';
  
  // 使用用户代理和IP创建哈希
  const data = userAgent + ip;
  return crypto.createHash('md5').update(data).digest('hex');
};

// 添加健康检查路由
app.get('/health', async (req, res) => {
  try {
    // 检查MongoDB连接
    if (mongoose.connection.readyState !== 1) {
      const connected = await connectDB();
      if (!connected) {
        return res.status(200).send('Running in memory mode');
      }
    }
    res.status(200).send('Connected to MongoDB');
  } catch (error) {
    console.error('Health check failed:', error);
    res.status(200).send('Running with errors');
  }
});

// 设置SVG内容类型
app.get('/:username', async (req, res) => {
  const { username } = req.params;
  const theme = req.query.theme || 'light';
  const showUniqueVisitors = req.query.unique === 'true';
  let count = 0;
  let uniqueVisitors = 0;
  let usingMemory = false;
  
  try {
    // 生成访问者ID
    const visitorId = generateVisitorId(req);
    
    // 尝试连接数据库
    if (mongoose.connection.readyState !== 1) {
      const connected = await connectDB();
      if (!connected) {
        // 如果无法连接到数据库，使用内存模式
        usingMemory = true;
        
        // 初始化内存数据
        if (!memoryVisits[username]) {
          memoryVisits[username] = 0;
          memoryVisitors[username] = new Set();
        }
        
        // 更新访问计数
        memoryVisits[username]++;
        memoryVisitors[username].add(visitorId);
        
        count = memoryVisits[username];
        uniqueVisitors = memoryVisitors[username].size;
        
        console.log(`使用内存模式，用户 ${username} 的访问计数: ${count}, 唯一访问者: ${uniqueVisitors}`);
      }
    }
    
    // 如果连接到了数据库，使用MongoDB
    if (!usingMemory) {
      // 查找当前记录
      let visit = await Visit.findOne({ username });
      
      if (!visit) {
        // 如果记录不存在，创建新记录
        visit = new Visit({
          username,
          count: 1,
          uniqueVisitors: 1,
          visitors: [visitorId]
        });
        await visit.save();
      } else {
        // 更新访问计数
        visit.count += 1;
        
        // 检查是否是新访问者
        if (!visit.visitors.includes(visitorId)) {
          visit.visitors.push(visitorId);
          visit.uniqueVisitors += 1;
        }
        
        await visit.save();
      }
      
      count = visit.count;
      uniqueVisitors = visit.uniqueVisitors;
    }

    // 设置SVG颜色
    const colors = {
      light: {
        bg: '#F1F1F1',
        text: '#000000',
        border: '#E4E2E2'
      },
      dark: {
        bg: '#2D333B',
        text: '#FFFFFF',
        border: '#444C56'
      }
    };
    
    const color = colors[theme] || colors.light;
    
    // 生成SVG，根据查询参数决定显示总访问次数还是唯一访问者数量
    const displayCount = showUniqueVisitors ? uniqueVisitors : count;
    const countLabel = showUniqueVisitors ? 'Unique Visitors' : 'Total Views';
    
    const svg = `
    <svg width="220" height="100" xmlns="http://www.w3.org/2000/svg">
      <rect width="220" height="100" fill="${color.bg}" rx="10" ry="10" stroke="${color.border}" stroke-width="1"/>
      <text x="15" y="35" font-family="Arial" font-size="16" fill="${color.text}">GitHub ${countLabel}</text>
      <text x="15" y="65" font-family="Arial" font-size="24" font-weight="bold" fill="${color.text}">${displayCount}</text>
      <text x="15" y="85" font-family="Arial" font-size="12" fill="${color.text}">User: ${username}</text>
    </svg>
    `;
    
    // 设置响应头
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(svg);
  } catch (error) {
    console.error('Error generating profile view:', error);
    
    // 返回一个错误SVG而不是500错误
    const errorSvg = `
    <svg width="220" height="100" xmlns="http://www.w3.org/2000/svg">
      <rect width="220" height="100" fill="#FFDDDD" rx="10" ry="10" stroke="#FF0000" stroke-width="1"/>
      <text x="15" y="35" font-family="Arial" font-size="16" fill="#FF0000">GitHub Profile Views</text>
      <text x="15" y="65" font-family="Arial" font-size="12" fill="#FF0000">Error: ${error.message}</text>
      <text x="15" y="85" font-family="Arial" font-size="12" fill="#FF0000">User: ${username}</text>
    </svg>
    `;
    
    res.setHeader('Content-Type', 'image/svg+xml');
    res.send(errorSvg);
  }
});

// 启动服务器
if (process.env.NODE_ENV !== 'production') {
  // 本地开发环境下连接数据库并启动服务器
  connectDB().then((connected) => {
    if (!connected) {
      console.log('警告: 使用内存模式运行，数据将不会被永久保存');
    }
    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
    });
  });
} else {
  // 生产环境下，Vercel会自动处理请求
  connectDB().then((connected) => {
    if (!connected) {
      console.log('警告: 生产环境使用内存模式运行，数据将不会被永久保存');
    }
  });
}

module.exports = app;