// 定义LeetCode用户数据接口
export interface ILeetCodeUser {
  username: string;
  totalSolved: number;
  easySolved: number;
  mediumSolved: number;
  hardSolved: number;
  acceptanceRate: string;
  lastUpdated: Date;
  region: "US" | "CN";
  expireAt: Date;
}

export interface LeetCodeStats {
  region: "US" | 'CN';
  username: string;
  totalSolved: number;
  easySolved: number;
  mediumSolved: number;
  hardSolved: number;
  acceptanceRate: string;
  lastUpdated: Date;
} 