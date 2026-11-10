/**
 * 首页卡片画廊
 *
 * 从平台注册表生成，新增平台时首页自动出现该卡片的预览与复制按钮，
 * 不需要再手改 index.html。
 */
import { SOURCES } from './registry';

interface GalleryEntry {
  platform: string;
  title: string;
  /** 路由路径段，如 github / leetcode */
  path: string;
  /** 示例用户 */
  sample: string;
  /** 额外查询参数 */
  extraQuery: string;
  /** 卡片高度，用于预留空间避免抖动 */
  height: number;
}

const ENTRIES: GalleryEntry[] = [
  { platform: 'github', title: 'GitHub 统计', path: 'github', sample: 'lucky845', extraQuery: '', height: 200 },
  { platform: 'leetcode', title: 'LeetCode 统计', path: 'leetcode', sample: 'lucky845', extraQuery: '&cn=true', height: 200 },
  { platform: 'csdn', title: 'CSDN 统计', path: 'csdn', sample: 'testuser', extraQuery: '', height: 200 },
  { platform: 'juejin', title: '掘金统计', path: 'juejin', sample: 'testuser', extraQuery: '', height: 200 },
  { platform: 'bilibili', title: '哔哩哔哩统计', path: 'bilibili', sample: '1', extraQuery: '', height: 200 },
];

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * 生成画廊 HTML 片段。只包含注册表里真实存在的平台。
 */
export function renderGallery(baseUrl: string, theme = 'light'): string {
  const available = ENTRIES.filter(e => SOURCES[e.platform]);
  if (available.length === 0) return '';

  const cards = available.map((e, i) => {
    // theme 跟着首页当前选中的主题走：点 ?theme=dark 时预览图和可复制的
    // Markdown 一起变成暗色，否则主题胶囊点了没反应
    const url = `${baseUrl}/${e.path}/${e.sample}?theme=${encodeURIComponent(theme)}${e.extraQuery}`;
    const markdown = `![](${url})`;
    const id = `code-${i}`;
    return `
      <figure class="card">
        <figcaption>${escapeHtml(e.title)}</figcaption>
        <img src="${escapeHtml(url)}" alt="${escapeHtml(e.title)}示例卡片" height="${e.height}" loading="lazy">
        <div class="copy-row">
          <code id="${id}">${escapeHtml(markdown)}</code>
          <button class="copy-btn" data-target="${id}" type="button">复制</button>
        </div>
      </figure>`;
  }).join('');

  return `<section class="gallery">
    <h2>卡片预览</h2>
    <div class="gallery-grid">${cards}</div>
  </section>`;
}
