import request from 'supertest';
import app from '../vercel-entry';
(async () => {
  for (const p of ['/github/lucky845', '/leetcode/lucky845', '/csdn/test', '/juejin/test', '/bilibili/test']) {
    const r = await request(app).get(p + '?nocache=1').timeout(90000);
    const body = r.text || '';
    const texts = [...body.matchAll(/>([^<>]{2,60})</g)].map(m => m[1].trim()).filter(t => t && !/^\s*$/.test(t) && !/^[{}#.:;,\s-]+$/.test(t));
    console.log(`### ${p} -> ${r.status} | ${(r.headers['content-type']||'').split(';')[0]} | bytes=${body.length}`);
    console.log('    texts: ' + JSON.stringify(texts.slice(0, 12)));
  }
  process.exit(0);
})();
