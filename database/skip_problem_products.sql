-- ========================================
-- 問題のある商品を手動でスキップする
-- ========================================
-- 
-- タイムアウトなどで処理できない商品を一時的にスキップします。
-- スキップされた商品は、指定した期間（デフォルト12時間）は処理対象外になります。
-- 
-- 使い方:
-- 1. WHERE句のASINまたはIDを変更して実行
-- 2. スキップ期間を変更する場合は INTERVAL を調整（例: '24 hours', '1 day'）
--

-- 方法1: ASINで指定（推奨）
UPDATE products_dd
SET 
  keepa_status = 'timeout',
  keepa_skip_until = NOW() + INTERVAL '12 hours',
  keepa_last_error = 'Manual skip: database timeout',
  keepa_last_attempt_at = NOW()
WHERE asin = 'B01MZDQ8FZ'; -- ← ASINを変更

-- 方法2: IDで指定
-- UPDATE products_dd
-- SET 
--   keepa_status = 'timeout',
--   keepa_skip_until = NOW() + INTERVAL '12 hours',
--   keepa_last_error = 'Manual skip: database timeout',
--   keepa_last_attempt_at = NOW()
-- WHERE id = 4210; -- ← IDを変更

-- 確認
SELECT 
  id, 
  asin, 
  jan,
  product_name,
  keepa_status, 
  keepa_skip_until,
  keepa_last_error,
  keepa_last_attempt_at
FROM products_dd
WHERE asin = 'B01MZDQ8FZ'; -- ← ASINを変更して確認

-- ========================================
-- 複数の問題商品を一括スキップ
-- ========================================
-- 
-- 複数のASINをまとめてスキップする場合はこちらを使用
--

-- UPDATE products_dd
-- SET 
--   keepa_status = 'timeout',
--   keepa_skip_until = NOW() + INTERVAL '12 hours',
--   keepa_last_error = 'Manual skip: database timeout',
--   keepa_last_attempt_at = NOW()
-- WHERE asin IN (
--   'B01N0XP8TN',
--   'B01MZDQ8FZ'
--   -- 必要に応じて追加
-- );

-- ========================================
-- スキップを解除（再試行を許可）
-- ========================================
-- 
-- データベースのパフォーマンスが改善した後、
-- スキップを解除して再試行を許可する場合
--

-- UPDATE products_dd
-- SET 
--   keepa_status = 'pending',
--   keepa_skip_until = NULL,
--   keepa_failure_count = 0,
--   keepa_last_error = NULL
-- WHERE asin = 'B01MZDQ8FZ'; -- ← ASINを変更

-- ========================================
-- タイムアウトした商品の一覧表示
-- ========================================

SELECT 
  id,
  asin,
  jan,
  product_name,
  keepa_status,
  keepa_failure_count,
  keepa_skip_until,
  keepa_last_error,
  keepa_last_attempt_at
FROM products_dd
WHERE keepa_status = 'timeout'
ORDER BY keepa_last_attempt_at DESC
LIMIT 20;

