# GitHub Profile Views Counters

一个简单而美观的GitHub个人主页访问量统计工具，可以轻松集成到你的GitHub个人资料页面。

<p align="center">
  <img src="https://github-profile-views-plum.vercel.app/lucky845?theme=rainbow" alt="Profile Views Demo" width="650">
</p>

## 特点

- 🌈 多种主题可选
- 👁️ 同时显示总访问量和唯一访问者数量
- 🏆 根据访问量自动评级（从D-到S+）
- 🖼️ 显示用户GitHub头像
- 🚀 易于部署到Vercel
- 💾 MongoDB数据存储，支持内存模式作为备用

## 使用方法

只需在你的GitHub个人资料README.md中添加以下代码：

```markdown
![GitHub Profile Views](https://your-app-url.vercel.app/your-github-username)
```

### 自定义选项

你可以通过URL参数自定义显示效果：

#### 主题选择

```markdown
![GitHub Profile Views](https://your-app-url.vercel.app/your-github-username?theme=ocean)
```

## 主题展示

以下是所有可用主题的展示效果：

<details>
<summary>点击查看所有主题</summary>

### Rainbow 主题 (默认)
![Rainbow Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=rainbow)

### GitHub 主题
![GitHub Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=github)

### Blue 主题
![Blue Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=blue)

### Purple 主题
![Purple Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=purple)

### Green 主题
![Green Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=green)

### Dark 主题
![Dark Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=dark)

### Light 主题
![Light Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=light)

### Neon 主题
![Neon Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=neon)

### Sunset 主题
![Sunset Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=sunset)

### Ocean 主题
![Ocean Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=ocean)

</details>

### 可用主题列表

- `rainbow` （默认）- 彩虹渐变
- `github` - GitHub风格
- `blue` - 蓝色渐变
- `purple` - 紫色渐变
- `green` - 绿色渐变
- `dark` - 深色主题
- `light` - 浅色主题
- `neon` - 霓虹风格
- `sunset` - 日落渐变
- `ocean` - 海洋渐变

## 部署自己的实例

### 前提条件
- Node.js
- [MongoDB数据库](https://cloud.mongodb.com)（可选，没有也可以使用内存模式）
- [Vercel账户](https://vercel.com/)（用于部署）

### 部署步骤
1. Fork这个仓库
2. 克隆你fork的仓库到本地
3. 安装依赖：`npm install`
4. 创建 `.env` 文件并添加你的MongoDB连接字符串：
   ```
   MONGODB_URI=your_mongodb_connection_string
   ```
5. 本地测试：`npm start`
6. 部署到Vercel：
   - 导入你的GitHub仓库
   - 添加环境变量 `MONGODB_URI`
   - 部署！

<details>
<summary>详细部署指南</summary>

#### 本地开发

```bash
# 克隆仓库
git clone https://github.com/yourusername/github-profile-views.git
cd github-profile-views

# 安装依赖
npm install

# 创建.env文件
echo "MONGODB_URI=your_mongodb_connection_string" > .env

# 启动开发服务器
npm start
```

#### 部署到Vercel

1. 在[Vercel](https://vercel.com/)创建账户
2. 点击"New Project"按钮
3. 导入你的GitHub仓库
4. 在"Environment Variables"部分添加`MONGODB_URI`
5. 点击"Deploy"按钮

</details>

## 评分系统

访问量评分标准：

| 评分 | 访问量范围 |
|------|------------|
| D-   | 少于100次  |
| D    | 100-149次  |
| D+   | 150-199次  |
| C-   | 200-299次  |
| C    | 300-399次  |
| C+   | 400-599次  |
| B-   | 600-799次  |
| B    | 800-999次  |
| B+   | 1000-1499次|
| A-   | 1500-1999次|
| A    | 2000-2999次|
| A+   | 3000-4999次|
| S    | 5000-9999次|
| S+   | 10000次及以上|

## 许可证

本项目采用 Apache 2.0 许可证。详情请查看 [LICENSE](LICENSE) 文件。

## 贡献

欢迎提交问题和拉取请求！如果你想为这个项目做出贡献，请查看 [CONTRIBUTING.md](CONTRIBUTING.md) 文件。

## 致谢

感谢所有为这个项目做出贡献的开发者！