-- ============================================
-- JAN→ASIN自動検索のテスト手順
-- ============================================

-- Step 1: Cronジョブが正しく設定されているか確認
SELECT 
    jobid,
    schedule,
    command,
    nodename,
    nodeport,
    database,
    username,
    active,
    jobname
FROM cron.job
WHERE jobname = 'jan-to-asin-continuous';

-- Step 2: 検索対象の商品を確認（ASINがNULLでJANがある商品）
SELECT 
    id,
    product_name,
    brand,
    jan,
    asin,
    updated_at
FROM products_dd
WHERE asin IS NULL 
  AND jan IS NOT NULL
ORDER BY updated_at ASC
LIMIT 5;

-- Step 3: 手動で1回テスト実行（Cronを待たずに確認）
SELECT net.http_post(
  url := 'https://fwmieqfezlagstigtrem.supabase.co/functions/v1/jan-to-asin-batch',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
  )
);

-- Step 4: 実行後にASINが設定されたか確認
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
LIMIT 5;

-- Step 5: 検索対象の残り件数を確認
SELECT 
    COUNT(*) as products_needing_asin,
    COUNT(DISTINCT jan) as unique_jans
FROM products_dd
WHERE asin IS NULL 
  AND jan IS NOT NULL;

