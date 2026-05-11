/*
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  TASTED — Supermarket Product Review Platform                ║
 * ║  "Know what's worth buying before you buy it."               ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * SETUP: npm install   then   npm run dev
 * Replace the placeholder constants below with your real keys.
 * Note: Calling Anthropic directly from the browser exposes your
 * API key — route it through a backend function in production.
 *
 * ══════════════════════════════════════════════════════════════
 * DATABASE SCHEMA — paste into Supabase SQL Editor
 * ══════════════════════════════════════════════════════════════
 *
 * CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
 *
 * CREATE TABLE users (
 *   id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
 *   display_name  TEXT NOT NULL,
 *   avatar_url    TEXT,
 *   is_premium    BOOLEAN DEFAULT FALSE,
 *   created_at    TIMESTAMPTZ DEFAULT NOW()
 * );
 *
 * CREATE TABLE products (
 *   id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   barcode               TEXT UNIQUE,
 *   name                  TEXT NOT NULL,
 *   brand                 TEXT,
 *   category              TEXT,
 *   supermarket           TEXT,
 *   image_url             TEXT,
 *   ai_summary            TEXT,
 *   ai_summary_updated_at TIMESTAMPTZ,
 *   created_at            TIMESTAMPTZ DEFAULT NOW()
 * );
 *
 * CREATE TABLE reviews (
 *   id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
 *   product_id     UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 *   taste_rating   INTEGER CHECK (taste_rating BETWEEN 1 AND 5),
 *   value_rating   INTEGER CHECK (value_rating BETWEEN 1 AND 5),
 *   quality_rating INTEGER CHECK (quality_rating BETWEEN 1 AND 5),
 *   text           TEXT,
 *   photo_url      TEXT,
 *   is_anonymous   BOOLEAN DEFAULT FALSE,
 *   created_at     TIMESTAMPTZ DEFAULT NOW()
 * );
 *
 * CREATE TABLE follows (
 *   follower_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *   following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *   created_at   TIMESTAMPTZ DEFAULT NOW(),
 *   PRIMARY KEY (follower_id, following_id)
 * );
 *
 * CREATE TABLE shopping_list (
 *   id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
 *   user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 *   product_id   UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
 *   is_favourite BOOLEAN DEFAULT FALSE,
 *   is_checked   BOOLEAN DEFAULT FALSE,
 *   created_at   TIMESTAMPTZ DEFAULT NOW()
 * );
 *
 * ALTER TABLE users         ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE products      ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE reviews       ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE follows       ENABLE ROW LEVEL SECURITY;
 * ALTER TABLE shopping_list ENABLE ROW LEVEL SECURITY;
 *
 * CREATE POLICY "Public profiles"      ON users         FOR SELECT USING (true);
 * CREATE POLICY "Own profile insert"   ON users         FOR INSERT WITH CHECK (auth.uid() = id);
 * CREATE POLICY "Own profile update"   ON users         FOR UPDATE USING (auth.uid() = id);
 * CREATE POLICY "Products public"      ON products      FOR SELECT USING (true);
 * CREATE POLICY "Auth insert products" ON products      FOR INSERT WITH CHECK (auth.role() = 'authenticated');
 * CREATE POLICY "Auth update products" ON products      FOR UPDATE USING (auth.role() = 'authenticated');
 * CREATE POLICY "Reviews public"       ON reviews       FOR SELECT USING (true);
 * CREATE POLICY "Insert reviews"       ON reviews       FOR INSERT WITH CHECK (true);
 * CREATE POLICY "Follows public"       ON follows       FOR SELECT USING (true);
 * CREATE POLICY "Manage own follows"   ON follows       FOR ALL    USING (auth.uid() = follower_id);
 * CREATE POLICY "Own shopping list"    ON shopping_list FOR ALL    USING (auth.uid() = user_id);
 */

import React, {
  useState, useEffect, useCallback, useRef,
  useContext, createContext, useMemo,
} from 'react';
import { createClient } from '@supabase/supabase-js';

// ══════════════════════════════════════════════════════════════
// CONFIGURATION — replace with your real keys
// ══════════════════════════════════════════════════════════════
const SUPABASE_URL      = 'https://emyltvgrxkbyzvkygjjh.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVteWx0dmdyeGtieXp2a3lnampoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgzNTk0MjksImV4cCI6MjA5MzkzNTQyOX0.3Yiqlkne1uxWAXPuhy1_tBTO0sWm2oSm4OYbCvZzXgo';
const ANTHROPIC_API_KEY = 'YOUR_ANTHROPIC_API_KEY';
const STRIPE_KEY        = 'YOUR_STRIPE_KEY'; // eslint-disable-line no-unused-vars
const OFF_BASE          = 'https://world.openfoodfacts.org/api/v2/product';

// When the Fastify API is deployed, set VITE_API_URL in Netlify env vars.
// Falls back to direct Supabase calls if not set.
const API_URL  = import.meta.env.VITE_API_URL || '';
const HAS_API  = API_URL.length > 0;

const IS_DEMO  = SUPABASE_URL === 'YOUR_SUPABASE_URL';
const supabase = IS_DEMO
  ? null
  : createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ══════════════════════════════════════════════════════════════
// MOCK DATA
// ══════════════════════════════════════════════════════════════
const MOCK_PRODUCTS = [
  { id:'p1', barcode:'5000169100224', name:'Extra Mature Cheddar', brand:'Cathedral City', category:'Cheese', supermarket:'Tesco', image_url:null, price:3.50, avg_taste:4.6, avg_value:4.2, avg_quality:4.5, review_count:48, ai_summary:'Consistently praised for its sharp, mature bite and clean finish. Shoppers consider it excellent value for a premium cheddar, though some wish the packaging were more resealable. A reliable staple for cheese boards and cooking alike.' },
  { id:'p2', barcode:'5010251082583', name:'Thick Cut Seville Orange Marmalade', brand:'Tiptree', category:'Spreads', supermarket:'Waitrose', image_url:null, price:2.95, avg_taste:4.8, avg_value:3.9, avg_quality:4.7, review_count:23, ai_summary:'A rich, bittersweet marmalade with generous peel chunks and authentic Seville orange depth. The premium price divides opinion, but most feel it is well justified by the quality. A weekend breakfast essential.' },
  { id:'p3', barcode:'5000295122863', name:'Total 0% Fat Free Greek Yogurt', brand:'Fage', category:'Dairy', supermarket:"Sainsbury's", image_url:null, price:2.20, avg_taste:4.4, avg_value:4.0, avg_quality:4.6, review_count:61, ai_summary:'Exceptionally thick and creamy despite zero fat content. A firm favourite for healthy breakfasts and cooking — the neutral flavour divides some but the protein content and consistency earn near-universal respect.' },
  { id:'p4', barcode:'5052034600015', name:'Dark Chocolate Digestives', brand:"McVitie's", category:'Biscuits', supermarket:'Asda', image_url:null, price:1.89, avg_taste:4.9, avg_value:4.3, avg_quality:4.5, review_count:112, ai_summary:'The undisputed dunking biscuit of choice. The ratio of dark chocolate to digestive base is widely considered perfect, and they hold their structure in tea better than most rivals. Outstanding value in multipack form.' },
  { id:'p5', barcode:'5052034200004', name:'Dry Cured Smoked Back Bacon', brand:'M&S Collection', category:'Meat', supermarket:'M&S', image_url:null, price:3.75, avg_taste:4.7, avg_value:3.6, avg_quality:4.8, review_count:34, ai_summary:'Premium dry-cured rashers delivering intense smokiness with minimal shrinkage in the pan. The quality is undeniable and worth the price as a weekend treat, though everyday value is mixed versus supermarket own-label.' },
  { id:'p6', barcode:'20411337', name:'Free Range Medium Eggs (6)', brand:'Aldi Specially Selected', category:'Eggs', supermarket:'Aldi', image_url:null, price:1.39, avg_taste:4.5, avg_value:4.9, avg_quality:4.4, review_count:89, ai_summary:'Outstanding value free-range eggs with noticeably rich, golden yolks. Shoppers consistently rate these above far pricier alternatives — a genuinely standout Aldi proposition that earns repeat purchases across all demographics.' },
  { id:'p7', barcode:'20721234', name:'Sourdough Bloomer', brand:'Lidl Bakery', category:'Bakery', supermarket:'Lidl', image_url:null, price:1.29, avg_taste:4.3, avg_value:4.9, avg_quality:4.2, review_count:44, ai_summary:'Genuinely impressive sourdough for the price — proper tang, decent crust, and a moist crumb. Some note it dries out quickly, but toasted it is exceptional value and far better than most budget alternatives.' },
  { id:'p8', barcode:'5052034700014', name:'Plant Kitchen No-Beef Mince', brand:'M&S Plant Kitchen', category:'Vegetarian', supermarket:'M&S', image_url:null, price:3.00, avg_taste:3.8, avg_value:3.5, avg_quality:4.0, review_count:5, ai_summary:null },
];

const MOCK_REVIEWS = [
  { id:'r1', product_id:'p1', user_id:'u2', display_name:'Sarah M.', initials:'SM', taste_rating:5, value_rating:4, quality_rating:5, text:"Absolutely love this cheddar. The sharpness is just right — not overwhelming but genuinely mature. Goes brilliantly on a jacket potato or in a toastie. Been buying it for years.", is_anonymous:false, created_at:'2026-05-08T14:23:00Z' },
  { id:'r2', product_id:'p1', user_id:'u3', display_name:'James T.', initials:'JT', taste_rating:4, value_rating:4, quality_rating:4, text:"Solid everyday cheddar. Not the cheapest but consistently good quality. Always stock up when it's on offer at Tesco — usually drops to £2.50.", is_anonymous:false, created_at:'2026-05-06T09:15:00Z' },
  { id:'r3', product_id:'p1', user_id:null, display_name:'Anonymous', initials:null, taste_rating:5, value_rating:5, quality_rating:5, text:'Best cheddar you can buy in a supermarket. Full stop. Everything else is a pale imitation.', is_anonymous:true, created_at:'2026-05-04T18:40:00Z' },
  { id:'r4', product_id:'p4', user_id:'u2', display_name:'Sarah M.', initials:'SM', taste_rating:5, value_rating:4, quality_rating:5, text:'Dangerous to have in the house. The chocolate-to-biscuit ratio is genuinely perfect and they hold up in tea without going immediately mushy.', is_anonymous:false, created_at:'2026-05-07T20:10:00Z' },
  { id:'r5', product_id:'p3', user_id:'u4', display_name:'Priya K.', initials:'PK', taste_rating:4, value_rating:4, quality_rating:5, text:'My go-to for overnight oats. The consistency is incredible and it keeps me full until lunch. Slightly pricey but the quality is absolutely worth it.', is_anonymous:false, created_at:'2026-05-05T07:45:00Z' },
  { id:'r6', product_id:'p5', user_id:'u3', display_name:'James T.', initials:'JT', taste_rating:5, value_rating:3, quality_rating:5, text:"Sunday breakfast is not complete without these. Shrinks barely at all in the pan and the smokiness tastes real, not artificial. Pricey for everyday use though.", is_anonymous:false, created_at:'2026-05-03T09:00:00Z' },
  { id:'r7', product_id:'p6', user_id:'u2', display_name:'Sarah M.', initials:'SM', taste_rating:5, value_rating:5, quality_rating:4, text:'How Aldi can sell free-range eggs this good at this price I will never understand. The yolks are deep orange and genuinely taste fresh.', is_anonymous:false, created_at:'2026-05-09T11:30:00Z' },
  { id:'r8', product_id:'p2', user_id:'u4', display_name:'Priya K.', initials:'PK', taste_rating:5, value_rating:4, quality_rating:5, text:'Proper bittersweet marmalade with huge chunks of peel. Nothing else comes close for a Sunday morning with proper toast. Worth every penny.', is_anonymous:false, created_at:'2026-05-07T08:15:00Z' },
];

const MOCK_USERS = [
  { id:'u1', display_name:'Alex Chen',  initials:'AC', is_premium:false, review_count:14, followers:23,  following:18 },
  { id:'u2', display_name:'Sarah M.',   initials:'SM', is_premium:true,  review_count:67, followers:142, following:38 },
  { id:'u3', display_name:'James T.',   initials:'JT', is_premium:false, review_count:28, followers:15,  following:22 },
  { id:'u4', display_name:'Priya K.',   initials:'PK', is_premium:false, review_count:31, followers:44,  following:29 },
];

const SUPERMARKETS = ["Tesco","Sainsbury's","Asda","Waitrose","Aldi","Lidl","M&S","Co-op","Morrisons","Ocado"];
const CATEGORIES   = ["Dairy","Meat","Fish","Bakery","Fruit & Veg","Snacks","Biscuits","Spreads","Drinks","Frozen","Ready Meals","Eggs","Cheese","Vegetarian","Condiments"];

// Pre-populated UK product catalogue for shopping list autocomplete
const UK_PRODUCTS_DB = [
  { name:'Semi-Skimmed Milk (4 pints)', brand:'Tesco', category:'Dairy', supermarket:'Tesco' },
  { name:'Whole Milk (6 pints)', brand:"Sainsbury's", category:'Dairy', supermarket:"Sainsbury's" },
  { name:'Cravendale Filtered Milk (2L)', brand:'Cravendale', category:'Dairy', supermarket:'Various' },
  { name:'Anchor Salted Butter (250g)', brand:'Anchor', category:'Dairy', supermarket:'Various' },
  { name:'Lurpak Slightly Salted Butter', brand:'Lurpak', category:'Dairy', supermarket:'Various' },
  { name:'Total 0% Greek Yogurt (500g)', brand:'Fage', category:'Dairy', supermarket:"Sainsbury's" },
  { name:'Activia Natural Yogurt (4 pack)', brand:'Danone', category:'Dairy', supermarket:'Various' },
  { name:'Clotted Cream (227g)', brand:"Rodda's", category:'Dairy', supermarket:'Various' },
  { name:'Extra Mature Cheddar (400g)', brand:'Cathedral City', category:'Cheese', supermarket:'Tesco' },
  { name:'Mature Cheddar (400g)', brand:'Davidstow', category:'Cheese', supermarket:'Various' },
  { name:'Brie (200g)', brand:'President', category:'Cheese', supermarket:'Waitrose' },
  { name:'Stilton (200g)', brand:'Long Clawson', category:'Cheese', supermarket:'Waitrose' },
  { name:'Mozzarella (125g)', brand:'Galbani', category:'Cheese', supermarket:'Various' },
  { name:'Parmesan (100g)', brand:'Grana Padano', category:'Cheese', supermarket:'Various' },
  { name:'Smoked Back Bacon (300g)', brand:'M&S Collection', category:'Meat', supermarket:'M&S' },
  { name:'British Beef Mince (500g)', brand:'Tesco', category:'Meat', supermarket:'Tesco' },
  { name:'Free Range Chicken Breasts (500g)', brand:"Sainsbury's", category:'Meat', supermarket:"Sainsbury's" },
  { name:'Pork Sausages (8 pack)', brand:'Richmond', category:'Meat', supermarket:'Various' },
  { name:'Chicken Thighs (800g)', brand:'Asda', category:'Meat', supermarket:'Asda' },
  { name:'Lamb Mince (500g)', brand:"Sainsbury's", category:'Meat', supermarket:"Sainsbury's" },
  { name:'Smoked Salmon (100g)', brand:'Loch Fyne', category:'Fish', supermarket:'Various' },
  { name:'Cod Fillets (2 pack)', brand:'Birds Eye', category:'Fish', supermarket:'Various' },
  { name:'King Prawns (180g)', brand:'Tesco', category:'Fish', supermarket:'Tesco' },
  { name:'Tuna Chunks in Spring Water', brand:'John West', category:'Fish', supermarket:'Various' },
  { name:'Sourdough Bloomer', brand:'Lidl Bakery', category:'Bakery', supermarket:'Lidl' },
  { name:'Seeded Batch Loaf', brand:'Warburtons', category:'Bakery', supermarket:'Various' },
  { name:'White Farmhouse Loaf', brand:'Hovis', category:'Bakery', supermarket:'Various' },
  { name:'Bagels (5 pack)', brand:'New York Bakeli', category:'Bakery', supermarket:'Various' },
  { name:'Croissants (4 pack)', brand:'Lidl Bakery', category:'Bakery', supermarket:'Lidl' },
  { name:'Crumpets (6 pack)', brand:'Warburtons', category:'Bakery', supermarket:'Various' },
  { name:'Dark Chocolate Digestives', brand:"McVitie's", category:'Biscuits', supermarket:'Various' },
  { name:'Milk Chocolate Hobnobs', brand:"McVitie's", category:'Biscuits', supermarket:'Various' },
  { name:'Bourbon Creams', brand:"Fox's", category:'Biscuits', supermarket:'Various' },
  { name:'Jaffa Cakes (12 pack)', brand:"McVitie's", category:'Biscuits', supermarket:'Various' },
  { name:'Rich Tea Biscuits', brand:"McVitie's", category:'Biscuits', supermarket:'Various' },
  { name:'Shortbread Rounds', brand:'Walkers', category:'Biscuits', supermarket:'Various' },
  { name:'Custard Creams', brand:"Crawford's", category:'Biscuits', supermarket:'Various' },
  { name:'Ready Salted Crisps (6 pack)', brand:'Walkers', category:'Snacks', supermarket:'Various' },
  { name:'Prawn Cocktail Crisps (6 pack)', brand:'Walkers', category:'Snacks', supermarket:'Various' },
  { name:'Kettle Chips Sea Salt (150g)', brand:'Kettle', category:'Snacks', supermarket:'Various' },
  { name:'Pringles Original (200g)', brand:'Pringles', category:'Snacks', supermarket:'Various' },
  { name:'Nakd Cocoa Mint Bar', brand:'Nakd', category:'Snacks', supermarket:'Various' },
  { name:'Tracker Bars (6 pack)', brand:'Tracker', category:'Snacks', supermarket:'Various' },
  { name:'Thick Cut Seville Orange Marmalade', brand:'Tiptree', category:'Spreads', supermarket:'Waitrose' },
  { name:'Strawberry Jam (370g)', brand:'Bonne Maman', category:'Spreads', supermarket:'Various' },
  { name:'Smooth Peanut Butter (340g)', brand:'Whole Earth', category:'Spreads', supermarket:'Various' },
  { name:'Crunchy Peanut Butter (340g)', brand:'Whole Earth', category:'Spreads', supermarket:'Various' },
  { name:'Nutella (400g)', brand:'Nutella', category:'Spreads', supermarket:'Various' },
  { name:'Marmite (250g)', brand:'Marmite', category:'Spreads', supermarket:'Various' },
  { name:'Lemon Curd (312g)', brand:"Tesco Finest", category:'Spreads', supermarket:'Tesco' },
  { name:'Orange Juice Not From Concentrate (1L)', brand:'Tropicana', category:'Drinks', supermarket:'Various' },
  { name:'Sparkling Water (6x500ml)', brand:'Buxton', category:'Drinks', supermarket:'Various' },
  { name:'Oat Milk Barista Edition (1L)', brand:'Oatly', category:'Drinks', supermarket:'Various' },
  { name:'Diet Coke (6x330ml cans)', brand:'Coca-Cola', category:'Drinks', supermarket:'Various' },
  { name:'Yorkshire Tea (80 bags)', brand:'Yorkshire Tea', category:'Drinks', supermarket:'Various' },
  { name:'PG Tips (80 bags)', brand:'PG Tips', category:'Drinks', supermarket:'Various' },
  { name:'Nescafe Original (200g)', brand:'Nescafe', category:'Drinks', supermarket:'Various' },
  { name:'Innocent Orange Juice (900ml)', brand:'Innocent', category:'Drinks', supermarket:'Various' },
  { name:'Free Range Medium Eggs (6)', brand:'Aldi Specially Selected', category:'Eggs', supermarket:'Aldi' },
  { name:'Free Range Large Eggs (12)', brand:'Clarence Court', category:'Eggs', supermarket:'Waitrose' },
  { name:'Organic Free Range Eggs (6)', brand:"Sainsbury's Organic", category:'Eggs', supermarket:"Sainsbury's" },
  { name:'Baby Spinach (200g)', brand:'Tesco', category:'Fruit & Veg', supermarket:'Tesco' },
  { name:'Avocados (2 pack)', brand:"Sainsbury's", category:'Fruit & Veg', supermarket:"Sainsbury's" },
  { name:'Cherry Tomatoes (400g)', brand:'Waitrose', category:'Fruit & Veg', supermarket:'Waitrose' },
  { name:'Tenderstem Broccoli (200g)', brand:'M&S', category:'Fruit & Veg', supermarket:'M&S' },
  { name:'Strawberries (400g)', brand:'Tesco', category:'Fruit & Veg', supermarket:'Tesco' },
  { name:'Bananas (5 pack)', brand:'Fairtrade', category:'Fruit & Veg', supermarket:'Various' },
  { name:'Garden Peas (900g)', brand:'Birds Eye', category:'Frozen', supermarket:'Various' },
  { name:'Oven Chips (1.25kg)', brand:'McCain', category:'Frozen', supermarket:'Various' },
  { name:'Margherita Pizza', brand:"Dr. Oetker", category:'Frozen', supermarket:'Various' },
  { name:'Fish Fingers (10 pack)', brand:'Birds Eye', category:'Frozen', supermarket:'Various' },
  { name:'Ben & Jerry\'s Cookie Dough (465ml)', brand:"Ben & Jerry's", category:'Frozen', supermarket:'Various' },
  { name:'Chicken Tikka Masala', brand:'Tesco Finest', category:'Ready Meals', supermarket:'Tesco' },
  { name:'Spaghetti Bolognese', brand:"Sainsbury's Taste the Diff.", category:'Ready Meals', supermarket:"Sainsbury's" },
  { name:'Macaroni Cheese', brand:'M&S', category:'Ready Meals', supermarket:'M&S' },
  { name:'Chicken Korma with Rice', brand:'Waitrose', category:'Ready Meals', supermarket:'Waitrose' },
  { name:'Heinz Tomato Ketchup (700g)', brand:'Heinz', category:'Condiments', supermarket:'Various' },
  { name:"Hellmann's Real Mayonnaise (430g)", brand:"Hellmann's", category:'Condiments', supermarket:'Various' },
  { name:"Colman's English Mustard (100g)", brand:"Colman's", category:'Condiments', supermarket:'Various' },
  { name:'Tabasco Original (60ml)', brand:'Tabasco', category:'Condiments', supermarket:'Various' },
  { name:'Soy Sauce (150ml)', brand:'Kikkoman', category:'Condiments', supermarket:'Various' },
  { name:'Plant Kitchen No-Beef Mince', brand:'M&S Plant Kitchen', category:'Vegetarian', supermarket:'M&S' },
  { name:'Quorn Mince (500g)', brand:'Quorn', category:'Vegetarian', supermarket:'Various' },
  { name:'Linda McCartney Sausages (6 pack)', brand:'Linda McCartney', category:'Vegetarian', supermarket:'Various' },
  { name:'Oat So Simple Original (10 sachets)', brand:'Quaker', category:'Dairy', supermarket:'Various' },
  { name:'Porridge Oats (1kg)', brand:'Scott\'s', category:'Dairy', supermarket:'Various' },
];

// ══════════════════════════════════════════════════════════════
// GLOBAL STYLES
// ══════════════════════════════════════════════════════════════
const GLOBAL_CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#f8f8f8;--surface:#fff;--surface2:#f2f4f6;--text:#1a1a1a;--muted:#6b7280;
  --border:#e0e0e0;--accent:#4A7FA5;--accent-h:#3d6d91;--accent-light:#e8f1f8;
  --amber:#F5A623;--amber-bg:#fff8ed;--danger:#e53e3e;--success:#38a169;
  --nav:68px;--radius:12px;--radius-sm:8px;--tr:.2s ease;
  --shadow:0 1px 3px rgba(0,0,0,.08),0 1px 2px rgba(0,0,0,.05);
  --shadow-md:0 4px 12px rgba(0,0,0,.08);--shadow-lg:0 8px 24px rgba(0,0,0,.1);
}
@media(prefers-color-scheme:dark){:root{
  --bg:#121212;--surface:#1e1e1e;--surface2:#272727;--text:#f0f0f0;--muted:#9ca3af;
  --border:#333;--accent-light:#1a2e3d;--amber-bg:#1a1200;
  --shadow:0 1px 3px rgba(0,0,0,.4);--shadow-md:0 4px 12px rgba(0,0,0,.4);--shadow-lg:0 8px 24px rgba(0,0,0,.5);
}}
html{height:100%;height:-webkit-fill-available}
body{min-height:100%;min-height:-webkit-fill-available}
html,body,#root{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;background:var(--bg);color:var(--text);font-size:16px;line-height:1.5;-webkit-font-smoothing:antialiased}
#root{height:100dvh;height:100vh;overflow:hidden}
button{cursor:pointer;font-family:inherit;border:none;background:none}
a{color:var(--accent);text-decoration:none}
input,textarea,select{font-family:inherit;font-size:15px;background:var(--surface);color:var(--text);border:1.5px solid var(--border);border-radius:var(--radius-sm);padding:11px 13px;width:100%;outline:none;transition:border-color var(--tr)}
input:focus,textarea:focus,select:focus{border-color:var(--accent)}
input::placeholder,textarea::placeholder{color:var(--muted)}

.screen{position:absolute;inset:0;background:var(--bg);overflow-y:auto;padding-bottom:calc(var(--nav) + 12px);animation:fadeUp .22s ease both}
@keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}

.card{background:var(--surface);border-radius:var(--radius);box-shadow:var(--shadow);overflow:hidden;transition:box-shadow var(--tr)}
.card:active{box-shadow:var(--shadow-md)}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:10px 20px;border-radius:9999px;font-size:15px;font-weight:600;transition:opacity var(--tr),transform var(--tr),background var(--tr);border:none}
.btn:active{transform:scale(.97)}
.btn:disabled{opacity:.45;cursor:not-allowed}
.btn-primary{background:var(--accent);color:#fff}
.btn-primary:hover:not(:disabled){background:var(--accent-h)}
.btn-secondary{background:var(--surface2);color:var(--text)}
.btn-secondary:hover{background:var(--border)}
.btn-ghost{background:transparent;color:var(--muted)}
.btn-danger{background:var(--danger);color:#fff}
.btn-full{width:100%}
.btn-sm{padding:7px 14px;font-size:13px}

.badge{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:9999px;font-size:12px;font-weight:600}
.badge-accent{background:var(--accent-light);color:var(--accent)}
.badge-amber{background:var(--amber-bg);color:#a06010}
.badge-success{background:#e6f4ea;color:var(--success)}
.badge-premium{background:linear-gradient(135deg,#b8860b,#f0c030);color:#1a1a1a}

.skeleton{background:linear-gradient(90deg,var(--surface2) 25%,var(--border) 50%,var(--surface2) 75%);background-size:200% 100%;animation:shimmer 1.6s infinite;border-radius:var(--radius-sm)}
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}

.chip-row{display:flex;gap:8px;overflow-x:auto;padding:4px 0 8px;scrollbar-width:none;-webkit-overflow-scrolling:touch}
.chip-row::-webkit-scrollbar{display:none}
.chip{flex-shrink:0;padding:6px 14px;border-radius:9999px;border:1.5px solid var(--border);background:var(--surface);font-size:13px;font-weight:500;color:var(--muted);cursor:pointer;white-space:nowrap;transition:all var(--tr)}
.chip.active{background:var(--accent);color:#fff;border-color:var(--accent)}

.divider{height:1px;background:var(--border);margin:16px 0}

.modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(4px);z-index:200;display:flex;align-items:flex-end;justify-content:center;animation:fadeIn .15s ease both}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
.modal-sheet{background:var(--surface);border-radius:20px 20px 0 0;width:100%;max-width:640px;max-height:92vh;overflow-y:auto;animation:slideUp .25s ease both;padding:20px;padding-bottom:32px}
@keyframes slideUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
.modal-handle{width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 20px}

.toast{position:fixed;bottom:calc(var(--nav) + 16px);left:50%;transform:translateX(-50%);background:var(--text);color:var(--bg);padding:10px 20px;border-radius:9999px;font-size:14px;font-weight:500;z-index:999;white-space:nowrap;animation:toastIn .2s ease both;box-shadow:var(--shadow-lg)}
@keyframes toastIn{from{opacity:0;transform:translateX(-50%) translateY(8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}

.toggle{position:relative;width:44px;height:24px;flex-shrink:0}
.toggle input{opacity:0;width:0;height:0;position:absolute}
.toggle-track{position:absolute;inset:0;background:var(--border);border-radius:24px;transition:background var(--tr);cursor:pointer}
.toggle-track::before{content:'';position:absolute;height:18px;width:18px;left:3px;top:3px;background:#fff;border-radius:50%;transition:transform .2s}
.toggle input:checked~.toggle-track{background:var(--accent)}
.toggle input:checked~.toggle-track::before{transform:translateX(20px)}

.search-wrap{position:relative;display:flex;align-items:center}
.search-wrap svg{position:absolute;left:12px;color:var(--muted);pointer-events:none;flex-shrink:0}
.search-wrap input{padding-left:40px}

.rating-track{flex:1;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden}
.rating-fill{height:100%;background:var(--amber);border-radius:4px;transition:width .6s ease}

::-webkit-scrollbar{width:5px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}

.section-head{display:flex;align-items:center;justify-content:space-between;padding:16px 16px 8px}
.section-title{font-size:18px;font-weight:700}

.scan-overlay{position:fixed;inset:0;background:#000;z-index:400;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:24px}
.viewfinder{position:relative;width:256px;height:256px}
.vf-corner{position:absolute;width:32px;height:32px;border-style:solid;border-color:var(--accent);transition:all .2s ease}
.vf-corner.tl{top:0;left:0;border-width:3px 0 0 3px;border-radius:6px 0 0 0}
.vf-corner.tr{top:0;right:0;border-width:3px 3px 0 0;border-radius:0 6px 0 0}
.vf-corner.bl{bottom:0;left:0;border-width:0 0 3px 3px;border-radius:0 0 0 6px}
.vf-corner.br{bottom:0;right:0;border-width:0 3px 3px 0;border-radius:0 0 6px 0}
.vf-detected .vf-corner{border-color:#22c55e;width:42px;height:42px}
.vf-detected{background:rgba(34,197,94,.12);border-radius:12px}
.scan-line{position:absolute;left:4px;right:4px;height:2px;background:linear-gradient(90deg,transparent,var(--accent),transparent);animation:scanline 2s ease-in-out infinite}
@keyframes scanline{0%,100%{top:8px}50%{top:calc(100% - 10px)}}
@keyframes pulse-green{0%,100%{opacity:1}50%{opacity:.5}}
@keyframes spin{to{transform:rotate(360deg)}}

.product-hero{width:100%;height:220px;object-fit:cover;background:var(--surface2)}
.product-hero-placeholder{width:100%;height:220px;background:var(--surface2);display:flex;align-items:center;justify-content:center;font-size:64px}
`;

// ══════════════════════════════════════════════════════════════
// UTILS
// ══════════════════════════════════════════════════════════════
function fmt(dateStr) {
  const d = new Date(dateStr);
  const diff = (Date.now() - d) / 1000;
  if (diff < 60)    return 'just now';
  if (diff < 3600)  return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  if (diff < 604800)return `${Math.floor(diff/86400)}d ago`;
  return d.toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}

function avg(...vals) {
  const valid = vals.filter(v => v > 0);
  return valid.length ? valid.reduce((a,b) => a+b, 0) / valid.length : 0;
}

function categoryEmoji(cat) {
  const map = { Dairy:'🥛', Meat:'🥩', Fish:'🐟', Bakery:'🍞', 'Fruit & Veg':'🥦',
    Snacks:'🍿', Biscuits:'🍪', Spreads:'🫙', Drinks:'🥤', Frozen:'❄️',
    'Ready Meals':'🍱', Eggs:'🥚', Cheese:'🧀', Vegetarian:'🌿', Condiments:'🧴' };
  return map[cat] || '🛒';
}

// ══════════════════════════════════════════════════════════════
// ICONS
// ══════════════════════════════════════════════════════════════
const Icon = ({ d, size=22, strokeWidth=2, fill='none', stroke='currentColor', ...p }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={fill} stroke={stroke}
    strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" {...p}>
    {Array.isArray(d) ? d.map((dd,i)=><path key={i} d={dd}/>) : <path d={d}/>}
  </svg>
);

const HomeIco    = ({a}) => <Icon fill={a?'currentColor':'none'} d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10"/>;
const SearchIco  = () => <Icon d={['M11 11m-8 0a8 8 0 1016 0 8 8 0 00-16 0','M21 21l-4.35-4.35']}/>;
const CompareIco = () => <Icon d={['M9 3H5a2 2 0 00-2 2v14a2 2 0 002 2h4','M19 3h-4a2 2 0 00-2 2v14a2 2 0 002 2h4a2 2 0 002-2V5a2 2 0 00-2-2z']}/>;
const ListIco    = ({a}) => <Icon fill={a?'currentColor':'none'} d={['M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2','M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2','M9 12h6M9 16h4']}/>;
const BarcodeIco = () => (
  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
    <path d="M3 5v14M6 5v14M9.5 5v14M13 5v14M16 5v14M19 5v14M21 5v4M21 15v4M1 5v4M1 15v4"/>
  </svg>
);
const BackIco    = () => <Icon d="M19 12H5M12 5l-7 7 7 7"/>;
const PlusIco    = () => <Icon d="M12 5v14M5 12h14"/>;
const CheckIco   = () => <Icon d="M20 6L9 17l-5-5"/>;
const XIco       = () => <Icon d="M18 6L6 18M6 6l12 12"/>;
const StarIco    = ({f}) => <Icon fill={f?'#F5A623':'none'} stroke={f?'#F5A623':'#d1d5db'} d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>;
const UserIco    = () => <Icon d={['M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2','M12 3a4 4 0 100 8 4 4 0 000-8z']}/>;
const HeartIco   = ({f}) => <Icon fill={f?'#e53e3e':'none'} stroke={f?'#e53e3e':'currentColor'} d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>;
const CamIco     = () => <Icon d={['M23 19a2 2 0 01-2 2H3a2 2 0 01-2-2V8a2 2 0 012-2h4l2-3h6l2 3h4a2 2 0 012 2z','M12 17a4 4 0 100-8 4 4 0 000 8z']}/>;
const SettingsIco= () => <Icon d={['M12 15a3 3 0 100-6 3 3 0 000 6z','M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z']}/>;
const ShopIco    = () => <Icon d={['M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z','M3 6h18','M16 10a4 4 0 01-8 0']}/>;
const TrendIco   = () => <Icon d="M23 6l-9.5 9.5-5-5L1 18 M17 6h6v6"/>;

// ══════════════════════════════════════════════════════════════
// CONTEXTS
// ══════════════════════════════════════════════════════════════
const AuthCtx     = createContext(null);
const ToastCtx    = createContext(null);
const NavCtx      = createContext(null);
const ShopListCtx = createContext(null);

// ══════════════════════════════════════════════════════════════
// STYLE INJECTOR
// ══════════════════════════════════════════════════════════════
function StyleInjector() {
  useEffect(() => {
    const el = document.createElement('style');
    el.textContent = GLOBAL_CSS;
    document.head.appendChild(el);
    return () => document.head.removeChild(el);
  }, []);
  return null;
}

// ══════════════════════════════════════════════════════════════
// BASE COMPONENTS
// ══════════════════════════════════════════════════════════════
function Toast({ message }) {
  return <div className="toast">{message}</div>;
}

function Avatar({ initials, url, size=36, style={} }) {
  const colors = ['#4A7FA5','#7A5FA5','#A55F7A','#5FA57A','#A5875F'];
  const bg = initials ? colors[initials.charCodeAt(0) % colors.length] : '#888';
  return (
    <div style={{ width:size, height:size, borderRadius:'50%', background: url?'transparent':bg,
      display:'flex', alignItems:'center', justifyContent:'center',
      color:'#fff', fontWeight:700, fontSize:size*0.35, flexShrink:0, overflow:'hidden', ...style }}>
      {url ? <img src={url} alt="" style={{width:'100%',height:'100%',objectFit:'cover'}}/> : (initials||'?')}
    </div>
  );
}

function StarDisplay({ value=0, size=18, showNum=false }) {
  const stars = [1,2,3,4,5];
  return (
    <span style={{display:'inline-flex',alignItems:'center',gap:2}}>
      {stars.map(s => (
        <svg key={s} width={size} height={size} viewBox="0 0 24 24"
          fill={value>=s?'#F5A623':value>=s-0.5?'url(#half)':'none'}
          stroke={value>=s-0.5?'#F5A623':'#d1d5db'}
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <defs>
            <linearGradient id="half"><stop offset="50%" stopColor="#F5A623"/><stop offset="50%" stopColor="transparent"/></linearGradient>
          </defs>
          <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
        </svg>
      ))}
      {showNum && <span style={{fontSize:size*0.9,color:'var(--muted)',marginLeft:4}}>{value.toFixed(1)}</span>}
    </span>
  );
}

function StarPicker({ value, onChange, label }) {
  const [hover, setHover] = useState(0);
  return (
    <div>
      {label && <div style={{fontSize:13,color:'var(--muted)',marginBottom:6}}>{label}</div>}
      <div style={{display:'flex',gap:6}}>
        {[1,2,3,4,5].map(s => (
          <button key={s} onMouseEnter={()=>setHover(s)} onMouseLeave={()=>setHover(0)}
            onClick={()=>onChange(s)} style={{background:'none',border:'none',padding:2,cursor:'pointer'}}>
            <svg width="28" height="28" viewBox="0 0 24 24"
              fill={(hover||value)>=s?'#F5A623':'none'}
              stroke={(hover||value)>=s?'#F5A623':'#d1d5db'}
              strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
            </svg>
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={e=>onChange(e.target.checked)}/>
      <span className="toggle-track"/>
    </label>
  );
}

function SkeletonProductCard() {
  return (
    <div className="card" style={{padding:16,display:'flex',gap:12}}>
      <div className="skeleton" style={{width:72,height:72,borderRadius:10,flexShrink:0}}/>
      <div style={{flex:1,display:'flex',flexDirection:'column',gap:8}}>
        <div className="skeleton" style={{height:16,width:'70%'}}/>
        <div className="skeleton" style={{height:13,width:'40%'}}/>
        <div className="skeleton" style={{height:13,width:'90%'}}/>
      </div>
    </div>
  );
}

function RatingBar({ label, value }) {
  return (
    <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}>
      <span style={{fontSize:13,color:'var(--muted)',width:52,flexShrink:0}}>{label}</span>
      <div className="rating-track"><div className="rating-fill" style={{width:`${(value/5)*100}%`}}/></div>
      <span style={{fontSize:13,fontWeight:600,width:26,textAlign:'right'}}>{value.toFixed(1)}</span>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PRODUCT CARD
// ══════════════════════════════════════════════════════════════
function ProductCard({ product, reviewer, onClick }) {
  const overall = avg(product.avg_taste, product.avg_value, product.avg_quality);
  return (
    <div className="card" style={{margin:'0 16px 12px',cursor:'pointer'}} onClick={()=>onClick(product)}>
      <div style={{display:'flex',gap:12,padding:14}}>
        <div style={{width:72,height:72,borderRadius:10,background:'var(--surface2)',flexShrink:0,
          display:'flex',alignItems:'center',justifyContent:'center',fontSize:32,overflow:'hidden'}}>
          {product.image_url
            ? <img src={product.image_url} alt={product.name} style={{width:'100%',height:'100%',objectFit:'cover'}}/>
            : categoryEmoji(product.category)}
        </div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8}}>
            <div>
              <div style={{fontWeight:700,fontSize:15,lineHeight:1.3}}>{product.name}</div>
              <div style={{fontSize:13,color:'var(--muted)',marginTop:2}}>{product.brand} · <span className="badge badge-accent" style={{fontSize:11,padding:'1px 7px'}}>{product.supermarket}</span></div>
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              <StarDisplay value={overall} size={14}/>
              <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>{product.review_count} reviews</div>
            </div>
          </div>
          {product.ai_summary && (
            <p style={{fontSize:13,color:'var(--muted)',marginTop:8,lineHeight:1.5,
              overflow:'hidden',display:'-webkit-box',WebkitLineClamp:2,WebkitBoxOrient:'vertical'}}>
              {product.ai_summary}
            </p>
          )}
          {reviewer && (
            <div style={{display:'flex',alignItems:'center',gap:6,marginTop:8}}>
              <Avatar initials={reviewer.initials} size={20}/>
              <span style={{fontSize:12,color:'var(--muted)'}}>{reviewer.display_name} reviewed this</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// REVIEW CARD
// ══════════════════════════════════════════════════════════════
function ReviewCard({ review, compact=false }) {
  return (
    <div style={{padding:'14px 0',borderBottom:'1px solid var(--border)'}}>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:8}}>
        <Avatar initials={review.is_anonymous ? null : review.initials} size={32}/>
        <div style={{flex:1}}>
          <div style={{fontWeight:600,fontSize:14}}>{review.is_anonymous ? 'Anonymous' : review.display_name}</div>
          <div style={{fontSize:12,color:'var(--muted)'}}>{fmt(review.created_at)}</div>
        </div>
        <StarDisplay value={avg(review.taste_rating,review.value_rating,review.quality_rating)} size={14}/>
      </div>
      {!compact && (
        <div style={{display:'flex',gap:12,marginBottom:8}}>
          {[['Taste',review.taste_rating],['Value',review.value_rating],['Quality',review.quality_rating]].map(([l,v])=>(
            <div key={l} style={{textAlign:'center'}}>
              <div style={{fontSize:11,color:'var(--muted)'}}>{l}</div>
              <div style={{fontSize:13,fontWeight:700,color:'var(--amber)'}}>{v}/5</div>
            </div>
          ))}
        </div>
      )}
      {review.text && <p style={{fontSize:14,lineHeight:1.6,color:'var(--text)'}}>{review.text}</p>}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// AUTH SCREEN
// ══════════════════════════════════════════════════════════════
function AuthScreen() {
  const [mode, setMode] = useState('login'); // login | signup
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { setUser } = useContext(AuthCtx);
  const { showToast } = useContext(ToastCtx);

  async function handleEmailAuth(e) {
    e.preventDefault();
    setLoading(true); setError('');
    // Timeout promise — give up after 25 seconds (Supabase free tier can be slow to wake up)
    const timeout = new Promise((_,reject) =>
      setTimeout(()=>reject(new Error('Request timed out. Your database may be waking up — wait 2 minutes and try again.')), 25000)
    );
    try {
      if (IS_DEMO) {
        setUser({ ...MOCK_USERS[0], isNew: mode==='signup' });
        showToast('Signed in (demo mode)');
        return;
      }
      if (mode === 'signup') {
        const { error } = await Promise.race([
          supabase.auth.signUp({ email, password }),
          timeout,
        ]);
        if (error) throw error;
        showToast('Account created! You can now sign in.');
      } else {
        const { data, error } = await Promise.race([
          supabase.auth.signInWithPassword({ email, password }),
          timeout,
        ]);
        if (error) throw error;
        // Let onAuthStateChange handle setting the full user profile
        // Just clear loading — the listener will update user state
      }
    } catch(err) {
      setError(err.message || 'Something went wrong. Please try again.');
    } finally { setLoading(false); }
  }

  async function handleGoogle() {
    if (IS_DEMO) { setUser({ ...MOCK_USERS[0] }); showToast('Signed in (demo mode)'); return; }
    await supabase.auth.signInWithOAuth({ provider:'google', options:{ redirectTo: window.location.origin } });
  }

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
      <div style={{width:'100%',maxWidth:400}}>
        <div style={{textAlign:'center',marginBottom:40}}>
          <div style={{fontSize:42,marginBottom:8}}>🛒</div>
          <h1 style={{fontSize:32,fontWeight:800,letterSpacing:-1}}>Tasted</h1>
          <p style={{color:'var(--muted)',marginTop:6,fontSize:15}}>Know what's worth buying before you buy it.</p>
        </div>

        <button className="btn btn-secondary btn-full" style={{marginBottom:16,height:48,fontSize:15}} onClick={handleGoogle}>
          <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
          Continue with Google
        </button>

        <div style={{display:'flex',alignItems:'center',gap:12,margin:'20px 0'}}>
          <div style={{flex:1,height:1,background:'var(--border)'}}/>
          <span style={{color:'var(--muted)',fontSize:13}}>or</span>
          <div style={{flex:1,height:1,background:'var(--border)'}}/>
        </div>

        <form onSubmit={handleEmailAuth} style={{display:'flex',flexDirection:'column',gap:12}}>
          <input type="email" placeholder="Email address" value={email} onChange={e=>setEmail(e.target.value)} required/>
          <input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6}/>
          {error && <p style={{fontSize:13,color:'var(--danger)',padding:'8px 12px',background:'#fef2f2',borderRadius:8}}>{error}</p>}
          <button type="submit" className="btn btn-primary btn-full" style={{height:48}} disabled={loading}>
            {loading ? 'Please wait…' : mode==='login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <p style={{textAlign:'center',marginTop:20,fontSize:14,color:'var(--muted)'}}>
          {mode==='login' ? "Don't have an account? " : "Already have an account? "}
          <button onClick={()=>setMode(m=>m==='login'?'signup':'login')}
            style={{color:'var(--accent)',fontWeight:600,background:'none',border:'none',cursor:'pointer'}}>
            {mode==='login' ? 'Sign up' : 'Sign in'}
          </button>
        </p>
        {IS_DEMO && (
          <p style={{textAlign:'center',marginTop:12,fontSize:12,color:'var(--muted)',background:'var(--surface2)',padding:'8px 12px',borderRadius:8}}>
            Running in demo mode — no real Supabase connection needed.
          </p>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// ONBOARDING
// ══════════════════════════════════════════════════════════════
function OnboardingScreen() {
  const { user, setUser } = useContext(AuthCtx);
  const { showToast } = useContext(ToastCtx);
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleContinue() {
    if (!name.trim()) return;
    setLoading(true);
    try {
      if (IS_DEMO) {
        setUser({ ...user, display_name: name.trim(), isNew: false });
        showToast('Welcome to Tasted!');
        return;
      }
      const { error } = await supabase.from('users').insert({
        id: user.id, display_name: name.trim(), is_premium: false,
      });
      if (error) throw error;
      setUser({ ...user, display_name: name.trim(), isNew: false });
      showToast('Welcome to Tasted!');
    } catch(err) {
      showToast('Could not save your name — try again.');
    } finally { setLoading(false); }
  }

  return (
    <div style={{minHeight:'100vh',background:'var(--bg)',display:'flex',alignItems:'center',justifyContent:'center',padding:24}}>
      <div style={{width:'100%',maxWidth:400,textAlign:'center'}}>
        <div style={{fontSize:56,marginBottom:16}}>👋</div>
        <h2 style={{fontSize:26,fontWeight:800,marginBottom:8}}>What should we call you?</h2>
        <p style={{color:'var(--muted)',marginBottom:32}}>Choose a display name for your reviews. You can change this later.</p>
        <input placeholder="e.g. Sarah M." value={name} onChange={e=>setName(e.target.value)}
          style={{textAlign:'center',fontSize:18,marginBottom:16}} maxLength={30}/>
        <button className="btn btn-primary btn-full" style={{height:48}} onClick={handleContinue}
          disabled={!name.trim()||loading}>
          {loading ? 'Saving…' : 'Get started →'}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// HOME SCREEN
// ══════════════════════════════════════════════════════════════
function HomeScreen({ onProduct }) {
  const { user } = useContext(AuthCtx);
  const [feed, setFeed] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(0);
  const { navigate } = useContext(NavCtx);

  const load = useCallback(async () => {
    if (IS_DEMO) {
      await new Promise(r=>setTimeout(r,700));
      const enriched = MOCK_REVIEWS.map(rev => ({
        ...rev,
        product: MOCK_PRODUCTS.find(p=>p.id===rev.product_id),
      })).filter(r=>r.product).slice(0,10);
      setFeed(enriched);
      setLoading(false); setRefreshing(false);
      return;
    }
    try {
      const { data } = await supabase.from('reviews')
        .select('*, products(*), users(display_name,avatar_url)')
        .order('created_at', { ascending:false }).limit(20);
      setFeed(data||[]);
    } catch { }
    setLoading(false); setRefreshing(false);
  }, []);

  useEffect(()=>{ load(); }, [load]);

  function handleTouchStart(e){ startY.current = e.touches[0].clientY; }
  function handleTouchEnd(e){
    if(e.changedTouches[0].clientY - startY.current > 80 && !refreshing){
      setRefreshing(true); load();
    }
  }

  return (
    <div className="screen" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
      {/* Header */}
      <div style={{background:'var(--surface)',padding:'16px 16px 12px',position:'sticky',top:0,zIndex:10,
        borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:800,letterSpacing:-0.5}}>🛒 Tasted</h1>
          <p style={{fontSize:13,color:'var(--muted)'}}>Know what's worth buying.</p>
        </div>
        <button onClick={()=>navigate('profile',{userId:user?.id})} style={{background:'none',border:'none'}}>
          <Avatar initials={user?.initials||user?.display_name?.slice(0,2)||'?'} size={38}/>
        </button>
      </div>

      {refreshing && (
        <div style={{textAlign:'center',padding:'12px',color:'var(--muted)',fontSize:13}}>Refreshing…</div>
      )}

      {/* Trending section */}
      <div className="section-head" style={{marginTop:8}}>
        <span className="section-title">🔥 Trending now</span>
      </div>
      <div style={{display:'flex',gap:12,overflowX:'auto',padding:'0 16px 16px',scrollbarWidth:'none'}}>
        {loading ? [1,2,3].map(i=>(
          <div key={i} className="skeleton" style={{width:140,height:160,borderRadius:12,flexShrink:0}}/>
        )) : MOCK_PRODUCTS.slice(0,5).map(p=>{
          const o = avg(p.avg_taste,p.avg_value,p.avg_quality);
          return (
            <div key={p.id} className="card" style={{width:148,flexShrink:0,cursor:'pointer',padding:12}}
              onClick={()=>onProduct(p)}>
              <div style={{fontSize:36,textAlign:'center',marginBottom:8}}>{categoryEmoji(p.category)}</div>
              <div style={{fontSize:13,fontWeight:700,lineHeight:1.3,marginBottom:4}}>{p.name}</div>
              <div style={{fontSize:11,color:'var(--muted)',marginBottom:6}}>{p.brand}</div>
              <StarDisplay value={o} size={12}/>
            </div>
          );
        })}
      </div>

      {/* Recent reviews */}
      <div className="section-head">
        <span className="section-title">Latest reviews</span>
        <TrendIco/>
      </div>

      {loading ? (
        [1,2,3,4].map(i=><SkeletonProductCard key={i}/>)
      ) : feed.length === 0 ? (
        <div style={{textAlign:'center',padding:'48px 24px',color:'var(--muted)'}}>
          <div style={{fontSize:48,marginBottom:12}}>🍽️</div>
          <div style={{fontWeight:600,marginBottom:4}}>Nothing in your feed yet</div>
          <div style={{fontSize:14}}>Follow some reviewers or scan your first product to get started.</div>
        </div>
      ) : (
        feed.map(item => (
          <ProductCard key={item.id} product={item.product}
            reviewer={item.is_anonymous ? null : { display_name: item.display_name, initials: item.initials }}
            onClick={onProduct}/>
        ))
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// SEARCH SCREEN
// ══════════════════════════════════════════════════════════════
function SearchScreen({ onProduct }) {
  const [q, setQ] = useState('');
  const [supermarket, setSupermarket] = useState('');
  const [category, setCategory] = useState('');
  const [results, setResults] = useState(IS_DEMO ? MOCK_PRODUCTS : []);
  const [loading, setLoading] = useState(false);
  const debounce = useRef(null);

  const search = useCallback(async (query, sup, cat) => {
    setLoading(true);
    if (IS_DEMO) {
      let r = MOCK_PRODUCTS;
      if (query) r = r.filter(p => `${p.name} ${p.brand}`.toLowerCase().includes(query.toLowerCase()));
      if (sup)   r = r.filter(p => p.supermarket === sup);
      if (cat)   r = r.filter(p => p.category === cat);
      setResults(r);
      setLoading(false);
      return;
    }
    try {
      if (HAS_API) {
        const params = new URLSearchParams({ q: query||'', supermarket: sup||'', category: cat||'' });
        const res = await Promise.race([
          fetch(`${API_URL}/search?${params}`),
          new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')), 8000)),
        ]);
        const json = await res.json();
        setResults(json.results || []);
      } else {
        let qb = supabase
          .from('products')
          .select('id,barcode,name,brand,category,supermarket,image_url,ai_summary');
        if (query) qb = qb.or(`name.ilike.%${query}%,brand.ilike.%${query}%`);
        if (sup)   qb = qb.eq('supermarket', sup);
        if (cat)   qb = qb.eq('category', cat);
        qb = qb.order('review_count', { ascending: false }).limit(30);

        const { data } = await Promise.race([
          qb,
          new Promise((_,r)=>setTimeout(()=>r(new Error('timeout')), 8000)),
        ]);
        setResults(data || []);
      }
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  function handleQ(v) {
    setQ(v);
    clearTimeout(debounce.current);
    debounce.current = setTimeout(()=>search(v,supermarket,category),400);
  }

  function handleFilter(sup, cat) {
    setSupermarket(sup); setCategory(cat);
    search(q, sup, cat);
  }

  return (
    <div className="screen">
      <div style={{background:'var(--surface)',padding:'16px',position:'sticky',top:0,zIndex:10,borderBottom:'1px solid var(--border)'}}>
        <h2 style={{fontSize:22,fontWeight:800,marginBottom:12}}>Search</h2>
        <div className="search-wrap">
          <SearchIco/>
          <input placeholder="Product name or brand…" value={q} onChange={e=>handleQ(e.target.value)}/>
        </div>
        <div className="chip-row" style={{marginTop:10}}>
          <button className={`chip${!supermarket&&!category?' active':''}`} onClick={()=>handleFilter('','')}>All</button>
          {SUPERMARKETS.map(s=>(
            <button key={s} className={`chip${supermarket===s?' active':''}`}
              onClick={()=>handleFilter(supermarket===s?'':s,category)}>{s}</button>
          ))}
        </div>
        <div className="chip-row">
          {CATEGORIES.map(c=>(
            <button key={c} className={`chip${category===c?' active':''}`}
              onClick={()=>handleFilter(supermarket,category===c?'':c)}>{c}</button>
          ))}
        </div>
      </div>

      <div style={{padding:'8px 0'}}>
        {loading ? [1,2,3].map(i=><SkeletonProductCard key={i}/>) : (
          results.length===0 ? (
            <div style={{textAlign:'center',padding:'48px 24px',color:'var(--muted)'}}>
              <div style={{fontSize:48,marginBottom:12}}>🔍</div>
              <div style={{fontWeight:600,marginBottom:4}}>No results found</div>
              <div style={{fontSize:14}}>Try scanning the barcode instead — or add the product manually.</div>
            </div>
          ) : results.map(p=><ProductCard key={p.id} product={p} onClick={onProduct}/>)
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// SCAN SCREEN
// ══════════════════════════════════════════════════════════════
function ScanScreen({ onClose, onProduct }) {
  const [status, setStatus]       = useState('Initialising camera…');
  const [error, setError]         = useState('');
  const [found, setFound]         = useState(null);
  const [manual, setManual]       = useState(false);
  const [detected, setDetected]   = useState(false);   // green flash when code read
  const [scannedCode, setScannedCode] = useState('');  // show code under viewfinder
  const [lookingUp, setLookingUp] = useState(false);   // spinner state
  const [form, setForm]           = useState({ name:'', brand:'', supermarket:'', category:'', barcode:'' });
  const [saving, setSaving]       = useState(false);
  const videoRef  = useRef(null);
  const readerRef = useRef(null);
  const { showToast } = useContext(ToastCtx);

  useEffect(()=>{
    let cancelled = false;
    // Hard failsafe — if nothing resolves in 18s, go to manual
    const hardTimeout = setTimeout(()=>{
      if (!cancelled) { cancelled = true; setManual(true); }
    }, 18000);

    // ── Shared handler: called with barcode string once detected ─────────────
    async function handleCode(code) {
      if (cancelled) return;
      cancelled = true;
      clearTimeout(hardTimeout);
      setDetected(true);
      setScannedCode(code);
      setStatus('');
      setLookingUp(true);
      try {
        if (HAS_API) {
          const controller = new AbortController();
          const timer = setTimeout(()=>controller.abort(), 10000);
          try {
            const res = await fetch(`${API_URL}/product/${code}`, { signal: controller.signal });
            clearTimeout(timer);
            if (res.ok) {
              const p = await res.json();
              setLookingUp(false);
              setFound({ ...p, avg_taste:p.avg_taste??0, avg_value:p.avg_value??0, avg_quality:p.avg_quality??0 });
              return;
            }
          } catch { clearTimeout(timer); }
        }
        if (!IS_DEMO) {
          try {
            const { data } = await Promise.race([
              supabase.from('products').select('*').eq('barcode', code).single(),
              new Promise((_,r)=>setTimeout(()=>r(new Error('t')),2000)),
            ]);
            if (data) { setLookingUp(false); setFound({ ...data, avg_taste:data.avg_taste??0, avg_value:data.avg_value??0, avg_quality:data.avg_quality??0, review_count:data.review_count??0 }); return; }
          } catch { /* continue */ }
        }
        const controller = new AbortController();
        const offTimer = setTimeout(()=>controller.abort(), 8000);
        try {
          const res  = await fetch(`${OFF_BASE}/${code}.json`, { signal: controller.signal });
          clearTimeout(offTimer);
          const data = await res.json();
          if (data.status === 1 && data.product) {
            const p = { id:code, barcode:code, name:data.product.product_name||data.product.abbreviated_product_name||'Unknown', brand:data.product.brands||'', category:data.product.categories_tags?.[0]?.replace('en:','')||'Other', supermarket:'', image_url:data.product.image_front_url||null, avg_taste:0, avg_value:0, avg_quality:0, review_count:0, ai_summary:null };
            if (!IS_DEMO) supabase.from('products').insert({ barcode:p.barcode, name:p.name, brand:p.brand, category:p.category, image_url:p.image_url }).catch(()=>{});
            setLookingUp(false); setFound(p); return;
          }
        } catch { clearTimeout(offTimer); }
      } catch { /* fall through */ }
      setLookingUp(false);
      setForm(f=>({...f, barcode:code}));
      setManual(true);
    }

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (cancelled) { stream.getTracks().forEach(t=>t.stop()); return; }
        videoRef.current.srcObject = stream;
        videoRef.current.play();
        readerRef.current = { stream };
        setStatus('Point camera at a barcode');

        if ('BarcodeDetector' in window) {
          // ── Native BarcodeDetector (Android Chrome — very fast) ───────────
          const detector = new window.BarcodeDetector({
            formats: ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf','qr_code'],
          });
          const tick = async () => {
            if (cancelled) return;
            try {
              const results = await detector.detect(videoRef.current);
              if (results.length > 0) { await handleCode(results[0].rawValue); return; }
            } catch { /* frame not ready */ }
            requestAnimationFrame(tick);
          };
          requestAnimationFrame(tick);
        } else {
          // ── ZXing fallback (iOS Safari, older browsers) ───────────────────
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          readerRef.current = { stream, reader };
          reader.decodeFromStream(stream, videoRef.current, async (result) => {
            if (!cancelled && result) await handleCode(result.getText());
          });
        }
      } catch(e) {
        clearTimeout(hardTimeout);
        const msg = e?.message || '';
        if (msg.includes('Permission') || msg.includes('NotAllowed') || msg.includes('permission')) {
          setError('Camera access denied. Please allow camera access in your browser settings.');
        } else {
          setError('Could not start camera. Try adding the product manually.');
        }
      }
    }
    start();
    return () => {
      cancelled = true;
      clearTimeout(hardTimeout);
      try { readerRef.current?.stream?.getTracks().forEach(t=>t.stop()); } catch {}
      try { readerRef.current?.reader?.reset?.(); } catch {}
    };
  }, []);

  async function lookupBarcode() {
    if (!form.barcode.trim()) return;
    setSaving(true);
    try {
      // Try API first, then direct Supabase
      let product = null;
      if (HAS_API) {
        const res = await Promise.race([
          fetch(`${API_URL}/product/${form.barcode.trim()}`),
          new Promise((_,r) => setTimeout(() => r(new Error('timeout')), 8000)),
        ]);
        if (res.ok) product = await res.json();
      } else if (!IS_DEMO) {
        const { data } = await supabase.from('products').select('*').eq('barcode', form.barcode.trim()).single();
        product = data;
      }
      if (product && !product.error) {
        setFound(product);
        setManual(false);
        return;
      }
    } catch { /* not found — stay on manual form */ }
    setSaving(false);
    showToast('Barcode not found — fill in the details below');
  }

  async function saveManual(e) {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const newP = {
        id: `manual-${Date.now()}`, barcode: form.barcode||null,
        name: form.name, brand: form.brand, supermarket: form.supermarket,
        category: form.category || 'Other', image_url: null,
        avg_taste:0, avg_value:0, avg_quality:0, review_count:0, ai_summary:null,
      };
      if (!IS_DEMO) {
        const { data } = await Promise.race([
          supabase.from('products').insert({
            barcode:newP.barcode||null, name:newP.name, brand:newP.brand,
            supermarket:newP.supermarket, category:newP.category,
          }).select().single(),
          new Promise((_,r) => setTimeout(() => r(new Error('timeout')), 8000)),
        ]);
        if (data) newP.id = data.id;
      }
      showToast('Product added!');
      onProduct(newP);
      onClose();
    } catch {
      showToast('Could not save — please try again');
    } finally {
      setSaving(false);
    }
  }

  // ── Found screen ────────────────────────────────────────────────────────
  if (found) return (
    <div className="scan-overlay" style={{background:'var(--bg)',padding:24}}>
      <div style={{fontSize:48}}>{categoryEmoji(found.category)}</div>
      <div style={{textAlign:'center'}}>
        <h2 style={{fontSize:22,fontWeight:800}}>{found.name}</h2>
        <p style={{color:'var(--muted)',marginTop:4}}>{found.brand}</p>
        <span className="badge badge-accent" style={{marginTop:8}}>{found.category}</span>
      </div>
      <div style={{display:'flex',flexDirection:'column',gap:12,width:'100%',maxWidth:320}}>
        <button className="btn btn-primary btn-full" style={{height:48}} onClick={()=>{ onProduct(found); onClose(); }}>
          View product page
        </button>
        <button className="btn btn-secondary btn-full" style={{height:48}} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );

  // ── Manual entry screen ─────────────────────────────────────────────────
  if (manual) return (
    <div className="scan-overlay" style={{background:'var(--bg)',justifyContent:'flex-start',overflowY:'auto',padding:24}}>
      <div style={{width:'100%',maxWidth:480}}>
        <button onClick={onClose} style={{marginBottom:16,color:'var(--muted)'}}>
          <BackIco/>
        </button>
        <h2 style={{fontSize:22,fontWeight:800,marginBottom:4}}>Add product manually</h2>
        <p style={{color:'var(--muted)',marginBottom:24,fontSize:14}}>
          {form.barcode
            ? `Barcode ${form.barcode} wasn't found — fill in the details below.`
            : "Couldn't find that product — fill in the details below."}
        </p>
        <form onSubmit={saveManual} style={{display:'flex',flexDirection:'column',gap:12}}>
          <input placeholder="Product name *" value={form.name}
            onChange={e=>setForm(f=>({...f,name:e.target.value}))} required/>
          <input placeholder="Brand" value={form.brand}
            onChange={e=>setForm(f=>({...f,brand:e.target.value}))}/>
          <div style={{display:'flex',gap:8}}>
            <input placeholder="Barcode number" value={form.barcode}
              onChange={e=>setForm(f=>({...f,barcode:e.target.value}))}
              inputMode="numeric" style={{flex:1}}/>
            {form.barcode.trim() && (
              <button type="button" className="btn btn-secondary" style={{flexShrink:0,fontSize:13}}
                onClick={lookupBarcode} disabled={saving}>
                {saving ? '…' : 'Look up'}
              </button>
            )}
          </div>
          <select value={form.supermarket} onChange={e=>setForm(f=>({...f,supermarket:e.target.value}))}>
            <option value="">Supermarket (optional)</option>
            {SUPERMARKETS.map(s=><option key={s}>{s}</option>)}
          </select>
          <select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
            <option value="">Category (optional)</option>
            {CATEGORIES.map(c=><option key={c}>{c}</option>)}
          </select>
          <button type="submit" className="btn btn-primary btn-full" style={{height:48,marginTop:8}} disabled={saving}>
            {saving ? 'Saving…' : 'Add product'}
          </button>
        </form>
      </div>
    </div>
  );

  // ── Camera view ─────────────────────────────────────────────────────────
  return (
    <div className="scan-overlay">
      <button onClick={onClose} style={{position:'absolute',top:48,left:24,color:'#fff',padding:8}}>
        <XIco/>
      </button>
      <p style={{color:'rgba(255,255,255,.6)',fontSize:13,letterSpacing:.5,textTransform:'uppercase'}}>Barcode scanner</p>

      <div style={{position:'relative',width:260,height:260}}>
        <video ref={videoRef}
          style={{position:'absolute',inset:0,width:'100%',height:'100%',objectFit:'cover',borderRadius:12}}
          playsInline muted/>
        <div className={`viewfinder${detected?' vf-detected':''}`} style={{position:'absolute',inset:0,borderRadius:12}}>
          <div className="vf-corner tl"/><div className="vf-corner tr"/>
          <div className="vf-corner bl"/><div className="vf-corner br"/>
          {!error && !detected && <div className="scan-line"/>}
        </div>
      </div>

      {/* Status area below viewfinder */}
      {error ? (
        <div style={{padding:'16px 24px',background:'rgba(255,255,255,.1)',borderRadius:12,maxWidth:300,textAlign:'center'}}>
          <p style={{color:'#fff',fontSize:14,marginBottom:12}}>{error}</p>
          <button className="btn btn-secondary btn-sm" onClick={()=>setManual(true)}>Add manually instead</button>
        </div>
      ) : lookingUp ? (
        <div style={{textAlign:'center'}}>
          <p style={{color:'#22c55e',fontSize:16,fontWeight:700,letterSpacing:.3}}>
            ✓ BARCODE DETECTED
          </p>
          <p style={{color:'rgba(255,255,255,.5)',fontSize:12,marginTop:4,fontFamily:'monospace'}}>{scannedCode}</p>
          <p style={{color:'rgba(255,255,255,.7)',fontSize:13,marginTop:8}}>Looking up product…</p>
        </div>
      ) : (
        <p style={{color:'rgba(255,255,255,.85)',fontSize:15,fontWeight:500,textAlign:'center',maxWidth:260}}>
          {status}
        </p>
      )}

      {!lookingUp && (
        <button className="btn btn-secondary btn-sm" onClick={()=>setManual(true)}>
          Add product manually
        </button>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// REVIEW FORM
// ══════════════════════════════════════════════════════════════
function ReviewForm({ product, onClose, onSubmitted }) {
  const { user } = useContext(AuthCtx);
  const { showToast } = useContext(ToastCtx);
  const [taste,   setTaste]   = useState(0);
  const [value,   setValue]   = useState(0);
  const [quality, setQuality] = useState(0);
  const [text,    setText]    = useState('');
  const [anon,    setAnon]    = useState(false);
  const [saving,  setSaving]  = useState(false);

  const freeReviewsLeft = IS_DEMO ? (5 - 2) : 3; // demo: pretend 2 used

  async function submit(e) {
    e.preventDefault();
    if (!taste||!value||!quality) { showToast('Please rate all three categories'); return; }
    if (!IS_DEMO && !user?.is_premium && freeReviewsLeft<=0) {
      showToast('Free tier limit reached — upgrade for unlimited reviews');
      return;
    }
    setSaving(true);
    const review = {
      id: `r-${Date.now()}`,
      product_id:     product.id,
      user_id:        anon ? null : user?.id,
      display_name:   anon ? 'Anonymous' : (user?.display_name || 'You'),
      initials:       anon ? null : (user?.initials || user?.display_name?.slice(0,2)),
      taste_rating:   taste,
      value_rating:   value,
      quality_rating: quality,
      text:           text.trim(),
      is_anonymous:   anon,
      created_at:     new Date().toISOString(),
    };
    if (!IS_DEMO) {
      const { error } = await supabase.from('reviews').insert({
        product_id: product.id, user_id: anon?null:user?.id,
        taste_rating:taste, value_rating:value, quality_rating:quality,
        text:text.trim(), is_anonymous:anon,
      });
      if (error) { showToast('Could not save review — please try again'); setSaving(false); return; }
    }
    await new Promise(r=>setTimeout(r,600));
    setSaving(false);
    showToast('Review posted! 🎉');
    onSubmitted?.(review);
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal-sheet">
        <div className="modal-handle"/>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
          <h2 style={{fontSize:20,fontWeight:800}}>Write a review</h2>
          <button onClick={onClose}><XIco/></button>
        </div>

        <div style={{display:'flex',gap:10,padding:12,background:'var(--surface2)',borderRadius:10,marginBottom:24}}>
          <div style={{fontSize:28}}>{categoryEmoji(product.category)}</div>
          <div>
            <div style={{fontWeight:700}}>{product.name}</div>
            <div style={{fontSize:13,color:'var(--muted)'}}>{product.brand} · {product.supermarket}</div>
          </div>
        </div>

        {!user?.is_premium && (
          <div style={{fontSize:13,color:'var(--muted)',marginBottom:16,padding:'8px 12px',
            background:'var(--amber-bg)',borderRadius:8}}>
            Free tier: {freeReviewsLeft} review{freeReviewsLeft!==1?'s':''} remaining this month.
          </div>
        )}

        <form onSubmit={submit} style={{display:'flex',flexDirection:'column',gap:20}}>
          <StarPicker label="Taste" value={taste} onChange={setTaste}/>
          <StarPicker label="Value for money" value={value} onChange={setValue}/>
          <StarPicker label="Quality" value={quality} onChange={setQuality}/>

          <div>
            <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
              <label style={{fontSize:13,color:'var(--muted)'}}>Your review (optional)</label>
              <span style={{fontSize:13,color:text.length>480?'var(--danger)':'var(--muted)'}}>{text.length}/500</span>
            </div>
            <textarea value={text} onChange={e=>setText(e.target.value.slice(0,500))}
              placeholder="What did you think? Be honest — other shoppers will thank you."
              rows={4} style={{resize:'vertical'}}/>
          </div>

          <label style={{display:'flex',alignItems:'center',justifyContent:'space-between',cursor:'pointer'}}>
            <div>
              <div style={{fontWeight:600,fontSize:14}}>Post anonymously</div>
              <div style={{fontSize:13,color:'var(--muted)'}}>Your name won't appear on this review</div>
            </div>
            <Toggle checked={anon} onChange={setAnon}/>
          </label>

          <button type="submit" className="btn btn-primary btn-full" style={{height:48}} disabled={saving||!taste||!value||!quality}>
            {saving ? 'Posting…' : 'Post review'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PRODUCT PAGE
// ══════════════════════════════════════════════════════════════
function ProductPage({ product: initialProduct, onClose, onCompare }) {
  const { user }       = useContext(AuthCtx);
  const { showToast }  = useContext(ToastCtx);
  const { addToList, removeFromList, isInList } = useContext(ShopListCtx);
  const [product, setProduct]   = useState(initialProduct);
  const [reviews, setReviews]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [aiLoading, setAiLoading] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const inList = isInList(initialProduct.id);

  const overall = avg(product.avg_taste||0, product.avg_value||0, product.avg_quality||0);

  useEffect(()=>{
    async function load(){
      setLoading(true);
      if(IS_DEMO){
        await new Promise(r=>setTimeout(r,600));
        const r = MOCK_REVIEWS.filter(r=>r.product_id===product.id);
        setReviews(r);
        setLoading(false);
        // AI summary
        if(r.length>=3 && !product.ai_summary){
          setAiLoading(true);
          await new Promise(r=>setTimeout(r,1500));
          setProduct(p=>({...p, ai_summary:'A solid product with broadly positive reviews across taste, value, and quality. Consistent feedback highlights strong flavour and good value for money.'}));
          setAiLoading(false);
        }
        return;
      }
      try{
        const { data } = await supabase.from('reviews')
          .select('*, users(display_name,avatar_url)')
          .eq('product_id', product.id)
          .order('created_at',{ascending:false});
        setReviews(data||[]);
        if((data||[]).length>=3 && !product.ai_summary){
          generateAISummary(data||[]);
        }
      }catch{ }
      setLoading(false);
    }
    load();
  },[product.id]);

  async function generateAISummary(revs){
    const texts = revs.filter(r=>r.text).map(r=>r.text).join('\n\n');
    if(!texts || ANTHROPIC_API_KEY==='YOUR_ANTHROPIC_API_KEY') return;
    setAiLoading(true);
    try{
      const res = await fetch('https://api.anthropic.com/v1/messages',{
        method:'POST',
        headers:{
          'x-api-key': ANTHROPIC_API_KEY,
          'anthropic-version':'2023-06-01',
          'content-type':'application/json',
          'anthropic-dangerous-direct-browser-access':'true',
        },
        body: JSON.stringify({
          model:'claude-sonnet-4-20250514',
          max_tokens:200,
          system:'You summarise supermarket product reviews. Be concise, direct, and honest.',
          messages:[{role:'user',content:`Summarise these reviews in 2-3 sentences covering taste, value for money, and quality. No bullet points.\n\n${texts}`}],
        }),
      });
      const data = await res.json();
      const summary = data.content?.[0]?.text;
      if(summary){
        setProduct(p=>({...p,ai_summary:summary}));
        if(!IS_DEMO) await supabase.from('products').update({ai_summary:summary,ai_summary_updated_at:new Date().toISOString()}).eq('id',product.id);
      }
    }catch{ }
    setAiLoading(false);
  }

  function toggleList(){
    if(inList){
      removeFromList(product.id);
      showToast('Removed from shopping list');
    } else {
      addToList(product);
      showToast('Added to shopping list ✓');
    }
  }

  const friendReviews = useMemo(()=>
    reviews.filter(r=>['u2','u3','u4'].includes(r.user_id)), [reviews]);

  return (
    <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal-sheet" style={{maxHeight:'96vh',paddingLeft:0,paddingRight:0,paddingTop:0}}>
        {/* Hero */}
        <div style={{position:'relative'}}>
          {product.image_url
            ? <img src={product.image_url} alt={product.name} className="product-hero"/>
            : <div className="product-hero-placeholder" style={{fontSize:80}}>{categoryEmoji(product.category)}</div>}
          <button onClick={onClose} style={{position:'absolute',top:16,left:16,background:'rgba(0,0,0,.45)',
            border:'none',borderRadius:9999,padding:8,color:'#fff',display:'flex'}}>
            <BackIco/>
          </button>
          {!user?.is_premium && (
            <div style={{position:'absolute',top:16,right:16}}>
              <a href="#ocado" style={{fontSize:12,background:'rgba(255,255,255,.9)',padding:'5px 10px',
                borderRadius:9999,color:'#1a1a1a',fontWeight:600,display:'block'}}
                onClick={e=>e.preventDefault()}>Buy on Ocado ↗</a>
            </div>
          )}
        </div>

        <div style={{padding:'20px 20px 0'}}>
          {/* Title row */}
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:12,marginBottom:12}}>
            <div>
              <h1 style={{fontSize:22,fontWeight:800,lineHeight:1.2}}>{product.name}</h1>
              <p style={{color:'var(--muted)',marginTop:4,fontSize:14}}>{product.brand}</p>
              <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap'}}>
                {product.supermarket&&<span className="badge badge-accent">{product.supermarket}</span>}
                {product.category&&<span className="badge" style={{background:'var(--surface2)',color:'var(--muted)'}}>{product.category}</span>}
              </div>
            </div>
            <div style={{textAlign:'right',flexShrink:0}}>
              <StarDisplay value={overall} size={20}/>
              <div style={{fontSize:13,color:'var(--muted)',marginTop:4}}>{product.review_count||reviews.length} reviews</div>
              {product.price&&<div style={{fontSize:18,fontWeight:700,marginTop:4}}>£{product.price.toFixed(2)}</div>}
            </div>
          </div>

          {/* Rating breakdown */}
          <div style={{background:'var(--surface2)',borderRadius:12,padding:14,marginBottom:16}}>
            <RatingBar label="Taste"   value={product.avg_taste||0}/>
            <RatingBar label="Value"   value={product.avg_value||0}/>
            <RatingBar label="Quality" value={product.avg_quality||0}/>
          </div>

          {/* AI Summary */}
          {(product.ai_summary||aiLoading) && (
            <div style={{background:'var(--accent-light)',borderRadius:12,padding:14,marginBottom:16}}>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8}}>
                <span style={{fontSize:16}}>✨</span>
                <span style={{fontSize:13,fontWeight:700,color:'var(--accent)'}}>AI Summary</span>
                {aiLoading&&<span style={{fontSize:12,color:'var(--muted)'}}>Generating…</span>}
              </div>
              {aiLoading
                ? <div className="skeleton" style={{height:52}}/>
                : <p style={{fontSize:14,lineHeight:1.6,color:'var(--text)'}}>{product.ai_summary}</p>}
            </div>
          )}
          {reviews.length<3&&!product.ai_summary&&(
            <div style={{fontSize:13,color:'var(--muted)',marginBottom:16,padding:'10px 12px',
              background:'var(--surface2)',borderRadius:8}}>
              AI summary unlocks after 3 reviews — {3-reviews.length} more needed.
            </div>
          )}

          {/* Action buttons */}
          <div style={{display:'flex',gap:8,marginBottom:20}}>
            <button className={`btn btn-full${inList?' btn-success':' btn-secondary'}`}
              style={{flex:1,background:inList?'var(--success)':undefined,color:inList?'#fff':undefined}}
              onClick={toggleList}>
              {inList?<CheckIco/>:<PlusIco/>} {inList?'In list':'Add to list'}
            </button>
            <button className="btn btn-secondary" style={{flex:1}} onClick={()=>onCompare(product)}>
              <CompareIco/> Compare
            </button>
          </div>

          {/* Friends' takes */}
          {friendReviews.length>0&&(
            <>
              <h3 style={{fontWeight:700,marginBottom:12}}>👥 What your friends think</h3>
              {friendReviews.map(r=><ReviewCard key={r.id} review={r} compact/>)}
              <div className="divider"/>
            </>
          )}

          {/* All reviews */}
          <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
            <h3 style={{fontWeight:700}}>All reviews ({loading?'…':reviews.length})</h3>
            <button className="btn btn-primary btn-sm" onClick={()=>setShowReview(true)}>Write a review</button>
          </div>

          {loading ? [1,2].map(i=>(
            <div key={i} style={{padding:'14px 0',borderBottom:'1px solid var(--border)'}}>
              <div style={{display:'flex',gap:10,marginBottom:10}}>
                <div className="skeleton" style={{width:32,height:32,borderRadius:'50%'}}/>
                <div style={{flex:1}}><div className="skeleton" style={{height:13,width:'40%',marginBottom:6}}/><div className="skeleton" style={{height:11,width:'20%'}}/></div>
              </div>
              <div className="skeleton" style={{height:40}}/>
            </div>
          )) : reviews.length===0 ? (
            <div style={{textAlign:'center',padding:'32px 0',color:'var(--muted)'}}>
              <div style={{fontSize:40,marginBottom:8}}>🍽️</div>
              <div style={{fontWeight:600}}>No reviews yet</div>
              <div style={{fontSize:14,marginTop:4}}>Be the first to taste it!</div>
            </div>
          ) : reviews.map(r=><ReviewCard key={r.id} review={r}/>)}

          <div style={{height:32}}/>
        </div>

        {showReview&&(
          <ReviewForm product={product} onClose={()=>setShowReview(false)}
            onSubmitted={r=>setReviews(prev=>[r,...prev])}/>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// COMPARE SCREEN
// ══════════════════════════════════════════════════════════════
function CompareScreen({ focusProduct }) {
  const [tab,   setTab]   = useState('supermarkets'); // supermarkets | similar
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(focusProduct||null);

  useEffect(()=>{ if(focusProduct) setSelected(focusProduct); },[focusProduct]);

  const byStore = useMemo(()=>{
    if(!selected) return [];
    const variants = MOCK_PRODUCTS.filter(p=>
      p.name.toLowerCase().includes(selected.name.split(' ')[0].toLowerCase()) ||
      p.category === selected.category
    );
    return variants.sort((a,b)=>avg(b.avg_taste,b.avg_value,b.avg_quality)-avg(a.avg_taste,a.avg_value,a.avg_quality));
  },[selected]);

  const similar = useMemo(()=>{
    if(!selected) return [];
    return MOCK_PRODUCTS.filter(p=>p.id!==selected.id&&p.category===selected.category)
      .sort((a,b)=>avg(b.avg_taste,b.avg_value,b.avg_quality)-avg(a.avg_taste,a.avg_value,a.avg_quality));
  },[selected]);

  const list = tab==='supermarkets' ? byStore : similar;
  const bestValue  = list.reduce((b,p)=>(!b||p.avg_value>b.avg_value)?p:b, null);
  const bestRated  = list.reduce((b,p)=>{
    const s=avg(p.avg_taste,p.avg_value,p.avg_quality);
    const bs=b?avg(b.avg_taste,b.avg_value,b.avg_quality):0;
    return s>bs?p:b;
  }, null);

  const searchResults = query
    ? MOCK_PRODUCTS.filter(p=>`${p.name} ${p.brand}`.toLowerCase().includes(query.toLowerCase()))
    : [];

  return (
    <div className="screen">
      <div style={{background:'var(--surface)',padding:'16px',position:'sticky',top:0,zIndex:10,borderBottom:'1px solid var(--border)'}}>
        <h2 style={{fontSize:22,fontWeight:800,marginBottom:12}}>Compare</h2>
        <div className="search-wrap">
          <SearchIco/>
          <input placeholder="Search for a product to compare…" value={query} onChange={e=>setQuery(e.target.value)}/>
        </div>
        {query&&searchResults.length>0&&(
          <div style={{position:'absolute',left:16,right:16,top:74,background:'var(--surface)',
            border:'1px solid var(--border)',borderRadius:10,zIndex:20,boxShadow:'var(--shadow-lg)',overflow:'hidden'}}>
            {searchResults.slice(0,5).map(p=>(
              <button key={p.id} onClick={()=>{setSelected(p);setQuery('');}}
                style={{display:'flex',gap:10,padding:'10px 14px',borderBottom:'1px solid var(--border)',
                  width:'100%',textAlign:'left',background:'none',border:'none',cursor:'pointer',alignItems:'center'}}>
                <span style={{fontSize:24}}>{categoryEmoji(p.category)}</span>
                <div><div style={{fontWeight:600,fontSize:14}}>{p.name}</div><div style={{fontSize:12,color:'var(--muted)'}}>{p.brand}</div></div>
              </button>
            ))}
          </div>
        )}
      </div>

      {!selected ? (
        <div style={{textAlign:'center',padding:'64px 24px',color:'var(--muted)'}}>
          <div style={{fontSize:56,marginBottom:16}}>⚖️</div>
          <div style={{fontWeight:700,fontSize:18,marginBottom:8}}>Compare products</div>
          <div style={{fontSize:14}}>Search for a product above, or tap Compare on any product page.</div>
        </div>
      ) : (
        <div style={{padding:'16px'}}>
          <div style={{background:'var(--surface)',borderRadius:12,padding:14,marginBottom:16,display:'flex',gap:10,alignItems:'center'}}>
            <span style={{fontSize:32}}>{categoryEmoji(selected.category)}</span>
            <div>
              <div style={{fontWeight:700}}>{selected.name}</div>
              <div style={{fontSize:13,color:'var(--muted)'}}>{selected.brand} · {selected.supermarket||'Any store'}</div>
            </div>
            <button onClick={()=>setSelected(null)} style={{marginLeft:'auto',color:'var(--muted)'}}><XIco/></button>
          </div>

          <div style={{display:'flex',gap:8,marginBottom:16}}>
            {[['supermarkets','By supermarket'],['similar','Similar products']].map(([v,l])=>(
              <button key={v} className={`btn btn-sm ${tab===v?'btn-primary':'btn-secondary'}`} onClick={()=>setTab(v)}>{l}</button>
            ))}
          </div>

          {list.length===0 ? (
            <div style={{textAlign:'center',padding:'32px',color:'var(--muted)',fontSize:14}}>
              No comparison data available yet for this product.
            </div>
          ) : list.map(p=>{
            const o = avg(p.avg_taste,p.avg_value,p.avg_quality);
            const isBV = bestValue?.id===p.id;
            const iBR  = bestRated?.id===p.id;
            return (
              <div key={p.id} className="card" style={{padding:14,marginBottom:10}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:28}}>{categoryEmoji(p.category)}</span>
                  <div style={{flex:1}}>
                    <div style={{fontWeight:700,fontSize:14}}>{p.name}</div>
                    <div style={{fontSize:12,color:'var(--muted)'}}>{p.brand} · {p.supermarket}</div>
                    <div style={{display:'flex',gap:6,marginTop:6,flexWrap:'wrap'}}>
                      {isBV&&<span className="badge badge-success">Best Value</span>}
                      {iBR&&<span className="badge badge-amber">Best Rated</span>}
                    </div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    {p.price&&<div style={{fontWeight:700,fontSize:16}}>£{p.price.toFixed(2)}</div>}
                    <StarDisplay value={o} size={13}/>
                    <div style={{fontSize:12,color:'var(--muted)',marginTop:2}}>{o.toFixed(1)} / 5</div>
                  </div>
                </div>
                <div style={{marginTop:10}}>
                  <RatingBar label="Taste"   value={p.avg_taste||0}/>
                  <RatingBar label="Value"   value={p.avg_value||0}/>
                  <RatingBar label="Quality" value={p.avg_quality||0}/>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// SHOPPING LIST SCREEN
// ══════════════════════════════════════════════════════════════
function ShoppingListScreen() {
  const { showToast }                           = useContext(ToastCtx);
  const { items, setItems, toggleCheck,
          toggleFavourite, clearChecked,
          addManualItem }                        = useContext(ShopListCtx);
  const [tab, setTab]             = useState('all');
  const [addInput, setAddInput]   = useState('');
  const [showDropdown, setShowDropdown] = useState(false);
  const [suggestions, setSuggestions]  = useState([]);
  const [searching, setSearching]      = useState(false);
  const inputRef    = useRef(null);
  const debounceRef = useRef(null);

  useEffect(()=>{
    const q = addInput.trim();
    if (!q || q.length < 2) { setSuggestions([]); setSearching(false); return; }

    setSearching(true);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async ()=>{
      try {
        if (IS_DEMO) {
          setSuggestions(UK_PRODUCTS_DB
            .filter(p=>`${p.name} ${p.brand}`.toLowerCase().includes(q.toLowerCase()))
            .slice(0,8));
        } else {
          const { data } = await supabase
            .from('products')
            .select('id,name,brand,category,supermarket,barcode')
            .ilike('name', `%${q}%`)
            .limit(8);
          setSuggestions(data ?? []);
        }
      } catch { setSuggestions([]); }
      finally { setSearching(false); }
    }, 250);
    return ()=>clearTimeout(debounceRef.current);
  },[addInput]);

  function pickSuggestion(p) {
    addManualItem({ name:p.name, brand:p.brand, category:p.category, supermarket:p.supermarket });
    setAddInput('');
    setShowDropdown(false);
    showToast(`${p.name} added ✓`);
  }

  function addFreeText() {
    if (!addInput.trim()) return;
    addManualItem({ name:addInput.trim(), brand:'', category:'Other', supermarket:'' });
    setAddInput('');
    setShowDropdown(false);
    showToast(`${addInput.trim()} added ✓`);
  }

  const visible = items.filter(i => {
    if (tab === 'favourites') return i.is_favourite;
    return true;
  }).sort((a,b) => tab==='recent' ? new Date(b.created_at)-new Date(a.created_at) : 0);

  const checkedCount = items.filter(i=>i.is_checked).length;

  return (
    <div className="screen">
      <div style={{background:'var(--surface)',padding:'16px',position:'sticky',top:0,zIndex:10,borderBottom:'1px solid var(--border)'}}>
        <h2 style={{fontSize:22,fontWeight:800,marginBottom:12}}>Shopping List</h2>
        <div style={{display:'flex',gap:8}}>
          {[['all','All'],['favourites','Favourites'],['recent','Recent']].map(([v,l])=>(
            <button key={v} className={`chip${tab===v?' active':''}`} onClick={()=>setTab(v)}>{l}</button>
          ))}
        </div>
      </div>

      <div style={{padding:'16px'}}>
        {/* Add item input with autocomplete */}
        <div style={{position:'relative',marginBottom:16}}>
          <div style={{display:'flex',gap:8}}>
            <div style={{flex:1,position:'relative'}}>
              <input
                ref={inputRef}
                placeholder="Search or type a product…"
                value={addInput}
                onChange={e=>{ setAddInput(e.target.value); setShowDropdown(true); }}
                onFocus={()=>setShowDropdown(true)}
                onKeyDown={e=>{ if(e.key==='Enter'){ addFreeText(); } if(e.key==='Escape') setShowDropdown(false); }}
              />
              {showDropdown && (searching || suggestions.length > 0) && addInput.trim().length >= 2 && (
                <div style={{position:'absolute',top:'calc(100% + 4px)',left:0,right:0,background:'var(--surface)',
                  border:'1px solid var(--border)',borderRadius:10,zIndex:50,boxShadow:'var(--shadow-lg)',overflow:'hidden',maxHeight:320,overflowY:'auto'}}>
                  {searching ? (
                    <div style={{padding:'14px 16px',color:'var(--muted)',fontSize:13,display:'flex',alignItems:'center',gap:8}}>
                      <span style={{display:'inline-block',width:14,height:14,border:'2px solid var(--border)',
                        borderTopColor:'var(--accent)',borderRadius:'50%',animation:'spin .6s linear infinite'}}/>
                      Searching…
                    </div>
                  ) : suggestions.map((p,i)=>(
                    <button key={p.id??i} onMouseDown={e=>{ e.preventDefault(); pickSuggestion(p); }}
                      style={{display:'flex',gap:10,padding:'10px 12px',width:'100%',textAlign:'left',
                        background:'none',border:'none',cursor:'pointer',borderBottom:'1px solid var(--border)',
                        alignItems:'center'}}>
                      <span style={{fontSize:22,flexShrink:0}}>{categoryEmoji(p.category)}</span>
                      <div style={{minWidth:0}}>
                        <div style={{fontWeight:600,fontSize:13,lineHeight:1.3}}>{p.name}</div>
                        <div style={{fontSize:12,color:'var(--muted)'}}>{[p.brand,p.supermarket].filter(Boolean).join(' · ')}</div>
                      </div>
                    </button>
                  ))}
                  {!searching && addInput.trim() && (
                    <button onMouseDown={e=>{ e.preventDefault(); addFreeText(); }}
                      style={{display:'flex',gap:10,padding:'10px 12px',width:'100%',textAlign:'left',
                        background:'var(--accent-light)',border:'none',cursor:'pointer',alignItems:'center'}}>
                      <PlusIco/>
                      <span style={{fontSize:13,fontWeight:600,color:'var(--accent)'}}>Add "{addInput.trim()}" manually</span>
                    </button>
                  )}
                </div>
              )}
            </div>
            <button className="btn btn-primary" onClick={addFreeText} style={{flexShrink:0}}><PlusIco/></button>
          </div>
        </div>

        {checkedCount>0&&(
          <button className="btn btn-secondary btn-sm" style={{marginBottom:16,width:'100%'}} onClick={()=>{ clearChecked(); showToast('Cleared completed items'); }}>
            <CheckIco/> Clear {checkedCount} completed item{checkedCount!==1?'s':''}
          </button>
        )}

        {visible.length===0 ? (
          <div style={{textAlign:'center',padding:'48px 0',color:'var(--muted)'}}>
            <div style={{fontSize:48,marginBottom:12}}>🛍️</div>
            <div style={{fontWeight:600,marginBottom:4}}>
              {tab==='favourites' ? 'No favourites yet' : 'Your list is empty'}
            </div>
            <div style={{fontSize:14}}>
              {tab==='favourites' ? 'Tap the heart on any list item to save it.' : 'Search for a product above or add from any product page.'}
            </div>
          </div>
        ) : visible.map(item=>(
          <div key={item.id} className="card" style={{display:'flex',alignItems:'center',gap:12,padding:12,marginBottom:8}}>
            <button onClick={()=>toggleCheck(item.id)}
              style={{width:26,height:26,borderRadius:'50%',border:`2px solid ${item.is_checked?'var(--success)':'var(--border)'}`,
                background:item.is_checked?'var(--success)':'transparent',flexShrink:0,
                display:'flex',alignItems:'center',justifyContent:'center',color:'#fff'}}>
              {item.is_checked&&<CheckIco/>}
            </button>
            <span style={{fontSize:26}}>{categoryEmoji(item.product?.category)}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:600,fontSize:14,textDecoration:item.is_checked?'line-through':'none',
                color:item.is_checked?'var(--muted)':'var(--text)',lineHeight:1.3}}>
                {item.product?.name||'Unknown product'}
              </div>
              {(item.product?.brand||item.product?.supermarket) && (
                <div style={{fontSize:12,color:'var(--muted)'}}>
                  {[item.product.brand, item.product.supermarket].filter(Boolean).join(' · ')}
                </div>
              )}
            </div>
            <button onClick={()=>toggleFavourite(item.id)}
              style={{color:item.is_favourite?'#e53e3e':'var(--border)',flexShrink:0,background:'none',border:'none',padding:4}}>
              <HeartIco f={item.is_favourite}/>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// PROFILE SCREEN
// ══════════════════════════════════════════════════════════════
function ProfileScreen({ userId, onClose, onProduct }) {
  const { user, signOut } = useContext(AuthCtx);
  const { showToast }     = useContext(ToastCtx);
  const [profileUser, setProfileUser] = useState(null);
  const [loading, setLoading]  = useState(true);
  const [isFollowing, setIsFollowing] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const isOwnProfile = !userId || userId===user?.id;
  const [notifications, setNotifications] = useState(true);

  useEffect(()=>{
    async function load(){
      setLoading(true);
      await new Promise(r=>setTimeout(r,500));
      const u = isOwnProfile ? (user||MOCK_USERS[0]) : (MOCK_USERS.find(u=>u.id===userId)||MOCK_USERS[1]);
      setProfileUser(u);
      setLoading(false);
    }
    load();
  },[userId, isOwnProfile, user]);

  const userReviews = MOCK_REVIEWS.filter(r=>r.user_id===(userId||user?.id||'u1'));

  async function toggleFollow(){
    if(!user){ showToast('Sign in to follow users'); return; }
    setIsFollowing(v=>!v);
    showToast(isFollowing?`Unfollowed ${profileUser?.display_name}`:`Following ${profileUser?.display_name}!`);
  }

  return (
    <div className="modal-backdrop" onClick={e=>e.target===e.currentTarget&&onClose()}>
      <div className="modal-sheet" style={{maxHeight:'96vh'}}>
        <div className="modal-handle"/>
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:20}}>
          <h2 style={{fontSize:20,fontWeight:800}}>{isOwnProfile?'My Profile':'Profile'}</h2>
          <div style={{display:'flex',gap:8}}>
            {isOwnProfile&&<button onClick={()=>setShowSettings(s=>!s)} style={{color:'var(--muted)'}}><SettingsIco/></button>}
            <button onClick={onClose}><XIco/></button>
          </div>
        </div>

        {loading ? (
          <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:12,padding:'24px 0'}}>
            <div className="skeleton" style={{width:80,height:80,borderRadius:'50%'}}/>
            <div className="skeleton" style={{width:160,height:18}}/>
            <div className="skeleton" style={{width:200,height:14}}/>
          </div>
        ) : (
          <>
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',marginBottom:24}}>
              <Avatar initials={profileUser?.initials||profileUser?.display_name?.slice(0,2)||'?'} size={80} style={{marginBottom:12}}/>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <h3 style={{fontSize:22,fontWeight:800}}>{profileUser?.display_name||'User'}</h3>
                {profileUser?.is_premium&&<span className="badge badge-premium">⭐ Premium</span>}
              </div>
              <div style={{display:'flex',gap:24,marginTop:16}}>
                {[['Reviews',profileUser?.review_count||0],['Followers',profileUser?.followers||0],['Following',profileUser?.following||0]].map(([l,v])=>(
                  <div key={l} style={{textAlign:'center'}}>
                    <div style={{fontSize:20,fontWeight:800}}>{v}</div>
                    <div style={{fontSize:12,color:'var(--muted)'}}>{l}</div>
                  </div>
                ))}
              </div>
              {!isOwnProfile&&(
                <button className={`btn btn-sm ${isFollowing?'btn-secondary':'btn-primary'}`} style={{marginTop:16}}
                  onClick={toggleFollow}>
                  {isFollowing ? 'Following ✓' : '+ Follow'}
                </button>
              )}
            </div>

            {/* Settings panel */}
            {isOwnProfile&&showSettings&&(
              <div style={{background:'var(--surface2)',borderRadius:12,padding:16,marginBottom:20}}>
                <h4 style={{fontWeight:700,marginBottom:14}}>Settings</h4>

                <label style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:14,cursor:'pointer'}}>
                  <div>
                    <div style={{fontWeight:600,fontSize:14}}>Push notifications</div>
                    <div style={{fontSize:13,color:'var(--muted)'}}>When people react to your reviews</div>
                  </div>
                  <Toggle checked={notifications} onChange={setNotifications}/>
                </label>

                <div className="divider" style={{margin:'12px 0'}}/>

                {!profileUser?.is_premium ? (
                  <div style={{background:'linear-gradient(135deg,#4A7FA5,#3d6d91)',borderRadius:10,padding:14,marginBottom:12,color:'#fff'}}>
                    <div style={{fontWeight:700,marginBottom:4}}>Upgrade to Premium</div>
                    <div style={{fontSize:13,opacity:.85,marginBottom:10}}>Unlimited reviews, no banners, premium badge · £2.99/month</div>
                    <button className="btn btn-sm" style={{background:'#fff',color:'var(--accent)',fontWeight:700}}
                      onClick={()=>showToast('Stripe checkout coming soon!')}>Upgrade now</button>
                  </div>
                ) : (
                  <div style={{fontSize:14,color:'var(--muted)',marginBottom:12}}>
                    ⭐ Premium subscriber — thank you!
                    <button className="btn btn-ghost btn-sm" style={{display:'block',marginTop:8,paddingLeft:0}}
                      onClick={()=>showToast('Manage subscription via Stripe portal')}>Manage subscription</button>
                  </div>
                )}

                <button className="btn btn-danger btn-full btn-sm" onClick={()=>{ signOut(); onClose(); }}>
                  Sign out
                </button>
              </div>
            )}

            {/* Reviewed products grid */}
            <h4 style={{fontWeight:700,marginBottom:12}}>
              {isOwnProfile ? 'Your reviews' : `${profileUser?.display_name}'s reviews`} ({userReviews.length})
            </h4>
            {userReviews.length===0 ? (
              <div style={{textAlign:'center',padding:'24px',color:'var(--muted)',fontSize:14}}>
                {isOwnProfile ? "You haven't reviewed anything yet — scan something!" : "No reviews yet."}
              </div>
            ) : (
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:8}}>
                {userReviews.map(r=>{
                  const p = MOCK_PRODUCTS.find(p=>p.id===r.product_id);
                  if(!p) return null;
                  return (
                    <button key={r.id} onClick={()=>{onProduct(p);onClose();}}
                      style={{aspectRatio:'1',background:'var(--surface2)',borderRadius:10,
                        display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
                        border:'none',cursor:'pointer',gap:4,padding:8}}>
                      <span style={{fontSize:28}}>{categoryEmoji(p.category)}</span>
                      <span style={{fontSize:11,textAlign:'center',lineHeight:1.2,color:'var(--text)',fontWeight:500}}>
                        {p.name.split(' ').slice(0,3).join(' ')}
                      </span>
                      <StarDisplay value={avg(r.taste_rating,r.value_rating,r.quality_rating)} size={10}/>
                    </button>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// BOTTOM NAV
// ══════════════════════════════════════════════════════════════
function BottomNav({ tab, onChange, onScan }) {
  return (
    <nav style={{
      position:'fixed', bottom:0, left:0, right:0, height:'var(--nav)',
      background:'var(--surface)', borderTop:'1px solid var(--border)',
      display:'flex', alignItems:'center', justifyContent:'space-around',
      zIndex:100, paddingBottom:'env(safe-area-inset-bottom,0px)',
    }}>
      {[
        { id:'home',    label:'Home',    Icon:()=><HomeIco a={tab==='home'}/> },
        { id:'search',  label:'Search',  Icon:SearchIco },
        { id:'scan',    label:'',        Icon:null },
        { id:'compare', label:'Compare', Icon:CompareIco },
        { id:'list',    label:'List',    Icon:()=><ListIco a={tab==='list'}/> },
      ].map(item => item.id==='scan' ? (
        <button key="scan" onClick={onScan} style={{
          width:56, height:56, borderRadius:'50%', background:'var(--accent)',
          border:'none', display:'flex', alignItems:'center', justifyContent:'center',
          boxShadow:'0 -2px 12px rgba(74,127,165,.45)', transform:'translateY(-10px)',
          transition:'transform .2s, box-shadow .2s',
        }}
          onMouseEnter={e=>{ e.currentTarget.style.transform='translateY(-12px)'; e.currentTarget.style.boxShadow='0 -4px 16px rgba(74,127,165,.6)'; }}
          onMouseLeave={e=>{ e.currentTarget.style.transform='translateY(-10px)'; e.currentTarget.style.boxShadow='0 -2px 12px rgba(74,127,165,.45)'; }}>
          <BarcodeIco/>
        </button>
      ) : (
        <button key={item.id} onClick={()=>onChange(item.id)}
          style={{ display:'flex', flexDirection:'column', alignItems:'center', gap:3, background:'none',
            border:'none', color: tab===item.id ? 'var(--accent)' : 'var(--muted)',
            fontSize:10, fontWeight:600, padding:'6px 12px', transition:'color .15s' }}>
          <item.Icon/>
          {item.label}
        </button>
      ))}
    </nav>
  );
}

// ══════════════════════════════════════════════════════════════
// ROOT APP
// ══════════════════════════════════════════════════════════════
export default function App() {
  // ── Auth state ────────────────────────────────────────────
  const [user,       setUser]       = useState(null);
  const [authLoading,setAuthLoading]= useState(true);

  // ── Navigation state ──────────────────────────────────────
  const [tab,        setTab]        = useState('home');
  const [scanOpen,   setScanOpen]   = useState(false);
  const [product,    setProduct]    = useState(null);   // ProductPage modal
  const [profile,    setProfile]    = useState(null);   // ProfileScreen modal (userId)
  const [compareP,   setCompareP]   = useState(null);   // pre-load for compare tab

  // ── Toast ─────────────────────────────────────────────────
  const [toast,      setToast]      = useState(null);
  const toastTimer = useRef(null);

  function showToast(msg) {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(()=>setToast(null), 2800);
  }

  // ── Nav helper ────────────────────────────────────────────
  function navigate(screen, data={}) {
    if(screen==='profile') setProfile(data.userId||null);
    if(screen==='product') setProduct(data.product||null);
    if(screen==='compare') { setCompareP(data.product||null); setTab('compare'); }
  }

  // ── Supabase auth listener ────────────────────────────────
  useEffect(()=>{
    if(IS_DEMO){ setAuthLoading(false); return; }

    // Safety net — show login screen after 4s no matter what
    const timeout = setTimeout(()=>setAuthLoading(false), 4000);

    // onAuthStateChange fires immediately with the current session
    // from local storage — no network call needed on startup.
    // IMPORTANT: clear authLoading immediately so the spinner never gets stuck.
    // Profile fetch from DB happens in the background after loading screen is gone.
    const { data:{ subscription } } = supabase.auth.onAuthStateChange(async (event, session)=>{
      clearTimeout(timeout);
      if(session?.user){
        // Show the app immediately using the auth session data
        setUser(prev => prev ?? { ...session.user });
        setAuthLoading(false);
        // Fetch full profile in the background (DB may be slow on free tier)
        try {
          const { data } = await supabase.from('users').select('*').eq('id',session.user.id).single();
          if(data) setUser({ ...data });
          else setUser(u => ({ ...u, isNew:true }));
        } catch {
          setUser(u => ({ ...u, isNew:true }));
        }
      } else {
        setUser(null);
        setAuthLoading(false);
      }
    });

    return ()=>{ subscription.unsubscribe(); clearTimeout(timeout); };
  },[]);

  async function signOut(){
    if(!IS_DEMO) await supabase.auth.signOut();
    setUser(null);
  }

  // ── Shopping list state (global so ProductPage + ListScreen share it) ──
  const [listItems, setListItems] = useState([]);

  const shopListCtx = useMemo(()=>({
    items: listItems,
    setItems: setListItems,
    isInList: (productId) => listItems.some(i=>i.product_id===productId),
    addToList: (product) => {
      if (listItems.some(i=>i.product_id===product.id)) return;
      const item = { id:`sl-${Date.now()}`, product_id:product.id, is_favourite:false,
        is_checked:false, created_at:new Date().toISOString(), product };
      setListItems(prev=>[item,...prev]);
      if(!IS_DEMO && user) supabase.from('shopping_list').insert({user_id:user.id, product_id:product.id}).catch(()=>{});
    },
    removeFromList: (productId) => {
      setListItems(prev=>prev.filter(i=>i.product_id!==productId));
      if(!IS_DEMO && user) supabase.from('shopping_list').delete().eq('user_id',user.id).eq('product_id',productId).catch(()=>{});
    },
    toggleCheck: (id) => setListItems(prev=>prev.map(i=>i.id===id?{...i,is_checked:!i.is_checked}:i)),
    toggleFavourite: (id) => setListItems(prev=>prev.map(i=>i.id===id?{...i,is_favourite:!i.is_favourite}:i)),
    clearChecked: () => setListItems(prev=>prev.filter(i=>!i.is_checked)),
    addManualItem: (product) => {
      const item = { id:`sl-${Date.now()}`, product_id:`manual-${Date.now()}`,
        is_favourite:false, is_checked:false, created_at:new Date().toISOString(), product };
      setListItems(prev=>[item,...prev]);
    },
  }), [listItems, user]);

  // ── Render ────────────────────────────────────────────────
  if(authLoading){
    return (
      <>
        <StyleInjector/>
        <div style={{minHeight:'100vh',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:16}}>
          <div style={{fontSize:40}}>🛒</div>
          <div className="skeleton" style={{width:120,height:12,borderRadius:6}}/>
        </div>
      </>
    );
  }

  if(!user){
    return (
      <AuthCtx.Provider value={{ user, setUser, signOut }}>
        <ToastCtx.Provider value={{ showToast }}>
          <StyleInjector/>
          <AuthScreen/>
          {toast&&<Toast message={toast}/>}
        </ToastCtx.Provider>
      </AuthCtx.Provider>
    );
  }

  if(user.isNew){
    return (
      <AuthCtx.Provider value={{ user, setUser, signOut }}>
        <ToastCtx.Provider value={{ showToast }}>
          <StyleInjector/>
          <OnboardingScreen/>
          {toast&&<Toast message={toast}/>}
        </ToastCtx.Provider>
      </AuthCtx.Provider>
    );
  }

  const navCtxVal = { navigate };

  return (
    <AuthCtx.Provider value={{ user, setUser, signOut }}>
      <ToastCtx.Provider value={{ showToast }}>
        <ShopListCtx.Provider value={shopListCtx}>
        <NavCtx.Provider value={navCtxVal}>
          <StyleInjector/>

          <div style={{position:'relative',height:'100dvh',minHeight:'-webkit-fill-available',overflow:'hidden',maxWidth:640,margin:'0 auto'}}>

            {/* Tab screens */}
            {tab==='home'    && <HomeScreen key="home"       onProduct={setProduct}/>}
            {tab==='search'  && <SearchScreen key="search"   onProduct={setProduct}/>}
            {tab==='compare' && <CompareScreen key="compare" focusProduct={compareP}/>}
            {tab==='list'    && <ShoppingListScreen key="list"/>}

            {/* Bottom nav */}
            <BottomNav tab={tab} onChange={setTab} onScan={()=>setScanOpen(true)}/>

            {/* Scanner overlay */}
            {scanOpen && (
              <ScanScreen
                onClose={()=>setScanOpen(false)}
                onProduct={p=>{ setProduct(p); setScanOpen(false); }}
              />
            )}

            {/* Product page modal */}
            {product && (
              <ProductPage
                product={product}
                onClose={()=>setProduct(null)}
                onCompare={p=>{ setProduct(null); setCompareP(p); setTab('compare'); }}
              />
            )}

            {/* Profile modal */}
            {profile!==null && (
              <ProfileScreen
                userId={profile||user.id}
                onClose={()=>setProfile(null)}
                onProduct={p=>{ setProfile(null); setProduct(p); }}
              />
            )}

            {/* My profile from avatar tap */}
          </div>

          {toast && <Toast message={toast}/>}
        </NavCtx.Provider>
        </ShopListCtx.Provider>
      </ToastCtx.Provider>
    </AuthCtx.Provider>
  );
}
