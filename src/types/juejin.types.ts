export interface IJuejinUserData {
    user_id: string; // 用户ID
    user_name: string; // 用户名
    description: string; // 个人简介
    follower_count: number; // 关注人数
    got_digg_count: number; // 点赞数
    article_count: number; // 文章数
    got_view_count: number; // 阅读数
}

export interface JuejinUserData {
    userId: string;
    username: string;
    desc: string;
    articleCount: number;
    followers: number;
    likes: number;
    views: number;
    lastUpdated: Date;
    expireAt: Date;
    isValid: boolean;
}

export interface JuejinApiResponseData {
    user_id: string,
    user_name: string,
    description: string,
    follower_count: number,
    got_digg_count: number,
    article_count: number,
    got_view_count: number,
}

export interface JuejinApiResponse {
    err_no: number;
    err_msg: string;
    data: JuejinApiResponseData;
    count?: number;
}
