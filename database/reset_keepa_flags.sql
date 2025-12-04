-- ============================================
-- Keepaバッチ処理のスキップフラグをリセット
-- バッチ処理がすべての商品を再処理するようにします
-- ============================================

-- スキップフラグをリセット（ASINがある商品のみ）
UPDATE products_dd
SET 
  keepa_skip_until = NULL,
  keepa_status = 'pending',
  keepa_failure_count = 0,
  keepa_last_error = NULL,
  keepa_last_attempt_at = NULL,
  keepa_updated_at = NULL  -- これもリセットすると完全に再取得します
WHERE asin IS NOT NULL;

-- 実行結果を確認
SELECT 
  COUNT(*) as total_with_asin,
  COUNT(CASE WHEN keepa_skip_until IS NOT NULL THEN 1 END) as skip_until_set,
  COUNT(CASE WHEN keepa_status = 'timeout' THEN 1 END) as status_timeout,
  COUNT(CASE WHEN keepa_updated_at IS NOT NULL THEN 1 END) as has_updated_at
FROM products_dd
WHERE asin IS NOT NULL;

-- 完了メッセージ
SELECT 'スキップフラグをリセットしました。バッチ処理がすべての商品を再処理します。' as message;




