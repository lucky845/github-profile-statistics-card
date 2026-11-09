import { SOURCES } from '../services/platforms/registry';
import { createCardHandler } from '../services/platforms/cardHandler';
import { CardType } from '../services/svg/types';

export const getLeetCodeStats = createCardHandler(SOURCES[CardType.LEETCODE], {
  paramName: 'username',
  cardType: CardType.LEETCODE,
  responseCacheControl: 'max-age=1800',
  fetchOptions: req => ({ useCN: req.query.cn === 'true' }),
});
