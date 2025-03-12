export interface IBilibiliUser {
    // 用户基本信息
    uid: string;
    username: string;
    level: number;
    sign: string;

    // 统计数据
    followers: number;    // 粉丝数
    following: number;    // 关注数
    likes: number;       // 获赞数
    views: number;       // 播放量

    // 系统字段
    lastUpdated: Date;   // 最后更新时间
    isValid?: boolean;
    expireAt?: Date;
} 