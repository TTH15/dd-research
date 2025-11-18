// Supabase Edge Function: Keepa Continuous Update (1分ごとに1商品ずつ処理)
// Deploy: supabase functions deploy keepa-continuous-update
// 
// 特徴:
// - 1分ごとに1商品ずつ処理（レート制限に最適化）
// - 連続実行可能（Cronで1分ごとに呼び出す）
// - 重複実行防止
// - エラーハンドリング強化

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const KEEPA_FETCH_URL = Deno.env.get('KEEPA_FETCH_FUNCTION_URL') || ''

serve(async (req) => {
  const startTime = Date.now()
  
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    console.log('[Continuous Update] Started at', new Date().toISOString())
    
    // 設定取得
    const { data: settings, error: settingsError } = await supabase
      .from('auto_update_settings')
      .select('setting_name, setting_value')
    
    if (settingsError) {
      throw new Error(`Failed to fetch settings: ${settingsError.message}`)
    }
    
    const autoUpdateEnabled = settings?.find(s => s.setting_name === 'auto_update_enabled')?.setting_value === 'true'
    
    if (!autoUpdateEnabled) {
      console.log('[Continuous Update] Auto update is disabled')
      return new Response(
        JSON.stringify({ message: 'Auto update is disabled' }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }
    
    const updateIntervalHours = parseInt(
      settings?.find(s => s.setting_name === 'update_interval_hours')?.setting_value || '6'
    )
    
    // 更新が必要な商品を1件だけ取得（優先順位: 更新が古い順、推奨商品優先）
    const { data: products, error: productsError } = await supabase
      .from('products_dd')
      .select('id, asin, jan, keepa_updated_at, is_recommended')
      .not('asin', 'is', null)
      .or(`keepa_updated_at.is.null,keepa_updated_at.lt.${new Date(Date.now() - updateIntervalHours * 60 * 60 * 1000).toISOString()}`)
      .order('is_recommended', { ascending: false }) // 推奨商品を優先
      .order('keepa_updated_at', { ascending: true, nullsFirst: true }) // 古い順
      .limit(1) // 1件だけ
    
    if (productsError) {
      throw new Error(`Failed to fetch products: ${productsError.message}`)
    }
    
    if (!products || products.length === 0) {
      console.log('[Continuous Update] No products to update')
      return new Response(
        JSON.stringify({ 
          message: 'No products to update',
          total: 0,
          updated: 0
        }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }
    
    const product = products[0]
    console.log(`[Continuous Update] Processing product ID ${product.id}`)
    
    try {
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
        signal: AbortSignal.timeout(300000) // 5分タイムアウト
      })
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`)
      }
      
      const result = await response.json()
      
      if (result.success) {
        console.log(`[Continuous Update] Successfully updated product ${product.id}`)
        
        return new Response(
          JSON.stringify({
            success: true,
            updated: 1,
            product_id: product.id,
            message: 'Product updated successfully'
          }),
          { headers: { 'Content-Type': 'application/json' } }
        )
      } else {
        throw new Error(result.error || 'Unknown error')
      }
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[Continuous Update] Error processing product ${product.id}:`, errorMessage)
      
      // エラーログ記録
      await supabase
        .from('keepa_update_logs')
        .insert({
          product_id: product.id,
          status: 'failed',
          error_message: errorMessage
        })
      
      return new Response(
        JSON.stringify({
          success: false,
          product_id: product.id,
          error: errorMessage
        }),
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      )
    }
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    console.error('[Continuous Update] Fatal error:', errorMessage)
    
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

