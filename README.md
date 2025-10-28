# DD Research Web

Supabase RESTを使用したDD（d-online）商品データのリサーチWebアプリケーション。

## 🚀 機能

- ✅ 商品データの検索・フィルタリング
- ✅ ページネーションによる快適なデータ閲覧
- ✅ 価格履歴の表示（Chart.js）
- ✅ ASIN管理
- ✅ Keepa連携（JAN→ASIN候補検索、任意）
- ✅ CSV エクスポート
- ✅ フィルタプリセット保存

## 📋 必要要件

- ローカルWebサーバー（Python、Node.js、など）
- Supabaseプロジェクト（無料プランでOK）
- モダンブラウザ（Chrome、Firefox、Safari、Edge）

## ⚡️ クイックスタート

### 1. リポジトリをクローン

```bash
git clone https://github.com/TTH15/dd-research.git
cd dd-research
```

### 2. 設定ファイルの作成

**重要**: アプリを動作させるには、`config.js`の作成が必須です。

```bash
cp config.js.example config.js
```

### 3. Supabase設定の記入

`config.js` を開いて、実際の値を設定してください：

```javascript
const CONFIG = {
  supabase: {
    projectUrl: 'https://xxxxx.supabase.co',  // ← あなたのSupabaseプロジェクトURL
    anonKey: 'eyJhbGc...',                     // ← あなたのAnon/Public Key
    tableName: 'products_dd'                   // ← テーブル名
  },
  keepa: {
    functionUrl: '',  // 任意: Keepa Edge Function URL
    functionKey: ''   // 任意: Keepa Edge Function Secret
  }
};
```

**Supabase情報の取得方法**:
1. [supabase.com](https://supabase.com) にログイン
2. プロジェクトを選択
3. **Settings** → **API** を開く
4. **Project URL** と **anon public key** をコピー

### 4. アプリケーションの起動

ローカルサーバーで起動してください：

```bash
# Pythonの場合
python3 -m http.server 8000

# Node.jsの場合
npx http-server -p 8000
```

ブラウザで `http://localhost:8000` にアクセスします。

### 5. 動作確認

正しく設定できていれば、商品データが表示されます。

**エラーが出る場合**: `TROUBLESHOOTING.md` を参照してください。

## 必要なSupabaseテーブル

### products_dd

```sql
CREATE TABLE products_dd (
  id BIGSERIAL PRIMARY KEY,
  title TEXT,
  brand TEXT,
  jan TEXT,
  sku TEXT,
  price_list INTEGER,
  product_url TEXT,
  image_url TEXT,
  scraped_at TIMESTAMP,
  asin TEXT,
  updated_at TIMESTAMP
);
```

### products_dd_price_history

```sql
CREATE TABLE products_dd_price_history (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT REFERENCES products_dd(id),
  price_list INTEGER,
  scraped_on TIMESTAMP
);
```

## ファイル構成

```
dd-research/
├── index.html          # メインHTML
├── styles.css          # スタイルシート
├── app.js              # アプリケーションロジック
├── config.js           # 設定ファイル（gitignore対象）
├── config.js.example   # 設定ファイルのテンプレート
├── .gitignore          # Git除外設定
└── README.md           # このファイル
```

## 🔧 トラブルシューティング

### config.jsが見つかりません

画面に「⚠️ 設定ファイルが見つかりません」と表示される場合：

1. `config.js.example` を `config.js` にコピーしたか確認
2. `config.js` が`dd-research`フォルダ直下にあるか確認
3. ページをリロード

### データが取得できない

`TROUBLESHOOTING.md` を参照してください。よくある原因：
- Supabase URLまたはキーの間違い
- Row Level Security (RLS) の設定
- テーブル名の間違い

## 🌐 公開デプロイ

このアプリを公開URLでデプロイする場合、`config.js`をGitにコミットしてもOKです。

### 公開デプロイの手順

1. **`.gitignore`の編集** - `config.js`の除外をコメントアウト

```bash
# .gitignore
# config.js  ← この行をコメントアウト
```

2. **config.jsをコミット**

```bash
git add config.js
git commit -m "Add config.js for deployment"
git push origin main
```

3. **GitHub Pages / Netlify / Vercel などでデプロイ**

デプロイ例：
- **GitHub Pages**: Settings → Pages → Source: main branch
- **Netlify**: GitHub連携で自動デプロイ
- **Vercel**: GitHub連携で自動デプロイ

## 🔒 セキュリティ注意事項

### Anon Keyは公開されても安全

- ✅ Supabaseの`Anon Key`は**公開されても問題ありません**
- ✅ これはクライアントサイドで使用するための公開キーです
- ⚠️ ただし、**Row Level Security (RLS)** を適切に設定する必要があります

### RLS設定（必須）

公開デプロイする場合は、Supabaseで以下のポリシーを設定してください：

```sql
-- 読み取りは全員許可
ALTER TABLE products_dd ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON products_dd
  FOR SELECT USING (true);

-- 更新は全員許可（ASIN更新用）※必要に応じて制限を追加
CREATE POLICY "Enable update access for all users" ON products_dd
  FOR UPDATE USING (true) WITH CHECK (true);

-- 価格履歴も読み取り許可
ALTER TABLE products_dd_price_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all users" ON products_dd_price_history
  FOR SELECT USING (true);
```

### より厳格な制限をかけたい場合

特定のIPや認証ユーザーのみアクセス可能にする場合は、RLSポリシーで制御できます

## 📝 ライセンス

Private Use

