import { Router } from 'express';
import prometheusService from '../services/prometheus.service';

const router = Router();

/**
 * 指标路由配置
 * 提供Prometheus格式的指标导出端点
 */

/**
 * @swagger
 * /metrics:
 *   get:
 *     summary: 导出Prometheus格式的监控指标
 *     description: 以文本格式导出所有系统和应用程序指标，供Prometheus采集器抓取
 *     tags:
 *       - 监控
 *     responses:
 *       200:
 *         description: 成功返回Prometheus格式的指标数据
 *         content:
 *           text/plain:
 *             schema:
 *               type: string
 *       500:
 *         description: 服务器内部错误
 */
router.get('/metrics', async (req, res) => {
  try {
    // 获取Prometheus格式的指标数据
    const metrics = await prometheusService.metrics();
    
    // 设置内容类型
    res.set('Content-Type', prometheusService.getRegistry().contentType);
    
    // 返回指标数据
    res.send(metrics);
  } catch (error) {
    console.error('Error exporting metrics:', error);
    res.status(500).json({
      error: 'Failed to export metrics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @swagger
 * /metrics/json:
 *   get:
 *     summary: 导出JSON格式的监控指标
 *     description: 以结构化JSON格式导出所有系统和应用程序指标，便于API调用和调试
 *     tags:
 *       - 监控
 *     responses:
 *       200:
 *         description: 成功返回JSON格式的指标数据
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *       500:
 *         description: 服务器内部错误
 */
router.get('/metrics/json', async (req, res) => {
  try {
    // 获取JSON格式的指标数据
    const metrics = await prometheusService.metricsJSON();
    
    // 返回JSON格式的指标数据
    res.json(metrics);
  } catch (error) {
    console.error('Error exporting JSON metrics:', error);
    res.status(500).json({
      error: 'Failed to export JSON metrics',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @swagger
 * /health:
 *   get:
 *     summary: 健康检查端点
 *     description: 提供简单的健康检查，返回系统基本状态信息
 *     tags:
 *       - 监控
 *     responses:
 *       200:
 *         description: 系统正常运行
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 status:
 *                   type: string
 *                   example: healthy
 *                 timestamp:
 *                   type: string
 *                 uptime:
 *                   type: number
 *                 environment:
 *                   type: string
 */
router.get('/health', (req, res) => {
  // 获取当前内存使用情况
  const memoryUsage = process.memoryUsage();
  
  // 返回健康状态信息
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    memory: {
      rss: memoryUsage.rss,
      heapTotal: memoryUsage.heapTotal,
      heapUsed: memoryUsage.heapUsed
    },
    nodeVersion: process.version
  });
});

/**
 * @swagger
 * /stats:
 *   get:
 *     summary: 获取应用统计信息
 *     description: 返回应用程序的关键统计信息，如请求数、错误数、缓存命中率等
 *     tags:
 *       - 监控
 *     responses:
 *       200:
 *         description: 成功返回统计信息
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 */
router.get('/stats', async (req, res) => {
  try {
    // 获取指标数据并提取关键统计信息
    const metricsJson: any = await prometheusService.metricsJSON();
    
    // 解析指标数据，提取关键统计信息
    const stats = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0
      },
      cache: {
        hits: 0,
        misses: 0,
        hitRate: 0
      },
      externalApi: {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0
      }
    };
    
    // 从指标数据中提取统计信息
    metricsJson.forEach((metric: any) => {
      // 处理请求相关指标
      if (metric.name === 'api_requests_total') {
        metric.metrics.forEach((m: any) => {
          const value = parseFloat(m.value);
          stats.requests.total += value;
          
          const statusCode = m.labels.status_code || '';
          if (statusCode.startsWith('2') || statusCode.startsWith('3')) {
            stats.requests.successful += value;
          } else {
            stats.requests.failed += value;
          }
        });
      }
      
      // 处理缓存相关指标
      if (metric.name === 'cache_hits_total') {
        metric.metrics.forEach((m: any) => {
          stats.cache.hits += parseFloat(m.value);
        });
      }
      
      if (metric.name === 'cache_misses_total') {
        metric.metrics.forEach((m: any) => {
          stats.cache.misses += parseFloat(m.value);
        });
      }
      
      // 处理外部API调用相关指标
      if (metric.name === 'external_api_calls_total') {
        metric.metrics.forEach((m: any) => {
          const value = parseFloat(m.value);
          stats.externalApi.totalCalls += value;
          
          if (m.labels.status === 'success') {
            stats.externalApi.successfulCalls += value;
          } else {
            stats.externalApi.failedCalls += value;
          }
        });
      }
    });
    
    // 计算缓存命中率
    const totalCacheOps = stats.cache.hits + stats.cache.misses;
    stats.cache.hitRate = totalCacheOps > 0 ? (stats.cache.hits / totalCacheOps) * 100 : 0;
    
    res.json(stats);
  } catch (error) {
    console.error('Error fetching stats:', error);
    res.status(500).json({
      error: 'Failed to fetch stats',
      message: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;