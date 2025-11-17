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

```bash
# Keepa API Key
supabase secrets set KEEPA_API_KEY=your_keepa_api_key_here

# Supabase URL（自動設定されていなければ）
supabase secrets set SUPABASE_URL=https://xxxxx.supabase.co

# Service Role Key（Settings → API → service_role key）
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 2-4. Edge Functions をデプロイ

```bash
# Keepa データ取得関数
supabase functions deploy keepa-fetch

# バッチ更新関数
supabase functions deploy keepa-batch-update
```

### 2-5. Function URLs を取得

```bash
supabase functions list
```

以下のようなURLが表示されます：
```
keepa-fetch: https://xxxxx.supabase.co/functions/v1/keepa-fetch
keepa-batch-update: https://xxxxx.supabase.co/functions/v1/keepa-batch-update
```

### 2-6. バッチ更新関数に環境変数を追加

```bash
supabase secrets set KEEPA_FETCH_FUNCTION_URL=https://xxxxx.supabase.co/functions/v1/keepa-fetch
```

---

## 📅 Step 3: 定期実行の設定（Cron）

### 方法A: Supabase pg_cron（推奨）

Supabaseダッシュボードで SQL Editor を開き、以下を実行：

```sql
-- 毎日午前3時に実行
SELECT cron.schedule(
  'keepa-daily-update',
  '0 3 * * *',
  $$
  SELECT net.http_post(
    url := 'https://xxxxx.supabase.co/functions/v1/keepa-batch-update',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key')
    )
  );
  $$
);
```

### 方法B: 外部Cron（GitHub Actions、Vercel Cron、など）

GitHub Actionsの例：

`.github/workflows/keepa-update.yml`:
```yaml
name: Keepa Daily Update

on:
  schedule:
    - cron: '0 3 * * *'  # 毎日午前3時（UTC）
  workflow_dispatch:  # 手動実行も可能

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - name: Call Keepa Batch Update
        run: |
          curl -X POST \
            https://xxxxx.supabase.co/functions/v1/keepa-batch-update \
            -H "Authorization: Bearer ${{ secrets.SUPABASE_SERVICE_KEY }}"
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

