import app from './app';
import prometheusService from './services/prometheus.service';

// 在无服务器环境中 app.ts 的 startServer() 不会执行（require.main !== module），
// 这里显式初始化监控服务，启动内存指标的周期性更新。
// 指标本身已在 PrometheusService 构造函数中注册，initialize() 是幂等的。
prometheusService.initialize();

// Vercel 需要导出一个处理函数
export default app;