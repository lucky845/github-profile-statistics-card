import express from 'express';
import { collectDefaultMetrics, register, Gauge } from 'prom-client';
import os from 'os';
import process from 'process';
import { secureLogger } from '../utils/logger';
import mongoose from 'mongoose';
import { cacheService } from '../services/cache.service';
import { storageService } from '../services/storage.service';

// 扩展全局变量类型
declare global {
  var requestCount: number;
  var requestCountLastHour: number;
  var githubApiCallCount: number;
  var leetcodeApiCallCount: number;
}

const router = express.Router();

// 收集默认指标
collectDefaultMetrics({ prefix: 'github_stats_' });

// 自定义指标
const httpRequestDuration = new Gauge({
  name: 'github_stats_http_request_duration_seconds',
  help: 'HTTP请求持续时间',
  labelNames: ['method', 'route', 'status']
});

const cacheHitRate = new Gauge({
  name: 'github_stats_cache_hit_rate',
  help: '缓存命中率'
});

const externalApiCalls = new Gauge({
  name: 'github_stats_external_api_calls_total',
  help: '外部API调用总数',
  labelNames: ['service']
});

// 在适当的地方更新这些指标
// 例如，在中间件中记录HTTP请求持续时间

router.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', register.contentType);
    res.end(await register.metrics());
  } catch (error) {
    secureLogger.error('❌ Metrics endpoint error:', error);
    res.status(500).send('Error generating metrics');
  }
});

router.get('/metrics/json', async (req, res) => {
  try {
    res.json(await register.getMetricsAsJSON());
  } catch (error) {
    secureLogger.error('❌ JSON metrics endpoint error:', error);
    res.status(500).send('Error generating JSON metrics');
  }
});

router.get('/health', async (req, res) => {
  const uptime = process.uptime();
  const memoryUsage = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;

  // 检查数据库连接状态
  const dbStatus = mongoose.connection.readyState === 1 ? 'healthy' : 'unhealthy';

  // 获取存储状态
  const storageStatus = await storageService.getStorageStatus();

  res.json({
    status: dbStatus === 'healthy' ? 'OK' : 'ERROR',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(uptime),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch
    },
    storage: {
      strategy: storageStatus.strategy,
      redis: {
        connected: storageStatus.redisConnected
      },
      mongodb: {
        connected: storageStatus.mongoConnected
      },
      fallbackMode: storageStatus.fallbackMode
    },
    memory: {
      heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100, // MB
      heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024 * 100) / 100, // MB
      rss: Math.round(memoryUsage.rss / 1024 / 1024 * 100) / 100, // MB
      external: Math.round(memoryUsage.external / 1024 / 1024 * 100) / 100, // MB
      systemUsed: Math.round(usedMem / 1024 / 1024 * 100) / 100, // MB
      systemTotal: Math.round(totalMem / 1024 / 1024 * 100) / 100 // MB
    }
  });
});

router.get('/stats', async (req, res) => {
  try {
    // 获取缓存统计信息
    const cacheStats = await cacheService.getStats();
    
    res.json({
      requests: {
        total: global.requestCount || 0,
        lastHour: global.requestCountLastHour || 0
      },
      cache: cacheStats,
      externalApis: {
        github: global.githubApiCallCount || 0,
        leetcode: global.leetcodeApiCallCount || 0
      }
    });
  } catch (error) {
    secureLogger.error('❌ Stats endpoint error:', error);
    res.status(500).send('Error generating stats');
  }
});

export default router;