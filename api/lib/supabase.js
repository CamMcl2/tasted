/**
 * Supabase admin client — uses service_role key, bypasses RLS.
 * NEVER expose this to the browser.
 */
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    db:   { schema: 'public' },
  }
);

// ── Compact scan payload builder ─────────────────────────────────────────────
// Converts a full product row into a minimal scan response.
// Keep this lean — it's what gets cached in Redis and served directly.
export function buildScanPayload(product) {
  return {
    id:           product.id,
    barcode:      product.barcode,
    name:         product.name,
    brand:        product.brand         || null,
    category:     product.category      || 'Other',
    supermarket:  product.supermarket   || null,
    image_url:    product.image_url     || null,
    score:        Number(product.score) || 0,
    review_count: product.review_count  || 0,
    summary:      product.ai_summary    || null,
    avg_taste:    Number(product.avg_taste)   || 0,
    avg_value:    Number(product.avg_value)   || 0,
    avg_quality:  Number(product.avg_quality) || 0,
    cached_at:    new Date().toISOString(),
  };
}

// ── Barcode lookup — checks scan_payload first, falls back to full row ────────
export async function lookupBarcode(barcode) {
  // Try to get precomputed payload first (single column read, fastest path)
  const { data: fast } = await supabase
    .from('products')
    .select('scan_payload, id, name, brand, category, supermarket, image_url, ai_summary, score, review_count, barcode')
    .eq('barcode', barcode)
    .single();

  if (!fast) return null;

  // If we have a precomputed payload, serve it directly
  if (fast.scan_payload) return fast.scan_payload;

  // Otherwise build payload from columns (worker hasn't run yet)
  return buildScanPayload(fast);
}

// ── Search — returns lightweight rows for the search screen ──────────────────
export async function searchProducts({ q, supermarket, category, limit = 30 }) {
  let qb = supabase
    .from('products')
    .select('id,barcode,name,brand,category,supermarket,image_url,score,review_count');

  if (q)          qb = qb.or(`name.ilike.%${q}%,brand.ilike.%${q}%`);
  if (supermarket) qb = qb.eq('supermarket', supermarket);
  if (category)    qb = qb.eq('category', category);

  qb = qb.order('review_count', { ascending: false }).limit(limit);

  const { data, error } = await qb;
  if (error) throw error;
  return data || [];
}

// ── Upsert product from Open Food Facts data ─────────────────────────────────
export async function upsertFromOFF(barcode, offProduct) {
  const row = {
    barcode,
    name:     offProduct.product_name || offProduct.abbreviated_product_name || 'Unknown',
    brand:    (offProduct.brands || '').split(',')[0].trim() || null,
    category: offProduct.categories_tags?.[0]?.replace('en:', '') || 'Other',
    image_url: offProduct.image_front_url || offProduct.image_url || null,
    enrichment_status: 'pending',
  };

  const { data, error } = await supabase
    .from('products')
    .upsert(row, { onConflict: 'barcode', ignoreDuplicates: false })
    .select('id,barcode,name,brand,category,image_url,score,review_count,ai_summary')
    .single();

  if (error) throw error;
  return data;
}
