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
});
