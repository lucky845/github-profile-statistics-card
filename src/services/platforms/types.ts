/**
 * 平台数据源统一契约
 *
 * 新增平台 = 实现一个 PlatformStatsSource<T> + 在 registry 里登记一行。
 * 泛型 T 保留各平台自己的载荷类型，外壳（成功/失败、失败原因）统一。
 */

/** 失败原因，统一映射到 HTTP 状态与卡片文案 */
export type StatsFailure =
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INVALID_INPUT'
  /** 上游认不出这个 id，但服务本身是好的 —— 例如掘金返回 user_id=0 的空壳 */
  | 'DATA_UNAVAILABLE'
  | 'UPSTREAM_ERROR';

export type StatsResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: StatsFailure; message: string };

/** 平台特定选项，例如 LeetCode 的 CN/US 区域 */
export interface FetchOptions {
  useCN?: boolean;
}

export interface PlatformStatsSource<T> {
  /** 平台标识，与 CardType 一致，用于缓存 key 与指标 */
  readonly platform: string;
  /** 从数据源抓取统计数据；永不抛出，失败一律返回 ok:false */
  fetch(id: string, cacheSeconds: number, opts?: FetchOptions): Promise<StatsResult<T>>;
}

/** 构造成功结果 */
export const ok = <T>(data: T): StatsResult<T> => ({ ok: true, data });

/** 构造失败结果 */
export const fail = (reason: StatsFailure, message: string): StatsResult<never> => ({
  ok: false,
  reason,
  message,
});

/** 失败原因 → HTTP 状态码 */
/**
 * 失败原因 → HTTP 状态码
 *
 * 200 只给「请求合法但上游没数据」：这类卡要能嵌进 GitHub README 长期显示，
 * 返回 4xx/5xx 会让 img 直接坏图。客户端也靠这个码判断要不要翻译成 README 友好文案。
 */
export const STATUS_BY_REASON: Record<StatsFailure, number> = {
  NOT_FOUND: 404,
  INVALID_INPUT: 400,
  DATA_UNAVAILABLE: 200,
  RATE_LIMITED: 503,
  UPSTREAM_ERROR: 503,
};

/** 失败原因 → 卡片展示文案 */
export const MESSAGE_BY_REASON: Record<StatsFailure, string> = {
  NOT_FOUND: '未找到该用户',
  INVALID_INPUT: '参数无效',
  DATA_UNAVAILABLE: '该平台暂无此用户的数据',
  RATE_LIMITED: '数据源限流，请稍后再试',
  UPSTREAM_ERROR: '数据暂时不可用',
};