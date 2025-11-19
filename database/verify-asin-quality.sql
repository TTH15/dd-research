-- ============================================
-- ASIN品質検証用SQLクエリ
-- keepa_snapshotから「在庫なし」「転売カタログ」を検出
-- ============================================

-- 1. 在庫なしの可能性があるASINを検出
-- availabilityAmazon == -1 の場合
SELECT 
    id,
    jan,
    asin,
    product_name,
    keepa_snapshot->'products'->0->>'asin' as keepa_asin,
    keepa_snapshot->'products'->0->>'availabilityAmazon' as availability_amazon,
    asin_confidence
FROM products_dd
WHERE keepa_snapshot IS NOT NULL
  AND (keepa_snapshot->'products'->0->>'availabilityAmazon')::int = -1
  AND (asin_confidence IS NULL OR asin_confidence != 'verified')
ORDER BY updated_at DESC;

-- 2. 出品者数が0のASINを検出
-- buyBoxEligibleOfferCounts が全て0の場合
SELECT 
    id,
    jan,
    asin,
    product_name,
    keepa_snapshot->'products'->0->>'asin' as keepa_asin,
    keepa_snapshot->'products'->0->>'buyBoxEligibleOfferCounts' as offer_counts,
    asin_confidence
FROM products_dd
WHERE keepa_snapshot IS NOT NULL
  AND keepa_snapshot->'products'->0->>'buyBoxEligibleOfferCounts' IS NOT NULL
  AND (asin_confidence IS NULL OR asin_confidence != 'verified')
ORDER BY updated_at DESC;

-- 3. 怪しいASINにフラグを立てる（手動実行用）
-- UPDATE products_dd
-- SET asin_confidence = 'suspicious'
-- WHERE id = <商品ID>;

-- 4. 検証済みとしてマーク（手動実行用）
-- UPDATE products_dd
-- SET asin_confidence = 'verified'
-- WHERE id = <商品ID>;

