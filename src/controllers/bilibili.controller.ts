import { SOURCES } from '../services/platforms/registry';
import { createCardHandler } from '../services/platforms/cardHandler';
import { CardType } from '../services/svg/types';

export const fetchBilibiliUserData = createCardHandler(SOURCES[CardType.BILIBILI], {
  paramName: 'uid',
  cardType: CardType.BILIBILI,
  responseCacheControl: 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400',
});
