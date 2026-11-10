// 定义GitHub用户数据接口
export interface IGitHubUser {
  username: string;
  publicRepos: number;
  followers: number;
  totalStars: number;
}
