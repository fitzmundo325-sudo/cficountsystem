let dashboardSectionIds = [
  'dsh-gauges',
  'dsh-summary',
  'dsh-sales-chart',
  'dsh-performance',
  'dsh-product-mix',
  'dsh-pos-sold',
  'dsh-rankings',
  'dsh-bottom-sections'
];

let dashboardSkeletons = {};
let dashboardCharts = {};
let dashboardData = null;
let dashboardRequestId = 0;

let dashboardDark = false;
let chartTextColor = '#475569';
let chartStrongColor = '#0f172a';

let salesOriginal = {sales: [], sbase: [], target: [], lastYear: [], labels: []};
let salesCurrent = {sales: [], sbase: [], target: [], lastYear: [], labels: []};

let productMixStores = [];
let productMixActiveStore = 'all';
let productMixActiveCategory = 'all';
let productMixAllowedCategories = ['Greeting Cakes', 'Premium', 'Rolls', 'Tray Product'];

let posSoldStores = [];
let posSoldActiveStore = 'all';
let posSoldActiveMetric = 'volume';
let posSoldActiveCatStore = 'all';
let posSoldExcluded = new Set();
let posSoldExcludedKey = 'cmapp_pos_mix_category_excluded_v1';

let activeZoomState = null;
let icountTimers = new WeakMap();

let piePercentPlugin = {
  id: 'piePercentLabels',
  afterDatasetsDraw: function (chart) {
    let dataset = chart.data && chart.data.datasets ? chart.data.datasets[0] : null;
    if (!dataset || !dataset.data) {
      return;
    }
    let values = dataset.data.map(function (v) { return Number(v || 0); });
    let total = values.reduce(function (a, b) { return a + b; }, 0);
    if (total <= 0) {
      return;
    }
    let meta = chart.getDatasetMeta(0);
    let ctx = chart.ctx;
    ctx.save();
    ctx.font = '600 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    values.forEach(function (v, i) {
      if (!v || !meta.data[i]) {
        return;
      }
      let share = (v / total) * 100;
      if (share < 4) {
        return;
      }
      let pos = meta.data[i].tooltipPosition();
      let label = share.toFixed(1) + '%';
      ctx.strokeStyle = dashboardDark ? 'rgba(15,23,42,0.95)' : 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 3;
      ctx.strokeText(label, pos.x, pos.y);
      ctx.fillStyle = chartStrongColor;
      ctx.fillText(label, pos.x, pos.y);
    });
    ctx.restore();
  }
};

// - Formatters -
function esc(value) {
  return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function peso(value) {
  return '\u20B1' + Number(value || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
}

function pct(value, digits) {
  return Number(value || 0).toFixed(digits !== undefined ? digits : 1) + '%';
}

function fmt(value) {
  return Number(value || 0).toLocaleString();
}

function isCompactScreen() {
  return window.matchMedia('(max-width:640px)').matches;
}

function truncateChartLabel(value, compactMax, wideMax) {
  let label = String(value || '');
  let max = isCompactScreen() ? compactMax : wideMax;
  return label.length > max ? label.slice(0, max - 1) + '\u2026' : label;
}

function updateToggleButtons(selector, attrName, activeValue) {
  document.querySelectorAll(selector).forEach(function (btn) {
    if (String(btn.getAttribute(attrName) || '') === String(activeValue)) {
      btn.classList.remove('border-slate-200', 'primary_background_darker', 'primary_color');
      btn.classList.add('border-indigo-600', 'bg-indigo-600', 'text-white');
    } else {
      btn.classList.remove('border-indigo-600', 'bg-indigo-600', 'text-white');
      btn.classList.add('border-slate-200', 'primary_background_darker', 'primary_color');
    }
  });
}

function getEntityLabel(data) {
  return dashboardEntityLabel || data.entity_label || 'Store';
}

function getEntityLabelPlural(data) {
  return dashboardEntityLabelPlural || data.entity_label_plural || 'Stores';
}

function applyChartTheme() {
  dashboardDark = document.documentElement.classList.contains('admin-dark');
  let rootStyle = getComputedStyle(document.documentElement);
  let cssPrimaryColor = rootStyle.getPropertyValue('--primary_color').trim();
  let cssPrimaryFaded = rootStyle.getPropertyValue('--primary_color_faded').trim();
  chartTextColor = dashboardDark ? '#dbeafe' : (cssPrimaryFaded || '#475569');
  chartStrongColor = dashboardDark ? '#ffffff' : (cssPrimaryColor || '#0f172a');
  if (window.Chart && Chart.defaults && Chart.defaults.global) {
    Chart.defaults.global.defaultFontColor = chartTextColor;
  }
}

// - Request params -
function getStoreScope() {
  let match = document.cookie.match(/(?:^|;\s*)store_scope=([^;]+)/);
  return match ? decodeURIComponent(match[1]).toLowerCase() : 'official';
}

function getDateParam(inputId, queryKey) {
  let input = document.getElementById(inputId);
  if (input && input.value) {
    return input.value;
  }
  return new URLSearchParams(window.location.search).get(queryKey) || '';
}

function buildDashboardParams() {
  let params = new URLSearchParams(window.location.search);
  let startDate = getDateParam('start_date', 'start_date');
  let endDate = getDateParam('end_date', 'end_date');
  if (startDate) {
    params.set('start_date', startDate);
  }
  if (endDate) {
    params.set('end_date', endDate);
  }
  params.set('scope', getStoreScope());
  if (dashboardForceCluster && dashboardClusterId) {
    params.set('cluster_id', dashboardClusterId);
  }
  return params;
}

// - Skeleton and error states -
function cacheDashboardSkeletons() {
  for (let i = 0; i < dashboardSectionIds.length; i++) {
    let section = document.getElementById(dashboardSectionIds[i]);
    if (section) {
      dashboardSkeletons[dashboardSectionIds[i]] = section.innerHTML;
    }
  }
}

function showDashboardSkeletons() {
  closeChartZoom();
  destroyDashboardCharts();
  for (let i = 0; i < dashboardSectionIds.length; i++) {
    let section = document.getElementById(dashboardSectionIds[i]);
    if (section && dashboardSkeletons[dashboardSectionIds[i]] !== undefined) {
      section.innerHTML = dashboardSkeletons[dashboardSectionIds[i]];
      section.classList.remove('hidden');
    }
  }
}

function buildDashboardError(message) {
  let box = document.createElement('div');
  box.className = 'dsh-loading-error col-span-full';
  let text = document.createElement('p');
  text.className = 'text-sm primary_color';
  text.textContent = message;
  let button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Retry';
  button.addEventListener('click', loadDashboardData);
  box.appendChild(text);
  box.appendChild(button);
  return box;
}

function showDashboardError(message) {
  closeChartZoom();
  destroyDashboardCharts();
  for (let i = 0; i < dashboardSectionIds.length; i++) {
    let section = document.getElementById(dashboardSectionIds[i]);
    if (!section) {
      continue;
    }
    if (i === 0) {
      section.innerHTML = '';
      section.appendChild(buildDashboardError(message));
    } else {
      section.classList.add('hidden');
    }
  }
}

// - Chart registry -
function registerDashboardChart(key, chart) {
  if (dashboardCharts[key]) {
    dashboardCharts[key].destroy();
  }
  dashboardCharts[key] = chart;
}

function destroyDashboardCharts() {
  let keys = Object.keys(dashboardCharts);
  for (let i = 0; i < keys.length; i++) {
    dashboardCharts[keys[i]].destroy();
  }
  dashboardCharts = {};
}

// - Header -
function setElementText(elementId, text) {
  let el = document.getElementById(elementId);
  if (el) {
    el.textContent = text;
  }
}

function setInputValue(inputId, value) {
  let input = document.getElementById(inputId);
  if (input) {
    input.value = value;
  }
}

function fillDashboardDateInputs(data) {
  let startInput = document.getElementById('start_date');
  let endInput = document.getElementById('end_date');
  if (startInput && !startInput.value && data.selected_start_date) {
    startInput.value = data.selected_start_date;
  }
  if (endInput && !endInput.value && data.selected_end_date) {
    endInput.value = data.selected_end_date;
  }
}

function updateSelectedPeriod(data) {
  let startText = data.selected_start_date_display || '';
  let endText = data.selected_end_date_display || '';
  if (!startText) {
    return;
  }
  let sameDay = data.selected_start_date === data.selected_end_date;
  setElementText('dashboard-selected-period', sameDay ? startText : startText + ' - ' + endText);
}

function updateDashboardHeader(data) {
  if (data.team_name) {
    setElementText('dashboard-team-name', data.team_name);
  }
  setElementText('dashboard-cluster-name', data.cluster_name ? data.cluster_name + ' Dashboard' : 'Dashboard');
  let scope = data.store_scope || getStoreScope();
  setElementText('dashboard-store-scope-badge', scope.charAt(0).toUpperCase() + scope.slice(1));
  fillDashboardDateInputs(data);
  updateSelectedPeriod(data);
}

// - Date filter -
function syncDashboardUrl() {
  let params = new URLSearchParams(window.location.search);
  let startInput = document.getElementById('start_date');
  let endInput = document.getElementById('end_date');
  if (startInput && startInput.value) {
    params.set('start_date', startInput.value);
  } else {
    params.delete('start_date');
  }
  if (endInput && endInput.value) {
    params.set('end_date', endInput.value);
  } else {
    params.delete('end_date');
  }
  let query = params.toString();
  history.pushState({}, '', window.location.pathname + (query ? '?' + query : ''));
}

function handleDashboardFilterSubmit(event) {
  event.preventDefault();
  syncDashboardUrl();
  loadDashboardData();
}

function handleDashboardFilterReset() {
  setInputValue('start_date', '');
  setInputValue('end_date', '');
  syncDashboardUrl();
  loadDashboardData();
}

function handleDashboardPopState() {
  let params = new URLSearchParams(window.location.search);
  setInputValue('start_date', params.get('start_date') || '');
  setInputValue('end_date', params.get('end_date') || '');
  loadDashboardData();
}

// - Gauges -
function buildGaugeCard(label, canvasId, rate) {
  return '<div class="primary_background p-6 rounded-2xl shadow-sm">' +
    '<div class="text-xs font-semibold uppercase tracking-wide primary_color mb-2">' + label + '</div>' +
    '<div class="relative w-full max-w-[340px] h-[240px] mx-auto">' +
      '<canvas id="' + canvasId + '"></canvas>' +
      '<div class="absolute inset-x-0 bottom-6 flex flex-col items-center justify-center pointer-events-none">' +
        '<span class="text-3xl font-bold primary_color guage_text">' + pct(rate) + '</span>' +
      '</div>' +
      '<div class="absolute inset-x-4 -bottom-2 flex items-center justify-between text-[11px] font-semibold primary_color"><span>0%</span><span>80%</span><span>90%</span><span>100%+</span></div>' +
    '</div>' +
  '</div>';
}

function renderGauges(data) {
  let overview = data.summary && data.summary.overview ? data.summary.overview : {};
  let mtdSales = Number(overview.mtd_sales || 0);
  let mtdTarget = Number(overview.total_target || 0);
  let ytdSales = Number(overview.ytd_sales || 0);
  let ytdTarget = Number(overview.ytd_target || 0);

  let el = document.getElementById('dsh-gauges');
  el.innerHTML =
    buildGaugeCard('MTD', 'percentageRateGauge', mtdTarget > 0 ? (mtdSales / mtdTarget) * 100 : 0) +
    buildGaugeCard('YTD', 'ytdRateGauge', ytdTarget > 0 ? (ytdSales / ytdTarget) * 100 : 0);

  renderRateGauge('percentageRateGauge', mtdSales, mtdTarget);
  renderRateGauge('ytdRateGauge', ytdSales, ytdTarget);
}

function renderRateGauge(canvasId, salesValue, targetValue) {
  let canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') {
    return;
  }
  let rate = targetValue > 0 ? (salesValue / targetValue) * 100 : 0;
  let gaugeMax = Math.max(120, Math.ceil(Math.max(rate, 100.01) / 10) * 10);
  let clamped = Math.max(0, Math.min(rate, gaugeMax));
  let chart = new Chart(canvas.getContext('2d'), {
    type: 'gauge',
    data: {
      labels: ['Below 80%', '80-89.99%', '90-99.99%', '100%+'],
      datasets: [{value: clamped, minValue: 0, data: [80, 90, 99.99, gaugeMax], backgroundColor: ['#ef4444', '#f59e0b', '#10b981', '#f97316'], borderWidth: 0}]
    },
    options: {
      responsive: true, maintainAspectRatio: false, rotation: -Math.PI, circumference: Math.PI, cutoutPercentage: 72,
      legend: {display: false},
      needle: {radiusPercentage: 2.5, widthPercentage: 3.2, lengthPercentage: 80, color: chartStrongColor},
      valueLabel: {display: false}
    }
  });
  registerDashboardChart('gauge-' + canvasId, chart);
}

// - Summary cards -
function summaryThresholdClass(value, thresholds) {
  if (value >= thresholds[0]) {
    return 'text-red-600 bg-red-50';
  }
  if (value >= thresholds[1]) {
    return 'text-amber-600 bg-amber-50';
  }
  return 'text-emerald-600 bg-emerald-50';
}

function summaryVarianceClass(value) {
  return value >= 0 ? 'text-emerald-600 bg-emerald-50' : 'text-red-600 bg-red-50';
}

function renderSummaryCards(data) {
  let overview = data.summary && data.summary.overview ? data.summary.overview : {};
  let sales = data.summary && data.summary.sales ? data.summary.sales : {};
  let variancePct = Number(overview.variance_percent || 0);
  let lyPct = Number(sales.mtd_vs_ly_percent || 0);
  let wastagePct = Number(overview.wastage_percent || 0);
  let discPct = Number(overview.discount_percent || 0);

  let el = document.getElementById('dsh-summary');
  el.innerHTML =
    '<div class="primary_background p-5 rounded-3xl shadow-sm hover:shadow-md transition-all">' +
      '<div class="flex items-center justify-between mb-3"><div class="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600"><span class="text-2xl font-bold leading-none">\u20B1</span></div>' +
      '<span class="text-xs font-medium px-2 py-0.5 rounded-md ' + summaryVarianceClass(variancePct) + '">' + (variancePct >= 0 ? '+' : '') + pct(variancePct) + '</span></div>' +
      '<h3 class="text-xs font-medium primary_color mb-1">MTD Sales</h3><p class="text-xl font-bold primary_color">' + peso(overview.mtd_sales) + '</p><p class="text-xs primary_color mt-1">month-to-date net sales</p></div>' +

    '<div class="primary_background p-5 rounded-3xl shadow-sm hover:shadow-md transition-all">' +
      '<div class="flex items-center justify-between mb-3"><div class="w-10 h-10 rounded-xl bg-indigo-50 text-indigo-600 flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg></div>' +
      '<span class="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-md">Monthly</span></div>' +
      '<h3 class="text-xs font-medium primary_color mb-1">Target</h3><p class="text-xl font-bold primary_color">' + peso(overview.total_target) + '</p><p class="text-xs primary_color mt-1">month-to-date target</p></div>' +

    '<div class="primary_background p-5 rounded-3xl shadow-sm hover:shadow-md transition-all">' +
      '<div class="flex items-center justify-between mb-3"><div class="w-10 h-10 rounded-xl primary_background_darker primary_color flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-9-9"></path><polyline points="15 3 21 3 21 9"></polyline></svg></div>' +
      '<span class="text-xs font-medium px-2 py-0.5 rounded-md ' + summaryVarianceClass(lyPct) + '">' + (lyPct >= 0 ? '+' : '') + pct(lyPct) + '</span></div>' +
      '<h3 class="text-xs font-medium primary_color mb-1">Last Year Net</h3><p class="text-xl font-bold primary_color">' + peso(sales.last_year_net) + '</p><p class="text-xs primary_color mt-1">same selected period</p></div>' +

    '<div class="primary_background p-5 rounded-3xl shadow-sm hover:shadow-md transition-all">' +
      '<div class="flex items-center justify-between mb-3"><div class="w-10 h-10 rounded-xl bg-red-50 text-red-600 flex items-center justify-center"><svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"></path><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"></path><path d="M19 6v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6"></path><line x1="10" y1="11" x2="10" y2="17"></line><line x1="14" y1="11" x2="14" y2="17"></line></svg></div>' +
      '<span class="text-xs font-medium px-2 py-0.5 rounded-md ' + summaryThresholdClass(wastagePct, [3, 1.5]) + '">' + pct(wastagePct, 2) + '</span></div>' +
      '<h3 class="text-xs font-medium primary_color mb-1">Wastage Amount</h3><p class="text-xl font-bold primary_color">' + peso(overview.wastage_amount) + '</p><p class="text-xs primary_color mt-1">month-to-date wastage</p></div>' +

    '<div class="primary_background p-5 rounded-3xl shadow-sm hover:shadow-md transition-all">' +
      '<div class="flex items-center justify-between mb-3"><div class="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center"><span class="text-2xl font-bold leading-none">\u20B1</span></div>' +
      '<span class="text-xs font-medium px-2 py-0.5 rounded-md ' + summaryThresholdClass(discPct, [5, 2]) + '">' + pct(discPct, 2) + '</span></div>' +
      '<h3 class="text-xs font-medium primary_color mb-1">MTD Discount</h3><p class="text-xl font-bold primary_color">' + peso(overview.discount_amount) + '</p><p class="text-xs primary_color mt-1">month-to-date discounts</p></div>';
}

// - Sales chart -
function copySalesSeries(series) {
  return {
    sales: series.sales.slice(),
    sbase: series.sbase.slice(),
    target: series.target.slice(),
    lastYear: series.lastYear.slice(),
    labels: series.labels.slice()
  };
}

function sumSeries(values) {
  return values.reduce(function (a, b) { return a + b; }, 0);
}

function groupSalesByWeek(series) {
  let grouped = {sales: [], sbase: [], target: [], lastYear: [], labels: []};
  for (let i = 0; i < series.sales.length; i += 7) {
    let weekSales = 0, weekSbase = 0, weekTarget = 0, weekLastYear = 0;
    for (let j = 0; j < 7 && (i + j) < series.sales.length; j++) {
      weekSales += series.sales[i + j] || 0;
      weekSbase += series.sbase[i + j] || 0;
      weekTarget += series.target[i + j] || 0;
      weekLastYear += series.lastYear[i + j] || 0;
    }
    grouped.sales.push(weekSales);
    grouped.sbase.push(weekSbase);
    grouped.target.push(weekTarget);
    grouped.lastYear.push(weekLastYear);
    grouped.labels.push('Week ' + (Math.floor(i / 7) + 1));
  }
  return grouped;
}

function groupSalesByMonth(series) {
  return {
    sales: [sumSeries(series.sales)],
    sbase: [sumSeries(series.sbase)],
    target: [sumSeries(series.target)],
    lastYear: [sumSeries(series.lastYear)],
    labels: ['Monthly Total']
  };
}

function renderSalesChart(data) {
  let el = document.getElementById('dsh-sales-chart');
  el.innerHTML =
    '<div class="primary_background p-6 rounded-2xl shadow-sm">' +
      '<div class="flex items-center justify-between mb-6"><div><h2 class="text-lg font-bold primary_color">Sales Trend</h2><p class="text-sm primary_color mt-1">Daily net sales</p></div>' +
      '<div id="sales-range-toggle" class="flex gap-2">' +
        '<button class="px-3 py-1.5 text-xs font-medium bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors">Day</button>' +
        '<button class="px-3 py-1.5 text-xs font-medium primary_color hover:primary_background_darker rounded-lg transition-colors">Week</button>' +
        '<button class="px-3 py-1.5 text-xs font-medium primary_color hover:primary_background_darker rounded-lg transition-colors">Month</button>' +
      '</div></div>' +
      '<div class="relative h-80"><canvas id="salesChart" width="800" height="320"></canvas></div>' +
    '</div>';

  salesOriginal = {
    sales: data.sales_data || [],
    sbase: data.sbase_sales_data || [],
    target: data.target_data || [],
    lastYear: data.last_year_data || [],
    labels: data.labels || []
  };
  salesCurrent = copySalesSeries(salesOriginal);

  if (salesOriginal.sales.length > 0) {
    updateSalesChart();
  }
}

function updateSalesChart() {
  let canvas = document.getElementById('salesChart');
  if (!canvas) {
    return;
  }
  let barColors = salesCurrent.sales.map(function (v, i) {
    let target = salesCurrent.target[i] || 0;
    if (target <= 0) {
      return 'rgba(16,185,129,0.65)';
    }
    if (v >= target) {
      return 'rgba(16,185,129,0.65)';
    }
    if (v >= target * 0.97) {
      return 'rgba(250,204,21,0.85)';
    }
    return 'rgba(99,102,241,0.6)';
  });
  let chart = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: salesCurrent.labels,
      datasets: [
        {label: 'Net Sales', data: salesCurrent.sales, backgroundColor: barColors, borderColor: barColors, borderWidth: 1, order: 10, type: 'bar'},
        {label: 'ACT Sbase', data: salesCurrent.sbase, borderColor: '#f97316', backgroundColor: 'transparent', borderWidth: 2, pointBackgroundColor: '#f97316', pointRadius: 3, pointHoverRadius: 5, fill: false, lineTension: 0.3, order: 3, type: 'line'},
        {label: 'Target (Net)', data: salesCurrent.target, borderColor: '#ef4444', backgroundColor: 'transparent', borderWidth: 2, pointBackgroundColor: '#ef4444', pointRadius: 4, pointHoverRadius: 6, fill: false, lineTension: 0.3, order: 1, type: 'line'},
        {label: 'Last Year (Net)', data: salesCurrent.lastYear, borderColor: '#64748b', backgroundColor: 'transparent', borderWidth: 2, borderDash: [5, 5], pointBackgroundColor: '#64748b', pointRadius: 4, pointHoverRadius: 6, fill: false, lineTension: 0.3, order: 2, type: 'line'}
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      legend: {display: true, position: 'top'},
      tooltips: {callbacks: {label: function (t) { return '\u20B1' + Number(t.yLabel || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}); }}},
      scales: {
        yAxes: [{beginAtZero: true, gridLines: {color: 'rgba(226,232,240,0.5)'}, ticks: {callback: function (v) { return '\u20B1' + v.toLocaleString(); }}}],
        xAxes: [{gridLines: {display: false}, ticks: {maxRotation: 45, minRotation: 0, maxTicksLimit: 31, autoSkip: false}}]
      }
    }
  });
  registerDashboardChart('sales', chart);
}

function handleSalesRangeClick(event) {
  let btn = event.target.closest('#sales-range-toggle button');
  if (!btn) {
    return;
  }
  document.querySelectorAll('#sales-range-toggle button').forEach(function (b) {
    b.classList.remove('bg-indigo-50', 'text-indigo-600');
    b.classList.add('primary_color');
  });
  btn.classList.remove('primary_color');
  btn.classList.add('bg-indigo-50', 'text-indigo-600');

  let range = btn.textContent.trim();
  if (range === 'Day') {
    salesCurrent = copySalesSeries(salesOriginal);
  } else if (range === 'Week') {
    salesCurrent = groupSalesByWeek(salesOriginal);
  } else if (range === 'Month') {
    salesCurrent = groupSalesByMonth(salesOriginal);
  }
  updateSalesChart();
}

// - Performance table -
function renderPerformance(data) {
  let EL = getEntityLabel(data);
  let performance = data.store_performance_data || [];
  let rows = '';
  performance.forEach(function (s) {
    let growth = s.ly > 0 ? ((s.act / s.ly) - 1) * 100 : null;
    let statusClass = s.status === 'Excellent' ? 'bg-emerald-100 text-emerald-800' : s.status === 'Good' ? 'bg-green-100 text-green-800' : s.status === 'Recovery' ? 'bg-yellow-100 text-yellow-800' : s.status === 'Critical' ? 'bg-orange-100 text-orange-800' : 'bg-red-100 text-red-800';
    rows += '<tr class="row_styles_tr" ><td class="px-4 py-3 text-sm font-medium primary_color">' + esc(s.store_name) + '</td>' +
      '<td class="px-4 py-3 text-sm primary_color text-right">' + peso(s.act) + '</td>' +
      '<td class="px-4 py-3 text-sm primary_color text-right">' + peso(s.ads) + '</td>' +
      '<td class="px-4 py-3 text-sm primary_color text-right">' + peso(s.ly) + '</td>' +
      '<td class="px-4 py-3 text-sm primary_color text-right">' + pct(s.ar_tgt_percent) + '</td>' +
      '<td class="px-4 py-3 text-sm primary_color text-right">' + (growth !== null ? pct(growth) : '-') + '</td>' +
      '<td class="px-4 py-3 text-sm text-center"><span class="px-2 py-1 text-xs font-medium rounded-full ' + statusClass + '">' + esc(s.status) + '</span></td></tr>';
  });

  document.getElementById('dsh-performance').innerHTML =
    '<div class="primary_background p-6 rounded-2xl shadow-sm">' +
      '<div class="mb-6"><h2 class="text-lg font-bold primary_color">Per ' + esc(EL) + ' Performance (Net Sales)</h2><p class="text-sm primary_color mt-1">Monthly performance by ' + esc(EL.toLowerCase()) + '</p></div>' +
      '<div class="overflow-x-auto"><table class="min-w-full divide-y divide-slate-200"><thead class="primary_background_darker"><tr>' +
        '<th class="px-4 py-3 text-left text-xs font-medium primary_color uppercase tracking-wider">' + esc(EL) + ' Name</th>' +
        '<th class="px-4 py-3 text-right text-xs font-medium primary_color uppercase tracking-wider">Act</th>' +
        '<th class="px-4 py-3 text-right text-xs font-medium primary_color uppercase tracking-wider">ADS</th>' +
        '<th class="px-4 py-3 text-right text-xs font-medium primary_color uppercase tracking-wider">Ly</th>' +
        '<th class="px-4 py-3 text-right text-xs font-medium primary_color uppercase tracking-wider">AR % Tgt</th>' +
        '<th class="px-4 py-3 text-right text-xs font-medium primary_color uppercase tracking-wider">% Gr</th>' +
        '<th class="px-4 py-3 text-center text-xs font-medium primary_color uppercase tracking-wider">Status</th>' +
      '</tr></thead><tbody class="primary_background divide-y divide-slate-200">' + rows + '</tbody></table></div></div>';
}

// - Product mix -
function buildZoomTriggerButton(panelId, title) {
  return '<button type="button" class="chart-zoom-trigger absolute right-2 top-2 z-10 inline-flex items-center rounded-md primary_background px-2 py-1 text-[11px] font-semibold primary_color shadow-sm transition-colors hover:primary_background_darker" data-panel-id="' + panelId + '" data-panel-title="' + title + '"><svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M3 4.75A1.75 1.75 0 0 1 4.75 3h3.5a.75.75 0 0 1 0 1.5h-3A.25.25 0 0 0 5 4.75v3a.75.75 0 0 1-1.5 0v-3Zm10.25-1A1.75 1.75 0 0 1 15 4.75v3a.75.75 0 0 1-1.5 0v-3a.25.25 0 0 0-.25-.25h-3a.75.75 0 0 1 0-1.5h3.5ZM4.25 11.5a.75.75 0 0 1 .75.75v3a.25.25 0 0 0 .25.25h3a.75.75 0 0 1 0 1.5h-3.5A1.75 1.75 0 0 1 3 15.25v-3a.75.75 0 0 1 .75-.75Zm10.5 0a.75.75 0 0 1 .75.75v3a1.75 1.75 0 0 1-1.75 1.75h-3.5a.75.75 0 0 1 0-1.5h3a.25.25 0 0 0 .25-.25v-3a.75.75 0 0 1 .75-.75Z" clip-rule="evenodd" /></svg></button>';
}

function renderProductMix(data) {
  let EL = getEntityLabel(data);
  productMixStores = data.store_product_mix || [];
  productMixActiveStore = 'all';
  productMixActiveCategory = 'all';

  let toggleBtns = '<button type="button" class="store-pie-toggle inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors border-indigo-600 bg-indigo-600 text-white" data-store-index="all">All</button>';
  productMixStores.forEach(function (item, i) {
    toggleBtns += '<button type="button" class="store-pie-toggle inline-flex max-w-[180px] items-center truncate rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors border-slate-200 primary_background_darker primary_color" data-store-index="' + i + '" title="' + esc(item.store_name) + '">' + esc(item.store_name) + '</button>';
  });

  document.getElementById('dsh-product-mix').innerHTML =
    '<div class="primary_background p-6 rounded-2xl shadow-sm">' +
      '<div class="mb-5 flex items-start justify-between gap-4"><div><h2 class="text-lg font-bold primary_color">Product Mix</h2><p class="text-sm primary_color mt-1">Peso mix (pie) and qty mix (bar) per ' + esc(EL.toLowerCase()) + '</p></div>' +
      '<div class="text-right flex flex-col items-end gap-2"><button id="openProductMixLabelsBtn" type="button" class="inline-flex items-center rounded-lg border border-slate-200 primary_background_darker px-3 py-1.5 text-xs font-semibold primary_color transition-colors">Show Labels</button>' +
      '<p class="text-[11px] uppercase tracking-wide primary_color">Total Peso Value</p><p id="storePieTotalUnits" class="text-xl font-bold primary_color">0</p></div></div>' +
      '<div id="storePieToggleGroup" class="mb-4 flex flex-wrap gap-2">' + toggleBtns + '</div>' +
      '<div id="productMixCategoryFilter" class="mb-4 flex flex-wrap gap-2"></div>' +
      '<div class="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">' +
        '<div id="storeProductsPieChartPanel" class="relative rounded-xl primary_background_darker p-3">' +
          buildZoomTriggerButton('storeProductsPieChartPanel', 'Product Mix Peso (Pie)') +
          '<div id="storeProductsPieChartWrap" class="mx-auto h-60 w-full max-w-[260px]"><canvas id="storeProductsPieChart"></canvas></div>' +
        '</div>' +
        '<div id="storeProductsQtyBarChartPanel" class="relative rounded-xl primary_background_darker p-3">' +
          buildZoomTriggerButton('storeProductsQtyBarChartPanel', 'Product Mix Qty (Bar)') +
          '<div id="storeProductsQtyBarChartWrap" class="h-72 w-full"><canvas id="storeProductsQtyBarChart"></canvas></div>' +
          '<div id="storePieLegend" class="hidden ml-auto space-y-2 max-w-[340px]"></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  if (productMixStores.length > 0) {
    renderProductMixCategoryButtons();
    renderProductMixPie();
  }
}

function normalizeProductMixCategory(category, name) {
  let clean = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ''); };
  let ck = clean(category);
  let nk = clean(name);
  let merged = ck + ' ' + nk;
  if (merged.indexOf('tray') >= 0) {
    return 'Tray Product';
  }
  if (merged.indexOf('greetingcake') >= 0 || ck === 'gc' || nk.indexOf('gc') === 0) {
    return 'Greeting Cakes';
  }
  if (merged.indexOf('premium') >= 0) {
    return 'Premium';
  }
  if (merged.indexOf('roll') >= 0) {
    return 'Rolls';
  }
  return null;
}

function getProductMixProducts(index) {
  let products = [];
  if (index === 'all') {
    let aggregated = {};
    productMixStores.forEach(function (s) {
      (s.products || []).forEach(function (p) {
        let key = (p.name || '').toLowerCase() + '|' + (p.category || '').toLowerCase();
        if (!aggregated[key]) {
          aggregated[key] = {name: p.name || 'Unnamed Product', category: p.category || 'Uncategorized', qty: 0, net_sales: 0};
        }
        aggregated[key].qty += Number(p.qty || 0);
        aggregated[key].net_sales += Number(p.net_sales || 0);
      });
    });
    Object.values(aggregated).forEach(function (p) { products.push(p); });
  } else {
    let store = productMixStores[index];
    if (store) {
      (store.products || []).forEach(function (p) { products.push(p); });
    }
  }
  return products;
}

function renderProductMixCategoryButtons() {
  let filter = document.getElementById('productMixCategoryFilter');
  if (!filter) {
    return;
  }
  let activeClass = 'border-indigo-600 bg-indigo-600 text-white';
  let idleClass = 'border-slate-200 primary_background_darker primary_color';
  let html = '<button type="button" class="product-mix-category-toggle inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ' + (productMixActiveCategory === 'all' ? activeClass : idleClass) + '" data-category="all">All</button>';
  productMixAllowedCategories.forEach(function (c) {
    html += '<button type="button" class="product-mix-category-toggle inline-flex max-w-[180px] items-center truncate rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors ' + (productMixActiveCategory === c ? activeClass : idleClass) + '" data-category="' + encodeURIComponent(c) + '">' + esc(c) + '</button>';
  });
  filter.innerHTML = html;
}

function renderProductMixPie() {
  let pieCanvas = document.getElementById('storeProductsPieChart');
  let barCanvas = document.getElementById('storeProductsQtyBarChart');
  let legendEl = document.getElementById('storePieLegend');
  let legendModal = document.getElementById('storePieLegendModal');
  let totalEl = document.getElementById('storePieTotalUnits');
  if (!pieCanvas) {
    return;
  }

  let all = getProductMixProducts(productMixActiveStore);
  let normalized = all.map(function (p) {
    return {name: p.name, qty: p.qty, net_sales: p.net_sales, category: p.category, nc: normalizeProductMixCategory(p.category, p.name)};
  }).filter(function (p) { return p.nc; });
  let filtered = productMixActiveCategory === 'all' ? normalized : normalized.filter(function (p) { return p.nc === productMixActiveCategory; });
  let totalPeso = filtered.reduce(function (a, p) { return a + Number(p.net_sales || 0); }, 0);
  if (totalEl) {
    totalEl.textContent = '\u20B1' + totalPeso.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
  }

  let legendHtml = filtered.map(function (p, i) {
    let share = totalPeso > 0 ? (Number(p.net_sales || 0) / totalPeso) * 100 : 0;
    let color = 'hsl(' + ((i * 41) % 360) + ', 72%, 52%)';
    return '<div class="w-full max-w-[340px] flex items-center justify-between rounded-lg primary_background_darker px-3 py-2"><div class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full" style="background-color:' + color + '"></span><span class="max-w-[170px] truncate text-xs font-medium primary_color" title="' + esc(p.name) + '">' + esc(p.name) + '</span></div><div class="text-right"><div class="text-xs font-semibold primary_color">\u20B1' + Number(p.net_sales || 0).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + '</div><div class="text-[11px] primary_color">' + fmt(p.qty) + ' pcs</div><div class="text-[11px] primary_color">' + share.toFixed(1) + '%</div></div></div>';
  }).join('') || '<div class="rounded-lg primary_background_darker px-3 py-4 text-center text-xs primary_color">No products in this category.</div>';
  if (legendEl) {
    legendEl.innerHTML = legendHtml;
  }
  if (legendModal) {
    legendModal.innerHTML = legendHtml;
  }

  if (typeof Chart !== 'undefined') {
    let pieChart = new Chart(pieCanvas.getContext('2d'), {
      plugins: [piePercentPlugin], type: 'doughnut',
      data: {
        labels: filtered.map(function (p) { return p.name; }),
        datasets: [{
          data: filtered.map(function (p) { return Number(p.net_sales || 0); }),
          backgroundColor: filtered.map(function (_, i) { return 'hsl(' + ((i * 41) % 360) + ', 72%, 52%)'; }),
          borderColor: '#fff', borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '58%', legend: {display: false},
        plugins: {
          piePercentLabels: {minShare: 4},
          tooltip: {callbacks: {label: function (ctx) {
            let v = Number(ctx.parsed || 0);
            let s = totalPeso > 0 ? (v / totalPeso) * 100 : 0;
            return truncateChartLabel(ctx.label, 24, 42) + ': \u20B1' + v.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' (' + s.toFixed(1) + '%)';
          }}}
        }
      }
    });
    registerDashboardChart('product-mix-pie', pieChart);
  }

  if (typeof Chart !== 'undefined' && barCanvas) {
    let barLabels = filtered.length ? filtered.map(function (p) { return p.name; }) : ['No products'];
    let barValues = filtered.length ? filtered.map(function (p) { return Number(p.qty || 0); }) : [0];
    let barColors = barLabels.map(function (_, i) { return 'hsl(' + (220 - i * 7) + ', 76%,' + Math.max(35, 60 - i) + '%)'; });
    let barChart = new Chart(barCanvas.getContext('2d'), {
      type: 'horizontalBar',
      data: {labels: barLabels, datasets: [{label: 'Qty Sold', data: barValues, backgroundColor: barColors, borderColor: barColors, borderWidth: 1}]},
      options: {
        responsive: true, maintainAspectRatio: false, legend: {display: false},
        tooltips: {callbacks: {label: function (t) { return fmt(t.xLabel) + ' pcs'; }}},
        scales: {
          xAxes: [{ticks: {fontColor: chartTextColor, beginAtZero: true, callback: function (v) { return fmt(v); }}, gridLines: {color: 'rgba(226,232,240,0.7)'}}],
          yAxes: [{ticks: {fontColor: chartTextColor, callback: function (v) { return truncateChartLabel(v, 18, 34); }}, gridLines: {display: false}}]
        }
      }
    });
    registerDashboardChart('product-mix-bar', barChart);
  }
}

function handleProductMixClick(event) {
  let target = event.target;

  let storeBtn = target.closest('.store-pie-toggle');
  if (storeBtn) {
    productMixActiveStore = storeBtn.getAttribute('data-store-index') || 'all';
    updateToggleButtons('.store-pie-toggle', 'data-store-index', productMixActiveStore);
    renderProductMixCategoryButtons();
    renderProductMixPie();
    return;
  }

  let categoryBtn = target.closest('.product-mix-category-toggle');
  if (categoryBtn) {
    let category = categoryBtn.getAttribute('data-category');
    productMixActiveCategory = category === 'all' ? 'all' : decodeURIComponent(category);
    renderProductMixCategoryButtons();
    renderProductMixPie();
    return;
  }

  let labelsBtn = target.closest('#openProductMixLabelsBtn');
  if (labelsBtn) {
    openProductMixLabelsModal();
    return;
  }

  let zoomBtn = target.closest('.chart-zoom-trigger');
  if (zoomBtn) {
    openChartZoom(zoomBtn.getAttribute('data-panel-id'), zoomBtn.getAttribute('data-panel-title'));
  }
}

// - POS sold -
function renderPosSold(data) {
  let EL = getEntityLabel(data);
  posSoldStores = data.pos_sold_products_by_store || [];
  posSoldActiveStore = 'all';
  posSoldActiveMetric = 'volume';
  posSoldActiveCatStore = 'all';

  let storeBtns = '<button type="button" class="pos-sold-store-toggle inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors border-indigo-600 bg-indigo-600 text-white" data-entity-index="all">All</button>';
  posSoldStores.forEach(function (item, i) {
    storeBtns += '<button type="button" class="pos-sold-store-toggle inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors border-slate-200 primary_background_darker primary_color" data-entity-index="' + i + '">' + esc(item.store_name) + '</button>';
  });
  let catStoreBtns = '<button type="button" class="pos-mix-cat-store-toggle inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors border-indigo-600 bg-indigo-600 text-white" data-entity-index="all">All</button>';
  posSoldStores.forEach(function (item, i) {
    catStoreBtns += '<button type="button" class="pos-mix-cat-store-toggle inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors border-slate-200 primary_background_darker primary_color" data-entity-index="' + i + '">' + esc(item.store_name) + '</button>';
  });

  let hasData = posSoldStores.length > 0;
  document.getElementById('dsh-pos-sold').innerHTML =
    '<div class="primary_background p-6 rounded-2xl shadow-sm">' +
      '<div class="mb-5 space-y-2"><div class="flex flex-wrap items-center justify-between gap-2"><h2 class="text-lg font-bold primary_color">Products Sold (POS)</h2>' +
      '<div class="flex items-center gap-2"><button type="button" class="pos-sold-metric-toggle inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors border-indigo-600 bg-indigo-600 text-white" data-metric="volume">Volume</button>' +
      '<button type="button" class="pos-sold-metric-toggle inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors border-slate-200 primary_background_darker primary_color" data-metric="peso">Peso Value</button></div></div>' +
      '<div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-3"><p class="text-sm primary_color">Top 10 products sold per ' + esc(EL.toLowerCase()) + '</p><p id="posSoldTotalUnits" class="max-w-full break-words text-base font-bold primary_color sm:text-xl sm:text-right">Total: _____</p></div></div>' +
      (hasData ? '<div class="mb-4 flex flex-wrap gap-2">' + storeBtns + '</div><div class="relative h-96 overflow-hidden"><canvas id="posSoldProductsBarChart"></canvas></div>' : '<div class="rounded-xl primary_background_darker px-4 py-8 text-center text-sm primary_color">No POS sold data available for this period.</div>') +
    '</div>' +
    '<div class="primary_background p-6 rounded-2xl shadow-sm">' +
      '<div class="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between"><div><h2 class="text-lg font-bold primary_color">Product Mix Category</h2><p class="text-sm primary_color mt-1">Products pie chart with all categories</p></div>' +
      '<div class="text-right"><p class="text-[11px] uppercase tracking-wide primary_color">Total Pcs</p><p id="posMixCategoryTotalUnits" class="text-xl font-bold primary_color">0</p></div></div>' +
      (hasData ? '<div class="mb-4 flex flex-wrap gap-2">' + catStoreBtns + '</div><div class="grid grid-cols-1 items-start gap-4 md:grid-cols-5"><div class="md:col-span-2"><div class="mx-auto h-72 w-full max-w-[320px]"><canvas id="posMixCategoryPieChart"></canvas></div></div><div class="md:col-span-3"><div id="posMixCategoryLegend" class="space-y-2 max-w-[190px] ml-auto"></div></div></div>' : '<div class="rounded-xl primary_background_darker px-4 py-8 text-center text-sm primary_color">No category data available for this period.</div>') +
    '</div>';

  if (hasData) {
    loadPosSoldExcluded();
    renderPosSoldBar();
    renderPosMixCategoryPie();
  }
}

function loadPosSoldExcluded() {
  posSoldExcluded = new Set();
  try {
    let raw = localStorage.getItem(posSoldExcludedKey);
    let parsed = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) {
      posSoldExcluded = new Set(parsed.filter(Boolean));
    }
  } catch (e) {}
}

function savePosSoldExcluded() {
  try {
    localStorage.setItem(posSoldExcludedKey, JSON.stringify(Array.from(posSoldExcluded)));
  } catch (e) {}
}

function normalizePosProducts(list) {
  return (Array.isArray(list) ? list : []).map(function (p) {
    return {
      name: (p.name || '').trim() || 'Unnamed Product',
      qty: Number(p.qty || 0),
      net_sales: Number(p.net_sales || 0),
      category: (p.category || '').trim() || 'Uncategorized'
    };
  });
}

function getPosSoldProducts(index) {
  if (index === 'all') {
    let aggregated = {};
    posSoldStores.forEach(function (s) {
      normalizePosProducts(s.products).forEach(function (p) {
        let key = p.name.toLowerCase();
        if (!aggregated[key]) {
          aggregated[key] = {name: p.name, qty: 0, net_sales: 0, category: p.category};
        }
        aggregated[key].qty += p.qty;
        aggregated[key].net_sales += p.net_sales;
      });
    });
    return Object.values(aggregated);
  }
  let i = parseInt(index, 10);
  i = Number.isFinite(i) ? Math.min(Math.max(i, 0), posSoldStores.length - 1) : 0;
  return normalizePosProducts(posSoldStores[i] ? posSoldStores[i].products : []);
}

function renderPosSoldBar() {
  let canvas = document.getElementById('posSoldProductsBarChart');
  let totalEl = document.getElementById('posSoldTotalUnits');
  if (!canvas) {
    return;
  }
  let compact = isCompactScreen();
  let products = getPosSoldProducts(posSoldActiveStore);
  let metricKey = posSoldActiveMetric === 'peso' ? 'net_sales' : 'qty';
  products.sort(function (a, b) { return Number(b[metricKey] || 0) - Number(a[metricKey] || 0); });
  let total = products.reduce(function (a, p) { return a + Number(p[metricKey] || 0); }, 0);
  if (totalEl) {
    totalEl.textContent = posSoldActiveMetric === 'peso'
      ? 'Total: \u20B1' + total.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2})
      : 'Total: ' + fmt(total) + ' pc/s';
  }
  let top = products.slice(0, 10);
  let labels = top.length ? top.map(function (p) { return p.name; }) : ['No POS sold data'];
  let values = top.length ? top.map(function (p) { return Number(p[metricKey] || 0); }) : [0];
  let colors = labels.map(function (_, i) { return 'hsl(' + (220 - i * 7) + ', 76%,' + Math.max(35, 60 - i) + '%)'; });

  let chart = new Chart(canvas.getContext('2d'), {
    type: 'horizontalBar',
    data: {labels: labels, datasets: [{label: posSoldActiveMetric === 'peso' ? 'POS Sold Net Sales' : 'POS Sold Qty', data: values, backgroundColor: colors, borderColor: colors, borderWidth: 1}]},
    options: {
      responsive: true, maintainAspectRatio: false, legend: {display: false},
      tooltips: {callbacks: {label: function (t) {
        let v = Number(t.xLabel || 0);
        let row = top[t.index] || {};
        if (posSoldActiveMetric === 'peso') {
          return '\u20B1' + v.toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2}) + ' (' + (row.category || 'Uncategorized') + ')';
        }
        return fmt(v) + ' pcs (' + (row.category || 'Uncategorized') + ')';
      }}},
      scales: {
        xAxes: [{ticks: {beginAtZero: true, callback: function (v) { return posSoldActiveMetric === 'peso' ? '\u20B1' + fmt(v) : fmt(v); }}, gridLines: {color: 'rgba(226,232,240,0.7)'}}],
        yAxes: [{ticks: {fontColor: chartTextColor, fontSize: compact ? 10 : 12, callback: function (v) { return truncateChartLabel(v, 22, 34); }}, gridLines: {display: false}}]
      }
    }
  });
  registerDashboardChart('pos-sold-bar', chart);

  updateToggleButtons('.pos-sold-store-toggle', 'data-entity-index', posSoldActiveStore);
  updateToggleButtons('.pos-sold-metric-toggle', 'data-metric', posSoldActiveMetric);
}

function renderPosMixCategoryPie() {
  let canvas = document.getElementById('posMixCategoryPieChart');
  let legend = document.getElementById('posMixCategoryLegend');
  let totalEl = document.getElementById('posMixCategoryTotalUnits');
  if (!canvas) {
    return;
  }
  let products = getPosSoldProducts(posSoldActiveCatStore);
  let categoryMap = {};
  products.forEach(function (p) {
    let c = p.category || 'Uncategorized';
    categoryMap[c] = (categoryMap[c] || 0) + Number(p.qty || 0);
  });
  let allRows = Object.keys(categoryMap).map(function (n) { return {name: n, qty: categoryMap[n]}; }).filter(function (r) { return r.qty > 0; }).sort(function (a, b) { return b.qty - a.qty; });
  let visible = allRows.filter(function (r) { return !posSoldExcluded.has(r.name); });
  let total = visible.reduce(function (a, r) { return a + r.qty; }, 0);
  if (totalEl) {
    totalEl.textContent = fmt(total);
  }
  let colorMap = {};
  allRows.forEach(function (r, i) { colorMap[r.name] = 'hsl(' + ((i * 41) % 360) + ', 72%, 52%)'; });

  if (legend) {
    legend.innerHTML = allRows.map(function (r) {
      let isExcluded = posSoldExcluded.has(r.name);
      let share = total > 0 ? (r.qty / total) * 100 : 0;
      return '<button type="button" class="pos-mix-category-legend-item w-full max-w-[190px] flex items-center justify-between rounded-lg primary_background_darker px-3 py-2 ' + (isExcluded ? 'opacity-45 cursor-pointer' : 'cursor-pointer') + '" data-category="' + encodeURIComponent(r.name) + '"><div class="flex items-center gap-2"><span class="h-2.5 w-2.5 rounded-full" style="background-color:' + colorMap[r.name] + '"></span><span class="text-xs font-medium primary_color">' + esc(r.name) + '</span></div><span class="text-[11px] primary_color">' + (isExcluded ? 'Excluded' : share.toFixed(1) + '%') + '</span></button>';
    }).join('') || '<div class="rounded-lg primary_background_darker px-3 py-4 text-center text-xs primary_color">No category data available.</div>';
  }

  let chart = new Chart(canvas.getContext('2d'), {
    plugins: [piePercentPlugin], type: 'doughnut',
    data: {
      labels: visible.map(function (r) { return r.name; }),
      datasets: [{
        data: visible.map(function (r) { return r.qty; }),
        backgroundColor: visible.map(function (r) { return colorMap[r.name]; }),
        borderColor: '#fff', borderWidth: 2
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '58%', legend: {display: false},
      plugins: {
        piePercentLabels: {minShare: 4},
        tooltip: {callbacks: {label: function (ctx) {
          let v = Number(ctx.parsed || 0);
          let s = total > 0 ? (v / total) * 100 : 0;
          return (ctx.label || '') + ': ' + fmt(v) + ' pcs (' + s.toFixed(1) + '%)';
        }}}
      }
    }
  });
  registerDashboardChart('pos-mix-category-pie', chart);

  updateToggleButtons('.pos-mix-cat-store-toggle', 'data-entity-index', posSoldActiveCatStore);
}

function handlePosSoldClick(event) {
  let target = event.target;

  let storeBtn = target.closest('.pos-sold-store-toggle');
  if (storeBtn) {
    posSoldActiveStore = storeBtn.getAttribute('data-entity-index') || 'all';
    renderPosSoldBar();
    return;
  }

  let metricBtn = target.closest('.pos-sold-metric-toggle');
  if (metricBtn) {
    posSoldActiveMetric = metricBtn.getAttribute('data-metric') || 'volume';
    renderPosSoldBar();
    return;
  }

  let catStoreBtn = target.closest('.pos-mix-cat-store-toggle');
  if (catStoreBtn) {
    posSoldActiveCatStore = catStoreBtn.getAttribute('data-entity-index') || 'all';
    renderPosMixCategoryPie();
    return;
  }

  let legendBtn = target.closest('.pos-mix-category-legend-item');
  if (legendBtn) {
    let category = decodeURIComponent(legendBtn.getAttribute('data-category') || '');
    if (!category) {
      return;
    }
    if (posSoldExcluded.has(category)) {
      posSoldExcluded.delete(category);
    } else {
      posSoldExcluded.add(category);
    }
    savePosSoldExcluded();
    renderPosMixCategoryPie();
  }
}

// - Rankings, attainment, ICU -
function renderRankings(data) {
  let EL = getEntityLabel(data);
  let ELP = getEntityLabelPlural(data);
  let ads = data.top_stores_ads || [];
  let ar = data.top_attainment_ar || [];
  let icu = data.icu_stores || [];

  let adsHtml = '';
  if (ads.length) {
    ads.forEach(function (s) {
      let medal = s.rank === 1 ? 'bg-amber-100 text-amber-700' : s.rank === 2 ? 'primary_background_darker primary_color' : 'bg-orange-100 text-orange-700';
      adsHtml += '<div class="rounded-xl primary_background_darker p-3"><div class="mb-2 flex items-center justify-between"><h3 class="truncate pr-3 text-sm font-bold primary_color">' + esc(s.store_name) + '</h3><span class="inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold ' + medal + '">' + s.rank + '</span></div><div class="flex items-end justify-between"><p class="text-xl font-extrabold leading-none primary_color">' + peso(s.ads) + '</p><p class="text-[11px] font-semibold uppercase tracking-wide primary_color">ADS</p></div></div>';
    });
  } else {
    adsHtml = '<div class="rounded-xl primary_background_darker px-4 py-6 text-center text-sm primary_color">No ADS data available for the selected period.</div>';
  }

  let arHtml = '';
  if (ar.length) {
    ar.forEach(function (s) {
      arHtml += '<div class="rounded-xl border border-emerald-200/70 primary_background p-3"><div class="mb-2 flex items-start justify-between gap-2"><h3 class="truncate text-sm font-bold primary_color">' + esc(s.store_name) + '</h3><span class="rounded-md bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-700">' + pct(s.ar_tgt_percent) + '</span></div><div class="mb-2 flex items-center justify-between text-xs"><span class="primary_color">Target: ' + peso(s.target_mtd) + '</span><span class="font-semibold primary_color">Actual: ' + peso(s.act) + '</span></div><div class="h-1.5 overflow-hidden rounded-full bg-emerald-100"><div class="h-full rounded-full bg-emerald-500" style="width:' + Math.min(Math.max(s.progress_percent || 0, 0), 100) + '%"></div></div></div>';
    });
  } else {
    arHtml = '<div class="rounded-xl border border-dashed border-emerald-300 primary_background px-4 py-6 text-center text-sm primary_color">No attainment data available for the selected period.</div>';
  }

  let icuHtml = '';
  if (icu.length) {
    icu.forEach(function (s) {
      icuHtml += '<div class="rounded-xl border border-rose-200/70 primary_background p-3"><div class="mb-2 flex items-start justify-between gap-2"><div><h3 class="text-sm font-bold primary_color">' + esc(s.store_name) + '</h3><p class="mt-0.5 text-xs primary_color">' + esc(s.note) + '</p></div><span class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-bold ' + (s.tone_badge || '') + '">' + esc(s.status) + '</span></div><div class="space-y-1 text-xs"><div class="flex items-center justify-between"><span class="primary_color">Actual</span><span class="font-semibold ' + (s.tone_value || '') + '">' + peso(s.act) + '</span></div><div class="flex items-center justify-between"><span class="primary_color">Target</span><span class="font-semibold primary_color">' + peso(s.target_mtd) + '</span></div><div class="flex items-center justify-between"><span class="primary_color">Attainment</span><span class="font-bold ' + (s.tone_value || '') + '">' + pct(s.attainment_percent) + '</span></div><div class="mt-1.5 h-1.5 overflow-hidden rounded-full ' + (s.tone_bar_bg || '') + '"><div class="h-full rounded-full ' + (s.tone_bar_fill || '') + '" style="width:' + (s.progress_percent || 0) + '%"></div></div></div></div>';
    });
  } else {
    icuHtml = '<div class="rounded-xl border border-dashed border-emerald-300 primary_background px-4 py-6 text-center text-sm text-emerald-700">No ICU/Critical ' + esc(ELP.toLowerCase()) + ' for the selected range.</div>';
  }

  document.getElementById('dsh-rankings').innerHTML =
    '<div class="rounded-2xl primary_background p-5 shadow-sm"><div class="mb-4 flex items-start justify-between"><div><h2 class="text-lg font-bold primary_color">' + (EL === 'Store' ? 'Store Ranking' : 'Cluster Ranking') + '</h2><p class="mt-1 text-sm primary_color">Highest average daily sales</p></div><span class="inline-flex items-center rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Top 3</span></div><div class="space-y-2.5">' + adsHtml + '</div></div>' +
    '<div class="rounded-2xl emerald_to_primary_gradient p-5 shadow-sm"><div class="mb-4 flex items-start justify-between"><div><h2 class="text-lg font-bold primary_color">Top 3 Attainment Rate AR</h2><p class="mt-1 text-sm primary_color">Achievement rate percentage</p></div><span class="inline-flex items-center rounded-full bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Leaders</span></div><div class="space-y-2.5">' + arHtml + '</div></div>' +
    '<div class="rounded-2xl rose_to_primary_gradient p-5 shadow-sm"><div class="mb-4 flex items-start justify-between"><div><h2 class="text-lg font-bold primary_color">ICU ' + esc(ELP) + '</h2><p class="mt-1 text-sm primary_color">' + esc(ELP) + ' needing attention</p></div><span class="inline-flex items-center rounded-full bg-rose-600 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-white">Urgent</span></div><div class="space-y-2.5">' + icuHtml + '</div></div>';
}

// - Bottom sections: wastage, icount tracker, discount -
function wastageToneClass(percent, tones) {
  if (percent > 2) {
    return tones[0];
  }
  if (percent > 1) {
    return tones[1];
  }
  return tones[2];
}

function buildWastageWeekRows(wastage) {
  let rows = '';
  if (wastage && wastage.rows) {
    wastage.rows.forEach(function (r) {
      let pc = wastageToneClass(r.percent || 0, ['text-red-600', 'text-amber-600', 'text-emerald-600']);
      rows += '<tr class="row_styles_tr"><td class="px-4 py-2.5 font-medium primary_color">' + esc(r.label) + '</td><td class="px-4 py-2.5 text-right primary_color">\u20B1' + fmt(r.gross_sales || 0) + '</td><td class="px-4 py-2.5 text-right primary_color">\u20B1' + fmt(r.wastage || 0) + '</td><td class="px-4 py-2.5 text-right font-semibold ' + pc + '">' + pct(r.percent || 0) + '</td></tr>';
    });
    if (wastage.mtd) {
      let mtdPc = wastageToneClass(wastage.mtd.percent || 0, ['text-red-700', 'text-amber-700', 'text-emerald-700']);
      rows += '<tr class="primary_background_darker"><td class="px-4 py-2.5 font-bold primary_color">' + esc(wastage.mtd.label) + '</td><td class="px-4 py-2.5 text-right font-bold primary_color">\u20B1' + fmt(wastage.mtd.gross_sales || 0) + '</td><td class="px-4 py-2.5 text-right font-bold primary_color">\u20B1' + fmt(wastage.mtd.wastage || 0) + '</td><td class="px-4 py-2.5 text-right font-extrabold ' + mtdPc + '">' + pct(wastage.mtd.percent || 0) + '</td></tr>';
    }
  } else {
    rows = '<tr><td colspan="4" class="px-4 py-6 text-center text-sm primary_color">No wastage data available for the selected period.</td></tr>';
  }
  return rows;
}

function buildWastageStoreRows(wastage) {
  let rows = '';
  if (wastage && wastage.per_store && wastage.per_store.rows) {
    wastage.per_store.rows.forEach(function (r) {
      let pc = wastageToneClass(r.percent || 0, ['text-red-600', 'text-amber-600', 'text-emerald-600']);
      rows += '<tr class="row_styles_tr"><td class="px-4 py-2.5 font-medium primary_color">' + esc(r.store_name) + '</td><td class="px-4 py-2.5 text-right primary_color">\u20B1' + fmt(r.gross_sales || 0) + '</td><td class="px-4 py-2.5 text-right primary_color">\u20B1' + fmt(r.wastage || 0) + '</td><td class="px-4 py-2.5 text-right font-semibold ' + pc + '">' + pct(r.percent || 0) + '</td></tr>';
    });
    if (wastage.per_store.total) {
      let totalPc = wastageToneClass(wastage.per_store.total.percent || 0, ['text-red-700', 'text-amber-700', 'text-emerald-700']);
      rows += '<tr class="primary_background_darker row_styles_tr"><td class="px-4 py-2.5 font-bold primary_color">Total</td><td class="px-4 py-2.5 text-right font-bold primary_color">\u20B1' + fmt(wastage.per_store.total.gross_sales || 0) + '</td><td class="px-4 py-2.5 text-right font-bold primary_color">\u20B1' + fmt(wastage.per_store.total.wastage || 0) + '</td><td class="px-4 py-2.5 text-right font-extrabold ' + totalPc + '">' + pct(wastage.per_store.total.percent || 0) + '</td></tr>';
    }
  } else {
    rows = '<tr><td colspan="4" class="px-4 py-6 text-center text-sm primary_color">No per-store wastage data available for the selected period.</td></tr>';
  }
  return rows;
}

function buildIcountSection(key, tracker) {
  let item = tracker[key];
  let isComplete = item && (!item.show_missing_details || !item.missing_rows || item.missing_rows.length === 0);
  let badgeClass = isComplete ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700';
  let dotClass = isComplete ? 'bg-emerald-500' : 'bg-amber-500';

  let html = '<section class="primary_background px-5 py-4 flex flex-col"><div class="flex items-center justify-between gap-2"><h4 class="text-sm font-bold primary_color">' + (item ? esc(item.label) : key) + '</h4>';
  if (item) {
    html += '<span class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-bold ' + badgeClass + '"><span class="h-2 w-2 rounded-full ' + dotClass + '"></span>' + item.count + '/' + (tracker.total_stores || 0) + '</span>';
  }
  html += '</div>';

  if (item && item.show_missing_details && item.missing_rows && item.missing_rows.length > 0) {
    html += '<div class="mt-3 text-[11px] font-semibold uppercase tracking-wide primary_color">' + item.missing_rows.length + ' store' + (item.missing_rows.length === 1 ? '' : 's') + ' need update</div>';
    html += '<div class="icount-scroll-wrap relative mt-2 flex-1"><div class="icount-tracker-scroll max-h-64 overflow-y-auto overscroll-contain pr-3 text-left"><div class="space-y-1.5">';
    item.missing_rows.forEach(function (m) {
      html += '<div class="icount-tracker-missing-card rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5"><div class="status-title flex items-center gap-2 text-sm font-semibold text-amber-800"><span class="inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-amber-500"></span><span class="min-w-0 flex-1 truncate">' + esc(m.store_name) + '</span></div><p class="status-copy mt-1 text-xs text-amber-800/80">' + m.missing_count + ' missing date' + (m.missing_count === 1 ? '' : 's') + ' in the selected period.</p>';
      if (m.date_ranges && m.date_ranges.length) {
        html += '<div class="mt-2 flex flex-wrap gap-1.5">';
        m.date_ranges.forEach(function (range) {
          html += '<span class="status-pill rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-bold text-amber-800 ring-1 ring-amber-200">' + esc(range) + '</span>';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div></div><div class="icount-scrollbar" aria-hidden="true"><div class="icount-scrollbar-thumb"></div></div></div>';
  } else if (item && item.show_missing_details) {
    html += '<div class="icount-tracker-complete-card mt-3 flex flex-1 items-center gap-2 rounded-lg border border-emerald-100 bg-emerald-50/60 px-3 py-2.5"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="text-emerald-600"><path d="M20 6 9 17l-5-5"/></svg><span class="status-title text-sm font-bold text-emerald-700">All stores complete</span></div>';
  } else if (item) {
    html += '<div class="mt-3 flex flex-1 items-center rounded-lg primary_background_darker px-3 py-2.5 text-xs font-bold primary_color">Setup progress</div>';
  } else {
    html += '<div class="mt-3 flex flex-1 items-center text-sm font-semibold primary_color">--</div>';
  }
  html += '</section>';
  return html;
}

function buildDiscountRows(discount) {
  let rows = '';
  if (discount && discount.rows) {
    discount.rows.forEach(function (r) {
      rows += '<tr class="row_styles_tr"><td class="px-4 py-2.5 font-medium primary_color">' + esc(r.label) + '</td><td class="px-4 py-2.5 text-right primary_color">\u20B1' + fmt(r.amount || 0) + '</td><td class="px-4 py-2.5 text-right font-semibold primary_color">' + pct(r.percent || 0) + '</td></tr>';
    });
    if (discount.mtd) {
      rows += '<tr class="primary_background_darker"><td class="px-4 py-2.5 font-bold primary_color">' + esc(discount.mtd.label) + '</td><td class="px-4 py-2.5 text-right font-bold primary_color">\u20B1' + fmt(discount.mtd.amount || 0) + '</td><td class="px-4 py-2.5 text-right font-extrabold primary_color">' + pct(discount.mtd.percent || 0) + '</td></tr>';
    }
  } else {
    rows = '<tr><td colspan="3" class="px-4 py-6 text-center text-sm primary_color">No discount data available for the selected period.</td></tr>';
  }
  return rows;
}

function renderBottomSections(data) {
  let wastage = data.wastage_performance || {};
  let discount = data.discount_performance || {};
  let tracker = data.icount_tool_tracker || {};
  let clusterName = data.cluster_name || '';

  let wastageWeekRows = buildWastageWeekRows(wastage);
  let wastageStoreRows = buildWastageStoreRows(wastage);
  let discountRows = buildDiscountRows(discount);
  let icountHtml = '';
  ['daily_reports', 'invensync', 'oracle'].forEach(function (key) {
    icountHtml += buildIcountSection(key, tracker);
  });

  document.getElementById('dsh-bottom-sections').innerHTML =
    '<div class="rounded-2xl primary_background p-5 shadow-sm">' +
      '<div class="mb-4 flex items-start justify-between gap-3"><div><h2 class="text-lg font-bold primary_color">' + esc(clusterName) + ' Wastage Performance</h2><p class="mt-1 text-sm primary_color">Weekly and per-store MTD wastage breakdown</p></div>' +
      '<span class="inline-flex items-center rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">' + esc(wastage.month_label || '') + '</span></div>' +
      '<div class="grid grid-cols-1 gap-4 xl:grid-cols-2">' +
        '<div class="rounded-xl overflow-hidden"><div class="primary_background_darker px-4 py-2.5"><h3 class="text-sm font-bold primary_color">' + esc(wastage.title_label || 'Wastage Performance') + '</h3></div><div class="overflow-x-auto"><table class="min-w-full divide-y divide-slate-200 text-sm"><thead class="primary_background_darker"><tr><th class="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide primary_color">Week #</th><th class="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide primary_color">Gross Sales</th><th class="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide primary_color">Wastage</th><th class="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide primary_color">%</th></tr></thead><tbody class="divide-y divide-slate-100 primary_background">' + wastageWeekRows + '</tbody></table></div></div>' +
        '<div class="rounded-xl overflow-hidden"><div class="primary_background_darker px-4 py-2.5"><h3 class="text-sm font-bold primary_color">' + esc((wastage.per_store && wastage.per_store.title_label) || 'MTD Wastage Performance Per Store') + '</h3></div><div class="overflow-x-auto"><table class="min-w-full divide-y divide-slate-200 text-sm"><thead class="primary_background_darker"><tr><th class="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide primary_color">Store</th><th class="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide primary_color">Gross Sales</th><th class="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide primary_color">Wastage</th><th class="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide primary_color">%</th></tr></thead><tbody class="divide-y divide-slate-100 primary_background">' + wastageStoreRows + '</tbody></table></div></div>' +
      '</div>' +
      '<div class="mt-4 space-y-4">' +
        '<div class="rounded-2xl primary_background shadow-sm"><div class="flex items-center justify-between gap-3 px-5 py-3.5"><h3 class="text-sm font-bold primary_color">Icount Tool Tracker</h3><span class="text-[11px] font-semibold primary_color">' + esc(data.selected_start_date_display || '') + (data.selected_start_date !== data.selected_end_date ? ' - ' + esc(data.selected_end_date_display || '') : '') + '</span></div><div class="grid grid-cols-1 gap-px bg-slate-200 sm:grid-cols-3">' + icountHtml + '</div></div>' +
        '<div class="grid grid-cols-1 gap-4 xl:grid-cols-2"><div class="rounded-xl overflow-hidden"><div class="primary_background_darker px-4 py-2.5"><h3 class="text-sm font-bold primary_color">' + esc(discount.title_label || 'Discount Performance Breakdown') + '</h3></div><div class="overflow-x-auto"><table class="min-w-full divide-y divide-slate-200 text-sm"><thead class="primary_background_darker"><tr><th class="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide primary_color">Disc Type</th><th class="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide primary_color">Amount</th><th class="px-4 py-2.5 text-right text-xs font-semibold uppercase tracking-wide primary_color">% Cont</th></tr></thead><tbody class="divide-y divide-slate-100 primary_background">' + discountRows + '</tbody></table></div></div></div>' +
      '</div>' +
    '</div>';
}

// - Icount scrollbars -
function syncIcountScrollbars() {
  document.querySelectorAll('.icount-scroll-wrap').forEach(function (wrap) {
    let scroller = wrap.querySelector('.icount-tracker-scroll');
    let track = wrap.querySelector('.icount-scrollbar');
    let thumb = wrap.querySelector('.icount-scrollbar-thumb');
    if (!scroller || !track || !thumb) {
      return;
    }
    let scrollHeight = scroller.scrollHeight || 0;
    let clientHeight = scroller.clientHeight || 0;
    let canScroll = scrollHeight > clientHeight + 2;
    track.classList.toggle('is-hidden', !canScroll);
    if (!canScroll) {
      return;
    }
    let trackHeight = track.clientHeight || clientHeight;
    let thumbHeight = Math.max(28, Math.round((clientHeight / scrollHeight) * trackHeight));
    let maxThumb = Math.max(0, trackHeight - thumbHeight);
    let maxScroll = Math.max(1, scrollHeight - clientHeight);
    thumb.style.height = thumbHeight + 'px';
    thumb.style.transform = 'translateY(' + Math.round((scroller.scrollTop / maxScroll) * maxThumb) + 'px)';
  });
}

function hideIcountScrollbar(wrap) {
  wrap.classList.remove('is-scrolling');
  icountTimers.delete(wrap);
}

function showIcountScrollbar(scroller) {
  let wrap = scroller.closest('.icount-scroll-wrap');
  if (!wrap) {
    return;
  }
  wrap.classList.add('is-scrolling');
  let existing = icountTimers.get(wrap);
  if (existing) {
    clearTimeout(existing);
  }
  icountTimers.set(wrap, setTimeout(hideIcountScrollbar, 1600, wrap));
}

function handleIcountScroll(event) {
  syncIcountScrollbars();
  showIcountScrollbar(event.currentTarget);
}

function handleIcountActivity(event) {
  showIcountScrollbar(event.currentTarget);
}

function setupIcountScrollbars() {
  document.querySelectorAll('.icount-tracker-scroll').forEach(function (scroller) {
    scroller.addEventListener('scroll', handleIcountScroll, {passive: true});
    scroller.addEventListener('touchstart', handleIcountActivity, {passive: true});
    scroller.addEventListener('wheel', handleIcountActivity, {passive: true});
    scroller.addEventListener('mouseenter', handleIcountActivity);
  });
  setTimeout(syncIcountScrollbars, 0);
  setTimeout(syncIcountScrollbars, 300);
}

// - Modals -
function openProductMixLabelsModal() {
  let modal = document.getElementById('productMixLabelsModal');
  if (modal) {
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
  }
}

function closeProductMixLabelsModal() {
  let modal = document.getElementById('productMixLabelsModal');
  if (modal) {
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
  }
}

function moveModalsToBody() {
  ['chartZoomModal', 'productMixLabelsModal'].forEach(function (id) {
    let found = Array.from(document.querySelectorAll('[id="' + id + '"]'));
    let fresh = found.filter(function (el) { return el.parentElement !== document.body; });
    if (!fresh.length) {
      return;
    }
    found.forEach(function (el) {
      if (el.parentElement === document.body) {
        el.remove();
      }
    });
    document.body.appendChild(fresh[0]);
  });
}

function setZoomSizing(panel, zoomed) {
  panel.querySelectorAll('[id$="ChartWrap"]').forEach(function (wrap) {
    wrap.style.height = zoomed ? '65vh' : '';
    wrap.style.maxWidth = zoomed ? 'none' : '';
  });
  window.dispatchEvent(new Event('resize'));
}

function openChartZoom(panelId, title) {
  let modal = document.getElementById('chartZoomModal');
  let host = document.getElementById('chartZoomHost');
  let titleEl = document.getElementById('chartZoomTitle');
  let panel = document.getElementById(panelId);
  if (!modal || !host || !panel) {
    return;
  }
  if (activeZoomState) {
    closeChartZoom();
  }
  activeZoomState = {panel: panel, parent: panel.parentElement, next: panel.nextElementSibling};
  host.innerHTML = '';
  host.appendChild(panel);
  setZoomSizing(panel, true);
  if (titleEl) {
    titleEl.textContent = title || 'Chart';
  }
  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
}

function closeChartZoom() {
  let modal = document.getElementById('chartZoomModal');
  let host = document.getElementById('chartZoomHost');
  if (activeZoomState) {
    let state = activeZoomState;
    activeZoomState = null;
    if (state.next && state.next.parentElement === state.parent) {
      state.parent.insertBefore(state.panel, state.next);
    } else {
      state.parent.appendChild(state.panel);
    }
    setZoomSizing(state.panel, false);
  }
  if (host) {
    host.innerHTML = '';
  }
  if (modal) {
    modal.classList.add('hidden');
  }
  document.body.classList.remove('overflow-hidden');
}



function handleDashboardKeydown(event) {
  if (event.key === 'Escape') {
    closeProductMixLabelsModal();
    closeChartZoom();
  }
}

// - Render and load -
function runDashboardSection(name, renderFunction, data) {
  try {
    renderFunction(data);
  } catch (error) {
    console.error('Dashboard section failed: ' + name, error);
  }
}

function renderDashboard(data) {
  applyChartTheme();
  runDashboardSection('header', updateDashboardHeader, data);
  runDashboardSection('gauges', renderGauges, data);
  runDashboardSection('summary', renderSummaryCards, data);
  runDashboardSection('sales-chart', renderSalesChart, data);
  runDashboardSection('performance', renderPerformance, data);
  runDashboardSection('product-mix', renderProductMix, data);
  runDashboardSection('pos-sold', renderPosSold, data);
  runDashboardSection('rankings', renderRankings, data);
  runDashboardSection('bottom-sections', renderBottomSections, data);
  runDashboardSection('icount-scrollbars', setupIcountScrollbars, data);
}

async function loadDashboardData() {
  dashboardRequestId += 1;
  let requestId = dashboardRequestId;
  showDashboardSkeletons();
  try {
    let url = dashboardApiEndpoint + '?' + buildDashboardParams().toString();
    let response = await fetch(url, {credentials: 'same-origin', headers: {'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest'}});
    if (!response.ok) {
      throw new Error(response.status);
    }
    let data = await response.json();
    if (requestId !== dashboardRequestId) {
      return;
    }
    if (data.type === 'error') {
      showDashboardError(data.message || 'Failed to load dashboard data.');
      return;
    }
    dashboardData = data;
    renderDashboard(data);
  } catch (error) {
    if (requestId !== dashboardRequestId) {
      return;
    }
    showDashboardError('Failed to load dashboard data.');
  }
}

function bindDashboardEvent(elementId, eventName, handler) {
  let element = document.getElementById(elementId);
  if (element) {
    element.addEventListener(eventName, handler);
  }
}

function bindDashboardClick(elementId, handler) {
  bindDashboardEvent(elementId, 'click', handler);
}

function initDashboardData() {
	moveModalsToBody();
  cacheDashboardSkeletons();
  loadDashboardData();
}

function handleZoomCloseClick(event) {
  if (event.target.closest('#closeChartZoomBtn, #chartZoomBackdrop')) {
    closeChartZoom();
  }
}

document.addEventListener('click', handleZoomCloseClick);

// - Bindings -
window.loadDashboardData = loadDashboardData;
window.openProductMixLabelsModal = openProductMixLabelsModal;

bindDashboardClick('productMixLabelsBackdrop', closeProductMixLabelsModal);
bindDashboardClick('closeProductMixLabelsBtn', closeProductMixLabelsModal);
bindDashboardClick('chartZoomBackdrop', closeChartZoom);
bindDashboardClick('closeChartZoomBtn', closeChartZoom);
bindDashboardClick('dsh-sales-chart', handleSalesRangeClick);
bindDashboardClick('dsh-product-mix', handleProductMixClick);
bindDashboardClick('dsh-pos-sold', handlePosSoldClick);
bindDashboardEvent('dashboard-filter-form', 'submit', handleDashboardFilterSubmit);
bindDashboardClick('dashboard-filter-reset', handleDashboardFilterReset);
document.addEventListener('keydown', handleDashboardKeydown);
window.addEventListener('resize', syncIcountScrollbars);
window.addEventListener('popstate', handleDashboardPopState);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initDashboardData);
} else {
  initDashboardData();
}
