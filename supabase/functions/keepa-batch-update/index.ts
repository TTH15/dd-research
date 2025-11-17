// Supabase Edge Function: Keepa Batch Update (定期実行用)
// Deploy: supabase functions deploy keepa-batch-update

import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') || ''
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || ''
const KEEPA_FETCH_URL = Deno.env.get('KEEPA_FETCH_FUNCTION_URL') || ''

serve(async (req) => {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    
    // 設定取得
    const { data: settings } = await supabase
      .from('auto_update_settings')
      .select('setting_name, setting_value')
    
    const autoUpdateEnabled = settings?.find(s => s.setting_name === 'auto_update_enabled')?.setting_value === 'true'
    
    if (!autoUpdateEnabled) {
      return new Response(
        JSON.stringify({ message: 'Auto update is disabled' }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }
    
    const updateIntervalHours = parseInt(
      settings?.find(s => s.setting_name === 'update_interval_hours')?.setting_value || '24'
    )
    
    // 更新が必要な商品を取得（ASINがあって、更新が古い商品）
    const { data: products } = await supabase
      .from('products_dd')
      .select('id, asin, jan')
      .not('asin', 'is', null)
      .or(`keepa_updated_at.is.null,keepa_updated_at.lt.${new Date(Date.now() - updateIntervalHours * 60 * 60 * 1000).toISOString()}`)
      .limit(50) // 一度に50件まで
    
    if (!products || products.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No products to update' }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }
    
    const results = []
    
    // 各商品を更新（レート制限に注意）
    for (const product of products) {
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
          })
        })
        
        const result = await response.json()
        results.push({
          product_id: product.id,
          status: result.success ? 'success' : 'failed',
          error: result.error
        })
        
        // Keepa APIレート制限対策（1秒待機）
        await new Promise(resolve => setTimeout(resolve, 1000))
        
      } catch (error) {
        results.push({
          product_id: product.id,
          status: 'failed',
          error: error.message
        })
      }
    }
    
    const successCount = results.filter(r => r.status === 'success').length
    const failedCount = results.filter(r => r.status === 'failed').length
    
    return new Response(
      JSON.stringify({
        success: true,
        updated: successCount,
        failed: failedCount,
        total: products.length,
        results
      }),
      { headers: { 'Content-Type': 'application/json' } }
    )
    
  } catch (error) {
    console.error('Batch update error:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      { 
        status: 500,
        headers: { 'Content-Type': 'application/json' }
      }
    )
  }
})

