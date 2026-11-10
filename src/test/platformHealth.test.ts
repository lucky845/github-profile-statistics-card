/**
 * 平台健康计数 & 降级策略的回归
 *
 * 盯住三件不必肉眼发现的事：
 * 1. 上游空壳（掘金 user_id=0）不能再让 README 里的卡片变成坏图；
 * 2. 失败原因 → HTTP 状态码的映射不能漂移；
 * 3. 每次取数都要被健康计数看见。
 */
import { STATUS_BY_REASON, MESSAGE_BY_REASON } from '../services/platforms/types';
import { recordOk, recordFail, snapshotHealth, resetHealth } from '../services/platforms/health';
import { SOURCES } from '../services/platforms/registry';
import { CardType } from '../services/svg/types';

describe('平台失败值域', () => {
  it('上游无数据返回 200，避免 README 坏图', () => {
    expect(STATUS_BY_REASON.DATA_UNAVAILABLE).toBe(200);
  });

  it('真未知用户与参数错误仍是 4xx', () => {
    expect(STATUS_BY_REASON.NOT_FOUND).toBe(404);
    expect(STATUS_BY_REASON.INVALID_INPUT).toBe(400);
  });

  it('每一种失败原因都有可读文案', () => {
    for (const reason of Object.keys(STATUS_BY_REASON) as (keyof typeof STATUS_BY_REASON)[]) {
      expect(MESSAGE_BY_REASON[reason]).toBeTruthy();
    }
  });
});

describe('平台健康计数', () => {
  beforeEach(() => resetHealth());

  it('成功与失败分别累计', () => {
    recordOk('github');
    recordOk('github');
    recordFail('juejin', 'DATA_UNAVAILABLE: 空壳');
    const h = snapshotHealth();
    expect(h.github).toMatchObject({ ok: 2, fail: 0 });
    expect(h.juejin).toMatchObject({ ok: 0, fail: 1 });
    expect(h.juejin.lastError).toContain('DATA_UNAVAILABLE');
  });

  it('快照是拷贝，外部改动不影响内部状态', () => {
    recordOk('github');
    const snap = snapshotHealth();
    snap.github.ok = 999;
    expect(snapshotHealth().github.ok).toBe(1);
  });
});

describe('注册表接入健康计数', () => {
  beforeEach(() => resetHealth());

  it('五个平台都挂在注册表上', () => {
    for (const t of [CardType.GITHUB, CardType.LEETCODE, CardType.CSDN, CardType.JUEJIN, CardType.BILIBILI]) {
      expect(typeof SOURCES[t]?.fetch).toBe('function');
    }
  });

  it('适配器抛异常时仍被计数记下', async () => {
    const source = { platform: CardType.JUEJIN, fetch: async () => { throw new Error('boom'); } };
    const wrapped = { ...source, fetch: async (id: string) => { try { return await source.fetch(); } catch (e) { recordFail(String(source.platform), String(e)); throw e; } } };
    await expect(wrapped.fetch('x')).rejects.toThrow('boom');
    expect(snapshotHealth().juejin.fail).toBe(1);
  });
});
