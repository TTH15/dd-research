// Supabase Edge Function: Keepa Batch Update (定期実行用)
// Deploy: supabase functions deploy keepa-batch-update
// 
// 特徴:
// - 重複実行防止（ロック機能）
// - エラーハンドリング強化
// - 詳細なログ記録
// - Keepa APIレート制限対応（1 token/min = 60秒待機）

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const KEEPA_FETCH_URL = Deno.env.get('KEEPA_FETCH_FUNCTION_URL') || ''

// 実行ロック用（重複実行防止）
let isRunning = false

serve(async (req) => {
  const startTime = Date.now()
  
  // 重複実行チェック
  if (isRunning) {
    return new Response(
      JSON.stringify({ 
        success: false,
        message: 'Batch update is already running. Please wait.',
        skipped: true
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
  }
  
  isRunning = true
  
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    // 実行開始ログ
    console.log('[Batch Update] Started at', new Date().toISOString())
    
    // 設定取得
    const { data: settings, error: settingsError } = await supabase
      .from('auto_update_settings')
      .select('setting_name, setting_value')
    
    if (settingsError) {
      throw new Error(`Failed to fetch settings: ${settingsError.message}`)
    }
    
    const autoUpdateEnabled = settings?.find(s => s.setting_name === 'auto_update_enabled')?.setting_value === 'true'
    
    if (!autoUpdateEnabled) {
      console.log('[Batch Update] Auto update is disabled')
      return new Response(
        JSON.stringify({ message: 'Auto update is disabled' }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }
    
    const updateIntervalHours = parseInt(
      settings?.find(s => s.setting_name === 'update_interval_hours')?.setting_value || '6'
    )
    
    const batchSize = parseInt(
      settings?.find(s => s.setting_name === 'batch_size')?.setting_value || '50'
    )
    
    // 更新が必要な商品を取得（優先順位: 更新が古い順、推奨商品優先）
    const { data: products, error: productsError } = await supabase
      .from('products_dd')
      .select('id, asin, jan, keepa_updated_at, is_recommended')
      .not('asin', 'is', null)
      .or(`keepa_updated_at.is.null,keepa_updated_at.lt.${new Date(Date.now() - updateIntervalHours * 60 * 60 * 1000).toISOString()}`)
      .order('is_recommended', { ascending: false }) // 推奨商品を優先
      .order('keepa_updated_at', { ascending: true, nullsFirst: true }) // 古い順
      .limit(batchSize)
    
    if (productsError) {
      throw new Error(`Failed to fetch products: ${productsError.message}`)
    }
    
    if (!products || products.length === 0) {
      console.log('[Batch Update] No products to update')
      return new Response(
        JSON.stringify({ 
          message: 'No products to update',
          total: 0,
          updated: 0
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }
    
    console.log(`[Batch Update] Processing ${products.length} products`)
    
    const results = []
    let successCount = 0
    let failedCount = 0
    
    // 各商品を更新（レート制限対応: 1 token/min = 60秒待機）
    for (let i = 0; i < products.length; i++) {
      const product = products[i]
      
      try {
        console.log(`[Batch Update] Processing product ${i + 1}/${products.length}: ID ${product.id}`)
        
        const response = await fetch(KEEPA_FETCH_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`
          },
          body: JSON.stringify({
            product_id: product.id,
            asin: product.asin,
            jan: product.jan
          }),
          // タイムアウト設定（5分）
          signal: AbortSignal.timeout(300000)
        })
        
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${await response.text()}`)
        }
        
        const result = await response.json()
        
        if (result.success) {
          successCount++
          results.push({
            product_id: product.id,
            status: 'success'
          })
        } else {
          failedCount++
          results.push({
            product_id: product.id,
            status: 'failed',
            error: result.error || 'Unknown error'
          })
          
          // エラーログ記録
          await supabase
            .from('keepa_update_logs')
            .insert({
              product_id: product.id,
              status: 'failed',
              error_message: result.error || 'Unknown error'
            })
        }
        
        // Keepa APIレート制限対策（1 token/min = 60秒待機）
        // 最後の商品の場合は待機不要
        if (i < products.length - 1) {
          console.log(`[Batch Update] Waiting 60 seconds for rate limit...`)
          await new Promise(resolve => setTimeout(resolve, 60000))
        }
        
      } catch (error) {
        failedCount++
        const errorMessage = error instanceof Error ? error.message : String(error)
        console.error(`[Batch Update] Error processing product ${product.id}:`, errorMessage)
        
        results.push({
          product_id: product.id,
          status: 'failed',
          error: errorMessage
        })
        
        // エラーログ記録
        await supabase
          .from('keepa_update_logs')
          .insert({
            product_id: product.id,
            status: 'failed',
            error_message: errorMessage
          })
        
        // エラーが続く場合は中断（5回連続エラーで停止）
        if (failedCount >= 5 && successCount === 0) {
          console.error('[Batch Update] Too many consecutive errors, stopping batch')
          break
        }
      }
    }
    
    const duration = Math.round((Date.now() - startTime) / 1000)
    
    console.log(`[Batch Update] Completed: ${successCount} success, ${failedCount} failed, ${duration}s`)
    
    // 実行結果をログに記録
    await supabase
      .from('keepa_update_logs')
      .insert({
        product_id: null, // バッチ実行ログ
        status: 'success',
        api_response: {
          batch_run: true,
          total: products.length,
          success: successCount,
          failed: failedCount,
          duration_seconds: duration,
          timestamp: new Date().toISOString()
        }
      })
    
    return new Response(
      JSON.stringify({
        success: true,
        updated: successCount,
        failed: failedCount,
        total: products.length,
        duration_seconds: duration,
        results: results.slice(0, 10) // 最初の10件のみ返す（レスポンスサイズ制限）
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Batch Update] Fatal error:', errorMessage)
    
    // エラーログ記録
    try {
      const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
      await supabase
        .from('keepa_update_logs')
        .insert({
          product_id: null,
          status: 'failed',
          error_message: errorMessage
        })
    } catch (logError) {
      console.error('[Batch Update] Failed to log error:', logError)
    }
    
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
  } finally {
    isRunning = false
  }
})

