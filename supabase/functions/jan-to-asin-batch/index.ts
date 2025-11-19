// Supabase Edge Function: JAN to ASIN Batch Search
// Deploy: supabase functions deploy jan-to-asin-batch
// 
// JANコードからASINを自動検索して更新するバッチ処理
// スクレイピング完了後に実行して、ASINを自動設定

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const KEEPA_API_KEY = Deno.env.get('KEEPA_API_KEY') || ''

serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    console.log('[JAN to ASIN Batch] Started at', new Date().toISOString())
    
    // ASINがなく、JANがある商品を取得
    // jan_search_statusが'pending'（null含む）または'api_error'（リトライ対象）のみ取得
    // 1分に1件ずつ処理するため、1件のみ取得
    const { data: products, error: productsError } = await supabase
      .from('products_dd')
      .select('id, jan, product_name, brand, jan_search_status, jan_search_failure_count')
      .is('asin', null)
      .not('jan', 'is', null)
      .or('jan_search_status.is.null,jan_search_status.eq.pending,jan_search_status.eq.api_error') // null, pending, api_errorのみ
      .order('updated_at', { ascending: true }) // 古いものから順に処理
      .limit(1) // 1分に1件ずつ処理
    
    if (productsError) {
      throw new Error(`Failed to fetch products: ${productsError.message}`)
    }
    
    if (!products || products.length === 0) {
      console.log('[JAN to ASIN Batch] No products to process')
      return new Response(
        JSON.stringify({ 
          message: 'No products to process',
          total: 0,
          updated: 0
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }
    
    // 取得した商品の一覧をログに出力（デバッグ用）
    const productJans = products.map(p => `${p.jan} (id: ${p.id}, status: ${p.jan_search_status || 'null'})`).join(', ')
    console.log(`[JAN to ASIN Batch] Fetched ${products.length} products: ${productJans}`)
    console.log(`[JAN to ASIN Batch] Processing ${products.length} products`)
    
    let successCount = 0
    let failedCount = 0
    const results = []
    
    // Keepa APIでJANからASINを検索
    for (const product of products) {
      try {
        if (!product.jan) continue
        
        console.log(`[JAN to ASIN Batch] Searching ASIN for JAN: ${product.jan}`)
        
        // Keepa Product APIでJANコードから直接商品情報を取得
        // 正しいエンドポイント: /product?domain=5&code=JAN_CODE
        const productUrl = `https://api.keepa.com/product?key=${KEEPA_API_KEY}&domain=5&code=${product.jan}`
        console.log(`[JAN to ASIN Batch] Fetching product from Keepa API: ${productUrl}`)
        
        const productResponse = await fetch(productUrl)
        
        if (!productResponse.ok) {
          const errorText = await productResponse.text()
          
          // 500系エラー（内部サーバーエラー）の場合
          if (productResponse.status >= 500) {
            const errorMessage = `Keepa API internal error (${productResponse.status}): ${errorText}`
            console.error(`[JAN to ASIN Batch] Keepa error (internalServerError) for JAN: ${product.jan} - ${errorMessage}`)
            
            // 失敗回数をインクリメント
            const newFailureCount = (product.jan_search_failure_count || 0) + 1
            const newStatus = newFailureCount >= 3 ? 'manual_review' : 'api_error'
            
            // データベースを更新（一時的失敗としてマーク）
            const now = new Date().toISOString()
            const { error: updateError } = await supabase
              .from('products_dd')
              .update({
                jan_search_status: newStatus,
                jan_search_failure_count: newFailureCount,
                jan_search_last_error: errorMessage,
                jan_search_last_attempt_at: now,
                updated_at: now,
                last_seen: now
              })
              .eq('id', product.id)
            
            if (updateError) {
              console.error(`[JAN to ASIN Batch] Failed to update DB status for JAN ${product.jan}:`, updateError.message)
              // DB更新失敗でも処理は続行（次回リトライされる）
            } else {
              console.log(`[JAN to ASIN Batch] Updated DB: JAN ${product.jan} -> status=${newStatus}, failure_count=${newFailureCount}`)
            }
            
            if (newStatus === 'manual_review') {
              console.log(`[JAN to ASIN Batch] JAN ${product.jan} marked as manual_review after ${newFailureCount} consecutive failures`)
            }
            
            failedCount++
            results.push({
              product_id: product.id,
              jan: product.jan,
              status: 'api_error',
              error: errorMessage,
              failure_count: newFailureCount
            })
            continue
          }
          
          // 429エラー（レート制限）の場合、refillInの時間だけ待機して再試行
          if (productResponse.status === 429) {
            try {
              const errorData = JSON.parse(errorText)
              const refillIn = errorData.refillIn || 60000 // デフォルト60秒
              console.log(`[JAN to ASIN Batch] Rate limit hit. Waiting ${refillIn}ms before retry...`)
              await new Promise(resolve => setTimeout(resolve, refillIn))
              
              // 再試行
              console.log(`[JAN to ASIN Batch] Retrying after rate limit wait...`)
              const retryResponse = await fetch(productUrl)
              
              if (!retryResponse.ok) {
                const retryErrorText = await retryResponse.text()
                const errorMessage = `Keepa API error after retry: ${retryResponse.status} - ${retryErrorText}`
                console.error(`[JAN to ASIN Batch] Keepa error (after retry) for JAN: ${product.jan} - ${errorMessage}`)
                
                // 失敗回数をインクリメント
                const newFailureCount = (product.jan_search_failure_count || 0) + 1
                const newStatus = newFailureCount >= 3 ? 'manual_review' : 'api_error'
                
                // データベースを更新
                const now = new Date().toISOString()
                const { error: updateError } = await supabase
                  .from('products_dd')
                  .update({
                    jan_search_status: newStatus,
                    jan_search_failure_count: newFailureCount,
                    jan_search_last_error: errorMessage,
                    jan_search_last_attempt_at: now,
                    updated_at: now,
                    last_seen: now
                  })
                  .eq('id', product.id)
                
                if (updateError) {
                  console.error(`[JAN to ASIN Batch] Failed to update DB status for JAN ${product.jan}:`, updateError.message)
                } else {
                  console.log(`[JAN to ASIN Batch] Updated DB: JAN ${product.jan} -> status=${newStatus}, failure_count=${newFailureCount}`)
                }
                
                failedCount++
                results.push({
                  product_id: product.id,
                  jan: product.jan,
                  status: 'api_error',
                  error: errorMessage,
                  failure_count: newFailureCount
                })
                continue
              }
              
              // 再試行成功 - レスポンスを処理
              const productData = await retryResponse.json()
              console.log(`[JAN to ASIN Batch] Keepa API response (after retry):`, JSON.stringify(productData).slice(0, 500))
              
              // 商品情報を処理
              if (!productData.products || productData.products.length === 0) {
                // Keepaに商品が存在しない（永久NG）
                console.log(`[JAN to ASIN Batch] No product in Keepa DB for JAN: ${product.jan}`)
                
                // データベースを更新（not_foundとしてマーク、リトライしない）
                const now = new Date().toISOString()
                const { error: updateError } = await supabase
                  .from('products_dd')
                  .update({
                    jan_search_status: 'not_found',
                    jan_search_last_error: 'No product found in Keepa database',
                    jan_search_last_attempt_at: now,
                    updated_at: now,
                    last_seen: now
                  })
                  .eq('id', product.id)
                
                if (updateError) {
                  console.error(`[JAN to ASIN Batch] Failed to update DB status to 'not_found' for JAN ${product.jan}:`, updateError.message)
                  // DB更新失敗は致命的（次回も同じJANが取得される）
                  throw new Error(`Failed to mark JAN ${product.jan} as not_found: ${updateError.message}`)
                } else {
                  console.log(`[JAN to ASIN Batch] Updated DB: JAN ${product.jan} -> status=not_found (will not retry)`)
                }
                
                failedCount++
                results.push({
                  product_id: product.id,
                  jan: product.jan,
                  status: 'not_found',
                  asin: null
                })
                continue
              }
              
              // 商品が見つかった場合の処理（後続のコードで処理）
              const keepaProduct = productData.products[0]
              const asin = keepaProduct.asin
              
              console.log(`[JAN to ASIN Batch] Found ASIN: ${asin} for JAN: ${product.jan}`)
              
              // データベースを更新（ASIN設定と検索完了マーク、Keepaレスポンス全体を保存）
              const now = new Date().toISOString()
              const { error: updateError } = await supabase
                .from('products_dd')
                .update({
                  asin: asin,
                  jan_search_status: 'success',
                  jan_search_failure_count: 0, // 成功したのでリセット
                  jan_search_last_error: null,
                  jan_search_last_attempt_at: now,
                  keepa_snapshot: productData, // Keepaレスポンス全体を保存（将来の検証用）
                  updated_at: now,
                  last_seen: now
                })
                .eq('id', product.id)
              
              if (updateError) {
                throw updateError
              }
              
              successCount++
              results.push({
                product_id: product.id,
                jan: product.jan,
                status: 'success',
                asin: asin
              })
              continue
            } catch (parseError) {
              // JSONパースエラーまたはその他のエラー
              const errorMessage = `Error parsing Keepa API response: ${parseError instanceof Error ? parseError.message : String(parseError)}`
              console.error(`[JAN to ASIN Batch] Keepa error (parseError) for JAN: ${product.jan} - ${errorMessage}`)
              
              // 失敗回数をインクリメント
              const newFailureCount = (product.jan_search_failure_count || 0) + 1
              const newStatus = newFailureCount >= 3 ? 'manual_review' : 'api_error'
              
              // データベースを更新
              const { error: updateError } = await supabase
                .from('products_dd')
                .update({
                  jan_search_status: newStatus,
                  jan_search_failure_count: newFailureCount,
                  jan_search_last_error: errorMessage,
                  jan_search_last_attempt_at: new Date().toISOString(),
                  updated_at: new Date().toISOString()
                })
                .eq('id', product.id)
              
              if (updateError) {
                console.error(`[JAN to ASIN Batch] Failed to update DB status for JAN ${product.jan}:`, updateError.message)
              } else {
                console.log(`[JAN to ASIN Batch] Updated DB: JAN ${product.jan} -> status=${newStatus}, failure_count=${newFailureCount}`)
              }
              
              failedCount++
              results.push({
                product_id: product.id,
                jan: product.jan,
                status: 'api_error',
                error: errorMessage,
                failure_count: newFailureCount
              })
              continue
            }
          } else {
            // 429以外の4xxエラー（クライアントエラー）
            const errorMessage = `Keepa API error (${productResponse.status}): ${errorText}`
            console.error(`[JAN to ASIN Batch] Keepa error (clientError) for JAN: ${product.jan} - ${errorMessage}`)
            
            // 4xxエラーも一時的失敗として扱う（ただし、400系は要確認の可能性もある）
            const newFailureCount = (product.jan_search_failure_count || 0) + 1
            const newStatus = newFailureCount >= 3 ? 'manual_review' : 'api_error'
            
            // データベースを更新
            const { error: updateError } = await supabase
              .from('products_dd')
              .update({
                jan_search_status: newStatus,
                jan_search_failure_count: newFailureCount,
                jan_search_last_error: errorMessage,
                jan_search_last_attempt_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
              })
              .eq('id', product.id)
            
            if (updateError) {
              console.error(`[JAN to ASIN Batch] Failed to update DB status for JAN ${product.jan}:`, updateError.message)
            } else {
              console.log(`[JAN to ASIN Batch] Updated DB: JAN ${product.jan} -> status=${newStatus}, failure_count=${newFailureCount}`)
            }
            
            failedCount++
            results.push({
              product_id: product.id,
              jan: product.jan,
              status: 'api_error',
              error: errorMessage,
              failure_count: newFailureCount
            })
            continue
          }
        }
        
        // 正常なレスポンス
        const productData = await productResponse.json()
        console.log(`[JAN to ASIN Batch] Keepa API response:`, JSON.stringify(productData).slice(0, 500))
        
        // 商品情報を確認
        if (!productData.products || productData.products.length === 0) {
          // Keepaに商品が存在しない（永久NG）
          console.log(`[JAN to ASIN Batch] No product in Keepa DB for JAN: ${product.jan}`)
          
          // データベースを更新（not_foundとしてマーク、リトライしない）
          const now = new Date().toISOString()
          const { error: updateError } = await supabase
            .from('products_dd')
            .update({
              jan_search_status: 'not_found',
              jan_search_last_error: 'No product found in Keepa database',
              jan_search_last_attempt_at: now,
              updated_at: now,
              last_seen: now
            })
            .eq('id', product.id)
          
          if (updateError) {
            console.error(`[JAN to ASIN Batch] Failed to update DB status to 'not_found' for JAN ${product.jan}:`, updateError.message)
            // DB更新失敗は致命的（次回も同じJANが取得される）
            throw new Error(`Failed to mark JAN ${product.jan} as not_found: ${updateError.message}`)
          } else {
            console.log(`[JAN to ASIN Batch] Updated DB: JAN ${product.jan} -> status=not_found (will not retry)`)
          }
          
          failedCount++
          results.push({
            product_id: product.id,
            jan: product.jan,
            status: 'not_found',
            asin: null
          })
          continue
        }
        
        // 商品が見つかった
        const keepaProduct = productData.products[0]
        const asin = keepaProduct.asin
        
        console.log(`[JAN to ASIN Batch] Found ASIN: ${asin} for JAN: ${product.jan}`)
        
        // データベースを更新（ASIN設定と検索完了マーク、Keepaレスポンス全体を保存）
        const now = new Date().toISOString()
        const { error: updateError } = await supabase
          .from('products_dd')
          .update({
            asin: asin,
            jan_search_status: 'success',
            jan_search_failure_count: 0, // 成功したのでリセット
            jan_search_last_error: null,
            jan_search_last_attempt_at: now,
            keepa_snapshot: productData, // Keepaレスポンス全体を保存（将来の検証用）
            updated_at: now,
            last_seen: now
          })
          .eq('id', product.id)
        
        if (updateError) {
          console.error(`[JAN to ASIN Batch] Failed to update DB with ASIN for JAN ${product.jan}:`, updateError.message)
          throw updateError
        } else {
          console.log(`[JAN to ASIN Batch] Updated DB: JAN ${product.jan} -> ASIN=${asin}, status=success`)
        }
        
        successCount++
        results.push({
          product_id: product.id,
          jan: product.jan,
          status: 'success',
          asin: asin
        })
        
        // 1分に1件ずつ処理するため、待機は不要（Cronで1分ごとに呼び出す）
        // この関数は1件のみ処理するため、待機処理は削除
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error(`[JAN to ASIN Batch] Keepa error (unexpectedError) for JAN: ${product.jan} - ${errorMessage}`)
        
        // 予期しないエラーも一時的失敗として扱う
        const newFailureCount = (product.jan_search_failure_count || 0) + 1
        const newStatus = newFailureCount >= 3 ? 'manual_review' : 'api_error'
        
        // データベースを更新
        const now = new Date().toISOString()
        const { error: updateError } = await supabase
          .from('products_dd')
          .update({
            jan_search_status: newStatus,
            jan_search_failure_count: newFailureCount,
            jan_search_last_error: errorMessage,
            jan_search_last_attempt_at: now,
            updated_at: now,
            last_seen: now
          })
          .eq('id', product.id)
        
        if (updateError) {
          console.error(`[JAN to ASIN Batch] Failed to update DB status for JAN ${product.jan}:`, updateError.message)
        } else {
          console.log(`[JAN to ASIN Batch] Updated DB: JAN ${product.jan} -> status=${newStatus}, failure_count=${newFailureCount}`)
        }
        
        failedCount++
        results.push({
          product_id: product.id,
          jan: product.jan,
          status: 'api_error',
          error: errorMessage,
          failure_count: newFailureCount
        })
      }
    }
    
    console.log(`[JAN to ASIN Batch] Completed: ${successCount} success, ${failedCount} failed`)
    
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
    console.error('[JAN to ASIN Batch] Fatal error:', errorMessage)
    
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

