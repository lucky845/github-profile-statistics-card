# GitHub Profile Views Counter

A simple and beautiful GitHub profile views counter that can be easily integrated into your GitHub profile page.

<p align="center">
  <img src="https://github-profile-views-plum.vercel.app/lucky845?theme=rainbow" alt="Profile Views Demo" width="650">
</p>

## Features

- 🌈 Multiple themes available
- 👁️ Display both total views and unique visitors
- 🏆 Automatic rating based on view count (from D- to S+)
- 🖼️ Display user's GitHub avatar
- 🚀 Easy to deploy on Vercel
- 💾 MongoDB storage with memory mode as backup

## Usage

Simply add the following code to your GitHub profile README.md:

```markdown
![GitHub Profile Views](https://your-app-url.vercel.app/your-github-username)
```

### Customization Options

You can customize the display using URL parameters:

#### Theme Selection

```markdown
![GitHub Profile Views](https://your-app-url.vercel.app/your-github-username?theme=ocean)
```

## Theme Showcase

Here are all available themes:

<details>
<summary>Click to view all themes</summary>

### Rainbow Theme (Default)
![Rainbow Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=rainbow)

### GitHub Theme
![GitHub Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=github)

### Blue Theme
![Blue Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=blue)

### Purple Theme
![Purple Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=purple)

### Green Theme
![Green Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=green)

### Dark Theme
![Dark Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=dark)

### Light Theme
![Light Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=light)

### Neon Theme
![Neon Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=neon)

### Sunset Theme
![Sunset Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=sunset)

### Ocean Theme
![Ocean Theme](https://github-profile-views-plum.vercel.app/lucky845?theme=ocean)

</details>

### Available Themes

- `rainbow` (Default) - Rainbow gradient
- `github` - GitHub style
- `blue` - Blue gradient
- `purple` - Purple gradient
- `green` - Green gradient
- `dark` - Dark theme
- `light` - Light theme
- `neon` - Neon style
- `sunset` - Sunset gradient
- `ocean` - Ocean gradient

## Deploy Your Own Instance

### Prerequisites
- Node.js
- [MongoDB database](https://cloud.mongodb.com) (optional, memory mode available as fallback)
- [Vercel account](https://vercel.com/) (for deployment)

### Deployment Steps
1. Fork this repository
2. Clone your forked repository
3. Install dependencies: `npm install`
4. Create a `.env` file and add your MongoDB connection string:
   ```
   MONGODB_URI=your_mongodb_connection_string
   ```
5. Test locally: `npm start`
6. Deploy to Vercel:
   - Import your GitHub repository
   - Add the `MONGODB_URI` environment variable
   - Deploy!

<details>
<summary>Detailed Deployment Guide</summary>

#### Local Development

```bash
# Clone the repository
git clone https://github.com/yourusername/github-profile-views.git
cd github-profile-views

# Install dependencies
npm install

# Create .env file
echo "MONGODB_URI=your_mongodb_connection_string" > .env

# Start development server
npm start
```

#### Deploy to Vercel

1. Create an account on [Vercel](https://vercel.com/)
2. Click the "New Project" button
3. Import your GitHub repository
4. Add `MONGODB_URI` in the "Environment Variables" section
5. Click the "Deploy" button

</details>

## Rating System

View count rating criteria:

| Rating | View Count Range |
|--------|------------------|
| D-     | Less than 100    |
| D      | 100-149          |
| D+     | 150-199          |
| C-     | 200-299          |
| C      | 300-399          |
| C+     | 400-599          |
| B-     | 600-799          |
| B      | 800-999          |
| B+     | 1000-1499        |
| A-     | 1500-1999        |
| A      | 2000-2999        |
| A+     | 3000-4999        |
| S      | 5000-9999        |
| S+     | 10000 and above  |

## License

This project is licensed under the Apache 2.0 License. See the [LICENSE](LICENSE) file for details.

## Contributing

Issues and pull requests are welcome! If you want to contribute to this project, please check the [CONTRIBUTING.md](CONTRIBUTING.md) file.

## Acknowledgements

Thanks to all developers who have contributed to this project!

---

English | [中文](README.md)
```

我对README文件进行了以下优化：

1. 添加了居中显示的大图预览
2. 使用折叠部分（details/summary）来整理主题展示，使README更简洁
3. 将主题列表改为更清晰的格式
4. 添加了详细部署指南（使用折叠部分）
5. 将评分系统改为表格格式，更易读
6. 添加了语言切换链接
7. 修复了MongoDB和Vercel的链接
8. 改进了整体排版和格式

同时，我创建了一个完整的英文版README文件，包含相同的内容但使用英文表达，方便国际用户使用。