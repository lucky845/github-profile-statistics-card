/**
 * SVG内容清理工具，防止XSS攻击
 */
export class SvgSanitizerService {
  /**
   * 清理用户提供的内容，防止XSS攻击
   * @param content 用户提供的内容
   * @returns 清理后的安全内容
   */
  static sanitizeUserContent(content: string): string {
    if (!content) return '';
    
    // 移除潜在的危险字符和脚本标签
    return content
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;')
      .replace(/javascript:/gi, '')
      .replace(/data:/gi, '')
      .replace(/expression\(/gi, '')
      .replace(/on\w+\s*=/gi, '');
  }

  /**
   * 清理完整的SVG内容
   * @param svgContent SVG内容
   * @returns 清理后的SVG内容
   */
  static sanitize(svgContent: string): string {
    if (!svgContent) return '';
    
    // 移除潜在的危险元素和属性
    let sanitized = svgContent
      // 移除script标签
      .replace(/<script[^>]*>.*?<\/script>/gi, '')
      // 移除on*属性
      .replace(/on\w+\s*=\s*(["'])(.*?)\1/gi, '')
      // 移除style标签中的危险内容
      .replace(/<style[^>]*>.*?<\/style>/gi, (match) => {
        return match.replace(/expression\(/gi, '')
                   .replace(/javascript:/gi, '')
                   .replace(/data:/gi, '');
      });
    
    return sanitized;
  }

  /**
   * 格式化数字，大于1000的数字以k为单位，大于1000000的以M为单位
   * @param num 需要格式化的数字
   * @returns 格式化后的字符串
   */
  static formatNumber(num: number): string {
    if (num >= 1000000) {
      return (num / 1000000).toFixed(1) + 'M';
    } else if (num >= 1000) {
      return (num / 1000).toFixed(1) + 'K';
    }
    return num.toString();
  }
}