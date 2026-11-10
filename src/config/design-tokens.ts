/**
 * 设计令牌
 *
 * 所有卡片共用一套间距 / 字号 / 圆角 / 字体常量。
 * 任何生成器都不允许写字面量字号——必须从这里取，否则 5 张卡会再次分叉。
 */

export const SPACE = { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40 } as const;

export const RADIUS = { card: 8, pill: 999, bar: 4 } as const;

/** 字号阶梯 */
export const TYPE = {
  display: 26,
  heading: 16,
  value: 18,
  label: 11,
  caption: 10,
} as const;

export const WEIGHT = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

// 注意：不能在这里用双引号包裹字体名。SVG 里 font-family 属性本身用双引号，
// 内部再出现双引号会把属性在第一个引号处截断，整条字体栈失效。
export const FONT_FAMILY =
  "-apple-system,BlinkMacSystemFont,Segoe UI,Noto Sans SC,PingFang SC,Microsoft YaHei,Helvetica,Arial,sans-serif";

export const FONT_MONO =
  "ui-monospace,SFMono-Regular,SF Mono,Menlo,Consolas,Liberation Mono,monospace";

/** 统一画布 */
export const CARD = {
  width: 495,
  height: 200,
  padding: 20,
} as const;

/** 内容区宽度 */
export const CONTENT_WIDTH = CARD.width - CARD.padding * 2;

/** 画布纵向分区（y 坐标） */
export const LAYOUT = {
  avatarY: 20,
  headerBaseline: 42,
  subtitleBaseline: 60,
  dividerTop: 76,
  statValueBaseline: 124,
  statLabelBaseline: 142,
  dividerBottom: 160,
  footerBaseline: 186,
} as const;

/** 4 列统计的列宽与起始 x */
export const COLUMN = {
  width: CONTENT_WIDTH / 4,
  startX: CARD.padding,
} as const;
