# GitHub Profile Statistics Card

一个优雅的个人统计数据展示卡片生成服务，支持多个平台的数据统计展示。

## 🌟 特性

- 支持多个平台数据统计
  - GitHub 统计数据
  - LeetCode 刷题数据
  - CSDN 博客数据
  - 更多平台持续添加中...
- 自定义主题支持
  - 明亮主题
  - 暗黑主题
- 实时数据更新
- 简单易用的API
- 响应式设计
- 缓存优化

## 🚀 使用方法

### GitHub 统计卡片

```markdown
![GitHub Stats](https://github-profile-views-plum.vercel.app/github/username?theme=light)
```

### LeetCode 统计卡片

```markdown
![LeetCode Stats](https://github-profile-views-plum.vercel.app/leetcode/username?theme=dark)
```

支持参数：
- `username`: LeetCode 用户名
- `theme`: 主题选择（可选，默认为 light）
- `cn`: 是否获取中国区数据（可选，默认为 false）
  - `cn=true`: 获取 leetcode-cn.com 的数据
  - 不携带该参数: 获取 leetcode.com 的数据
- `cacheSeconds`: 配置缓存的秒数(默认120秒)

示例：
```markdown
# 获取 LeetCode 中国区数据
![LeetCode CN Stats](https://github-profile-views-plum.vercel.app/leetcode/username?theme=dark&cn=true)

# 获取 LeetCode 美国区数据
![LeetCode Stats](https://github-profile-views-plum.vercel.app/api/leetcode/username?theme=dark)
```

### CSDN 统计卡片

```markdown
![CSDN Stats](https://github-profile-views-plum.vercel.app/csdn/userId?theme=light)
```

CSDN 统计卡片包含以下数据：
- 文章数量
- 粉丝数
- 点赞数
- 浏览量
- 评论数
- 积分
- ...

## 🎨 主题配置

支持以下主题参数：
- `cacheSeconds`: 配置缓存的秒数(默认120秒)
- `theme=light` - 明亮主题（默认）
- `theme=dark` - 暗黑主题
- `theme=merko` - Merko 主题
- `theme=gruvbox` - Gruvbox 主题
- `theme=gruvbox_light` - Gruvbox Light 主题
- `theme=tokyonight` - Tokyo Night 主题
- `theme=onedark` - One Dark 主题

主题预览：

### Light（默认）
```markdown
![GitHub Stats](https://github-profile-views-plum.vercel.app/github/username?theme=light)
```

### Dark
```markdown
![GitHub Stats](https://github-profile-views-plum.vercel.app/github/username?theme=dark)
```

### Merko
```markdown
![GitHub Stats](https://github-profile-views-plum.vercel.app/github/username?theme=merko)
```

### Gruvbox
```markdown
![GitHub Stats](https://github-profile-views-plum.vercel.app/github/username?theme=gruvbox)
```

### Gruvbox Light
```markdown
![GitHub Stats](https://github-profile-views-plum.vercel.app/github/username?theme=gruvbox_light)
```

### Tokyo Night
```markdown
![GitHub Stats](https://github-profile-views-plum.vercel.app/github/username?theme=tokyonight)
```

### One Dark
```markdown
![GitHub Stats](https://github-profile-views-plum.vercel.app/github/username?theme=onedark)
```

## 🔜 即将支持的平台

- Bilibili
- 掘金
- ...更多平台开发中

## 🛠️ 技术栈

- Node.js
- Express
- TypeScript
- MongoDB
- EJS 模板引擎

## 📝 开源协议

[Apache 2.0 许可证](LICENSE)

## 🚀 部署指南

### 准备工作

1. Fork 本项目到你的 GitHub 账户
2. 注册 [MongoDB Atlas](https://cloud.mongodb.com/) 账户
3. 注册 [Vercel](https://vercel.com/) 账户

### MongoDB Atlas 配置

1. 登录 MongoDB Atlas
2. 创建新的数据库集群（可以选择免费的共享集群）
3. 在 "Database Access" 中创建数据库用户
4. 在 "Network Access" 中添加 IP 访问权限（可以设置为允许所有 IP：0.0.0.0/0）
5. 获取数据库连接字符串（格式如：`mongodb+srv://<username>:<password>@cluster0.xxxxx.mongodb.net/`)

### Vercel 部署

1. 在 Vercel 中导入你 fork 的项目
2. 配置环境变量：
   - `MONGODB_URI`: MongoDB Atlas 的连接字符串
3. 点击 "Deploy" 开始部署

部署完成后，你可以通过 Vercel 分配的域名访问服务，格式如：
```markdown
![GitHub Stats](https://your-vercel-domain.vercel.app/api/github?username=your-username&theme=light)
```

## 🤝 参与贡献

我们非常欢迎各种形式的贡献！以下是一些参与项目的方式：

### 贡献步骤

1. Fork 本项目
2. 创建你的特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交你的改动 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 发起 Pull Request

### 贡献类型

- 🐛 提交 bug 修复
- ✨ 添加新功能
- 📝 改进文档
- 🎨 优化界面
- 🔧 改进配置
- 🌐 添加新的平台支持

### 开发指南

1. 克隆项目到本地：
```bash
git clone https://github.com/your-username/github-profile-statistics-card.git
cd github-profile-statistics-card
```

2. 安装依赖：
```bash
npm install
```

3. 创建 `.env` 文件并设置环境变量：
```
MONGODB_URI=your_mongodb_uri
```

4. 启动开发服务器：
```bash
npm run dev
```

### 提交规范

提交信息请遵循以下格式：
- `feat`: 新功能
- `fix`: 修复问题
- `docs`: 文档修改
- `style`: 代码格式修改
- `refactor`: 代码重构
- `test`: 测试用例修改
- `chore`: 其他修改

例如：`feat: 添加 bilibili 数据统计支持`

## 📬 联系方式

如有问题或建议，欢迎通过以下方式联系：

- 提交 Issue
- 发送邮件至：[1447545564@qq.com]

---

如果这个项目对你有帮助，请给个 Star ⭐️ 
