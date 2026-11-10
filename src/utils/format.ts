/**
 * 数值与日期格式化
 *
 * 全站唯一的格式化实现。生成器与首页都从这里取，禁止再各写一套。
 */

/**
 * 计数：<1000 原值，<1e4 一位小数如 9.8k，<1e6 整数 k，>=1e6 一位小数 M
 */
export const formatCount = (n: number | null | undefined): string => {
  if (n === null || n === undefined || Number.isNaN(n)) return '0';
  if (n < 1000) return String(Math.round(n));
  if (n < 10000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1000000) return Math.round(n / 1000) + 'k';
  return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
};

/** 百分比：0~100 的一位小数 */
export const formatPercent = (pct: number | null | undefined): string => {
  if (pct === null || pct === undefined || Number.isNaN(pct)) return '—';
  return (Math.round(pct * 10) / 10).toString() + '%';
};

/** 日期：统一 YYYY-MM-DD */
export const formatDate = (ts: number | Date | null | undefined): string => {
  const d = ts instanceof Date ? ts : new Date(ts ?? Date.now());
  if (Number.isNaN(d.getTime())) return '';
  const pad = (v: number) => String(v).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
