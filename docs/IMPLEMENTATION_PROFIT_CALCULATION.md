# 利益計算システム実装ドキュメント

## 概要

JAN→ASIN変換バッチに加えて、Keepa連携による利益計算と候補商品自動ピックアップ機能を実装しました。

## 実装内容

### 1. データベーススキーマ

#### 1.1. `keepa_snapshots`テーブル（新規）

ASINごとのKeepaレスポンスを時系列で保存するスナップショットテーブル。

**ファイル**: `database/keepa_snapshots_schema.sql`

**主要カラム**:
- `product_id`: 商品ID（FK）
- `asin`: ASINコード
- `snapshot_at`: スナップショット取得日時
- `raw_json`: Keepa APIレスポンス全体（JSONB）
- `buy_box_price`: Buy Box価格（円単位）
- `lowest_new_price`: 新品最安値（円単位）
- `sales_rank`: 現在のランキング
- `sales_rank_drops_30`: 過去30日間のセールスランクドロップ回数
- `offers_count`: 出品者数
- `is_amazon_seller`: Amazon本体がいるかどうか

#### 1.2. `products_dd`テーブルへのカラム追加

**ファイル**: `database/add_dd_cost_column.sql`

**追加カラム**:
- `dd_cost`: DDオンラインストアでの仕入れ単価（NUMERIC(10, 2)）
- `dd_url`: DDオンラインストアでの商品URL

#### 1.3. `product_profit_view`ビュー（新規）

商品利益計算ビュー。`products_dd` × 最新の`keepa_snapshots`をJOINして利益計算を行う。

**ファイル**: `database/profit_calculation_view.sql`

**計算項目**:
- `selling_price`: 販売価格（buy_box_price優先、なければlowest_new_price）
- `amazon_payout`: Amazon手数料（簡易モデル：販売価格の80%）
- `gross_profit`: 粗利（amazon_payout - cost）
- `gross_margin_pct`: 粗利率（%）
- `monthly_sales_estimate`: 月間販売見込み（sales_rank_drops_30）
- `monthly_gross_profit`: 月間粗利（gross_profit × monthly_sales_estimate）
- `is_candidate`: 候補商品フラグ（以下の条件を満たす場合にtrue）
  - `gross_profit >= 400円`
  - `gross_margin_pct >= 25%`
  - `monthly_sales_estimate >= 20件`
  - `is_amazon_seller = false`

### 2. Edge Functions

#### 2.1. `keepa-snapshot-batch`（新規）

ASINが設定されている商品に対してKeepa /product APIを叩き、`keepa_snapshots`テーブルにレコードを追加するバッチ処理。

**ファイル**: `supabase/functions/keepa-snapshot-batch/index.ts`

**処理フロー**:
1. `products_dd`テーブルからASINが設定されている商品を取得（`jan_search_status='success'`）
2. Keepa Product API（`/product?domain=5&asin=ASIN&stats=30`）を呼び出し
3. レスポンスをパースして`keepa_snapshots`テーブルに保存
4. `products_dd`テーブルの`keepa_updated_at`を更新

**レート制限対応**:
- 429エラー時は`refillIn`の時間だけ待機して再試行
- デフォルトは1件ずつ処理（`KEEPA_BATCH_SIZE`環境変数で調整可能）

**エラーハンドリング**:
- Keepaから`products: []`が返ってきた場合 → 警告ログを出してスキップ
- その他のエラー → ログ出力してスキップ（次回リトライ可能）

### 3. Web UI拡張

#### 3.1. テーブルカラム追加

**ファイル**: `index.html`, `app.js`

**追加カラム**:
- 仕入れ値（`dd_cost`）
- 販売価格（`selling_price`）
- 粗利（`gross_profit`）
- 粗利率（`gross_margin_pct`）
- 月間販売見込み（`monthly_sales_estimate`）
- 月間粗利（`monthly_gross_profit`）
- Amazon本体有無（`is_amazon_seller`）
- 候補フラグ（`is_candidate`）

#### 3.2. フィルタ機能追加

**追加フィルタ**:
- 「候補商品のみ」トグル（`is_candidate = true`）
- 「粗利 ≥ X円」入力（`gross_profit >= X`）
- 「粗利率 ≥ Y%」入力（`gross_margin_pct >= Y`）

#### 3.3. データソース変更

`products_dd`テーブルから直接取得するのではなく、`product_profit_view`ビューを使用するように変更。

## セットアップ手順

### Step 1: データベースマイグレーション

Supabase SQL Editorで以下の順序で実行：

```sql
-- 1. keepa_snapshotsテーブル作成
-- database/keepa_snapshots_schema.sql の内容を実行

-- 2. products_ddテーブルにdd_costカラム追加
-- database/add_dd_cost_column.sql の内容を実行

-- 3. 利益計算ビュー作成
-- database/profit_calculation_view.sql の内容を実行
```

### Step 2: Edge Functionデプロイ

```bash
cd supabase/functions/keepa-snapshot-batch
supabase functions deploy keepa-snapshot-batch
```

### Step 3: 環境変数設定

Supabase Dashboard → Settings → Edge Functions → Secrets で以下を設定：

- `KEEPA_API_KEY`: Keepa APIキー
- `KEEPA_BATCH_SIZE`: バッチサイズ（デフォルト: 1）

### Step 4: Cronジョブ設定（オプション）

Keepaスナップショットを定期的に取得する場合：

```sql
-- 1分に1回実行（レート制限考慮）
SELECT cron.schedule(
  'keepa-snapshot-continuous',
  '* * * * *', -- 毎分
  $$
  SELECT net.http_post(
    url := 'https://YOUR_PROJECT.supabase.co/functions/v1/keepa-snapshot-batch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    )
  );
  $$
);
```

### Step 5: 仕入れ値データの投入

既存の`price_list`を`dd_cost`にコピーする場合：

```sql
UPDATE products_dd 
SET dd_cost = price_list 
WHERE dd_cost IS NULL AND price_list IS NOT NULL;
```

または、新規商品登録時に`dd_cost`を設定してください。

## 使用方法

### 1. Keepaスナップショットの取得

#### 手動実行

```bash
curl -X POST https://YOUR_PROJECT.supabase.co/functions/v1/keepa-snapshot-batch \
  -H "Authorization: Bearer YOUR_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json"
```

#### 自動実行

Cronジョブを設定している場合、自動的に実行されます。

### 2. Web UIでの確認

1. ブラウザで`index.html`を開く
2. 「候補商品のみ」チェックボックスをONにすると、候補商品のみ表示
3. 「粗利 ≥」や「粗利率 ≥」でフィルタリング
4. テーブルで利益計算結果を確認

## ビジネスロジック

### 利益計算ロジック

1. **販売価格**: `buy_box_price`優先、なければ`lowest_new_price`
2. **Amazon手数料**: 販売価格の80%（簡易モデル）
   - 将来的にFBA手数料テーブルに差し替え可能
3. **粗利**: `amazon_payout - dd_cost`
4. **粗利率**: `(gross_profit / dd_cost) * 100`
5. **月間販売見込み**: `sales_rank_drops_30`をそのまま採用

### 候補商品判定ルール

以下の条件を**すべて**満たす商品が候補商品としてマークされます：

- `gross_profit >= 400円`
- `gross_margin_pct >= 25%`
- `monthly_sales_estimate >= 20件`
- `is_amazon_seller = false`

これらの閾値は`database/profit_calculation_view.sql`のビュー定義内で変更可能です。

## ファイル一覧

### 新規作成ファイル

1. `database/keepa_snapshots_schema.sql` - keepa_snapshotsテーブル作成
2. `database/add_dd_cost_column.sql` - products_ddテーブルにdd_costカラム追加
3. `database/profit_calculation_view.sql` - 利益計算ビュー作成
4. `supabase/functions/keepa-snapshot-batch/index.ts` - Keepaスナップショット取得バッチ
5. `docs/IMPLEMENTATION_PROFIT_CALCULATION.md` - このドキュメント

### 変更ファイル

1. `index.html` - テーブルヘッダーとフィルタUI追加
2. `app.js` - 利益計算カラムの表示とフィルタ機能追加

## 環境変数

### Edge Functions用

- `KEEPA_API_KEY`: Keepa APIキー（必須）
- `KEEPA_BATCH_SIZE`: バッチサイズ（オプション、デフォルト: 1）

### 既存の環境変数

- `SUPABASE_URL`: SupabaseプロジェクトURL（自動設定）
- `SUPABASE_SERVICE_ROLE_KEY`: Supabaseサービスロールキー（自動設定）

## トラブルシューティング

### Keepaスナップショットが取得できない

1. **Keepa APIキーを確認**
   - Supabase Dashboard → Settings → Edge Functions → Secrets
   - `KEEPA_API_KEY`が正しく設定されているか確認

2. **レート制限エラー**
   - Keepa APIのレート制限に達している可能性
   - バッチサイズを1に設定して、処理間隔を空ける

3. **ASINが設定されていない**
   - `jan_search_status='success'`の商品のみ処理対象
   - 先にJAN→ASINバッチを実行してASINを取得

### 利益計算が表示されない

1. **keepa_snapshotsテーブルにデータがあるか確認**
   ```sql
   SELECT COUNT(*) FROM keepa_snapshots;
   ```

2. **product_profit_viewビューが正しく作成されているか確認**
   ```sql
   SELECT * FROM product_profit_view LIMIT 1;
   ```

3. **dd_costが設定されているか確認**
   ```sql
   SELECT COUNT(*) FROM products_dd WHERE dd_cost IS NOT NULL;
   ```

### Web UIでエラーが発生する

1. **ブラウザのコンソールを確認**
   - F12キーで開発者ツールを開く
   - Consoleタブでエラーメッセージを確認

2. **Supabase設定を確認**
   - `config.js`のSupabase設定が正しいか確認
   - RLSポリシーが正しく設定されているか確認

## 今後の拡張予定

1. **FBA手数料テーブル**
   - 現在の簡易モデル（80%）を、カテゴリー・重量・サイズに基づく正確な計算に置き換え

2. **通知システム**
   - 候補商品が見つかった場合に通知を送信

3. **履歴管理**
   - Keepaスナップショットの履歴を可視化
   - 価格変動の追跡

4. **ソート機能の追加**
   - Web UIで粗利額、粗利率、月間粗利でソート可能に

## 参考資料

- [Keepa API Documentation](https://keepa.com/#!api)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [PostgreSQL JSONB](https://www.postgresql.org/docs/current/datatype-json.html)

