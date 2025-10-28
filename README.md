# DD Research Web

Supabase RESTを使用したDD（d-online）商品データのリサーチWebアプリケーション。

## 機能

- 商品データの検索・フィルタリング
- 価格履歴の表示（Chart.js）
- ASIN管理
- Keepa連携（JAN→ASIN候補検索）
- CSV エクスポート
- フィルタプリセット保存

## セットアップ

### 1. 設定ファイルの作成

`config.js.example` をコピーして `config.js` を作成します：

```bash
cp config.js.example config.js
```

### 2. Supabase設定の記入

`config.js` を開いて、実際の値を設定してください：

```javascript
const CONFIG = {
  supabase: {
    projectUrl: 'https://your-project.supabase.co',
    anonKey: 'your-actual-anon-key',
    tableName: 'products_dd'
  },
  keepa: {
    functionUrl: '',  // 任意
    functionKey: ''   // 任意
  }
};
```

### 3. アプリケーションの起動

ローカルサーバーで起動してください：

```bash
# Pythonの場合
python3 -m http.server 8000

# Node.jsの場合
npx http-server -p 8000
```

ブラウザで `http://localhost:8000` にアクセスします。

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

## 注意事項

- `config.js` にはSupabaseの認証情報が含まれるため、**絶対にGitにコミットしないでください**
- `.gitignore` に `config.js` が含まれていることを確認してください
- Anon Keyは公開されても問題ないキーですが、Row Level Security (RLS) を適切に設定してください

## ライセンス

Private Use

