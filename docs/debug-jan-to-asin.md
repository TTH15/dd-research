# JAN→ASIN自動検索のデバッグ手順

## 🔍 現在の状況

- ✅ 関数は実行された（リクエストID: 37）
- ❌ ASINが設定されていない（すべてNULL）

## 📋 確認手順

### Step 1: Edge Functionsのログを確認

1. Supabase Dashboard → **Edge Functions** → **jan-to-asin-batch**
2. **Logs**タブを開く
3. 最新のログを確認

**確認ポイント**:
- `[JAN to ASIN Batch] Started at` - 実行開始時刻
- `[JAN to ASIN Batch] Processing X products` - 処理対象の商品数
- `[JAN to ASIN Batch] Keepa API response:` - Keepa APIのレスポンス
- `[JAN to ASIN Batch] Found ASIN:` - ASINが見つかった場合
- `[JAN to ASIN Batch] No ASIN found` - ASINが見つからなかった場合
- `[JAN to ASIN Batch] Error` - エラーが発生した場合

---

### Step 2: Keepa APIキーの確認

```bash
cd dd-research
supabase secrets list
```

**確認ポイント**:
- `KEEPA_API_KEY`が表示されているか
- 値が正しく設定されているか

---

### Step 3: 検索対象の商品を確認

Supabase SQL Editorで以下を実行：

```sql
-- ASINがNULLでJANがある商品を確認
SELECT 
    id,
    product_name,
    brand,
    jan,
    asin
FROM products_dd
WHERE asin IS NULL 
  AND jan IS NOT NULL
LIMIT 10;
```

**確認ポイント**:
- JANコードが正しく保存されているか
- 商品名とブランドが保存されているか

---

## 🐛 よくある問題と解決方法

### 問題1: Keepa APIキーが設定されていない

**症状**:
- ログに`KEEPA_API_KEY is not set`などのエラー

**解決方法**:
```bash
cd dd-research
supabase secrets set KEEPA_API_KEY=your_keepa_api_key
```

---

### 問題2: Keepa APIでASINが見つからない

**症状**:
- ログに`[JAN to ASIN Batch] No ASIN found for JAN: ...`
- Keepa APIのレスポンスに`asinList`が空

**原因**:
- Keepa APIのSearch APIはJANコードを直接検索できない可能性がある
- 商品名+ブランドでの検索も失敗している

**解決方法**:
- Keepa APIのSearch APIの仕様を確認
- 商品名+ブランドでの検索を改善
- 手動でASINを設定する

---

### 問題3: 関数がエラーで終了している

**症状**:
- ログに`[JAN to ASIN Batch] Fatal error:`が表示される

**解決方法**:
- エラーメッセージを確認
- 関数のコードを確認して修正

---

## 💡 次のアクション

1. **まずログを確認** → 原因を特定
2. **Keepa APIキーを確認** → 設定されていない場合は設定
3. **検索対象の商品を確認** → JANコードが正しく保存されているか確認

ログの内容を共有していただければ、具体的な解決方法を提案します。

