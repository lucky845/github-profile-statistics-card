import { SOURCES } from '../services/platforms/registry';
import { createCardHandler } from '../services/platforms/cardHandler';
import { CardType } from '../services/svg/types';

export const fetchJuejinUserData = createCardHandler(SOURCES[CardType.JUEJIN], {
  paramName: 'user_id',
  cardType: CardType.JUEJIN,
  responseCacheControl: 'public, max-age=600',
});
