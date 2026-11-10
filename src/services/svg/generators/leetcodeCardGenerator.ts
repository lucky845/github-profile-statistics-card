/**
 * LeetCode 卡片生成器（495×200 统一画布）
 *
 * 三档难度条长度 = 已解 / 该难度真实总题数。旧实现把总题数写死 2000，
 * 百分比是编的；上游没给总题数时宁可显示 '—' 也不猜。
 */
import { ILeetCodeUser, ThemeOptions } from '../types';
import { generateErrorCard } from './errorCardGenerator';
import { CARD, COLUMN, LAYOUT, SPACE, TYPE, WEIGHT } from '../../../config/design-tokens';
import { frame, header, divider, footer, text, progressBar } from '../components';
import { formatDate, formatCount } from '../../../utils/format';

export interface LeetCodeCardInput extends Partial<ILeetCodeUser> {
  totalProblems?: { easy: number; medium: number; hard: number };
  ranking?: number;
}

const LEETCODE_DOT = '#ffa116';

interface DifficultyRow {
  label: string;
  solved: number;
  total?: number;
  color: string;
}

export const generateLeetCodeCard = (data: LeetCodeCardInput | string, theme: ThemeOptions): string => {
  if (!data || (data instanceof String && data.length === 0)) {
    return generateErrorCard('无法获取LeetCode数据', theme);
  }
  if (data instanceof String) return generateErrorCard(data as string, theme);

  const {
    username = 'Unknown',
    totalSolved = 0,
    easySolved = 0,
    mediumSolved = 0,
    hardSolved = 0,
    acceptanceRate = '—',
    region,
      ranking,
    totalProblems,
  } = data as LeetCodeCardInput;

  const rows: DifficultyRow[] = [
    { label: '简单', solved: easySolved, total: totalProblems?.easy, color: theme.colors.stats.easy },
    { label: '中等', solved: mediumSolved, total: totalProblems?.medium, color: theme.colors.stats.medium },
    { label: '困难', solved: hardSolved, total: totalProblems?.hard, color: theme.colors.stats.hard },
  ];

  const regionLabel = region === 'CN' ? '中国站' : region === 'US' ? '国际站' : '';
  const right = regionLabel
    ? `<rect x="${CARD.width - CARD.padding - 58}" y="${CARD.padding + 6}" width="58" height="18" rx="9" fill="${LEETCODE_DOT}" opacity="0.14"/>
       ${text(CARD.width - CARD.padding - 29, CARD.padding + 19, regionLabel, { size: TYPE.caption, weight: WEIGHT.medium, fill: LEETCODE_DOT, anchor: 'middle' })}`
    : '';

  // 主行：已解题数（大字号） + 通过率 + 排名
  const totalKnown = totalProblems
    ? totalProblems.easy + totalProblems.medium + totalProblems.hard
    : 0;
  const solvedHeadline = totalKnown > 0 ? `${formatCount(totalSolved)}/${formatCount(totalKnown)}` : formatCount(totalSolved);

  const columnWidth = COLUMN.width * 1.4;
  const mainRow = [
    text(COLUMN.startX, LAYOUT.dividerTop + 32, '已解决', { size: TYPE.label, fill: theme.colors.text.secondary }),
    text(COLUMN.startX, LAYOUT.dividerTop + 60, solvedHeadline, { size: TYPE.display, weight: WEIGHT.semibold, fill: theme.colors.text.primary, mono: true }),
    text(COLUMN.startX + columnWidth, LAYOUT.dividerTop + 32, '通过率', { size: TYPE.label, fill: theme.colors.text.secondary }),
    text(COLUMN.startX + columnWidth, LAYOUT.dividerTop + 52, acceptanceRate, { size: TYPE.value, weight: WEIGHT.semibold, fill: theme.colors.stats.easy, mono: true }),
  ];
  if (ranking && ranking > 0) {
    mainRow.push(text(COLUMN.startX + columnWidth * 2, LAYOUT.dividerTop + 32, '排名', { size: TYPE.label, fill: theme.colors.text.secondary }));
    mainRow.push(text(COLUMN.startX + columnWidth * 2, LAYOUT.dividerTop + 52, formatCount(ranking), { size: TYPE.value, weight: WEIGHT.semibold, fill: theme.colors.text.primary, mono: true }));
  }

  // 三档难度条：横向并排，塞在 dividerTop 与 dividerBottom 之间
  const barWidth = 108;
  const barStartY = LAYOUT.dividerTop + 74;
  const barGap = COLUMN.width;
  const bars = rows.map((row, i) => {
    const x = COLUMN.startX + i * barGap;
    const pct = row.total && row.total > 0 ? row.solved / row.total : 0;
    const countLabel = row.total ? `${formatCount(row.solved)}/${formatCount(row.total)}` : formatCount(row.solved);
    return [
      text(x, barStartY, row.label, { size: TYPE.label, fill: theme.colors.text.secondary }),
      text(x + barWidth, barStartY, countLabel, { size: TYPE.caption, weight: WEIGHT.medium, fill: row.color, mono: true, anchor: 'end' }),
      progressBar(x, barStartY + SPACE[2], barWidth, pct, row.color, theme.colors.border),
    ].join('\n      ');
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}" role="img" aria-label="LeetCode 统计卡片">
    <title>${username} 的 LeetCode 统计</title>
    ${frame(theme)}
    ${header(theme, { title: 'LeetCode', subtitle: '刷题进度与通过率', dot: LEETCODE_DOT, right })}
    ${divider(LAYOUT.dividerTop, theme)}
    ${mainRow.join('\n    ')}
    ${bars.join('\n    ')}
    ${divider(LAYOUT.dividerBottom, theme)}
    ${footer(theme, 'LeetCode Statistics', `更新于 ${formatDate(Date.now())}`)}
  </svg>`;
};