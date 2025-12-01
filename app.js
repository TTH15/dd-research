/* =========================
   設定管理
========================= */
// config.js から設定を読み込む
function getConfig() {
    if (typeof CONFIG === 'undefined') {
        console.error('CONFIG が見つかりません。config.js を作成してください。');
        return null;
    }
    return CONFIG;
}

/* =========================
   UI状態
========================= */
const els = {
    q: document.getElementById('q'),
    brand: document.getElementById('brand'),
    priceMax: document.getElementById('priceMax'),
    pageSize: document.getElementById('pageSize'),
    asinOnly: document.getElementById('asinOnly'),
    candidateOnly: document.getElementById('candidateOnly'),
    keepaAnalyzedOnly: document.getElementById('keepaAnalyzedOnly'),
    minGrossProfit: document.getElementById('minGrossProfit'),
    minGrossMargin: document.getElementById('minGrossMargin'),
    tbody: document.getElementById('tbody'),
    pageInfo: document.getElementById('pageInfo'),
    status: document.getElementById('status'),
    selInfo: document.getElementById('selInfo'),
    selAll: document.getElementById('selAll'),
};

let state = {
    page: 1,
    pageSize: Number(localStorage.getItem('ddweb_pageSize') || 50),
    q: '',
    brand: '',
    priceMax: '',
    asinOnly: false,
    candidateOnly: false,
    keepaAnalyzedOnly: false,
    minGrossProfit: '',
    minGrossMargin: '',
    sortBy: 'recommendation_score', // デフォルトは推奨度スコア
    sortOrder: 'desc' // デフォルトは降順
};

els.pageSize.value = state.pageSize;
els.asinOnly.checked = state.asinOnly;
els.candidateOnly.checked = state.candidateOnly;
els.keepaAnalyzedOnly.checked = state.keepaAnalyzedOnly;
els.minGrossProfit.value = state.minGrossProfit;
els.minGrossMargin.value = state.minGrossMargin;

/* =========================
   Supabase REST util
========================= */
function supa() {
    const cfg = getConfig();
    if (!cfg || !cfg.supabase) {
        throw new Error('Supabase設定が見つかりません');
    }
    return {
        url: cfg.supabase.projectUrl,
        key: cfg.supabase.anonKey,
        table: cfg.supabase.tableName || 'products_dd'
    };
}

async function sbFetch(path, opts = {}) {
    const { url, key } = supa();
    if (!url || !key) {
        status('Supabase未設定', true);
        throw new Error('supabase not configured');
    }

    console.log('sbFetch:', {
        url: url,
        path: path,
        hasKey: !!key,
        keyPrefix: key?.substring(0, 20) + '...'
    });

    const headers = {
        'apikey': key,
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        ...(opts.headers || {})
    };

    console.log('Request headers:', Object.keys(headers));

    const r = await fetch(`${url}${path}`, {
        ...opts,
        headers: headers
    });

    console.log('Response status:', r.status);

    if (!r.ok) {
        const txt = await r.text().catch(() => '');
        console.error('Response error:', txt);
        throw new Error(`HTTP ${r.status} ${txt}`);
    }
    return r;
}

/* =========================
   ダッシュボード統計
========================= */
async function fetchDashboardStats() {
    try {
        const viewName = 'product_profit_view';
        
        // 統計データを取得
        const r = await sbFetch(`/rest/v1/${viewName}?select=*`, {
            headers: { Prefer: 'count=exact' }
        });
        
        const total = Number(r.headers.get('content-range')?.split('/')?.[1] || 0);
        const rows = await r.json();
        
        // 候補商品数
        const candidates = rows.filter(x => x.is_candidate).length;
        
        // Keepa分析済み商品数
        const analyzed = rows.filter(x => x.is_keepa_analyzed).length;
        
        // 平均粗利率（候補商品のみ）
        const candidateRows = rows.filter(x => x.is_candidate && x.gross_margin_pct != null);
        const avgMargin = candidateRows.length > 0
            ? candidateRows.reduce((sum, x) => sum + x.gross_margin_pct, 0) / candidateRows.length
            : 0;
        
        // 月間粗利見込み（候補商品のみ）
        const monthlyProfit = candidateRows
            .reduce((sum, x) => sum + (x.monthly_gross_profit || 0), 0);
        
        // 表示
        document.getElementById('statTotal').textContent = `${total.toLocaleString()} (分析済: ${analyzed})`;
        document.getElementById('statCandidates').textContent = candidates.toLocaleString();
        document.getElementById('statAvgMargin').textContent = avgMargin > 0 ? `${avgMargin.toFixed(1)}%` : '-';
        document.getElementById('statMonthlyProfit').textContent = monthlyProfit > 0 
            ? `¥${new Intl.NumberFormat('ja-JP').format(Math.round(monthlyProfit))}`
            : '-';
        
    } catch (error) {
        console.error('ダッシュボード統計エラー:', error);
        // エラー時は基本統計のみ表示
        document.getElementById('statTotal').textContent = '-';
        document.getElementById('statCandidates').textContent = '-';
        document.getElementById('statAvgMargin').textContent = '-';
        document.getElementById('statMonthlyProfit').textContent = '-';
    }
}

/* =========================
   データ取得＆描画
========================= */
async function fetchPage() {
    try {
        const { table } = supa();
        els.status.textContent = 'Loading...';
        const from = (state.page - 1) * state.pageSize;

        const p = new URLSearchParams();
        p.set('select', '*');
        
        // ソート設定（推奨度スコア順）
        const sortColumn = state.sortBy || 'recommendation_score';
        const sortOrder = state.sortOrder || 'desc';
        p.set('order', `${sortColumn}.${sortOrder}.nullslast`);
        
        p.set('limit', state.pageSize);
        p.set('offset', from);

        // 検索フィルタ（ASIN検索も追加）
        // PostgRESTの構文: or=(condition1,condition2) でOR検索
        // 複数のorパラメータはAND条件として結合される
        
        // 検索クエリ（複数カラムでのOR検索）
        if (state.q) {
            const q = encodeURIComponent(state.q);
            const searchConditions = [
                `product_name.ilike.*${q}*`,
                `title.ilike.*${q}*`,
                `name.ilike.*${q}*`,
                `jan.ilike.*${q}*`,
                `jan_code.ilike.*${q}*`,
                `sku.ilike.*${q}*`,
                `sku_code.ilike.*${q}*`,
                `brand.ilike.*${q}*`,
                `maker.ilike.*${q}*`,
                `manufacturer.ilike.*${q}*`,
                `asin.ilike.*${q}*`,
                `keepa_asin.ilike.*${q}*`
            ];
            p.append('or', `(${searchConditions.join(',')})`);
        }
        
        // ブランドフィルタ（検索クエリとはAND条件）
        if (state.brand) {
            const brandFilter = encodeURIComponent(state.brand);
            const brandConditions = [
                `brand.ilike.*${brandFilter}*`,
                `maker.ilike.*${brandFilter}*`,
                `manufacturer.ilike.*${brandFilter}*`
            ];
            p.append('or', `(${brandConditions.join(',')})`);
        }
        
        // 価格フィルタ（AND条件）
        if (state.priceMax) {
            p.set('price_list.lte', state.priceMax);
        }
        
        // ASINありのみフィルタ（AND条件）
        if (state.asinOnly) {
            p.append('or', '(asin.not.is.null,keepa_asin.not.is.null)');
        }
        
        // 候補商品のみフィルタ
        if (state.candidateOnly) {
            p.set('is_candidate', 'eq.true');
        }
        
        // 粗利フィルタ
        if (state.minGrossProfit) {
            p.set('gross_profit', `gte.${state.minGrossProfit}`);
        }
        
        // 粗利率フィルタ
        if (state.minGrossMargin) {
            p.set('gross_margin_pct', `gte.${state.minGrossMargin}`);
        }

        // Keepa分析済みフィルタ
        if (state.keepaAnalyzedOnly) {
            p.set('is_keepa_analyzed', 'eq.true');
        }

        // product_profit_viewビューを使用
        let viewName = 'product_profit_view';
        let r;
        let rows;
        let total = 0;
        
        try {
            console.log('Fetching from:', `/rest/v1/${viewName}?${p.toString()}`);
            r = await sbFetch(`/rest/v1/${viewName}?${p.toString()}`, {
                headers: { Prefer: 'count=exact' }
            });
            total = Number(r.headers.get('content-range')?.split('/')?.[1] || 0);
            rows = await r.json();
        } catch (viewError) {
            console.error('ビュー取得エラー:', viewError);
            console.error('ビューが存在しない可能性があります。database/profit_calculation_view.sqlを実行してください。');
            throw viewError;
        }

        console.log('Fetched rows:', rows.length, 'Total:', total);
        console.log('Using view/table:', viewName);

        // 最初の行のカラム名を表示
        if (rows.length > 0) {
            console.log('テーブルのカラム名:', Object.keys(rows[0]));
            console.log('サンプルデータ:', rows[0]);
        }

        // render関数にviewNameを渡す
        render(rows, total, viewName);
        status(`Loaded ${rows.length}/${total} (${viewName})`);
    } catch (error) {
        console.error('fetchPage error:', error);
        status(`エラー: ${error.message}`, true);
        els.tbody.innerHTML = `<tr><td colspan="19" style="text-align:center;padding:20px;color:#ff6b6b;">
      <strong>データ取得エラー</strong><br/>
      ${error.message}<br/>
      <small>ブラウザのコンソールで詳細を確認してください</small>
    </td></tr>`;
    }
}

// データ更新後にダッシュボード統計も更新
async function fetchPageAndStats() {
    await fetchPage();
    await fetchDashboardStats().catch(err => {
        console.warn('ダッシュボード統計の更新に失敗しました:', err);
    });
}

function render(rows, total, viewName = 'product_profit_view') {
    const tb = els.tbody;
    tb.innerHTML = '';

    rows.forEach((x, index) => {
        const tr = document.createElement('tr');

        // 実際のカラム名に柔軟に対応
        const productName = x.product_name || x.keepa_title || x.title || x.name || '';
        const brand = x.brand || x.maker || x.manufacturer || '';
        const productUrl = x.product_url || x.dd_url || x.url || '#';
        const imageUrl = x.image_url || x.img_url || '';
        
        const jan = x.jan || x.jan_code || '';
        const sku = ''; // SKU情報はビューに含まれていないため空文字
        const asin = x.asin || x.keepa_asin || '';
        const scrapedAt = x.keepa_snapshot_at || x.scraped_at || x.created_at || x.updated_at || '';
        
        // 仕入れ値
        const ddCost = x.dd_cost || x.price_list || null;
        
        // 利益計算データ（product_profit_viewから取得 - 既に計算済み）
        const sellingPrice = x.selling_price || null;
        const grossProfit = x.gross_profit || null;
        const grossMarginPct = x.gross_margin_pct || null;
        // monthly_sales_estimateがNULLの場合は0に変換
        const monthlySalesEstimate = x.monthly_sales_estimate != null ? x.monthly_sales_estimate : 0;
        const monthlyGrossProfit = x.monthly_gross_profit || null;
        const isAmazonSeller = x.is_amazon_seller || false;
        const isCandidate = x.is_candidate || false;
        const recommendationScore = x.recommendation_score || 0;
        
        // デバッグ: 最初の3商品のみログ出力
        if (index < 3) {
            console.log(`✅ 商品 ${x.id} (${productName}):`, {
                仕入れ値: ddCost,
                販売価格: sellingPrice,
                粗利: grossProfit,
                粗利率: grossMarginPct ? `${grossMarginPct}%` : null,
                月間販売: monthlySalesEstimate === 0 ? '0件（データ不足）' : `${monthlySalesEstimate}件`,
                月間粗利: monthlyGrossProfit,
                Amazon本体: isAmazonSeller,
                候補商品: isCandidate,
                推奨度スコア: Math.round(recommendationScore)
            });
        }
        
        // 候補商品の場合は行を強調表示（月間販売データがある場合のみ）
        if (isCandidate && monthlySalesEstimate > 0) {
            tr.style.background = 'linear-gradient(90deg, rgba(25, 135, 84, 0.08) 0%, rgba(25, 135, 84, 0.02) 100%)';
            tr.style.borderLeft = '3px solid #198754';
        }

        // sel
        const tdSel = document.createElement('td');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.id = x.id;
        cb.onchange = updateSelInfo;
        tdSel.appendChild(cb);
        tr.appendChild(tdSel);
        
        // 推奨度スコア
        const tdScore = document.createElement('td');
        tdScore.style.textAlign = 'center';
        if (recommendationScore > 0 && monthlySalesEstimate > 0) {
            const scoreSpan = document.createElement('span');
            scoreSpan.className = 'tag';
            scoreSpan.textContent = Math.round(recommendationScore);
            scoreSpan.style.fontSize = '13px';
            scoreSpan.style.fontWeight = 'bold';
            scoreSpan.style.minWidth = '40px';
            scoreSpan.style.display = 'inline-block';
            
            // スコアに応じて色分け
            if (recommendationScore >= 70) {
                scoreSpan.style.background = '#198754';
                scoreSpan.style.color = '#fff';
                scoreSpan.title = '🔥 超優良商品';
            } else if (recommendationScore >= 50) {
                scoreSpan.style.background = '#0d6efd';
                scoreSpan.style.color = '#fff';
                scoreSpan.title = '⭐ おすすめ商品';
            } else if (recommendationScore >= 30) {
                scoreSpan.style.background = '#ffc107';
                scoreSpan.style.color = '#000';
                scoreSpan.title = '✅ 良好な商品';
            } else {
                scoreSpan.style.background = '#6c757d';
                scoreSpan.style.color = '#fff';
                scoreSpan.title = '⚠️ 要検討';
            }
            
            tdScore.appendChild(scoreSpan);
        } else if (monthlySalesEstimate === 0) {
            // 月間販売データがない場合
            tdScore.innerHTML = '<span class="muted" style="font-size:11px;" title="販売データなし">データ不足</span>';
        } else {
            tdScore.innerHTML = '<span class="muted">-</span>';
        }
        tr.appendChild(tdScore);

        // img
        const tdImg = document.createElement('td');
        if (imageUrl) {
            const img = document.createElement('img');
            img.src = imageUrl;
            img.className = 'img';
            img.onerror = () => { img.style.display = 'none'; };
            tdImg.appendChild(img);
        } else {
            tdImg.innerHTML = '<span class="muted">-</span>';
        }
        tr.appendChild(tdImg);

        // title
        const tdTitle = document.createElement('td');
        const a = document.createElement('a');
        a.href = productUrl;
        a.textContent = productName || '(no title)';
        a.target = '_blank';
        tdTitle.appendChild(a);
        tr.appendChild(tdTitle);

        // brand
        const tdBrand = document.createElement('td');
        tdBrand.textContent = brand;
        tr.appendChild(tdBrand);

        // JAN
        const tdJan = document.createElement('td');
        tdJan.innerHTML = `<span class="tag">${jan}</span>`;
        tr.appendChild(tdJan);

        // SKU
        const tdSku = document.createElement('td');
        tdSku.innerHTML = `<span class="muted">${sku}</span>`;
        tr.appendChild(tdSku);

        // 仕入れ値（dd_cost）
        const tdCost = document.createElement('td');
        tdCost.className = 'num';
        if (ddCost != null) {
            tdCost.textContent = `¥${new Intl.NumberFormat('ja-JP').format(ddCost)}`;
            tdCost.style.fontWeight = '500';
        } else {
            tdCost.innerHTML = '<span class="muted">-</span>';
        }
        tr.appendChild(tdCost);

        // ASIN
        const tdAsin = document.createElement('td');
        tdAsin.innerHTML = asin
            ? `<span class="tag">${asin}</span>`
            : `<button data-id="${x.id}" data-jan="${jan}" class="set-asin">ASIN入力</button>`;
        tr.appendChild(tdAsin);
        
        // 販売価格
        const tdSellingPrice = document.createElement('td');
        tdSellingPrice.className = 'num';
        tdSellingPrice.textContent = sellingPrice != null
            ? `¥${new Intl.NumberFormat('ja-JP').format(sellingPrice)}`
            : '';
        tr.appendChild(tdSellingPrice);
        
        // 粗利
        const tdGrossProfit = document.createElement('td');
        tdGrossProfit.className = 'num';
        if (grossProfit != null) {
            tdGrossProfit.textContent = `¥${new Intl.NumberFormat('ja-JP').format(Math.round(grossProfit))}`;
            tdGrossProfit.style.color = grossProfit >= 0 ? '#198754' : '#dc3545';
        }
        tr.appendChild(tdGrossProfit);
        
        // 粗利率
        const tdGrossMargin = document.createElement('td');
        tdGrossMargin.className = 'num';
        if (grossMarginPct != null) {
            tdGrossMargin.textContent = `${grossMarginPct.toFixed(1)}%`;
            tdGrossMargin.style.color = grossMarginPct >= 25 ? '#198754' : grossMarginPct >= 15 ? '#ffc107' : '#dc3545';
        }
        tr.appendChild(tdGrossMargin);
        
        // 月間販売見込み
        const tdMonthlySales = document.createElement('td');
        tdMonthlySales.className = 'num';
        if (monthlySalesEstimate === 0) {
            tdMonthlySales.innerHTML = '<span class="muted">0件</span>';
            tdMonthlySales.title = '販売データなし';
        } else {
            tdMonthlySales.textContent = `${monthlySalesEstimate}件`;
        }
        tr.appendChild(tdMonthlySales);
        
        // 月間粗利
        const tdMonthlyProfit = document.createElement('td');
        tdMonthlyProfit.className = 'num';
        if (monthlyGrossProfit != null && monthlyGrossProfit !== 0) {
            tdMonthlyProfit.textContent = `¥${new Intl.NumberFormat('ja-JP').format(Math.round(monthlyGrossProfit))}`;
            tdMonthlyProfit.style.fontWeight = 'bold';
            tdMonthlyProfit.style.color = monthlyGrossProfit >= 10000 ? '#198754' : '#6c757d';
        } else if (monthlySalesEstimate === 0) {
            tdMonthlyProfit.innerHTML = '<span class="muted">-</span>';
        } else {
            tdMonthlyProfit.textContent = '';
        }
        tr.appendChild(tdMonthlyProfit);
        
        // Amazon本体有無
        const tdAmazonSeller = document.createElement('td');
        tdAmazonSeller.style.textAlign = 'center';
        tdAmazonSeller.innerHTML = isAmazonSeller
            ? '<span class="tag" style="background:#dc3545;color:#fff;font-size:11px;">Amazon</span>'
            : '<span class="muted">-</span>';
        tr.appendChild(tdAmazonSeller);

        // source
        const tdSrc = document.createElement('td');
        tdSrc.innerHTML = `<a class="muted" href="${productUrl}" target="_blank">d-online</a>`;
        tr.appendChild(tdSrc);

        // scraped
        const tdAt = document.createElement('td');
        tdAt.className = 'muted';
        tdAt.textContent = scrapedAt ? new Date(scrapedAt).toLocaleString() : '';
        tr.appendChild(tdAt);

        // history
        const tdHist = document.createElement('td');
        const hb = document.createElement('button');
        hb.textContent = '価格履歴';
        hb.onclick = () => openHistory(x);
        tdHist.appendChild(hb);
        tr.appendChild(tdHist);

        // actions
        const tdAct = document.createElement('td');
        tdAct.className = 'row-actions';
        tdAct.append(
            linkBtn('Amazon', amazonUrl(x)),
            linkBtn('Keepa', keepaUrl(x)),
            linkBtn('Google', googleUrl(x))
        );
        tr.appendChild(tdAct);

        tb.appendChild(tr);
    });

    const start = (state.page - 1) * state.pageSize + 1;
    const end = Math.min(state.page * state.pageSize, total);
    els.pageInfo.textContent = `${start}–${end} / ${total}`;

    // ASIN入力ボタンの委譲
    tb.querySelectorAll('.set-asin').forEach(btn => {
        btn.addEventListener('click', async e => {
            const id = Number(btn.dataset.id);
            const jan = btn.dataset.jan;
            const pasted = prompt(`商品ID ${id}\nASINを入力してください（JAN: ${jan || '-'}）`);
            if (!pasted) return;
            await setAsin(id, pasted.trim());
            fetchPageAndStats();
        });
    });
}

function linkBtn(label, href) {
    const a = document.createElement('a');
    a.textContent = label;
    a.href = href;
    a.target = '_blank';
    a.className = 'tag';
    a.style.textDecoration = 'none';
    return a;
}

function updateSelInfo() {
    const n = [...document.querySelectorAll('#tbody input[type="checkbox"]:checked')].length;
    els.selInfo.textContent = `選択 ${n} 件`;
}

els.selAll.onchange = () => {
    document.querySelectorAll('#tbody input[type="checkbox"]').forEach(cb => cb.checked = els.selAll.checked);
    updateSelInfo();
};

/* =========================
   リサーチURL
========================= */
function amazonUrl(x) {
    if (x.asin) return `https://www.amazon.co.jp/dp/${encodeURIComponent(x.asin)}`;
    const jan = x.jan || x.jan_code || '';
    const title = x.product_name || x.title || x.name || '';
    const brand = x.brand || x.maker || x.manufacturer || '';
    const q = jan ? jan : `${title} ${brand}`;
    return `https://www.amazon.co.jp/s?k=${encodeURIComponent(q)}`;
}

function keepaUrl(x) {
    if (x.asin) return `https://keepa.com/#!product/5-${encodeURIComponent(x.asin)}`;
    const jan = x.jan || x.jan_code || '';
    const title = x.product_name || x.title || x.name || '';
    if (jan) return `https://keepa.com/#!search/5-${encodeURIComponent(jan)}`;
    return `https://keepa.com/#!search/${encodeURIComponent(title.slice(0, 80))}`;
}

function googleUrl(x) {
    const jan = x.jan || x.jan_code || '';
    const title = x.product_name || x.title || x.name || '';
    const brand = x.brand || x.maker || x.manufacturer || '';
    const q = jan ? jan : `${title} ${brand}`;
    return `https://www.google.com/search?q=${encodeURIComponent(q)}`;
}

/* =========================
   価格履歴ダイアログ
========================= */
const dlg = document.getElementById('dlg');
const dlgClose = document.getElementById('dlgClose');

// 閉じるボタンのイベント
dlgClose.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    dlg.close();
};

// Escキーでも閉じる
dlg.addEventListener('cancel', (e) => {
    dlg.close();
});

// backdrop（背景）クリックでも閉じる
dlg.addEventListener('click', (e) => {
    const rect = dlg.getBoundingClientRect();
    if (
        e.clientX < rect.left ||
        e.clientX > rect.right ||
        e.clientY < rect.top ||
        e.clientY > rect.bottom
    ) {
        dlg.close();
    }
});

let chart;

async function openHistory(row) {
    const p = new URLSearchParams();
    p.set('select', '*');
    p.set('product_id', `eq.${row.id}`);
    p.set('order', 'scraped_on.asc.nullslast');

    const r = await sbFetch(`/rest/v1/products_dd_price_history?${p.toString()}`);
    const hist = await r.json();
    const labels = hist.map(h => new Date(h.scraped_on).toLocaleString());
    const values = hist.map(h => h.price_list);

    document.getElementById('dlgTitle').textContent = `価格履歴: ${row.title?.slice(0, 36) || row.id}`;
    document.getElementById('histMeta').textContent = `${hist.length} 点 / 期間: ${labels[0] || '-'} ～ ${labels.at(-1) || '-'}`;

    const ctx = document.getElementById('chart');
    if (chart) {
        chart.destroy();
    }

    chart = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Price',
                data: values
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    ticks: {
                        callback: v => '¥' + new Intl.NumberFormat('ja-JP').format(v)
                    }
                }
            }
        }
    });

    dlg.showModal();
}

/* =========================
   ASIN 更新（DB）
========================= */
async function setAsin(productId, asin) {
    const { table } = supa();
    await sbFetch(`/rest/v1/${table}?id=eq.${productId}`, {
        method: 'PATCH',
        headers: {
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        },
        body: JSON.stringify({
            asin,
            updated_at: new Date().toISOString()
        })
    });
    status(`ASIN更新: ${productId} ← ${asin}`);
}

/* =========================
   バッチ処理コントロール
========================= */
let batchIntervals = {
    janToAsin: null,
    keepaSnapshot: null
};

let batchStatus = {
    janToAsin: { running: false, lastResult: null },
    keepaSnapshot: { running: false, lastResult: null }
};

// Edge Functionを呼び出すヘルパー関数
async function callEdgeFunction(functionName, body = {}) {
    const cfg = getConfig();
    if (!cfg || !cfg.supabase) {
        throw new Error('Supabase設定が見つかりません');
    }
    
    const { url, key } = {
        url: cfg.supabase.projectUrl,
        key: cfg.supabase.anonKey
    };
    
    const functionUrl = `${url}/functions/v1/${functionName}`;
    
    const response = await fetch(functionUrl, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });
    
    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
    }
    
    return await response.json();
}

// JAN→ASIN検索バッチ実行
async function runJanToAsinBatch() {
    if (batchStatus.janToAsin.running) {
        console.log('JAN→ASINバッチは既に実行中です');
        return;
    }
    
    batchStatus.janToAsin.running = true;
    const btnRun = document.getElementById('runJanToAsinBatch');
    const btnStart = document.getElementById('startJanToAsinBatch');
    const btnStop = document.getElementById('stopJanToAsinBatch');
    const statusEl = document.getElementById('janToAsinStatus');
    
    btnRun.disabled = true;
    btnStart.disabled = true;
    btnStop.disabled = false;
    statusEl.textContent = '実行中...';
    statusEl.style.color = 'var(--accent)';
    
    try {
        const result = await callEdgeFunction('jan-to-asin-batch');
        batchStatus.janToAsin.lastResult = result;
        
        const successCount = result.updated || 0;
        const failedCount = result.failed || 0;
        const totalCount = result.total || 0;
        
        if (totalCount === 0) {
            statusEl.textContent = '処理対象なし';
            statusEl.style.color = 'var(--muted)';
        } else {
            statusEl.textContent = `完了: 成功${successCount}件、失敗${failedCount}件`;
            statusEl.style.color = failedCount > 0 ? '#ffc107' : '#198754';
        }
        
        // 自動更新がONの場合はデータを再取得
        if (document.getElementById('autoRefresh').checked) {
            setTimeout(() => fetchPageAndStats(), 1000);
        }
    } catch (error) {
        console.error('JAN→ASINバッチエラー:', error);
        statusEl.textContent = `エラー: ${error.message}`;
        statusEl.style.color = '#dc3545';
    } finally {
        batchStatus.janToAsin.running = false;
        
        // 連続実行中でない場合のみボタンを有効化
        if (!batchIntervals.janToAsin) {
            btnRun.disabled = false;
            btnStart.disabled = false;
            btnStop.disabled = true;
        }
    }
}

// ASIN→Keepa商品情報取得バッチ実行
async function runKeepaSnapshotBatch() {
    if (batchStatus.keepaSnapshot.running) {
        console.log('Keepaスナップショットバッチは既に実行中です');
        return;
    }
    
    batchStatus.keepaSnapshot.running = true;
    const btnRun = document.getElementById('runKeepaSnapshotBatch');
    const btnStart = document.getElementById('startKeepaSnapshotBatch');
    const btnStop = document.getElementById('stopKeepaSnapshotBatch');
    const statusEl = document.getElementById('keepaSnapshotStatus');
    
    btnRun.disabled = true;
    btnStart.disabled = true;
    btnStop.disabled = false;
    statusEl.textContent = '実行中...';
    statusEl.style.color = 'var(--accent)';
    
    try {
        const result = await callEdgeFunction('keepa-snapshot-batch');
        batchStatus.keepaSnapshot.lastResult = result;
        
        const successCount = result.updated || 0;
        const failedCount = result.failed || 0;
        const totalCount = result.total || 0;
        
        if (totalCount === 0) {
            statusEl.textContent = '処理対象なし';
            statusEl.style.color = 'var(--muted)';
        } else {
            statusEl.textContent = `完了: 成功${successCount}件、失敗${failedCount}件`;
            statusEl.style.color = failedCount > 0 ? '#ffc107' : '#198754';
        }
        
        // 自動更新がONの場合はデータを再取得
        if (document.getElementById('autoRefresh').checked) {
            setTimeout(() => fetchPageAndStats(), 1000);
        }
    } catch (error) {
        console.error('Keepaスナップショットバッチエラー:', error);
        statusEl.textContent = `エラー: ${error.message}`;
        statusEl.style.color = '#dc3545';
    } finally {
        batchStatus.keepaSnapshot.running = false;
        
        // 連続実行中でない場合のみボタンを有効化
        if (!batchIntervals.keepaSnapshot) {
            btnRun.disabled = false;
            btnStart.disabled = false;
            btnStop.disabled = true;
        }
    }
}

// バッチを連続実行する（自動モード）
function startBatchInterval(batchType, intervalMs = 60000) {
    if (batchIntervals[batchType]) {
        clearInterval(batchIntervals[batchType]);
    }
    
    const runFunction = batchType === 'janToAsin' ? runJanToAsinBatch : runKeepaSnapshotBatch;
    const runBtn = batchType === 'janToAsin' 
        ? document.getElementById('runJanToAsinBatch')
        : document.getElementById('runKeepaSnapshotBatch');
    const startBtn = batchType === 'janToAsin'
        ? document.getElementById('startJanToAsinBatch')
        : document.getElementById('startKeepaSnapshotBatch');
    const stopBtn = batchType === 'janToAsin'
        ? document.getElementById('stopJanToAsinBatch')
        : document.getElementById('stopKeepaSnapshotBatch');
    
    // ボタンの状態を更新
    runBtn.disabled = true;
    startBtn.disabled = true;
    stopBtn.disabled = false;
    
    // 即座に1回実行
    runFunction();
    
    // その後、指定間隔で実行
    batchIntervals[batchType] = setInterval(() => {
        if (!batchStatus[batchType].running) {
            runFunction();
        }
    }, intervalMs);
}

// バッチの連続実行を停止
function stopBatchInterval(batchType) {
    if (batchIntervals[batchType]) {
        clearInterval(batchIntervals[batchType]);
        batchIntervals[batchType] = null;
    }
}

// イベントリスナー設定
document.getElementById('runJanToAsinBatch').onclick = () => runJanToAsinBatch();
document.getElementById('startJanToAsinBatch').onclick = () => {
    startBatchInterval('janToAsin', 60000); // 60秒間隔
    document.getElementById('janToAsinStatus').textContent = '連続実行中（60秒間隔）';
    document.getElementById('janToAsinStatus').style.color = 'var(--accent)';
};
document.getElementById('stopJanToAsinBatch').onclick = () => {
    stopBatchInterval('janToAsin');
    batchStatus.janToAsin.running = false;
    document.getElementById('runJanToAsinBatch').disabled = false;
    document.getElementById('startJanToAsinBatch').disabled = false;
    document.getElementById('stopJanToAsinBatch').disabled = true;
    document.getElementById('janToAsinStatus').textContent = '停止しました';
    document.getElementById('janToAsinStatus').style.color = 'var(--muted)';
};

document.getElementById('runKeepaSnapshotBatch').onclick = () => runKeepaSnapshotBatch();
document.getElementById('startKeepaSnapshotBatch').onclick = () => {
    startBatchInterval('keepaSnapshot', 60000); // 60秒間隔
    document.getElementById('keepaSnapshotStatus').textContent = '連続実行中（60秒間隔）';
    document.getElementById('keepaSnapshotStatus').style.color = 'var(--accent)';
};
document.getElementById('stopKeepaSnapshotBatch').onclick = () => {
    stopBatchInterval('keepaSnapshot');
    batchStatus.keepaSnapshot.running = false;
    document.getElementById('runKeepaSnapshotBatch').disabled = false;
    document.getElementById('startKeepaSnapshotBatch').disabled = false;
    document.getElementById('stopKeepaSnapshotBatch').disabled = true;
    document.getElementById('keepaSnapshotStatus').textContent = '停止しました';
    document.getElementById('keepaSnapshotStatus').style.color = 'var(--muted)';
};

// 自動更新チェックボックスの処理
document.getElementById('autoRefresh').addEventListener('change', (e) => {
    // 自動更新の設定を保存（オプション）
    localStorage.setItem('ddweb_autoRefresh', e.target.checked);
});

// ページ読み込み時に自動更新設定を復元
const autoRefresh = localStorage.getItem('ddweb_autoRefresh') === 'true';
document.getElementById('autoRefresh').checked = autoRefresh;

/* =========================
   スマートフィルタ
========================= */
// 高利益商品フィルタ
document.getElementById('filterHighProfit').onclick = () => {
    els.minGrossProfit.value = '500';
    els.q.value = '';
    els.brand.value = '';
    els.priceMax.value = '';
    els.minGrossMargin.value = '';
    els.candidateOnly.checked = false;
    els.keepaAnalyzedOnly.checked = true; // Keepaデータがあるもののみ
    state.page = 1;
    applyFilters();
};

// 高利益率フィルタ
document.getElementById('filterHighMargin').onclick = () => {
    els.minGrossMargin.value = '30';
    els.q.value = '';
    els.brand.value = '';
    els.priceMax.value = '';
    els.minGrossProfit.value = '';
    els.candidateOnly.checked = false;
    els.keepaAnalyzedOnly.checked = true;
    state.page = 1;
    applyFilters();
};

// 高回転商品フィルタ
document.getElementById('filterHighRotation').onclick = () => {
    els.candidateOnly.checked = true;
    els.minGrossMargin.value = '15';
    els.q.value = '';
    els.brand.value = '';
    els.priceMax.value = '';
    els.minGrossProfit.value = '';
    els.keepaAnalyzedOnly.checked = true;
    state.page = 1;
    applyFilters();
};

// 総合候補フィルタ
document.getElementById('filterCandidates').onclick = () => {
    els.candidateOnly.checked = true;
    els.q.value = '';
    els.brand.value = '';
    els.priceMax.value = '';
    els.minGrossProfit.value = '';
    els.minGrossMargin.value = '';
    els.keepaAnalyzedOnly.checked = true;
    state.page = 1;
    applyFilters();
};

// Amazon本体なしフィルタ
document.getElementById('filterNoAmazon').onclick = () => {
    els.candidateOnly.checked = true;
    els.q.value = '';
    els.brand.value = '';
    els.priceMax.value = '';
    els.minGrossProfit.value = '';
    els.minGrossMargin.value = '';
    els.keepaAnalyzedOnly.checked = true;
    state.page = 1;
    applyFilters();
};

// フィルタリセット
document.getElementById('filterReset').onclick = () => {
    els.q.value = '';
    els.brand.value = '';
    els.priceMax.value = '';
    els.minGrossProfit.value = '';
    els.minGrossMargin.value = '';
    els.candidateOnly.checked = false;
    els.asinOnly.checked = false;
    els.keepaAnalyzedOnly.checked = false;
    state.page = 1;
    applyFilters();
};

/* =========================
   Keepa候補検索（任意：Edge Function）
========================= */
document.getElementById('asinFromKeepa').onclick = async () => {
    const cfg = getConfig();
    if (!cfg || !cfg.keepa || !cfg.keepa.functionUrl) {
        alert('Keepa Edge Functionが設定されていません。config.jsを確認してください。');
        return;
    }

    const sel = [...document.querySelectorAll('#tbody input[type="checkbox"]:checked')];
    if (sel.length === 0) {
        alert('行を選択してください');
        return;
    }

    for (const cb of sel) {
        const id = Number(cb.dataset.id);
        const row = getRowData(id);
        if (!row?.jan) {
            continue;
        }

        // 呼び出し
        const r = await fetch(cfg.keepa.functionUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${cfg.keepa.functionKey || ''}`
            },
            body: JSON.stringify({ jan: row.jan })
        });

        const data = await r.json().catch(() => ({}));
        const options = (data.asins || []).slice(0, 10);

        if (options.length === 0) {
            continue;
        }

        const picked = prompt(
            `商品ID ${id}\n候補: ${options.join(', ')}\n採用するASINを入力してください`,
            options[0]
        );

        if (picked) {
            await setAsin(id, picked.trim());
        }
    }

    fetchPageAndStats();
};

function getRowData(id) {
    // テーブルDOMから最小限を拾う（必要十分）
    const tr = [...document.querySelectorAll('#tbody tr')].find(
        tr => tr.querySelector(`input[data-id="${id}"]`)
    );
    if (!tr) return null;

    const tds = tr.querySelectorAll('td');
    return {
        id,
        jan: tds[4]?.innerText?.trim().replace(/\D/g, '') || '',
    };
}

/* =========================
   複数選択 → Amazon検索タブ
========================= */
document.getElementById('openAmazonBulk').onclick = () => {
    const checks = [...document.querySelectorAll('#tbody input[type="checkbox"]:checked')];
    if (checks.length === 0) return;

    let i = 0;
    const openNext = () => {
        const cb = checks[i++];
        if (!cb) {
            return;
        }

        const id = Number(cb.dataset.id);
        const tr = cb.closest('tr');
        const tds = tr.querySelectorAll('td');
        const janText = tds[4]?.innerText?.trim();
        const asinTag = tds[7]?.querySelector('.tag')?.innerText?.trim();
        const title = tds[2]?.innerText || '';
        const brand = tds[3]?.innerText || '';

        let url;
        if (asinTag) {
            url = `https://www.amazon.co.jp/dp/${encodeURIComponent(asinTag)}`;
        } else if (/\d{8,}/.test(janText)) {
            url = `https://www.amazon.co.jp/s?k=${encodeURIComponent(janText)}`;
        } else {
            url = `https://www.amazon.co.jp/s?k=${encodeURIComponent(title + ' ' + brand)}`;
        }

        window.open(url, '_blank');
        setTimeout(openNext, 600); // レート制限
    };

    openNext();
};

document.getElementById('clearSel').onclick = () => {
    document.querySelectorAll('#tbody input[type="checkbox"]').forEach(cb => cb.checked = false);
    els.selAll.checked = false;
    updateSelInfo();
};

/* =========================
   プリセット保存/適用
========================= */
const presetsKey = 'ddweb_presets';

function presets() {
    return JSON.parse(localStorage.getItem(presetsKey) || '[]');
}

function savePreset() {
    const list = presets();
    const name = document.getElementById('presetName').value.trim();
    if (!name) return;

    const p = {
        name,
        q: els.q.value.trim(),
        brand: els.brand.value.trim(),
        priceMax: els.priceMax.value.trim(),
        asinOnly: els.asinOnly.checked,
        pageSize: Number(els.pageSize.value || 50)
    };

    const i = list.findIndex(x => x.name === name);
    if (i >= 0) {
        list[i] = p;
    } else {
        list.push(p);
    }

    localStorage.setItem(presetsKey, JSON.stringify(list));
    renderPresets();
}

function renderPresets() {
    const list = presets();
    const box = document.getElementById('presetList');
    box.innerHTML = '';

    list.forEach(p => {
        const row = document.createElement('div');
        row.className = 'preset-item';

        const left = document.createElement('div');
        left.innerHTML = `
      <div>${p.name}</div>
      <div class="muted" style="font-size:12px">
        ${p.brand || '-'} / ≤${p.priceMax || '-'} / ASIN-only:${p.asinOnly ? 'Yes' : 'No'}
      </div>
    `;

        const right = document.createElement('div');
        right.style.display = 'flex';
        right.style.gap = '8px';

        const useBtn = document.createElement('button');
        useBtn.textContent = '適用';
        useBtn.onclick = () => applyPreset(p);

        const delBtn = document.createElement('button');
        delBtn.textContent = '削除';
        delBtn.className = 'danger';
        delBtn.onclick = () => {
            removePreset(p.name);
        };

        right.append(useBtn, delBtn);
        row.append(left, right);
        box.append(row);
    });
}

function applyPreset(p) {
    els.q.value = p.q || '';
    els.brand.value = p.brand || '';
    els.priceMax.value = p.priceMax || '';
    els.asinOnly.checked = !!p.asinOnly;
    els.pageSize.value = p.pageSize || 50;
    state.page = 1;
    applyFilters();
}

function removePreset(name) {
    const list = presets().filter(x => x.name !== name);
    localStorage.setItem(presetsKey, JSON.stringify(list));
    renderPresets();
}

document.getElementById('savePreset').onclick = savePreset;

/* =========================
   CSV
========================= */
document.getElementById('exportCsv').onclick = async () => {
    const viewName = 'product_profit_view';
    const p = new URLSearchParams();
    p.set('select', '*');

    // CSVエクスポート時も同じフィルタを適用
    if (state.q) {
        const q = encodeURIComponent(state.q);
        const searchConditions = [
            `product_name.ilike.*${q}*`,
            `title.ilike.*${q}*`,
            `name.ilike.*${q}*`,
            `jan.ilike.*${q}*`,
            `jan_code.ilike.*${q}*`,
            `sku.ilike.*${q}*`,
            `sku_code.ilike.*${q}*`,
            `brand.ilike.*${q}*`,
            `maker.ilike.*${q}*`,
            `manufacturer.ilike.*${q}*`,
            `asin.ilike.*${q}*`,
            `keepa_asin.ilike.*${q}*`
        ];
        p.append('or', `(${searchConditions.join(',')})`);
    }
    
    if (state.brand) {
        const brandFilter = encodeURIComponent(state.brand);
        const brandConditions = [
            `brand.ilike.*${brandFilter}*`,
            `maker.ilike.*${brandFilter}*`,
            `manufacturer.ilike.*${brandFilter}*`
        ];
        p.append('or', `(${brandConditions.join(',')})`);
    }
    
    if (state.priceMax) {
        p.set('price_list.lte', state.priceMax);
    }
    
    if (state.asinOnly) {
        p.append('or', '(asin.not.is.null,keepa_asin.not.is.null)');
    }
    
    if (state.candidateOnly) {
        p.set('is_candidate', 'eq.true');
    }
    
    if (state.minGrossProfit) {
        p.set('gross_profit', `gte.${state.minGrossProfit}`);
    }
    
    if (state.minGrossMargin) {
        p.set('gross_margin_pct', `gte.${state.minGrossMargin}`);
    }

    const r = await sbFetch(`/rest/v1/${viewName}?${p.toString()}`);
    const rows = await r.json();

    // すべてのカラムをCSVに出力
    if (rows.length === 0) {
        alert('データがありません');
        return;
    }

    const headers = Object.keys(rows[0]);
    const csv = [
        headers,
        ...rows.map(row => headers.map(h => row[h]))
    ]
        .map(a => a.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\r\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'dd_products.csv';
    a.click();
};

/* =========================
   各種イベント
========================= */
document.getElementById('reload').onclick = () => {
    state.page = 1;
    applyFilters();
};

document.getElementById('prev').onclick = () => {
    state.page = Math.max(1, state.page - 1);
    fetchPageAndStats();
};

document.getElementById('next').onclick = () => {
    state.page = state.page + 1;
    fetchPageAndStats();
};

els.pageSize.onchange = () => {
    state.pageSize = Number(els.pageSize.value);
    localStorage.setItem('ddweb_pageSize', state.pageSize);
    state.page = 1;
    fetchPageAndStats();
};

let t;
['q', 'brand', 'priceMax', 'asinOnly', 'candidateOnly', 'keepaAnalyzedOnly', 'minGrossProfit', 'minGrossMargin'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener(
            id === 'asinOnly' || id === 'candidateOnly' || id === 'keepaAnalyzedOnly' ? 'change' : 'input',
            () => {
                clearTimeout(t);
                t = setTimeout(() => {
                    state.page = 1;
                    applyFilters();
                }, 260);
            }
        );
    }
});

function applyFilters() {
    state.q = els.q.value.trim();
    state.brand = els.brand.value.trim();
    state.priceMax = els.priceMax.value.trim();
    state.asinOnly = els.asinOnly.checked;
    state.candidateOnly = els.candidateOnly.checked;
    state.keepaAnalyzedOnly = els.keepaAnalyzedOnly.checked;
    state.minGrossProfit = els.minGrossProfit.value.trim();
    state.minGrossMargin = els.minGrossMargin.value.trim();
    fetchPageAndStats();
}

/* =========================
   小物
========================= */
function status(msg, bad = false) {
    els.status.textContent = msg;
    els.status.className = 'badge' + (bad ? ' danger' : '');
    setTimeout(() => {
        els.status.className = 'badge';
    }, 1800);
}

/* =========================
   初期化
========================= */
// Keepaカードの表示/非表示
function initKeepaCard() {
    const cfg = getConfig();
    const keepaCard = document.getElementById('keepaCard');
    if (!cfg || !cfg.keepa || !cfg.keepa.functionUrl) {
        if (keepaCard) keepaCard.style.display = 'none';
    }
}

// 初期化チェック
function init() {
    console.log('=== DD Research Web 初期化 ===');

    // 設定確認
    const cfg = getConfig();
    if (!cfg) {
        status('config.js が読み込まれていません', true);
        console.error('❌ config.js を作成してください');

        // UIにセットアップ案内を表示
        els.tbody.innerHTML = `
      <tr><td colspan="12" style="text-align:center;padding:40px;">
        <div style="max-width:600px;margin:0 auto;">
          <h2 style="color:#ff6b6b;margin-bottom:16px;">⚠️ 設定ファイルが見つかりません</h2>
          <p style="font-size:16px;line-height:1.6;margin-bottom:20px;">
            このアプリを使用するには、Supabase接続設定が必要です。
          </p>
          <div style="text-align:left;background:#1a2332;padding:20px;border-radius:12px;border:1px solid var(--line);">
            <h3 style="margin-top:0;">セットアップ手順：</h3>
            <ol style="line-height:1.8;">
              <li><code>config.js.example</code> を <code>config.js</code> にコピー</li>
              <li><code>config.js</code> を開いて、Supabase情報を記入</li>
              <li>ページをリロード</li>
            </ol>
            <p style="margin-bottom:0;color:var(--muted);font-size:14px;">
              詳細は <code>README.md</code> を参照してください。
            </p>
          </div>
        </div>
      </td></tr>
    `;
        return;
    }

    console.log('Config loaded:', {
        projectUrl: cfg.supabase?.projectUrl,
        hasAnonKey: !!cfg.supabase?.anonKey,
        tableName: cfg.supabase?.tableName
    });

    if (!cfg.supabase?.projectUrl || !cfg.supabase?.anonKey) {
        status('Supabase設定が不完全です', true);
        console.error('config.js の supabase 設定を確認してください');

        // UIに設定不備の案内を表示
        els.tbody.innerHTML = `
      <tr><td colspan="12" style="text-align:center;padding:40px;">
        <div style="max-width:600px;margin:0 auto;">
          <h2 style="color:#ff6b6b;margin-bottom:16px;">⚠️ Supabase設定が不完全です</h2>
          <p style="font-size:16px;line-height:1.6;margin-bottom:20px;">
            <code>config.js</code> のSupabase設定を確認してください。
          </p>
          <div style="text-align:left;background:#1a2332;padding:20px;border-radius:12px;border:1px solid var(--line);">
            <h3 style="margin-top:0;">必要な設定：</h3>
            <ul style="line-height:1.8;">
              <li><code>projectUrl</code>: ${cfg.supabase?.projectUrl ? '✅ 設定済み' : '❌ 未設定'}</li>
              <li><code>anonKey</code>: ${cfg.supabase?.anonKey ? '✅ 設定済み' : '❌ 未設定'}</li>
              <li><code>tableName</code>: ${cfg.supabase?.tableName || 'products_dd (デフォルト)'}</li>
            </ul>
          </div>
        </div>
      </td></tr>
    `;
        return;
    }

    initKeepaCard();
    renderPresets();
    
    // ダッシュボード統計を取得（非同期、エラーが出てもページ表示は継続）
    fetchDashboardStats().catch(err => {
        console.warn('ダッシュボード統計の取得に失敗しました:', err);
    });
    
    applyFilters();
}

// 初期化は index.html の config.js の onload/onerror で呼び出される
// 念のため、config.jsが既に読み込まれている場合は即座に初期化
if (typeof CONFIG !== 'undefined') {
    // config.jsが既に読み込まれている場合
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}
