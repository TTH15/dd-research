-- ===================================
-- DD Research Database Schema
-- ===================================

-- ===================================
-- 1. 商品テーブル（既存）にKeepaデータカラムを追加
-- ===================================

-- Keepa基本データ
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_updated_at TIMESTAMP;
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_asin TEXT;

-- 価格情報
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_amazon_price INTEGER;           -- Amazon直販価格
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_new_price INTEGER;               -- 新品FBA最安値
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_used_price INTEGER;              -- 中古最安値
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_buy_box_price INTEGER;           -- カート価格

-- ランキング・販売データ
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_sales_rank INTEGER;              -- 売れ筋ランキング
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_sales_rank_drops INTEGER;        -- 30日間のランク変動回数（売れた回数の目安）
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_category TEXT;                   -- カテゴリー

-- 出品者情報
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_seller_count INTEGER;            -- FBA出品者数

-- 商品情報
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_package_weight INTEGER;          -- 重量（グラム）
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_package_length INTEGER;          -- 長さ（cm）
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_package_width INTEGER;           -- 幅（cm）
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_package_height INTEGER;          -- 高さ（cm）

-- 利益計算結果（キャッシュ）
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS profit_amount INTEGER;                 -- 利益額
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS profit_rate DECIMAL(5,2);              -- 利益率（%）
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS roi DECIMAL(5,2);                      -- ROI（%）
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS fba_fee INTEGER;                       -- FBA手数料

-- 推奨フラグ
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS is_recommended BOOLEAN DEFAULT FALSE;  -- おすすめ商品
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS recommendation_score INTEGER;          -- スコア（0-100）

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_products_dd_profit_rate ON products_dd(profit_rate DESC);
CREATE INDEX IF NOT EXISTS idx_products_dd_is_recommended ON products_dd(is_recommended) WHERE is_recommended = TRUE;
CREATE INDEX IF NOT EXISTS idx_products_dd_keepa_updated ON products_dd(keepa_updated_at);

-- ===================================
-- 2. Keepa更新ログテーブル
-- ===================================
CREATE TABLE IF NOT EXISTS keepa_update_logs (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT REFERENCES products_dd(id),
  updated_at TIMESTAMP DEFAULT NOW(),
  status TEXT,                           -- 'success', 'failed', 'no_data'
  error_message TEXT,
  api_response JSONB                     -- Keepa APIの生レスポンス
);

CREATE INDEX IF NOT EXISTS idx_keepa_logs_product_id ON keepa_update_logs(product_id);
CREATE INDEX IF NOT EXISTS idx_keepa_logs_updated_at ON keepa_update_logs(updated_at DESC);

-- ===================================
-- 3. 自動更新設定テーブル
-- ===================================
CREATE TABLE IF NOT EXISTS auto_update_settings (
  id BIGSERIAL PRIMARY KEY,
  setting_name TEXT UNIQUE NOT NULL,
  setting_value TEXT,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- デフォルト設定
INSERT INTO auto_update_settings (setting_name, setting_value) VALUES
  ('auto_update_enabled', 'true'),
  ('update_interval_hours', '6'),          -- 6時間ごとに更新（1日4回）
  ('batch_size', '50'),                    -- 1回のバッチで処理する商品数
  ('min_profit_rate', '20'),               -- 推奨商品の最低利益率
  ('max_sales_rank', '50000'),             -- 推奨商品の最高ランキング
  ('max_seller_count', '10')               -- 推奨商品の最大出品者数
ON CONFLICT (setting_name) DO NOTHING;

-- ===================================
-- 4. 通知履歴テーブル
-- ===================================
CREATE TABLE IF NOT EXISTS notification_logs (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT REFERENCES products_dd(id),
  notification_type TEXT,                -- 'email', 'webhook', 'slack'
  sent_at TIMESTAMP DEFAULT NOW(),
  status TEXT,                           -- 'sent', 'failed'
  recipient TEXT
);

CREATE INDEX IF NOT EXISTS idx_notification_logs_sent_at ON notification_logs(sent_at DESC);

-- ===================================
-- 5. ダッシュボード統計ビュー
-- ===================================
CREATE OR REPLACE VIEW dashboard_stats AS
SELECT
  COUNT(*) as total_products,
  COUNT(CASE WHEN asin IS NOT NULL THEN 1 END) as products_with_asin,
  COUNT(CASE WHEN keepa_updated_at IS NOT NULL THEN 1 END) as products_with_keepa_data,
  COUNT(CASE WHEN is_recommended = TRUE THEN 1 END) as recommended_products,
  AVG(profit_rate) as avg_profit_rate,
  SUM(CASE WHEN profit_amount > 0 THEN profit_amount ELSE 0 END) as total_potential_profit
FROM products_dd;

-- ===================================
-- 6. 推奨商品ビュー
-- ===================================
CREATE OR REPLACE VIEW recommended_products AS
SELECT
  p.*,
  CASE
    WHEN p.profit_rate >= 30 AND p.keepa_sales_rank < 10000 THEN '🔥 超優良'
    WHEN p.profit_rate >= 20 AND p.keepa_sales_rank < 30000 THEN '⭐ おすすめ'
    WHEN p.profit_rate >= 15 AND p.keepa_sales_rank < 50000 THEN '✅ 良好'
    ELSE '⚠️ 要検討'
  END as recommendation_label
FROM products_dd p
WHERE 
  p.profit_rate > 0
  AND p.keepa_sales_rank IS NOT NULL
  AND p.keepa_updated_at > NOW() - INTERVAL '7 days'
ORDER BY p.recommendation_score DESC, p.profit_rate DESC;

-- ===================================
-- 7. RLS（Row Level Security）ポリシー
-- ===================================

-- 既存のポリシーがあれば削除
DROP POLICY IF EXISTS "Enable read access for all users" ON products_dd;
DROP POLICY IF EXISTS "Enable update access for all users" ON products_dd;

-- 新しいポリシー
ALTER TABLE products_dd ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON products_dd
  FOR SELECT USING (true);

CREATE POLICY "Enable update access for all users" ON products_dd
  FOR UPDATE USING (true) WITH CHECK (true);

-- Keepa更新ログも読み取り可能に
ALTER TABLE keepa_update_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for keepa logs" ON keepa_update_logs
  FOR SELECT USING (true);

CREATE POLICY "Enable insert access for keepa logs" ON keepa_update_logs
  FOR INSERT WITH CHECK (true);

-- 通知ログ
ALTER TABLE notification_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for notification logs" ON notification_logs
  FOR SELECT USING (true);

CREATE POLICY "Enable insert access for notification logs" ON notification_logs
  FOR INSERT WITH CHECK (true);

