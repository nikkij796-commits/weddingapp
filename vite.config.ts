import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

/**
 * Tests only: serve /vault/* from VAULT_DIR (a sample vault built by the Playwright web server)
 * so the real vault in public/vault is never touched.
 */
function sampleVault(dir: string): Plugin {
  return {
    name: 'sample-vault',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/vault\/([A-Za-z0-9_./-]+)$/.exec((req.url ?? '').split('?')[0]);
        if (!m) return next();
        const file = normalize(join(dir, m[1]));
        if (!file.startsWith(normalize(dir)) || !existsSync(file) || !statSync(file).isFile()) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('content-type', extname(file) === '.json' ? 'application/json' : 'text/plain');
        res.setHeader('cache-control', 'no-store');
        createReadStream(file).pipe(res);
      });
    },
  };
}

// GitHub Pages serves a project site from /<repo>/, so CI builds with BASE_PATH=/weddingapp/.
export default defineConfig({
  base: process.env.BASE_PATH ?? '/',
  plugins: process.env.VAULT_DIR ? [sampleVault(process.env.VAULT_DIR)] : [],
  server: { host: true },
  build: { sourcemap: false },
});
