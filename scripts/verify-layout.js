/**
 * 首页响应式布局验证
 *
 * 之前 390px 视口下整页横向溢出到 585px：网格列写的是裸 `1fr`，
 * 等于 minmax(auto, 1fr)，轨道最小值取卡片内那行 nowrap Markdown 的最小
 * 内容宽度，把一个本该 358px 的列撑成 569px。纯文本 diff 看不出来，
 * 只能在真浏览器里量 scrollWidth。
 *
 * 用法：node scripts/verify-layout.js [baseUrl]
 */
const { chromium } = require('playwright-core');

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const VIEWPORTS = [360, 390, 560, 768, 1100];

(async () => {
  const browser = await chromium.launch({
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  });
  let failed = 0;

  for (const width of VIEWPORTS) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    const m = await page.evaluate(() => {
      const doc = document.documentElement;
      const offenders = [];
      document.querySelectorAll('*').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.right > doc.clientWidth + 1) {
          offenders.push(el.tagName + (el.className ? '.' + el.className : ''));
        }
      });
      return {
        scrollW: doc.scrollWidth,
        clientW: doc.clientWidth,
        cards: document.querySelectorAll('.gallery-grid .card').length,
        columns: getComputedStyle(document.querySelector('.gallery-grid')).gridTemplateColumns.split(' ').length,
        offenders: offenders.slice(0, 5),
      };
    });

    const overflow = m.scrollW > m.clientW + 1;
    const wantOneCol = width < 600 ? 1 : 2;
    const colOk = m.columns === wantOneCol;
    const ok = !overflow && m.cards > 0 && colOk;
    if (!ok) failed++;
    console.log(
      (ok ? 'PASS ' : 'FAIL ') + width + 'px' +
      '  scrollW=' + m.scrollW + ' clientW=' + m.clientW +
      '  cards=' + m.cards + ' cols=' + m.columns + (colOk ? '' : ' (want ' + wantOneCol + ')') +
      (m.offenders.length ? '  溢出元素: ' + m.offenders.join(', ') : '')
    );
    await page.close();
  }

  await browser.close();
  process.exit(failed ? 1 : 0);
})();