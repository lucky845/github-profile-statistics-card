import { Registry, Counter, Histogram, Gauge, collectDefaultMetrics } from 'prom-client';

/**
 * Prometheus监控服务
 * 负责收集和导出系统性能指标
 */
export class PrometheusService {
  // 指标注册表
  private registry: Registry;
  
  // API请求计数器
  public apiRequestsTotal!: Counter<string>;
  
  // API请求响应时间直方图
  public apiResponseTimeHistogram!: Histogram<string>;
  
  // API错误计数器
  public apiErrorsTotal!: Counter<string>;
  
  // 缓存命中率计数器
  public cacheHitsTotal!: Counter<string>;
  
  // 缓存未命中率计数器
  public cacheMissesTotal!: Counter<string>;
  
  // 外部API调用计数器
  public externalApiCallsTotal!: Counter<string>;
  
  // 外部API响应时间直方图
  public externalApiResponseTimeHistogram!: Histogram<string>;
  
  // 内存使用量指标
  public memoryUsageGauge!: Gauge<string>;
  
  // 活跃请求数指标
  public activeRequestsGauge!: Gauge<string>;
  
  constructor() {
    // 创建注册表并设置默认标签
    this.registry = new Registry();
    this.registry.setDefaultLabels({
      app: 'github-profile-statistics-card',
      environment: process.env.NODE_ENV || 'development',
    });
    
    // 注册默认指标（Node.js进程指标）
    collectDefaultMetrics({ register: this.registry });
  }
  
  /**
   * 初始化所有自定义指标
   */
  private initializeMetrics(): void {
    // API请求计数器
    this.apiRequestsTotal = new Counter({
      name: 'api_requests_total',
      help: 'Total number of API requests',
      labelNames: ['method', 'endpoint', 'status_code'],
      registers: [this.registry]
    });
    
    // API请求响应时间直方图
    this.apiResponseTimeHistogram = new Histogram({
      name: 'api_response_time_seconds',
      help: 'API response time in seconds',
      labelNames: ['method', 'endpoint', 'status_code'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5], // 响应时间桶（秒）
      registers: [this.registry]
    });
    
    // API错误计数器
    this.apiErrorsTotal = new Counter({
      name: 'api_errors_total',
      help: 'Total number of API errors',
      labelNames: ['method', 'endpoint', 'error_type'],
      registers: [this.registry]
    });
    
    // 缓存命中率计数器
    this.cacheHitsTotal = new Counter({
      name: 'cache_hits_total',
      help: 'Total number of cache hits',
      labelNames: ['cache_type', 'endpoint'],
      registers: [this.registry]
    });
    
    // 缓存未命中率计数器
    this.cacheMissesTotal = new Counter({
      name: 'cache_misses_total',
      help: 'Total number of cache misses',
      labelNames: ['cache_type', 'endpoint'],
      registers: [this.registry]
    });
    
    // 外部API调用计数器
    this.externalApiCallsTotal = new Counter({
      name: 'external_api_calls_total',
      help: 'Total number of external API calls',
      labelNames: ['api_name', 'status', 'endpoint'],
      registers: [this.registry]
    });
    
    // 外部API响应时间直方图
    this.externalApiResponseTimeHistogram = new Histogram({
      name: 'external_api_response_time_seconds',
      help: 'External API response time in seconds',
      labelNames: ['api_name', 'endpoint'],
      buckets: [0.1, 0.5, 1, 2, 5, 10], // 外部API响应时间桶（秒）
      registers: [this.registry]
    });
    
    // 内存使用量指标
    this.memoryUsageGauge = new Gauge({
      name: 'memory_usage_bytes',
      help: 'Memory usage in bytes',
      labelNames: ['type'],
      registers: [this.registry]
    });
    
    // 活跃请求数指标
    this.activeRequestsGauge = new Gauge({
      name: 'active_requests',
      help: 'Number of active requests being processed',
      labelNames: ['method', 'endpoint'],
      registers: [this.registry]
    });
  }
  
  /**
   * 初始化Prometheus服务
   */
  public initialize(): void {
    this.initializeMetrics();
    
    // 定期更新内存使用量指标
    setInterval(() => {
      this.updateMemoryUsage();
    }, 5000); // 每5秒更新一次
  }

  /**
   * 获取指标注册表
   */
  public getRegistry(): Registry {
    return this.registry;
  }
  
  /**
   * 导出指标为文本格式
   */
  public async metrics(): Promise<string> {
    return this.registry.metrics();
  }
  
  /**
   * 导出指标为JSON格式
   */
  public async metricsJSON(): Promise<object> {
    return this.registry.getMetricsAsJSON();
  }
  
  /**
   * 记录API请求
   */
  public recordApiRequest(method: string, endpoint: string, statusCode: number): void {
    this.apiRequestsTotal.inc({ method, endpoint, status_code: statusCode.toString() });
  }
  
  /**
   * 记录API响应时间
   */
  public recordResponseTime(method: string, endpoint: string, statusCode: number, duration: number): void {
    this.apiResponseTimeHistogram.observe(
      { method, endpoint, status_code: statusCode.toString() },
      duration / 1000 // 转换为秒
    );
  }
  
  /**
   * 记录API错误
   */
  public recordApiError(method: string, endpoint: string, errorType: string): void {
    this.apiErrorsTotal.inc({ method, endpoint, error_type: errorType });
  }
  
  /**
   * 记录缓存命中
   */
  public recordCacheHit(cacheType: string, endpoint: string): void {
    this.cacheHitsTotal.inc({ cache_type: cacheType, endpoint });
  }
  
  /**
   * 记录缓存未命中
   */
  public recordCacheMiss(cacheType: string, endpoint: string): void {
    this.cacheMissesTotal.inc({ cache_type: cacheType, endpoint });
  }
  
  /**
   * 记录外部API调用
   */
  public recordExternalApiCall(apiName: string, endpoint: string, status: string): void {
    this.externalApiCallsTotal.inc({ api_name: apiName, endpoint, status });
  }
  
  /**
   * 记录外部API响应时间
   */
  public recordExternalApiResponseTime(apiName: string, endpoint: string, duration: number): void {
    this.externalApiResponseTimeHistogram.observe(
      { api_name: apiName, endpoint },
      duration / 1000 // 转换为秒
    );
  }
  
  /**
   * 更新内存使用量指标
   */
  public updateMemoryUsage(): void {
    const memoryUsage = process.memoryUsage();
    
    this.memoryUsageGauge.set({ type: 'rss' }, memoryUsage.rss);
    this.memoryUsageGauge.set({ type: 'heapTotal' }, memoryUsage.heapTotal);
    this.memoryUsageGauge.set({ type: 'heapUsed' }, memoryUsage.heapUsed);
    this.memoryUsageGauge.set({ type: 'external' }, memoryUsage.external);
    
    if (memoryUsage.arrayBuffers !== undefined) {
      this.memoryUsageGauge.set({ type: 'arrayBuffers' }, memoryUsage.arrayBuffers);
    }
  }
  
  /**
   * 增加活跃请求数
   */
  public incrementActiveRequests(method: string, endpoint: string): void {
    this.activeRequestsGauge.inc({ method, endpoint });
  }
  
  /**
   * 减少活跃请求数
   */
  public decrementActiveRequests(method: string, endpoint: string): void {
    this.activeRequestsGauge.dec({ method, endpoint });
  }
  
  /**
   * 创建用于测量函数执行时间的计时器
   * 用法: const timer = createTimer(); ... const duration = timer.end();
   */
  public createTimer(): { end: () => number } {
    const start = process.hrtime();
    
    return {
      end: (): number => {
        const [seconds, nanoseconds] = process.hrtime(start);
        return seconds * 1000 + nanoseconds / 1000000; // 转换为毫秒
      }
    };
  }
}

// 创建单例实例
const prometheusService = new PrometheusService();

export default prometheusService;