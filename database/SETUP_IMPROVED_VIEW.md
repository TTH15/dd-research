# 改善版ビューのセットアップガイド

## 概要

このガイドでは、UI改善に必要な`product_profit_view`ビューの更新方法を説明します。

## 前提条件

- Supabaseプロジェクトが作成済み
- `products_dd`テーブルが存在
- `keepa_snapshots`テーブルが存在

## セットアップ手順

### 1. `dd_cost`カラムの追加（未実施の場合）

まず、`products_dd`テーブルに`dd_cost`カラムを追加します。

Supabase SQL Editorで実行：

```sql
-- database/add_dd_cost_column.sql の内容
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS dd_cost NUMERIC(10, 2);
ALTER TABLE products_dd ADD COLUMN IF NOT EXISTS dd_url TEXT;

COMMENT ON COLUMN products_dd.dd_cost IS 'DDオンラインストアでの仕入れ単価（円）';
COMMENT ON COLUMN products_dd.dd_url IS 'DDオンラインストアでの商品URL';
```

### 2. 既存データの移行（オプション）

既存の`price_list`データを`dd_cost`にコピーする場合：

```sql
UPDATE products_dd 
SET dd_cost = price_list 
WHERE dd_cost IS NULL AND price_list IS NOT NULL;

UPDATE products_dd 
SET dd_url = product_url 
WHERE dd_url IS NULL AND product_url IS NOT NULL;
```

> **注意**: この移行は任意です。改善版ビューは`dd_cost`がnullの場合、自動的に`price_list`にフォールバックします。

### 3. `product_profit_view`の更新

改善版のビューを作成します：

```sql
-- database/profit_calculation_view.sql の全内容をコピー&ペースト
```

### 4. 動作確認

ビューが正しく作成されたか確認：

```sql
-- ビューの存在確認
SELECT table_name 
FROM information_schema.views 
WHERE table_name = 'product_profit_view';

-- サンプルデータの取得
SELECT 
  id,
  product_name,
  dd_cost,
  selling_price,
  gross_profit,
  gross_margin_pct,
  monthly_sales_estimate,
  monthly_gross_profit,
  recommendation_score,
  is_candidate
FROM product_profit_view
LIMIT 10;
```

期待される結果：
- `dd_cost`に値が表示される（`price_list`からフォールバック）
- `recommendation_score`が計算されている
- `is_candidate`がtrue/falseで表示される

### 5. Webアプリの確認

ブラウザでDD Research Webを開いて確認：

1. **ダッシュボード統計が表示される**
   - 総商品数
   - 候補商品数
   - 平均粗利率
   - 月間粗利見込み

2. **テーブルに推奨度スコアが表示される**
   - 0-100点のスコア
   - スコアに応じた色分け

3. **候補商品が緑色で強調表示される**

4. **スマートフィルタが動作する**
   - 各フィルタをクリックして絞り込み

## トラブルシューティング

### エラー: relation "products_dd" does not exist

**原因**: `products_dd`テーブルが存在しない

**対処法**:
```sql
-- database/schema.sql を実行してテーブルを作成
```

### エラー: relation "keepa_snapshots" does not exist

**原因**: `keepa_snapshots`テーブルが存在しない

**対処法**:
```sql
-- database/keepa_snapshots_schema.sql を実行
```

### ビューは作成されたが、データが0件

**原因**:
- ビューの条件: `WHERE (p.asin IS NOT NULL OR p.keepa_asin IS NOT NULL OR ks.id IS NOT NULL)`
- ASINまたはKeepaデータが必要

**対処法**:
1. JAN→ASIN検索バッチを実行してASINを設定
2. ASIN→商品情報取得バッチを実行してKeepaデータを取得

### 推奨度スコアが表示されない

**原因**: 古いビュー定義が残っている

**対処法**:
```sql
-- ビューを削除して再作成
DROP VIEW IF EXISTS product_profit_view;

-- その後、profit_calculation_view.sql を再実行
```

### 仕入れ値が表示されない

**原因**:
- `dd_cost`と`price_list`の両方がnull
- データがクローラーで取得できていない

**対処法**:
1. クローラーの動作を確認
2. 手動でデータを投入して検証:
```sql
UPDATE products_dd 
SET price_list = 1000 
WHERE id = 1;

-- ビューで確認
SELECT id, dd_cost, price_list, selling_price, gross_profit 
FROM product_profit_view 
WHERE id = 1;
```

## ビューのカスタマイズ

### 候補商品の判定基準を変更

`database/profit_calculation_view.sql`の以下の部分を編集：

```sql
-- 候補商品フラグ（改善版のルール）
-- 粗利 >= 400円 かつ 粗利率 >= 25% かつ 月間販売 >= 20件 かつ Amazon本体なし
(
  (ROUND(COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) - COALESCE(p.dd_cost, p.price_list, p.price, 0)) >= 400  -- ← この値を変更
  AND ...
) as is_candidate
```

例: 粗利300円以上に緩和する場合

```sql
>= 400  →  >= 300
```

### Amazon手数料率を変更

現在は20%（入金80%）で計算していますが、カテゴリによって変更可能：

```sql
-- Amazon手数料計算（簡易モデル：販売価格の80% = 手数料20%を引いた入金額）
ROUND(COALESCE(ks.buy_box_price, ks.lowest_new_price) * 0.8) as amazon_payout,
```

例: 手数料15%に変更する場合

```sql
* 0.8  →  * 0.85
```

### 推奨度スコアの配点を変更

```sql
-- 推奨度スコア（0-100点）
LEAST(100, GREATEST(0,
  -- 粗利貢献度（最大40点）
  LEAST(40, (粗利) / 10)  -- ← 10円で1点
  +
  -- 粗利率貢献度（最大30点）
  LEAST(30, (粗利率) / 2)  -- ← 2%で1点
  +
  -- 月間販売貢献度（最大30点）
  LEAST(30, (月間販売) / 3)  -- ← 3件で1点
  -
  -- Amazon本体ペナルティ
  (CASE WHEN ks.is_amazon_seller = true THEN 20 ELSE 0 END)  -- ← -20点
)) as recommendation_score
```

## 次のステップ

ビューのセットアップが完了したら、以下のドキュメントを参照してください：

- [UI改善ガイド](../docs/UI_IMPROVEMENTS.md) - 新機能の使い方
- [テストガイド](../docs/TEST_GUIDE.md) - 動作確認方法

## 参考

- [PostgreSQL CREATE VIEW](https://www.postgresql.org/docs/current/sql-createview.html)
- [Supabase Views](https://supabase.com/docs/guides/database/views)

