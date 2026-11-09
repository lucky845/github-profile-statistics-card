/**
 * Express 请求参数收敛工具。
 *
 * 背景：`@types/express-serve-static-core@5.1+` 把 `req.params` 的值类型
 * 从 `string` 放宽为 `string | string[]`（Express 5 的 `*` 通配参数会返回数组）。
 * 直接把这样的值传给只接受 string 的函数会编译失败，而 CI 的 `npm ci`
 * 锁定了旧版本类型，本地看不出来；Vercel 在没有 lock 文件时会装到最新版，
 * 构建直接挂掉。所有从路由参数取值的地方统一走这里，既不依赖类型包版本，
 * 也不会把数组隐式拼进字符串。
 */

/** Express 路由参数/查询参数可能的原始值类型 */
export type ExpressParamValue = string | string[] | undefined | null;

/**
 * 收敛为单个字符串：
 * - 数组取第一个字符串元素（通配参数场景），其余情况返回空串
 * - 非字符串一律返回空串，避免 `[object Object]` 或隐式拼接
 *
 * 返回空串是 falsy，可以继续沿用 `if (!value)` 的判空写法。
 */
export function firstString(value: ExpressParamValue): string {
  if (Array.isArray(value)) {
    const head = value[0];
    return typeof head === 'string' ? head : '';
  }
  return typeof value === 'string' ? value : '';
}
