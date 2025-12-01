// Supabase Edge Function: Keepa Data Fetch & Profit Calculation
// Deploy: supabase functions deploy keepa-fetch

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

// Supabase Edge Functionsでは、これらの環境変数は自動的に利用可能
const KEEPA_API_KEY = Deno.env.get('KEEPA_API_KEY') || ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || Deno.env.get('SUPABASE_PROJECT_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''

// FBA手数料計算（簡易版）
function calculateFBAFee(category: string, price: number, weight: number): number {
  // カテゴリー別手数料率
  const categoryFees: Record<string, number> = {
    'ビューティー': 0.08,
    'ヘルスケア': 0.08,
    'ドラッグストア': 0.08,
    'default': 0.10
  }
  
  const feeRate = categoryFees[category] || categoryFees['default']
  let fee = price * feeRate
  
  // 配送料・保管料（重量ベース）
  if (weight < 1000) {
    fee += 318 // 小型・軽量
  } else if (weight < 2000) {
    fee += 434 // 標準サイズ
  } else {
    fee += 589 // 大型
  }
  
  return Math.round(fee)
}

// 推奨スコア計算
function calculateRecommendationScore(data: any): number {
  let score = 50 // ベーススコア
  
  // 利益率でスコア加算
  if (data.profit_rate > 30) score += 30
  else if (data.profit_rate > 20) score += 20
  else if (data.profit_rate > 15) score += 10
  
  // ランキングでスコア加算
  if (data.keepa_sales_rank < 10000) score += 20
  else if (data.keepa_sales_rank < 30000) score += 10
  else if (data.keepa_sales_rank < 50000) score += 5
  
  // 出品者数でスコア調整
  if (data.keepa_seller_count < 5) score += 10
  else if (data.keepa_seller_count > 20) score -= 10
  
  return Math.max(0, Math.min(100, score))
}

// Keepa APIからデータ取得
async function fetchKeepaData(asin: string): Promise<any> {
  const url = `https://api.keepa.com/product?key=${KEEPA_API_KEY}&domain=5&asin=${asin}&stats=30`
  
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`Keepa API error: ${response.status}`)
  }
  
  const data = await response.json()
  
  if (!data.products || data.products.length === 0) {
    throw new Error('Product not found in Keepa')
  }
  
  const product = data.products[0]
  
  // Keepaの価格データは特殊な形式
  // csv配列は [timestamp, price, timestamp, price, ...] の形式
  const parsePrice = (value: number) => {
    if (value === -1 || value === null || value === undefined) return null
    return Math.round(value)
  }
  
  // CSV配列から最新の価格を取得（奇数インデックスが価格データ）
  const getLatestPrice = (csvArray: number[] | null | undefined): number | null => {
    if (!csvArray || csvArray.length === 0) return null
    for (let i = csvArray.length - 1; i >= 0; i--) {
      if (i % 2 === 1) {
        const price = csvArray[i]
        if (price !== -1 && price !== null && price !== undefined) {
          return price
        }
      }
    }
    return null
  }
  
  return {
    asin: product.asin,
    amazon_price: parsePrice(getLatestPrice(product.csv[0])),
    new_price: parsePrice(getLatestPrice(product.csv[1])),
    buy_box_price: parsePrice(getLatestPrice(product.csv[18])),
    sales_rank: product.salesRanks?.[0]?.current || null,
    sales_rank_drops: product.stats?.salesRankDrops30 || 0,
    category: product.categoryTree?.[0]?.name || 'unknown',
    seller_count: getLatestPrice(product.csv[3]) || 0,
    package_weight: product.packageWeight || 0,
    package_length: product.packageLength || 0,
    package_width: product.packageWidth || 0,
    package_height: product.packageHeight || 0,
  }
}

serve(async (req) => {
  // CORS
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    const { product_id, asin, jan } = await req.json()
    
    let targetAsin = asin
    
    // ASINがない場合、JANから検索
    if (!targetAsin && jan) {
      // Amazon Product Advertising APIやKeepaのJAN検索を使用
      // 簡易実装: Keepaで検索
      const searchUrl = `https://api.keepa.com/search?key=${KEEPA_API_KEY}&domain=5&type=product&term=${jan}`
      const searchResponse = await fetch(searchUrl)
      const searchData = await searchResponse.json()
      
      if (searchData.asinList && searchData.asinList.length > 0) {
        targetAsin = searchData.asinList[0]
      }
    }
    
    if (!targetAsin) {
      throw new Error('ASIN not found')
    }
    
    // Keepaデータ取得
    const keepaData = await fetchKeepaData(targetAsin)
    
    // 商品の仕入れ価格を取得
    const { data: product } = await supabase
      .from('products_dd')
      .select('price_list')
      .eq('id', product_id)
      .single()
    
    if (!product) {
      throw new Error('Product not found in database')
    }
    
    const buyPrice = product.price_list || 0
    const sellPrice = keepaData.new_price || keepaData.amazon_price || 0
    
    // FBA手数料計算
    const fbaFee = calculateFBAFee(
      keepaData.category,
      sellPrice,
      keepaData.package_weight
    )
    
    // 配送料（概算）
    const shippingCost = 500
    
    // 利益計算
    const profitAmount = sellPrice - buyPrice - fbaFee - shippingCost
    const profitRate = buyPrice > 0 ? (profitAmount / buyPrice) * 100 : 0
    const roi = buyPrice > 0 ? (profitAmount / buyPrice) * 100 : 0
    
    // 推奨判定
    const settings = await supabase
      .from('auto_update_settings')
      .select('setting_name, setting_value')
    
    const minProfitRate = parseFloat(settings.data?.find(s => s.setting_name === 'min_profit_rate')?.setting_value || '20')
    const maxSalesRank = parseInt(settings.data?.find(s => s.setting_name === 'max_sales_rank')?.setting_value || '50000')
    const maxSellerCount = parseInt(settings.data?.find(s => s.setting_name === 'max_seller_count')?.setting_value || '10')
    
    const isRecommended = 
      profitRate >= minProfitRate &&
      keepaData.sales_rank <= maxSalesRank &&
      keepaData.seller_count <= maxSellerCount
    
    const updateData = {
      keepa_updated_at: new Date().toISOString(),
      keepa_asin: targetAsin,
      keepa_amazon_price: keepaData.amazon_price,
      keepa_new_price: keepaData.new_price,
      keepa_buy_box_price: keepaData.buy_box_price,
      keepa_sales_rank: keepaData.sales_rank,
      keepa_sales_rank_drops: keepaData.sales_rank_drops,
      keepa_category: keepaData.category,
      keepa_seller_count: keepaData.seller_count,
      keepa_package_weight: keepaData.package_weight,
      keepa_package_length: keepaData.package_length,
      keepa_package_width: keepaData.package_width,
      keepa_package_height: keepaData.package_height,
      profit_amount: profitAmount,
      profit_rate: profitRate,
      roi: roi,
      fba_fee: fbaFee,
      is_recommended: isRecommended,
      recommendation_score: calculateRecommendationScore({
        profit_rate: profitRate,
        keepa_sales_rank: keepaData.sales_rank,
        keepa_seller_count: keepaData.seller_count
      }),
      asin: targetAsin // ASINも更新
    }
    
    // データベース更新
    const { error: updateError } = await supabase
      .from('products_dd')
      .update(updateData)
      .eq('id', product_id)
    
    if (updateError) throw updateError
    
    // ログ記録
    await supabase
      .from('keepa_update_logs')
      .insert({
        product_id,
        status: 'success',
        api_response: keepaData
      })
    
    return new Response(
      JSON.stringify({
        success: true,
        data: updateData
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
    
  } catch (error) {
    console.error('Error:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { 
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

