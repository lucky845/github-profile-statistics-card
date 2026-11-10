/**
 * 共享 SVG 组件
 *
 * 所有生成器只允许用这些函数拼装卡片，避免每张卡各画一套。
 * 这里输出的都是纯字符串片段，不做主题决策——主题由调用方传进来。
 */
import { ThemeOptions } from '../types';
import { CARD, FONT_FAMILY, RADIUS, SPACE, TYPE, WEIGHT } from '../../../config/design-tokens';

/** HTML/XML 属性转义 */
export const escapeAttr = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** 文本节点转义 */
export const escapeText = escapeAttr;

/** 按字符数截断，超出补省略号 */
export const truncate = (s: string, max: number): string =>
  !s ? '' : s.length > max ? s.slice(0, max) + '…' : s;

/** 只允许 http/https 与 data:image 的头像地址；其余返回 null */
const IMG_ALLOW = new RegExp('^(https?://|data:image/(png|jpe?g|gif|webp|svg\\+xml);base64,)', 'i');
export const safeImageUrl = (url?: string | null): string | null => {
  if (!url) return null;
  const trimmed = url.trim();
  return IMG_ALLOW.test(trimmed) ? trimmed : null;
};

export interface FrameOpts {
  width?: number;
  height?: number;
}

/** 卡片底板：背景 + 圆角 + 边框 */
export const frame = (theme: ThemeOptions, opts: FrameOpts = {}): string => {
  const w = opts.width ?? CARD.width;
  const h = opts.height ?? CARD.height;
  return `<rect width="${w}" height="${h}" rx="${RADIUS.card}" ry="${RADIUS.card}" fill="${theme.colors.background}" stroke="${theme.colors.border}" stroke-width="1"/>`;
};

/** 通用文本 */
export const text = (
  x: number,
  y: number,
  value: string,
  opts: {
    size?: number;
    weight?: number;
    fill: string;
    anchor?: 'start' | 'middle' | 'end';
    mono?: boolean;
    opacity?: number;
  }
): string => {
  const attrs = [
    `x="${x}"`,
    `y="${y}"`,
    `font-family="${FONT_FAMILY}"`,
    `font-size="${opts.size ?? TYPE.value}"`,
    `font-weight="${opts.weight ?? WEIGHT.regular}"`,
    `fill="${opts.fill}"`,
  ];
  if (opts.anchor && opts.anchor !== 'start') attrs.push(`text-anchor="${opts.anchor}"`);
  if (opts.mono) attrs.push('font-variant-numeric="tabular-nums"');
  if (opts.opacity !== undefined) attrs.push(`opacity="${opts.opacity}"`);
  return `<text ${attrs.join(' ')}>${escapeText(value)}</text>`;
};

/**
 * 头像：圆形裁切。没有头像时画首字母圆形占位。
 * 必须同时输出 href 与 xlink:href —— 部分渲染器只认后者。
 */
export const avatar = (
  x: number,
  y: number,
  size: number,
  url: string | null | undefined,
  fallbackText: string,
  theme: ThemeOptions
): string => {
  const r = size / 2;
  const cx = x + r;
  const cy = y + r;
  const safe = safeImageUrl(url);
  if (!safe) {
    const initial = (fallbackText || '?').trim().charAt(0).toUpperCase() || '?';
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${theme.colors.accent.primary}" opacity="0.15"/>
      ${text(cx, cy + TYPE.heading * 0.36, initial, { size: TYPE.heading, weight: WEIGHT.semibold, fill: theme.colors.accent.primary, anchor: 'middle' })}`;
  }
  const href = escapeAttr(safe);
  return `<clipPath id="avatar-clip"><circle cx="${cx}" cy="${cy}" r="${r}"/></clipPath>
    <image x="${x}" y="${y}" width="${size}" height="${size}" clip-path="url(#avatar-clip)" href="${href}" xlink:href="${href}" preserveAspectRatio="xMidYMid slice"/>`;
};

export interface HeaderOpts {
  title: string;
  subtitle?: string;
  /** 左侧品牌圆点颜色 */
  dot?: string;
  /** 右侧附加内容（徽章 / 用户名） */
  right?: string;
  avatarUrl?: string | null;
  initial: string;
}

/** 头部：头像 + 标题 + 副标题 + 右侧内容 */
export const header = (theme: ThemeOptions, opts: HeaderOpts): string => {
  const avatarSize = 48;
  const textX = CARD.padding + avatarSize + SPACE[3];
  const centerY = CARD.padding + avatarSize / 2;
  const titleY = opts.subtitle ? centerY - 3 : centerY + TYPE.heading * 0.36;
  const parts = [avatar(CARD.padding, CARD.padding, avatarSize, opts.avatarUrl, opts.initial, theme)];
  if (opts.dot) {
    parts.push(`<circle cx="${textX + 3}" cy="${titleY - TYPE.heading * 0.35}" r="3" fill="${opts.dot}"/>`);
  }
  const titleX = opts.dot ? textX + 12 : textX;
  parts.push(text(titleX, titleY, opts.title, { size: TYPE.heading, weight: WEIGHT.semibold, fill: theme.colors.text.primary }));
  if (opts.subtitle) {
    parts.push(text(textX, titleY + SPACE[4] + 4, truncate(opts.subtitle, 42), { size: TYPE.label, fill: theme.colors.text.secondary }));
  }
  if (opts.right) parts.push(opts.right);
  return parts.join('\n    ');
};

/** 分隔线 */
export const divider = (y: number, theme: ThemeOptions): string =>
  `<line x1="${CARD.padding}" y1="${y}" x2="${CARD.width - CARD.padding}" y2="${y}" stroke="${theme.colors.border}" stroke-width="1"/>`;

export interface StatItem {
  label: string;
  value: string;
  tone?: 'accent' | 'muted' | 'success' | 'warn' | 'danger';
}

const toneColor = (tone: StatItem['tone'], theme: ThemeOptions): string => {
  switch (tone) {
    case 'accent':
      return theme.colors.accent.primary;
    case 'muted':
      return theme.colors.text.secondary;
    case 'success':
      return theme.colors.stats.easy;
    case 'warn':
      return theme.colors.stats.medium;
    case 'danger':
      return theme.colors.stats.hard;
    default:
      return theme.colors.text.primary;
  }
};

/** 单列统计：数值在上，标签在下 */
export const statColumn = (
  x: number,
  y: number,
  item: StatItem,
  theme: ThemeOptions,
  valueSize: number = TYPE.value
): string =>
  `${text(x, y, item.value, { size: valueSize, weight: WEIGHT.semibold, fill: toneColor(item.tone, theme), mono: true })}
    ${text(x, y + TYPE.label + 7, item.label, { size: TYPE.label, fill: theme.colors.text.secondary })}`;

/** 底部页脚：左文案 + 右文案 */
export const footer = (theme: ThemeOptions, left: string, right?: string): string => {
  const parts = [text(CARD.padding, 186, left, { size: TYPE.caption, fill: theme.colors.text.secondary })];
  if (right) {
    parts.push(text(CARD.width - CARD.padding, 186, right, { size: TYPE.caption, fill: theme.colors.text.secondary, anchor: 'end' }));
  }
  return parts.join('\n    ');
};

/** 右上角状态徽章（缓存 / 降级） */
export const badge = (
  theme: ThemeOptions,
  label: string,
  color: string,
  x: number = CARD.width - CARD.padding,
  y: number = CARD.padding + 6
): string => {
  const width = label.length * 8 + 12;
  return `<rect x="${x - width}" y="${y}" width="${width}" height="18" rx="9" fill="${color}" opacity="0.12"/>
    ${text(x - width / 2, y + 13, label, { size: TYPE.caption, weight: WEIGHT.medium, fill: color, anchor: 'middle' })}`;
};

/** 横向进度条 */
export const progressBar = (
  x: number,
  y: number,
  width: number,
  pct: number,
  color: string,
  trackColor: string
): string => {
  const clamped = Math.max(0, Math.min(1, pct));
  const filled = Math.round(width * clamped);
  const height = 6;
  const fill = filled > 0 ? `<rect x="${x}" y="${y}" width="${filled}" height="${height}" rx="${RADIUS.bar}" fill="${color}"/>` : '';
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${RADIUS.bar}" fill="${trackColor}" opacity="0.6"/>${fill}`;
};

/** 胶囊标签，返回片段与宽度（便于横向排布） */
export const pill = (
  x: number,
  y: number,
  label: string,
  color: string
): { svg: string; width: number } => {
  const width = Math.round(label.length * TYPE.label * 0.62 + SPACE[3]);
  const svg = `<rect x="${x}" y="${y}" width="${width}" height="18" rx="9" fill="${color}" opacity="0.12"/>
    ${text(x + width / 2, y + 13, label, { size: TYPE.caption, weight: WEIGHT.medium, fill: color, anchor: 'middle' })}`;
  return { svg, width: width + SPACE[2] };
};
