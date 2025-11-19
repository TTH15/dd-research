-- ============================================
-- JAN検索状態管理用カラム追加
-- products_ddテーブルにJAN検索の状態を管理するカラムを追加
-- ============================================

-- last_seenカラムを追加（既存のトリガーが参照している可能性があるため）
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS last_seen TIMESTAMPTZ DEFAULT NOW();

-- JAN検索の状態を管理するカラムを追加
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS jan_search_status TEXT DEFAULT 'pending';
  -- 'pending': 未検索（デフォルト）
  -- 'not_found': Keepaに商品が見つからない（永久NG、リトライしない）
  -- 'api_error': APIエラー（一時的失敗、リトライ対象）
  -- 'manual_review': 3回連続失敗などで要手動確認
  -- 'success': ASINが見つかった（検索完了）

ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS jan_search_failure_count INTEGER DEFAULT 0;
  -- 連続失敗回数（api_errorの場合のみカウント）

ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS jan_search_last_error TEXT;
  -- 最後のエラー内容（デバッグ用）

ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS jan_search_last_attempt_at TIMESTAMPTZ;
  -- 最後の検索試行日時

-- Keepaレスポンス全体を保存（将来の検証・スコアリング用）
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS keepa_snapshot JSONB;
  -- Keepa APIのレスポンス全体を保存（products配列、availabilityAmazon、buyBoxEligibleOfferCounts、offersなど）
  -- 後で「在庫なし」「転売カタログ」などの検証に使用

-- 将来的な拡張用：ASINの信頼度フラグ
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS asin_confidence TEXT DEFAULT NULL;
  -- NULL: 未検証（デフォルト）
  -- 'verified': 検証済み（問題なし）
  -- 'suspicious': 怪しい（在庫なし、転売カタログの可能性）
  -- 'manual_review': 手動確認が必要

-- インデックス作成（検索パフォーマンス向上）
CREATE INDEX IF NOT EXISTS idx_products_dd_jan_search_status 
  ON products_dd(jan_search_status) 
  WHERE jan_search_status IN ('pending', 'api_error');

CREATE INDEX IF NOT EXISTS idx_products_dd_jan_search_failure_count 
  ON products_dd(jan_search_failure_count) 
  WHERE jan_search_failure_count > 0;

-- インデックス作成（keepa_snapshot用のGINインデックス - JSONB検索用）
CREATE INDEX IF NOT EXISTS idx_products_dd_keepa_snapshot 
  ON products_dd USING GIN (keepa_snapshot);

CREATE INDEX IF NOT EXISTS idx_products_dd_asin_confidence 
  ON products_dd(asin_confidence) 
  WHERE asin_confidence IS NOT NULL;

-- コメント
COMMENT ON COLUMN products_dd.jan_search_status IS 'JAN検索の状態: pending(未検索), not_found(Keepa未登録), api_error(APIエラー), manual_review(要手動確認), success(検索完了)';
COMMENT ON COLUMN products_dd.jan_search_failure_count IS '連続失敗回数（api_errorの場合のみカウント、3回でmanual_reviewに移行）';
COMMENT ON COLUMN products_dd.jan_search_last_error IS '最後のエラー内容（デバッグ用）';
COMMENT ON COLUMN products_dd.jan_search_last_attempt_at IS '最後の検索試行日時';
COMMENT ON COLUMN products_dd.keepa_snapshot IS 'Keepa APIレスポンス全体（JSONB）。availabilityAmazon、buyBoxEligibleOfferCounts、offers、価格履歴などを含む。後で「在庫なし」「転売カタログ」検証に使用';
COMMENT ON COLUMN products_dd.asin_confidence IS 'ASINの信頼度: verified(検証済み), suspicious(怪しい), manual_review(要手動確認), NULL(未検証)';

