/**
 * SVG服务主入口
 */
import { CardType, ThemeOptions } from './types';
import { generateErrorCard } from './generators';
import { generateLeetCodeCard } from './generators/leetcodeCardGenerator';
import { generateGitHubCounterCard } from './generators/githubCardGenerator';
import { generateCSDNCard } from './generators/csdnCardGenerator';
import { generateJuejinCard } from './generators/juejinCardGenerator';
import { generateBilibiliCard } from './generators/bilibiliCardGenerator';
import { themes } from '../../config/theme.config';
import { secureLogger } from '../../utils/logger';

/**
 * 获取主题配置
 * @param themeName 主题名称，可选
 * @returns 主题配置对象
 */
export const getThemeConfig = (themeName?: string): ThemeOptions => {
  // 使用默认主题作为后备
  return themeName && themes[themeName] ? themes[themeName] : themes.default;
};

/**
 * 生成SVG卡片
 * @param cardType 卡片类型
 * @param data 卡片数据
 * @param themeName 主题名称，可选
 * @returns SVG字符串
 */
/**
 * 卡片渲染器注册表：新增平台只需在此登记一行，无需改动 generateCard 的分发逻辑
 */
export interface CardRenderer {
  render(data: any, theme: ThemeOptions): string;
}

const RENDERERS: Record<string, CardRenderer['render']> = {
  [CardType.LEETCODE]: generateLeetCodeCard,
  [CardType.GITHUB]: generateGitHubCounterCard,
  [CardType.CSDN]: generateCSDNCard,
  [CardType.JUEJIN]: generateJuejinCard,
  [CardType.BILIBILI]: generateBilibiliCard,
  [CardType.ERROR]: (data: any, theme: ThemeOptions) => generateErrorCard(data as string, theme),
};

export const generateCard = (
  cardType: CardType,
  data: any,
  themeName?: string
): string => {
  const theme = getThemeConfig(themeName);

  try {
    const render = RENDERERS[cardType];
    if (!render) {
      return generateErrorCard(`不支持的卡片类型: ${cardType}`, theme);
    }
    return render(data, theme);
  } catch (error) {
    secureLogger.error(`生成${cardType}卡片时出错:`, error);
    return generateErrorCard('卡片生成失败', theme);
  }
};
