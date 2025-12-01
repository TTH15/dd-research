-- ============================================
-- Keepaデータのリセット
-- keepa_snapshotsテーブルのデータを削除し、
-- products_ddテーブルのKeepa関連カラムをリセットします
-- ============================================

-- 1. keepa_snapshotsテーブルの全データを削除
TRUNCATE TABLE keepa_snapshots;

-- 2. products_ddテーブルのKeepa関連カラムをリセット
-- タイムアウトを避けるため、ASINがある商品のみをリセット
UPDATE products_dd
SET 
  keepa_updated_at = NULL,
  keepa_status = 'pending',
  keepa_failure_count = 0,
  keepa_last_error = NULL,
  keepa_last_attempt_at = NULL,
  keepa_skip_until = NULL
WHERE asin IS NOT NULL;

-- 実行結果を確認
SELECT 
  COUNT(*) as total_products,
  COUNT(CASE WHEN asin IS NOT NULL THEN 1 END) as products_with_asin,
  COUNT(CASE WHEN keepa_updated_at IS NOT NULL THEN 1 END) as products_with_keepa_data
FROM products_dd;

SELECT COUNT(*) as keepa_snapshots_count FROM keepa_snapshots;

-- 完了メッセージ
SELECT 'Keepaデータのリセットが完了しました。' as message;

