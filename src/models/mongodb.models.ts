import mongoose from 'mongoose';
import {IBilibiliUser, ICSDNUser, IGitHubUser, ILeetCodeUser} from '../types';

// GitHub用户数据模型
export const GitHubUser = mongoose.model<IGitHubUser>('GitHubUser', new mongoose.Schema({
    username: {type: String, required: true, unique: true},
    visitCount: {type: Number, default: 0},
    lastVisited: {type: Date, default: Date.now},
    lastUpdated: {type: Date, default: Date.now},
    avatarUrl: {type: String, default: null},
    avatarUpdatedAt: {type: Date, default: Date.now},
}));

// LeetCode用户数据模型
const leetCodeUserSchema = new mongoose.Schema({
    username: {type: String, required: true, unique: true},
    totalSolved: {type: Number, default: 0},
    easySolved: {type: Number, default: 0},
    mediumSolved: {type: Number, default: 0},
    hardSolved: {type: Number, default: 0},
    acceptanceRate: {type: String, default: '0%'},
    lastUpdated: {type: Date, default: Date.now},
    region: {type: String, enum: ['US', 'CN'], default: 'US'},
    expireAt: {type: Date, default: null}
});

// 添加TTL索引
leetCodeUserSchema.index({expireAt: 1}, {expireAfterSeconds: 0});

export const LeetCodeUser = mongoose.model<ILeetCodeUser>('LeetCodeUser', leetCodeUserSchema);

// CSDN用户数据模型
const csdnUserSchema = new mongoose.Schema({
    userId: {type: String, required: true, unique: true},
    username: {type: String, default: ''},
    articleCount: {type: Number, default: 0},
    followers: {type: Number, default: 0},
    likes: {type: Number, default: 0},
    views: {type: Number, default: 0},
    comments: {type: Number, default: 0},
    points: {type: Number, default: 0},
    avatarUrl: {type: String, default: null},
    visitCount: {type: Number, default: 0},
    lastUpdated: {type: Date, default: Date.now},
    rank: {type: Number, default: null},
    codeAge: {type: String, default: 0},
    level: {type: Number, default: null},
    monthPoints: {type: Number, default: null},
    expireAt: {type: Date, default: null}
});

// 添加TTL索引
csdnUserSchema.index({expireAt: 1}, {expireAfterSeconds: 0});

export const CSDNUser = mongoose.model<ICSDNUser>('CSDNUser', csdnUserSchema);

// juejin 用户数据模型
const juejinUserSchema = new mongoose.Schema({
    userId: {type: String, required: true, unique: true},
    username: {type: String, default: ''},
    desc: {type: String, default: ''},
    articleCount: {type: Number, default: 0},
    followers: {type: Number, default: 0},
    likes: {type: Number, default: 0},
    views: {type: Number, default: 0},
    lastUpdated: {type: Date, default: Date.now},
    expireAt: {type: Date, default: null}
});

// 添加TTL索引
juejinUserSchema.index({expireAt: 1}, {expireAfterSeconds: 0});

export const JueJinUser = mongoose.model<ICSDNUser>('JueJinUser', juejinUserSchema);

const bilibiliUserSchema = new mongoose.Schema({
    uid: {type: String, required: true, unique: true},
    username: {type: String, required: true},
    level: {type: Number, required: true},
    sign: {type: String, default: ''},

    followers: {type: Number, default: 0},
    following: {type: Number, default: 0},
    likes: {type: Number, default: 0},
    views: {type: Number, default: 0},

    lastUpdated: {type: Date, default: Date.now},
    expireAt: {type: Date, default: null}
});

// 添加TTL索引
bilibiliUserSchema.index({expireAt: 1}, {expireAfterSeconds: 0});

export const BilibiliUser = mongoose.model<IBilibiliUser>('BilibiliUser', bilibiliUserSchema);
