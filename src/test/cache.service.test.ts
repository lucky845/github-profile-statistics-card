// 导入必要的测试和服务模块
import { cacheService, CacheKeyGenerator } from '../services/cache.service';
import { secureLogger } from '../utils/logger';


// 模拟 node-cache
jest.mock('node-cache', () => {
  class MockNodeCache {
    private cache: Map<string, { value: any; expiry: number }> = new Map();
    private defaultTTL: number;

    constructor(options?: { stdTTL?: number }) {
      this.defaultTTL = options?.stdTTL || 0;
    }

    set(key: string, value: any, ttl?: number): boolean {
      const expiry = ttl || this.defaultTTL;
      const expiryTime = expiry > 0 ? Date.now() + expiry * 1000 : 0;
      this.cache.set(key, { value, expiry: expiryTime });
      return true;
    }

    get(key: string): any | undefined {
      const item = this.cache.get(key);
      if (!item) return undefined;
      
      // 模拟过期检查
      if (item.expiry > 0 && Date.now() > item.expiry) {
        this.cache.delete(key);
        return undefined;
      }
      
      return item.value;
    }

    del(key: string | string[]): number {
      if (Array.isArray(key)) {
        return key.reduce((count, k) => {
          const hadKey = this.cache.has(k);
          if (hadKey) this.cache.delete(k);
          return count + (hadKey ? 1 : 0);
        }, 0);
      } else {
        const hadKey = this.cache.has(key);
        if (hadKey) this.cache.delete(key);
        return hadKey ? 1 : 0;
      }
    }

    flushAll(): void {
      this.cache.clear();
    }

    keys(): string[] {
      return Array.from(this.cache.keys());
    }
  }

  return MockNodeCache;
});

describe('Cache Service Tests', () => {
  beforeEach(() => {
    // 清空缓存
    jest.spyOn(secureLogger, 'debug').mockImplementation((message: string) => secureLogger as any);
    jest.spyOn(secureLogger, 'error').mockImplementation((message: string) => secureLogger as any);
    jest.spyOn(secureLogger, 'info').mockImplementation((message: string) => secureLogger as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Basic Cache Operations', () => {
    it('should set and get a value correctly', async () => {
      const key = 'test_key';
      const value = { data: 'test data' };
      
      await cacheService.set(key, value);
      const retrievedValue = await cacheService.get(key);
      
      expect(retrievedValue).toEqual(value);
      expect(secureLogger.debug).toHaveBeenCalledWith('Cache set: test_key');
    });

    it('should return undefined for non-existent keys', async () => {
      const retrievedValue = await cacheService.get('non_existent_key');
      
      expect(retrievedValue).toBeUndefined();
    });

    it('should delete a value correctly', async () => {
      const key = 'test_key';
      const value = { data: 'test data' };
      
      await cacheService.set(key, value);
      await cacheService.delete(key);
      const retrievedValue = await cacheService.get(key);
      
      expect(retrievedValue).toBeUndefined();
    });

    it('should handle cache operations properly', async () => {
      // 测试缓存设置和获取
      await cacheService.set('key1', 'value1');
      expect(await cacheService.get('key1')).toBe('value1');
      
      // 测试删除
      await cacheService.delete('key1');
      expect(await cacheService.get('key1')).toBeUndefined();
      
      // 验证日志调用
      expect(secureLogger.debug).toHaveBeenCalled();
    });

    it('should handle cache operations with custom TTL', async () => {
      const key = 'test_ttl_key';
      const value = { data: 'ttl data' };
      
      await cacheService.set(key, value, 60); // 60秒TTL
      const retrievedValue = await cacheService.get(key);
      
      expect(retrievedValue).toEqual(value);
    });

    it('should handle multiple cache entries', async () => {
      await cacheService.set('key1', { data: 'data1' });
      await cacheService.set('key2', { data: 'data2' });
      
      expect(await cacheService.get('key1')).toEqual({ data: 'data1' });
      expect(await cacheService.get('key2')).toEqual({ data: 'data2' });
    });
  });

  describe('Cache TTL Functionality', () => {
    it('should handle custom TTL values', async () => {
      const key = 'test_ttl_key';
      const value = { data: 'test data' };
      
      // 设置TTL
      await cacheService.set(key, value, 60); // 60秒TTL
      
      // 立即检查，应该存在
      expect(await cacheService.get(key)).toEqual(value);
    });

    it('should use default TTL when not specified', async () => {
      const key = 'test_default_ttl';
      const value = { data: 'test data' };
      
      // 使用默认TTL
      await cacheService.set(key, value);
      
      // 立即检查，应该存在
      expect(await cacheService.get(key)).toEqual(value);
    });
  });

  describe('CacheKeyGenerator', () => {
    it('should generate consistent keys for the same input', () => {
      const key1 = CacheKeyGenerator.generateKey('type', 'param1', 'param2');
      const key2 = CacheKeyGenerator.generateKey('type', 'param1', 'param2');
      
      expect(key1).toEqual(key2);
    });

    it('should generate different keys for different input', () => {
      const key1 = CacheKeyGenerator.generateKey('type', 'param1', 'param2');
      const key2 = CacheKeyGenerator.generateKey('type', 'param1', 'different');
      
      expect(key1).not.toEqual(key2);
    });

    it('should generate GitHub specific keys correctly', () => {
      const username = 'octocat';
      const theme = 'dark';
      const key = CacheKeyGenerator.generateGitHubKey(username, theme);
      
      expect(key).toContain('github');
      expect(key).toContain(username);
      expect(key).toContain(theme);
    });

    it('should generate LeetCode specific keys correctly', () => {
      const username = 'testuser';
      const theme = 'light';
      const key = CacheKeyGenerator.generateLeetCodeKey(username, theme);
      
      expect(key).toContain('leetcode');
      expect(key).toContain(username);
      expect(key).toContain(theme);
    });
  });

  describe('Default Cache Service', () => {
    it('should use the default cache service instance', async () => {
      // 测试默认缓存服务实例是否正常工作
      const key = 'default_cache_key';
      const value = { data: 'default cache data' };
      
      await cacheService.set(key, value);
      const retrievedValue = await cacheService.get(key);
      
      expect(retrievedValue).toEqual(value);
    });
  });
});

describe('Cache Service Error Handling', () => {
  beforeEach(() => {
      // 使用全局的cacheService
    });

  it('should handle null values', async () => {
    const key = 'null_key';
    
    await cacheService.set(key, null);
    expect(await cacheService.get(key)).toBeNull();
  });

  it('should handle undefined values', async () => {
    const key = 'undefined_key';
    
    await cacheService.set(key, undefined);
    // 这里不严格要求返回undefined，因为缓存实现可能将undefined转换为null
    const result = await cacheService.get(key);
    expect(result === undefined || result === null).toBeTruthy();
  });

  it('should handle large objects', async () => {
    const key = 'large_object_key';
    const largeObject = {
      nested: {
        array: Array(100).fill(0).map((_, i) => ({ id: i, data: `item ${i}` })),
        deep: { value: 'test', numbers: Array(50).fill(0).map((_, i) => i) }
      }
    };
    
    await cacheService.set(key, largeObject);
      const retrievedValue = await cacheService.get(key);
    
    expect(retrievedValue).toEqual(largeObject);
  });

  it('should handle empty strings as keys', async () => {
    const key = '';
    const value = { data: 'empty key data' };
    
    await cacheService.set(key, value);
      expect(await cacheService.get(key)).toEqual(value);
  });
});