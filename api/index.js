import Fastify from 'fastify';

const PORT = Number(process.env.PORT) || 3001;
const fastify = Fastify({ logger: true });

fastify.get('/',       async () => ({ status: 'ok' }));
fastify.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

fastify.get('/product/:barcode', async (req) => {
  const { barcode } = req.params;
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  const { data } = await supabase.from('products').select('*').eq('barcode', barcode).single();
  if (!data) return { error: 'not found', barcode };
  return data;
});

fastify.get('/search', async (req) => {
  const { q = '', supermarket = '', category = '' } = req.query;
  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  let qb = supabase.from('products').select('id,barcode,name,brand,category,supermarket,image_url,score,review_count');
  if (q)           qb = qb.or(`name.ilike.%${q}%,brand.ilike.%${q}%`);
  if (supermarket) qb = qb.eq('supermarket', supermarket);
  if (category)    qb = qb.eq('category', category);
  const { data } = await qb.order('review_count', { ascending: false }).limit(30);
  return { results: data || [] };
});

await fastify.listen({ port: PORT, host: '0.0.0.0' });
console.log(`✓ API on port ${PORT}`);
