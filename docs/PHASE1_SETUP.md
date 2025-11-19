# Phase 1: 基盤作成 - セットアップ手順

## Step 1: データベーススキーマの適用

Supabase SQL Editorで以下を実行：

```sql
-- asin_matching_schema.sqlの内容を実行
```

ファイル: `database/asin_matching_schema.sql`

## Step 2: スコアリングロジックの確認

ファイル: `supabase/functions/jan-to-asin-batch/scoring.ts`

既に作成済み。以下の機能を提供：
- タイトル正規化
- 容量抽出
- ブランドスコア計算
- 容量スコア計算
- タイトル類似度計算
- 総合スコア計算

## Step 3: jan-to-asin-batch関数の拡張

現在の実装を拡張して：
1. Search APIで候補ASINを取得
2. 最初の候補ASINの詳細をProduct APIで取得
3. スコアリング実行
4. `asin_candidates`テーブルに保存
5. マッチング判定
6. `asin_matches`テーブルに保存

## 注意点

- レート制限（1トークン/分）を考慮
- 1回の実行で1商品の1候補ASINの詳細を取得
- 複数の候補がある場合は、次の実行で処理

