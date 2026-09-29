import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { RateLimiter, handleUnlock } from './src/server/unlock';
import type { PublishedData } from './src/core/types';

/** Serves /api/unlock in dev/preview using the same handler as production. */
function unlockApi(): Plugin {
  const limiter = new RateLimiter();
  const path =
    process.env.WEDDING_DATA ?? (existsSync('data/published.json') ? 'data/published.json' : 'data/published.sample.json');
  const mw = (req: any, res: any, next: () => void) => {
    if (req.url?.split('?')[0] !== '/api/unlock') return next();
    if (req.method !== 'POST') {
      res.statusCode = 405;
      return res.end();
    }
    let raw = '';
    req.on('data', (c: Buffer) => {
      raw += c;
      if (raw.length > 10_000) req.destroy();
    });
    req.on('end', () => {
      let input: any = {};
      try {
        input = JSON.parse(raw || '{}');
      } catch {
        /* treated as empty input */
      }
      const data = JSON.parse(readFileSync(path, 'utf8')) as PublishedData; // re-read so publishes apply instantly
      const r = handleUnlock(data, input, limiter, String(req.headers['x-forwarded-for'] ?? req.socket.remoteAddress ?? 'local'));
      res.statusCode = r.status;
      res.setHeader('content-type', 'application/json');
      res.setHeader('cache-control', 'no-store');
      res.end(JSON.stringify(r.body));
    });
  };
  return {
    name: 'unlock-api',
    configureServer: (s) => void s.middlewares.use(mw),
    configurePreviewServer: (s) => void s.middlewares.use(mw),
  };
}

export default defineConfig({ plugins: [unlockApi()], server: { host: true }, build: { sourcemap: false } });
