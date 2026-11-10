/**
 * 通用卡片处理器工厂
 *
 * 所有平台 controller 的骨架（取参 → 校验 → 取数 → 渲染 → 错误映射）集中于此。
 * 平台差异通过 CardHandlerOptions 的钩子表达，而不是复制整份 controller。
 */
import { Request, Response } from 'express';
import { generateCard } from '../svg/svgService';
import { CardType } from '../svg/types';
import { PlatformStatsSource, StatsResult, FetchOptions, STATUS_BY_REASON, MESSAGE_BY_REASON } from './types';
import { secureLogger } from '../../utils/logger';
import { firstString } from '../../utils/request.util';
import { SvgSanitizerService } from '../svg-sanitizer.service';

/**
 * 成功卡片的默认缓存策略。
 * s-maxage 给 CDN/camo，max-age 给浏览器；stale-while-revalidate 让
 * 回源慢的时候旧图继续顶上，而不是让 GitHub 那边等到超时。
 */
export const DEFAULT_CARD_CACHE_CONTROL = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400';

export interface CardHandlerOptions {
  /** 路由参数名，如 username / userId / uid */
  paramName: string;
  /** 卡片类型 */
  cardType: CardType;
  /** 成功响应的 Cache-Control（默认值见 DEFAULT_CARD_CACHE_CONTROL） */
  responseCacheControl?: string;
  /** 渲染前对载荷再加工（如合并 username、区域修正） */
  transform?: (data: Record<string, unknown>, req: Request) => Record<string, unknown>;
  /** 输出前对 SVG 做净化（GitHub 用） */
  sanitizeSvg?: boolean;
  /** 取数前对参数再加工（如净化用户输入） */
  sanitizeId?: (id: string) => string;
  /** 从请求推导平台特定选项 */
  fetchOptions?: (req: Request) => FetchOptions;
}

/**
 * 生成 Express handler。返回 400 / 404 / 503 / 500 与相应错误卡，
 * 失败一律 no-store，避免把降级结果缓存住。
 */
export function createCardHandler(
  source: PlatformStatsSource<Record<string, unknown>>,
  options: CardHandlerOptions
) {
  return async (req: Request, res: Response): Promise<void> => {
    const theme = (req.query.theme as string) || 'default';
    const id = firstString(req.params[options.paramName]);
    const cacheSeconds = req.query.cacheSeconds ? parseInt(req.query.cacheSeconds as string, 10) : 120;

    if (!id || id.trim() === '') {
      res.status(400).set('Content-Type', 'image/svg+xml')
        .send(generateCard(CardType.ERROR, '未提供用户标识', theme));
      return;
    }

    let result: StatsResult<Record<string, unknown>>;
    try {
      const cleanId = options.sanitizeId ? options.sanitizeId(id.trim()) : id.trim();
      result = await source.fetch(cleanId, cacheSeconds, options.fetchOptions?.(req));
    } catch (error) {
      // 适配器约定不抛异常，这里是最后一道防线
      secureLogger.error(`${options.cardType} 处理器未捕获异常: ${error}`);
      result = { ok: false, reason: 'UPSTREAM_ERROR', message: String(error) };
    }

    if (!result.ok) {
      const status = STATUS_BY_REASON[result.reason];
      // 非 200 一律不缓存；200 的降级卡给短 TTL，让上游恢复后能尽快自愈
      res.set('Content-Type', 'image/svg+xml')
        .set('Cache-Control', status === 200 ? 'public, max-age=60' : 'no-store')
        .status(status)
        .send(generateCard(CardType.ERROR, MESSAGE_BY_REASON[result.reason], theme));
      return;
    }

    try {
      const payload = options.transform ? options.transform(result.data, req) : result.data;
      let svg = generateCard(options.cardType, payload, theme);
      if (options.sanitizeSvg) {
        svg = new SvgSanitizerService().sanitize(svg);
      }
      res.set('Content-Type', 'image/svg+xml');
      // 成功卡片默认也带 s-maxage：CDN/camo 直接命中就不回源，
      // 首屏不用等美国机房的 Redis/Mongo。所有卡走同一策略，避免出现
      // "有的带 Cache-Control 有的不带"导致 Vercel 自己改写 max-age=0。
      res.set('Cache-Control', options.responseCacheControl || DEFAULT_CARD_CACHE_CONTROL);
      res.send(svg);
    } catch (error) {
      secureLogger.error(`渲染${options.cardType}卡片失败: ${error}`);
      // 渲染失败也返回 200 + 错误卡：GitHub camo 会把 5xx 缓存成坏图，README 里会永久裂图
      res.status(200).set('Content-Type', 'image/svg+xml').set('Cache-Control', 'no-store')
        .send(generateCard(CardType.ERROR, '数据暂时不可用', theme));
    }
  };
}
