(function () {
  'use strict';

  var root = document.getElementById('dashboard-data-root');
  if (!root) return;
  var API_URL = root.getAttribute('data-api-endpoint');
  if (!API_URL) return;

  var dark = document.documentElement.classList.contains('admin-dark');
  var chartTextColor = dark ? '#dbeafe' : '#475569';
  var chartStrongColor = dark ? '#ffffff' : '#0f172a';

  if (window.Chart && Chart.defaults && Chart.defaults.global) {
    Chart.defaults.global.defaultFontColor = chartTextColor;
  }

  function esc(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  function peso(v) {
    return '\u20B1' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function pct(v, d) { return Number(v || 0).toFixed(d !== undefined ? d : 1) + '%'; }

  function fmt(v) { return Number(v || 0).toLocaleString(); }

  fetch(API_URL, { credentials: 'same-origin', headers: { 'Accept': 'application/json' } })
    .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then(function (d) { renderDashboard(d); })
    .catch(function (err) {
      var ids = ['dsh-gauges', 'dsh-summary', 'dsh-sales-chart', 'dsh-performance', 'dsh-product-mix', 'dsh-pos-sold', 'dsh-rankings', 'dsh-bottom-sections'];
      ids.forEach(function (id) {
        var el = document.getElementById(id);
        if (el) el.innerHTML = '<div class="dsh-loading-error"><p class="text-sm text-slate-500">Failed to load dashboard data.</p><button onclick="location.reload()">Retry</button></div>';
      });
    });

  function renderDashboard(d) {
    var EL = root.getAttribute('data-entity-label') || d.entity_label || 'Store';
    var ELP = root.getAttribute('data-entity-label-plural') || d.entity_label_plural || 'Stores';

    renderGauges(d);
    renderSummary(d);
    renderSalesChart(d);
    renderPerformance(d, EL, ELP);
    renderProductMix(d, EL);
    renderPosSold(d, EL);
    renderRankings(d, EL, ELP);
    renderBottomSections(d, EL);
    setupIcountScrollbars();
  }

  /* ======================== GAUGES ======================== */
  function renderGauges(d) {
    var ov = d.summary && d.summary.overview ? d.summary.overview : {};
    var mtdSales = Number(ov.mtd_sales || 0);
    var mtdTarget = Number(ov.total_target || 0);
    var ytdSales = Number(ov.ytd_sales || 0);
    var ytdTarget = Number(ov.ytd_target || 0);

    var el = document.getElementById('dsh-gauges');
    el.innerHTML =
      '<div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">' +
        '<div class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">MTD</div>' +
        '<div class="relative w-full max-w-[340px] h-[240px] mx-auto">' +
          '<canvas id="percentageRateGauge"></canvas>' +
          '<div class="absolute inset-x-0 bottom-6 flex flex-col items-center justify-center pointer-events-none">' +
            '<span class="text-3xl font-bold text-slate-500">' + pct(mtdTarget > 0 ? (mtdSales / mtdTarget) * 100 : 0) + '</span>' +
          '</div>' +
          '<div class="absolute inset-x-4 -bottom-2 flex items-center justify-between text-[11px] font-semibold text-slate-500"><span>0%</span><span>80%</span><span>90%</span><span>100%+</span></div>' +
        '</div>' +
      '</div>' +
      '<div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">' +
        '<div class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">YTD</div>' +
        '<div class="relative w-full max-w-[340px] h-[240px] mx-auto">' +
          '<canvas id="ytdRateGauge"></canvas>' +
          '<div class="absolute inset-x-0 bottom-6 flex flex-col items-center justify-center pointer-events-none">' +
            '<span class="text-3xl font-bold text-slate-500">' + pct(ytdTarget > 0 ? (ytdSales / ytdTarget) * 100 : 0) + '</span>' +
          '</div>' +
          '<div class="absolute inset-x-4 -bottom-2 flex items-center justify-between text-[11px] font-semibold text-slate-500"><span>0%</span><span>80%</span><span>90%</span><span>100%+</span></div>' +
        '</div>' +
      '</div>';

    renderRateGauge('percentageRateGauge', mtdSales, mtdTarget);
    renderRateGauge('ytdRateGauge', ytdSales, ytdTarget);
  }

  function renderRateGauge(canvasId, salesValue, targetValue) {
    var c = document.getElementById(canvasId);
    if (!c || typeof Chart === 'undefined') return;
    var rate = targetValue > 0 ? (salesValue / targetValue) * 100 : 0;
    var gaugeMax = Math.max(120, Math.ceil(Math.max(rate, 100.01) / 10) * 10);
    var clamped = Math.max(0, Math.min(rate, gaugeMax));
    new Chart(c.getContext('2d'), {
      type: 'gauge',
      data: {
        labels: ['Below 80%', '80-89.99%', '90-99.99%', '100%+'],
        datasets: [{ value: clamped, minValue: 0, data: [80, 90, 99.99, gaugeMax], backgroundColor: ['#ef4444', '#f59e0b', '#10b981', '#f97316'], borderWidth: 0 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, rotation: -Math.PI, circumference: Math.PI, cutoutPercentage: 72,
        legend: { display: false },
        needle: { radiusPercentage: 2.5, widthPercentage: 3.2, lengthPercentage: 80, color: chartStrongColor },
        valueLabel: { display: false }
      }
    });
  }

  /* ======================== SUMMARY CARDS ======================== */
  function renderSummary(d) {
    var ov = d.summary && d.summary.overview ? d.summary.overview : {};
    var sl = d.summary && d.summary.sales ? d.summary.sales : {};
    var variancePct = Number(ov.variance_percent || 0);
    var lyPct = Number(sl.mtd_vs_ly_percent || 0);
    var wastagePct = Number(ov.wastage_percent || 0);
    var discPct = Number(ov.discount_percent || 0);

    function badge(val, thresholds) {
      if (val >= thresholds[0]) return 'text-red-600 bg-red-50';
      if (val >= thresholds[1]) return 'text-amber-600 bg-amber-50';
      return 'text-emerald-600 bg-emerald-50';
    }
    function vbadge(val) { return val >= 0 ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50'; }

    var el = document.getElementById('dsh-summary');
    el.innerHTML =
      '<div class="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 hover:shadow-md transition-all">' +
        '<div class="flex items-center justify-between mb-3"><div class="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600"><span class="text-2xl font-bold leading-none">\u20B1</span></div>' +
        '<span class="text-xs font-medium px-2 py-0.5 rounded-md ' + vbadge(variancePct) + '">' + (variancePct >= 0 ? '+' : '') + pct(variancePct) + '</span></div>' +
        '<h3 class="text-xs font-medium text-slate-500 mb-1">MTD Sales</h3><p class="text-xl font-bold text-slate-900">' + peso(ov.mtd_sales) + '</p><p class="text-xs text-slate-400 mt-1">month-to-date net sales</p></div>' +

      '<div class="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 hover:shadow-md transition-all">' +
        '<div class="flex items-center justify-between mb-3"><div class="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg></div>' +
        '<span class="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">Monthly</span></div>' +
        '<h3 class="text-xs font-medium text-slate-500 mb-1">Target</h3><p class="text-xl font-bold text-slate-900">' + peso(ov.total_target) + '</p><p class="text-xs text-slate-400 mt-1">month-to-date target</p></div>' +

      '<div class="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 hover:shadow-md transition-all">' +
        '<div class="flex items-center justify-between mb-3"><div class="w-10 h-10 rounded-xl bg-slate-100 text-slate-600 flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9"></path><polyline points="15 3 21 3 21 9"></polyline></svg></div>' +
        '<span class="text-xs font-medium px-2 py-0.5 rounded-md ' + vbadge(lyPct) + '">' + (lyPct >= 0 ? '+' : '') + pct(lyPct) + '</span></div>' +
        '<h3 class="text-xs font-medium text-slate-500 mb-1">Last Year Net</h3><p class="text-xl font-bold text-slate-900">' + peso(sl.last_year_net) + '</p><p class="text-xs text-slate-400 mt-1">same selected period</p></div>' +

      '<div class="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 hover:shadow-md transition-all">' +
        '<div class="flex items-center justify-between mb-3"><div class="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path><path d="M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></div>' +
        '<span class="text-xs font-medium px-2 py-0.5 rounded-md ' + badge(wastagePct, [3, 1.5]) + '">' + pct(wastagePct, 2) + '</span></div>' +
        '<h3 class="text-xs font-medium text-slate-500 mb-1">Wastage Amount</h3><p class="text-xl font-bold text-slate-900">' + peso(ov.wastage_amount) + '</p><p class="text-xs text-slate-400 mt-1">month-to-date wastage</p></div>' +

      '<div class="bg-white p-5 rounded-3xl shadow-sm border border-slate-100 hover:shadow-md transition-all">' +
        '<div class="flex items-center justify-between mb-3"><div class="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center"><span class="text-2xl font-bold leading-none">\u20B1</span></div>' +
        '<span class="text-xs font-medium px-2 py-0.5 rounded-md ' + badge(discPct, [5, 2]) + '">' + pct(discPct, 2) + '</span></div>' +
        '<h3 class="text-xs font-medium text-slate-500 mb-1">MTD Discount</h3><p class="text-xl font-bold text-slate-900">' + peso(ov.discount_amount) + '</p><p class="text-xs text-slate-400 mt-1">month-to-date discounts</p></div>';
  }

  /* ======================== SALES CHART ======================== */
  function renderSalesChart(d) {
    var el = document.getElementById('dsh-sales-chart');
    el.innerHTML =
      '<div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">' +
        '<div class="flex items-center justify-between mb-6"><div><h2 class="text-lg font-bold text-slate-900">Sales Trend</h2><p class="text-sm text-slate-500 mt-1">Daily net sales</p></div>' +
        '<div id="sales-range-toggle" class="flex gap-2">' +
          '<button class="px-3 py-1.5 text-xs font-medium bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors">Day</button>' +
          '<button class="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">Week</button>' +
          '<button class="px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 rounded-lg transition-colors">Month</button>' +
        '</div></div>' +
        '<div class="relative h-80"><canvas id="salesChart" width="800" height="320"></canvas></div>' +
      '</div>';

    var origSales = d.sales_data || [];
    var origSbase = d.sbase_sales_data || [];
    var origTarget = d.target_data || [];
    var origLY = d.last_year_data || [];
    var origLabels = d.labels || [];
    var curSales = origSales.slice();
    var curSbase = origSbase.slice();
    var curTarget = origTarget.slice();
    var curLY = origLY.slice();
    var curLabels = origLabels.slice();

    var ctx = document.getElementById('salesChart');
    if (!ctx) return;
    var chartInstance = null;

    function updateChart() {
      var barColors = curSales.map(function (v, i) {
        var t = curTarget[i] || 0;
        if (t <= 0) return 'rgba(16,185,129,0.65)';
        if (v >= t) return 'rgba(16,185,129,0.65)';
        if (v >= t * 0.97) return 'rgba(250,204,21,0.85)';
        return 'rgba(99,102,241,0.6)';
      });
      if (chartInstance) chartInstance.destroy();
      chartInstance = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: {
          labels: curLabels,
          datasets: [
            { label: 'Net Sales', data: curSales, backgroundColor: barColors, borderColor: barColors, borderWidth: 1, order: 10, type: 'bar' },
            { label: 'ACT Sbase', data: curSbase, borderColor: '#f97316', backgroundColor: 'transparent', borderWidth: 2, pointBackgroundColor: '#f97316', pointRadius: 3, pointHoverRadius: 5, fill: false, lineTension: 0.3, order: 3, type: 'line' },
            { label: 'Target (Net)', data: curTarget, borderColor: '#ef4444', backgroundColor: 'transparent', borderWidth: 2, pointBackgroundColor: '#ef4444', pointRadius: 4, pointHoverRadius: 6, fill: false, lineTension: 0.3, order: 1, type: 'line' },
            { label: 'Last Year (Net)', data: curLY, borderColor: '#64748b', backgroundColor: 'transparent', borderWidth: 2, borderDash: [5,5], pointBackgroundColor: '#64748b', pointRadius: 4, pointHoverRadius: 6, fill: false, lineTension: 0.3, order: 2, type: 'line' }
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          legend: { display: true, position: 'top' },
          tooltips: { callbacks: { label: function (t) { return '\u20B1' + Number(t.yLabel || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); } } },
          scales: {
            yAxes: [{ beginAtZero: true, gridLines: { color: 'rgba(226,232,240,0.5)' }, ticks: { callback: function (v) { return '\u20B1' + v.toLocaleString(); } } }],
            xAxes: [{ gridLines: { display: false }, ticks: { maxRotation: 45, minRotation: 0, maxTicksLimit: 31, autoSkip: false } }]
          }
        }
      });
    }

    function groupByWeek(s, sb, t, ly, lb) {
      var gs = [], gsb = [], gt = [], gly = [], gl = [];
      for (var i = 0; i < s.length; i += 7) {
        var ws = 0, wsb = 0, wt = 0, wly = 0;
        for (var j = 0; j < 7 && (i + j) < s.length; j++) { ws += s[i + j] || 0; wsb += sb[i + j] || 0; wt += t[i + j] || 0; wly += ly[i + j] || 0; }
        gs.push(ws); gsb.push(wsb); gt.push(wt); gly.push(wly); gl.push('Week ' + (Math.floor(i / 7) + 1));
      }
      return { sales: gs, sbaseSales: gsb, targets: gt, lastYear: gly, labels: gl };
    }

    function groupByMonth(s, sb, t, ly) {
      return {
        sales: [s.reduce(function (a, b) { return a + b; }, 0)],
        sbaseSales: [sb.reduce(function (a, b) { return a + b; }, 0)],
        targets: [t.reduce(function (a, b) { return a + b; }, 0)],
        lastYear: [ly.reduce(function (a, b) { return a + b; }, 0)],
        labels: ['Monthly Total']
      };
    }

    var btns = document.querySelectorAll('#sales-range-toggle button');
    btns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        btns.forEach(function (b) { b.classList.remove('bg-indigo-50', 'text-indigo-600'); b.classList.add('text-slate-600'); });
        this.classList.remove('text-slate-600');
        this.classList.add('bg-indigo-50', 'text-indigo-600');
        var txt = this.textContent.trim();
        if (txt === 'Day') { curSales = origSales.slice(); curSbase = origSbase.slice(); curTarget = origTarget.slice(); curLY = origLY.slice(); curLabels = origLabels.slice(); }
        else if (txt === 'Week') { var w = groupByWeek(origSales, origSbase, origTarget, origLY, origLabels); curSales = w.sales; curSbase = w.sbaseSales; curTarget = w.targets; curLY = w.lastYear; curLabels = w.labels; }
        else if (txt === 'Month') { var m = groupByMonth(origSales, origSbase, origTarget, origLY); curSales = m.sales; curSbase = m.sbaseSales; curTarget = m.targets; curLY = m.lastYear; curLabels = m.labels; }
        updateChart();
      });
    });

    if (origSales.length > 0) updateChart();
  }

  /* ======================== PERFORMANCE TABLE ======================== */
  function renderPerformance(d, EL, ELP) {
    var pd = d.store_performance_data || [];
    var rows = '';
    pd.forEach(function (s) {
      var gr = s.ly > 0 ? ((s.act / s.ly) - 1) * 100 : null;
      var sc = s.status === 'Excellent' ? 'bg-emerald-100 text-emerald-800' : s.status === 'Good' ? 'bg-green-100 text-green-800' : s.status === 'Recovery' ? 'bg-yellow-100 text-yellow-800' : s.status === 'Critical' ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800';
      rows += '<tr><td class="px-4 py-3 text-sm font-medium text-slate-900">' + esc(s.store_name) + '</td>' +
        '<td class="px-4 py-3 text-sm text-slate-700 text-right">' + peso(s.act) + '</td>' +
        '<td class="px-4 py-3 text-sm text-slate-700 text-right">' + peso(s.ads) + '</td>' +
        '<td class="px-4 py-3 text-sm text-slate-700 text-right">' + peso(s.ly) + '</td>' +
        '<td class="px-4 py-3 text-sm text-slate-700 text-right">' + pct(s.ar_tgt_percent) + '</td>' +
        '<td class="px-4 py-3 text-sm text-slate-700 text-right">' + (gr !== null ? pct(gr) : '-') + '</td>' +
        '<td class="px-4 py-3 text-sm text-center"><span class="px-2 py-1 text-xs font-medium rounded-full ' + sc + '">' + esc(s.status) + '</span></td></tr>';
    });

    document.getElementById('dsh-performance').innerHTML =
      '<div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">' +
        '<div class="mb-6"><h2 class="text-lg font-bold text-slate-900">Per ' + esc(EL) + ' Performance (Net Sales)</h2><p class="text-sm text-slate-500 mt-1">Monthly performance by ' + esc(EL.toLowerCase()) + '</p></div>' +
        '<div class="overflow-x-auto"><table class="min-w-full divide-y divide-slate-200"><thead class="bg-slate-50"><tr>' +
          '<th class="px-4 py-3 text-left text-xs font-medium text-slate-500 uppercase tracking-wider">' + esc(EL) + ' Name</th>' +
          '<th class="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Act</th>' +
          '<th class="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">ADS</th>' +
          '<th class="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">Ly</th>' +
          '<th class="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">AR % Tgt</th>' +
          '<th class="px-4 py-3 text-right text-xs font-medium text-slate-500 uppercase tracking-wider">% Gr</th>' +
          '<th class="px-4 py-3 text-center text-xs font-medium text-slate-500 uppercase tracking-wider">Status</th>' +
        '</tr></thead><tbody class="bg-white divide-y divide-slate-200">' + rows + '</tbody></table></div></div>';
  }

  /* ======================== PRODUCT MIX ======================== */
  function renderProductMix(d, EL) {
    var pm = d.store_product_mix || [];
    var toggleBtns = '<button type="button" class="store-pie-toggle inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors border-indigo-600 bg-indigo-600 text-white" data-store-index="all">All</button>';
    pm.forEach(function (item, i) {
      toggleBtns += '<button type="button" class="store-pie-toggle inline-flex max-w-[180px] items-center truncate rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200" data-store-index="' + i + '" title="' + esc(item.store_name) + '">' + esc(item.store_name) + '</button>';
    });

    document.getElementById('dsh-product-mix').innerHTML =
      '<div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">' +
        '<div class="mb-5 flex items-start justify-between gap-4"><div><h2 class="text-lg font-bold text-slate-900">Product Mix</h2><p class="text-sm text-slate-500 mt-1">Peso mix (pie) and qty mix (bar) per ' + esc(EL.toLowerCase()) + '</p></div>' +
        '<div class="text-right flex flex-col items-end gap-2"><button id="openProductMixLabelsBtn" type="button" class="inline-flex items-center rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-200">Show Labels</button>' +
        '<p class="text-[11px] uppercase tracking-wide text-slate-400">Total Peso Value</p><p id="storePieTotalUnits" class="text-xl font-bold text-slate-900">0</p></div></div>' +
        '<div id="storePieToggleGroup" class="mb-4 flex flex-wrap gap-2">' + toggleBtns + '</div>' +
        '<div id="productMixCategoryFilter" class="mb-4 flex flex-wrap gap-2"></div>' +
        '<div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">' +
          '<div id="storeProductsPieChartPanel" class="relative rounded-xl border border-slate-200 bg-slate-50/50 p-3">' +
            '<button type="button" class="chart-zoom-trigger absolute right-2 top-2 z-10 inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-100" data-panel-id="storeProductsPieChartPanel" data-panel-title="Product Mix Peso (Pie)"><svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 4.75A1.75 1.75 0 0 1 4.75 3h3.5a.75.75 0 0 1 0 1.5h-3A.25.25 0 0 0 5 4.75v3a.75.75 0 0 1-1.5 0v-3Zm10.25-1A1.75 1.75 0 0 1 15 4.75v3a.75.75 0 0 1-1.5 0v-3a.25.25 0 0 0-.25-.25h-3a.75.75 0 0 1 0-1.5h3.5ZM4.25 11.5a.75.75 0 0 1 .75.75v3a.25.25 0 0 0 .25.25h3a.75.75 0 0 1 0 1.5h-3.5A1.75 1.75 0 0 1 3 15.25v-3a.75.75 0 0 1 .75-.75Zm10.5 0a.75.75 0 0 1 .75.75v3a1.75 1.75 0 0 1-1.75 1.75h-3.5a.75.75 0 0 1 0-1.5h3a.25.25 0 0 0 .25-.25v-3a.75.75 0 0 1 .75-.75Z" clip-rule="evenodd" /></svg></button>' +
            '<div id="storeProductsPieChartWrap" class="mx-auto h-60 w-full max-w-[260px]"><canvas id="storeProductsPieChart"></canvas></div>' +
          '</div>' +
          '<div id="storeProductsQtyBarChartPanel" class="relative rounded-xl border border-slate-200 bg-slate-50/50 p-3">' +
            '<button type="button" class="chart-zoom-trigger absolute right-2 top-2 z-10 inline-flex items-center rounded-md border border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm transition-colors hover:bg-slate-100" data-panel-id="storeProductsQtyBarChartPanel" data-panel-title="Product Mix Qty (Bar)"><svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 4.75A1.75 1.75 0 0 1 4.75 3h3.5a.75.75 0 0 1 0 1.5h-3A.25.25 0 0 0 5 4.75v3a.75.75 0 0 1-1.5 0v-3Zm10.25-1A1.75 1.75 0 0 1 15 4.75v3a.75.75 0 0 1-1.5 0v-3a.25.25 0 0 0-.25-.25h-3a.75.75 0 0 1 0-1.5h3.5ZM4.25 11.5a.75.75 0 0 1 .75.75v3a.25.25 0 0 0 .25.25h3a.75.75 0 0 1 0 1.5h-3.5A1.75 1.75 0 0 1 3 15.25v-3a.75.75 0 0 1 .75-.75Zm10.5 0a.75.75 0 0 1 .75.75v3a1.75 1.75 0 0 1-1.75 1.75h-3.5a.75.75 0 0 1 0-1.5h3a.25.25 0 0 0 .25-.25v-3a.75.75 0 0 1 .75-.75Z" clip-rule="evenodd" /></svg></button>' +
            '<div id="storeProductsQtyBarChartWrap" class="h-72 w-full"><canvas id="storeProductsQtyBarChart"></canvas></div>' +
            '<div id="storePieLegend" class="hidden ml-auto space-y-2 max-w-[340px]"></div>' +
          '</div>' +
        '</div>' +
      '</div>';

    if (pm.length > 0) setupProductMixCharts(d);
  }

  function setupProductMixCharts(d) {
    var pm = d.store_product_mix || [];
    var ALLOWED = ['Greeting Cakes', 'Premium', 'Rolls', 'Tray Product'];
    var activeStore = 'all';
    var activeCat = 'all';
    var pieChart = null, barChart = null;
    var zoomModal = document.getElementById('chartZoomModal');
    var zoomHost = document.getElementById('chartZoomHost');
    var zoomTitle = document.getElementById('chartZoomTitle');
    var zoomBackdrop = document.getElementById('chartZoomBackdrop');
    var closeZoom = document.getElementById('closeChartZoomBtn');
    var labelsModal = document.getElementById('productMixLabelsModal');
    var pieCanvas = document.getElementById('storeProductsPieChart');
    var barCanvas = document.getElementById('storeProductsQtyBarChart');
    var legendEl = document.getElementById('storePieLegend');
    var legendModal = document.getElementById('storePieLegendModal');
    var totalEl = document.getElementById('storePieTotalUnits');
    var catFilter = document.getElementById('productMixCategoryFilter');
    var activeZoomState = null;

    var piePlugin = {
      id: 'piePercentLabels',
      afterDatasetsDraw: function (chart) {
        var ds = chart.data && chart.data.datasets ? chart.data.datasets[0] : null;
        if (!ds || !ds.data) return;
        var vals = ds.data.map(function (v) { return Number(v || 0); });
        var total = vals.reduce(function (a, b) { return a + b; }, 0);
        if (total <= 0) return;
        var meta = chart.getDatasetMeta(0);
        var ctx = chart.ctx;
        ctx.save();
        ctx.font = '600 11px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        vals.forEach(function (v, i) {
          if (!v || !meta.data[i]) return;
          var share = (v / total) * 100;
          if (share < 4) return;
          var pos = meta.data[i].tooltipPosition();
          var label = share.toFixed(1) + '%';
          ctx.strokeStyle = dark ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.9)';
          ctx.lineWidth = 3;
          ctx.strokeText(label, pos.x, pos.y);
          ctx.fillStyle = chartStrongColor;
          ctx.fillText(label, pos.x, pos.y);
        });
        ctx.restore();
      }
    };

    function normalizeCat(cat, name) {
      var n = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); };
      var ck = n(cat), nk = n(name), m = ck + ' ' + nk;
      if (m.indexOf('tray') >= 0) return 'Tray Product';
      if (m.indexOf('greetingcake') >= 0 || ck === 'gc' || nk.indexOf('gc') === 0) return 'Greeting Cakes';
      if (m.indexOf('premium') >= 0) return 'Premium';
      if (m.indexOf('roll') >= 0) return 'Rolls';
      return null;
    }

    function getProducts(idx) {
      var prods = [];
      if (idx === 'all') {
        var agg = {};
        pm.forEach(function (s) { (s.products || []).forEach(function (p) {
          var k = (p.name || '').toLowerCase() + '|' + (p.category || '').toLowerCase();
          if (!agg[k]) agg[k] = { name: p.name || 'Unnamed Product', category: p.category || 'Uncategorized', qty: 0, net_sales: 0 };
          agg[k].qty += Number(p.qty || 0); agg[k].net_sales += Number(p.net_sales || 0);
        }); });
        Object.values(agg).forEach(function (p) { prods.push(p); });
      } else {
        var s = pm[idx]; if (s) (s.products || []).forEach(function (p) { prods.push(p); });
      }
      return prods;
    }

    function renderCatButtons() {
      if (!catFilter) return;
      var h = '<button type="button" class="product-mix-category-toggle inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ' + (activeCat === 'all' ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200') + '" data-category="all">All</button>';
      ALLOWED.forEach(function (c) {
        h += '<button type="button" class="product-mix-category-toggle inline-flex max-w-[180px] items-center truncate rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ' + (activeCat === c ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200') + '" data-category="' + encodeURIComponent(c) + '">' + esc(c) + '</button>';
      });
      catFilter.innerHTML = h;
    }

    function renderPie() {
      var all = getProducts(activeStore);
      var normed = all.map(function (p) { return { name: p.name, qty: p.qty, net_sales: p.net_sales, category: p.category, nc: normalizeCat(p.category, p.name) }; }).filter(function (p) { return p.nc; });
      var filtered = activeCat === 'all' ? normed : normed.filter(function (p) { return p.nc === activeCat; });
      var totalPeso = filtered.reduce(function (a, p) { return a + Number(p.net_sales || 0); }, 0);
      var totalQty = filtered.reduce(function (a, p) { return a + Number(p.qty || 0); }, 0);
      if (totalEl) totalEl.textContent = '\u20B1' + totalPeso.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

      var legendHtml = filtered.map(function (p, i) {
        var share = totalPeso > 0 ? (Number(p.net_sales || 0) / totalPeso) * 100 : 0;
        var color = 'hsl(' + ((i * 41) % 360) + ', 72%, 52%)';
        return '<div class="w-full max-w-[340px] flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><div class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full" style="background-color:' + color + '"></span><span class="max-w-[170px] truncate text-xs font-medium text-slate-700" title="' + esc(p.name) + '">' + esc(p.name) + '</span></div><div class="text-right"><div class="text-xs font-semibold text-slate-900">\u20B1' + Number(p.net_sales || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '</div><div class="text-[11px] text-slate-500">' + fmt(p.qty) + ' pcs</div><div class="text-[11px] text-slate-500">' + share.toFixed(1) + '%</div></div></div>';
      }).join('') || '<div class="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">No products in this category.</div>';
      if (legendEl) legendEl.innerHTML = legendHtml;
      if (legendModal) legendModal.innerHTML = legendHtml;

      var isCompact = window.matchMedia('(max-width:640px)').matches;
      var trunc = function (v, lim) { var l = String(v || ''); var mx = lim || (isCompact ? 18 : 34); return l.length > mx ? l.slice(0, mx - 1) + '\u2026' : l; };

      if (typeof Chart !== 'undefined') {
        if (pieChart) pieChart.destroy();
        pieChart = new Chart(pieCanvas.getContext('2d'), {
          plugins: [piePlugin], type: 'doughnut',
          data: { labels: filtered.map(function (p) { return p.name; }), datasets: [{ data: filtered.map(function (p) { return Number(p.net_sales || 0); }), backgroundColor: filtered.map(function (_, i) { return 'hsl(' + ((i * 41) % 360) + ', 72%, 52%)'; }), borderColor: '#fff', borderWidth: 2 }] },
          options: { responsive: true, maintainAspectRatio: false, cutout: '58%', legend: { display: false }, plugins: { piePercentLabels: { minShare: 4 }, tooltip: { callbacks: { label: function (ctx) { var v = Number(ctx.parsed || 0); var s = totalPeso > 0 ? (v / totalPeso) * 100 : 0; return trunc(ctx.label, isCompact ? 24 : 42) + ': \u20B1' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' (' + s.toFixed(1) + '%)'; } } } } }
        });
      }

      if (typeof Chart !== 'undefined' && barCanvas) {
        if (barChart) barChart.destroy();
        var bLabels = filtered.length ? filtered.map(function (p) { return p.name; }) : ['No products'];
        var bVals = filtered.length ? filtered.map(function (p) { return Number(p.qty || 0); }) : [0];
        var bColors = bLabels.map(function (_, i) { return 'hsl(' + (220 - i * 7) + ', 76%,' + Math.max(35, 60 - i) + '%)'; });
        barChart = new Chart(barCanvas.getContext('2d'), {
          type: 'horizontalBar',
          data: { labels: bLabels, datasets: [{ label: 'Qty Sold', data: bVals, backgroundColor: bColors, borderColor: bColors, borderWidth: 1 }] },
          options: { responsive: true, maintainAspectRatio: false, legend: { display: false }, tooltips: { callbacks: { label: function (t) { return fmt(t.xLabel) + ' pcs'; } } },
            scales: { xAxes: [{ ticks: { fontColor: chartTextColor, beginAtZero: true, callback: function (v) { return fmt(v); } }, gridLines: { color: 'rgba(226,232,240,0.7)' } }], yAxes: [{ ticks: { fontColor: chartTextColor, callback: function (v) { return trunc(v); } }, gridLines: { display: false } }] } }
        });
      }
    }

    document.querySelectorAll('.store-pie-toggle').forEach(function (btn) {
      btn.addEventListener('click', function () {
        activeStore = this.getAttribute('data-store-index') || 'all';
        document.querySelectorAll('.store-pie-toggle').forEach(function (b) {
          if (b.getAttribute('data-store-index') === String(activeStore)) { b.classList.remove('border-slate-200', 'bg-slate-100', 'text-slate-700'); b.classList.add('border-indigo-600', 'bg-indigo-600', 'text-white'); }
          else { b.classList.remove('border-indigo-600', 'bg-indigo-600', 'text-white'); b.classList.add('border-slate-200', 'bg-slate-100', 'text-slate-700'); }
        });
        renderCatButtons();
        renderPie();
      });
    });

    if (catFilter) catFilter.addEventListener('click', function (e) {
      var btn = e.target.closest('.product-mix-category-toggle');
      if (!btn) return;
      activeCat = btn.getAttribute('data-category') === 'all' ? 'all' : decodeURIComponent(btn.getAttribute('data-category'));
      renderPie();
    });

    if (document.getElementById('openProductMixLabelsBtn')) document.getElementById('openProductMixLabelsBtn').addEventListener('click', function () { if (labelsModal) { labelsModal.classList.remove('hidden'); document.body.classList.add('overflow-hidden'); } });
    if (document.getElementById('closeProductMixLabelsBtn')) document.getElementById('closeProductMixLabelsBtn').addEventListener('click', function () { if (labelsModal) { labelsModal.classList.add('hidden'); document.body.classList.remove('overflow-hidden'); } });
    if (document.getElementById('productMixLabelsBackdrop')) document.getElementById('productMixLabelsBackdrop').addEventListener('click', function () { if (labelsModal) { labelsModal.classList.remove('hidden'); document.body.classList.remove('overflow-hidden'); } });

    document.querySelectorAll('.chart-zoom-trigger').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var panelId = this.getAttribute('data-panel-id');
        var panelTitle = this.getAttribute('data-panel-title');
        var panel = document.getElementById(panelId);
        if (!panel || !zoomHost) return;
        if (activeZoomState) { closeZoomFn(); }
        activeZoomState = { panel: panel, parent: panel.parentElement, next: panel.nextElementSibling };
        zoomHost.innerHTML = '';
        zoomHost.appendChild(panel);
        zoomTitle.textContent = panelTitle || 'Chart';
        zoomModal.classList.remove('hidden');
        document.body.classList.add('overflow-hidden');
      });
    });

    function closeZoomFn() {
      if (!activeZoomState) return;
      var p = activeZoomState;
      if (p.next && p.next.parentElement === p.parent) p.parent.insertBefore(p.panel, p.next);
      else p.parent.appendChild(p.panel);
      zoomHost.innerHTML = '';
      zoomModal.classList.add('hidden');
      document.body.classList.remove('overflow-hidden');
      activeZoomState = null;
    }
    if (zoomBackdrop) zoomBackdrop.addEventListener('click', closeZoomFn);
    if (closeZoom) closeZoom.addEventListener('click', closeZoomFn);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && activeZoomState) closeZoomFn(); });

    renderCatButtons();
    renderPie();
  }

  /* ======================== POS SOLD ======================== */
  function renderPosSold(d, EL) {
    var ps = d.pos_sold_products_by_store || [];
    var storeBtns = '<button type="button" class="pos-sold-store-toggle inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors border-indigo-600 bg-indigo-600 text-white" data-entity-index="all">All</button>';
    ps.forEach(function (item, i) {
      storeBtns += '<button type="button" class="pos-sold-store-toggle inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200" data-entity-index="' + i + '">' + esc(item.store_name) + '</button>';
    });
    var catStoreBtns = '<button type="button" class="pos-mix-cat-store-toggle inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors border-indigo-600 bg-indigo-600 text-white" data-entity-index="all">All</button>';
    ps.forEach(function (item, i) {
      catStoreBtns += '<button type="button" class="pos-mix-cat-store-toggle inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200" data-entity-index="' + i + '">' + esc(item.store_name) + '</button>';
    });

    var hasData = ps.length > 0;
    document.getElementById('dsh-pos-sold').innerHTML =
      '<div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">' +
        '<div class="mb-5 space-y-2"><div class="flex flex-wrap items-center justify-between gap-2"><h2 class="text-lg font-bold text-slate-900">Products Sold (POS)</h2>' +
        '<div class="flex items-center gap-2"><button type="button" class="pos-sold-metric-toggle inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors border-indigo-600 bg-indigo-600 text-white" data-metric="volume">Volume</button>' +
        '<button type="button" class="pos-sold-metric-toggle inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors border-slate-200 bg-slate-100 text-slate-700 hover:bg-slate-200" data-metric="peso">Peso Value</button></div></div>' +
        '<div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3"><p class="text-sm text-slate-500">Top 10 products sold per ' + esc(EL.toLowerCase()) + '</p><p id="posSoldTotalUnits" class="max-w-full break-words text-base font-bold text-slate-900 sm:text-xl sm:text-right">Total: _____</p></div></div>' +
        (hasData ? '<div class="mb-4 flex flex-wrap gap-2">' + storeBtns + '</div><div class="relative h-96 overflow-hidden"><canvas id="posSoldProductsBarChart"></canvas></div>' : '<div class="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">No POS sold data available for this period.</div>') +
      '</div>' +
      '<div class="bg-white p-6 rounded-2xl shadow-sm border border-slate-100">' +
        '<div class="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h2 class="text-lg font-bold text-slate-900">Product Mix Category</h2><p class="text-sm text-slate-500 mt-1">Products pie chart with all categories</p></div>' +
        '<div class="text-right"><p class="text-[11px] uppercase tracking-wide text-slate-400">Total Pcs</p><p id="posMixCategoryTotalUnits" class="text-xl font-bold text-slate-900">0</p></div></div>' +
        (hasData ? '<div class="mb-4 flex flex-wrap gap-2">' + catStoreBtns + '</div><div class="grid grid-cols-1 items-start gap-4 md:grid-cols-5"><div class="md:col-span-2"><div class="mx-auto h-72 w-full max-w-[320px]"><canvas id="posMixCategoryPieChart"></canvas></div></div><div class="md:col-span-3"><div id="posMixCategoryLegend" class="space-y-2 max-w-[190px] ml-auto"></div></div></div>' : '<div class="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">No category data available for this period.</div>') +
      '</div>';

    if (hasData) setupPosSoldCharts(d);
  }

  function setupPosSoldCharts(d) {
    var ps = d.pos_sold_products_by_store || [];
    var EXCLUDED_KEY = 'cmapp_pos_mix_category_excluded_v1';
    var activeStore = 'all';
    var activeMetric = 'volume';
    var activeCatStore = 'all';
    var posChart = null, catPie = null;
    var excluded = new Set();
    try { var raw = localStorage.getItem(EXCLUDED_KEY); var parsed = raw ? JSON.parse(raw) : []; if (Array.isArray(parsed)) excluded = new Set(parsed.filter(Boolean)); } catch (e) {}

    function persistExcluded() { try { localStorage.setItem(EXCLUDED_KEY, JSON.stringify(Array.from(excluded))); } catch (e) {} }

    function normProducts(idx) {
      var norm = function (ps2) { return (Array.isArray(ps2) ? ps2 : []).map(function (p) { return { name: (p.name || '').trim() || 'Unnamed Product', qty: Number(p.qty || 0), net_sales: Number(p.net_sales || 0), category: (p.category || '').trim() || 'Uncategorized' }; }); };
      if (idx === 'all') {
        var agg = {};
        ps.forEach(function (s) { norm(s.products).forEach(function (p) { var k = p.name.toLowerCase(); if (!agg[k]) agg[k] = { name: p.name, qty: 0, net_sales: 0, category: p.category }; agg[k].qty += p.qty; agg[k].net_sales += p.net_sales; }); });
        return Object.values(agg);
      }
      var i = parseInt(idx, 10); i = Number.isFinite(i) ? Math.min(Math.max(i, 0), ps.length - 1) : 0;
      return norm(ps[i] ? ps[i].products : []);
    }

    function updateBtn(btns, active) {
      btns.forEach(function (b) {
        if (String(b.getAttribute('data-entity-index') || '') === String(active)) { b.classList.remove('border-slate-200', 'bg-slate-100', 'text-slate-700'); b.classList.add('border-indigo-600', 'bg-indigo-600', 'text-white'); }
        else { b.classList.remove('border-indigo-600', 'bg-indigo-600', 'text-white'); b.classList.add('border-slate-200', 'bg-slate-100', 'text-slate-700'); }
      });
    }

    var posCanvas = document.getElementById('posSoldProductsBarChart');
    var posTotalEl = document.getElementById('posSoldTotalUnits');
    var catCanvas = document.getElementById('posMixCategoryPieChart');
    var catLegend = document.getElementById('posMixCategoryLegend');
    var catTotalEl = document.getElementById('posMixCategoryTotalUnits');
    var isCompact = window.matchMedia('(max-width:640px)').matches;
    var truncLabel = function (v) { var l = String(v || ''); var mx = isCompact ? 22 : 34; return l.length > mx ? l.slice(0, mx - 1) + '\u2026' : l; };

    var piePlugin = {
      id: 'piePercentLabels',
      afterDatasetsDraw: function (chart) {
        var ds = chart.data && chart.data.datasets ? chart.data.datasets[0] : null;
        if (!ds || !ds.data) return;
        var vals = ds.data.map(function (v) { return Number(v || 0); });
        var total = vals.reduce(function (a, b) { return a + b; }, 0);
        if (total <= 0) return;
        var meta = chart.getDatasetMeta(0);
        var ctx = chart.ctx;
        ctx.save(); ctx.font = '600 11px Inter, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        vals.forEach(function (v, i) {
          if (!v || !meta.data[i]) return;
          var share = (v / total) * 100;
          if (share < 4) return;
          var pos = meta.data[i].tooltipPosition();
          ctx.strokeStyle = dark ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.9)'; ctx.lineWidth = 3;
          ctx.strokeText(share.toFixed(1) + '%', pos.x, pos.y);
          ctx.fillStyle = chartStrongColor;
          ctx.fillText(share.toFixed(1) + '%', pos.x, pos.y);
        });
        ctx.restore();
      }
    };

    function renderBar() {
      var prods = normProducts(activeStore);
      var mk = activeMetric === 'peso' ? 'net_sales' : 'qty';
      prods.sort(function (a, b) { return Number(b[mk] || 0) - Number(a[mk] || 0); });
      var total = prods.reduce(function (a, p) { return a + Number(p[mk] || 0); }, 0);
      if (posTotalEl) posTotalEl.textContent = activeMetric === 'peso' ? 'Total: \u20B1' + total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : 'Total: ' + fmt(total) + ' pc/s';
      var top = prods.slice(0, 10);
      if (posChart) posChart.destroy();
      var labels = top.length ? top.map(function (p) { return p.name; }) : ['No POS sold data'];
      var vals = top.length ? top.map(function (p) { return Number(p[mk] || 0); }) : [0];
      var colors = labels.map(function (_, i) { return 'hsl(' + (220 - i * 7) + ', 76%,' + Math.max(35, 60 - i) + '%)'; });
      posChart = new Chart(posCanvas.getContext('2d'), {
        type: 'horizontalBar',
        data: { labels: labels, datasets: [{ label: activeMetric === 'peso' ? 'POS Sold Net Sales' : 'POS Sold Qty', data: vals, backgroundColor: colors, borderColor: colors, borderWidth: 1 }] },
        options: { responsive: true, maintainAspectRatio: false, legend: { display: false },
          tooltips: { callbacks: { label: function (t) { var v = Number(t.xLabel || 0); var row = top[t.index] || {}; if (activeMetric === 'peso') return '\u20B1' + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' (' + (row.category || 'Uncategorized') + ')'; return fmt(v) + ' pcs (' + (row.category || 'Uncategorized') + ')'; } } },
          scales: { xAxes: [{ ticks: { beginAtZero: true, callback: function (v) { return activeMetric === 'peso' ? '\u20B1' + fmt(v) : fmt(v); } }, gridLines: { color: 'rgba(226,232,240,0.7)' } }], yAxes: [{ ticks: { fontColor: chartTextColor, fontSize: isCompact ? 10 : 12, callback: truncLabel }, gridLines: { display: false } }] } }
      });
      updateBtn(document.querySelectorAll('.pos-sold-store-toggle'), activeStore);
      document.querySelectorAll('.pos-sold-metric-toggle').forEach(function (b) {
        if (b.getAttribute('data-metric') === activeMetric) { b.classList.remove('border-slate-200', 'bg-slate-100', 'text-slate-700'); b.classList.add('border-indigo-600', 'bg-indigo-600', 'text-white'); }
        else { b.classList.remove('border-indigo-600', 'bg-indigo-600', 'text-white'); b.classList.add('border-slate-200', 'bg-slate-100', 'text-slate-700'); }
      });
    }

    function renderCatPie() {
      var prods = normProducts(activeCatStore);
      var catMap = {};
      prods.forEach(function (p) { var c = p.category || 'Uncategorized'; catMap[c] = (catMap[c] || 0) + Number(p.qty || 0); });
      var allRows = Object.keys(catMap).map(function (n) { return { name: n, qty: catMap[n] }; }).filter(function (r) { return r.qty > 0; }).sort(function (a, b) { return b.qty - a.qty; });
      var visible = allRows.filter(function (r) { return !excluded.has(r.name); });
      var total = visible.reduce(function (a, r) { return a + r.qty; }, 0);
      if (catTotalEl) catTotalEl.textContent = fmt(total);
      var colorMap = {};
      allRows.forEach(function (r, i) { colorMap[r.name] = 'hsl(' + ((i * 41) % 360) + ', 72%, 52%)'; });

      if (catLegend) catLegend.innerHTML = allRows.map(function (r) {
        var isEx = excluded.has(r.name);
        var share = total > 0 ? (r.qty / total) * 100 : 0;
        return '<button type="button" class="pos-mix-category-legend-item w-full max-w-[190px] flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 ' + (isEx ? 'opacity-45 border-dashed cursor-pointer' : 'cursor-pointer') + '" data-category="' + encodeURIComponent(r.name) + '"><div class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full" style="background-color:' + colorMap[r.name] + '"></span><span class="text-xs font-medium text-slate-700">' + esc(r.name) + '</span></div><span class="text-[11px] text-slate-500">' + (isEx ? 'Excluded' : share.toFixed(1) + '%') + '</span></button>';
      }).join('') || '<div class="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">No category data available.</div>';

      if (catPie) catPie.destroy();
      catPie = new Chart(catCanvas.getContext('2d'), {
        plugins: [piePlugin], type: 'doughnut',
        data: { labels: visible.map(function (r) { return r.name; }), datasets: [{ data: visible.map(function (r) { return r.qty; }), backgroundColor: visible.map(function (r) { return colorMap[r.name]; }), borderColor: '#fff', borderWidth: 2 }] },
        options: { responsive: true, maintainAspectRatio: false, cutout: '58%', legend: { display: false }, plugins: { piePercentLabels: { minShare: 4 }, tooltip: { callbacks: { label: function (ctx) { var v = Number(ctx.parsed || 0); var s = total > 0 ? (v / total) * 100 : 0; return (ctx.label || '') + ': ' + fmt(v) + ' pcs (' + s.toFixed(1) + '%)'; } } } } }
      });
      updateBtn(document.querySelectorAll('.pos-mix-cat-store-toggle'), activeCatStore);
    }

    document.querySelectorAll('.pos-sold-store-toggle').forEach(function (b) { b.addEventListener('click', function () { activeStore = this.getAttribute('data-entity-index') || 'all'; renderBar(); }); });
    document.querySelectorAll('.pos-sold-metric-toggle').forEach(function (b) { b.addEventListener('click', function () { activeMetric = this.getAttribute('data-metric') || 'volume'; renderBar(); }); });
    document.querySelectorAll('.pos-mix-cat-store-toggle').forEach(function (b) { b.addEventListener('click', function () { activeCatStore = this.getAttribute('data-entity-index') || 'all'; renderCatPie(); }); });
    if (catLegend) catLegend.addEventListener('click', function (e) {
      var btn = e.target.closest('.pos-mix-category-legend-item');
      if (!btn) return;
      var cat = decodeURIComponent(btn.getAttribute('data-category') || '');
      if (!cat) return;
      if (excluded.has(cat)) excluded.delete(cat); else excluded.add(cat);
      persistExcluded();
      renderCatPie();
    });

    renderBar();
    renderCatPie();
  }

  /* ======================== RANKINGS + ATTAINMENT + ICU ======================== */
  function renderRankings(d, EL, ELP) {
    var ads = d.top_stores_ads || [];
    var ar = d.top_attainment_ar || [];
    var icu = d.icu_stores || [];

    var adsHtml = '';
    if (ads.length) {
      ads.forEach(function (s) {
        var medal = s.rank === 1 ? 'bg-amber-100 text-amber-700' : s.rank === 2 ? 'bg-slate-200 text-slate-700' : 'bg-orange-100 text-orange-700';
        adsHtml += '<div class="rounded-xl border border-slate-200 bg-white p-3"><div class="mb-2 flex items-center justify-between"><h3 class="truncate pr-3 text-sm font-bold text-slate-900">' + esc(s.store_name) + '</h3><span class="inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ' + medal + '">' + s.rank + '</span></div><div class="flex items-end justify-between"><p class="text-xl font-extrabold leading-none text-slate-900">' + peso(s.ads) + '</p><p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">ADS</p></div></div>';
      });
    } else {
      adsHtml = '<div class="rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm text-slate-500">No ADS data available for the selected period.</div>';
    }

    var arHtml = '';
    if (ar.length) {
      ar.forEach(function (s) {
        arHtml += '<div class="rounded-xl border border-emerald-200/70 bg-white p-3"><div class="mb-2 flex items-start justify-between gap-2"><h3 class="truncate text-sm font-bold text-slate-900">' + esc(s.store_name) + '</h3><span class="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">' + pct(s.ar_tgt_percent) + '</span></div><div class="mb-2 flex items-center justify-between text-xs"><span class="text-slate-500">Target: ' + peso(s.target_mtd) + '</span><span class="font-semibold text-slate-700">Actual: ' + peso(s.act) + '</span></div><div class="h-1.5 overflow-hidden rounded-full bg-emerald-100"><div class="h-full rounded-full bg-emerald-500" style="width:' + Math.min(Math.max(s.progress_percent || 0, 0), 100) + '%"></div></div></div>';
      });
    } else {
      arHtml = '<div class="rounded-xl border border-dashed border-emerald-300 bg-white px-4 py-6 text-center text-sm text-slate-500">No attainment data available for the selected period.</div>';
    }

    var icuHtml = '';
    if (icu.length) {
      icu.forEach(function (s) {
        icuHtml += '<div class="rounded-xl border border-rose-200/70 bg-white p-3"><div class="mb-2 flex items-start justify-between gap-2"><div><h3 class="text-sm font-bold text-slate-900">' + esc(s.store_name) + '</h3><p class="mt-0.5 text-xs text-slate-500">' + esc(s.note) + '</p></div><span class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ' + (s.tone_badge || '') + '">' + esc(s.status) + '</span></div><div class="space-y-1 text-xs"><div class="flex items-center justify-between"><span class="text-slate-500">Actual</span><span class="font-semibold ' + (s.tone_value || '') + '">' + peso(s.act) + '</span></div><div class="flex items-center justify-between"><span class="text-slate-500">Target</span><span class="font-semibold text-slate-800">' + peso(s.target_mtd) + '</span></div><div class="flex items-center justify-between"><span class="text-slate-500">Attainment</span><span class="font-bold ' + (s.tone_value || '') + '">' + pct(s.attainment_percent) + '</span></div><div class="mt-1.5 h-1.5 overflow-hidden rounded-full ' + (s.tone_bar_bg || '') + '"><div class="h-full rounded-full ' + (s.tone_bar_fill || '') + '" style="width:' + (s.progress_percent || 0) + '%"></div></div></div></div>';
      });
    } else {
      icuHtml = '<div class="rounded-xl border border-dashed border-emerald-300 bg-white px-4 py-6 text-center text-sm text-emerald-700">No ICU/Critical ' + esc(ELP.toLowerCase()) + ' for the selected range.</div>';
    }

    document.getElementById('dsh-rankings').innerHTML =
      '<div class="rounded-2xl border border-slate-200 bg-gradient-to-b from-slate-50 to-white p-5 shadow-sm"><div class="mb-4 flex items-start justify-between"><div><h2 class="text-lg font-bold text-slate-900">' + (EL === 'Store' ? 'Store Ranking' : 'Cluster Ranking') + '</h2><p class="mt-1 text-sm text-slate-500">Highest average daily sales</p></div><span class="inline-flex items-center rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Top 3</span></div><div class="space-y-2.5">' + adsHtml + '</div></div>' +
      '<div class="rounded-2xl border border-emerald-200 bg-gradient-to-b from-emerald-50/70 to-white p-5 shadow-sm"><div class="mb-4 flex items-start justify-between"><div><h2 class="text-lg font-bold text-slate-900">Top 3 Attainment Rate AR</h2><p class="mt-1 text-sm text-slate-500">Achievement rate percentage</p></div><span class="inline-flex items-center rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Leaders</span></div><div class="space-y-2.5">' + arHtml + '</div></div>' +
      '<div class="rounded-2xl border border-rose-200 bg-gradient-to-b from-rose-50/70 to-white p-5 shadow-sm"><div class="mb-4 flex items-start justify-between"><div><h2 class="text-lg font-bold text-slate-900">ICU ' + esc(ELP) + '</h2><p class="mt-1 text-sm text-slate-500">' + esc(ELP) + ' needing attention</p></div><span class="inline-flex items-center rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Urgent</span></div><div class="space-y-2.5">' + icuHtml + '</div></div>';
  }

  /* ======================== BOTTOM SECTIONS (WASTAGE + ICOUNT + DISCOUNT) ======================== */
  function renderBottomSections(d, EL) {
    var wp = d.wastage_performance || {};
    var dp = d.discount_performance || {};
    var ic = d.icount_tool_tracker || {};
    var clName = d.cluster_name || '';

    var wastageWeekRows = '';
    if (wp && wp.rows) {
      wp.rows.forEach(function (r) {
        var pc = (r.percent || 0) > 2 ? 'text-red-600' : (r.percent || 0) > 1 ? 'text-amber-600' : 'text-emerald-600';
        wastageWeekRows += '<tr><td class="px-4 py-2.5 font-medium text-slate-700">' + esc(r.label) + '</td><td class="px-4 py-2.5 text-right text-slate-900">\u20B1' + fmt(r.gross_sales || 0) + '</td><td class="px-4 py-2.5 text-right text-slate-900">\u20B1' + fmt(r.wastage || 0) + '</td><td class="px-4 py-2.5 text-right font-semibold ' + pc + '">' + pct(r.percent || 0) + '</td></tr>';
      });
      if (wp.mtd) {
        var mtdPc = (wp.mtd.percent || 0) > 2 ? 'text-red-700' : (wp.mtd.percent || 0) > 1 ? 'text-amber-700' : 'text-emerald-700';
        wastageWeekRows += '<tr class="bg-slate-50"><td class="px-4 py-2.5 font-bold text-slate-900">' + esc(wp.mtd.label) + '</td><td class="px-4 py-2.5 text-right font-bold text-slate-900">\u20B1' + fmt(wp.mtd.gross_sales || 0) + '</td><td class="px-4 py-2.5 text-right font-bold text-slate-900">\u20B1' + fmt(wp.mtd.wastage || 0) + '</td><td class="px-4 py-2.5 text-right font-extrabold ' + mtdPc + '">' + pct(wp.mtd.percent || 0) + '</td></tr>';
      }
    } else {
      wastageWeekRows = '<tr><td colspan="4" class="px-4 py-6 text-center text-sm text-slate-500">No wastage data available for the selected period.</td></tr>';
    }

    var wastageStoreRows = '';
    if (wp && wp.per_store && wp.per_store.rows) {
      wp.per_store.rows.forEach(function (r) {
        var pc = (r.percent || 0) > 2 ? 'text-red-600' : (r.percent || 0) > 1 ? 'text-amber-600' : 'text-emerald-600';
        wastageStoreRows += '<tr><td class="px-4 py-2.5 font-medium text-slate-700">' + esc(r.store_name) + '</td><td class="px-4 py-2.5 text-right text-slate-900">\u20B1' + fmt(r.gross_sales || 0) + '</td><td class="px-4 py-2.5 text-right text-slate-900">\u20B1' + fmt(r.wastage || 0) + '</td><td class="px-4 py-2.5 text-right font-semibold ' + pc + '">' + pct(r.percent || 0) + '</td></tr>';
      });
      if (wp.per_store.total) {
        var tPc = (wp.per_store.total.percent || 0) > 2 ? 'text-red-700' : (wp.per_store.total.percent || 0) > 1 ? 'text-amber-700' : 'text-emerald-700';
        wastageStoreRows += '<tr class="bg-slate-50"><td class="px-4 py-2.5 font-bold text-slate-900">Total</td><td class="px-4 py-2.5 text-right font-bold text-slate-900">\u20B1' + fmt(wp.per_store.total.gross_sales || 0) + '</td><td class="px-4 py-2.5 text-right font-bold text-slate-900">\u20B1' + fmt(wp.per_store.total.wastage || 0) + '</td><td class="px-4 py-2.5 text-right font-extrabold ' + tPc + '">' + pct(wp.per_store.total.percent || 0) + '</td></tr>';
      }
    } else {
      wastageStoreRows = '<tr><td colspan="4" class="px-4 py-6 text-center text-sm text-slate-500">No per-store wastage data available for the selected period.</td></tr>';
    }

    var icountHtml = '';
    ['daily_reports', 'invensync', 'oracle'].forEach(function (key) {
      var item = ic[key];
      var isComplete = item && (!item.show_missing_details || !item.missing_rows || item.missing_rows.length === 0);
      var badgeCls = isComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700';
      var dotCls = isComplete ? 'bg-emerald-500' : 'bg-amber-500';

      icountHtml += '<section class="bg-white px-5 py-4 flex flex-col"><div class="flex items-center justify-between gap-2"><h4 class="text-sm font-bold text-slate-800">' + (item ? esc(item.label) : key) + '</h4>';
      if (item) {
        icountHtml += '<span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ' + badgeCls + '"><span class="h-2 w-2 rounded-full ' + dotCls + '"></span>' + item.count + '/' + (ic.total_stores || 0) + '</span>';
      }
      icountHtml += '</div>';
      if (item && item.show_missing_details && item.missing_rows && item.missing_rows.length > 0) {
        icountHtml += '<div class="mt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">' + item.missing_rows.length + ' store' + (item.missing_rows.length === 1 ? '' : 's') + ' need update</div>';
        icountHtml += '<div class="icount-scroll-wrap relative mt-2 flex-1"><div class="icount-tracker-scroll max-h-64 overflow-y-auto overscroll-contain pr-3 text-left"><div class="space-y-1.5">';
        item.missing_rows.forEach(function (m) {
          icountHtml += '<div class="icount-tracker-missing-card rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"><div class="status-title flex items-center gap-2 text-sm font-semibold text-amber-800"><span class="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500"></span><span class="min-w-0 flex-1 truncate">' + esc(m.store_name) + '</span></div><p class="status-copy mt-1 text-xs text-amber-800/80">' + m.missing_count + ' missing date' + (m.missing_count === 1 ? '' : 's') + ' in the selected period.</p>';
          if (m.date_ranges && m.date_ranges.length) {
            icountHtml += '<div class="mt-2 flex flex-wrap gap-1.5">';
            m.date_ranges.forEach(function (dr) { icountHtml += '<span class="status-pill rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold text-amber-800 ring-1 ring-amber-200">' + esc(dr) + '</span>'; });
            icountHtml += '</div>';
          }
          icountHtml += '</div>';
        });
        icountHtml += '</div></div><div class="icount-scrollbar" aria-hidden="true"><div class="icount-scrollbar-thumb"></div></div></div>';
      } else if (item && item.show_missing_details) {
        icountHtml += '<div class="icount-tracker-complete-card mt-3 flex flex-1 items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-600"><path d="M20 6 9 17l-5-5"/></svg><span class="status-title text-sm font-bold text-emerald-700">All stores complete</span></div>';
      } else if (item) {
        icountHtml += '<div class="mt-3 flex flex-1 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-xs font-bold text-slate-500">Setup progress</div>';
      } else {
        icountHtml += '<div class="mt-3 flex flex-1 items-center text-sm font-semibold text-slate-400">--</div>';
      }
      icountHtml += '</section>';
    });

    var discRows = '';
    if (dp && dp.rows) {
      dp.rows.forEach(function (r) {
        discRows += '<tr><td class="px-4 py-2.5 font-medium text-slate-700">' + esc(r.label) + '</td><td class="px-4 py-2.5 text-right text-slate-900">\u20B1' + fmt(r.amount || 0) + '</td><td class="px-4 py-2.5 text-right font-semibold text-slate-700">' + pct(r.percent || 0) + '</td></tr>';
      });
      if (dp.mtd) {
        discRows += '<tr class="bg-slate-50"><td class="px-4 py-2.5 font-bold text-slate-900">' + esc(dp.mtd.label) + '</td><td class="px-4 py-2.5 text-right font-bold text-slate-900">\u20B1' + fmt(dp.mtd.amount || 0) + '</td><td class="px-4 py-2.5 text-right font-extrabold text-slate-900">' + pct(dp.mtd.percent || 0) + '</td></tr>';
      }
    } else {
      discRows = '<tr><td colspan="3" class="px-4 py-6 text-center text-sm text-slate-500">No discount data available for the selected period.</td></tr>';
    }

    document.getElementById('dsh-bottom-sections').innerHTML =
      '<div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">' +
        '<div class="mb-4 flex items-start justify-between gap-3"><div><h2 class="text-lg font-bold text-slate-900">' + esc(clName) + ' Wastage Performance</h2><p class="mt-1 text-sm text-slate-500">Weekly and per-store MTD wastage breakdown</p></div>' +
        '<span class="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">' + esc(wp.month_label || '') + '</span></div>' +
        '<div class="grid grid-cols-1 gap-4 xl:grid-cols-2">' +
          '<div class="rounded-xl border border-slate-200"><div class="border-b border-slate-200 bg-slate-50 px-4 py-2.5"><h3 class="text-sm font-bold text-slate-800">' + esc(wp.title_label || 'Wastage Performance') + '</h3></div><div class="overflow-x-auto"><table class="min-w-full divide-y divide-slate-200 text-sm"><thead class="bg-slate-50"><tr><th class="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Week #</th><th class="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Gross Sales</th><th class="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Wastage</th><th class="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">%</th></tr></thead><tbody class="divide-y divide-slate-100 bg-white">' + wastageWeekRows + '</tbody></table></div></div>' +
          '<div class="rounded-xl border border-slate-200"><div class="border-b border-slate-200 bg-slate-50 px-4 py-2.5"><h3 class="text-sm font-bold text-slate-800">' + esc((wp.per_store && wp.per_store.title_label) || 'MTD Wastage Performance Per Store') + '</h3></div><div class="overflow-x-auto"><table class="min-w-full divide-y divide-slate-200 text-sm"><thead class="bg-slate-50"><tr><th class="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Store</th><th class="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Gross Sales</th><th class="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Wastage</th><th class="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">%</th></tr></thead><tbody class="divide-y divide-slate-100 bg-white">' + wastageStoreRows + '</tbody></table></div></div>' +
        '</div>' +
        '<div class="mt-4 space-y-4">' +
          '<div class="rounded-2xl border border-slate-200 bg-white shadow-sm"><div class="flex items-center justify-between gap-3 border-b border-slate-200 px-5 py-3.5"><h3 class="text-sm font-bold text-slate-800">Icount Tool Tracker</h3><span class="text-[11px] font-semibold text-slate-500">' + esc(d.selected_start_date_display || '') + (d.selected_start_date !== d.selected_end_date ? ' - ' + esc(d.selected_end_date_display || '') : '') + '</span></div><div class="grid grid-cols-1 gap-px bg-slate-200 sm:grid-cols-3">' + icountHtml + '</div></div>' +
          '<div class="grid grid-cols-1 gap-4 xl:grid-cols-2"><div class="rounded-xl border border-slate-200"><div class="border-b border-slate-200 bg-slate-50 px-4 py-2.5"><h3 class="text-sm font-bold text-slate-800">' + esc(dp.title_label || 'Discount Performance Breakdown') + '</h3></div><div class="overflow-x-auto"><table class="min-w-full divide-y divide-slate-200 text-sm"><thead class="bg-slate-50"><tr><th class="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Disc Type</th><th class="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</th><th class="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">% Cont</th></tr></thead><tbody class="divide-y divide-slate-100 bg-white">' + discRows + '</tbody></table></div></div></div>' +
        '</div>' +
      '</div>';
  }

  /* ======================== ICOUNT SCROLLBAR SYNC ======================== */
  function setupIcountScrollbars() {
    function sync() {
      document.querySelectorAll('.icount-scroll-wrap').forEach(function (wrap) {
        var scroller = wrap.querySelector('.icount-tracker-scroll');
        var track = wrap.querySelector('.icount-scrollbar');
        var thumb = wrap.querySelector('.icount-scrollbar-thumb');
        if (!scroller || !track || !thumb) return;
        var sh = scroller.scrollHeight || 0, ch = scroller.clientHeight || 0;
        var canScroll = sh > ch + 2;
        track.classList.toggle('is-hidden', !canScroll);
        if (!canScroll) return;
        var th = Math.max(28, Math.round((ch / sh) * (track.clientHeight || ch)));
        var maxT = Math.max(0, (track.clientHeight || ch) - th);
        var maxS = Math.max(1, sh - ch);
        thumb.style.height = th + 'px';
        thumb.style.transform = 'translateY(' + Math.round((scroller.scrollTop / maxS) * maxT) + 'px)';
      });
    }

    var timers = new WeakMap();
    function showScroll(scroller) {
      var wrap = scroller.closest('.icount-scroll-wrap');
      if (!wrap) return;
      wrap.classList.add('is-scrolling');
      var existing = timers.get(wrap);
      if (existing) clearTimeout(existing);
      timers.set(wrap, setTimeout(function () { wrap.classList.remove('is-scrolling'); timers.delete(wrap); }, 1600));
    }

    document.querySelectorAll('.icount-tracker-scroll').forEach(function (s) {
      s.addEventListener('scroll', function () { sync(); showScroll(s); }, { passive: true });
      s.addEventListener('touchstart', function () { showScroll(s); }, { passive: true });
      s.addEventListener('wheel', function () { showScroll(s); }, { passive: true });
      s.addEventListener('mouseenter', function () { showScroll(s); });
    });
    window.addEventListener('resize', sync);
    setTimeout(sync, 0);
    setTimeout(sync, 300);
  }

})();
