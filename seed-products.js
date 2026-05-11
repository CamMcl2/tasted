/**
 * seed-products.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Bulk-imports the most commonly scanned UK products from Open Food Facts
 * into your Supabase products table.
 *
 * BEFORE RUNNING:
 *   1. Go to https://supabase.com/dashboard/project/emyltvgrxkbyzvkygjjh/settings/api
 *   2. Copy the "service_role" key (under "Project API keys")
 *   3. Paste it below as SUPABASE_SERVICE_KEY
 *
 * Then run:   node seed-products.js
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { createClient } from '@supabase/supabase-js';

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL          = 'https://emyltvgrxkbyzvkygjjh.supabase.co';
const SUPABASE_SERVICE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVteWx0dmdyeGtieXp2a3lnampoIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3ODM1OTQyOSwiZXhwIjoyMDkzOTM1NDI5fQ.xJub-ae9g60o3E1WlsGHYdDQjavwi6f8ZSK7vEoFQ1k'; // ← paste here

const PAGES_TO_FETCH = 50;   // 50 × 200 = up to 10,000 products
const PAGE_SIZE      = 200;
const BATCH_SIZE     = 100;
const DELAY_MS       = 500;  // be polite to OFF servers

if (SUPABASE_SERVICE_KEY === 'YOUR_SERVICE_ROLE_KEY') {
  console.error('❌  Please set SUPABASE_SERVICE_KEY in seed-products.js first.');
  console.error('    Get it from: https://supabase.com/dashboard/project/emyltvgrxkbyzvkygjjh/settings/api');
  process.exit(1);
}

// Service role key bypasses RLS — safe for server-side seeding only
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function cleanCategory(tags) {
  if (!tags?.length) return 'Other';
  const eng = tags.filter(t => t.startsWith('en:')).map(t => t.replace('en:', ''));
  if (!eng.length) return 'Other';
  const known = ['dairy','cheese','meat','fish','bakery','biscuits','snacks',
    'beverages','drinks','condiments','spreads','frozen','cereals','pasta',
    'chocolate','confectionery','eggs','vegetables','fruit','yogurts'];
  for (const k of known) {
    if (eng.some(e => e.toLowerCase().includes(k))) return capitalise(k);
  }
  return capitalise(eng[eng.length - 1].replace(/-/g, ' '));
}

function capitalise(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🛒  Tasted product seeder');
  console.log(`    Fetching ${PAGES_TO_FETCH} pages × ${PAGE_SIZE} products from Open Food Facts…\n`);

  let imported = 0;

  for (let page = 1; page <= PAGES_TO_FETCH; page++) {
    // Use OFF v2 search API — more reliable than the CGI endpoint
    const url =
      `https://world.openfoodfacts.org/api/v2/search` +
      `?countries_tags_en=united-kingdom` +
      `&sort_by=unique_scans_n` +
      `&page_size=${PAGE_SIZE}` +
      `&page=${page}` +
      `&fields=code,product_name,abbreviated_product_name,brands,categories_tags,image_front_url`;

    let products;
    try {
      const res = await fetch(url, {
        headers: {
          'User-Agent': 'Tasted-Seeder/1.0 (https://github.com/CamMcl2/tasted)',
          'Accept': 'application/json',
        },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      products   = json.products ?? [];
    } catch (err) {
      console.error(`\n  ✗ Page ${page} fetch failed: ${err.message} — retrying in 3s…`);
      await sleep(3000);
      page--; // retry same page
      continue;
    }

    if (!products.length) {
      console.log(`\n  ℹ  Page ${page} returned 0 products — stopping early.`);
      break;
    }

    // Filter and map to Supabase schema
    const rows = products
      .filter(p => p.code && (p.product_name || p.abbreviated_product_name))
      .map(p => ({
        barcode:   p.code.trim(),
        name:      (p.product_name || p.abbreviated_product_name || '').trim().slice(0, 200),
        brand:     (p.brands || '').split(',')[0].trim().slice(0, 100) || null,
        category:  cleanCategory(p.categories_tags),
        image_url: p.image_front_url || null,
      }))
      .filter(p => p.name.length > 0 && p.barcode.length > 0);

    // Insert in batches, skipping duplicates
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error } = await supabase
        .from('products')
        .upsert(batch, { onConflict: 'barcode', ignoreDuplicates: true });

      if (error) {
        console.error(`\n  ✗ Supabase error on page ${page}:`, error.message);
      } else {
        imported += batch.length;
      }
    }

    const pct = ((page / PAGES_TO_FETCH) * 100).toFixed(0);
    process.stdout.write(`  Page ${String(page).padStart(3)} / ${PAGES_TO_FETCH}  [${pct.padStart(3)}%]  ${imported.toLocaleString()} products imported\r`);

    await sleep(DELAY_MS);
  }

  console.log(`\n\n✅  Done!  ~${imported.toLocaleString()} products imported into Supabase.`);
  console.log('   Barcode scans will now resolve instantly from the local database.\n');
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
