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
export const generateCard = (
  cardType: CardType,
  data: any,
  themeName?: string
): string => {
  const theme = getThemeConfig(themeName);

  try {
    switch (cardType) {
      case CardType.LEETCODE:
        return generateLeetCodeCard(data, theme);
      case CardType.GITHUB:
        return generateGitHubCounterCard(data, theme);
      case CardType.CSDN:
        return generateCSDNCard(data, theme);
      case CardType.JUEJIN:
        return generateJuejinCard(data, theme);
      case CardType.BILIBILI:
        return generateBilibiliCard(data, theme);
      case CardType.ERROR:
        // 处理错误卡片类型
        return generateErrorCard(data as string, theme);
      default:
        return generateErrorCard(`不支持的卡片类型: ${cardType}`, theme);
    }
  } catch (error) {
    secureLogger.error(`生成${cardType}卡片时出错:`, error);
    return generateErrorCard('卡片生成失败', theme);
  }
};
