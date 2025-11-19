# トラブルシューティング

## 「ずっとLoadingのまま」または「データが取得できない」場合

### 1. ブラウザのコンソールを確認

1. ブラウザで **F12** キーを押して開発者ツールを開く
2. **Console** タブを確認
3. エラーメッセージを確認

### 2. よくある原因と解決方法

#### ❌ `config.js が読み込まれていません`

**原因**: `config.js` ファイルが作成されていない

**解決方法**:
```bash
cp config.js.example config.js
```
その後、`config.js` を編集してSupabase情報を記入

---

#### ❌ `HTTP 404` エラー

**原因**: テーブル名が間違っているか、テーブルが存在しない

**解決方法**:
1. Supabaseダッシュボードで `products_dd` テーブルが存在するか確認
2. `config.js` の `tableName` が正しいか確認

---

#### ❌ `HTTP 401` または `HTTP 403` エラー

**原因**: Row Level Security (RLS) が有効で、匿名アクセスが許可されていない

**解決方法**:

Supabaseダッシュボードで以下のSQLを実行：

```sql
-- RLSを一時的に無効化（開発用）
ALTER TABLE products_dd DISABLE ROW LEVEL SECURITY;
ALTER TABLE products_dd_price_history DISABLE ROW LEVEL SECURITY;

-- または、匿名ユーザーに読み取り権限を付与
ALTER TABLE products_dd ENABLE ROW LEVEL SECURITY;
ALTER TABLE products_dd_price_history ENABLE ROW LEVEL SECURITY;

-- 全員に読み取りを許可
CREATE POLICY "Enable read access for all users" ON products_dd
  FOR SELECT USING (true);

CREATE POLICY "Enable read access for all users" ON products_dd_price_history
  FOR SELECT USING (true);

-- 全員に更新を許可（ASIN更新用）
CREATE POLICY "Enable update access for all users" ON products_dd
  FOR UPDATE USING (true) WITH CHECK (true);
```

---

#### ❌ `CORS` エラー

**原因**: ローカルファイル（`file://`）から開いている

**解決方法**:

ローカルサーバーを使用してください：

```bash
# Pythonの場合
cd dd-research
python3 -m http.server 8000

# Node.jsの場合
npx http-server -p 8000
```

その後、`http://localhost:8000` にアクセス

---

#### ❌ `Network Error` または接続エラー

**原因**: Supabase URLまたはキーが間違っている

**解決方法**:

1. Supabaseダッシュボードを開く
2. **Settings** → **API** を確認
3. 以下を確認：
   - **Project URL**: `https://xxxxx.supabase.co`
   - **anon/public key**: `eyJ...` で始まる長い文字列
4. `config.js` の値と一致するか確認

---

### 3. デバッグ手順

1. **config.js が正しく読み込まれているか確認**
   - ブラウザコンソールに `=== DD Research Web 初期化 ===` と表示されるか
   - `Config loaded:` の内容が正しいか

2. **ネットワークタブを確認**
   - 開発者ツールの **Network** タブを開く
   - `/rest/v1/products_dd` へのリクエストがあるか
   - ステータスコードを確認（200以外ならエラー）

3. **直接APIをテスト**
   
   ブラウザコンソールで以下を実行：
   
   ```javascript
   // 設定確認
   console.log(CONFIG);
   
   // 直接APIを叩いてテスト
   fetch(`${CONFIG.supabase.projectUrl}/rest/v1/products_dd?select=*&limit=1`, {
     headers: {
       apikey: CONFIG.supabase.anonKey,
       Authorization: `Bearer ${CONFIG.supabase.anonKey}`
     }
   })
   .then(r => r.json())
   .then(data => console.log('API Test Result:', data))
   .catch(err => console.error('API Test Error:', err));
   ```

### 4. 設定例

正しい `config.js` の例：

```javascript
const CONFIG = {
  supabase: {
    projectUrl: 'https://fwmieqfezlagstigtrem.supabase.co',  // スラッシュなし
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',      // 完全なキー
    tableName: 'products_dd'                                   // テーブル名
  },
  keepa: {
    functionUrl: '',
    functionKey: ''
  }
};
```

### 5. それでも解決しない場合

1. ブラウザのキャッシュをクリア
2. Supabaseのプロジェクトが **Paused** 状態になっていないか確認
3. Supabaseダッシュボードの **Logs** を確認

---

## よくある質問

### Q: テーブルにデータは入っているのに何も表示されない

A: ブラウザコンソールで以下を確認：
```javascript
// フィルタ状態を確認
console.log(state);
```
`asinOnly: true` になっている場合、ASINが設定されている商品のみ表示されます。チェックボックスを外してください。

### Q: ページネーションが動かない

A: `fetchPage()` がエラーなく完了しているか、コンソールログを確認してください。

### Q: CSV エクスポートが動かない

A: データが正常に取得できている状態で試してください。同じSupabase接続を使用しているため、データ取得ができていればエクスポートも動作します。

