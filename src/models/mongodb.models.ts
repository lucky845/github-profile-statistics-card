import mongoose from 'mongoose';
import { ILeetCodeUser, IGitHubUser } from '../types';

// LeetCode用户数据模型
export const LeetCodeUser = mongoose.model<ILeetCodeUser>('LeetCodeUser', new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  totalSolved: { type: Number, default: 0 },
  easySolved: { type: Number, default: 0 },
  mediumSolved: { type: Number, default: 0 },
  hardSolved: { type: Number, default: 0 },
  acceptanceRate: { type: String, default: '0%' },
  lastUpdated: { type: Date, default: Date.now },
  region: { type: String, enum: ['US', 'CN'], default: 'US' }
}));

// GitHub用户数据模型
export const GitHubUser = mongoose.model<IGitHubUser>('GitHubUser', new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  visitCount: { type: Number, default: 0 },
  lastVisited: { type: Date, default: Date.now },
  lastUpdated: { type: Date, default: Date.now },
  avatarUrl: { type: String, default: null },
  avatarUpdatedAt: { type: Date, default: Date.now },
})); 