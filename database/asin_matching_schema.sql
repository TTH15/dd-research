-- ============================================
-- ASINマッチング用テーブル構造
-- DD → Amazon リサーチ半自動化システム
-- ============================================

-- 1. asin_candidates テーブル（Keepa返却の候補ASIN）
CREATE TABLE IF NOT EXISTS asin_candidates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id BIGINT NOT NULL REFERENCES products_dd(id) ON DELETE CASCADE,
    asin TEXT NOT NULL,
    keepa_title TEXT,
    brand TEXT,
    manufacturer TEXT,
    size_info TEXT, -- Keepaタイトルから抽出した容量
    category TEXT, -- Keepaカテゴリ
    score INTEGER DEFAULT 0, -- スコア（0-100）
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- ユニーク制約：同じ商品の同じASINは重複しない
    UNIQUE(product_id, asin)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_asin_candidates_product_id ON asin_candidates(product_id);
CREATE INDEX IF NOT EXISTS idx_asin_candidates_asin ON asin_candidates(asin);
CREATE INDEX IF NOT EXISTS idx_asin_candidates_score ON asin_candidates(score DESC);

-- 2. asin_matches テーブル（最終マッチ結果）
CREATE TABLE IF NOT EXISTS asin_matches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id BIGINT NOT NULL REFERENCES products_dd(id) ON DELETE CASCADE,
    asin TEXT NOT NULL,
    match_type TEXT NOT NULL CHECK (match_type IN ('EXACT_MATCH', 'HIGH_CONFIDENCE', 'REVIEW_NEEDED', 'NO_MATCH')),
    decided_by TEXT NOT NULL DEFAULT 'system' CHECK (decided_by IN ('system', 'human')),
    score INTEGER, -- 採用時のスコア
    notes TEXT, -- メモ（人間が決定した場合の理由など）
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- ユニーク制約：1商品につき1つのマッチ結果
    UNIQUE(product_id)
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_asin_matches_product_id ON asin_matches(product_id);
CREATE INDEX IF NOT EXISTS idx_asin_matches_match_type ON asin_matches(match_type);
CREATE INDEX IF NOT EXISTS idx_asin_matches_asin ON asin_matches(asin);

-- updated_at自動更新トリガー
CREATE OR REPLACE FUNCTION update_asin_matches_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_asin_matches_updated_at
    BEFORE UPDATE ON asin_matches
    FOR EACH ROW
    EXECUTE FUNCTION update_asin_matches_updated_at();

-- RLS（Row Level Security）設定
ALTER TABLE asin_candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE asin_matches ENABLE ROW LEVEL SECURITY;

-- パブリック読み取り許可（anonキーで読み取り可能）
CREATE POLICY "Allow public read access to asin_candidates"
    ON asin_candidates FOR SELECT
    USING (true);

CREATE POLICY "Allow public read access to asin_matches"
    ON asin_matches FOR SELECT
    USING (true);

-- サービスロールキーで書き込み可能（Edge Functionsから使用）
CREATE POLICY "Allow service role to insert asin_candidates"
    ON asin_candidates FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Allow service role to update asin_candidates"
    ON asin_candidates FOR UPDATE
    USING (true);

CREATE POLICY "Allow service role to insert asin_matches"
    ON asin_matches FOR INSERT
    WITH CHECK (true);

CREATE POLICY "Allow service role to update asin_matches"
    ON asin_matches FOR UPDATE
    USING (true);

-- コメント
COMMENT ON TABLE asin_candidates IS 'Keepa APIから取得したASIN候補とスコアリング結果';
COMMENT ON TABLE asin_matches IS '最終的に決定されたASINマッチング結果';
COMMENT ON COLUMN asin_candidates.score IS 'スコアリング結果（0-100）。ブランド、容量、タイトル類似度などから算出';
COMMENT ON COLUMN asin_matches.match_type IS 'マッチングの信頼度: EXACT_MATCH(自動決定), HIGH_CONFIDENCE(要確認), REVIEW_NEEDED(要レビュー), NO_MATCH(一致なし)';

