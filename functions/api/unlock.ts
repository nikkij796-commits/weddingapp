// Cloudflare Pages Function: POST /api/unlock
// Uses the same handler as local dev. data/published.json is bundled server-side only
// (it is produced by `npm run publish:data` and is never part of the client bundle).
import data from '../../data/published.json';
import { RateLimiter, handleUnlock } from '../../src/server/unlock';

const limiter = new RateLimiter();

export const onRequestPost = async ({ request }: { request: Request }) => {
  let input: unknown = {};
  try {
    input = await request.json();
  } catch {
    /* empty input */
  }
  const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
  const r = handleUnlock(data as never, (input ?? {}) as never, limiter, ip);
  return new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
