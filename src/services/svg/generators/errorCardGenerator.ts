/**
 * 错误卡片生成器
 */
import { ThemeOptions } from '../types';
import { SvgSanitizerService } from '../utils/svgSanitizer';

/**
 * 生成错误卡片
 * @param message 错误信息
 * @param theme 主题配置
 * @returns SVG字符串
 */
export const generateErrorCard = (message: string, theme: ThemeOptions): string => {
  // 安全处理错误消息
  const safeMessage = SvgSanitizerService.sanitizeUserContent(message);
  
  // 生成SVG内容
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="495" height="120" viewBox="0 0 495 120">
    <rect width="495" height="120" fill="${theme.colors.background}" rx="${theme.card.borderRadius}" ry="${theme.card.borderRadius}" stroke="${theme.colors.border}" stroke-width="1"/>
    <text x="247.5" y="60" font-family="${theme.fonts.family}" font-size="${theme.fonts.size.normal}" text-anchor="middle" fill="#dc3545">
       ${safeMessage}
     </text>
   </svg>`;
  
  return SvgSanitizerService.sanitize(svg);
};
