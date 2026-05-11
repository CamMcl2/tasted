/**
 * Product routes
 *
 * GET /product/:barcode  — primary scan endpoint
 * GET /search            — search screen
 */

import { getCachedBarcode, setCachedBarcode, trackScan,
         getCachedSearch, setCachedSearch }      from '../lib/redis.js';
import { lookupBarcode, searchProducts,
         upsertFromOFF, buildScanPayload }        from '../lib/supabase.js';
import { fetchFromOFF }                           from '../lib/off.js';
import { queueEnrichment }                        from '../workers/queue.js';

// Compact response schema — Fastify serialises this with zero overhead
const scanSchema = {
  type: 'object',
  properties: {
    id:           { type: 'string' },
    barcode:      { type: 'string' },
    name:         { type: 'string' },
    brand:        { type: ['string', 'null'] },
    category:     { type: 'string' },
    supermarket:  { type: ['string', 'null'] },
    image_url:    { type: ['string', 'null'] },
    score:        { type: 'number' },
    review_count: { type: 'number' },
    summary:      { type: ['string', 'null'] },
    avg_taste:    { type: 'number' },
    avg_value:    { type: 'number' },
    avg_quality:  { type: 'number' },
    cached_at:    { type: 'string' },
    source:       { type: 'string' },  // 'redis' | 'db' | 'off' | 'unknown'
  },
};

export default async function productRoutes(fastify) {

  // ── GET /product/:barcode ──────────────────────────────────────────────────
  fastify.get('/product/:barcode', {
    schema: {
      params: {
        type: 'object',
        properties: { barcode: { type: 'string', minLength: 1 } },
        required: ['barcode'],
      },
      response: { 200: scanSchema },
    },
  }, async (req, reply) => {
    const { barcode } = req.params;

    // ── Tier 1: Redis cache (< 5ms) ─────────────────────────────────────────
    const cached = await getCachedBarcode(barcode);
    if (cached) {
      trackScan(barcode);  // fire-and-forget
      return reply.send({ ...cached, source: 'redis' });
    }

    // ── Tier 2: Supabase / Postgres (< 50ms with index) ─────────────────────
    const dbProduct = await lookupBarcode(barcode);
    if (dbProduct) {
      setCachedBarcode(barcode, dbProduct);  // populate cache
      trackScan(barcode);
      return reply.send({ ...dbProduct, source: 'db' });
    }

    // ── Tier 3: Open Food Facts fallback ────────────────────────────────────
    const offProduct = await fetchFromOFF(barcode);
    if (offProduct) {
      const saved   = await upsertFromOFF(barcode, offProduct);
      const payload = buildScanPayload(saved);
      setCachedBarcode(barcode, payload);
      // Queue background enrichment (AI summary, score, etc.)
      queueEnrichment(saved.id, barcode, 5).catch(() => {});
      return reply.send({ ...payload, source: 'off' });
    }

    // ── Not found anywhere ───────────────────────────────────────────────────
    return reply.code(404).send({ error: 'Product not found', barcode });
  });


  // ── GET /search ────────────────────────────────────────────────────────────
  fastify.get('/search', {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          q:           { type: 'string', default: '' },
          supermarket: { type: 'string', default: '' },
          category:    { type: 'string', default: '' },
          limit:       { type: 'integer', default: 30, maximum: 100 },
        },
      },
    },
  }, async (req, reply) => {
    const { q, supermarket, category, limit } = req.query;

    // Cache hit
    const cached = await getCachedSearch(q, supermarket, category);
    if (cached) return reply.send({ results: cached, cached: true });

    const results = await searchProducts({ q, supermarket, category, limit });
    setCachedSearch(q, supermarket, category, results);

    return reply.send({ results, cached: false });
  });


  // ── GET /trending ──────────────────────────────────────────────────────────
  fastify.get('/trending', async (req, reply) => {
    const { redis, keys } = await import('../lib/redis.js');
    const barcodes = await redis.zrange(keys.trending(), 0, 9, { rev: true });
    return reply.send({ barcodes });
  });
}
