/**
 * 平台数据源注册表
 *
 * 每个适配器把平台自己的 service 返回值翻译成统一的 StatsResult。
 * 新增平台：写一个 PlatformStatsSource<T> 实现，然后 push 进 SOURCES。
 */
import { CardType } from '../svg/types';
import { PlatformStatsSource, StatsResult, ok, fail } from './types';
import { recordOk, recordFail } from './health';
import { getGitHubStats } from '../github.service';
import { getCSDNUserStats } from '../csdn.service';
import { fetchLeetCodeStats } from '../leetcode.service';
import getJuejinInfo from '../juejin.service';
import { getBilibiliInfo } from '../bilibili.service';
import { secureLogger } from '../../utils/logger';

// ---------- GitHub ----------
const githubSource: PlatformStatsSource<Record<string, unknown>> = {
  platform: CardType.GITHUB,
  async fetch(id, cacheSeconds) {
    try {
      const stats = await getGitHubStats(id, cacheSeconds);
      return ok({ ...stats } as Record<string, unknown>);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 限流和上游抖动都给 200 + 降级卡：GitHub camo 会缓存 5xx，README 里就是永久裂图
      if (message.startsWith('USER_NOT_FOUND')) return fail('NOT_FOUND', 'User not found');
      if (message.startsWith('RATE_LIMITED')) {
        secureLogger.warn(`GitHub API 限流: ${id} (${message})`);
        return fail('RATE_LIMITED', 'GitHub API 限流');
      }
      secureLogger.error(`GitHub 数据获取失败: ${id} - ${message}`);
      return fail('DATA_UNAVAILABLE', 'GitHub 数据获取失败');
    }
  },
};

// ---------- CSDN ----------
const csdnSource: PlatformStatsSource<Record<string, unknown>> = {
  platform: CardType.CSDN,
  async fetch(id, cacheSeconds) {
    try {
      const stats = await getCSDNUserStats(id, cacheSeconds);
      return ok({ ...stats, username: stats.username || id } as Record<string, unknown>);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 抓取失败给降级卡而不是 404 —— README 里 404 会被 camo 缓存成永久坏图
      if (message.startsWith('USER_NOT_FOUND')) return fail('NOT_FOUND', 'CSDN 用户不存在');
      secureLogger.error(`CSDN 数据获取失败: ${id} - ${message}`);
      return fail('DATA_UNAVAILABLE', 'CSDN 暂无可用数据');
    }
  },
};// ---------- LeetCode ----------
// 默认走 US 区，leetcode.com 的 graphql 在部分网络下返回 matchedUser 为 null，
// 拿不到数据时回退到 CN 区兜底（原 controller 里的 regionMismatch + 回退逻辑）
const leetcodeSource: PlatformStatsSource<Record<string, unknown>> = {
  platform: CardType.LEETCODE,
  async fetch(id, _cacheSeconds, opts) {
    const useCN = opts?.useCN === true;
    const primary = await fetchLeetCodeStats(id, useCN);
    if (primary.success && primary.data) {
      return ok({ ...primary.data, region: useCN ? 'CN' : 'US', username: primary.data.username || id } as Record<string, unknown>);
    }
    const fallback = await fetchLeetCodeStats(id, !useCN);
    if (fallback.success && fallback.data) {
      secureLogger.info(`LeetCode区域回退成功: ${id} ${useCN ? 'CN' : 'US'} → ${useCN ? 'US' : 'CN'}`);
      return ok({ ...fallback.data, region: useCN ? 'US' : 'CN', username: fallback.data.username || id } as Record<string, unknown>);
    }
    return fail('UPSTREAM_ERROR', primary.error || 'LeetCode 数据获取失败');
  },
};

/** 掘金「查不到数据」类错误的关键词（上游把业务错误码当异常抛出来） */
// 命中这些关键词说明「接口活着、只是这个人没数据/查无此人」——README 里必须仍渲染成图，
// 所以归 DATA_UNAVAILABLE 拿 200；只有超时/网络/解析失败才走 503。
export const UPSTREAM_NO_DATA_HINTS = [
  '空壳数据', '参数错误', '用户不存在', '不存在',
  '安全验证页', '风控', '已失效',
];

// ---------- 掘金 ----------
const juejinSource: PlatformStatsSource<Record<string, unknown>> = {
  platform: CardType.JUEJIN,
  async fetch(id, cacheSeconds) {
    try {
      const s = await getJuejinInfo(id, cacheSeconds);
      return s.isValid ? ok({ ...s } as Record<string, unknown>) : fail('NOT_FOUND', '未找到掘金用户');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      secureLogger.error(`掘金数据源失败: ${message}`);
      if (message.includes('超时')) return fail('RATE_LIMITED', message);
      // 掘金把「这个 id 没数据」也塞进 err_no，报「参数错误」；空壳数据（user_id=0）同理。
      // 这些都是接口本身活着、只是查不到人 —— 归 DATA_UNAVAILABLE 拿 200，
      // 否则 README 里的掘金卡会渲染成坏图。
      if (UPSTREAM_NO_DATA_HINTS.some(hint => message.includes(hint))) {
        return fail('DATA_UNAVAILABLE', message);
      }
      return fail('UPSTREAM_ERROR', message);
    }
  },
};

// ---------- B 站 ----------
const bilibiliSource: PlatformStatsSource<Record<string, unknown>> = {
  platform: CardType.BILIBILI,
  async fetch(id, cacheSeconds) {
    try {
      const s = await getBilibiliInfo(id, cacheSeconds);
      // service 在「上游挂了但有旧缓存 / 彻底没数据」时返回 isValid:false，
      // 这和「用户不存在」是两回事，不能返回 404（GitHub camo 会把 404 缓存成坏图）
      if (s.isValid) {
        return ok({ ...s, username: s.username || id } as Record<string, unknown>);
      }
      return fail('DATA_UNAVAILABLE', 'Bilibili 暂无可用数据');
    } catch (error) {
      secureLogger.error(`Bilibili 数据源失败: ${error}`);
      const message = error instanceof Error ? error.message : String(error);
      return UPSTREAM_NO_DATA_HINTS.some(hint => message.includes(hint))
        ? fail('DATA_UNAVAILABLE', message)
        : fail('UPSTREAM_ERROR', message);
    }
  },
};


const RAW_SOURCES: Record<string, PlatformStatsSource<Record<string, unknown>>> = {
  [CardType.GITHUB]: githubSource,
  [CardType.CSDN]: csdnSource,
  [CardType.LEETCODE]: leetcodeSource,
  [CardType.JUEJIN]: juejinSource,
  [CardType.BILIBILI]: bilibiliSource,
};

/**
 * 对外的平台注册表：透明地给每个平台加一层健康计数。
 * 适配器本身不需要知道 health 的存在。
 */
export const SOURCES: Record<string, PlatformStatsSource<Record<string, unknown>>> = Object.fromEntries(
  Object.entries(RAW_SOURCES).map(([platform, source]) => [
    platform,
    {
      ...source,
      async fetch(id, cacheSeconds, opts) {
        const result = await source.fetch(id, cacheSeconds, opts);
        if (result.ok) recordOk(platform);
        else recordFail(platform, result.reason + ': ' + result.message);
        return result;
      },
    },
  ])
);

export type { PlatformStatsSource, StatsResult };
