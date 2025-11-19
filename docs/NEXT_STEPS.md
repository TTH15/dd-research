# JAN→ASIN自動検索の確認手順

## 📋 現在の状況

`jan-to-asin-batch`関数を実行しました（リクエストID: 37）。

## 🔍 確認手順（段階的に）

### Step 1: データベースでASINが設定されたか確認

Supabase SQL Editorで以下を実行：

```sql
-- ASINが設定された商品を確認
SELECT 
    id,
    product_name,
    brand,
    jan,
    asin,
    updated_at
FROM products_dd
WHERE asin IS NOT NULL
ORDER BY updated_at DESC
LIMIT 10;
```

**期待される結果**:
- ASINが設定された商品が表示される
- `updated_at`が最近の日時になっている

**もし結果が0件の場合**:
- Keepa APIでASINが見つからなかった可能性
- ログを確認する必要があります

---

### Step 2: Edge Functionsのログを確認

1. Supabase Dashboard → **Edge Functions** → **jan-to-asin-batch**
2. **Logs**タブを開く
3. 最新のログを確認

**確認ポイント**:
- `[JAN to ASIN Batch] Started at` - 実行開始時刻
- `[JAN to ASIN Batch] Processing X products` - 処理対象の商品数
- `[JAN to ASIN Batch] Found ASIN: B...` - ASINが見つかった場合
- `[JAN to ASIN Batch] No ASIN found for JAN: ...` - ASINが見つからなかった場合
- `[JAN to ASIN Batch] Completed: X success, Y failed` - 最終結果

**エラーが出ている場合**:
- Keepa APIキーが正しく設定されているか確認
- Keepa APIのレート制限に引っかかっていないか確認

---

### Step 3: 検索対象の商品数を確認

```sql
-- ASINがNULLでJANがある商品の数
SELECT 
    COUNT(*) as products_needing_asin,
    COUNT(DISTINCT jan) as unique_jans
FROM products_dd
WHERE asin IS NULL 
  AND jan IS NOT NULL;
```

**確認ポイント**:
- `products_needing_asin`が0の場合 → すべての商品にASINが設定済み
- `products_needing_asin`が0より大きい場合 → まだ検索待ちの商品がある

---

### Step 4: Keepa APIのレスポンスを確認

ログに以下のような行があるか確認：

```
[JAN to ASIN Batch] Keepa API response: {"asinList":["B..."]}
```

**もし`asinList`が空の場合**:
- Keepa APIでJANコードからASINが見つからなかった
- 商品名+ブランドでの検索も試行される（ログに表示される）

---

## 🐛 よくある問題と解決方法

### 問題1: ASINが1つも設定されていない

**原因**:
- Keepa APIでASINが見つからなかった
- Keepa APIキーが設定されていない
- Keepa APIのレート制限に引っかかっている

**解決方法**:
1. Edge Functionsのログを確認
2. Keepa APIキーが正しく設定されているか確認：
   ```bash
   supabase secrets list
   ```
3. Keepa APIのレスポンスを確認（ログに表示される）

---

### 問題2: 一部の商品だけASINが設定された

**原因**:
- Keepa APIで一部のJANコードからASINが見つからなかった
- 商品名+ブランドでの検索でも見つからなかった

**解決方法**:
- これは正常な動作です
- 見つからなかった商品は、手動でASINを設定するか、後で再試行してください

---

### 問題3: 関数が実行されない

**原因**:
- 関数がデプロイされていない
- リクエストがタイムアウトしている

**解決方法**:
1. 関数を再デプロイ：
   ```bash
   cd dd-research
   supabase functions deploy jan-to-asin-batch
   ```
2. 再度実行してみる

---

## 📊 次のステップ

### 1. ASINが設定されたら

Keepaデータの取得を開始できます：

```sql
-- Keepa連続更新を開始（既に設定済みの場合）
-- 1分ごとに1商品ずつKeepaデータを取得
```

### 2. ASINが設定されていない場合

1. ログを確認して原因を特定
2. Keepa APIキーを確認
3. 必要に応じて関数を再実行

---

## 💡 ヒント

- **レート制限**: Keepa APIは1 token/minの制限があるため、100商品の処理には約100分かかります
- **バッチサイズ**: 一度に100件まで処理します（`limit(100)`）
- **再実行**: 見つからなかった商品は、後で再実行できます

