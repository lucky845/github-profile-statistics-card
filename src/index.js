const express = require('express');
const mongoose = require('mongoose');
const crypto = require('crypto');
const axios = require('axios');
const path = require('path');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// 设置静态文件目录
app.use(express.static(path.join(__dirname, 'public')));
app.use('/styles', express.static(path.join(__dirname, 'styles.css')));

// 设置视图引擎
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

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
    // 添加请求头以减少GitHub API限制
    const response = await axios.get(`https://api.github.com/users/${username}`, {
      headers: {
        'User-Agent': 'GitHub-Profile-Views-Counter',
        'Accept': 'application/vnd.github.v3+json',
        'If-None-Match': '' // 避免304缓存响应
      },
      timeout: 5000, // 设置超时时间为5秒
      validateStatus: status => status < 500 // 只对500以上错误抛出异常
    });
    
    if (response.status === 200 && response.data && response.data.avatar_url) {
      return response.data.avatar_url;
    } else {
      console.warn(`获取GitHub头像异常状态码: ${response.status}`);
      return null;
    }
  } catch (error) {
    console.error(`获取GitHub头像失败: ${error.message}`);
    return null;
  }
}

// 设置根路径展示页面
app.get('/', (req, res) => {
  const baseUrl = `${req.protocol}://${req.get('host')}`;
  
  // 主题列表
  const themesList = [
    { name: 'rainbow', description: '彩虹渐变主题（默认）' },
    { name: 'github', description: 'GitHub风格暗色主题' },
    { name: 'blue', description: '蓝色渐变主题' },
    { name: 'purple', description: '紫色渐变主题' },
    { name: 'green', description: '绿色渐变主题' },
    { name: 'dark', description: '深色主题' },
    { name: 'light', description: '浅色主题' },
    { name: 'neon', description: '霓虹风格主题' },
    { name: 'sunset', description: '日落渐变主题' },
    { name: 'ocean', description: '海洋渐变主题' }
  ];
  
  // 渲染HTML页面
  res.send(`
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>GitHub Profile Views Counter</title>
      <link rel="stylesheet" href="/styles">
    </head>
    <body>
      <div class="container">
        <h1>GitHub Profile Views Counter</h1>
        <p>一个简单而美观的GitHub个人主页访问量统计工具，可以轻松集成到你的GitHub个人资料页面。</p>
        
        <h2>特点</h2>
        <ul class="features-list">
          <li>🌈 多种主题可选</li>
          <li>👁️ 同时显示总访问量和唯一访问者数量</li>
          <li>🏆 根据访问量自动评级（从D-到S+）</li>
          <li>🖼️ 显示用户GitHub头像</li>
          <li>🚀 易于部署到Vercel</li>
          <li>💾 MongoDB数据存储，支持内存模式作为备用</li>
        </ul>
        
        <h2>使用方法</h2>
        <p>只需在你的GitHub个人资料README.md中添加以下代码：</p>
        <div class="code-block">
          ![GitHub Profile Views](${baseUrl}/your-github-username)
        </div>
        
        <h3>自定义选项</h3>
        <p>你可以通过URL参数自定义显示效果：</p>
        <div class="code-block">
          ![GitHub Profile Views](${baseUrl}/your-github-username?theme=ocean)
        </div>
      </div>
      
      <div class="container">
        <h2>主题展示</h2>
        <p>以下是所有可用主题的展示效果：</p>
        
        <div class="theme-showcase">
          ${themesList.map(theme => `
            <div class="theme-card">
              <div class="theme-name">${theme.name}</div>
              <div class="theme-description">${theme.description}</div>
              <img src="${baseUrl}/lucky845?theme=${theme.name}" alt="${theme.name} theme" width="100%">
            </div>
          `).join('')}
        </div>
      </div>
      
      <div class="container">
        <h2>评分系统</h2>
        <p>访问量评分标准：</p>
        <ul>
          <li>D-: 少于100次访问</li>
          <li>D: 100-149次访问</li>
          <li>D+: 150-199次访问</li>
          <li>C-: 200-299次访问</li>
          <li>C: 300-399次访问</li>
          <li>C+: 400-599次访问</li>
          <li>B-: 600-799次访问</li>
          <li>B: 800-999次访问</li>
          <li>B+: 1000-1499次访问</li>
          <li>A-: 1500-1999次访问</li>
          <li>A: 2000-2999次访问</li>
          <li>A+: 3000-4999次访问</li>
          <li>S: 5000-9999次访问</li>
          <li>S+: 10000次及以上访问</li>
        </ul>
      </div>
      
      <div class="container">
        <h2>部署自己的实例</h2>
        <p>查看 <a href="https://github.com/lucky845/github-profile-views" target="_blank">GitHub仓库</a> 获取完整的部署指南。</p>
        <a href="https://github.com/lucky845/github-profile-views" class="btn">查看源代码</a>
      </div>
      
      <div class="footer">
        <p>© ${new Date().getFullYear()} GitHub Profile Views Counter. 使用 Apache 2.0 许可证。</p>
      </div>
    </body>
    </html>
  `);
});

// 设置SVG内容类型
app.get('/:username', async (req, res) => {
  const { username } = req.params;
  const theme = req.query.theme || 'rainbow'; // 默认使用彩虹主题
  let count = 0;
  let uniqueVisitors = 0;
  let usingMemory = false;
  
  try {
    // 获取GitHub头像，如果获取失败则使用内置的GitHub logo SVG
    let avatarUrl;
    try {
      avatarUrl = await getGitHubAvatar(username);
      if (!avatarUrl) {
        throw new Error('获取头像失败');
      }
    } catch (avatarError) {
      console.log(`使用内置GitHub logo作为${username}的头像`);
      // 使用内联SVG而不是外部URL，避免依赖外部资源
      avatarUrl = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBmaWxsLXJ1bGU9ImV2ZW5vZGQiIGQ9Ik04IDBDMy41OCAwIDAgMy41OCAwIDhjMCAzLjU0IDIuMjkgNi41MyA1LjQ3IDcuNTkuNC4wNy41NS0uMTcuNTUtLjM4IDAtLjE5LS4wMS0uODItLjAxLTEuNDktMi4wMS4zNy0yLjUzLS40OS0yLjY5LS45NC0uMDktLjIzLS40OC0uOTQtLjgyLTEuMTMtLjI4LS4xNS0uNjgtLjUyLS4wMS0uNTMuNjMtLjAxIDEuMDguNTggMS4yMy44Mi43MiAxLjIxIDEuODcuODcgMi4zMy42Ni4wNy0uNTIuMjgtLjg3LjUxLTEuMDctMS43OC0uMi0zLjY0LS44OS0zLjY0LTMuOTUgMC0uODcuMzEtMS41OS44Mi0yLjE1LS4wOC0uMi0uMzYtMS4wMi4wOC0yLjEyIDAgMCAuNjctLjIxIDIuMi44Mi42NC0uMTggMS4zMi0uMjcgMi0uMjcuNjggMCAxLjM2LjA5IDIgLjI3IDEuNTMtMS4wNCAyLjItLjgyIDIuMi0uODIuNDQgMS4xLjE2IDEuOTIuMDggMi4xMi41MS41Ni44MiAxLjI3LjgyIDIuMTUgMCAzLjA3LTEuODcgMy43NS0zLjY1IDMuOTUuMjkuMjUuNTQuNzMuNTQgMS40OCAwIDEuMDctLjAxIDEuOTMtLjAxIDIuMiAwIC4yMS4xNS40Ni41NS4zOEE4LjAxMyA4LjAxMyAwIDAwMTYgOGMwLTQuNDItMy41OC04LTgtOHoiPjwvcGF0aD48L3N2Zz4=';
    }
    
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
      ${avatarUrl.startsWith('data:') 
        ? `<g transform="translate(25, 25) scale(0.5)" fill="${selectedTheme.accentColor}">
             <svg width="180" height="180" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
               <path fill-rule="evenodd" d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"></path>
             </svg>
           </g>`
        : `<image href="${avatarUrl}" x="25" y="25" height="90" width="90" clip-path="url(#avatarClip)" />`
      }
      
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