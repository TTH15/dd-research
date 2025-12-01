-- ============================================
-- Keepaステータスのリセット（バッチ処理版）
-- タイムアウトを避けるため、少量ずつリセットします
-- ============================================

-- 方法1: ASINがある商品のみリセット（最も安全）
-- 以下のクエリを何度か実行してください（1回あたり1000件ずつ処理）

UPDATE products_dd
SET 
  keepa_status = 'pending',
  keepa_failure_count = 0,
  keepa_last_error = NULL,
  keepa_last_attempt_at = NULL,
  keepa_skip_until = NULL
WHERE id IN (
  SELECT id 
  FROM products_dd 
  WHERE asin IS NOT NULL 
    AND (keepa_status != 'pending' OR keepa_failure_count > 0 OR keepa_skip_until IS NOT NULL)
  LIMIT 1000
);

-- 進捗確認：リセットが必要な商品が0件になるまで繰り返してください
SELECT 
  COUNT(*) as remaining_to_reset
FROM products_dd 
WHERE asin IS NOT NULL 
  AND (keepa_status != 'pending' OR keepa_failure_count > 0 OR keepa_skip_until IS NOT NULL);

-- 方法2: keepa_updated_atもリセットしたい場合（オプション）
-- これにより、バッチ処理がすべての商品を再取得します
/*
UPDATE products_dd
SET keepa_updated_at = NULL
WHERE id IN (
  SELECT id 
  FROM products_dd 
  WHERE asin IS NOT NULL 
    AND keepa_updated_at IS NOT NULL
  LIMIT 1000
);
*/

