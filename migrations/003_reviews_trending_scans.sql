-- ═══════════════════════════════════════════════════════════════════════════
-- Migration 003: Reviews fix, trending, scan limits
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Add per-rating avg columns directly on products ───────────────────────
--    (score already exists from 002 — this adds the split columns)
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS avg_taste           NUMERIC(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_value           NUMERIC(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avg_quality         NUMERIC(3,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_trending         BOOLEAN      DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS weekly_review_count INTEGER      DEFAULT 0;

-- ── 2. Scan logs for freemium tracking ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS scan_logs (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID        REFERENCES users(id) ON DELETE CASCADE,
  product_id  UUID        REFERENCES products(id) ON DELETE SET NULL,
  barcode     TEXT,
  scanned_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_scan_logs_user_week
  ON scan_logs (user_id, scanned_at DESC)
  WHERE user_id IS NOT NULL;

ALTER TABLE scan_logs ENABLE ROW LEVEL SECURITY;
-- Users can only see/insert their own logs; service role sees all
CREATE POLICY "Own scan logs" ON scan_logs
  FOR ALL USING (auth.uid() = user_id);

-- ── 3. Replace trigger to update avg columns + trending on review ─────────────
CREATE OR REPLACE FUNCTION update_product_score()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  v_avg_taste    NUMERIC(3,2);
  v_avg_value    NUMERIC(3,2);
  v_avg_quality  NUMERIC(3,2);
  v_review_count INTEGER;
  v_weekly_count INTEGER;
  v_threshold    INTEGER := 0;  -- set higher when you have real users
  v_pid          UUID;
BEGIN
  -- Handle DELETE (NEW is null on delete)
  v_pid := COALESCE(NEW.product_id, OLD.product_id);

  SELECT
    COALESCE(AVG(taste_rating),   0)::NUMERIC(3,2),
    COALESCE(AVG(value_rating),   0)::NUMERIC(3,2),
    COALESCE(AVG(quality_rating), 0)::NUMERIC(3,2),
    COUNT(*)::INTEGER
  INTO v_avg_taste, v_avg_value, v_avg_quality, v_review_count
  FROM reviews WHERE product_id = v_pid;

  SELECT COUNT(*)::INTEGER INTO v_weekly_count
  FROM reviews
  WHERE product_id = v_pid
    AND created_at > NOW() - INTERVAL '7 days';

  UPDATE products SET
    avg_taste           = v_avg_taste,
    avg_value           = v_avg_value,
    avg_quality         = v_avg_quality,
    score               = ROUND((v_avg_taste + v_avg_value + v_avg_quality) / 3, 2),
    review_count        = v_review_count,
    weekly_review_count = v_weekly_count,
    is_trending         = (v_weekly_count >= v_threshold),
    enrichment_status   = 'pending'
  WHERE id = v_pid;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Re-create trigger (002 created this but with fewer columns)
DROP TRIGGER IF EXISTS trg_review_score ON reviews;
CREATE TRIGGER trg_review_score
  AFTER INSERT OR UPDATE OR DELETE ON reviews
  FOR EACH ROW EXECUTE FUNCTION update_product_score();

-- ── 4. Backfill existing products with correct averages ───────────────────────
UPDATE products p SET
  avg_taste    = COALESCE((SELECT AVG(taste_rating)   FROM reviews WHERE product_id = p.id), 0),
  avg_value    = COALESCE((SELECT AVG(value_rating)   FROM reviews WHERE product_id = p.id), 0),
  avg_quality  = COALESCE((SELECT AVG(quality_rating) FROM reviews WHERE product_id = p.id), 0),
  review_count = COALESCE((SELECT COUNT(*)            FROM reviews WHERE product_id = p.id), 0);
