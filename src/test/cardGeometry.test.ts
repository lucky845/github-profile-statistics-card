/**
 * 五张卡片的几何回归
 *
 * 只断言肉眼看不出的排版缺陷：画布尺寸、文字越界、同行重叠、字号越出令牌阶梯。
 */
import { CARD, TYPE } from '../config/design-tokens';
import { checkCardGeometry, extractTexts } from './helpers/cardGeometry';
import { defaultTheme } from '../config/theme.config';
import { generateGitHubCounterCard } from '../services/svg/generators/githubCardGenerator';
import { generateLeetCodeCard } from '../services/svg/generators/leetcodeCardGenerator';
import { generateCSDNCard } from '../services/svg/generators/csdnCardGenerator';
import { generateJuejinCard } from '../services/svg/generators/juejinCardGenerator';
import { generateBilibiliCard } from '../services/svg/generators/bilibiliCardGenerator';

const CANVAS = { width: CARD.width, height: CARD.height };

const cards: [string, string][] = [
  ['github', generateGitHubCounterCard(
    { username: 'lucky845', publicRepos: 18, followers: 6, totalStars: 13 },
    defaultTheme
  )],
  ['leetcode', generateLeetCodeCard(
    {
      username: 'lucky845',
      region: 'CN',
      totalSolved: 420,
      easySolved: 231,
      mediumSolved: 169,
      hardSolved: 20,
      acceptanceRate: '61.3%',
      ranking: 100000,
      totalProblems: { easy: 1095, medium: 2343, hard: 1059 },
    },
    defaultTheme
  )],
  ['csdn', generateCSDNCard(
    { username: 'testuser', articleCount: 128, followers: 3400, rank: 12000, views: 980000, points: 1898, codeAge: '10年', level: 6 },
    defaultTheme
  )],
  ['juejin', generateJuejinCard(
    { username: 'testuser', desc: '一个热爱技术的前端工程师，喜欢写点东西', articleCount: 42, views: 120000, likes: 3200, followers: 900 },
    defaultTheme
  )],
  ['bilibili', generateBilibiliCard(
    { uid: '1', username: 'bishi', level: 6, sign: '喜欢折腾各种东西的UP主', followers: 237000, following: 8, likes: 12000, views: 3400000 },
    defaultTheme
  )],
];

describe('卡片几何', () => {
  describe.each(cards)('%s', (_name, svg) => {
    it('画布尺寸符合统一设计', () => {
      expect(svg).toContain('width="' + CANVAS.width + '"');
      expect(svg).toContain('height="' + CANVAS.height + '"');
    });

    it('没有文字越界或重叠', () => {
      expect(checkCardGeometry(svg, CANVAS)).toEqual([]);
    });

    it('不引用任何外部图片（README 里经 camo 中转，多一个外链多一个裂图点）', () => {
      expect(svg).not.toMatch(/<image\b/);
      expect(svg).not.toMatch(/xlink:href/);
      expect(svg).not.toMatch(/<clipPath/);
    });

    it('字号只取设计令牌', () => {
      const sizes = new Set(extractTexts(svg).map(t => t.size));
      const allowed = new Set<number>([TYPE.display, TYPE.heading, TYPE.value, TYPE.label, TYPE.caption]);
      for (const s of sizes) expect(allowed.has(s)).toBe(true);
    });
  });
});
