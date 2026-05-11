/**
 * Redis client — lazy initialisation.
 * Server starts fine without Redis; caching is simply skipped.
 */
import { Redis } from '@upstash/redis';

let _redis = null;

function getRedis() {
  if (_redis) return _redis;
  const url   = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token || url.startsWith('#')) return null;
  try {
    _redis = new Redis({ url, token });
    return _redis;
  } catch {
    return null;
  }
}

// ── Key helpers ───────────────────────────────────────────────────────────────
export const keys = {
  barcode:   (code)  => `barcode:${code}`,
  search:    (q,s,c) => `search:${q}:${s||''}:${c||''}`,
  trending:  ()      => `trending:barcodes`,
};

export const TTL = {
  barcode: 60 * 60 * 24,
  search:  60 * 2,
  trending: 60 * 60,
};

// ── Cache helpers — all no-ops if Redis isn't configured ──────────────────────

export async function getCachedBarcode(barcode) {
  try { return await getRedis()?.get(keys.barcode(barcode)) ?? null; }
  catch { return null; }
}

export async function setCachedBarcode(barcode, payload) {
  try { await getRedis()?.set(keys.barcode(barcode), payload, { ex: TTL.barcode }); }
  catch { /* non-fatal */ }
}

export async function invalidateBarcode(barcode) {
  try { await getRedis()?.del(keys.barcode(barcode)); }
  catch { /* non-fatal */ }
}

export async function trackScan(barcode) {
  try {
    const r = getRedis();
    if (!r) return;
    await r.zincrby(keys.trending(), 1, barcode);
    await r.expire(keys.trending(), TTL.trending);
  } catch { /* non-fatal */ }
}

export async function getCachedSearch(q, supermarket, category) {
  try { return await getRedis()?.get(keys.search(q, supermarket, category)) ?? null; }
  catch { return null; }
}

export async function setCachedSearch(q, supermarket, category, results) {
  try { await getRedis()?.set(keys.search(q, supermarket, category), results, { ex: TTL.search }); }
  catch { /* non-fatal */ }
}

// Export getter for routes that need direct access (e.g. /trending)
export { getRedis as redis };
