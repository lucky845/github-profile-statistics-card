/**
 * CSDN 卡片生成器（495×200 统一画布）
 */
import { ThemeOptions } from '../types';
import { generateErrorCard } from './errorCardGenerator';
import { CARD, COLUMN, LAYOUT, SPACE, TYPE, WEIGHT } from '../../../config/design-tokens';
import { frame, header, divider, footer, text, pill, badge } from '../components';
import { formatCount, formatDate } from '../../../utils/format';

export interface CSDNCardInput {
  username?: string;
  avatarUrl?: string | null;
  articleCount?: number;
  followers?: number;
  rank?: number;
  views?: number;
  likes?: number;
  comments?: number;
  collects?: number;
  points?: number;
  monthPoints?: number;
  codeAge?: string | number;
  level?: number | string;
}

const CSDN_BRAND = '#fc5531';

export const generateCSDNCard = (data: CSDNCardInput, theme: ThemeOptions): string => {
  if (!data) return generateErrorCard('无法获取CSDN数据', theme);
  if (data instanceof String) return generateErrorCard(data as unknown as string, theme);

  const {
    username = 'Unknown',
    avatarUrl,
    articleCount = 0,
    followers = 0,
    rank = 0,
    views = 0,
    points = 0,
    codeAge,
    level,
  } = data;

  const levelText = level !== undefined && level !== null && String(level) !== 'N/A' ? `Lv.${level}` : '';
  const right = levelText ? badge(theme, levelText, CSDN_BRAND) : '';

  const stats = [
    { label: '原创', value: formatCount(articleCount) },
    { label: '粉丝', value: formatCount(followers) },
    { label: '排名', value: rank > 0 ? formatCount(rank) : '—' },
    { label: '总访问量', value: formatCount(views) },
  ];

  // 次行：码龄 / 积分胶囊
  const chips: { svg: string; width: number }[] = [];
  let chipX = CARD.padding;
  const codeAgeText = codeAge !== undefined && String(codeAge).trim() !== '' ? `码龄 ${String(codeAge).replace('码龄', '').trim()}` : '';
  if (codeAgeText) {
    const p = pill(chipX, LAYOUT.dividerTop + 84, codeAgeText, theme.colors.text.secondary);
    chips.push(p);
    chipX += p.width;
  }
  if (points > 0) {
    const p = pill(chipX, LAYOUT.dividerTop + 84, `原力 ${formatCount(points)}`, CSDN_BRAND);
    chips.push(p);
    chipX += p.width;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}" role="img" aria-label="CSDN 统计卡片">
    <title>${username} 的 CSDN 统计</title>
    ${frame(theme)}
    ${header(theme, { title: 'CSDN', subtitle: '技术博客影响力', dot: CSDN_BRAND, avatarUrl, initial: username, right })}
    ${divider(LAYOUT.dividerTop, theme)}
    ${stats.map((s, i) => {
      const x = COLUMN.startX + i * COLUMN.width;
      return `${text(x, LAYOUT.statValueBaseline, s.value, { size: TYPE.value, weight: WEIGHT.semibold, fill: theme.colors.text.primary, mono: true })}
      ${text(x, LAYOUT.statValueBaseline + TYPE.label + 7, s.label, { size: TYPE.label, fill: theme.colors.text.secondary })}`;
    }).join('\n    ')}
    ${chips.map(c => c.svg).join('\n    ')}
    ${footer(theme, 'CSDN Statistics', `更新于 ${formatDate(Date.now())}`)}
  </svg>`;
};
