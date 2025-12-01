-- ============================================
-- Keepaバッチ処理のスキップフラグをリセット（安全版）
-- タイムアウトを避けるため、小分けにして実行します
-- ============================================

-- ステップ1: keepa_snapshotsをクリア（高速）
TRUNCATE TABLE keepa_snapshots;

-- ステップ2: スキップフラグのみリセット（keepa_updated_atは残す）
-- これを何度か実行してください（1回で最大5000件ずつ処理）
UPDATE products_dd
SET 
  keepa_skip_until = NULL,
  keepa_status = 'pending',
  keepa_failure_count = 0,
  keepa_last_error = NULL,
  keepa_last_attempt_at = NULL
WHERE id IN (
  SELECT id 
  FROM products_dd 
  WHERE asin IS NOT NULL 
    AND (keepa_skip_until IS NOT NULL 
         OR keepa_status != 'pending' 
         OR keepa_failure_count > 0)
  LIMIT 5000
);

-- 進捗確認：リセットが必要な商品数
SELECT 
  COUNT(*) as remaining_to_reset
FROM products_dd 
WHERE asin IS NOT NULL 
  AND (keepa_skip_until IS NOT NULL 
       OR keepa_status != 'pending' 
       OR keepa_failure_count > 0);

-- ステップ3（オプション）: keepa_updated_atもリセット
-- バッチ処理がすべての商品を完全に再取得します
-- 上記のクエリでremaining_to_resetが0になってから実行してください
/*
UPDATE products_dd
SET keepa_updated_at = NULL
WHERE id IN (
  SELECT id 
  FROM products_dd 
  WHERE asin IS NOT NULL 
    AND keepa_updated_at IS NOT NULL
  LIMIT 5000
);

-- 進捗確認
SELECT 
  COUNT(*) as remaining_with_updated_at
FROM products_dd 
WHERE asin IS NOT NULL 
  AND keepa_updated_at IS NOT NULL;
*/

