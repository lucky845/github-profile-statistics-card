import { SOURCES } from '../services/platforms/registry';
import { createCardHandler } from '../services/platforms/cardHandler';
import { CardType } from '../services/svg/types';

export const getLeetCodeStats = createCardHandler(SOURCES[CardType.LEETCODE], {
  paramName: 'username',
  cardType: CardType.LEETCODE,
  responseCacheControl: 'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400',
  fetchOptions: req => ({ useCN: req.query.cn === 'true' }),
});
