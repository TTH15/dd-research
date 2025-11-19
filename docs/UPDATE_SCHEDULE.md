# JAN→ASIN自動検索のスケジュール設定

## 📋 現在の状況

- ✅ `jan-to-asin-batch`関数を1分に1件ずつ処理するように修正済み
- ✅ `keepa-continuous-update`関数も1分に1件ずつ処理（既に実装済み）

## 🔄 動作フロー

```
【1分ごとの自動処理】
1. JAN→ASIN検索（jan-to-asin-batch）
   → 1分に1件ずつ、JANコードからASINを検索
   → ASINが見つかったらデータベースに保存

2. Keepaデータ取得（keepa-continuous-update）
   → 1分に1件ずつ、ASINがある商品のKeepaデータを取得
   → 利益計算・推奨判定

【結果】
→ 1商品あたり2分で完了（ASIN検索1分 + Keepaデータ取得1分）
→ 1日で最大720商品を処理可能（1440分 ÷ 2分 = 720商品/日）
```

## ⚙️ Cron設定

### Step 1: JAN→ASIN自動検索を1分ごとに実行

Supabase SQL Editorで以下を実行：

```sql
-- JAN→ASIN自動検索を1分ごとに実行
SELECT cron.schedule(
  'jan-to-asin-continuous',
  '* * * * *',  -- 毎分実行
  $$
  SELECT net.http_post(
    url := 'https://fwmieqfezlagstigtrem.supabase.co/functions/v1/jan-to-asin-batch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    )
  );
  $$
);
```

### Step 2: Keepaデータ取得を1分ごとに実行（既に設定済みの場合）

既に設定されている場合は、そのまま使用してください。

```sql
-- Keepaデータ取得を1分ごとに実行（既に設定済み）
SELECT cron.schedule(
  'keepa-continuous-update',
  '* * * * *',  -- 毎分実行
  $$
  SELECT net.http_post(
    url := 'https://fwmieqfezlagstigtrem.supabase.co/functions/v1/keepa-continuous-update',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    )
  );
  $$
);
```

## 📊 処理能力

- **1分に1件**: JAN→ASIN検索
- **1分に1件**: Keepaデータ取得
- **合計**: 1商品あたり2分
- **1日あたり**: 最大720商品を処理可能

## 🔍 確認方法

### JAN→ASIN検索の進捗確認

```sql
-- ASINが設定された商品を確認
SELECT 
    COUNT(*) as total_with_asin,
    COUNT(*) FILTER (WHERE asin IS NOT NULL) as asin_count,
    COUNT(*) FILTER (WHERE asin IS NULL AND jan IS NOT NULL) as pending_count
FROM products_dd;
```

### Keepaデータ取得の進捗確認

```sql
-- Keepaデータが取得された商品を確認
SELECT 
    COUNT(*) as total_products,
    COUNT(*) FILTER (WHERE keepa_updated_at IS NOT NULL) as keepa_updated_count,
    COUNT(*) FILTER (WHERE asin IS NOT NULL AND keepa_updated_at IS NULL) as pending_keepa_count
FROM products_dd;
```

## ⚠️ 注意点

1. **レート制限**: Keepa APIは1 token/minの制限があるため、1分に1件ずつ処理する必要があります
2. **処理時間**: 1商品あたり2分かかります（ASIN検索1分 + Keepaデータ取得1分）
3. **自動実行**: Cronで1分ごとに実行されるため、手動実行は不要です

