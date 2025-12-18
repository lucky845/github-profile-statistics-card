/**
 * 异步执行数据库更新操作的工具函数
 * @param updateFunction 数据库更新函数
 * @param args 更新函数的参数
 * @param serviceName 服务名称，用于日志记录
 * @param maxRetries 最大重试次数
 * @param retryDelay 重试延迟（毫秒）
 */
export async function asyncDbUpdate<T extends (...args: any[]) => Promise<any>>(
  updateFunction: T,
  args: Parameters<T>,
  serviceName: string,
  maxRetries: number = 3,
  retryDelay: number = 1000
): Promise<void> {
  let retryCount = 0;
  
  // 使用IIFE包装异步操作，避免阻塞主流程
  (async () => {
    while (retryCount <= maxRetries) {
      try {
        await updateFunction(...args);
        console.log(`✅ ${serviceName} - 数据库更新成功`);
        return;
      } catch (error: any) {
        retryCount++;
        if (retryCount > maxRetries) {
          console.error(`❌ ${serviceName} - 数据库更新失败（已重试${maxRetries}次）: ${error.message}`);
          return;
        }
        console.warn(`⚠️  ${serviceName} - 数据库更新失败，第${retryCount}/${maxRetries}次重试: ${error.message}`);
        // 指数退避策略
        await new Promise(resolve => setTimeout(resolve, retryDelay * Math.pow(2, retryCount - 1)));
      }
    }
  })().catch(error => {
    console.error(`❌ ${serviceName} - 数据库更新异常: ${error instanceof Error ? error.message : '未知错误'}`);
  });
}
