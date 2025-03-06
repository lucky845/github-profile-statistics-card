import { createRequest } from '../utils/http.utils';
import { LeetCodeStats } from '../types';

// 定义类型
interface SubmissionItem {
  difficulty: string;
  count: number;
  submissions: number;
}

// 从LeetCode获取用户数据
export async function fetchLeetCodeStats(
  username: string, 
  useCN: boolean = false
): Promise<{ success: boolean; data?: LeetCodeStats; error?: string }> {
  try {
    const httpClient = createRequest();

    // 如果指定了使用中国区，则使用中国区特定的查询
    if (useCN) {
      // 中国区特定的GraphQL查询
      const cnQuery = `
        query userProfileUserQuestionProgress($userSlug: String!) {
          userProfileUserQuestionProgress(userSlug: $userSlug) {
            numAcceptedQuestions {
              difficulty
              count
            }
            numFailedQuestions {
              difficulty
              count
            }
            numUntouchedQuestions {
              difficulty
              count
            }
          }
        }
      `;

      const cnVariables = { userSlug: username };
      
      try {
        const response = await httpClient.post(
          "https://leetcode.cn/graphql",
          {
            query: cnQuery,
            variables: cnVariables,
          }
        );

        if (response?.data?.data?.userProfileUserQuestionProgress) {
          return processCNLeetCodeResponse(response.data.data.userProfileUserQuestionProgress, username);
        }
        return { success: false, error: '未找到中国区LeetCode用户数据' };
      } catch (error: any) {
        return { 
          success: false, 
          error: `获取中国区LeetCode数据失败: ${error.message}` 
        };
      }
    } else {
      // 美区LeetCode的GraphQL查询
      const usQuery = `
        query userProblemsSolved($username: String!) {
          matchedUser(username: $username) {
            submitStats {
              acSubmissionNum {
                difficulty
                count
                submissions
              }
              totalSubmissionNum {
                difficulty
                count
                submissions
              }
            }
          }
        }
      `;

      const usVariables = { username };
      
      try {
        const response = await httpClient.post(
          "https://leetcode.com/graphql",
          {
            query: usQuery,
            variables: usVariables,
          }
        );

        if (response?.data?.data?.matchedUser) {
          return processUSLeetCodeResponse(response.data.data.matchedUser, username);
        }
        return { success: false, error: '未找到美国区LeetCode用户数据' };
      } catch (error: any) {
        return { 
          success: false, 
          error: `获取美国区LeetCode数据失败: ${error.message}` 
        };
      }
    }
  } catch (error: any) {
    console.error(`获取LeetCode数据失败:`, error);
    return {
      success: false,
      error: error.message || '获取LeetCode数据时出错',
    };
  }
}

// 处理LeetCode美区响应数据
function processUSLeetCodeResponse(
  userData: any, 
  username: string
): { success: boolean; data?: LeetCodeStats; error?: string } {
  try {
    // 确保用户数据和提交数据存在
    if (userData && userData.submitStats && userData.submitStats.acSubmissionNum) {
      const submitStats = userData.submitStats;
      
      // 提取难度级别的数据
      const acDifficultyData = new Map<string, SubmissionItem>();
      submitStats.acSubmissionNum.forEach((item: SubmissionItem) => {
        acDifficultyData.set(item.difficulty, item);
      });

      // 计算接受率
      let totalSubmissions = 0;
      let totalAccepted = 0;
      
      submitStats.acSubmissionNum.forEach((item: SubmissionItem) => {
        totalAccepted += item.submissions || 0;
      });
      
      submitStats.totalSubmissionNum.forEach((item: SubmissionItem) => {
        totalSubmissions += item.submissions || 0;
      });
      
      const acceptanceRate = totalSubmissions > 0 
        ? ((totalAccepted / totalSubmissions) * 100).toFixed(1) + '%' 
        : '0%';

      // 创建数据对象
      const data: LeetCodeStats = {
        region: 'US',
        username,
        totalSolved: acDifficultyData.get('All')?.count || 0,
        easySolved: acDifficultyData.get('Easy')?.count || 0,
        mediumSolved: acDifficultyData.get('Medium')?.count || 0,
        hardSolved: acDifficultyData.get('Hard')?.count || 0,
        acceptanceRate,
        lastUpdated: new Date(),
      };
      
      return { success: true, data };
    }
    
    return { success: false, error: '用户数据格式无效' };
  } catch (error: any) {
    return { 
      success: false, 
      error: `处理LeetCode美区响应数据出错: ${error.message}` 
    };
  }
}

// 处理LeetCode中国区响应数据
function processCNLeetCodeResponse(
  userData: any, 
  username: string
): { success: boolean; data?: LeetCodeStats; error?: string } {
  try {
    // 确保用户数据和已接受题目数据存在
    if (userData && userData.numAcceptedQuestions) {
      // 提取难度级别的数据
      const difficulties = new Map<string, number>();
      
      let total = 0;
      userData.numAcceptedQuestions.forEach((item: any) => {
        difficulties.set(item.difficulty, item.count);
        total += item.count;
      });
      
      // 计算接受率 - 中国区API可能没有提供直接的通过率
      // 我们可以从已通过和已失败题目数量计算
      let totalAttempted = 0;
      let totalAccepted = total;
      
      userData.numAcceptedQuestions.forEach((item: any) => {
        totalAttempted += item.count;
      });
      
      userData.numFailedQuestions.forEach((item: any) => {
        totalAttempted += item.count;
      });
      
      const acceptanceRate = totalAttempted > 0 
        ? ((totalAccepted / totalAttempted) * 100).toFixed(1) + '%' 
        : '0%';

      // 创建数据对象
      const data: LeetCodeStats = {
        region: 'CN',
        username,
        totalSolved: total,
        easySolved: difficulties.get('EASY') || 0,
        mediumSolved: difficulties.get('MEDIUM') || 0,
        hardSolved: difficulties.get('HARD') || 0,
        acceptanceRate,
        lastUpdated: new Date(),
      };
      
      return { success: true, data };
    }
    
    return { success: false, error: '用户数据格式无效' };
  } catch (error: any) {
    return { 
      success: false, 
      error: `处理LeetCode中国区响应数据出错: ${error.message}` 
    };
  }
}

// 生成LeetCode统计SVG
export function generateLeetCodeSVG(data: import('../types').ILeetCodeUser | null): string {
  if (!data) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="120" viewBox="0 0 495 120">
      <rect width="495" height="120" fill="#f8f9fa" rx="10" ry="10"/>
      <text x="247.5" y="60" font-family="Arial, sans-serif" font-size="14" text-anchor="middle" fill="#dc3545">
        未找到LeetCode用户数据
      </text>
    </svg>`;
  }

  const colors = {
    easy: '#00b8a3',
    medium: '#ffc01e',
    hard: '#ff375f',
    total: '#3c4b64',
    bg: '#ffffff',
    border: '#e9ecef',
    text: '#343a40',
  };

  // 计算解题百分比
  const easySolved = data.easySolved || 0;
  const mediumSolved = data.mediumSolved || 0;
  const hardSolved = data.hardSolved || 0;
  const totalSolved = data.totalSolved || 0;

  // 生成SVG
  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="195" viewBox="0 0 495 195">
    <style>
      .text { font-family: Arial, sans-serif; font-size: 14px; fill: ${colors.text}; }
      .header { font-family: Arial, sans-serif; font-size: 20px; font-weight: bold; fill: ${colors.text}; }
      .small { font-family: Arial, sans-serif; font-size: 12px; fill: #6c757d; }
      .easy { fill: ${colors.easy}; }
      .medium { fill: ${colors.medium}; }
      .hard { fill: ${colors.hard}; }
      .total { fill: ${colors.total}; }
    </style>
    <rect width="495" height="195" fill="${colors.bg}" rx="10" ry="10" stroke="${colors.border}" stroke-width="1"/>
    <text x="30" y="40" class="header">LeetCode 解题统计</text>
    <text x="465" y="40" text-anchor="end" class="small">用户: ${data.username}</text>
    
    <rect x="30" y="60" width="435" height="1" fill="${colors.border}"/>
    
    <text x="30" y="90" class="text">总计解题:</text>
    <text x="465" y="90" text-anchor="end" class="text total">${totalSolved}</text>
    
    <text x="30" y="120" class="text">简单:</text>
    <text x="465" y="120" text-anchor="end" class="text easy">${easySolved}</text>
    
    <text x="30" y="150" class="text">中等:</text>
    <text x="465" y="150" text-anchor="end" class="text medium">${mediumSolved}</text>
    
    <text x="30" y="180" class="text">困难:</text>
    <text x="465" y="180" text-anchor="end" class="text hard">${hardSolved}</text>
    
    <text x="250" y="90" text-anchor="middle" class="small">通过率: ${data.acceptanceRate}</text>
    <text x="465" y="180" text-anchor="end" class="small" dy="15" font-size="10">更新于: ${new Date(data.lastUpdated).toLocaleDateString()}</text>
  </svg>`;
} 