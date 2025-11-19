-- ============================================
-- JAN→ASIN自動検索の結果確認
-- ============================================

-- Step 1: 関数のレスポンスを確認（JSON形式で返ってくる）
-- 注意: net.http_postはリクエストIDを返すだけなので、
-- 実際のレスポンスを見るには、Edge Functionsのログを確認する必要があります

-- Step 2: ASINが設定された商品を確認
SELECT 
    id,
    product_name,
    brand,
    jan,
    asin,
    updated_at,
    CASE 
        WHEN asin IS NOT NULL THEN '✅ ASIN設定済み'
        WHEN jan IS NOT NULL THEN '⏳ JANあり（検索待ち）'
        ELSE '❌ JANなし'
    END as status
FROM products_dd
WHERE asin IS NOT NULL
ORDER BY updated_at DESC
LIMIT 20;

-- Step 3: 検索対象の商品数（ASINがNULLでJANがある商品）
SELECT 
    COUNT(*) as products_needing_asin,
    COUNT(DISTINCT jan) as unique_jans
FROM products_dd
WHERE asin IS NULL 
  AND jan IS NOT NULL;

-- Step 4: 最近更新された商品（ASIN設定の可能性）
SELECT 
    id,
    product_name,
    jan,
    asin,
    updated_at
FROM products_dd
ORDER BY updated_at DESC
LIMIT 10;

