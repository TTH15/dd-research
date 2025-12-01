-- ============================================
-- Keepa取得状態管理カラムの追加
-- products_ddテーブルにKeepaスナップショット取得状態を管理するカラムを追加
-- ============================================

ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_status TEXT DEFAULT 'pending';
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_failure_count INTEGER DEFAULT 0;
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_last_error TEXT;
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_last_attempt_at TIMESTAMPTZ;
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_skip_until TIMESTAMPTZ;

COMMENT ON COLUMN products_dd.keepa_status IS 'Keepa取得状態: pending, success, error, timeout など';
COMMENT ON COLUMN products_dd.keepa_failure_count IS 'Keepa取得連続失敗回数';
COMMENT ON COLUMN products_dd.keepa_last_error IS '最後に発生したKeepa取得エラー内容';
COMMENT ON COLUMN products_dd.keepa_last_attempt_at IS '最後にKeepa取得を試行した日時';
COMMENT ON COLUMN products_dd.keepa_skip_until IS 'Keepa取得を再試行するまでの待機期限（タイムアウト等で設定）';

CREATE INDEX IF NOT EXISTS idx_products_dd_keepa_status ON products_dd(keepa_status);
CREATE INDEX IF NOT EXISTS idx_products_dd_keepa_skip_until ON products_dd(keepa_skip_until) WHERE keepa_skip_until IS NOT NULL;

