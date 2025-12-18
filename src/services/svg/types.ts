/**
 * SVG服务相关类型定义
 */

/**
 * 卡片类型枚举
 */
export enum CardType {
  LEETCODE = 'leetcode',
  GITHUB = 'github',
  CSDN = 'csdn',
  JUEJIN = 'juejin',
  BILIBILI = 'bilibili',
  ERROR = 'error'
}

/**
 * 主题颜色配置
 */
export interface ThemeColors {
  background: string;
  border: string;
  text: {
    primary: string;
    secondary: string;
    title: string;
  };
  accent: {
    primary: string;
    secondary: string;
  };
  stats: {
    easy: string;
    medium: string;
    hard: string;
    total: string;
    count: string;
  };
}

/**
 * 主题字体配置
 */
export interface ThemeFonts {
  family: string;
  size: {
    small: string;
    normal: string;
    title: string;
  };
}

/**
 * 主题卡片配置
 */
export interface ThemeCard {
  borderRadius: string;
}

/**
 * 主题选项接口
 */
export interface ThemeOptions {
  colors: ThemeColors;
  fonts: ThemeFonts;
  card: ThemeCard;
}

/**
 * LeetCode用户数据接口
 */
export interface ILeetCodeUser {
  username: string;
  totalSolved: number;
  easySolved: number;
  mediumSolved: number;
  hardSolved: number;
  acceptanceRate: string;
  lastUpdated: Date;
  region: "US" | "CN";
  expireAt?: Date;
}

/**
 * 掘金用户数据接口
 */
export interface JuejinUserData {
  username: string;
  desc: string;
  followers: number;
  articleCount: number;
  likes: number;
  views: number;
}

/**
 * GitHub计数器卡片数据
 */
export interface GitHubCounterData {
  count: number;
  avatarUrl?: string | null;
  username?: string;
}
