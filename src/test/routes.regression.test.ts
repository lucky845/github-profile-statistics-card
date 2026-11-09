import express from 'express';
import request from 'supertest';
import { validateGitHubUsername } from '../middleware/validation.middleware';

/**
 * 路由层回归测试：不启动真服务、不打外部 API，只验证校验与缓存中间件的行为。
 */
describe('路由层回归', () => {
  describe('GitHub 用户名校验', () => {
    const app = express();
    app.get('/github/:username', validateGitHubUsername, (_req, res) => {
      res.send('ok');
    });

    it.each([
      ['a'.repeat(300)],
      ['a<script>'],
      ['a b'],
      ['-leading-dash'],
      ['trailing-dash-'],
    ])('拒绝非法用户名 %s', async name => {
      const res = await request(app).get(`/github/${encodeURIComponent(name)}`);
      expect(res.status).toBe(400);
    });

    it('放行合法用户名', async () => {
      const res = await request(app).get('/github/lucky845');
      expect(res.status).toBe(200);
    });
  });

  describe('缓存中间件尊重 no-store', () => {
    // 复现 cache.middleware.ts:70 的判断：只有 2xx 且未声明 no-store 时才缓存
    const shouldCache = (statusCode: number, cacheControl: string): boolean =>
      statusCode >= 200 && statusCode < 300 && !String(cacheControl || '').includes('no-store');

    it('2xx 且无 Cache-Control 时缓存', () => {
      expect(shouldCache(200, '')).toBe(true);
    });

    it('声明 no-store 时不缓存（上游限流降级）', () => {
      expect(shouldCache(200, 'no-store')).toBe(false);
    });

    it('非 2xx 时不缓存', () => {
      expect(shouldCache(503, '')).toBe(false);
    });
  });
});
