import { SOURCES } from '../services/platforms/registry';
import { createCardHandler } from '../services/platforms/cardHandler';
import { CardType } from '../services/svg/types';

export const getCSDNStats = createCardHandler(SOURCES[CardType.CSDN], {
  paramName: 'userId',
  cardType: CardType.CSDN,
  responseCacheControl: 'public, max-age=300, s-maxage=600, stale-while-revalidate=86400',
});
