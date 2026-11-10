/**
 * 主题与字体的端到端回归
 *
 * 这两类 bug 之前都靠肉眼才发现：
 * 1. font-family 里带双引号，导致 SVG 属性在第一个引号处被截断，字体栈整条失效；
 * 2. 主题白名单和主题表各写各的，github-dark-dimmed / transparent 被静默删参数，
 *    永远渲染成默认白色。
 */
import { themes } from '../config/theme.config';
import { getThemeConfig, generateCard, DEFAULT_THEME_NAME } from '../services/svg/svgService';
import { FONT_FAMILY, FONT_MONO } from '../config/design-tokens';
import { CardType } from '../services/svg/types';

const GITHUB_DATA = { count: 1, username: 'u', publicRepos: 1, followers: 1, totalStars: 1 };

const bgOf = (svg: string): string => {
  const m = /<(?:rect|svg)[^>]*fill="([^"]+)"/.exec(svg);
  return m ? m[1] : '';
};

describe('主题', () => {
  it('每个主题都渲染出自己声明的背景色', () => {
    for (const name of Object.keys(themes)) {
      const svg = generateCard(CardType.GITHUB, GITHUB_DATA, name);
      expect(bgOf(svg)).toBe(themes[name].colors.background);
    }
  });

  it('主题之间视觉可区分', () => {
    const backgrounds = new Set(Object.keys(themes).map(n => themes[n].colors.background));
    expect(backgrounds.size).toBe(Object.keys(themes).length);
  });

  it('未知主题回落到默认主题而不是报错', () => {
    expect(getThemeConfig('no-such-theme')).toBe(themes[DEFAULT_THEME_NAME]);
  });

  it('缺省参数使用默认主题', () => {
    expect(getThemeConfig(undefined)).toBe(themes[DEFAULT_THEME_NAME]);
  });
});

describe('字体', () => {
  it('字体栈里不含双引号', () => {
    // 双引号会把 SVG 的 font-family="..." 属性截断
    expect(FONT_FAMILY).not.toContain('"');
    expect(FONT_MONO).not.toContain('"');
  });

  it('生成的卡片里字体属性完整可解析', () => {
    const svg = generateCard(CardType.GITHUB, GITHUB_DATA, 'light');
    const m = /font-family="([^"]*)"/.exec(svg);
    expect(m).not.toBeNull();
    expect(m![1]).toBe(FONT_FAMILY);
    expect(m![1].split(',').length).toBeGreaterThan(3);
  });
});
