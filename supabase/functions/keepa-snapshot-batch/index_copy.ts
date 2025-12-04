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
const BATCH_SIZE = parseInt(Deno.env.get('KEEPA_BATCH_SIZE') || '1') // デフォルト1件ずつ処理
const MAX_FAILURES_BEFORE_TIMEOUT = parseInt(Deno.env.get('KEEPA_MAX_FAILURES') || '3')
const TIMEOUT_BACKOFF_MINUTES = parseInt(Deno.env.get('KEEPA_TIMEOUT_MINUTES') || '360') // デフォルト6時間
const GENERIC_BACKOFF_MINUTES = parseInt(Deno.env.get('KEEPA_BACKOFF_MINUTES') || '30')
const CANDIDATE_FETCH_MULTIPLIER = parseInt(Deno.env.get('KEEPA_CANDIDATE_MULTIPLIER') || '5')

serve(async (req) => {
    try {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

        console.log('[Keepa Snapshot Batch] Started at', new Date().toISOString())

        const candidateLimit = BATCH_SIZE * CANDIDATE_FETCH_MULTIPLIER

        // カラムが存在しない場合のエラーハンドリング
        let candidates: any[] = []
        let productsError: any = null

        try {
            // 最近試行した商品（過去5分以内）は除外してタイムアウト無限ループを防ぐ
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString()

            const result = await supabase
                .from('products_dd')
                .select('id, asin, jan, product_name, keepa_status, keepa_failure_count, keepa_skip_until, keepa_last_attempt_at')
                .not('asin', 'is', null)
                .eq('jan_search_status', 'success')
                .or(`keepa_last_attempt_at.is.null,keepa_last_attempt_at.lt.${fiveMinutesAgo}`)
                .order('keepa_last_attempt_at', { ascending: true, nullsFirst: true })
                .limit(candidateLimit)

            candidates = result.data || []
            productsError = result.error
        } catch (err: any) {
            // カラムが存在しない場合のエラーをキャッチ
            if (err?.message?.includes('keepa_status') || err?.message?.includes('does not exist')) {
                const errorMsg = `Required columns are missing. Please run the SQL migration:\n` +
                    `database/add_keepa_status_columns.sql\n\n` +
                    `Error: ${err.message}`
                throw new Error(errorMsg)
            }
            throw err
        }

        if (productsError) {
            // カラムが存在しない場合のエラーメッセージを改善
            if (productsError.message?.includes('keepa_status') || productsError.message?.includes('does not exist')) {
                throw new Error(
                    `Required columns are missing. Please run the SQL migration:\n` +
                    `database/add_keepa_status_columns.sql\n\n` +
                    `Original error: ${productsError.message}`
                )
            }
            throw new Error(`Failed to fetch products: ${productsError.message}`)
        }

        const now = Date.now()
        const eligibleProducts = (candidates || []).filter(product => {
            const status = product.keepa_status || 'pending'
            const skipUntil = product.keepa_skip_until ? new Date(product.keepa_skip_until).getTime() : null
            if (skipUntil && skipUntil > now) {
                return false
            }
            if (status === 'timeout' && (!skipUntil || skipUntil > now)) {
                return false
            }
            return true
        }).slice(0, BATCH_SIZE)

        if (!eligibleProducts || eligibleProducts.length === 0) {
            console.log('[Keepa Snapshot Batch] No eligible products to process (all pending items may be on cooldown)')
            return new Response(
                JSON.stringify({
                    message: 'No eligible products to process',
                    total: 0,
                    updated: 0
                }),
                { headers: { 'Content-Type': 'application/json' } }
            )
        }

        const productAsins = eligibleProducts.map(p => `${p.asin} (id: ${p.id}, jan: ${p.jan})`).join(', ')
        console.log(`[Keepa Snapshot Batch] Fetched ${eligibleProducts.length} products: ${productAsins}`)

        let successCount = 0
        let failedCount = 0
        const results = []

        // Keepa APIでASINから商品情報を取得
        for (const product of eligibleProducts) {
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

                                await markKeepaFailure(product, supabase, errorMessage, { forceTimeout: isTimeoutError(errorMessage) })
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

                            await markKeepaFailure(product, supabase, errorMessage)
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

                        await markKeepaFailure(product, supabase, errorMessage, { forceTimeout: isTimeoutError(errorMessage) })
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
                await markKeepaSuccess(product, supabase)

                successCount++
                results.push({
                    product_id: product.id,
                    asin: product.asin,
                    status: 'success'
                })

            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error)
                console.error(`[Keepa Snapshot Batch] Unexpected error for ASIN: ${product.asin} - ${errorMessage}`)

                await markKeepaFailure(product, supabase, errorMessage, { forceTimeout: isTimeoutError(errorMessage) })
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
                total: eligibleProducts.length,
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

    // Keepaの価格データは特殊な形式
    // csv配列は [timestamp, price, timestamp, price, ...] の形式
    // timestamp: Keepa Time Minutes（2011/1/1 0:00からの経過分）
    // price: -1は未設定、それ以外は実際の価格（円単位、そのまま使用）
    const parsePrice = (value: number | null | undefined): number | null => {
        if (value === -1 || value === null || value === undefined) return null
        // 日本（domain=5）の場合、価格は既に円単位で保存されているのでそのまま返す
        return Math.round(value)
    }

    // CSV配列から最新の価格を取得
    // Keepa APIのcsv配列は [timestamp, price, timestamp, price, ...] の形式
    // 奇数インデックス（1, 3, 5, ...）が価格データ
    const getLatestPrice = (csvArray: number[] | null | undefined): number | null => {
        if (!csvArray || csvArray.length === 0) return null

        // 配列を後ろから見て、価格データ（奇数インデックス）で-1以外の値を探す
        for (let i = csvArray.length - 1; i >= 0; i--) {
            // 奇数インデックスが価格データ
            if (i % 2 === 1) {
                const price = csvArray[i]
                if (price !== -1 && price !== null && price !== undefined) {
                    return price
                }
            }
        }
        return null
    }

    // デバッグ用：raw_jsonから実際の価格データを確認
    const csv0 = keepaProduct.csv?.[0]
    const csv1 = keepaProduct.csv?.[1]
    const csv18 = keepaProduct.csv?.[18]

    // より詳細なデバッグ情報を出力
    console.log(`[Keepa Snapshot Batch] Price data for ASIN ${product.asin}:`)
    if (csv0 && csv0.length > 0) {
        const csv0Latest = getLatestPrice(csv0)
        console.log(`  csv[0] (Amazon): array_length=${csv0.length}, latest_price=${csv0Latest}, parsed=${parsePrice(csv0Latest)}`)
        const last10 = csv0.slice(-10)
        console.log(`  csv[0] last 10 values: ${last10.join(', ')}`)
    }
    if (csv1 && csv1.length > 0) {
        const csv1Latest = getLatestPrice(csv1)
        console.log(`  csv[1] (New): array_length=${csv1.length}, latest_price=${csv1Latest}, parsed=${parsePrice(csv1Latest)}`)
        const last10 = csv1.slice(-10)
        console.log(`  csv[1] last 10 values: ${last10.join(', ')}`)
    }
    if (csv18 && csv18.length > 0) {
        const csv18Latest = getLatestPrice(csv18)
        console.log(`  csv[18] (Buy Box): array_length=${csv18.length}, latest_price=${csv18Latest}, parsed=${parsePrice(csv18Latest)}`)
        const last10 = csv18.slice(-10)
        console.log(`  csv[18] last 10 values: ${last10.join(', ')}`)
    }

    // 価格データの取得
    // Keepa APIのcsv配列インデックスの意味：
    // csv[0]: Amazon価格（Amazon本体の価格）
    // csv[1]: New - 新品最安値（Marketplace New）
    // csv[2]: 中古最安値（Used）
    // csv[18]: Buy Box価格（カート価格）
    const amazonPrice = parsePrice(getLatestPrice(csv0))
    const newPrice = parsePrice(getLatestPrice(csv1))
    const usedPrice = parsePrice(getLatestPrice(keepaProduct.csv?.[2]))
    const buyBoxPrice = parsePrice(getLatestPrice(csv18))

    // デバッグ：価格の選択結果をログ出力
    console.log(`[Keepa Snapshot Batch] Extracted prices for ASIN ${product.asin}:`)
    console.log(`  amazonPrice (csv[0]): ${amazonPrice}`)
    console.log(`  newPrice (csv[1]): ${newPrice}`)
    console.log(`  usedPrice (csv[2]): ${usedPrice}`)
    console.log(`  buyBoxPrice (csv[18]): ${buyBoxPrice}`)

    // ランキングデータ
    const salesRank = keepaProduct.salesRanks?.[0]?.current || null
    const salesRankDrops30 = keepaProduct.stats?.salesRankDrops30 || 0
    const salesRankDrops90 = keepaProduct.stats?.salesRankDrops90 || 0

    // 出品者数（csv[3]は出品者数、もしくはofferCountFromKeystats）
    // csv[3]も [timestamp, count, ...] 形式なのでgetLatestPriceを使う
    const offersCount = getLatestPrice(keepaProduct.csv?.[3]) || 0

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
        const message = insertError.message || 'Unknown insert error'

        // タイムアウトエラーの場合は特別な処理
        if (isTimeoutError(message)) {
            console.error(`[Keepa Snapshot Batch] ⚠️ TIMEOUT inserting snapshot for ASIN: ${product.asin}`)
            console.error(`[Keepa Snapshot Batch] ⚠️ This product will be automatically skipped due to database performance issues`)
            throw new Error(`Database timeout: ${message}`)
        }

        console.error(`[Keepa Snapshot Batch] Failed to insert snapshot for ASIN: ${product.asin} - ${message}`)
        throw new Error(message)
    }

    console.log(`[Keepa Snapshot Batch] Saved snapshot for ASIN: ${product.asin}`)

    // products_ddテーブルのkeepa_updated_atも更新（既存のカラムを活用）
    // タイムアウトエラーが発生してもスナップショットは保存されているので、エラーは無視
    try {
        const { error: updateError } = await supabase
            .from('products_dd')
            .update({
                keepa_updated_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', product.id)

        if (updateError) {
            // タイムアウトエラーは警告として扱う（データは保存されている）
            if (isTimeoutError(updateError.message)) {
                console.warn(`[Keepa Snapshot Batch] Timeout updating keepa_updated_at for product ${product.id} (data saved successfully)`)
            } else {
                console.warn(`[Keepa Snapshot Batch] Failed to update keepa_updated_at for product ${product.id}: ${updateError.message}`)
            }
        }
    } catch (err) {
        // タイムアウトでも処理を続行
        console.warn(`[Keepa Snapshot Batch] Exception updating keepa_updated_at for product ${product.id}`)
    }
}

function isTimeoutError(message: string): boolean {
    if (!message) return false
    const lowered = message.toLowerCase()
    return lowered.includes('statement timeout') || lowered.includes('timeout')
}

async function markKeepaSuccess(product: any, supabase: any) {
    const now = new Date().toISOString()

    try {
        const { error } = await supabase
            .from('products_dd')
            .update({
                keepa_status: 'success',
                keepa_failure_count: 0,
                keepa_last_error: null,
                keepa_last_attempt_at: now,
                keepa_skip_until: null
            })
            .eq('id', product.id)

        if (error) {
            // タイムアウトエラーは警告として扱う（スナップショットは保存されている）
            if (isTimeoutError(error.message)) {
                console.warn(`[Keepa Snapshot Batch] Timeout marking success for product ${product.id} (snapshot saved successfully)`)
                console.warn(`[Keepa Snapshot Batch] ⚠️ This product will be retried in the next batch. Consider manually skipping ASIN: ${product.asin}`)
                // タイムアウトした商品をスキップするため、メモリ上で最終試行時刻を更新
                // これにより次回の選択で後回しになる（完全な解決策ではないが、無限ループを軽減）
                product.keepa_last_attempt_at = now
            } else {
                console.warn(`[Keepa Snapshot Batch] Failed to mark success for product ${product.id}: ${error.message}`)
            }
        } else {
            product.keepa_status = 'success'
            product.keepa_failure_count = 0
            product.keepa_skip_until = null
        }
    } catch (err) {
        // タイムアウトでも処理を続行
        console.warn(`[Keepa Snapshot Batch] Exception marking success for product ${product.id}`)
    }
}

async function markKeepaFailure(
    product: any,
    supabase: any,
    errorMessage: string,
    options: { forceTimeout?: boolean } = {}
) {
    const now = new Date()
    const failureCount = (product.keepa_failure_count || 0) + 1
    const shouldTimeout = options.forceTimeout || failureCount >= MAX_FAILURES_BEFORE_TIMEOUT
    const backoffMinutes = shouldTimeout ? TIMEOUT_BACKOFF_MINUTES : GENERIC_BACKOFF_MINUTES
    const skipUntilDate = new Date(now.getTime() + backoffMinutes * 60 * 1000)

    try {
        const { error } = await supabase
            .from('products_dd')
            .update({
                keepa_status: shouldTimeout ? 'timeout' : 'error',
                keepa_failure_count: failureCount,
                keepa_last_error: errorMessage?.slice(0, 500) || null,
                keepa_last_attempt_at: now.toISOString(),
                keepa_skip_until: skipUntilDate.toISOString()
            })
            .eq('id', product.id)

        if (error) {
            // タイムアウトエラーの場合は詳細なログ
            if (isTimeoutError(error.message)) {
                console.warn(`[Keepa Snapshot Batch] ⚠️ TIMEOUT marking failure for product ${product.id} (ASIN: ${product.asin})`)
                console.warn(`[Keepa Snapshot Batch] ⚠️ This product cannot be updated due to database performance issues`)
                console.warn(`[Keepa Snapshot Batch] ⚠️ It will be automatically skipped for the next 5 minutes`)
            } else {
                console.warn(`[Keepa Snapshot Batch] Failed to mark failure for product ${product.id}: ${error.message}`)
            }
        } else {
            product.keepa_status = shouldTimeout ? 'timeout' : 'error'
            product.keepa_failure_count = failureCount
            product.keepa_skip_until = skipUntilDate.toISOString()
        }
    } catch (err) {
        // データベース更新が完全に失敗しても処理を続行
        console.warn(`[Keepa Snapshot Batch] Exception marking failure for product ${product.id}`)
    }
}

