import request from 'supertest';
// 模拟 Vercel：导入入口，不调用 startServer
import app from '../vercel-entry';
import svc from '../services/prometheus.service';

(async () => {
  console.log('### gauge initialized =', !!(svc as any).activeRequestsGauge);
  const paths = ['/health?nocache=1', '/?nocache=1', '/github/lucky845?nocache=1', '/metrics?nocache=1'];
  for (const p of paths) {
    const r = await request(app).get(p).timeout(60000);
    const ct = r.headers['content-type'] || '';
    console.log(`### ${p} -> HTTP ${r.status} | ${ct.split(';')[0]}`);
  }
  process.exit(0);
})();
