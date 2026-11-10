/**
 * 卡片几何自检（无需浏览器）
 *
 * 解析生成的 SVG，校验：画布尺寸、文字不越界、同行文字不重叠、字号只取设计令牌。
 * 这些正是肉眼看不出来的排版缺陷。
 */

export interface GeoIssue {
  rule: string;
  detail: string;
}

interface TextNode { x: number; y: number; size: number; anchor: string; content: string; }

const attrOf = (attrs: string, name: string): string => {
  const r = new RegExp(name + '="([^"]*)"').exec(attrs);
  return r ? r[1] : '';
};

/** 从 SVG 里抽出所有 text 节点 */
export const extractTexts = (svg: string): TextNode[] => {
  const out: TextNode[] = [];
  const re = /<text\s([^>]*)>([\s\S]*?)<\/text>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const attrs = m[1];
    out.push({
      x: parseFloat(attrOf(attrs, 'x')) || 0,
      y: parseFloat(attrOf(attrs, 'y')) || 0,
      size: parseFloat(attrOf(attrs, 'font-size')) || 0,
      anchor: attrOf(attrs, 'text-anchor') || 'start',
      content: m[2].replace(/<[^>]*>/g, ''),
    });
  }
  return out;
};

/** 估算文本宽度：CJK 按 1em，其余按 0.55em */
export const estimateWidth = (s: string, size: number): number => {
  let w = 0;
  for (const ch of s) {
    const code = ch.codePointAt(0) || 0;
    w += code > 0x2e80 ? size : size * 0.55;
  }
  return w;
};

const ALLOWED_SIZES = new Set([26, 16, 18, 11, 10]);

/** 校验一张卡片的几何，返回问题列表（空数组 = 通过） */
export const checkCardGeometry = (
  svg: string,
  opts: { width: number; height: number }
): GeoIssue[] => {
  const issues: GeoIssue[] = [];

  const sizeMatch = /width="(\d+)"\s+height="(\d+)"/.exec(svg);
  if (!sizeMatch) {
    issues.push({ rule: 'canvas', detail: '未找到画布尺寸' });
  } else {
    const w = Number(sizeMatch[1]);
    const h = Number(sizeMatch[2]);
    if (w !== opts.width || h !== opts.height) {
      issues.push({ rule: 'canvas', detail: '画布 ' + w + 'x' + h + ' != ' + opts.width + 'x' + opts.height });
    }
  }

  const texts = extractTexts(svg);
  if (texts.length === 0) issues.push({ rule: 'content', detail: '没有任何文本节点' });

  for (const t of texts) {
    if (!ALLOWED_SIZES.has(t.size)) {
      issues.push({ rule: 'font-size', detail: '"' + t.content + '" 字号 ' + t.size + ' 不在令牌阶梯内' });
    }
    if (t.y > opts.height - 4) {
      issues.push({ rule: 'overflow-y', detail: '"' + t.content + '" y=' + t.y + ' 越过画布底' });
    }
    const w = estimateWidth(t.content, t.size);
    const left = t.anchor === 'end' ? t.x - w : t.anchor === 'middle' ? t.x - w / 2 : t.x;
    const right = left + w;
    if (left < 4) {
      issues.push({ rule: 'overflow-x', detail: '"' + t.content + '" 左边界 ' + left.toFixed(0) });
    }
    if (right > opts.width - 4) {
      issues.push({ rule: 'overflow-x', detail: '"' + t.content + '" 右边界 ' + right.toFixed(0) });
    }
  }

  // 同一行（y 相差 < 4）的起始锚文本不得重叠
  const rows = new Map<number, TextNode[]>();
  for (const t of texts.filter(t => t.anchor === 'start')) {
    const key = Math.round(t.y / 4) * 4;
    const list = rows.get(key) || [];
    list.push(t);
    rows.set(key, list);
  }
  for (const entry of rows) {
    const y = entry[0];
    const list = entry[1].slice().sort((a, b) => a.x - b.x);
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1];
      const prevRight = prev.x + estimateWidth(prev.content, prev.size);
      if (prevRight > list[i].x + 1) {
        issues.push({
          rule: 'overlap',
          detail: 'y=' + y + ' 处 "' + prev.content + '"(右 ' + prevRight.toFixed(0) + ') 压住 "' + list[i].content + '"(x ' + list[i].x + ')',
        });
      }
    }
  }

  return issues;
};
