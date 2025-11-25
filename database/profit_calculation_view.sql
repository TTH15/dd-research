-- ============================================
-- 利益計算ビュー
-- products_dd × keepa_snapshots をJOINして利益計算を行う
-- ============================================

-- 最新のKeepaスナップショットと商品情報をJOINしたビュー
CREATE OR REPLACE VIEW product_profit_view AS
SELECT 
  p.id,
  p.jan,
  p.asin,
  p.product_name,
  p.brand,
  p.dd_cost,
  p.dd_url,
  
  -- Keepaスナップショット（最新のもの）
  ks.snapshot_at as keepa_snapshot_at,
  ks.buy_box_price,
  ks.lowest_new_price,
  ks.sales_rank,
  ks.sales_rank_drops_30,
  ks.sales_rank_drops_90,
  ks.offers_count,
  ks.is_amazon_seller,
  ks.title as keepa_title,
  ks.category as keepa_category,
  
  -- 販売価格の決定ロジック（buy_box_price優先、なければlowest_new_price）
  COALESCE(ks.buy_box_price, ks.lowest_new_price) as selling_price,
  
  -- Amazon手数料計算（簡易モデル：販売価格の80%）
  -- 将来的にFBA手数料テーブルに差し替えられるよう、関数として切り出すことも可能
  ROUND(COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) as amazon_payout,
  
  -- コスト（仕入れ値）
  p.dd_cost as cost,
  
  -- 粗利計算
  ROUND(COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - COALESCE(p.dd_cost, 0) as gross_profit,
  
  -- 粗利率（%）
  CASE 
    WHEN p.dd_cost > 0 THEN 
      ROUND(((COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - p.dd_cost) / p.dd_cost * 100, 2)
    ELSE NULL
  END as gross_margin_pct,
  
  -- 月間販売見込み（sales_rank_drops_30をそのまま採用）
  ks.sales_rank_drops_30 as monthly_sales_estimate,
  
  -- 月間粗利
  (ROUND(COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - COALESCE(p.dd_cost, 0)) * ks.sales_rank_drops_30 as monthly_gross_profit,
  
  -- 候補商品フラグ（簡易ルール）
  -- gross_profit >= 400 かつ gross_margin_pct >= 25 かつ monthly_sales_estimate >= 20 かつ is_amazon_seller = false
  (
    (ROUND(COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - COALESCE(p.dd_cost, 0)) >= 400
    AND (CASE 
      WHEN p.dd_cost > 0 THEN 
        ROUND(((COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - p.dd_cost) / p.dd_cost * 100, 2)
      ELSE NULL
    END) >= 25
    AND ks.sales_rank_drops_30 >= 20
    AND (ks.is_amazon_seller = false OR ks.is_amazon_seller IS NULL)
  ) as is_candidate

FROM products_dd p
LEFT JOIN LATERAL (
  -- 最新のKeepaスナップショットを取得
  SELECT *
  FROM keepa_snapshots
  WHERE product_id = p.id
  ORDER BY snapshot_at DESC
  LIMIT 1
) ks ON true
WHERE p.asin IS NOT NULL
  AND ks.id IS NOT NULL; -- Keepaデータがある商品のみ

-- インデックス（パフォーマンス向上のため）
-- 既存のインデックスを活用

-- コメント
COMMENT ON VIEW product_profit_view IS '商品利益計算ビュー：products_dd × 最新のkeepa_snapshotsをJOINして利益計算を行う';

