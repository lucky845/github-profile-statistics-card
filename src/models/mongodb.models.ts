import mongoose from 'mongoose';
import {IBilibiliUser, ICSDNUser, IGitHubUser, ILeetCodeUser} from '../types';

// GitHub用户数据模型
const githubUserSchema = new mongoose.Schema<IGitHubUser>({
    username: {type: String, required: true, unique: true},
    visitCount: {type: Number, default: 0},
    lastVisited: {type: Date, default: Date.now},
    lastUpdated: {type: Date, default: Date.now},
    avatarUrl: {type: String, default: null},
    avatarUpdatedAt: {type: Date, default: Date.now},
}, { timestamps: true });

// 添加索引以优化查询性能
githubUserSchema.index({ username: 1 }, { unique: true });
githubUserSchema.index({ lastVisited: -1 });
githubUserSchema.index({ visitCount: -1 });
githubUserSchema.index({ avatarUpdatedAt: 1 });

export const GitHubUser = mongoose.model<IGitHubUser>('GitHubUser', githubUserSchema);

// LeetCode用户数据模型
const leetCodeUserSchema = new mongoose.Schema<ILeetCodeUser>({
    username: {type: String, required: true, unique: true},
    totalSolved: {type: Number, default: 0},
    easySolved: {type: Number, default: 0},
    mediumSolved: {type: Number, default: 0},
    hardSolved: {type: Number, default: 0},
    acceptanceRate: {type: String, default: '0%'},
    lastUpdated: {type: Date, default: Date.now},
    region: {type: String, enum: ['US', 'CN'], default: 'US'},
    expireAt: {type: Date, default: null}
}, { timestamps: true });

// 添加索引以优化查询和过期处理
leetCodeUserSchema.index({ username: 1 }, { unique: true });
leetCodeUserSchema.index({ lastUpdated: 1 });
leetCodeUserSchema.index({ totalSolved: -1 });
leetCodeUserSchema.index({ acceptanceRate: 1 });
leetCodeUserSchema.index({ region: 1 });
leetCodeUserSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const LeetCodeUser = mongoose.model<ILeetCodeUser>('LeetCodeUser', leetCodeUserSchema);

// CSDN用户数据模型
const csdnUserSchema = new mongoose.Schema<ICSDNUser>({
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
}, { timestamps: true });

// 添加索引以优化查询和过期处理
csdnUserSchema.index({ userId: 1 }, { unique: true });
csdnUserSchema.index({ username: 1 });
csdnUserSchema.index({ articleCount: -1 });
csdnUserSchema.index({ followers: -1 });
csdnUserSchema.index({ visitCount: -1 });
csdnUserSchema.index({ lastUpdated: 1 });
csdnUserSchema.index({ rank: 1 });
csdnUserSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const CSDNUser = mongoose.model<ICSDNUser>('CSDNUser', csdnUserSchema);

// juejin 用户数据模型
const juejinUserSchema = new mongoose.Schema<any>({
    userId: {type: String, required: true, unique: true},
    username: {type: String, default: ''},
    desc: {type: String, default: ''},
    articleCount: {type: Number, default: 0},
    followers: {type: Number, default: 0},
    likes: {type: Number, default: 0},
    views: {type: Number, default: 0},
    lastUpdated: {type: Date, default: Date.now},
    expireAt: {type: Date, default: null}
}, { timestamps: true });

// 添加索引以优化查询和过期处理
juejinUserSchema.index({ userId: 1 }, { unique: true });
juejinUserSchema.index({ username: 1 });
juejinUserSchema.index({ articleCount: -1 });
juejinUserSchema.index({ followers: -1 });
juejinUserSchema.index({ lastUpdated: 1 });
juejinUserSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const JueJinUser = mongoose.model('JueJinUser', juejinUserSchema);

const bilibiliUserSchema = new mongoose.Schema<IBilibiliUser>({
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
}, { timestamps: true });

// 添加索引以优化查询和过期处理
bilibiliUserSchema.index({ uid: 1 }, { unique: true });
bilibiliUserSchema.index({ username: 1 });
bilibiliUserSchema.index({ level: -1 });
bilibiliUserSchema.index({ followers: -1 });
bilibiliUserSchema.index({ lastUpdated: 1 });
bilibiliUserSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const BilibiliUser = mongoose.model<IBilibiliUser>('BilibiliUser', bilibiliUserSchema);

// 通用键值对存储模型
const keyValueSchema = new mongoose.Schema({
    key: {type: String, required: true, unique: true, index: true},
    value: {type: mongoose.Schema.Types.Mixed, required: true},
    ttl: {type: Number, default: null}, // 过期时间（秒）
    expireAt: {type: Date, default: null, index: {expireAfterSeconds: 0}}, // 自动过期时间
    createdAt: {type: Date, default: Date.now},
    updatedAt: {type: Date, default: Date.now}
}, { timestamps: true });

// 添加中间件自动设置过期时间
keyValueSchema.pre('save', function(next) {
    if (this.ttl && this.ttl > 0) {
        this.expireAt = new Date(Date.now() + this.ttl * 1000);
    }
    this.updatedAt = new Date();
    next();
});

// 添加索引
keyValueSchema.index({ key: 1 }, { unique: true });
keyValueSchema.index({ expireAt: 1 }, { expireAfterSeconds: 0 });

export const KeyValueStore = mongoose.model('KeyValueStore', keyValueSchema);
