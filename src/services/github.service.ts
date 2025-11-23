import { createRequest } from '../utils/http.utils';
import { getGitHubUserData, updateGitHubUserData } from './mongodb.service';

// 获取GitHub用户数据（包括头像和访问计数）
export async function getGitHubUserStats(username: string): Promise<{
  isValid: boolean;
  avatarUrl: string | null;
  visitCount: number;
}> {
  try {
    // 先从MongoDB中获取用户数据
    const { userData } = await getGitHubUserData(username);
    let avatarUrl = null;
    let needFetchAvatar = true;

    // 检查缓存的头像URL是否有效（30天内）
    if (userData?.avatarUrl && userData.avatarUpdatedAt) {
      const avatarAge = new Date().getTime() - new Date(userData.avatarUpdatedAt).getTime();
      if (avatarAge < 30 * 24 * 60 * 60 * 1000) {
        avatarUrl = userData.avatarUrl;
        needFetchAvatar = false;
      }
    }

    // 如果需要，从GitHub API获取新的头像URL
    if (needFetchAvatar) {
      const httpClient = createRequest(8000);
      try {
        const response = await httpClient.get(`https://api.github.com/users/${username}`, {
          headers: {
            'Accept': 'application/vnd.github.v3+json',
            'If-None-Match': '',
            'User-Agent': 'GitHub-Stats-Card'
          },
          validateStatus: status => status < 500
        });

        if (response.status === 200 && response.data?.avatar_url) {
          avatarUrl = response.data.avatar_url;
        }
      } catch (error) {
        console.error(`获取GitHub头像失败: ${error}`);
      }
    }

    // 更新访问计数和头像URL（如果有新的）
    await updateGitHubUserData(username, userData, needFetchAvatar ? avatarUrl : undefined);

    // 获取更新后的用户数据以获取最新的访问计数
    const { userData: updatedData } = await getGitHubUserData(username);

    return {
      isValid: true,
      avatarUrl: avatarUrl || null,
      visitCount: updatedData?.visitCount || 1
    };
  } catch (error) {
    console.error(`获取GitHub用户统计失败: ${error}`);
    return {
      isValid: true,
      avatarUrl: null,
      visitCount: 1
    };
  }
}

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