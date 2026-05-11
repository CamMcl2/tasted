CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  is_premium    BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  barcode               TEXT UNIQUE,
  name                  TEXT NOT NULL,
  brand                 TEXT,
  category              TEXT,
  supermarket           TEXT,
  image_url             TEXT,
  ai_summary            TEXT,
  ai_summary_updated_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS reviews (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  taste_rating   INTEGER CHECK (taste_rating BETWEEN 1 AND 5),
  value_rating   INTEGER CHECK (value_rating BETWEEN 1 AND 5),
  quality_rating INTEGER CHECK (quality_rating BETWEEN 1 AND 5),
  text           TEXT,
  photo_url      TEXT,
  is_anonymous   BOOLEAN DEFAULT FALSE,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (follower_id, following_id)
);

CREATE TABLE IF NOT EXISTS shopping_list (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  is_favourite BOOLEAN DEFAULT FALSE,
  is_checked   BOOLEAN DEFAULT FALSE,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
ALTER TABLE products      ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews       ENABLE ROW LEVEL SECURITY;
ALTER TABLE follows       ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopping_list ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Public profiles"      ON users;
DROP POLICY IF EXISTS "Own profile insert"   ON users;
DROP POLICY IF EXISTS "Own profile update"   ON users;
DROP POLICY IF EXISTS "Products public"      ON products;
DROP POLICY IF EXISTS "Auth insert products" ON products;
DROP POLICY IF EXISTS "Auth update products" ON products;
DROP POLICY IF EXISTS "Reviews public"       ON reviews;
DROP POLICY IF EXISTS "Insert reviews"       ON reviews;
DROP POLICY IF EXISTS "Follows public"       ON follows;
DROP POLICY IF EXISTS "Manage own follows"   ON follows;
DROP POLICY IF EXISTS "Own shopping list"    ON shopping_list;

-- Create policies
CREATE POLICY "Public profiles"      ON users         FOR SELECT USING (true);
CREATE POLICY "Own profile insert"   ON users         FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Own profile update"   ON users         FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Products public"      ON products      FOR SELECT USING (true);
CREATE POLICY "Auth insert products" ON products      FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Auth update products" ON products      FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Reviews public"       ON reviews       FOR SELECT USING (true);
CREATE POLICY "Insert reviews"       ON reviews       FOR INSERT WITH CHECK (true);
CREATE POLICY "Follows public"       ON follows       FOR SELECT USING (true);
CREATE POLICY "Manage own follows"   ON follows       FOR ALL    USING (auth.uid() = follower_id);
CREATE POLICY "Own shopping list"    ON shopping_list FOR ALL    USING (auth.uid() = user_id);
