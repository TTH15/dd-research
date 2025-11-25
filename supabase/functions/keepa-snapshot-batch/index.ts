// Supabase Edge Function: Keepa Snapshot Batch
// Deploy: supabase functions deploy keepa-snapshot-batch
// 
// ASINが設定されている商品に対してKeepa /product APIを叩き、
// keepa_snapshotsテーブルにレコードを追加するバッチ処理

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const KEEPA_API_KEY = Deno.env.get('KEEPA_API_KEY') || ''

// バッチ処理の設定（環境変数または定数で調整可能）
const BATCH_SIZE = parseInt(Deno.env.get('KEEPA_BATCH_SIZE') || '1') // デフォルト1件ずつ処理（レート制限考慮）

serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    console.log('[Keepa Snapshot Batch] Started at', new Date().toISOString())
    
    // ASINが設定されている商品を取得（最新のスナップショットがない、または古いもの）
    // status=success かつ primary_asin（asin）が入っている商品
    const { data: products, error: productsError } = await supabase
      .from('products_dd')
      .select('id, asin, jan, product_name')
      .not('asin', 'is', null)
      .eq('jan_search_status', 'success') // JAN検索が成功している商品のみ
      .order('updated_at', { ascending: true }) // 古いものから順に処理
      .limit(BATCH_SIZE)
    
    if (productsError) {
      throw new Error(`Failed to fetch products: ${productsError.message}`)
    }
    
    if (!products || products.length === 0) {
      console.log('[Keepa Snapshot Batch] No products to process')
      return new Response(
        JSON.stringify({ 
          message: 'No products to process',
          total: 0,
          updated: 0
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }
    
    const productAsins = products.map(p => `${p.asin} (id: ${p.id}, jan: ${p.jan})`).join(', ')
    console.log(`[Keepa Snapshot Batch] Fetched ${products.length} products: ${productAsins}`)
    
    let successCount = 0
    let failedCount = 0
    const results = []
    
    // Keepa APIでASINから商品情報を取得
    for (const product of products) {
      try {
        if (!product.asin) continue
        
        console.log(`[Keepa Snapshot Batch] Fetching Keepa data for ASIN: ${product.asin}`)
        
        // Keepa Product APIでASINから商品情報を取得
        // エンドポイント: /product?domain=5&asin=ASIN&stats=30
        const productUrl = `https://api.keepa.com/product?key=${KEEPA_API_KEY}&domain=5&asin=${product.asin}&stats=30`
        console.log(`[Keepa Snapshot Batch] Fetching from Keepa API: ${productUrl}`)
        
        const productResponse = await fetch(productUrl)
        
        if (!productResponse.ok) {
          const errorText = await productResponse.text()
          
          // 429エラー（レート制限）の場合
          if (productResponse.status === 429) {
            try {
              const errorData = JSON.parse(errorText)
              const refillIn = errorData.refillIn || 60000 // デフォルト60秒
              console.log(`[Keepa Snapshot Batch] Rate limit hit. Waiting ${refillIn}ms before retry...`)
              await new Promise(resolve => setTimeout(resolve, refillIn))
              
              // 再試行
              console.log(`[Keepa Snapshot Batch] Retrying after rate limit wait...`)
              const retryResponse = await fetch(productUrl)
              
              if (!retryResponse.ok) {
                const retryErrorText = await retryResponse.text()
                const errorMessage = `Keepa API error after retry: ${retryResponse.status} - ${retryErrorText}`
                console.error(`[Keepa Snapshot Batch] Keepa error (after retry) for ASIN: ${product.asin} - ${errorMessage}`)
                
                failedCount++
                results.push({
                  product_id: product.id,
                  asin: product.asin,
                  status: 'api_error',
                  error: errorMessage
                })
                continue
              }
              
              // 再試行成功 - レスポンスを処理
              const productData = await retryResponse.json()
              await processKeepaResponse(productData, product, supabase)
              
              successCount++
              results.push({
                product_id: product.id,
                asin: product.asin,
                status: 'success'
              })
              continue
            } catch (parseError) {
              const errorMessage = `Error parsing Keepa API response: ${parseError instanceof Error ? parseError.message : String(parseError)}`
              console.error(`[Keepa Snapshot Batch] Keepa error (parseError) for ASIN: ${product.asin} - ${errorMessage}`)
              
              failedCount++
              results.push({
                product_id: product.id,
                asin: product.asin,
                status: 'api_error',
                error: errorMessage
              })
              continue
            }
          } else {
            // その他のエラー
            const errorMessage = `Keepa API error (${productResponse.status}): ${errorText}`
            console.error(`[Keepa Snapshot Batch] Keepa error for ASIN: ${product.asin} - ${errorMessage}`)
            
            failedCount++
            results.push({
              product_id: product.id,
              asin: product.asin,
              status: 'api_error',
              error: errorMessage
            })
            continue
          }
        }
        
        // 正常なレスポンス
        const productData = await productResponse.json()
        console.log(`[Keepa Snapshot Batch] Keepa API response received for ASIN: ${product.asin}`)
        
        // Keepaレスポンスを処理
        await processKeepaResponse(productData, product, supabase)
        
        successCount++
        results.push({
          product_id: product.id,
          asin: product.asin,
          status: 'success'
        })
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error(`[Keepa Snapshot Batch] Unexpected error for ASIN: ${product.asin} - ${errorMessage}`)
        
        failedCount++
        results.push({
          product_id: product.id,
          asin: product.asin,
          status: 'error',
          error: errorMessage
        })
      }
    }
    
    console.log(`[Keepa Snapshot Batch] Completed: ${successCount} success, ${failedCount} failed`)
    
    return new Response(
      JSON.stringify({
        success: true,
        updated: successCount,
        failed: failedCount,
        total: products.length,
        results: results.slice(0, 20) // 最初の20件のみ返す
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Keepa Snapshot Batch] Fatal error:', errorMessage)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: errorMessage
      }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
})

// Keepaレスポンスを処理してkeepa_snapshotsテーブルに保存
async function processKeepaResponse(productData: any, product: any, supabase: any) {
  // Keepaから products: [] が返ってきた場合
  if (!productData.products || productData.products.length === 0) {
    console.warn(`[Keepa Snapshot Batch] No product in Keepa DB for ASIN: ${product.asin}`)
    return // スキップ（ログにwarningを出すだけ）
  }
  
  const keepaProduct = productData.products[0]
  
  // Keepaの価格データは特殊な形式（-1は未設定、値は実際の価格*100）
  const parsePrice = (value: number | null | undefined): number | null => {
    if (value === -1 || value === null || value === undefined) return null
    return Math.round(value / 100) // Keepaは1/100で保存されているので100で割る
  }
  
  // CSV配列から最新の値を取得（配列の最後の要素）
  const getLatestValue = (csvArray: number[] | null | undefined): number | null => {
    if (!csvArray || csvArray.length === 0) return null
    return csvArray[csvArray.length - 1]
  }
  
  // 価格データの取得
  // csv[0]: Amazon価格
  // csv[1]: 新品FBA最安値
  // csv[18]: Buy Box価格
  const amazonPrice = parsePrice(getLatestValue(keepaProduct.csv?.[0]))
  const newPrice = parsePrice(getLatestValue(keepaProduct.csv?.[1]))
  const buyBoxPrice = parsePrice(getLatestValue(keepaProduct.csv?.[18]))
  
  // ランキングデータ
  const salesRank = keepaProduct.salesRanks?.[0]?.current || null
  const salesRankDrops30 = keepaProduct.stats?.salesRankDrops30 || 0
  const salesRankDrops90 = keepaProduct.stats?.salesRankDrops90 || 0
  
  // 出品者数（csv[3]は出品者数）
  const offersCount = getLatestValue(keepaProduct.csv?.[3]) || 0
  
  // Amazon本体がいるかどうか（buyBoxEligibleOfferCountsから判定）
  // 簡易判定：buyBoxEligibleOfferCountsのAmazonフラグを確認
  const isAmazonSeller = keepaProduct.buyBoxEligibleOfferCounts?.[0]?.isAmazon || false
  
  // 商品情報
  const title = keepaProduct.title || null
  const brand = keepaProduct.brand || null
  const category = keepaProduct.categoryTree?.[0]?.name || null
  const packageWeight = keepaProduct.packageWeight || null
  
  // keepa_snapshotsテーブルにレコードを追加
  const { error: insertError } = await supabase
    .from('keepa_snapshots')
    .insert({
      product_id: product.id,
      asin: product.asin,
      snapshot_at: new Date().toISOString(),
      raw_json: productData, // Keepa APIレスポンス全体を保存
      buy_box_price: buyBoxPrice,
      lowest_new_price: newPrice,
      sales_rank: salesRank,
      sales_rank_drops_30: salesRankDrops30,
      sales_rank_drops_90: salesRankDrops90,
      offers_count: offersCount,
      is_amazon_seller: isAmazonSeller,
      title: title,
      brand: brand,
      category: category,
      package_weight: packageWeight
    })
  
  if (insertError) {
    console.error(`[Keepa Snapshot Batch] Failed to insert snapshot for ASIN: ${product.asin} - ${insertError.message}`)
    throw insertError
  }
  
  console.log(`[Keepa Snapshot Batch] Saved snapshot for ASIN: ${product.asin}`)
  
  // products_ddテーブルのkeepa_updated_atも更新（既存のカラムを活用）
  const { error: updateError } = await supabase
    .from('products_dd')
    .update({
      keepa_updated_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', product.id)
  
  if (updateError) {
    console.warn(`[Keepa Snapshot Batch] Failed to update keepa_updated_at for product ${product.id}: ${updateError.message}`)
    // エラーでも処理は続行（スナップショットは保存済み）
  }
}

