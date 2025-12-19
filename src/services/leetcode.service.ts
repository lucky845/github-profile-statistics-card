import axios from 'axios';
import { createRequest, createRequestWithRetry } from '../utils/http.utils';
import { LeetCodeStats } from '../types';
import { secureLogger } from '../utils/logger';

// 扩展全局变量类型
declare global {
  var leetcodeApiCallCount: number;
}// 定义类型
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
    // 增加超时时间到5秒，避免因网络延迟导致的请求失败
    const request = createRequest(5000, {
      headers: {
        'Origin': useCN ? 'https://leetcode.cn' : 'https://leetcode.com',
        'Referer': useCN ? `https://leetcode.cn/u/${username}/` : `https://leetcode.com/${username}/`
      }
    });

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
        // 增加LeetCode API调用计数
        global.leetcodeApiCallCount = (global.leetcodeApiCallCount || 0) + 1;
        
        // 使用带重试机制的请求
        const response = await createRequestWithRetry(() => request.post(
          "https://leetcode.cn/graphql",
          {
            query: cnQuery,
            variables: cnVariables,
          }
        ), 3, 1000);

        if (response?.data?.data?.userProfileUserQuestionProgress) {
          return processCNLeetCodeResponse(response.data.data.userProfileUserQuestionProgress, username);
        }
        return { success: false, error: '未找到中国区LeetCode用户数据' };
      } catch (error: any) {
        secureLogger.warn(`获取中国区LeetCode数据失败: ${error.message}`);
        // API调用失败时返回错误
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
        // 增加LeetCode API调用计数
        global.leetcodeApiCallCount = (global.leetcodeApiCallCount || 0) + 1;
        
        const response = await createRequestWithRetry(() => request.post(
          "https://leetcode.com/graphql",
          {
            query: usQuery,
            variables: usVariables,
          }
        ), 3, 1000);

        if (response?.data?.data?.matchedUser) {
          return processUSLeetCodeResponse(response.data.data.matchedUser, username);
        }
        return { success: false, error: '未找到美国区LeetCode用户数据' };
      } catch (error: any) {
        secureLogger.warn(`获取美国区LeetCode数据失败: ${error.message}`);
        // API调用失败时返回错误
        return { 
          success: false, 
          error: `获取美国区LeetCode数据失败: ${error.message}` 
        };
      }
    }
  } catch (error: any) {
    secureLogger.error(`获取LeetCode数据失败:`, error);
    // 整体请求失败时返回错误
    return {
      success: false,
      error: `获取LeetCode数据失败: ${error instanceof Error ? error.message : '未知错误'}`
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
