import Fastify        from 'fastify';
import cors           from '@fastify/cors';
import { createClient } from '@supabase/supabase-js';

const PORT = Number(process.env.PORT) || 3001;
const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true });

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Health ────────────────────────────────────────────────────────────────────
fastify.get('/',       async () => ({ status: 'ok' }));
fastify.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

// ── Barcode lookup: Supabase → Open Food Facts → manual ──────────────────────
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
    .select('id,barcode,name,brand,category,supermarket,image_url,ai_summary');
  if (q)           qb = qb.or(`name.ilike.%${q}%,brand.ilike.%${q}%`);
  if (supermarket) qb = qb.eq('supermarket', supermarket);
  if (category)    qb = qb.eq('category', category);
  const { data } = await qb.limit(30);
  return { results: data || [] };
});

await fastify.listen({ port: PORT, host: '0.0.0.0' });
console.log(`✓ API on port ${PORT}`);
