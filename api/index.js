import Fastify        from 'fastify';
import cors           from '@fastify/cors';
import { createClient } from '@supabase/supabase-js';

const PORT = Number(process.env.PORT) || 3001;
const fastify = Fastify({ logger: true });

await fastify.register(cors, {
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept'],
  credentials: true,
});

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const FREE_SCAN_LIMIT = 10;

// ── Health ────────────────────────────────────────────────────────────────────
fastify.get('/',       async () => ({ status: 'ok' }));
fastify.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

// ── Barcode lookup: Supabase → Open Food Facts ────────────────────────────────
fastify.get('/product/:barcode', async (req, reply) => {
  const { barcode } = req.params;

  // 1. Check our database first
  const { data } = await supabase
    .from('products')
    .select('*')
    .eq('barcode', barcode)
    .single();

  if (data) return data;

  // 2. Fall back to Open Food Facts
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res  = await fetch(`https://world.openfoodfacts.org/api/v2/product/${barcode}.json`, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Tasted/1.0' },
    });
    clearTimeout(timer);

    const json = await res.json();
    if (json.status === 1 && json.product) {
      const p = json.product;
      const row = {
        barcode,
        name:      p.product_name || p.abbreviated_product_name || 'Unknown',
        brand:     (p.brands || '').split(',')[0].trim() || null,
        category:  p.categories_tags?.[0]?.replace('en:', '') || 'Other',
        image_url: p.image_front_url || p.image_url || null,
      };
      // Save to DB so next scan is instant
      const { data: saved } = await supabase
        .from('products').insert(row).select().single();
      return saved || row;
    }
  } catch { /* OFF timeout or error */ }

  return reply.code(404).send({ error: 'not found', barcode });
});

// ── Search ────────────────────────────────────────────────────────────────────
fastify.get('/search', async (req) => {
  const { q = '', supermarket = '', category = '' } = req.query;
  let qb = supabase
    .from('products')
    .select('id,barcode,name,brand,category,supermarket,image_url,ai_summary,avg_taste,avg_value,avg_quality,review_count');
  if (q)           qb = qb.or(`name.ilike.%${q}%,brand.ilike.%${q}%`);
  if (supermarket) qb = qb.eq('supermarket', supermarket);
  if (category)    qb = qb.eq('category', category);
  const { data } = await qb.limit(30);
  return { results: data || [] };
});

// ── Trending ──────────────────────────────────────────────────────────────────
fastify.get('/trending', async () => {
  const { data } = await supabase
    .from('products')
    .select('id,barcode,name,brand,category,image_url,supermarket,avg_taste,avg_value,avg_quality,review_count,weekly_review_count')
    .eq('is_trending', true)
    .order('weekly_review_count', { ascending: false })
    .limit(12);

  // Fallback: no trending yet → return newest products
  if (!data || data.length === 0) {
    const { data: fallback } = await supabase
      .from('products')
      .select('id,barcode,name,brand,category,image_url,supermarket,avg_taste,avg_value,avg_quality,review_count')
      .order('created_at', { ascending: false })
      .limit(12);
    return { results: fallback || [] };
  }
  return { results: data };
});

// ── Post a review ─────────────────────────────────────────────────────────────
fastify.post('/review', async (req, reply) => {
  const { productId, userId, tasteRating, valueRating, qualityRating, text, isAnonymous } = req.body || {};
  if (!productId || !tasteRating || !valueRating || !qualityRating) {
    return reply.code(400).send({ error: 'Missing required fields' });
  }
  const { error } = await supabase.from('reviews').insert({
    product_id:     productId,
    user_id:        isAnonymous ? null : (userId || null),
    taste_rating:   tasteRating,
    value_rating:   valueRating,
    quality_rating: qualityRating,
    text:           text || '',
    is_anonymous:   isAnonymous || false,
  });
  if (error) {
    fastify.log.error(error, 'review insert failed');
    return reply.code(500).send({ error: error.message });
  }
  return { ok: true };
});

// ── Scan limit check ──────────────────────────────────────────────────────────
fastify.get('/scan-limit/:userId', async (req) => {
  const { userId } = req.params;
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from('scan_logs')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('scanned_at', weekAgo);
  const used = count || 0;
  return { used, limit: FREE_SCAN_LIMIT, remaining: Math.max(0, FREE_SCAN_LIMIT - used) };
});

// ── Log a scan ────────────────────────────────────────────────────────────────
fastify.post('/scan-log', async (req) => {
  const { userId, productId, barcode } = req.body || {};
  if (userId) {
    await supabase.from('scan_logs').insert({
      user_id:    userId,
      product_id: productId || null,
      barcode:    barcode   || null,
    }).catch(() => {}); // best-effort
  }
  return { ok: true };
});

await fastify.listen({ port: PORT, host: '0.0.0.0' });
console.log(`✓ API on port ${PORT}`);
