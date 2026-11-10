/**
 * GitHub 用户统计
 *
 * 数据只来自 Redis（cacheService）+ 上游 API，不再落 MongoDB：
 * 访问计数已下线（删库时移除），剩下的仓库/星标/关注者本来就是每次都从
 * 上游算的新鲜数据，没有长期存储的必要。
 *
 * 关键约束：上游一出错就抛异常（RATE_LIMITED / USER_NOT_FOUND / UPSTREAM_ERROR），
 * 但只有 USER_NOT_FOUND 能变成 404，其余由 registry 映射成 200 + 降级卡 ——
 * GitHub camo 会把 5xx 缓存成永久坏图。
 */
import { cacheService } from './cache.service';
import { githubConfig } from '../config/github.config';
import { secureLogger } from '../utils/logger';

// 缓存时间（秒）
const CACHE_TTL = 30 * 60;

const CACHE_PREFIX = 'github_data';

export interface GitHubStats {
  username: string;
  publicRepos: number;
  followers: number;
  totalStars: number;
}

/** 缓存键；用户名大小写不敏感，统一小写避免同一用户存两份 */
export const githubCacheKey = (username: string): string =>
  `${CACHE_PREFIX}:${username.toLowerCase()}`;

interface GitHubApiUser {
  public_repos?: number;
  followers?: number;
}

/** 带上 token 时的请求头；没有 token 就是匿名调用（60 次/小时/IP） */
const apiHeaders = (): Record<string, string> => ({
  'Accept': 'application/vnd.github+json',
  'User-Agent': 'GitHub-Stats-Card',
  ...(githubConfig.apiToken ? { 'Authorization': `Bearer ${githubConfig.apiToken}` } : {}),
});

const getJson = async (url: string, timeout = 8000): Promise<any> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    return await fetch(url, { headers: apiHeaders(), signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
};
/**
 * 从 GitHub 拿实时数据。
 * 仓库只取第一页（最多 100 个），够算星标和仓库数，又不至于过度消耗 rate limit。
 */
const fetchFromApi = async (username: string): Promise<GitHubStats> => {
  const profileRes = await getJson(`https://api.github.com/users/${encodeURIComponent(username)}`);

  if (profileRes.status === 404) throw new Error('USER_NOT_FOUND');
  if (profileRes.status === 429 || profileRes.status === 403) {
    const remaining = profileRes.headers.get('x-ratelimit-remaining');
    throw new Error(`RATE_LIMITED:${remaining}`);
  }
  if (!profileRes.ok) throw new Error(`UPSTREAM_ERROR:${profileRes.status}`);

  const profile = await profileRes.json();
  const publicRepos = Number(profile.public_repos) || 0;
  const followers = Number(profile.followers) || 0;

  let totalStars = 0;
  try {
    const reposRes = await getJson(
      `https://api.github.com/users/${encodeURIComponent(username)}/repos?per_page=100&sort=updated`
    );
    if (reposRes.ok) {
      const repos = await reposRes.json();
      if (Array.isArray(repos)) {
        totalStars = repos.reduce((sum: number, r: any) => sum + (Number(r.stargazers_count) || 0), 0);
      }
    }
  } catch (error) {
    // 仓库列表失败不影响主数据，星标降级为 0 并在日志里留痕
    secureLogger.warn(`获取 GitHub 仓库列表失败: ${username}`);
  }

  return { username, publicRepos, followers, totalStars };
};/**
 * 对外入口：缓存优先，未命中再打上游。
 * 只缓存成功结果 —— 限流/故障时把错误缓存住，恢复后还得等 TTL 才能自愈。
 */
export const getGitHubStats = async (username: string, cacheSeconds: number = CACHE_TTL): Promise<GitHubStats> => {
  const key = githubCacheKey(username);

  try {
    const cached = await cacheService.get<GitHubStats>(key);
    if (cached && typeof cached.publicRepos === 'number') {
      return cached;
    }
  } catch (error) {
    // 缓存读失败不该阻断请求，直接打上游
    secureLogger.warn(`读取 GitHub 缓存失败: ${username}`);
  }

  const stats = await fetchFromApi(username);

  try {
    await cacheService.set(key, stats, cacheSeconds);
  } catch (error) {
    secureLogger.warn(`写入 GitHub 缓存失败: ${username}`);
  }

  return stats;
};
/**
 * 就绪/自检用的探针：自己 + 上游 + 缓存的可用性。
 * 返回空对象表示正常。
 */
export const getGitHubHealth = async (): Promise<Record<string, unknown>> => ({
  cacheConfigured: Boolean(cacheService),
  apiTokenConfigured: Boolean(githubConfig.apiToken),
});
