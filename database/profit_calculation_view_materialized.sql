-- マテリアライズドビュー版（パフォーマンス改善）
-- 通常のビューと違い、データを物理的に保存するため高速
-- 定期的にREFRESHが必要だが、products_ddの更新がブロックされない

-- 既存のビューを削除
DROP VIEW IF EXISTS product_profit_view;

-- マテリアライズドビューを作成
DROP MATERIALIZED VIEW IF EXISTS product_profit_view;

CREATE MATERIALIZED VIEW product_profit_view AS
SELECT 
  p.id,
  p.jan,
  p.asin,
  p.product_name,
  p.brand,
  p.image_url,
  p.product_url,
  p.source,
  COALESCE(p.dd_cost, p.price_list) as dd_cost,
  p.dd_url,
  p.price_list,
  p.scraped_at,
  p.updated_at,
  
  -- Keepa snapshot データ
  ks.created_at as keepa_snapshot_at,
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
  
  -- 販売価格（カート価格 or 最低新品価格）
  COALESCE(ks.buy_box_price, ks.lowest_new_price) as selling_price,
  
  -- Amazon手数料控除後の入金額（販売価格の80%）
  ROUND(COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) as amazon_payout,
  
  -- 仕入れ値（dd_cost優先、なければprice_list）
  COALESCE(p.dd_cost, p.price_list) as cost,
  
  -- 粗利（入金額 - 仕入れ値）
  ROUND(COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - COALESCE(p.dd_cost, p.price_list, 0) as gross_profit,
  
  -- 粗利率（%）
  CASE 
    WHEN COALESCE(p.dd_cost, p.price_list) > 0 THEN 
      ROUND(
        ((COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - COALESCE(p.dd_cost, p.price_list)) 
        / COALESCE(p.dd_cost, p.price_list) * 100,
        1
      )
    ELSE NULL
  END as gross_margin_pct,
  
  -- 月間販売見込み（30日のランキング下落回数）
  COALESCE(ks.sales_rank_drops_30, 0) as monthly_sales_estimate,
  
  -- 月間粗利見込み（粗利 × 月間販売）
  (ROUND(COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - COALESCE(p.dd_cost, p.price_list, 0)) 
    * COALESCE(ks.sales_rank_drops_30, 0) as monthly_gross_profit,
  
  -- 候補商品フラグ
  CASE
    WHEN ks.id IS NOT NULL
      AND COALESCE(p.dd_cost, p.price_list) > 0
      AND (ROUND(COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - COALESCE(p.dd_cost, p.price_list, 0)) >= 300
      AND ((COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - COALESCE(p.dd_cost, p.price_list)) / COALESCE(p.dd_cost, p.price_list) >= 0.2
      AND COALESCE(ks.sales_rank_drops_30, 0) >= 20
      AND ks.is_amazon_seller = false
    THEN true
    ELSE false
  END as is_candidate,
  
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
  CASE WHEN ks.id IS NOT NULL THEN true ELSE false END as is_keepa_analyzed

FROM products_dd p
LEFT JOIN LATERAL (
  SELECT * 
  FROM keepa_snapshots ks_inner
  WHERE ks_inner.asin = p.asin
  ORDER BY ks_inner.created_at DESC
  LIMIT 1
) ks ON true;

-- インデックスを作成（高速化）
CREATE INDEX idx_product_profit_view_recommendation ON product_profit_view (recommendation_score DESC);
CREATE INDEX idx_product_profit_view_monthly_profit ON product_profit_view (monthly_gross_profit DESC NULLS LAST);
CREATE INDEX idx_product_profit_view_is_candidate ON product_profit_view (is_candidate) WHERE is_candidate = true;
CREATE INDEX idx_product_profit_view_is_keepa_analyzed ON product_profit_view (is_keepa_analyzed) WHERE is_keepa_analyzed = true;
CREATE INDEX idx_product_profit_view_scraped_at ON product_profit_view (scraped_at DESC NULLS LAST);

-- 初回データ投入
REFRESH MATERIALIZED VIEW product_profit_view;

-- 使い方：
-- 1. 通常のビューと同じようにSELECTできる
-- 2. データを更新する場合は以下を実行：
--    REFRESH MATERIALIZED VIEW product_profit_view;
-- 3. フロントエンドのバッチ処理で5分おきに自動REFRESHすることを推奨

