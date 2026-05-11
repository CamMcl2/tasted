-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 002: Performance optimisations
-- Run this in Supabase SQL Editor (Project → SQL Editor → New query)
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Trigram extension for fast ILIKE search ───────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ── 2. Fast-path indexes on products ─────────────────────────────────────────

-- Exact barcode lookup (already unique, this makes it a btree covering index)
CREATE INDEX IF NOT EXISTS idx_products_barcode
  ON products (barcode)
  WHERE barcode IS NOT NULL;

-- Full-text search on name and brand
CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON products USING GIN (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_brand_trgm
  ON products USING GIN (brand gin_trgm_ops);

-- Category + supermarket filter index (for filtered search)
CREATE INDEX IF NOT EXISTS idx_products_category
  ON products (category)
  WHERE category IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_products_supermarket
  ON products (supermarket)
  WHERE supermarket IS NOT NULL;

-- ── 3. Denormalised columns on products for zero-join scan responses ──────────

-- Precomputed average score (updated by trigger / worker)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS score          NUMERIC(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_count   INTEGER      DEFAULT 0,
  ADD COLUMN IF NOT EXISTS enrichment_status TEXT      DEFAULT 'pending'
    CHECK (enrichment_status IN ('pending','processing','done','failed'));

-- Precomputed compact scan payload — worker writes this, API serves it directly
-- Avoids ALL joins at scan time
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS scan_payload JSONB;

-- Index so we can efficiently find products that need enrichment
CREATE INDEX IF NOT EXISTS idx_products_enrichment_status
  ON products (enrichment_status)
  WHERE enrichment_status IN ('pending', 'failed');

-- ── 4. Fast reviews indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_reviews_product_id
  ON reviews (product_id);

CREATE INDEX IF NOT EXISTS idx_reviews_user_id
  ON reviews (user_id)
  WHERE user_id IS NOT NULL;

-- ── 5. Materialised view: product summary (refreshed by worker) ──────────────
CREATE MATERIALIZED VIEW IF NOT EXISTS product_summary AS
SELECT
  p.id,
  p.barcode,
  p.name,
  p.brand,
  p.category,
  p.supermarket,
  p.image_url,
  p.ai_summary,
  p.score,
  p.review_count,
  p.scan_payload,
  COALESCE(AVG(r.taste_rating),   0)::NUMERIC(3,2) AS avg_taste,
  COALESCE(AVG(r.value_rating),   0)::NUMERIC(3,2) AS avg_value,
  COALESCE(AVG(r.quality_rating), 0)::NUMERIC(3,2) AS avg_quality,
  COUNT(r.id)::INTEGER                              AS live_review_count
FROM products p
LEFT JOIN reviews r ON r.product_id = p.id
GROUP BY p.id;

-- Unique index so REFRESH CONCURRENTLY works
CREATE UNIQUE INDEX IF NOT EXISTS idx_product_summary_id
  ON product_summary (id);

-- ── 6. Trigger: keep score + review_count current on new reviews ─────────────
CREATE OR REPLACE FUNCTION update_product_score()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE products SET
    score = (
      SELECT COALESCE(
        AVG((taste_rating + value_rating + quality_rating)::NUMERIC / 3), 0
      )::NUMERIC(3,2)
      FROM reviews WHERE product_id = NEW.product_id
    ),
    review_count = (
      SELECT COUNT(*) FROM reviews WHERE product_id = NEW.product_id
    ),
    -- Mark for re-enrichment so worker regenerates scan_payload
    enrichment_status = 'pending'
  WHERE id = NEW.product_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_review_score ON reviews;
CREATE TRIGGER trg_review_score
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_product_score();
