-- ============================================
-- products_ddテーブルにdd_costカラムを追加
-- DDオンラインストアでの仕入れ単価を保存
-- ============================================

-- 仕入れ値カラムを追加
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS dd_cost NUMERIC(10, 2);
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS dd_url TEXT;

-- 既存のprice_listをdd_costにコピー（既存データの移行用、必要に応じて実行）
-- UPDATE products_dd SET dd_cost = price_list WHERE dd_cost IS NULL AND price_list IS NOT NULL;

-- コメント
COMMENT ON COLUMN products_dd.dd_cost IS 'DDオンラインストアでの仕入れ単価（円）';
COMMENT ON COLUMN products_dd.dd_url IS 'DDオンラインストアでの商品URL';

