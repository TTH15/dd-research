-- ============================================
-- 利益計算ビュー（最終版）
-- products_dd × keepa_snapshots をJOINして利益計算を行う
-- ============================================

-- 既存のビューを削除
DROP VIEW IF EXISTS product_profit_view;

-- 新しいビューを作成
CREATE VIEW product_profit_view AS
SELECT 
  p.id,
  p.jan,
  p.asin,
  p.product_name,
  p.brand,
  p.image_url,
  p.product_url,
  p.source,
  
  -- 仕入れ値
  COALESCE(p.dd_cost, p.price_list) as dd_cost,
  COALESCE(p.dd_url, p.product_url) as dd_url,
  
  -- 元のカラムも保持（互換性のため）
  p.price_list,
  p.scraped_at,
  p.updated_at,
  
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
  ks.asin as keepa_asin,
  
  -- 販売価格の決定ロジック（buy_box_price優先、なければlowest_new_price）
  COALESCE(ks.buy_box_price, ks.lowest_new_price) as selling_price,
  
  -- Amazon手数料計算（簡易モデル：販売価格の80% = 手数料20%を引いた入金額）
  ROUND(COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) as amazon_payout,
  
  -- コスト（仕入れ値）
  COALESCE(p.dd_cost, p.price_list) as cost,
  
  -- 粗利計算（入金額 - 仕入れ値）
  ROUND(COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - COALESCE(p.dd_cost, p.price_list, 0) as gross_profit,
  
  -- 粗利率（%）= (粗利 / 仕入れ値) * 100
  CASE 
    WHEN COALESCE(p.dd_cost, p.price_list) > 0 THEN 
      ROUND(((COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - COALESCE(p.dd_cost, p.price_list)) / COALESCE(p.dd_cost, p.price_list) * 100, 1)
    ELSE NULL
  END as gross_margin_pct,
  
  -- 月間販売見込み（sales_rank_drops_30をそのまま採用）
  ks.sales_rank_drops_30 as monthly_sales_estimate,
  
  -- 月間粗利
  (ROUND(COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - COALESCE(p.dd_cost, p.price_list, 0)) * COALESCE(ks.sales_rank_drops_30, 0) as monthly_gross_profit,
  
  -- 候補商品フラグ（改善版のルール）
  -- 粗利 >= 400円 かつ 粗利率 >= 25% かつ 月間販売 >= 20件 かつ Amazon本体なし
  (
    (ROUND(COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - COALESCE(p.dd_cost, p.price_list, 0)) >= 400
    AND (CASE 
      WHEN COALESCE(p.dd_cost, p.price_list) > 0 THEN 
        ROUND(((COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - COALESCE(p.dd_cost, p.price_list)) / COALESCE(p.dd_cost, p.price_list) * 100, 1)
      ELSE 0
    END) >= 25
    AND COALESCE(ks.sales_rank_drops_30, 0) >= 20
    AND (ks.is_amazon_seller = false OR ks.is_amazon_seller IS NULL)
  ) as is_candidate,
  
  -- 推奨度スコア（0-100点）
  LEAST(100, GREATEST(0,
    -- 粗利貢献度（最大40点）
    LEAST(40, (ROUND(COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - COALESCE(p.dd_cost, p.price_list, 0)) / 10)
    +
    -- 粗利率貢献度（最大30点）
    LEAST(30, (CASE 
      WHEN COALESCE(p.dd_cost, p.price_list) > 0 THEN 
        ((COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - COALESCE(p.dd_cost, p.price_list)) / COALESCE(p.dd_cost, p.price_list) * 100
      ELSE 0
    END) / 2)
    +
    -- 月間販売貢献度（最大30点）
    LEAST(30, COALESCE(ks.sales_rank_drops_30, 0) / 3)
    -
    -- Amazon本体がいる場合は減点
    (CASE WHEN ks.is_amazon_seller = true THEN 20 ELSE 0 END)
    -
    -- 月間販売データがない場合は大幅減点（-40点）
    (CASE WHEN COALESCE(ks.sales_rank_drops_30, 0) = 0 THEN 40 ELSE 0 END)
  )) as recommendation_score,
  
  -- Keepa分析済みフラグ
  (ks.id IS NOT NULL) as is_keepa_analyzed

FROM products_dd p
LEFT JOIN LATERAL (
  -- 最新のKeepaスナップショットを取得
  SELECT *
  FROM keepa_snapshots
  WHERE product_id = p.id
  ORDER BY snapshot_at DESC
  LIMIT 1
) ks ON true;

-- コメント
COMMENT ON VIEW product_profit_view IS '商品利益計算ビュー（最終版）：products_dd × 最新のkeepa_snapshotsをJOINして利益計算を行う。dd_cost/price_listの両方に対応。';
