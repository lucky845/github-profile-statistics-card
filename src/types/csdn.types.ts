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

// CSDN用户数据接口
export interface CSDNUserStats {
    userId: string;
    username: string;
    articleCount: number;
    followers: number;
    likes: number;
    views: number;
    comments: number;
    points: number;
    rank?: number;
    codeAge?: string | number;
    level?: number | string;
    monthPoints?: number;
    isValid: boolean;
    expireAt: Date;
}
