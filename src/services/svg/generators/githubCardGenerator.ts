/**
 * GitHub 卡片生成器（495×200 统一画布）
 */
import { ThemeOptions } from '../types';
import { generateErrorCard } from './errorCardGenerator';
import { COLUMN, CARD, LAYOUT, TYPE } from '../../../config/design-tokens';
import { frame, header, divider, statColumn, footer, StatItem } from '../components';
import { formatCount, formatDate } from '../../../utils/format';

export interface GitHubCardInput {
  count?: number;
  username?: string;
  publicRepos?: number;
  followers?: number;
  totalStars?: number;
}

/** GitHub 品牌色 */
const GITHUB_DOT = '#1f2328';

export const generateGitHubCounterCard = (data: GitHubCardInput, theme: ThemeOptions): string => {
  if (!data) return generateErrorCard('无法获取GitHub数据', theme);
  if (data instanceof String) return generateErrorCard(data as unknown as string, theme);

  const { count = 0, username, publicRepos = 0, followers = 0, totalStars = 0 } = data;
  const displayName = username || 'Unknown';

  const stats: StatItem[] = [
    { label: '仓库', value: formatCount(publicRepos) },
    { label: '星标', value: formatCount(totalStars) },
    { label: '关注者', value: formatCount(followers) },
    { label: '访问', value: formatCount(count) },
  ];

  const right = `<text x="${CARD.width - CARD.padding}" y="${LAYOUT.headerBaseline}" font-family="inherit" font-size="${TYPE.label}" fill="${theme.colors.text.secondary}" text-anchor="end">@${displayName}</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}" role="img" aria-label="GitHub 统计卡片">
    <title>${displayName} 的 GitHub 统计</title>
    ${frame(theme)}
    ${header(theme, { title: 'GitHub', subtitle: '开源仓库与影响力', dot: GITHUB_DOT, right })}
    ${divider(LAYOUT.dividerTop, theme)}
    ${stats.map((item, i) => statColumn(COLUMN.startX + i * COLUMN.width, LAYOUT.statValueBaseline, item, theme)).join('\n    ')}
    ${divider(LAYOUT.dividerBottom, theme)}
    ${footer(theme, 'GitHub Profile Statistics', `更新于 ${formatDate(Date.now())}`)}
  </svg>`;
};
