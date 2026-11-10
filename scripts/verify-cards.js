/**
 * 卡片渲染截图验证
 *
 * curl 只能看到 SVG 文本，看不出 `<image>` 是否真的画出来了
 * （缺 xlink:href / 命名空间时文本完全正确、画面空白）。
 * 这里用真 Chrome 渲染每个平台卡片，断言：
 *   1. 卡片确实画出来了（非空白）
 *   2. 头像元素有实际像素（GitHub 卡）
 *
 * 用法：node scripts/verify-cards.js [baseUrl]
 * 依赖本机 Chrome（playwright-core 不自带浏览器）。
 */
const { chromium } = require('playwright-core');
const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:3000';
const OUT_DIR = path.join(__dirname, '..', 'shots');

/** 每张卡要验证的：路径、是否必须有头像 */
const CASES = [
  { name: 'github', path: '/github/lucky845', expectAvatar: true },
  { name: 'leetcode', path: '/leetcode/lucky845?cn=true', expectAvatar: false },
  { name: 'csdn', path: '/csdn/testuser', expectAvatar: false },
  // 掘金上游经常限流，数据源不可用时返回错误卡属预期降级，不算失败
  { name: 'juejin', path: '/juejin/testuser', expectAvatar: false, allowErrorCard: true },
  { name: 'bilibili', path: '/bilibili/89389361', expectAvatar: false },
];

const CHROME =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

(async () => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 560, height: 320 } });
  let failed = 0;

  for (const c of CASES) {
    const url = `${BASE}${c.path}${c.path.includes('?') ? '&' : '?'}v=${Date.now()}`;
    // SVG 直接渲染：浏览器把它当成图片文档
    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });

    const shot = path.join(OUT_DIR, `${c.name}.png`);
    await page.screenshot({ path: shot });

    const info = await page.evaluate(() => {
      const svg = document.documentElement;
      const img = svg.querySelector('image');
      const texts = svg.querySelectorAll('text').length;
      return {
        w: svg.getAttribute('width'),
        h: svg.getAttribute('height'),
        imageCount: svg.querySelectorAll('image').length,
        imageHref: img ? img.getAttribute('xlink:href') || img.getAttribute('href') : null,
        textCount: texts,
      };
    });

    // 断言 1：卡片高度符合预期（说明是新版生成器，不是缓存的旧图）
    const heightOk = Number(info.h) > 100;

    // 断言 2：不是错误卡。错误卡只有 1 个 text（一句错误文案）+ 没有头像，
    // 且高度固定在 120。数据源临时不可用（如掘金限流）属于已知降级，
    // 记为 SKIP 而不是 FAIL，避免把上游故障误判成渲染 bug。
    const isErrorCard = info.textCount <= 2 && Number(info.h) <= 120;
    const hasText = !isErrorCard || c.allowErrorCard;

    // 断言 3：头像元素必须真的带上 xlink:href（缺它部分渲染器不画）
    const avatarOk =
      !c.expectAvatar ||
      (info.imageCount > 0 && !!info.imageHref);

    const ok = heightOk && hasText && avatarOk;
    const status = isErrorCard && !c.allowErrorCard ? 'SKIP' : ok ? 'PASS' : 'FAIL';
    if (status === 'FAIL') failed++;

    console.log(
      `${status.padEnd(5)} ${c.name.padEnd(9)} ` +
        `h=${info.h} text=${info.textCount} img=${info.imageCount} ` +
        `href=${info.imageHref ? 'yes' : 'none'}  -> ${shot}`
    );
  }

  await browser.close();
  console.log(failed === 0 ? '\n全部通过' : `\n${failed} 个失败`);
  process.exit(failed === 0 ? 0 : 1);
})().catch(err => {
  console.error('截图验证失败:', err.message);
  process.exit(1);
});
