import { Request, Response } from 'express';
import { createCardHandler } from '../services/platforms/cardHandler';
import { PlatformStatsSource, StatsResult, ok, fail } from '../services/platforms/types';

/**
 * 平台抽象层的契约测试：验证 createCardHandler 对 StatsResult 四种失败原因
 * 的映射，以及新增平台只需要实现 PlatformStatsSource 即可接入。
 */

const makeRes = () => {
  const captured: { status: number; headers: Record<string, string>; body: string } = {
    status: 200,
    headers: {},
    body: '',
  };
  const res = {
    set(k: string, v: string) {
      captured.headers[k] = v;
      return this;
    },
    status(code: number) {
      captured.status = code;
      return this;
    },
    send(body: string) {
      captured.body = body;
    },
  };
  return { res: res as unknown as Response, captured };
};

/** 一个最小的假平台，证明接口可被独立实现 */
const fakeSource = (result: StatsResult<Record<string, unknown>>): PlatformStatsSource<Record<string, unknown>> => ({
  platform: 'fake',
  async fetch() {
    return result;
  },
});

const req = (params: Record<string, string> = { id: 'x' }, query: Record<string, string> = {}) =>
  ({ params, query }) as unknown as Request;

describe('PlatformStatsSource 契约', () => {
  it('成功时返回 200 与 SVG', async () => {
    const { res, captured } = makeRes();
    const handler = createCardHandler(fakeSource(ok({ username: 'x', count: 1 })), {
      paramName: 'id',
      cardType: 'github' as never,
    });
    await handler(req(), res);
    expect(captured.status).toBe(200);
    expect(captured.headers['Content-Type']).toBe('image/svg+xml');
  });

  // 只有真正的语义错误给 4xx；上游故障一律 200 + 降级卡，否则 camo 会缓存成坏图
  it.each([
    ['NOT_FOUND', 404],
    ['INVALID_INPUT', 400],
    ['DATA_UNAVAILABLE', 200],
    ['RATE_LIMITED', 200],
    ['UPSTREAM_ERROR', 200],
  ] as const)('%s 映射为 %i', async (reason, expected) => {
    const { res, captured } = makeRes();
    const handler = createCardHandler(fakeSource(fail(reason, 'boom')), {
      paramName: 'id',
      cardType: 'github' as never,
    });
    await handler(req(), res);
    expect(captured.status).toBe(expected);
    // 4xx 不缓存；200 降级卡短缓存，避免坏结果被 camo 长期钉住
    expect(captured.headers['Cache-Control']).toBe(expected === 200 ? 'public, max-age=60' : 'no-store');
  });

  it('缺少参数时返回 400', async () => {
    const { res, captured } = makeRes();
    const handler = createCardHandler(fakeSource(ok({})), {
      paramName: 'id',
      cardType: 'github' as never,
    });
    await handler(req({ id: '  ' }), res);
    expect(captured.status).toBe(400);
  });

  it('数据源抛异常时兜底为 200 + 降级卡而不是崩溃', async () => {
    const { res, captured } = makeRes();
    const throwing: PlatformStatsSource<Record<string, unknown>> = {
      platform: 'fake',
      async fetch() {
        throw new Error('unexpected');
      },
    };
    const handler = createCardHandler(throwing, { paramName: 'id', cardType: 'github' as never });
    await handler(req(), res);
    expect(captured.status).toBe(200);
    expect(captured.headers['Content-Type']).toBe('image/svg+xml');
  });
});
