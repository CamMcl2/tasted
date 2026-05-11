/**
 * Redis client — Upstash Redis (REST API, works from any runtime)
 * Docs: https://upstash.com/docs/redis/sdks/ts/getstarted
 */
import { Redis } from '@upstash/redis';

export const redis = new Redis({
  url:   process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

// ── Key helpers ──────────────────────────────────────────────────────────────
export const keys = {
  barcode:   (code)  => `barcode:${code}`,
  product:   (id)    => `product:${id}`,
  search:    (q,s,c) => `search:${q}:${s||''}:${c||''}`,
  trending:  ()      => `trending:barcodes`,
  rateLimit: (ip)    => `rl:${ip}`,
};

// ── TTLs (seconds) ───────────────────────────────────────────────────────────
export const TTL = {
  barcode:   60 * 60 * 24,       // 24 hours — barcodes are stable
  search:    60 * 2,             // 2 minutes — search results can change
  trending:  60 * 60,            // 1 hour
};

// ── Cache helpers ─────────────────────────────────────────────────────────────

/** Get a cached barcode scan payload. Returns parsed object or null. */
export async function getCachedBarcode(barcode) {
  try {
    const val = await redis.get(keys.barcode(barcode));
    return val ?? null;
  } catch {
    return null;  // Redis down → degrade gracefully
  }
}

/** Store a compact scan payload in Redis. */
export async function setCachedBarcode(barcode, payload) {
  try {
    await redis.set(keys.barcode(barcode), payload, { ex: TTL.barcode });
  } catch { /* non-fatal */ }
}

/** Invalidate a barcode cache entry (call after enrichment updates). */
export async function invalidateBarcode(barcode) {
  try {
    await redis.del(keys.barcode(barcode));
  } catch { /* non-fatal */ }
}

/** Track a barcode scan in the trending sorted set. */
export async function trackScan(barcode) {
  try {
    await redis.zincrby(keys.trending(), 1, barcode);
    await redis.expire(keys.trending(), TTL.trending);
  } catch { /* non-fatal */ }
}

/** Get cached search results. */
export async function getCachedSearch(q, supermarket, category) {
  try {
    return await redis.get(keys.search(q, supermarket, category));
  } catch {
    return null;
  }
}

/** Store search results. Short TTL since data changes more often. */
export async function setCachedSearch(q, supermarket, category, results) {
  try {
    await redis.set(keys.search(q, supermarket, category), results, { ex: TTL.search });
  } catch { /* non-fatal */ }
}
