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

export interface CardHandlerOptions {
  /** 路由参数名，如 username / userId / uid */
  paramName: string;
  /** 卡片类型 */
  cardType: CardType;
  /** 成功响应的 Cache-Control */
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
      res.status(status).set('Content-Type', 'image/svg+xml').set('Cache-Control', 'no-store')
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
      if (options.responseCacheControl) {
        res.set('Cache-Control', options.responseCacheControl);
      }
      res.send(svg);
    } catch (error) {
      secureLogger.error(`渲染${options.cardType}卡片失败: ${error}`);
      res.status(500).set('Content-Type', 'image/svg+xml').set('Cache-Control', 'no-store')
        .send(generateCard(CardType.ERROR, '卡片渲染失败', theme));
    }
  };
}
