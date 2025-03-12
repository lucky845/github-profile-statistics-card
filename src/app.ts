// 导入 polyfill，确保在所有其他导入之前
import './polyfill';

import express, {Request, Response} from 'express';
import path from 'path';
import {errorHandler, logger, mongoMiddleware} from './middleware';
import {
    appConfig,
    darkTheme,
    defaultTheme,
    gruvboxLightTheme,
    gruvboxTheme,
    merkoTheme,
    onedarkTheme,
    tokyonightTheme
} from './config';
import {bilibiliRouter, csdnRouter, githubRouter, juejinRouter, leetcodeRouter} from './routes';
import fs from 'fs';
import mongoose from 'mongoose';
import {MongoDBManager} from './utils/dbManager';

// 初始化数据库连接管理器
const dbManager = MongoDBManager.getInstance();

// 全局主题设置
const themes = {
    light: defaultTheme,
    dark: darkTheme,
    merko: merkoTheme,
    gruvbox: gruvboxTheme,
    gruvbox_light: gruvboxLightTheme,
    tokyonight: tokyonightTheme,
    onedark: onedarkTheme,
};

// 中间件: 设置主题
const themeMiddleware = (req: Request, res: Response, next: Function) => {
    // 从查询参数获取主题
    const themeName = req.query.theme as string;
    if (themeName && themes[themeName as keyof typeof themes]) {
        // 临时设置响应本地变量
        res.locals.theme = themes[themeName as keyof typeof themes];
    } else {
        // 使用默认主题
        res.locals.theme = defaultTheme;
    }
    next();
};

// 初始化Express应用
const app = express();
const port = appConfig.port;

// 应用中间件
app.use(logger);
app.use(express.json());
app.use(express.urlencoded({extended: true}));
app.use(mongoMiddleware);
app.use(themeMiddleware);

// 健康检查端点
app.get('/health', (req, res) => {
    const dbStatus = mongoose.connection.readyState === 1 ? 'healthy' : 'unhealthy';
    const poolStats = (mongoose.connection as any).poolMetrics || {};

    res.json({
        status: dbStatus,
        uptime: process.uptime(),
        database: {
            status: dbStatus,
            pool: poolStats
        },
        memory: process.memoryUsage()
    });
});

// 设置静态文件目录
app.use(express.static(path.join(__dirname, 'public')));

// 使用路由
app.use('/leetcode', leetcodeRouter);
app.use('/github', githubRouter);
app.use('/csdn', csdnRouter);
app.use('/juejin', juejinRouter);
app.use('/bilibili', bilibiliRouter);

// 设置根路径展示页面
app.get('/', (req: Request, res: Response) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;

    try {
        // 尝试读取首页HTML文件
        const indexPath = path.join(__dirname, 'views/index.html');
        let indexHtml: string;

        if (fs.existsSync(indexPath)) {
            indexHtml = fs.readFileSync(indexPath, 'utf8');
            // 替换基础URL
            indexHtml = indexHtml.replace(/BASE_URL/g, baseUrl);
        } else {
            // 如果文件不存在，则使用内联HTML
            indexHtml = `
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>GitHub & LeetCode Stats</title>
          <style>
            body {
              font-family: 'Arial', sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 800px;
              margin: 0 auto;
              padding: 20px;
              background-color: #f5f5f5;
            }
            
            .container {
              background-color: #fff;
              border-radius: 8px;
              box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
              padding: 30px;
              margin-bottom: 30px;
            }
            
            h1, h2 {
              color: #2c3e50;
            }
            
            h1 {
              text-align: center;
              margin-bottom: 30px;
              border-bottom: 2px solid #eee;
              padding-bottom: 15px;
            }
            
            .code-block {
              background-color: #f8f9fa;
              border-radius: 4px;
              padding: 15px;
              margin: 15px 0;
              overflow-x: auto;
              font-family: monospace;
              border-left: 4px solid #3498db;
            }

            .theme-switch {
              margin-top: 30px;
              text-align: center;
            }

            .theme-option {
              display: inline-block;
              margin: 0 10px;
              padding: 8px 15px;
              border-radius: 4px;
              text-decoration: none;
              font-weight: bold;
            }

            .light-theme {
              background-color: #ffffff;
              color: #333;
              border: 1px solid #ddd;
            }

            .dark-theme {
              background-color: #1e1e2e;
              color: #fff;
              border: 1px solid #333;
            }

            .pill {
              display: inline-block;
              padding: 3px 8px;
              border-radius: 12px;
              font-size: 12px;
              margin-left: 8px;
              font-weight: bold;
            }

            .us-pill {
              background-color: #3498db;
              color: white;
            }

            .cn-pill {
              background-color: #e74c3c;
              color: white;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>GitHub & LeetCode Stats</h1>
            
            <h2>GitHub 访问统计</h2>
            <div class="code-block">
              <p>在你的GitHub个人资料中添加访问计数器：</p>
              <code>![](${baseUrl}/github/用户名)</code>
            </div>
            
            <h2>LeetCode 解题统计</h2>
            <div class="code-block">
              <p>在你的GitHub个人资料中添加LeetCode统计：</p>
              <code>![](${baseUrl}/leetcode/用户名)</code>
            </div>

            <h2>参数选项</h2>
            <p>你可以通过添加以下参数来自定义显示结果：</p>

            <h3>主题选择</h3>
            <div class="code-block">
              <p>使用暗色主题：</p>
              <code>![](${baseUrl}/leetcode/用户名?theme=dark)</code>
            </div>

            <h3>LeetCode区域选择 <span class="pill us-pill">US</span> <span class="pill cn-pill">CN</span></h3>
            <div class="code-block">
              <p>使用中国区LeetCode数据：</p>
              <code>![](${baseUrl}/leetcode/用户名?cn=true)</code>
            </div>

            <h3>组合多个参数</h3>
            <div class="code-block">
              <p>使用暗色主题和中国区数据：</p>
              <code>![](${baseUrl}/leetcode/用户名?theme=dark&cn=true)</code>
            </div>

            <div class="theme-switch">
              <a href="?theme=light" class="theme-option light-theme">亮色主题</a>
              <a href="?theme=dark" class="theme-option dark-theme">暗色主题</a>
            </div>
          </div>
        </body>
        </html>
      `;
        }

        res.send(indexHtml);
    } catch (error) {
        console.error('读取首页错误:', error);
        res.status(500).send('服务器错误');
    }
});

// 404处理
app.use((req: Request, res: Response) => {
    res.status(404).send('找不到请求的资源');
});

// 错误处理中间件
app.use(errorHandler);

// 启动服务器
let server: ReturnType<typeof app.listen>;

const startServer = async () => {
    try {
        // 初始化数据库连接
        await dbManager.connect();

        server = app.listen(port, () => {
            console.log(`
      🚀 服务已启动于端口 ${port}
      📊 数据库状态: ${mongoose.connection.readyState === 1 ? '已连接' : '未连接'}
      `);
        });

        return server;
    } catch (error) {
        console.error('服务启动失败:', error);
        process.exit(1);
    }
};

// 处理未捕获的异常
process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的Promise拒绝:', reason);
});

process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
    // 对于严重错误，可能需要优雅地关闭应用
    process.exit(1);
});

// 优雅终止
process.on('SIGINT', async () => {
    console.log('\n🛑 接收到终止信号');

    try {
        // 1. 停止接受新请求
        server.close(() => {
            console.log('🚫 已停止接受新请求');
        });

        // 2. 关闭数据库连接
        await dbManager.disconnect();
        console.log('✅ MongoDB连接已关闭');

        // 3. 关闭现有连接
        server.close(() => {
            console.log('🛑 HTTP服务完全停止');
            process.exit(0);
        });

        // 强制退出保护
        setTimeout(() => {
            console.error('⏰ 关闭超时，强制退出');
            process.exit(1);
        }, 10000); // 10秒超时

    } catch (error) {
        console.error('关闭资源失败:', error);
        process.exit(1);
    }
});

// 初始化并启动服务
startServer().then(serverInstance => {
    // 处理其他关闭信号
    process.on('SIGTERM', () => {
        console.log('\n🛑 接收到SIGTERM信号');
        serverInstance.close();
    });
});
