/**
 * 错误卡片生成器
 *
 * 和正常卡片共用同一张 495x200 画布与设计令牌：README 里降级卡会
 * 和真卡并排出现，尺寸/字体一旦不一致就会显得错位。
 */
import { ThemeOptions } from '../types';
import { SvgSanitizerService } from '../utils/svgSanitizer';
import { CARD, TYPE, WEIGHT, FONT_FAMILY, RADIUS } from '../../../config/design-tokens';
import { escapeText, truncate } from '../components';

/**
 * 生成错误卡片
 * @param message 错误信息
 * @param theme 主题配置
 * @returns SVG字符串
 */
export const generateErrorCard = (message: string, theme: ThemeOptions): string => {
  const safeMessage = escapeText(truncate(SvgSanitizerService.sanitizeUserContent(message), 40));
  // 主题里没有 danger 色，错误态统一用 GitHub 的红色强调色
  const accent = '#cf222e';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD.width}" height="${CARD.height}" viewBox="0 0 ${CARD.width} ${CARD.height}">
  <rect width="${CARD.width}" height="${CARD.height}" fill="${theme.colors.background}" rx="${RADIUS.card}" ry="${RADIUS.card}" stroke="${theme.colors.border}" stroke-width="1"/>
  <circle cx="${CARD.width / 2}" cy="${CARD.height / 2 - 34}" r="14" fill="none" stroke="${accent}" stroke-width="2"/>
  <text x="${CARD.width / 2}" y="${CARD.height / 2 - 29}" font-family="${FONT_FAMILY}" font-size="${TYPE.heading}" font-weight="${WEIGHT.bold}" text-anchor="middle" fill="${accent}">!</text>
  <text x="${CARD.width / 2}" y="${CARD.height / 2 + 8}" font-family="${FONT_FAMILY}" font-size="${TYPE.label + 2}" text-anchor="middle" fill="${theme.colors.text.primary}">${safeMessage}</text>
  <text x="${CARD.width / 2}" y="${CARD.height / 2 + 30}" font-family="${FONT_FAMILY}" font-size="${TYPE.caption}" text-anchor="middle" fill="${theme.colors.text.secondary}">稍后会自动恢复</text>
</svg>`;

  return SvgSanitizerService.sanitize(svg);
};
