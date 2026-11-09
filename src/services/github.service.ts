import { createRequest } from '../utils/http.utils';
import { getGitHubUserData, updateGitHubUserData } from './mongodb.service';
import { asyncDbUpdate } from '../utils/db-update.utils';
import { IGitHubUser } from '../types';
import { secureLogger } from '../utils/logger';
import { Cacheable } from './cache.service';
import { githubConfig } from '../config/github.config';

// 扩展全局变量类型
declare global {
  var githubApiCallCount: number;
}

/**
 * GitHub服务类
 * 提供GitHub用户统计数据的获取功能
 */
class GitHubService {
  /**
   * 获取GitHub用户数据（包括头像和访问计数）
   * @param username GitHub用户名
   * @returns 用户统计数据
   */
  @Cacheable(
    (username: string) => `github:user:stats:${username}`,
    300 // 5分钟缓存
  )
  async getGitHubUserStats(username: string): Promise<{
    isValid: boolean;
    error?: 'USER_NOT_FOUND' | 'RATE_LIMITED' | 'UPSTREAM_ERROR';
    avatarUrl: string | null;
    visitCount: number;
    publicRepos: number;
    followers: number;
    totalStars: number;
  }> {
    try {
      // 先从MongoDB中获取用户数据
      const { userData } = await getGitHubUserData(username);
      let avatarUrl = null;
      let publicRepos = 0;
      let followers = 0;
      let totalStars = 0;
      let rateLimited = false;

      // 检查缓存的头像URL是否有效（30天内）
      if (userData?.avatarUrl && userData.avatarUpdatedAt) {
        const avatarAge = new Date().getTime() - new Date(userData.avatarUpdatedAt).getTime();
        // 头像 30 天内有效，但统计数据（仓库/星标/关注者）随缓存一起过期，
        // 每次进入本方法都重新拉取，否则新建用户永远拿不到真实数据
        if (avatarAge < 30 * 24 * 60 * 60 * 1000) {
          avatarUrl = userData.avatarUrl;
        }
      }

      // 如果需要，从GitHub API获取新的头像URL
      {
        const httpClient = createRequest(8000);
        try {
          // 增加GitHub API调用计数
          global.githubApiCallCount = (global.githubApiCallCount || 0) + 1;
          
          const response = await httpClient.get(`https://api.github.com/users/${username}`, {
            headers: {
              'Accept': 'application/vnd.github.v3+json',
              'If-None-Match': '',
              'User-Agent': 'GitHub-Stats-Card',
              ...(githubConfig.apiToken ? { 'Authorization': `Bearer ${githubConfig.apiToken}` } : {})
            },
            validateStatus: status => status < 500
          });

          // 404 表示用户不存在：直接返回无效，避免伪造「全 0」的 200 卡片
          if (response.status === 404) {
            throw new Error('User not found');
          }

          // 403/429 是配额耗尽，不是「该用户 0 仓库 0 粉丝」：
          // 标记无效，让 controller 返回 no-store 错误卡，避免把限流结果缓存 10 分钟
          if (response.status === 403 || response.status === 429) {
            secureLogger.warn(`GitHub API 限流（${response.status}），不返回伪造数据: ${username}`);
            rateLimited = true;
          }

          if (response.status === 200 && response.data?.avatar_url) {
            avatarUrl = response.data.avatar_url;
          }
          if (response.status === 200 && response.data) {
            publicRepos = response.data.public_repos || 0;
            followers = response.data.followers || 0;
          }
          // 最近更新的至多 100 个仓库（GitHub API 单页上限）的 star 总和，
          // 非「最热 100 个」；public_repos > 100 时属系统性少算
          try {
            const repos = await httpClient.get(
              `https://api.github.com/users/${username}/repos?per_page=100&sort=updated`,
              {
                headers: {
                  'Accept': 'application/vnd.github.v3+json',
                  'User-Agent': 'GitHub-Stats-Card',
                  ...(githubConfig.apiToken ? { 'Authorization': `Bearer ${githubConfig.apiToken}` } : {})
                },
                validateStatus: status => status < 500
              }
            );
            if (repos.status === 403 || repos.status === 429) {
              secureLogger.warn(`GitHub API 限流（${repos.status}），星标数降级为 0: ${username}`);
            } else if (Array.isArray(repos.data)) {
              totalStars = repos.data.reduce((sum: number, r: any) => sum + (r.stargazers_count || 0), 0);
            }
          } catch (error) {
            secureLogger.error(`获取GitHub仓库失败: ${error}`);
          }
        } catch (error) {
          secureLogger.error(`获取GitHub头像失败: ${error}`);
        }
      }

      // 更新访问计数和头像URL（如果有新的）
      // 构造要更新的数据对象
      const updateData: Partial<IGitHubUser> = {
        ...(userData || {}),
        visitCount: (userData?.visitCount || 0) + 1,
        lastVisited: new Date(),
        lastUpdated: new Date(),
        ...(avatarUrl ? { avatarUrl, avatarUpdatedAt: userData?.avatarUrl === avatarUrl ? userData?.avatarUpdatedAt : new Date() } : {})
      };
      
      asyncDbUpdate(updateGitHubUserData, [username, updateData], 'GitHub');

      // 获取更新后的用户数据以获取最新的访问计数
      const { userData: updatedData } = await getGitHubUserData(username);

      if (rateLimited) {
        return {
          isValid: false,
          error: 'RATE_LIMITED',
          avatarUrl: null,
          visitCount: 0,
          publicRepos: 0,
          followers: 0,
          totalStars: 0
        };
      }

      return {
        isValid: true,
        avatarUrl: avatarUrl || null,
        visitCount: updatedData?.visitCount || 1,
        publicRepos,
        followers,
        totalStars
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'User not found') {
        return {
          isValid: false,
          error: 'USER_NOT_FOUND',
          avatarUrl: null,
          visitCount: 0,
          publicRepos: 0,
          followers: 0,
          totalStars: 0
        };
      }
      secureLogger.error(`获取GitHub用户统计失败: ${error}`);
      // 上游失败不应伪装成「全 0 的有效数据」：标记 isValid=false 让上层不缓存
      return {
        isValid: false,
        error: 'UPSTREAM_ERROR',
        avatarUrl: null,
        visitCount: 1,
        publicRepos: 0,
        followers: 0,
        totalStars: 0
      };
    }
  }
}

// 导出单例实例
export const githubService = new GitHubService();

// 生成SVG计数器
export function generateCounterSVG(count: number, avatarUrl: string): string {
  const colors = {
    bg: '#ffffff',
    border: '#e9ecef',
    text: '#343a40',
    count: '#6f42c1'
  };

  // 安全处理计数显示
  let countDisplay = count.toString();
  if (count >= 1000) {
    countDisplay = (count / 1000).toFixed(1) + 'k';
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="220" height="100" viewBox="0 0 220 100">
    <style>
      .text { font-family: Arial, sans-serif; font-size: 14px; fill: ${colors.text}; }
      .count { font-family: Arial, sans-serif; font-size: 24px; font-weight: bold; fill: ${colors.count}; }
      .small { font-family: Arial, sans-serif; font-size: 12px; fill: #6c757d; }
    </style>
    <rect width="220" height="100" fill="${colors.bg}" rx="10" ry="10" stroke="${colors.border}" stroke-width="1"/>
    <text x="30" y="40" class="text">访问数:</text>
    <text x="190" y="50" text-anchor="end" class="count">${countDisplay}</text>
    <image x="30" y="60" width="30" height="30" xlink:href="${avatarUrl}" />
    <text x="70" y="80" class="small">GitHub: @</text>
  </svg>`;
}

