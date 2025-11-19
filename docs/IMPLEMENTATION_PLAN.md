# ASINマッチング実装計画

## Phase 1: 基盤作成（現在）

### Step 1: データベーススキーマ作成 ✅
- `asin_candidates`テーブル作成
- `asin_matches`テーブル作成
- RLS設定

### Step 2: スコアリングロジック実装 ✅
- `scoring.ts`作成済み
- ブランド、容量、タイトル類似度の計算

### Step 3: jan-to-asin-batch関数拡張（進行中）
- Search APIで候補ASINを取得
- 各ASIN候補を`asin_candidates`に保存
- スコアリング実行
- マッチング判定（EXACT_MATCH等）

## Phase 2: マッチング判定ロジック

### Step 1: マッチング判定関数実装
- EXACT_MATCH: スコア≥80、1位と2位の差≥20
- HIGH_CONFIDENCE: スコア≥70、2位と差<10
- REVIEW_NEEDED: スコア40-69
- NO_MATCH: スコア<40 または候補なし

### Step 2: asin_matchesテーブルへの保存
- 判定結果を`asin_matches`に保存

## Phase 3: 管理画面（将来）

### Step 1: Next.js管理画面作成
- `/admin/matching`ページ
- HIGH_CONFIDENCE、REVIEW_NEEDEDの商品を表示
- 手動でASINを確定する機能

## 現在の実装方針

1. **Keepa Search APIの制限**: 1トークン/分のため、1回の実行で1商品のみ処理
2. **候補ASINの取得**: Search APIで候補ASINリストを取得
3. **詳細情報の取得**: 各ASINの詳細はKeepa Product APIで取得（別の関数で）
4. **スコアリング**: 取得した詳細情報からスコアリング
5. **マッチング判定**: スコアに基づいて判定

## 注意点

- Keepa Search APIは候補ASINのリストを返すが、詳細情報（タイトル、ブランド等）は含まれない可能性がある
- 詳細情報を取得するには、各ASINに対してProduct APIを呼び出す必要がある
- レート制限を考慮すると、1回の実行で1商品の1候補ASINの詳細を取得するのが現実的

