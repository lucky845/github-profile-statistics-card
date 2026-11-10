/**
 * 平台健康计数
 *
 * 只记录「最近一次成功/失败」与累计次数，供 /health 暴露上游真实状况。
 * 内存态：进程重启即归零，这是运维指标不是业务数据，不需要持久化。
 */
export interface PlatformHealth {
  ok: number;
  fail: number;
  lastError?: string;
  lastFailureAt?: number;
  lastOkAt?: number;
}

const stats = new Map<string, PlatformHealth>();

const ensure = (platform: string): PlatformHealth => {
  let h = stats.get(platform);
  if (!h) {
    h = { ok: 0, fail: 0 };
    stats.set(platform, h);
  }
  return h;
};

export const recordOk = (platform: string): void => {
  const h = ensure(platform);
  h.ok += 1;
  h.lastOkAt = Date.now();
};

export const recordFail = (platform: string, reason: string): void => {
  const h = ensure(platform);
  h.fail += 1;
  h.lastError = reason;
  h.lastFailureAt = Date.now();
};

export const snapshotHealth = (): Record<string, PlatformHealth> => {
  const out: Record<string, PlatformHealth> = {};
  for (const entry of stats) out[entry[0]] = { ...entry[1] };
  return out;
};

/** 测试用：清空计数 */
export const resetHealth = (): void => stats.clear();
