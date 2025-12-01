-- ============================================
-- Keepaデータのリセット（簡易版）
-- keepa_snapshotsテーブルのみを削除します
-- products_ddのステータスはバッチ処理が自動的に処理します
-- ============================================

-- keepa_snapshotsテーブルの全データを削除
TRUNCATE TABLE keepa_snapshots CASCADE;

-- 実行結果を確認
SELECT 
  COUNT(*) as total_products,
  COUNT(CASE WHEN asin IS NOT NULL THEN 1 END) as products_with_asin,
  COUNT(CASE WHEN keepa_updated_at IS NOT NULL THEN 1 END) as products_with_keepa_updated
FROM products_dd;

SELECT COUNT(*) as keepa_snapshots_count FROM keepa_snapshots;

-- 完了メッセージ
SELECT 'keepa_snapshotsテーブルをクリアしました。' as message,
       'バッチ処理が自動的に再取得を開始します。' as note;

