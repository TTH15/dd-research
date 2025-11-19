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
    asinOnly: false
};

els.pageSize.value = state.pageSize;
els.asinOnly.checked = state.asinOnly;

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
   データ取得＆描画
========================= */
async function fetchPage() {
    try {
        const { table } = supa();
        els.status.textContent = 'Loading...';
        const from = (state.page - 1) * state.pageSize;

        const p = new URLSearchParams();
        p.set('select', '*');
        p.set('order', 'scraped_at.desc.nullslast');
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

        console.log('Fetching from:', `/rest/v1/${table}?${p.toString()}`);

        const r = await sbFetch(`/rest/v1/${table}?${p.toString()}`, {
            headers: { Prefer: 'count=exact' }
        });
        const total = Number(r.headers.get('content-range')?.split('/')?.[1] || 0);
        const rows = await r.json();

        console.log('Fetched rows:', rows.length, 'Total:', total);

        // 最初の行のカラム名を表示
        if (rows.length > 0) {
            console.log('テーブルのカラム名:', Object.keys(rows[0]));
            console.log('サンプルデータ:', rows[0]);
        }

        render(rows, total);
        status(`Loaded ${rows.length}/${total}`);
    } catch (error) {
        console.error('fetchPage error:', error);
        status(`エラー: ${error.message}`, true);
        els.tbody.innerHTML = `<tr><td colspan="12" style="text-align:center;padding:20px;color:#ff6b6b;">
      <strong>データ取得エラー</strong><br/>
      ${error.message}<br/>
      <small>ブラウザのコンソールで詳細を確認してください</small>
    </td></tr>`;
    }
}

function render(rows, total) {
    const tb = els.tbody;
    tb.innerHTML = '';

    rows.forEach(x => {
        const tr = document.createElement('tr');

        // 実際のカラム名に柔軟に対応
        const productName = x.product_name || x.title || x.name || '';
        const brand = x.brand || x.maker || x.manufacturer || '';
        const productUrl = x.product_url || x.url || '#';
        const imageUrl = x.image_url || x.img_url || '';
        const price = x.price_list || x.price || null;
        const jan = x.jan || x.jan_code || '';
        const sku = x.sku || x.sku_code || '';
        // ASINの優先順位: asin > keepa_asin
        const asin = x.asin || x.keepa_asin || '';
        const scrapedAt = x.scraped_at || x.created_at || x.updated_at || '';

        // sel
        const tdSel = document.createElement('td');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.dataset.id = x.id;
        cb.onchange = updateSelInfo;
        tdSel.appendChild(cb);
        tr.appendChild(tdSel);

        // img
        const tdImg = document.createElement('td');
        const img = document.createElement('img');
        img.src = imageUrl;
        img.className = 'img';
        img.onerror = () => { img.style.display = 'none'; };
        tdImg.appendChild(img);
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

        // price
        const tdPrice = document.createElement('td');
        tdPrice.className = 'num';
        tdPrice.textContent = price != null
            ? `¥${new Intl.NumberFormat('ja-JP').format(price)}`
            : '';
        tr.appendChild(tdPrice);

        // ASIN
        const tdAsin = document.createElement('td');
        tdAsin.innerHTML = asin
            ? `<span class="tag">${asin}</span>`
            : `<button data-id="${x.id}" data-jan="${jan}" class="set-asin">ASIN入力</button>`;
        tr.appendChild(tdAsin);

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
            fetchPage();
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

    fetchPage();
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
    const { table } = supa();
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

    const r = await sbFetch(`/rest/v1/${table}?${p.toString()}`);
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
    fetchPage();
};

document.getElementById('next').onclick = () => {
    state.page = state.page + 1;
    fetchPage();
};

els.pageSize.onchange = () => {
    state.pageSize = Number(els.pageSize.value);
    localStorage.setItem('ddweb_pageSize', state.pageSize);
    state.page = 1;
    fetchPage();
};

let t;
['q', 'brand', 'priceMax', 'asinOnly'].forEach(id => {
    document.getElementById(id).addEventListener(
        id === 'asinOnly' ? 'change' : 'input',
        () => {
            clearTimeout(t);
            t = setTimeout(() => {
                state.page = 1;
                applyFilters();
            }, 260);
        }
    );
});

function applyFilters() {
    state.q = els.q.value.trim();
    state.brand = els.brand.value.trim();
    state.priceMax = els.priceMax.value.trim();
    state.asinOnly = els.asinOnly.checked;
    fetchPage();
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
