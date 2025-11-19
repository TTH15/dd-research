-- ============================================
-- JAN→ASIN自動検索の動作確認用SQL
-- ============================================

-- 1. ASINが設定された商品を確認（最新10件）
SELECT 
    id,
    product_name,
    brand,
    jan,
    asin,
    updated_at
FROM products_dd
WHERE asin IS NOT NULL
ORDER BY updated_at DESC
LIMIT 10;

-- 2. ASINがNULLでJANがある商品の数を確認（検索対象）
SELECT 
    COUNT(*) as total_products_without_asin,
    COUNT(DISTINCT jan) as unique_jans
FROM products_dd
WHERE asin IS NULL 
  AND jan IS NOT NULL;

-- 3. 最近更新された商品（ASIN設定の可能性あり）
SELECT 
    id,
    product_name,
    jan,
    asin,
    updated_at,
    CASE 
        WHEN asin IS NOT NULL THEN 'ASINあり'
        WHEN jan IS NOT NULL THEN 'JANのみ（検索対象）'
        ELSE 'JANなし'
    END as status
FROM products_dd
ORDER BY updated_at DESC
LIMIT 20;

-- 4. JANコード別のASIN設定状況
SELECT 
    jan,
    COUNT(*) as product_count,
    COUNT(asin) as asin_count,
    COUNT(*) - COUNT(asin) as missing_asin_count
FROM products_dd
WHERE jan IS NOT NULL
GROUP BY jan
ORDER BY product_count DESC
LIMIT 20;

