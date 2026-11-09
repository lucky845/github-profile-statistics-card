/**
 * 平台数据源注册表
 *
 * 每个适配器把平台自己的 service 返回值翻译成统一的 StatsResult。
 * 新增平台：写一个 PlatformStatsSource<T> 实现，然后 push 进 SOURCES。
 */
import { CardType } from '../svg/types';
import { PlatformStatsSource, StatsResult, ok, fail } from './types';
import { githubService } from '../github.service';
import { getCSDNUserStats } from '../csdn.service';
import { fetchLeetCodeStats } from '../leetcode.service';
import getJuejinInfo from '../juejin.service';
import { getBilibiliInfo } from '../bilibili.service';
import { secureLogger } from '../../utils/logger';

// ---------- GitHub ----------
const githubSource: PlatformStatsSource<Record<string, unknown>> = {
  platform: CardType.GITHUB,
  async fetch(id) {
    const r = await githubService.getGitHubUserStats(id);
    if (r.isValid) return ok({ ...r } as Record<string, unknown>);
    return r.error === 'USER_NOT_FOUND'
      ? fail('NOT_FOUND', 'User not found')
      : r.error === 'RATE_LIMITED'
        ? fail('RATE_LIMITED', 'GitHub API 限流')
        : fail('UPSTREAM_ERROR', 'GitHub 数据获取失败');
  },
};

// ---------- CSDN ----------
const csdnSource: PlatformStatsSource<Record<string, unknown>> = {
  platform: CardType.CSDN,
  async fetch(id, cacheSeconds) {
    const s = await getCSDNUserStats(id, cacheSeconds);
    return s.isValid
      ? ok({ ...s } as Record<string, unknown>)
      : fail('NOT_FOUND', '未找到CSDN用户');
  },
};

// ---------- LeetCode ----------
// 默认走 US 区，leetcode.com 的 graphql 在部分网络下返回 matchedUser 为 null，
// 拿不到数据时回退到 CN 区兜底（原 controller 里的 regionMismatch + 回退逻辑）
const leetcodeSource: PlatformStatsSource<Record<string, unknown>> = {
  platform: CardType.LEETCODE,
  async fetch(id, _cacheSeconds, opts) {
    const useCN = opts?.useCN === true;
    const primary = await fetchLeetCodeStats(id, useCN);
    if (primary.success && primary.data) {
      return ok({ ...primary.data, region: useCN ? 'CN' : 'US' } as Record<string, unknown>);
    }
    const fallback = await fetchLeetCodeStats(id, !useCN);
    if (fallback.success && fallback.data) {
      secureLogger.info(`LeetCode区域回退成功: ${id} ${useCN ? 'CN' : 'US'} → ${useCN ? 'US' : 'CN'}`);
      return ok({ ...fallback.data, region: useCN ? 'US' : 'CN' } as Record<string, unknown>);
    }
    return fail('UPSTREAM_ERROR', primary.error || 'LeetCode 数据获取失败');
  },
};

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
      return message.includes('超时') ? fail('RATE_LIMITED', message) : fail('UPSTREAM_ERROR', message);
    }
  },
};

// ---------- B 站 ----------
const bilibiliSource: PlatformStatsSource<Record<string, unknown>> = {
  platform: CardType.BILIBILI,
  async fetch(id, cacheSeconds) {
    try {
      const s = await getBilibiliInfo(id, cacheSeconds);
      return s.isValid ? ok({ ...s } as Record<string, unknown>) : fail('NOT_FOUND', '未找到哔哩哔哩用户');
    } catch (error) {
      secureLogger.error(`Bilibili 数据源失败: ${error}`);
      return fail('UPSTREAM_ERROR', error instanceof Error ? error.message : String(error));
    }
  },
};

export const SOURCES: Record<string, PlatformStatsSource<Record<string, unknown>>> = {
  [CardType.GITHUB]: githubSource,
  [CardType.CSDN]: csdnSource,
  [CardType.LEETCODE]: leetcodeSource,
  [CardType.JUEJIN]: juejinSource,
  [CardType.BILIBILI]: bilibiliSource,
};

export type { PlatformStatsSource, StatsResult };
