// 内存缓存接口定义
export interface MemoryCache {
  leetcode: { [key: string]: import('./leetcode.types').ILeetCodeUser };
  github: { [key: string]: import('./github.types').IGitHubUser };
  csdn: { [key: string]: import('./csdn.types').ICSDNUser };
  juejin: {[key: string]: import('./juejin.types').JuejinUserData};
} 