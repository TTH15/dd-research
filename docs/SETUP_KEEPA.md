## 🚀 Keepa連携・利益計算システム セットアップガイド

このガイドでは、フル版の利益計算・自動更新システムをセットアップします。

---

## 📋 必要なもの

1. **Keepa API キー**
   - [Keepa](https://keepa.com/) でアカウント作成
   - API Access を購入（月額 $19〜）
   - API Key を取得

2. **Supabase プロジェクト**
   - 既存のプロジェクトを使用

3. **Supabase CLI**
   ```bash
   npm install -g supabase
   ```

---

## ⚙️ Step 1: データベーススキーマの適用

### 1-1. Supabaseダッシュボードにログイン

[https://supabase.com](https://supabase.com)

### 1-2. SQL Editorを開く

プロジェクト → **SQL Editor**

### 1-3. スキーマSQLを実行

`database/schema.sql` の内容をコピーして実行

これにより以下が追加されます：
- ✅ Keepaデータを保存するカラム
- ✅ 利益計算結果のカラム
- ✅ 更新ログテーブル
- ✅ 自動更新設定テーブル
- ✅ 推奨商品ビュー

---

## 🔧 Step 2: Supabase Edge Functions のデプロイ

### 2-1. Supabase CLIでログイン

```bash
supabase login
```

### 2-2. プロジェクトをリンク

```bash
supabase link --project-ref <your-project-ref>
```

プロジェクトREFは、Supabase URL から取得できます：
`https://[your-project-ref].supabase.co`

### 2-3. 環境変数を設定

**重要**: Supabase Edge Functionsでは、`SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` は**自動的に利用可能**です。設定する必要はありません。

設定が必要なのは **Keepa API Key だけ**です：

```bash
# Keepa API Key のみ設定
supabase secrets set KEEPA_API_KEY=your_keepa_api_key_here
```

**注意**: `SUPABASE_` で始まる環境変数は、Supabase CLIが自動的に管理するため、手動設定しようとするとスキップされます。これは正常な動作です。

### 2-4. Edge Functions をデプロイ

```bash
# Keepa データ取得関数
supabase functions deploy keepa-fetch

# バッチ更新関数
supabase functions deploy keepa-batch-update
```

### 2-5. Function URLs を確認

```bash
supabase functions list
```

以下のような情報が表示されます：
```
ID                                   | NAME               | SLUG               | STATUS | VERSION | UPDATED_AT (UTC)    
-------------------------------------|--------------------|--------------------|--------|---------|---------------------
849360b9-... | keepa-fetch        | keepa-fetch        | ACTIVE | 1       | 2025-11-18 02:50:27 
daaaeb68-... | keepa-batch-update | keepa-batch-update | ACTIVE | 1       | 2025-11-18 02:50:38 
```

**Function URLの構成方法**:
Function URLは以下の形式で構成されます：
```
https://[プロジェクトREF].supabase.co/functions/v1/[関数名]
```

あなたの場合：
- `keepa-fetch`: `https://fwmieqfezlagstigtrem.supabase.co/functions/v1/keepa-fetch`
- `keepa-batch-update`: `https://fwmieqfezlagstigtrem.supabase.co/functions/v1/keepa-batch-update`

### 2-6. バッチ更新関数に環境変数を追加（オプション）

バッチ更新関数が `keepa-fetch` 関数を呼び出すためのURLを設定します：

```bash
# あなたのプロジェクトの場合
supabase secrets set KEEPA_FETCH_FUNCTION_URL=https://fwmieqfezlagstigtrem.supabase.co/functions/v1/keepa-fetch
```

**注意**: このURLは、あなたのプロジェクトREFに合わせて調整してください。

---

## 📅 Step 3: 定期実行の設定（Cron）

### 方法A: Supabase pg_cron（推奨・24時間常時稼働）

**重要**: まず、必要な拡張機能を有効化する必要があります。

#### Step 3-1: 拡張機能を有効化

Supabaseダッシュボードで SQL Editor を開き、以下を実行：

```sql
-- pg_cron拡張機能を有効化（定期実行用）
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- pg_net拡張機能を有効化（HTTPリクエスト用）
CREATE EXTENSION IF NOT EXISTS pg_net;
```

**または、UIから有効化**:
1. Supabaseダッシュボード → **Database** → **Extensions**
2. `pg_cron` を検索して有効化
3. `pg_net` を検索して有効化

#### Step 3-2: Cronジョブをスケジュール

拡張機能が有効化されたら、以下を実行：

```sql
-- 6時間ごとに実行（1日4回、24時間常時稼働）
-- 0時、6時、12時、18時に実行
-- 
-- 注意: YOUR_SERVICE_ROLE_KEY を実際のService Role Keyに置き換えてください
-- Settings → API → service_role (secret) から取得
SELECT cron.schedule(
  'keepa-batch-update',
  '0 */6 * * *',
  $$
  SELECT net.http_post(
    url := 'https://fwmieqfezlagstigtrem.supabase.co/functions/v1/keepa-batch-update',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer YOUR_SERVICE_ROLE_KEY'
    )
  );
  $$
);

-- または、より頻繁に実行したい場合（3時間ごと）
-- SELECT cron.schedule(
--   'keepa-batch-update',
--   '0 */3 * * *',
--   ...
-- );
```

**実行タイミングの選択肢**:

### 方法A: バッチ更新（50商品ずつまとめて処理）
- `'0 */6 * * *'` - 6時間ごと（1日4回、200商品/日）
- `'0 */3 * * *'` - 3時間ごと（1日8回、400商品/日）
- `'0 */12 * * *'` - 12時間ごと（1日2回、100商品/日）

**注意**: 50商品の更新に約50分かかります。

### 方法B: 連続更新（1分ごとに1商品ずつ処理）⭐ 推奨

より効率的な方法として、**1分ごとに1商品ずつ処理**する連続更新モードも利用可能です：

```sql
-- 1分ごとに実行（1日1440回、最大1440商品/日）
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

**メリット**:
- ✅ レート制限（1 token/min）に最適化
- ✅ 常時稼働で自動更新
- ✅ 処理時間が短い（1商品あたり数秒）
- ✅ エラーが発生しても次の商品に進める

**デプロイ方法**:
```bash
supabase functions deploy keepa-continuous-update
```

### 方法C: JANからASINを自動検索（スクレイピング後）

スクレイピングで取得したJANコードから、自動的にASINを検索して設定します。

#### Step 3-3: JAN→ASIN自動検索関数をデプロイ

```bash
supabase functions deploy jan-to-asin-batch
```

#### Step 3-4: JAN→ASIN自動検索をスケジュール（オプション）

スクレイピング完了後に実行する場合：

```sql
-- 毎日午前1時に実行（スクレイピング完了後）
SELECT cron.schedule(
  'jan-to-asin-batch',
  '0 1 * * *',  -- 毎日午前1時
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

**または、手動実行**:
スクレイピング完了後に、手動で実行することも可能です。

### 方法B: 外部Cron（GitHub Actions、Vercel Cron、など）

GitHub Actionsの例（6時間ごと）：

`.github/workflows/keepa-update.yml`:
```yaml
name: Keepa Batch Update

on:
  schedule:
    - cron: '0 */6 * * *'  # 6時間ごと（UTC）
  workflow_dispatch:  # 手動実行も可能

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: Call Keepa Batch Update
        run: |
          curl -X POST \
            https://fwmieqfezlagstigtrem.supabase.co/functions/v1/keepa-batch-update \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_KEY }}"
```

**Vercel Cron の例**:
`vercel.json`:
```json
{
  "crons": [{
    "path": "/api/keepa-update",
    "schedule": "0 */6 * * *"
  }]
}
```

---

## 🎨 Step 4: フロントエンドの更新

### 4-1. config.js にKeepa Function URLを追加

```javascript
const CONFIG = {
  supabase: {
    projectUrl: 'https://xxxxx.supabase.co',
    anonKey: 'your-anon-key',
    tableName: 'products_dd'
  },
  keepa: {
    functionUrl: 'https://xxxxx.supabase.co/functions/v1/keepa-fetch',
    functionKey: 'your-anon-key'  // Anon Keyで可（RLSで保護）
  }
};
```

### 4-2. 変更をコミット＆プッシュ

```bash
git add .
git commit -m "Add Keepa integration"
git push origin main
```

---

## 🧪 Step 5: テスト

### 5-1. 手動でKeepaデータを取得

Webアプリで：
1. 商品を選択
2. 「選択行のJANでASIN候補を検索」ボタンをクリック
3. Keepaデータが取得され、利益計算が表示される

### 5-2. バッチ更新をテスト

Supabaseダッシュボードで：

```sql
-- 手動でバッチ更新を実行
SELECT net.http_post(
  url := 'https://xxxxx.supabase.co/functions/v1/keepa-batch-update',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer your-service-role-key'
  )
);
```

または、ブラウザで直接アクセス：
```
https://xxxxx.supabase.co/functions/v1/keepa-batch-update
```

---

## 📊 Step 6: ダッシュボードで確認

### 統計を確認

```sql
SELECT * FROM dashboard_stats;
```

### 推奨商品を確認

```sql
SELECT * FROM recommended_products LIMIT 10;
```

---

## 🔔 Step 7: 通知設定（オプション）

### メール通知（SendGrid、Resend など）

Edge Functionを追加で作成：

`supabase/functions/send-recommendations/index.ts`:
```typescript
// 推奨商品をメール送信
// 毎日実行して、新しい推奨商品があれば通知
```

### Slack通知

Webhook URLを使用して、推奨商品をSlackに送信

---

## ✅ 完了チェックリスト

- [ ] Keepa API キーを取得
- [ ] データベーススキーマを適用
- [ ] Edge Functionsをデプロイ
- [ ] 環境変数を設定
- [ ] 定期実行を設定
- [ ] フロントエンドを更新
- [ ] テスト実行が成功
- [ ] ダッシュボードでデータ確認

---

## 🆘 トラブルシューティング

### Edge Functionがデプロイできない

```bash
# ログを確認
supabase functions logs keepa-fetch

# 再デプロイ
supabase functions deploy keepa-fetch --no-verify-jwt
```

### Keepa APIエラー

- API Keyが正しいか確認
- API使用制限を確認（Keepaダッシュボード）
- レート制限（1秒に1リクエスト）を守っているか

### データが更新されない

```sql
-- 更新ログを確認
SELECT * FROM keepa_update_logs ORDER BY updated_at DESC LIMIT 10;

-- エラーがあれば確認
SELECT * FROM keepa_update_logs WHERE status = 'failed';
```

---

## 💰 コスト見積もり

- **Keepa API**: 月額 $19〜（150リクエスト/月）
- **Supabase**: 無料プラン（500MB DB、2GB storage）
- **Edge Functions**: 無料プラン（500K invocations/月）

商品数500件、毎日更新の場合：
- Keepa API: 500件 × 30日 = 15,000リクエスト/月 → $19〜$39
- Supabase: 無料プラン内

---

## 🎯 次のステップ

完了したら、以下の機能も追加できます：

1. **通知システム**: 高利益商品を自動通知
2. **ダッシュボードUI**: 統計・グラフ表示
3. **仕入れリスト自動生成**: 推奨商品をCSV出力
4. **価格アラート**: 価格変動を監視して通知

セットアップが完了したら教えてください！

