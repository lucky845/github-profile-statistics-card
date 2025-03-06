import { activeTheme, ThemeOptions } from '../config/theme.config';
import { ILeetCodeUser, IGitHubUser } from '../types';

// 卡片类型定义
export enum CardType {
  LEETCODE = 'leetcode',
  GITHUB = 'github',
  ERROR = 'error'
}

/**
 * 生成错误卡片
 * @param message 错误信息
 * @param theme 主题配置
 * @returns SVG字符串
 */
export function generateErrorCard(message: string, theme: ThemeOptions = activeTheme): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="120" viewBox="0 0 495 120">
    <rect width="495" height="120" fill="${theme.colors.background}" rx="${theme.card.borderRadius}" ry="${theme.card.borderRadius}" stroke="${theme.colors.border}" stroke-width="1"/>
    <text x="247.5" y="60" font-family="${theme.fonts.family}" font-size="${theme.fonts.size.normal}" text-anchor="middle" fill="#dc3545">
      ${message}
    </text>
  </svg>`;
}

/**
 * 生成LeetCode统计卡片
 * @param data LeetCode用户数据
 * @param theme 主题配置
 * @returns SVG字符串
 */
export function generateLeetCodeCard(data: ILeetCodeUser | null, theme: ThemeOptions = activeTheme): string {
  if (!data) {
    return generateErrorCard('未找到LeetCode用户数据');
  }

  const easySolved = data.easySolved || 0;
  const mediumSolved = data.mediumSolved || 0;
  const hardSolved = data.hardSolved || 0;
  const totalSolved = data.totalSolved || 0;

  // 获取region信息 (如果有)
  const region = data.region || 'US';
  const regionColor = region === 'CN' ? '#e74c3c' : '#3498db';

  // 生成SVG - 增加高度为205，为底部文本留出更多空间
  return `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="205" viewBox="0 0 495 205">
    <style>
      .text { font-family: ${theme.fonts.family}; font-size: ${theme.fonts.size.normal}; fill: ${theme.colors.text.primary}; }
      .header { font-family: ${theme.fonts.family}; font-size: ${theme.fonts.size.title}; font-weight: bold; fill: ${theme.colors.text.title}; }
      .small { font-family: ${theme.fonts.family}; font-size: ${theme.fonts.size.small}; fill: ${theme.colors.text.secondary}; }
      .easy { fill: ${theme.colors.stats.easy}; }
      .medium { fill: ${theme.colors.stats.medium}; }
      .hard { fill: ${theme.colors.stats.hard}; }
      .total { fill: ${theme.colors.stats.total}; }
      .region-pill { font-family: ${theme.fonts.family}; font-size: 12px; font-weight: bold; fill: #ffffff; }
    </style>
    <rect width="495" height="205" fill="${theme.colors.background}" rx="${theme.card.borderRadius}" ry="${theme.card.borderRadius}" stroke="${theme.colors.border}" stroke-width="1"/>
    <text x="30" y="40" class="header">LeetCode 解题统计</text>
    
    <!-- 区域标识 -->
    <rect x="442" y="25" width="30" height="20" rx="10" ry="10" fill="${regionColor}" />
    <text x="457" y="39" text-anchor="middle" class="region-pill">${region}</text>
    
    <!-- 调整用户名位置，避免与区域标识重叠 -->
    <text x="380" y="40" text-anchor="end" class="small">用户: ${data.username}</text>
    
    <rect x="30" y="60" width="435" height="1" fill="${theme.colors.border}"/>
    
    <text x="30" y="90" class="text">总计解题:</text>
    <text x="465" y="90" text-anchor="end" class="text total">${totalSolved}</text>
    
    <text x="30" y="120" class="text">简单:</text>
    <text x="465" y="120" text-anchor="end" class="text easy">${easySolved}</text>
    
    <text x="30" y="150" class="text">中等:</text>
    <text x="465" y="150" text-anchor="end" class="text medium">${mediumSolved}</text>
    
    <text x="30" y="180" class="text">困难:</text>
    <text x="465" y="180" text-anchor="end" class="text hard">${hardSolved}</text>
    
    <text x="250" y="90" text-anchor="middle" class="small">通过率: ${data.acceptanceRate}</text>
    <!-- 调整更新时间的位置，将其移到更低的位置以防止截断 -->
    <text x="400" y="195" text-anchor="end" class="small" font-size="10">更新于: ${new Date(data.lastUpdated).toLocaleDateString()}</text>
  </svg>`;
}

/**
 * 生成GitHub访问计数卡片
 * @param count 访问计数
 * @param avatarUrl 头像URL
 * @param username 用户名
 * @param theme 主题配置
 * @returns SVG字符串
 */
export function generateGitHubCounterCard(
  count: number, 
  avatarUrl: string | null = null, 
  username: string = '',
  theme: ThemeOptions = activeTheme
): string {
  // 安全处理计数显示
  let countDisplay = count.toString();
  if (count >= 1000) {
    countDisplay = (count / 1000).toFixed(1) + 'k';
  }

  // 计算当前日期
  const currentDate = new Date().toLocaleDateString('zh-CN');

  // 优化的基本SVG - 现代化设计
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="140" viewBox="0 0 320 140">
    <defs>
      <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${theme.colors.background}" />
        <stop offset="100%" stop-color="${theme.colors.background}DD" />
      </linearGradient>
      <filter id="dropShadow" x="-5%" y="-5%" width="110%" height="110%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-color="#00000033" />
      </filter>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&amp;display=swap');
        .container { filter: url(#dropShadow); }
        .text { font-family: 'Inter', ${theme.fonts.family}; font-size: ${theme.fonts.size.normal}; fill: ${theme.colors.text.primary}; }
        .count { font-family: 'Inter', ${theme.fonts.family}; font-size: 42px; font-weight: 700; fill: ${theme.colors.stats.count}; }
        .small { font-family: 'Inter', ${theme.fonts.family}; font-size: ${theme.fonts.size.small}; fill: ${theme.colors.text.secondary}; }
        .title { font-family: 'Inter', ${theme.fonts.family}; font-size: ${theme.fonts.size.title}; font-weight: 600; fill: ${theme.colors.text.title}; }
        .date { font-family: 'Inter', ${theme.fonts.family}; font-size: 10px; fill: ${theme.colors.text.secondary}; }
        .github-icon { fill: ${theme.colors.text.title}; }
      </style>
    </defs>
    
    <g class="container">
      <!-- 背景和边框 -->
      <rect width="320" height="140" fill="url(#bgGradient)" rx="${theme.card.borderRadius}" ry="${theme.card.borderRadius}" stroke="${theme.colors.border}" stroke-width="1"/>
    `;

  // 添加用户头像或默认GitHub图标
  if (avatarUrl) {
    svg += `
      <!-- 用户头像 -->
      <g transform="translate(20, 30)">
        <!-- 圆形头像背景 -->
        <circle cx="18" cy="18" r="18" fill="#FFFFFF" />
        <!-- 用户头像 - 剪裁为圆形 -->
        <clipPath id="userAvatarClip">
          <circle cx="18" cy="18" r="18" />
        </clipPath>
        <image x="0" y="0" width="36" height="36" href="${avatarUrl}" clip-path="url(#userAvatarClip)" />
      </g>
      
      <!-- 用户名和标题 -->
      <text x="70" y="38" class="title">GitHub 访问</text>
      <text x="70" y="58" class="small">@${username}</text>
    `;
  } else {
    svg += `
      <!-- GitHub 图标 -->
      <svg x="20" y="28" width="36" height="36" viewBox="0 0 24 24" class="github-icon">
        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
      </svg>
      
      <!-- 标题 -->
      <text x="70" y="45" class="title">GitHub 访问</text>
    `;
  }
      
  // 添加计数和更新日期
  svg += `
      <!-- 计数 -->
      <text x="160" y="95" text-anchor="middle" class="count">${countDisplay}</text>
      
      <!-- 分隔线 -->
      <line x1="40" y1="110" x2="280" y2="110" stroke="${theme.colors.border}" stroke-width="0.5" opacity="0.5"/>
      
      <!-- 更新日期 -->
      <text x="280" y="129" text-anchor="end" class="date">更新于: ${currentDate}</text>
    </g>
  </svg>`;

  return svg;
}

/**
 * 通用卡片生成器 - 根据类型生成对应的卡片
 * @param type 卡片类型
 * @param data 卡片数据
 * @param theme 主题配置
 * @returns SVG字符串
 */
export function generateCard(
  type: CardType, 
  data: any, 
  theme: ThemeOptions = activeTheme
): string {
  switch (type) {
    case CardType.LEETCODE:
      return generateLeetCodeCard(data as ILeetCodeUser, theme);
    
    case CardType.GITHUB:
      if (typeof data === 'number') {
        return generateGitHubCounterCard(data, null, '', theme);
      } else if (data && typeof data === 'object') {
        const { count, avatarUrl, username } = data;
        return generateGitHubCounterCard(count, avatarUrl, username, theme);
      }
      return generateErrorCard('GitHub数据格式错误');
    
    case CardType.ERROR:
      return generateErrorCard(data as string, theme);
    
    default:
      return generateErrorCard('未知卡片类型');
  }
} 