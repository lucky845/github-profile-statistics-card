/**
 * 全局变量初始化文件
 * 初始化用于统计的全局变量
 */

// 扩展全局变量类型
declare global {
  var requestCount: number;
  var requestCountLastHour: number;
  var githubApiCallCount: number;
  var leetcodeApiCallCount: number;
}

// 初始化请求计数器
global.requestCount = 0;

// 初始化最近一小时请求计数器
global.requestCountLastHour = 0;

// 初始化GitHub API调用计数器
global.githubApiCallCount = 0;

// 初始化LeetCode API调用计数器
global.leetcodeApiCallCount = 0;

// 导出一个空对象，确保这个文件可以被导入
export {};