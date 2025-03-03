const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const axios = require('axios');
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

// 获取GitHub用户头像
async function getGitHubAvatar(username) {
  try {
    const response = await axios.get(`https://api.github.com/users/${username}`);
    return response.data.avatar_url;
  } catch (error) {
    console.error(`获取GitHub头像失败: ${error.message}`);
    return null;
  }
}

// 设置SVG内容类型
app.get('/:username', async (req, res) => {
  const { username } = req.params;
  const theme = req.query.theme || 'rainbow'; // 默认使用彩虹主题
  let count = 0;
  let uniqueVisitors = 0;
  let usingMemory = false;
  
  try {
    // 获取GitHub头像
    const avatarUrl = await getGitHubAvatar(username) || 'https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png';
    
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

    // 根据访问量确定评分
    let grade = 'D-';
    let progressPercent = 0;
    
    // 设置评分阈值
    if (count >= 10000) {
      grade = 'S+';
      progressPercent = 100;
    } else if (count >= 5000) {
      grade = 'S';
      progressPercent = 95;
    } else if (count >= 3000) {
      grade = 'A+';
      progressPercent = 90;
    } else if (count >= 2000) {
      grade = 'A';
      progressPercent = 85;
    } else if (count >= 1500) {
      grade = 'A-';
      progressPercent = 80;
    } else if (count >= 1000) {
      grade = 'B+';
      progressPercent = 75;
    } else if (count >= 800) {
      grade = 'B';
      progressPercent = 70;
    } else if (count >= 600) {
      grade = 'B-';
      progressPercent = 65;
    } else if (count >= 400) {
      grade = 'C+';
      progressPercent = 60;
    } else if (count >= 300) {
      grade = 'C';
      progressPercent = 55;
    } else if (count >= 200) {
      grade = 'C-';
      progressPercent = 50;
    } else if (count >= 150) {
      grade = 'D+';
      progressPercent = 45;
    } else if (count >= 100) {
      grade = 'D';
      progressPercent = 40;
    } else {
      grade = 'D-';
      progressPercent = 30;
    }
    
    // 定义主题样式
    const themes = {
      rainbow: {
        width: 650,
        height: 140,
        background: `
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#FF5252;stop-opacity:1" />
            <stop offset="20%" style="stop-color:#FF9800;stop-opacity:1" />
            <stop offset="40%" style="stop-color:#FFEB3B;stop-opacity:1" />
            <stop offset="60%" style="stop-color:#8BC34A;stop-opacity:1" />
            <stop offset="80%" style="stop-color:#4CAF50;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#69F0AE;stop-opacity:1" />
          </linearGradient>
        `,
        textColor: '#FFFFFF',
        accentColor: '#FFFFFF',
        overlayOpacity: 0.1
      },
      github: {
        width: 650,
        height: 140,
        background: `
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#2B3137;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#1B1F23;stop-opacity:1" />
          </linearGradient>
        `,
        textColor: '#FFFFFF',
        accentColor: '#58A6FF',
        overlayOpacity: 0.0
      },
      blue: {
        width: 650,
        height: 140,
        background: `
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#2196F3;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#0D47A1;stop-opacity:1" />
          </linearGradient>
        `,
        textColor: '#FFFFFF',
        accentColor: '#BBDEFB',
        overlayOpacity: 0.1
      },
      purple: {
        width: 650,
        height: 140,
        background: `
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#9C27B0;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#4A148C;stop-opacity:1" />
          </linearGradient>
        `,
        textColor: '#FFFFFF',
        accentColor: '#E1BEE7',
        overlayOpacity: 0.1
      },
      green: {
        width: 650,
        height: 140,
        background: `
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#4CAF50;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#1B5E20;stop-opacity:1" />
          </linearGradient>
        `,
        textColor: '#FFFFFF',
        accentColor: '#C8E6C9',
        overlayOpacity: 0.1
      },
      dark: {
        width: 650,
        height: 140,
        background: `
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#424242;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#212121;stop-opacity:1" />
          </linearGradient>
        `,
        textColor: '#FFFFFF',
        accentColor: '#BDBDBD',
        overlayOpacity: 0.0
      },
      light: {
        width: 650,
        height: 140,
        background: `
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#FAFAFA;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#F5F5F5;stop-opacity:1" />
          </linearGradient>
        `,
        textColor: '#212121',
        accentColor: '#757575',
        overlayOpacity: 0.0
      },
      neon: {
        width: 650,
        height: 140,
        background: `
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#000000;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#0D0D0D;stop-opacity:1" />
          </linearGradient>
        `,
        textColor: '#00FF41',
        accentColor: '#00FF41',
        overlayOpacity: 0.0
      },
      sunset: {
        width: 650,
        height: 140,
        background: `
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#FF512F;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#DD2476;stop-opacity:1" />
          </linearGradient>
        `,
        textColor: '#FFFFFF',
        accentColor: '#FFECB3',
        overlayOpacity: 0.1
      },
      ocean: {
        width: 650,
        height: 140,
        background: `
          <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" style="stop-color:#1A2980;stop-opacity:1" />
            <stop offset="100%" style="stop-color:#26D0CE;stop-opacity:1" />
          </linearGradient>
        `,
        textColor: '#FFFFFF',
        accentColor: '#B3E5FC',
        overlayOpacity: 0.1
      }
    };
    
    // 获取选择的主题，如果不存在则使用默认主题
    const selectedTheme = themes[theme] || themes.rainbow;
    
    // 计算圆弧路径
    const radius = 50;
    const centerX = selectedTheme.width - 100;
    const centerY = 70;
    const angleInRadians = (progressPercent / 100) * Math.PI * 2;
    const endX = centerX + radius * Math.sin(angleInRadians);
    const endY = centerY - radius * Math.cos(angleInRadians);
    const largeArcFlag = progressPercent > 50 ? 1 : 0;
    const arcPath = `M${centerX},${centerY - radius} A${radius},${radius} 0 ${largeArcFlag},1 ${endX},${endY}`;

    // 生成SVG
    const svg = `
    <svg width="${selectedTheme.width}" height="${selectedTheme.height}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
      <defs>
        ${selectedTheme.background}
        <filter id="shadow" x="-10%" y="-10%" width="120%" height="120%">
          <feDropShadow dx="0" dy="3" stdDeviation="5" flood-opacity="0.3" />
        </filter>
        <clipPath id="avatarClip">
          <circle cx="70" cy="70" r="45" />
        </clipPath>
      </defs>
      
      <!-- 背景 -->
      <rect width="${selectedTheme.width}" height="${selectedTheme.height}" rx="15" ry="15" fill="url(#bg)" filter="url(#shadow)" />
      
      <!-- 黑色半透明背景 -->
      <rect x="5" y="5" width="${selectedTheme.width - 10}" height="${selectedTheme.height - 10}" rx="12" ry="12" fill="#000000" fill-opacity="${selectedTheme.overlayOpacity}" />
      
      <!-- 用户头像 -->
      <circle cx="70" cy="70" r="45" fill="none" stroke="${selectedTheme.accentColor}" stroke-opacity="0.3" stroke-width="2" />
      <image href="${avatarUrl}" x="25" y="25" height="90" width="90" clip-path="url(#avatarClip)" />
      
      <!-- 统计信息 -->
      <g font-family="Arial, sans-serif" font-weight="bold">
        <!-- 总访问次数 -->
        <text x="150" y="50" font-size="22" fill="${selectedTheme.textColor}">Total Views:</text>
        <text x="350" y="50" font-size="22" fill="${selectedTheme.textColor}">${count}</text>
        
        <!-- 唯一访问者 -->
        <text x="150" y="90" font-size="22" fill="${selectedTheme.textColor}">Unique Visitors:</text>
        <text x="350" y="90" font-size="22" fill="${selectedTheme.textColor}">${uniqueVisitors}</text>
        
        <!-- 用户名 -->
        <text x="150" y="120" font-size="16" fill="${selectedTheme.textColor}">User: ${username}</text>
      </g>
      
      <!-- 右侧评分圆环 -->
      <circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="none" stroke="${selectedTheme.accentColor}" stroke-opacity="0.3" stroke-width="10" />
      <path d="${arcPath}" fill="none" stroke="${selectedTheme.accentColor}" stroke-width="10" />
      <text x="${centerX}" y="${centerY + 10}" font-family="Arial, sans-serif" font-size="36" font-weight="bold" fill="${selectedTheme.textColor}" text-anchor="middle">${grade}</text>
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
    <svg width="650" height="140" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="errorGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" style="stop-color:#FF5252;stop-opacity:1" />
          <stop offset="100%" style="stop-color:#FF1744;stop-opacity:1" />
        </linearGradient>
      </defs>
      <rect width="650" height="140" fill="url(#errorGradient)" rx="15" ry="15" />
      <text x="70" y="60" font-family="Arial, sans-serif" font-size="22" font-weight="bold" fill="#FFFFFF">GitHub Profile Views - Error</text>
      <text x="70" y="100" font-family="Arial, sans-serif" font-size="18" fill="#FFFFFF">Error: ${error.message}</text>
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