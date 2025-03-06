export interface ICSDNUser {
  userId: string;
  username: string;
  articleCount: number;
  followers: number;
  likes: number;
  views: number;
  comments: number;
  points: number;
  avatarUrl?: string;
  visitCount: number;
  lastUpdated: Date;
  rank?: number;
  codeAge?: number;
  level?: number;
  monthPoints?: number;
} 