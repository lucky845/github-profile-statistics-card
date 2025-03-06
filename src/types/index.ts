export * from './common.types';
export * from './leetcode.types';
export * from './github.types';

export interface IGitHubUser {
  username: string;
  visitCount: number;
  lastVisited: Date;
  lastUpdated: Date;
  avatarUrl?: string;
  avatarUpdatedAt: Date;
} 