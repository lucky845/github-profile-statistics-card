import { SOURCES } from '../services/platforms/registry';
import { createCardHandler } from '../services/platforms/cardHandler';
import { CardType } from '../services/svg/types';
import { SvgSanitizerService } from '../services/svg-sanitizer.service';

const sanitizer = new SvgSanitizerService();

export const getGitHubStats = createCardHandler(SOURCES[CardType.GITHUB], {
  paramName: 'username',
  cardType: CardType.GITHUB,
  sanitizeId: id => sanitizer.sanitizeUserContent(id),
  sanitizeSvg: true,
  // 5 分钟够新，Redis 里还有更长的兜底；卡片是给人看的，不是给 API 调用的。
  // 留空会走 DEFAULT_CARD_CACHE_CONTROL（s-maxage=3600），同样是长缓存
  responseCacheControl: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
});
