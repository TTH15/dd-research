import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || ""
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
const KEEPA_API_KEY = Deno.env.get("KEEPA_API_KEY") || ""

// 失敗を何回まで許容するか
const MAX_FAILURE_COUNT = 3

// どうしても触りたくない JAN があればここに追加（暫定ブラックリスト）
const BLOCKED_JANS = new Set<string>([
    // "3614226743923",
])

serve(async (req) => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY)

    console.log("[JAN to ASIN Batch] Started at", new Date().toISOString())

    try {
        // 1. 対象商品の取得（1件のみ）
        const { data: products, error: productsError } = await supabase
            .from("products_dd")
            .select(
                "id, jan, product_name, brand, jan_search_status, jan_search_failure_count",
            )
            .is("asin", null)
            .not("jan", "is", null)
            .or(
                "jan_search_status.is.null,jan_search_status.eq.pending,jan_search_status.eq.api_error",
            )
            .eq("ignore", false)
            .order("updated_at", { ascending: true })
            .limit(1)

        if (productsError) {
            throw new Error(`Failed to fetch products: ${productsError.message}`)
        }

        if (!products || products.length === 0) {
            console.log("[JAN to ASIN Batch] No products to process")
            return jsonResponse({
                message: "No products to process",
                total: 0,
                updated: 0,
            })
        }

        const product = products[0]
        console.log(
            `[JAN to ASIN Batch] Fetched product: ${product.jan} (id: ${product.id}, status: ${product.jan_search_status || "null"
            })`,
        )

        // ブラックリスト JAN は即 manual_review にしてスキップ
        if (product.jan && BLOCKED_JANS.has(product.jan)) {
            await markStatus(supabase, product.id, {
                jan_search_status: "manual_review",
                jan_search_last_error: "JAN is in blocked list (manually skipped)",
            })
            console.log(
                `[JAN to ASIN Batch] Skipped blocked JAN: ${product.jan} (id: ${product.id})`,
            )

            return jsonResponse({
                success: true,
                updated: 0,
                failed: 0,
                total: 1,
                results: [
                    {
                        product_id: product.id,
                        jan: product.jan,
                        status: "manual_review",
                        asin: null,
                    },
                ],
            })
        }

        if (!product.jan) {
            console.log(
                `[JAN to ASIN Batch] Product has no JAN, skipping. id=${product.id}`,
            )
            return jsonResponse({
                success: true,
                updated: 0,
                failed: 0,
                total: 1,
            })
        }

        const result = await handleOneProduct(supabase, product)
        console.log(
            `[JAN to ASIN Batch] Completed: ${result.status} for JAN ${product.jan}`,
        )

        const successCount = result.status === "success" ? 1 : 0
        const failedCount = result.status === "success" ? 0 : 1

        return jsonResponse({
            success: true,
            updated: successCount,
            failed: failedCount,
            total: 1,
            results: [result],
        })
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error("[JAN to ASIN Batch] Fatal error:", msg)

        return new Response(
            JSON.stringify({
                success: false,
                error: msg,
            }),
            { status: 500, headers: { "Content-Type": "application/json" } },
        )
    }
})

/**
 * 1件の商品を Keepa で検索して DB を更新するメイン処理
 */
async function handleOneProduct(
    supabase: ReturnType<typeof createClient>,
    product: {
        id: number
        jan: string
        jan_search_failure_count: number | null
    },
) {
    const jan = product.jan
    const productUrl =
        `https://api.keepa.com/product?key=${KEEPA_API_KEY}&domain=5&code=${jan}`

    console.log(`[JAN to ASIN Batch] Searching ASIN for JAN: ${jan}`)
    console.log(`[JAN to ASIN Batch] Fetching product from Keepa API: ${productUrl}`)

    const response = await fetch(productUrl)

    // ---------- 4xx / 5xx / 429 エラー系 ----------
    if (!response.ok) {
        const rawText = await response.text()

        // 429（レート制限）は「その回は諦める」方針に変更
        if (response.status === 429) {
            let refillInMs = 60000
            try {
                const errorJson = JSON.parse(rawText)
                if (typeof errorJson.refillIn === "number") {
                    refillInMs = errorJson.refillIn
                }
            } catch {
                // パース失敗はデフォルト 60 秒のまま
            }

            const message =
                `Keepa API rate limited (429). refillIn=${refillInMs}ms. Skipping this run.`
            console.warn(`[JAN to ASIN Batch] ${message}`)

            // ここでは DB を触らず、次回のバッチでそのまま再挑戦させる
            return {
                product_id: product.id,
                jan,
                status: "api_error" as const,
                error: message,
            }
        }

        // 5xx / その他 4xx は失敗カウントを進める
        const errorMessage =
            `Keepa API error (${response.status}): ${rawText.slice(0, 500)}`
        console.error(
            `[JAN to ASIN Batch] Keepa error for JAN: ${jan} - ${errorMessage}`,
        )

        const newFailure = (product.jan_search_failure_count || 0) + 1
        const newStatus = newFailure >= MAX_FAILURE_COUNT
            ? "manual_review"
            : "api_error"

        await markStatus(supabase, product.id, {
            jan_search_status: newStatus,
            jan_search_failure_count: newFailure,
            jan_search_last_error: errorMessage,
        })

        return {
            product_id: product.id,
            jan,
            status: newStatus,
            error: errorMessage,
            failure_count: newFailure,
        }
    }

    // ---------- 正常レスポンス ----------
    const data = await response.json()
    console.log(
        `[JAN to ASIN Batch] Keepa API response (truncated):`,
        JSON.stringify(data).slice(0, 500),
    )

    if (!data.products || data.products.length === 0) {
        // Keepa DB に商品がない → not_found で確定
        const msg = "No product found in Keepa database"

        await markStatus(supabase, product.id, {
            jan_search_status: "not_found",
            jan_search_last_error: msg,
        })

        return {
            product_id: product.id,
            jan,
            status: "not_found" as const,
            asin: null,
        }
    }

    const keepaProduct = data.products[0]
    const asin = keepaProduct.asin as string | undefined

    if (!asin) {
        const msg = "Keepa product has no ASIN"
        const newFailure = (product.jan_search_failure_count || 0) + 1
        const newStatus = newFailure >= MAX_FAILURE_COUNT
            ? "manual_review"
            : "api_error"

        await markStatus(supabase, product.id, {
            jan_search_status: newStatus,
            jan_search_failure_count: newFailure,
            jan_search_last_error: msg,
        })

        return {
            product_id: product.id,
            jan,
            status: newStatus,
            error: msg,
            failure_count: newFailure,
        }
    }

    console.log(`[JAN to ASIN Batch] Found ASIN: ${asin} for JAN: ${jan}`)

    const now = new Date().toISOString()
    const { error: updateError } = await supabase.from("products_dd").update({
        asin,
        jan_search_status: "success",
        jan_search_failure_count: 0,
        jan_search_last_error: null,
        jan_search_last_attempt_at: now,
        keepa_snapshot: data,
        updated_at: now,
        last_seen: now,
    }).eq("id", product.id)

    if (updateError) {
        console.error(
            `[JAN to ASIN Batch] Failed to update DB with ASIN for JAN ${jan}:`,
            updateError.message,
        )
        throw new Error(updateError.message)
    }

    return {
        product_id: product.id,
        jan,
        status: "success" as const,
        asin,
    }
}

/**
 * ステータス更新の共通関数
 */
async function markStatus(
    supabase: ReturnType<typeof createClient>,
    productId: number,
    patch: Record<string, unknown>,
) {
    const now = new Date().toISOString()
    const { error } = await supabase.from("products_dd").update({
        ...patch,
        jan_search_last_attempt_at: now,
        updated_at: now,
        last_seen: now,
    }).eq("id", productId)

    if (error) {
        console.error(
            `[JAN to ASIN Batch] Failed to update status for id=${productId}:`,
            error.message,
        )
    }
}

/**
 * 共通 JSON レスポンス
 */
function jsonResponse(body: unknown, status = 200) {
    return new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
    })
}
