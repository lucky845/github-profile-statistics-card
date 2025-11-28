import { generateCard, CardType } from '../services/svg.service';
import { defaultTheme } from '../config/theme.config';

describe('SVG Generator Service Tests', () => {
  describe('Card Generation', () => {
    it('should generate GitHub card without throwing errors', () => {
      // 最小化的GitHub数据结构
      const minimalGitHubData = {
        name: 'Test',
        login: 'test',
        followers: 0,
        following: 0,
        public_repos: 0,
        avatar_url: 'https://avatars.githubusercontent.com/u/1'
      };
      
      // 测试生成GitHub卡片
      expect(() => {
        const result = generateCard(CardType.GITHUB, minimalGitHubData, 'default'); // 使用字符串主题名称
        expect(typeof result).toBe('string');
        expect(result.includes('<svg')).toBeTruthy();
      }).not.toThrow();
    });

    it('should generate LeetCode card without throwing errors', () => {
      // 最小化的LeetCode数据结构
      const minimalLeetCodeData = {
        username: 'test',
        submit_stats: {
          acSubmissionNum: [{ difficulty: 'ALL', count: 0 }]
        },
        profile: {
          realName: 'Test',
          ranking: 0,
          attendedContestCount: 0
        }
      };
      
      // 测试生成LeetCode卡片
      expect(() => {
        const result = generateCard(CardType.LEETCODE, minimalLeetCodeData, 'default'); // 使用字符串主题名称
        expect(typeof result).toBe('string');
        expect(result.includes('<svg')).toBeTruthy();
      }).not.toThrow();
    });

    it('should handle unknown card types gracefully', () => {
      expect(() => {
        const result = generateCard('UNKNOWN_TYPE' as CardType, {}, 'default'); // 使用字符串主题名称
        expect(typeof result).toBe('string');
      }).not.toThrow();
    });
  });
});