# JAN→ASIN自動検索のテストガイド

## 📋 テスト手順（段階的に）

### Step 1: Cronジョブの確認

Supabase SQL Editorで以下を実行：

```sql
-- Cronジョブが正しく設定されているか確認
SELECT 
    jobid,
    schedule,
    command,
    jobname,
    active
FROM cron.job
WHERE jobname = 'jan-to-asin-continuous';
```

**期待される結果**:
- `jobname`: `jan-to-asin-continuous`
- `schedule`: `* * * * *` (毎分実行)
- `active`: `true`

---

### Step 2: 検索対象の商品を確認

```sql
-- ASINがNULLでJANがある商品を確認
SELECT 
    id,
    product_name,
    brand,
    jan,
    asin,
    updated_at
FROM products_dd
WHERE asin IS NULL 
  AND jan IS NOT NULL
ORDER BY updated_at ASC
LIMIT 5;
```

**確認ポイント**:
- JANコードが正しく保存されているか
- 商品名とブランドが保存されているか

---

### Step 3: 手動で1回テスト実行

Cronを待たずに、手動で1回実行して動作確認：

```sql
-- 手動で1回テスト実行
SELECT net.http_post(
  url := 'https://fwmieqfezlagstigtrem.supabase.co/functions/v1/jan-to-asin-batch',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
  )
);
```

**期待される結果**:
- リクエストIDが返ってくる（例: `37`）

---

### Step 4: Edge Functionsのログを確認

1. Supabase Dashboard → **Edge Functions** → **jan-to-asin-batch**
2. **Logs**タブを開く
3. 最新のログを確認

**確認ポイント**:
- `[JAN to ASIN Batch] Started at` - 実行開始時刻
- `[JAN to ASIN Batch] Processing 1 products` - 1件処理
- `[JAN to ASIN Batch] Found ASIN: B...` - ASINが見つかった場合
- `[JAN to ASIN Batch] No ASIN found` - ASINが見つからなかった場合
- `[JAN to ASIN Batch] Completed: X success, Y failed` - 最終結果

---

### Step 5: ASINが設定されたか確認

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
LIMIT 5;
```

**期待される結果**:
- ASINが設定された商品が表示される
- `updated_at`が最近の日時になっている

---

### Step 6: 検索対象の残り件数を確認

```sql
-- 検索対象の残り件数
SELECT 
    COUNT(*) as products_needing_asin,
    COUNT(DISTINCT jan) as unique_jans
FROM products_dd
WHERE asin IS NULL 
  AND jan IS NOT NULL;
```

**確認ポイント**:
- `products_needing_asin`が減っているか（処理が進んでいるか）

---

## 🔄 自動実行の確認

Cronが1分ごとに実行されているか確認：

1. **数分待つ**（2-3分）
2. **ログを確認** - 複数回実行されているか
3. **ASINが設定された商品を確認** - 複数件処理されているか

---

## 🐛 よくある問題

### 問題1: Cronが実行されない

**確認方法**:
```sql
-- Cronジョブの状態を確認
SELECT * FROM cron.job WHERE jobname = 'jan-to-asin-continuous';
```

**解決方法**:
- `active`が`false`の場合は、再度スケジュールを設定
- `pg_cron`拡張機能が有効になっているか確認

---

### 問題2: ASINが設定されない

**確認方法**:
- Edge Functionsのログを確認
- Keepa APIのレスポンスを確認

**考えられる原因**:
- Keepa APIでASINが見つからない
- レート制限に引っかかっている
- Keepa APIキーが設定されていない

---

### 問題3: 429エラーが発生する

**確認方法**:
- ログに`429`エラーが表示されているか確認

**解決方法**:
- 既に修正済み（429エラー時に自動再試行）
- ログで`refillIn`の時間を確認

---

## 📊 進捗確認

### 1日あたりの処理能力

- **JAN→ASIN検索**: 1分に1件 = 1日1440件
- **Keepaデータ取得**: 1分に1件 = 1日1440件
- **合計**: 1日で最大720商品を完全処理可能（ASIN検索1分 + Keepaデータ取得1分 = 2分/商品）

### 進捗確認SQL

```sql
-- 全体の進捗確認
SELECT 
    COUNT(*) as total_products,
    COUNT(*) FILTER (WHERE asin IS NOT NULL) as asin_count,
    COUNT(*) FILTER (WHERE asin IS NULL AND jan IS NOT NULL) as pending_asin_count,
    COUNT(*) FILTER (WHERE keepa_updated_at IS NOT NULL) as keepa_updated_count
FROM products_dd;
```

---

## ✅ 次のステップ

1. **Step 3の手動テストを実行** → 動作確認
2. **数分待ってCronの自動実行を確認** → 自動化の確認
3. **ASINが設定された商品を確認** → 結果確認
4. **Keepaデータ取得も動作確認** → 完全なフロー確認

