/**
 * Enrichment worker — runs as a separate process.
 * Start with: node workers/enrichment.js
 *
 * Picks up jobs from the enrichment queue and:
 *  1. Calls Anthropic API for an AI product summary
 *  2. Computes a composite score from reviews
 *  3. Writes scan_payload JSONB to products table
 *  4. Invalidates Redis cache so next scan gets fresh data
 */

import { Worker } from 'bullmq';
import { supabase, buildScanPayload } from '../lib/supabase.js';
import { invalidateBarcode }          from '../lib/redis.js';

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

const connection = {
  host:     process.env.UPSTASH_REDIS_HOST,
  port:     Number(process.env.UPSTASH_REDIS_PORT) || 6379,
  password: process.env.UPSTASH_REDIS_PASSWORD,
  tls:      {},
};

// ── AI summary generation ─────────────────────────────────────────────────────
async function generateSummary(product, reviews) {
  if (!ANTHROPIC_KEY || ANTHROPIC_KEY === 'YOUR_ANTHROPIC_API_KEY') {
    return null;
  }

  const reviewText = reviews.slice(0, 10).map(r =>
    `Rating: taste=${r.taste_rating}/5 value=${r.value_rating}/5 quality=${r.quality_rating}/5. "${r.text || ''}"`
  ).join('\n');

  const prompt = reviews.length > 0
    ? `Summarise this UK supermarket product in 2-3 sentences based on real customer reviews. Be specific and useful. Product: "${product.name}" by ${product.brand || 'unknown brand'} (${product.category}).\n\nReviews:\n${reviewText}`
    : `Write a brief 2-sentence description of this UK supermarket product: "${product.name}" by ${product.brand || 'unknown brand'} (${product.category}). Be factual and helpful.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'x-api-key':     ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-20250514',
        max_tokens: 150,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data.content?.[0]?.text?.trim() || null;
  } catch {
    return null;
  }
}

// ── Score computation ─────────────────────────────────────────────────────────
function computeScore(reviews) {
  if (!reviews.length) return { score: 0, avg_taste: 0, avg_value: 0, avg_quality: 0 };
  const avg = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const taste   = avg(reviews.map(r => r.taste_rating   || 0));
  const value   = avg(reviews.map(r => r.value_rating   || 0));
  const quality = avg(reviews.map(r => r.quality_rating || 0));
  return {
    score:       +((taste + value + quality) / 3).toFixed(2),
    avg_taste:   +taste.toFixed(2),
    avg_value:   +value.toFixed(2),
    avg_quality: +quality.toFixed(2),
  };
}

// ── Worker ────────────────────────────────────────────────────────────────────
const worker = new Worker('enrichment', async (job) => {
  const { productId, barcode } = job.data;
  console.log(`[enrichment] Processing product ${productId} (${barcode})`);

  // 1. Fetch product + its reviews
  const [{ data: product }, { data: reviews }] = await Promise.all([
    supabase.from('products').select('*').eq('id', productId).single(),
    supabase.from('reviews').select('*').eq('product_id', productId),
  ]);

  if (!product) {
    console.warn(`[enrichment] Product ${productId} not found — skipping`);
    return;
  }

  // 2. Mark as processing
  await supabase.from('products')
    .update({ enrichment_status: 'processing' })
    .eq('id', productId);

  try {
    // 3. Generate AI summary (if no recent one)
    const needsSummary = !product.ai_summary ||
      !product.ai_summary_updated_at ||
      (Date.now() - new Date(product.ai_summary_updated_at).getTime()) > 7 * 24 * 60 * 60 * 1000;

    const summary = needsSummary
      ? await generateSummary(product, reviews || [])
      : product.ai_summary;

    // 4. Compute scores
    const scores = computeScore(reviews || []);

    // 5. Build precomputed scan_payload
    const enriched = {
      ...product,
      ...scores,
      ai_summary:   summary || product.ai_summary,
      review_count: (reviews || []).length,
    };
    const payload = buildScanPayload(enriched);

    // 6. Write everything back to Supabase
    await supabase.from('products').update({
      ai_summary:            summary || product.ai_summary,
      ai_summary_updated_at: summary ? new Date().toISOString() : product.ai_summary_updated_at,
      score:                 scores.score,
      review_count:          (reviews || []).length,
      scan_payload:          payload,
      enrichment_status:     'done',
    }).eq('id', productId);

    // 7. Invalidate Redis so next scan gets the fresh payload
    if (barcode) await invalidateBarcode(barcode);

    console.log(`[enrichment] ✓ Done: ${product.name} (score: ${scores.score})`);
  } catch (err) {
    console.error(`[enrichment] ✗ Failed: ${err.message}`);
    await supabase.from('products')
      .update({ enrichment_status: 'failed' })
      .eq('id', productId);
    throw err;
  }
}, {
  connection,
  concurrency: 3,  // process 3 products in parallel
});

worker.on('completed', job => console.log(`[enrichment] Job ${job.id} completed`));
worker.on('failed',    (job, err) => console.error(`[enrichment] Job ${job?.id} failed:`, err.message));

console.log('[enrichment] Worker started — waiting for jobs…');
