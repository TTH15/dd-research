-- ============================================
-- Keepa Snapshots テーブル作成
-- ASINごとのKeepaレスポンスを時系列で保存するスナップショットテーブル
-- ============================================

CREATE TABLE IF NOT EXISTS keepa_snapshots (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products_dd(id) ON DELETE CASCADE,
  asin TEXT NOT NULL,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  -- Keepa APIレスポンスの生データ
  raw_json JSONB NOT NULL,
  
  -- 便利な派生カラム（Keepaの構造から取り出して算出）
  buy_box_price INTEGER,              -- 現在のBuy Box価格（円単位。Keepaは通常1/100なので注意）
  lowest_new_price INTEGER,           -- 新品最安値（円単位）
  sales_rank INTEGER,                 -- 現在のランキング
  sales_rank_drops_30 INTEGER,        -- 過去30日間のセールスランクドロップ回数
  sales_rank_drops_90 INTEGER,         -- 過去90日間のセールスランクドロップ回数（あれば）
  offers_count INTEGER,                -- 出品者数
  is_amazon_seller BOOLEAN DEFAULT FALSE, -- Amazon本体がいるかどうか（SellerId判定などで）
  
  -- その他の便利な情報
  title TEXT,                          -- 商品タイトル
  brand TEXT,                          -- ブランド
  category TEXT,                       -- カテゴリー
  package_weight INTEGER,              -- 重量（グラム）
  
  -- メタデータ
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス作成
CREATE INDEX IF NOT EXISTS idx_keepa_snapshots_product_id ON keepa_snapshots(product_id);
CREATE INDEX IF NOT EXISTS idx_keepa_snapshots_asin ON keepa_snapshots(asin);
CREATE INDEX IF NOT EXISTS idx_keepa_snapshots_snapshot_at ON keepa_snapshots(snapshot_at DESC);
CREATE INDEX IF NOT EXISTS idx_keepa_snapshots_product_snapshot ON keepa_snapshots(product_id, snapshot_at DESC);

-- JSONB検索用のGINインデックス
CREATE INDEX IF NOT EXISTS idx_keepa_snapshots_raw_json ON keepa_snapshots USING GIN (raw_json);

-- コメント
COMMENT ON TABLE keepa_snapshots IS 'ASINごとのKeepaレスポンスを時系列で保存するスナップショットテーブル';
COMMENT ON COLUMN keepa_snapshots.buy_box_price IS '現在のBuy Box価格（円単位。Keepaは通常1/100なので注意）';
COMMENT ON COLUMN keepa_snapshots.sales_rank_drops_30 IS '過去30日間のセールスランクドロップ回数（月間販売見込みの目安）';
COMMENT ON COLUMN keepa_snapshots.is_amazon_seller IS 'Amazon本体がいるかどうか（SellerId判定などで）';

-- RLS（Row Level Security）ポリシー
ALTER TABLE keepa_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON keepa_snapshots
  FOR SELECT USING (true);

CREATE POLICY "Enable insert access for service role" ON keepa_snapshots
  FOR INSERT WITH CHECK (true);

