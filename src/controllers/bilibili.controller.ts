import { SOURCES } from '../services/platforms/registry';
import { createCardHandler } from '../services/platforms/cardHandler';
import { CardType } from '../services/svg/types';

export const fetchBilibiliUserData = createCardHandler(SOURCES[CardType.BILIBILI], {
  paramName: 'uid',
  cardType: CardType.BILIBILI,
});
