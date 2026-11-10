/**
 * 哔哩哔哩卡片生成器（495×200 统一画布）
 *
 * 旧实现根本不画头像；这里补上，并加等级徽章。
 */
import { ThemeOptions } from '../types';
import { generateErrorCard } from './errorCardGenerator';
import { CARD, COLUMN, LAYOUT, TYPE, WEIGHT } from '../../../config/design-tokens';
import { frame, header, divider, footer, text, badge } from '../components';
import { formatCount, formatDate } from '../../../utils/format';

export interface BilibiliCardInput {
  uid?: string;
  username?: string;
  level?: number;
  sign?: string;
  avatarUrl?: string | null;
  followers?: number;
  following?: number;
  likes?: number;
  views?: number;
}

const BILIBILI_BRAND = '#00aeec';

export const generateBilibiliCard = (data: BilibiliCardInput, theme: ThemeOptions): string => {
  if (!data) return generateErrorCard('无法获取哔哩哔哩数据', theme);
  if (data instanceof String) return generateErrorCard(data as unknown as string, theme);

  const { uid = '', username, level = 0, sign = '', avatarUrl, followers = 0, following = 0, likes = 0, views = 0 } = data;
  const displayName = username || uid || 'Unknown';

  const stats = [
    { label: '粉丝', value: formatCount(followers) },
    { label: '关注', value: formatCount(following) },
    { label: '获赞', value: formatCount(likes) },
    { label: '播放', value: formatCount(views) },
  ];

  const right = level > 0 ? badge(theme, `Lv.${level}`, BILIBILI_BRAND) : '';
  const signLine = sign ? text(CARD.padding, LAYOUT.dividerTop + 92, sign.length > 56 ? sign.slice(0, 56) + '…' : sign, { size: TYPE.label, fill: theme.colors.text.secondary }) : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}" role="img" aria-label="哔哩哔哩统计卡片">
    <title>${displayName} 的哔哩哔哩统计</title>
    ${frame(theme)}
    ${header(theme, { title: '哔哩哔哩', subtitle: 'UP 主数据', dot: BILIBILI_BRAND, avatarUrl, initial: displayName, right })}
    ${divider(LAYOUT.dividerTop, theme)}
    ${stats.map((s, i) => {
      const x = COLUMN.startX + i * COLUMN.width;
      return `${text(x, LAYOUT.statValueBaseline, s.value, { size: TYPE.value, weight: WEIGHT.semibold, fill: theme.colors.text.primary, mono: true })}
      ${text(x, LAYOUT.statValueBaseline + TYPE.label + 7, s.label, { size: TYPE.label, fill: theme.colors.text.secondary })}`;
    }).join('\n    ')}
    ${signLine}
    ${footer(theme, 'Bilibili Statistics', `更新于 ${formatDate(Date.now())}`)}
  </svg>`;
};
