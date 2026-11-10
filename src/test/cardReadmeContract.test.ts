/**
 * README 嵌入卡片的「camo 友好」契约。
 *
 * GitHub 会把 README 里的外链图片重写成 camo.githubusercontent.com 代理，
 * 而 camo 会把非 2xx 响应缓存成坏图（实测 502/504 会一直挂着）。
 * 所以卡片路由对「上游没数据 / 限流 / 渲染异常」必须一律回 200 + 降级卡。
 */
import request from 'supertest';
import express from 'express';
import { createCardHandler } from '../services/platforms/cardHandler';
import { CardType } from '../services/svg/types';
import { PlatformStatsSource, STATUS_BY_REASON } from '../services/platforms/types';

const makeSource = (result: any): PlatformStatsSource<Record<string, unknown>> => ({
  platform: CardType.CSDN,
  fetch: async () => result,
});

const buildApp = (result: any) => {
  const app = express();
  app.get('/c/:id', createCardHandler(makeSource(result), { paramName: 'id', cardType: CardType.CSDN }));
  return app;
};

describe('README 卡片必须永远返回 200', () => {
  it('上游不可用时返回 200 而不是 503', async () => {
    const res = await request(buildApp({ ok: false, reason: 'UPSTREAM_ERROR', message: 'boom' })).get('/c/x');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('image/svg+xml');
  });

  it('降级卡不被长缓存', async () => {
    const res = await request(buildApp({ ok: false, reason: 'DATA_UNAVAILABLE', message: 'x' })).get('/c/x');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60');
  });

  it('用户不存在仍然是 404（真实的语义，不是坏图）', async () => {
    const res = await request(buildApp({ ok: false, reason: 'NOT_FOUND', message: 'x' })).get('/c/x');
    expect(res.status).toBe(STATUS_BY_REASON.NOT_FOUND);
  });

  it('渲染抛异常也返回 200 + 错误卡', async () => {
    const app = express();
    app.get('/c/:id', createCardHandler(makeSource({ ok: true, data: { boom: true } }), {
      paramName: 'id',
      cardType: CardType.CSDN,
      transform: () => { throw new Error('bad shape'); },
    }));
    const res = await request(app).get('/c/x');
    expect(res.status).toBe(200);
    // supertest 对 image/svg+xml 不填 res.text，只能从 body 里读
    expect(res.body.toString()).toContain('<svg');
  });
});
