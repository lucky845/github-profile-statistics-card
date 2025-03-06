// 定义GitHub用户数据接口
export interface IGitHubUser {
  username: string;
  visitCount: number;
  lastVisited: Date;
  lastUpdated: Date;
  avatarUrl?: string; // 添加GitHub头像URL字段，用于缓存
  avatarUpdatedAt?: Date; // 添加头像更新时间字段，用于缓存
} 