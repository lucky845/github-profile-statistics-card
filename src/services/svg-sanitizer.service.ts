/**
 * SVG净化服务 - 用于过滤潜在的恶意SVG内容，防止XSS攻击
 */
import createDOMPurify from 'dompurify';
import { JSDOM } from 'jsdom';
import { secureLogger } from '../utils/logger';

// 创建DOMPurify实例
const window = new JSDOM('').window;
const dompurify = createDOMPurify(window);

// 添加属性净化钩子
dompurify.addHook('afterSanitizeAttributes', (node: any) => {
  // 只允许特定的image来源
  if (node.tagName === 'image') {
    const src = node.getAttribute('xlink:href') || node.getAttribute('href');
    if (src) {
      // 允许的域名白名单
      const allowedDomains = [
        'avatars.githubusercontent.com',
        'avatars0.githubusercontent.com',
        'avatars1.githubusercontent.com',
        'avatars2.githubusercontent.com',
        'avatars3.githubusercontent.com',
        'cdn.jsdelivr.net',
        'lh3.googleusercontent.com',
        'secure.gravatar.com',
        'static.cloudflareinsights.com',
        'api.dicebear.com'
      ];
      
      // 检查是否为允许的URL格式
      const isAllowedUrl = src.startsWith('http://') || src.startsWith('https://');
      const hasAllowedDomain = allowedDomains.some(domain => {
        try {
          const url = new URL(src);
          return url.hostname === domain;
        } catch {
          return src.includes(domain);
        }
      });
      
      // 如果不是允许的URL格式或不包含允许的域名，则移除该属性
      if (!isAllowedUrl || !hasAllowedDomain) {
        if (node.hasAttribute('xlink:href')) {
          node.removeAttribute('xlink:href');
        }
        if (node.hasAttribute('href')) {
          node.removeAttribute('href');
        }
      }
    }
  }
});

/**
 * SVG内容过滤选项
 */
export interface SvgSanitizerOptions {
  allowExternalResources?: boolean; // 是否允许外部资源
  allowedAttributes?: string[]; // 允许的属性列表
  allowedTags?: string[]; // 允许的标签列表
}

/**
 * SVG净化服务
 */
export class SvgSanitizerService {
  /**
   * 净化SVG内容（静态方法，供其他服务调用）
   * @param svgContent 原始SVG内容
   * @param options 过滤选项
   * @returns 净化后的SVG内容
   */
  static sanitize(svgContent: string, options: SvgSanitizerOptions = {}): string {
    // 配置DOMPurify选项
    const dompurifyOptions = {
      USE_PROFILES: { svg: true, svgFilters: true },
      ALLOWED_TAGS: options.allowedTags || [
        'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon',
        'text', 'tspan', 'textPath', 'linearGradient', 'radialGradient', 'stop',
        'defs', 'clipPath', 'mask', 'filter', 'feGaussianBlur', 'feColorMatrix',
        'feComponentTransfer', 'feFuncR', 'feFuncG', 'feFuncB', 'feFuncA',
        'feBlend', 'feOffset', 'feMerge', 'feMergeNode', 'feTurbulence',
        'feDisplacementMap', 'feComposite', 'feMorphology', 'feConvolveMatrix',
        'feSpecularLighting', 'fePointLight', 'feSpotLight', 'feDistantLight',
        'marker', 'symbol', 'use', 'image'
      ],
      ALLOWED_ATTR: options.allowedAttributes || [
        'xmlns', 'xmlns:xlink', 'version', 'baseProfile', 'width', 'height',
        'viewBox', 'preserveAspectRatio', 'x', 'y', 'cx', 'cy', 'r', 'rx', 'ry',
        'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
        'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit',
        'stroke-dasharray', 'stroke-dashoffset', 'stroke-opacity', 'opacity',
        'transform', 'patternTransform', 'gradientTransform', 'text-anchor',
        'font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing',
        'word-spacing', 'text-decoration', 'text-rendering', 'textLength',
        'startOffset', 'd', 'pathLength', 'marker-start', 'marker-mid',
        'marker-end', 'markerWidth', 'markerHeight', 'refX', 'refY', 'orient',
        'overflow', 'filter', 'clip-path', 'mask', 'id', 'class', 'style',
        'href', 'xlink:href', 'x1', 'y1', 'x2', 'y2', 'offset', 'stop-color',
        'stop-opacity', 'stdDeviation', 'in', 'in2', 'result', 'operator',
        'mode', 'type', 'values', 'scale', 'kernelMatrix', 'kernelUnitLength',
        'preserveAlpha', 'surfaceScale', 'specularConstant', 'specularExponent',
        'azimuth', 'elevation', 'pointsAtX', 'pointsAtY', 'pointsAtZ', 'limitingConeAngle'
      ],
      ALLOW_DATA_ATTR: false,
      ALLOW_UNKNOWN_PROTOCOLS: false
    };

    try {
      // 净化SVG内容
      const sanitized = dompurify.sanitize(svgContent, dompurifyOptions);
      return sanitized;
    } catch (error: any) {
      secureLogger.error(`SVG净化失败: ${error.message}`);
      // 如果净化失败，返回空字符串以避免潜在的安全风险
      return '';
    }
  }

  /**
   * 净化SVG内容（实例方法，供依赖注入使用）
   * @param svgContent 原始SVG内容
   * @param options 过滤选项
   * @returns 净化后的SVG内容
   */
  sanitize(svgContent: string, options: SvgSanitizerOptions = {}): string {
    // 调用静态方法以避免代码重复
    return SvgSanitizerService.sanitize(svgContent, options);
  }

  /**
   * 检查SVG内容是否安全（静态方法，供其他服务调用）
   * @param svgContent 原始SVG内容
   * @returns 是否安全
   */
  static isSafe(svgContent: string): boolean {
    try {
      // 简单的安全检查 - 查找潜在的危险模式
      const dangerousPatterns = [
        /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
        /javascript:/gi,
        /data:text\/html/gi,
        /on\w+\s*=/gi,
        /expression\s*\(/gi,
        /vbscript:/gi,
        /<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi
      ];

      return !dangerousPatterns.some(pattern => pattern.test(svgContent));
    } catch (error) {
      secureLogger.error('SVG安全检查过程中发生错误:', error);
      return false; // 错误时默认认为不安全
    }
  }

  /**
   * 检查SVG内容是否安全（实例方法，供依赖注入使用）
   * @param svgContent 原始SVG内容
   * @returns 是否安全
   */
  isSafe(svgContent: string): boolean {
    // 调用静态方法以避免代码重复
    return SvgSanitizerService.isSafe(svgContent);
  }

  /**
   * 为用户生成的数据（静态方法，供其他服务调用）
   * @param text 用户提供的文本
   * @returns 清理后的文本
   */
  static sanitizeUserContent(text: string): string {
    // 基本HTML转义
    const escapeMap: { [key: string]: string } = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    };

    return text.replace(/[&<>"']/g, match => escapeMap[match]);
  }

  /**
   * 为用户生成的数据（实例方法，供依赖注入使用）
   * @param text 用户提供的文本
   * @returns 清理后的文本
   */
  sanitizeUserContent(text: string): string {
    // 调用静态方法以避免代码重复
    return SvgSanitizerService.sanitizeUserContent(text);
  }
}