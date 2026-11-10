/**
 * 掘金卡片生成器（495×200 统一画布）
 *
 * 掘金官方 user API 已静默失效：返回 err_no:0 但 user_id='0'、所有计数为 0。
 * 这种‘看起来成功’的响应必须在数据层被拦掉（见 juejin.service.ts 的 shape guard），
 * 卡片只负责如实渲染，identity 字段缺失时用降级文案。
 */
import { ThemeOptions } from '../types';
import { generateErrorCard } from './errorCardGenerator';
import { CARD, COLUMN, LAYOUT, TYPE, WEIGHT } from '../../../config/design-tokens';
import { frame, header, divider, footer, text } from '../components';
import { formatCount, formatDate } from '../../../utils/format';

export interface JuejinCardInput {
  username?: string;
  desc?: string;
  avatarUrl?: string | null;
  followers?: number;
  articleCount?: number;
  likes?: number;
  views?: number;
}

const JUEJIN_BRAND = '#1e80ff';

export const generateJuejinCard = (data: JuejinCardInput, theme: ThemeOptions): string => {
  if (!data) return generateErrorCard('无法获取掘金数据', theme);
  if (data instanceof String) return generateErrorCard(data as unknown as string, theme);

  const { username = 'Unknown', desc = '', avatarUrl, followers = 0, articleCount = 0, likes = 0, views = 0 } = data;

  const stats = [
    { label: '文章', value: formatCount(articleCount) },
    { label: '浏览', value: formatCount(views) },
    { label: '点赞', value: formatCount(likes) },
    { label: '粉丝', value: formatCount(followers) },
  ];

  const descLine = desc ? text(CARD.padding, LAYOUT.dividerTop + 92, desc.length > 56 ? desc.slice(0, 56) + '…' : desc, { size: TYPE.label, fill: theme.colors.text.secondary }) : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}" role="img" aria-label="掘金统计卡片">
    <title>${username} 的掘金统计</title>
    ${frame(theme)}
    ${header(theme, { title: '掘金', subtitle: '技术内容创作', dot: JUEJIN_BRAND, avatarUrl, initial: username })}
    ${divider(LAYOUT.dividerTop, theme)}
    ${stats.map((s, i) => {
      const x = COLUMN.startX + i * COLUMN.width;
      return `${text(x, LAYOUT.statValueBaseline, s.value, { size: TYPE.value, weight: WEIGHT.semibold, fill: theme.colors.text.primary, mono: true })}
      ${text(x, LAYOUT.statValueBaseline + TYPE.label + 7, s.label, { size: TYPE.label, fill: theme.colors.text.secondary })}`;
    }).join('\n    ')}
    ${descLine}
    ${footer(theme, 'Juejin Statistics', `更新于 ${formatDate(Date.now())}`)}
  </svg>`;
};
