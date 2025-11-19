// スコアリングロジック（美容系向け）
// ブランド、容量、タイトル類似度からスコアを算出

/**
 * タイトルを正規化（全角→半角、小文字化、記号削除など）
 */
export function normalizeTitle(title: string): string {
  if (!title) return ''
  
  return title
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xFEE0)) // 全角→半角
    .toLowerCase()
    .replace(/[()\-/・、。，]/g, ' ') // 記号削除
    .replace(/\s+/g, ' ') // 連続スペース→1スペース
    .trim()
}

/**
 * 容量情報を抽出（ml, g, 枚など）
 */
export function extractSize(text: string): string | null {
  if (!text) return null
  
  const match = text.match(/(\d+)\s*(ml|g|枚|個|本|片|パック)/i)
  return match ? `${match[1]}${match[2].toLowerCase()}` : null
}

/**
 * ブランド名の一致度を計算
 */
export function calculateBrandScore(ddBrand: string | null, keepaBrand: string | null): number {
  if (!ddBrand || !keepaBrand) return 0
  
  const ddNormalized = normalizeTitle(ddBrand)
  const keepaNormalized = normalizeTitle(keepaBrand)
  
  // 完全一致
  if (ddNormalized === keepaNormalized) return 50
  
  // 部分一致（DDブランドがKeepaブランドに含まれる、またはその逆）
  if (ddNormalized.includes(keepaNormalized) || keepaNormalized.includes(ddNormalized)) {
    return 30
  }
  
  return 0
}

/**
 * 容量の一致度を計算
 */
export function calculateSizeScore(ddSize: string | null, keepaSize: string | null): number {
  if (!ddSize || !keepaSize) return 0
  
  // 正規化して比較
  const ddNormalized = ddSize.toLowerCase().trim()
  const keepaNormalized = keepaSize.toLowerCase().trim()
  
  if (ddNormalized === keepaNormalized) return 30
  
  return 0
}

/**
 * タイトルの類似度を計算（簡易版Levenshtein距離ベース）
 */
export function calculateTitleSimilarity(ddTitle: string, keepaTitle: string): number {
  if (!ddTitle || !keepaTitle) return 0
  
  const ddNormalized = normalizeTitle(ddTitle)
  const keepaNormalized = normalizeTitle(keepaTitle)
  
  if (ddNormalized === keepaNormalized) return 20
  
  // 簡易的な類似度計算（共通単語の割合）
  const ddWords = new Set(ddNormalized.split(' ').filter(w => w.length > 2))
  const keepaWords = new Set(keepaNormalized.split(' ').filter(w => w.length > 2))
  
  if (ddWords.size === 0 || keepaWords.size === 0) return 0
  
  let commonWords = 0
  for (const word of ddWords) {
    if (keepaWords.has(word)) commonWords++
  }
  
  const similarity = (commonWords * 2) / (ddWords.size + keepaWords.size)
  return Math.round(similarity * 20) // 最大20点
}

/**
 * カテゴリがBeauty系かどうかを判定
 */
export function isBeautyCategory(category: string | null): boolean {
  if (!category) return false
  
  const beautyKeywords = ['beauty', '美容', 'スキンケア', 'コスメ', '化粧品', 'ヘアケア', 'ボディケア']
  const categoryLower = category.toLowerCase()
  
  return beautyKeywords.some(keyword => categoryLower.includes(keyword.toLowerCase()))
}

/**
 * 総合スコアを計算（0-100点）
 */
export function calculateTotalScore(params: {
  ddBrand: string | null
  ddTitle: string
  ddSize: string | null
  keepaBrand: string | null
  keepaTitle: string
  keepaSize: string | null
  keepaCategory: string | null
}): number {
  const { ddBrand, ddTitle, ddSize, keepaBrand, keepaTitle, keepaSize, keepaCategory } = params
  
  let score = 0
  
  // ブランドスコア（最大50点）
  score += calculateBrandScore(ddBrand, keepaBrand)
  
  // 容量スコア（最大30点）
  score += calculateSizeScore(ddSize, keepaSize)
  
  // タイトル類似度（最大20点）
  score += calculateTitleSimilarity(ddTitle, keepaTitle)
  
  // カテゴリボーナス（最大10点）
  if (isBeautyCategory(keepaCategory)) {
    score += 10
  }
  
  // 100点に正規化（最大140点なので）
  return Math.min(100, score)
}

