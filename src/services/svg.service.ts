// 向后兼容导出层：历史上这个文件自带一份 495x120/245 的旧卡片渲染实现，
// 2026-11 重写统一渲染层后已全部移除——旧实现会绕过 generateCard 的 try/catch，
// 上游字段缺失时直接抛异常变成 500，而 GitHub camo 会把 5xx 缓存成坏图。
// 现在这里只做转发，渲染逻辑唯一可信来源是 services/svg/svgService。

import { CardType } from './svg/types';
import { generateCard, getThemeConfig, DEFAULT_THEME_NAME } from './svg/svgService';
import { generateErrorCard } from './svg/generators/errorCardGenerator';
import { generateLeetCodeCard } from './svg/generators/leetcodeCardGenerator';
import { generateGitHubCounterCard } from './svg/generators/githubCardGenerator';
import { generateCSDNCard } from './svg/generators/csdnCardGenerator';
import { generateJuejinCard } from './svg/generators/juejinCardGenerator';
import { generateBilibiliCard } from './svg/generators/bilibiliCardGenerator';

export {
  CardType,
  generateCard,
  getThemeConfig,
  DEFAULT_THEME_NAME,
  generateErrorCard,
  generateLeetCodeCard,
  generateGitHubCounterCard,
  generateCSDNCard,
  generateJuejinCard,
  generateBilibiliCard,
};
