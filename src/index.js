const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const port = process.env.PORT || 3000;

// 连接MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('Connected to MongoDB');
}).catch(err => {
  console.error('MongoDB connection error:', err);
});

// 创建访问统计模型
const Visit = mongoose.model('Visit', {
  username: { type: String, required: true, unique: true },
  count: { type: Number, default: 0 }
});

// 设置SVG内容类型
app.get('/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const theme = req.query.theme || 'light';
    
    // 更新访问计数
    const visit = await Visit.findOneAndUpdate(
      { username },
      { $inc: { count: 1 } },
      { upsert: true, new: true }
    );

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
    
    // 生成SVG
    const svg = `
    <svg width="220" height="100" xmlns="http://www.w3.org/2000/svg">
      <rect width="220" height="100" fill="${color.bg}" rx="10" ry="10" stroke="${color.border}" stroke-width="1"/>
      <text x="15" y="35" font-family="Arial" font-size="16" fill="${color.text}">GitHub Profile Views</text>
      <text x="15" y="65" font-family="Arial" font-size="24" font-weight="bold" fill="${color.text}">${visit.count}</text>
      <text x="15" y="85" font-family="Arial" font-size="12" fill="${color.text}">User: ${username}</text>
    </svg>
    `;
    
    // 设置响应头
    res.setHeader('Content-Type', 'image/svg+xml');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(svg);
  } catch (error) {
    console.error(error);
    res.status(500).send('Server Error');
  }
});

// 启动服务器
if (process.env.NODE_ENV !== 'production') {
  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

module.exports = app;