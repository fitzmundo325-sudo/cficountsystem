/* - State - */
let STORE_DATA_STATE = { data: null, tab: 'sales', rows: [], fullscreenTab: 'sales', restoreFullscreen: false };
let MONTH_ABBR = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let TAB_ORDER = ['sales', 'aggregators', 'sbi', 'cost', 'inventory'];
let TAB_TITLES = { sales: 'Sales Data', aggregators: 'Aggregators', sbi: 'SBI', cost: 'Cost Monitoring', inventory: 'Inventory Monitoring' };
let TAB_ACTIVE_CLASSES = ['border-indigo-600', 'text-indigo-600'];
let TAB_INACTIVE_CLASSES = ['border-transparent', 'text-slate-600', 'hover:text-slate-900', 'hover:border-slate-300'];
let TONE_CLASSES = ['text-emerald-600', 'text-red-600', 'text-amber-600', 'text-emerald-700', 'text-red-700', 'text-slate-500', 'text-slate-700'];
let PENDING_BORDER_CLASSES = ['border-2', 'border-yellow-400'];
let PENDING_CELLS = {
  sales: ['pos_gross', 'ci', 'net_sales', 'tc'],
  aggregators: ['gds_sales', 'gds_tc', 'grab_sales', 'grab_tc', 'foodpanda_sales', 'foodpanda_tc'],
  sbi: ['booth_sales', 'booth_tc', 'bulk_sales', 'bulk_tc', 'reseller_sales', 'reseller_tc', 'tieup_sales', 'tieup_tc', 'ambulant_sales', 'ambulant_tc'],
  cost: ['wastage_amount', 'senior', 'promo', 'bulk'],
  inventory: []
};

let filterForm = document.getElementById('store-data-filter-form');
let monthSelect = document.getElementById('filter-month');
let yearSelect = document.getElementById('filter-year');
let posOpenButton = document.getElementById('open-pos-sold-modal-btn');
let posModal = document.getElementById('pos-sold-modal');
let posOverlay = document.getElementById('pos-sold-overlay');
let posCloseButton = document.getElementById('pos-sold-close');
let posCaption = document.getElementById('pos-sold-caption');
let posMonthSelect = document.getElementById('pos-filter-month');
let posDaySelect = document.getElementById('pos-filter-day');
let posYearSelect = document.getElementById('pos-filter-year');
let posApplyButton = document.getElementById('pos-filter-apply');
let posLatestButton = document.getElementById('pos-filter-latest');
let posEmpty = document.getElementById('pos-sold-empty');
let posNoRows = document.getElementById('pos-sold-no-rows');
let posTableWrap = document.getElementById('pos-sold-table-wrap');
let posBody = document.getElementById('pos-sold-body');
let missingModal = document.getElementById('missing-dates-modal');
let missingGoButton = document.getElementById('missing-dates-go');

/* - Formatting helpers - */
function pad2(value) {
  return String(value).padStart(2, '0');
}

function numberOf(value) {
  let parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatDecimal(value, digits) {
  return numberOf(value).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatPeso(value) {
  return '\u20B1' + formatDecimal(value, 2);
}

function formatPercent(value, digits) {
  return numberOf(value).toFixed(digits) + '%';
}

function formatWhole(value) {
  return Math.round(numberOf(value)).toLocaleString('en-US');
}

function formatRaw(value) {
  return String(numberOf(value));
}

function formatByType(value, type) {
  if (type === 'peso') { return formatPeso(value); }
  if (type === 'plain2') { return formatDecimal(value, 2); }
  if (type === 'p1') { return formatPercent(value, 1); }
  if (type === 'p2') { return formatPercent(value, 2); }
  return formatWhole(value);
}

function resolvePath(source, path) {
  let current = source;
  let parts = path.split('.');
  for (let i = 0; i < parts.length; i++) {
    if (current === null || current === undefined) { return 0; }
    current = current[parts[i]];
  }
  return current;
}

function fieldOf(report, name) {
  return report ? report[name] : 0;
}

function calcOf(report, name) {
  return report && report.calc ? report.calc[name] : 0;
}

function setCell(row, name, text) {
  let cell = row.querySelector('[data-cell="' + name + '"]');
  if (cell) { cell.textContent = text; }
  return cell;
}

function setTone(element, toneClass) {
  if (!element) { return; }
  for (let i = 0; i < TONE_CLASSES.length; i++) {
    element.classList.remove(TONE_CLASSES[i]);
  }
  if (toneClass) { element.classList.add(toneClass); }
}

function toneByValue(value) {
  return numberOf(value) >= 0 ? 'text-emerald-600' : 'text-red-600';
}

/* - Row descriptors - */
function buildRowDescriptors() {
  let data = STORE_DATA_STATE.data;
  let year = data.filters.year;
  let month = data.filters.month;
  let totalDays = data.days_in_month;
  let cutoffDay = totalDays;
  if (data.today.year === year && data.today.month === month) { cutoffDay = data.today.day; }

  let pendingRows = [];
  let dailyRows = [];
  for (let day = 1; day <= totalDays; day++) {
    let dateKey = year + '-' + pad2(month) + '-' + pad2(day);
    let label = MONTH_ABBR[month] + ' ' + pad2(day) + ', ' + year;
    let dayReports = data.reports_by_date[dateKey] || [];
    let settledCount = 0;
    for (let i = 0; i < dayReports.length; i++) {
      let report = dayReports[i];
      if (report.status === 'Pending') {
        pendingRows.push({ day: day, dateKey: dateKey, label: label, report: report, pending: true, flagged: false });
      } else if (report.status === 'Approved' || report.status === 'Rejected') {
        dailyRows.push({ day: day, dateKey: dateKey, label: label, report: report, pending: false, flagged: false });
        settledCount++;
      }
    }
    if (settledCount === 0) {
      dailyRows.push({ day: day, dateKey: dateKey, label: label, report: null, pending: false, flagged: day <= cutoffDay });
    }
  }
  return pendingRows.concat(dailyRows);
}

function fillDateCell(row, desc) {
  let dateCell = row.querySelector('[data-cell="date"]');
  let label = row.querySelector('[data-cell="date-label"]');
  let flag = row.querySelector('[data-cell="missing-flag"]');
  label.textContent = desc.label;
  if (desc.pending) {
    dateCell.classList.add('date-cell-pending');
    row.setAttribute('data-report-id', desc.report.id);
  } else {
    row.classList.add('hover:bg-slate-50');
  }
  if (desc.flagged) {
    label.classList.add('text-red-700', 'font-semibold');
    flag.classList.remove('hidden');
  }
}

function markPending(row, tab) {
  let names = PENDING_CELLS[tab] || [];
  for (let i = 0; i < names.length; i++) {
    let cell = row.querySelector('[data-cell="' + names[i] + '"]');
    if (cell) { cell.classList.add(...PENDING_BORDER_CLASSES); }
  }
}

function renderTable(tab, fillFunction) {
  let body = document.getElementById(tab + '-body');
  let template = document.getElementById('tmpl-' + tab + '-row');
  let fragment = document.createDocumentFragment();
  let rows = STORE_DATA_STATE.rows;
  for (let i = 0; i < rows.length; i++) {
    let node = template.content.firstElementChild.cloneNode(true);
    fillDateCell(node, rows[i]);
    fillFunction(node, rows[i]);
    if (rows[i].pending) { markPending(node, tab); }
    fragment.appendChild(node);
  }
  body.replaceChildren(fragment);
}

/* - Row fillers - */
function fillMtdCell(row, name, value) {
  let hasValue = value !== null && value !== undefined;
  let cell = setCell(row, name, hasValue ? formatPercent(value, 1) : '-');
  setTone(cell, hasValue ? toneByValue(value) : 'text-slate-500');
}

function fillSalesRow(row, desc) {
  let data = STORE_DATA_STATE.data;
  let report = desc.report;
  let key = desc.dateKey;
  let dailyTarget = data.daily_targets[key] || {};
  let accTarget = data.acc_daily_targets[key] || {};
  let accSales = data.acc_daily_sales[key] || {};
  let mtd = data.mtd_metrics_by_day[key] || {};

  setCell(row, 'pos_gross', formatPeso(fieldOf(report, 'pos_gross_sales')));
  setCell(row, 'ci', formatPeso(fieldOf(report, 'ci_regular_gross_sales')));
  setCell(row, 'total_gross', formatPeso(calcOf(report, 'total_gross_sales')));
  setCell(row, 'target_net', formatPeso(dailyTarget.target_net));
  setCell(row, 'ly_net', formatPeso(dailyTarget.last_year_net));
  let vsTarget = setCell(row, 'vs_tgt', report ? formatPercent(calcOf(report, 'vs_tgt'), 1) : '-');
  setTone(vsTarget, report ? toneByValue(calcOf(report, 'vs_tgt')) : 'text-slate-500');
  setCell(row, 'net_sales', formatPeso(calcOf(report, 'net_sales')));
  setCell(row, 'acc_net', formatPeso(accSales.net_sales));
  setCell(row, 'acc_target', formatPeso(accTarget.target_net));
  setCell(row, 'acc_ly', formatPeso(accTarget.last_year_net));
  fillMtdCell(row, 'mtd_vs_tgt', mtd.mtd_vs_tgt);
  fillMtdCell(row, 'mtd_vs_ly', mtd.mtd_vs_ly);
  setCell(row, 'gbi_target', formatPeso(dailyTarget.gbi_target));
  setCell(row, 'gbi_acc', formatPeso(accTarget.gbi_target));
  setCell(row, 'ar', report ? formatPercent(calcOf(report, 'ar'), 1) : '-');
  let vsLy = setCell(row, 'vs_ly', report ? formatPercent(calcOf(report, 'vs_ly'), 1) : '-');
  setTone(vsLy, report ? toneByValue(calcOf(report, 'vs_ly')) : 'text-slate-500');
  setCell(row, 'tc', report ? formatRaw(calcOf(report, 'tc_total')) : '0');
  setCell(row, 'ac', report ? formatWhole(calcOf(report, 'ac')) : '0');
}

function fillAggregatorsRow(row, desc) {
  let report = desc.report;
  setCell(row, 'gds_sales', formatPeso(fieldOf(report, 'gds_sales')));
  setCell(row, 'gds_tc', formatRaw(fieldOf(report, 'gds_tc')));
  setCell(row, 'grab_sales', formatPeso(fieldOf(report, 'grab_sales')));
  setCell(row, 'grab_tc', formatRaw(fieldOf(report, 'grab_tc')));
  setCell(row, 'foodpanda_sales', formatPeso(fieldOf(report, 'foodpanda_sales')));
  setCell(row, 'foodpanda_tc', formatRaw(fieldOf(report, 'foodpanda_tc')));
  setCell(row, 'maxim_sales', formatPeso(0));
  setCell(row, 'maxim_tc', '0');
  setCell(row, 'total_sales', formatPeso(numberOf(fieldOf(report, 'gds_sales')) + numberOf(fieldOf(report, 'grab_sales')) + numberOf(fieldOf(report, 'foodpanda_sales'))));
  setCell(row, 'total_tc', formatRaw(numberOf(fieldOf(report, 'gds_tc')) + numberOf(fieldOf(report, 'grab_tc')) + numberOf(fieldOf(report, 'foodpanda_tc'))));
}

function fillSbiRow(row, desc) {
  let report = desc.report;
  setCell(row, 'booth_sales', formatPeso(fieldOf(report, 'boothselling_sales')));
  setCell(row, 'booth_tc', formatRaw(fieldOf(report, 'boothselling_tc')));
  setCell(row, 'bulk_sales', formatPeso(fieldOf(report, 'bulk_order_sales')));
  setCell(row, 'bulk_tc', formatRaw(fieldOf(report, 'bulk_order_tc')));
  setCell(row, 'reseller_sales', formatPeso(fieldOf(report, 'reseller_sales')));
  setCell(row, 'reseller_tc', formatRaw(fieldOf(report, 'reseller_tc')));
  setCell(row, 'tieup_sales', formatPeso(fieldOf(report, 'tieup_sales')));
  setCell(row, 'tieup_tc', formatRaw(fieldOf(report, 'tieup_tc')));
  setCell(row, 'gow_sales', formatPeso(0));
  setCell(row, 'gow_tc', '0');
  setCell(row, 'ambulant_sales', formatPeso(fieldOf(report, 'ambulant_sales')));
  setCell(row, 'ambulant_tc', formatRaw(fieldOf(report, 'ambulant_tc')));
  setCell(row, 'other_sales', formatPeso(0));
  setCell(row, 'other_tc', '0');
  let totalSales = numberOf(fieldOf(report, 'boothselling_sales')) + numberOf(fieldOf(report, 'bulk_order_sales')) + numberOf(fieldOf(report, 'reseller_sales')) + numberOf(fieldOf(report, 'tieup_sales')) + numberOf(fieldOf(report, 'ambulant_sales'));
  let totalTc = numberOf(fieldOf(report, 'boothselling_tc')) + numberOf(fieldOf(report, 'bulk_order_tc')) + numberOf(fieldOf(report, 'reseller_tc')) + numberOf(fieldOf(report, 'tieup_tc')) + numberOf(fieldOf(report, 'ambulant_tc'));
  setCell(row, 'total_sales', formatPeso(totalSales));
  setCell(row, 'total_tc', formatRaw(totalTc));
}

function fillCostRow(row, desc) {
  let report = desc.report;
  setCell(row, 'wastage_amount', formatDecimal(calcOf(report, 'wastage_amount'), 2));
  setCell(row, 'wastage_percent', formatPercent(calcOf(report, 'wastage_percent'), 2));
  setCell(row, 'senior', formatDecimal(fieldOf(report, 'senior_pwd_discount'), 2));
  setCell(row, 'promo', formatDecimal(fieldOf(report, 'promo_ldts_discount'), 2));
  setCell(row, 'bulk', formatDecimal(fieldOf(report, 'bulk_orders_discount'), 2));
  setCell(row, 'total_discount', formatDecimal(calcOf(report, 'total_discount'), 2));
  setCell(row, 'discount_percent', formatPercent(calcOf(report, 'discount_percent'), 2));
}

function fillInventoryRow(row, desc) {
  let report = desc.report;
  setCell(row, 'qty_gc', formatRaw(fieldOf(report, 'pos_qty_gc')));
  setCell(row, 'qty_rolls', formatRaw(fieldOf(report, 'pos_qty_rolls')));
  setCell(row, 'qty_premium', formatRaw(fieldOf(report, 'pos_qty_premium')));
  setCell(row, 'qty_cheesy_ensay', formatRaw(fieldOf(report, 'pos_qty_cheesy_ensay')));
  setCell(row, 'qty_slices', formatRaw(fieldOf(report, 'pos_qty_slices')));
  setCell(row, 'qty_mamon', formatRaw(fieldOf(report, 'pos_qty_mamon')));
  let endGc = setCell(row, 'end_gc', formatRaw(fieldOf(report, 'ending_inv_gc')));
  let endRolls = setCell(row, 'end_rolls', formatRaw(fieldOf(report, 'ending_inv_rolls')));
  let endPremium = setCell(row, 'end_premium', formatRaw(fieldOf(report, 'ending_inv_premium')));
  if (desc.pending) {
    endGc.title = 'Automated from InvenSync';
    endRolls.title = 'Automated from InvenSync';
    endPremium.title = 'Automated from InvenSync';
  }
}

/* - Summary and overview - */
function renderSummaryCells() {
  let summary = STORE_DATA_STATE.data.summary;
  let nodes = document.querySelectorAll('[data-summary]');
  for (let i = 0; i < nodes.length; i++) {
    let value = resolvePath(summary, nodes[i].dataset.summary);
    nodes[i].textContent = formatByType(value, nodes[i].dataset.format);
  }
}

function renderOverviewTones() {
  let overview = STORE_DATA_STATE.data.summary.overview;

  let targetVariance = document.getElementById('target-variance');
  if (numberOf(overview.total_target) > 0) {
    targetVariance.textContent = formatPercent(overview.variance_percent, 1);
    setTone(targetVariance, toneByValue(overview.variance_percent));
  } else {
    targetVariance.textContent = '-';
    setTone(targetVariance, '');
  }

  let varianceValue = document.getElementById('variance-value');
  setTone(varianceValue, numberOf(overview.variance_amount) >= 0 ? 'text-emerald-700' : 'text-red-700');

  let wastageTone = 'text-emerald-600';
  if (numberOf(overview.wastage_percent) >= 3) { wastageTone = 'text-red-600'; }
  else if (numberOf(overview.wastage_percent) >= 1.5) { wastageTone = 'text-amber-600'; }
  setTone(document.getElementById('performance-mtd-wastage-percent'), wastageTone);

  let discountTone = 'text-emerald-600';
  if (numberOf(overview.discount_percent) >= 5) { discountTone = 'text-red-600'; }
  else if (numberOf(overview.discount_percent) >= 2) { discountTone = 'text-amber-600'; }
  setTone(document.getElementById('performance-mtd-discount-percent'), discountTone);
}

/* - Tabs and fullscreen - */
function switchTab(tab) {
  STORE_DATA_STATE.tab = tab;
  for (let i = 0; i < TAB_ORDER.length; i++) {
    let name = TAB_ORDER[i];
    let content = document.getElementById('content-' + name);
    let button = document.getElementById('tab-' + name);
    content.classList.toggle('hidden', name !== tab);
    if (name === tab) {
      button.classList.remove(...TAB_INACTIVE_CLASSES);
      button.classList.add(...TAB_ACTIVE_CLASSES);
    } else {
      button.classList.remove(...TAB_ACTIVE_CLASSES);
      button.classList.add(...TAB_INACTIVE_CLASSES);
    }
  }
  localStorage.setItem('lastActiveTab', tab);
}

function applyFullscreenContent() {
  let tabId = STORE_DATA_STATE.fullscreenTab;
  let data = STORE_DATA_STATE.data;
  let modalContent = document.getElementById('modal-content');
  let activeContent = document.getElementById('content-' + tabId);

  document.getElementById('fullscreen-title').textContent = TAB_TITLES[tabId];
  if (data) {
    document.getElementById('fullscreen-subtitle').textContent = data.store.name + ' - ' + data.store.name + ' - ' + data.filters.month + '/' + data.filters.year;
  }

  let table = activeContent.querySelector('.overflow-x-auto table');
  let clonedTable = table.cloneNode(true);
  let withIds = clonedTable.querySelectorAll('[id]');
  for (let i = 0; i < withIds.length; i++) { withIds[i].removeAttribute('id'); }
  modalContent.replaceChildren(clonedTable);

  modalContent.style.opacity = '1';
  modalContent.style.transform = 'translateY(0)';
}

function updateFullscreenContent(tabId) {
  let modalContent = document.getElementById('modal-content');
  let modal = document.getElementById('fullscreen-modal');
  if (!modal.classList.contains('hidden')) {
    localStorage.setItem('fullscreenTab', tabId);
  }
  STORE_DATA_STATE.fullscreenTab = tabId;
  modalContent.style.opacity = '0';
  modalContent.style.transform = 'translateY(-10px)';
  setTimeout(applyFullscreenContent, 150);
}

function navigateTab(direction) {
  let currentIndex = TAB_ORDER.indexOf(STORE_DATA_STATE.tab);
  let step = direction === 'next' ? 1 : -1;
  let newTab = TAB_ORDER[(currentIndex + step + TAB_ORDER.length) % TAB_ORDER.length];
  let modal = document.getElementById('fullscreen-modal');
  let isFullscreen = !modal.classList.contains('hidden');

  switchTab(newTab);
  if (isFullscreen) { updateFullscreenContent(newTab); }
}

function toggleFullscreen() {
  let modal = document.getElementById('fullscreen-modal');
  if (modal.classList.contains('hidden')) {
    let activeTab = STORE_DATA_STATE.tab;
    updateFullscreenContent(activeTab);
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    localStorage.setItem('isFullscreen', 'true');
    localStorage.setItem('fullscreenTab', activeTab);
    return;
  }
  modal.classList.add('hidden');
  document.body.style.overflow = '';
  localStorage.removeItem('isFullscreen');
  localStorage.removeItem('fullscreenTab');
}

function restoreTabState() {
  let fullscreenFlag = localStorage.getItem('isFullscreen');
  let fullscreenTab = localStorage.getItem('fullscreenTab');
  if (fullscreenFlag === 'true' && fullscreenTab && document.getElementById('tab-' + fullscreenTab)) {
    switchTab(fullscreenTab);
    STORE_DATA_STATE.restoreFullscreen = true;
    return;
  }
  let lastActiveTab = localStorage.getItem('lastActiveTab');
  if (lastActiveTab && document.getElementById('tab-' + lastActiveTab)) {
    switchTab(lastActiveTab);
  }
}

function syncFullscreen() {
  let modal = document.getElementById('fullscreen-modal');
  if (STORE_DATA_STATE.restoreFullscreen) {
    STORE_DATA_STATE.restoreFullscreen = false;
    updateFullscreenContent(STORE_DATA_STATE.tab);
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    return;
  }
  if (!modal.classList.contains('hidden')) {
    updateFullscreenContent(STORE_DATA_STATE.tab);
  }
}

function exportStoreData() {
  if (!STORE_DATA_ROUTES.export) {
    toast.warning('Export is not connected yet.');
    return;
  }
  let data = STORE_DATA_STATE.data;
  if (!data) { return; }
  let query = new URLSearchParams({ month: pad2(data.filters.month), year: String(data.filters.year) });
  window.location.href = STORE_DATA_ROUTES.export + '?' + query.toString();
}

/* - POS Sold modal - */
function openPosModal() {
  posModal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
}

function closePosModal() {
  posModal.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
}

function getPosPayload() {
  let data = STORE_DATA_STATE.data;
  return data && data.pos_modal_payload ? data.pos_modal_payload : [];
}

function findPosReportByDate(isoDate) {
  let payload = getPosPayload();
  for (let i = 0; i < payload.length; i++) {
    if (payload[i].date === isoDate) { return payload[i]; }
  }
  return null;
}

function setPosCaption(report) {
  posCaption.textContent = report ? 'Showing ' + report.label : 'No submitted POS sold data found for selected date';
}

function renderPosResults(report) {
  posEmpty.classList.add('hidden');
  posNoRows.classList.add('hidden');
  posTableWrap.classList.add('hidden');

  if (!report) {
    posEmpty.classList.remove('hidden');
    return;
  }
  if (!Array.isArray(report.items) || report.items.length === 0) {
    posNoRows.textContent = 'No POS sold rows found for ' + report.label + '.';
    posNoRows.classList.remove('hidden');
    return;
  }

  let template = document.getElementById('tmpl-pos-row');
  let fragment = document.createDocumentFragment();
  for (let i = 0; i < report.items.length; i++) {
    let node = template.content.firstElementChild.cloneNode(true);
    setCell(node, 'product', report.items[i].product_name || '');
    setCell(node, 'quantity', Number(report.items[i].quantity || 0).toLocaleString('en-US'));
    fragment.appendChild(node);
  }
  posBody.replaceChildren(fragment);
  posTableWrap.classList.remove('hidden');
}

function setPosDayOptions(year, month, day) {
  let totalDays = new Date(year, month, 0).getDate();
  let safeDay = Math.min(day, totalDays);
  let fragment = document.createDocumentFragment();
  for (let d = 1; d <= totalDays; d++) {
    let option = document.createElement('option');
    option.value = String(d);
    option.textContent = String(d);
    fragment.appendChild(option);
  }
  posDaySelect.replaceChildren(fragment);
  posDaySelect.value = String(safeDay);
}

function applyPosFilter() {
  let year = parseInt(posYearSelect.value, 10);
  let month = parseInt(posMonthSelect.value, 10);
  let day = parseInt(posDaySelect.value, 10);
  let report = findPosReportByDate(year + '-' + pad2(month) + '-' + pad2(day));
  setPosCaption(report);
  renderPosResults(report);
}

function initPosFilters() {
  let payload = getPosPayload();
  let today = STORE_DATA_STATE.data.today;
  let years = [];
  for (let i = 0; i < payload.length; i++) {
    let year = Number((payload[i].date || '').slice(0, 4));
    if (Number.isFinite(year) && year > 0 && years.indexOf(year) === -1) { years.push(year); }
  }
  if (years.length === 0) {
    for (let y = today.year - 2; y <= today.year + 2; y++) { years.push(y); }
  } else if (years.indexOf(today.year) === -1) {
    years.push(today.year);
  }
  years.sort(function(a, b) { return a - b; });

  let fragment = document.createDocumentFragment();
  for (let i = 0; i < years.length; i++) {
    let option = document.createElement('option');
    option.value = String(years[i]);
    option.textContent = String(years[i]);
    fragment.appendChild(option);
  }
  posYearSelect.replaceChildren(fragment);

  let baseYear = today.year;
  let baseMonth = today.month;
  let baseDay = today.day;
  if (payload.length && payload[0].date) {
    let parts = payload[0].date.split('-');
    if (parts.length === 3) {
      baseYear = parseInt(parts[0], 10);
      baseMonth = parseInt(parts[1], 10);
      baseDay = parseInt(parts[2], 10);
    }
  }
  posYearSelect.value = String(baseYear);
  posMonthSelect.value = String(baseMonth);
  setPosDayOptions(baseYear, baseMonth, baseDay);
  applyPosFilter();
}

function handlePosDatePartChange() {
  setPosDayOptions(parseInt(posYearSelect.value, 10), parseInt(posMonthSelect.value, 10), parseInt(posDaySelect.value, 10));
  applyPosFilter();
}

function handlePosLatest() {
  let payload = getPosPayload();
  if (!(payload.length && payload[0].date)) {
    applyPosFilter();
    return;
  }
  let parts = payload[0].date.split('-');
  if (parts.length !== 3) { return; }
  let year = parseInt(parts[0], 10);
  let month = parseInt(parts[1], 10);
  let day = parseInt(parts[2], 10);
  posYearSelect.value = String(year);
  posMonthSelect.value = String(month);
  setPosDayOptions(year, month, day);
  applyPosFilter();
}

/* - Missing dates modal - */
function showMissingModal() {
  missingModal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
}

function hideMissingModal() {
  missingModal.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
}

function renderMissingDates() {
  let missing = STORE_DATA_STATE.data.missing_dates || [];
  let list = document.getElementById('missing-dates-list');
  let template = document.getElementById('tmpl-missing-row');
  let fragment = document.createDocumentFragment();
  for (let i = 0; i < missing.length; i++) {
    let node = template.content.firstElementChild.cloneNode(true);
    setCell(node, 'label', missing[i].label);
    setCell(node, 'iso', missing[i].iso);
    fragment.appendChild(node);
  }
  list.replaceChildren(fragment);
  document.getElementById('missing-dates-count').textContent = missing.length + ' missing date' + (missing.length === 1 ? '' : 's') + ' found for this month.';
  if (missing.length > 0) {
    showMissingModal();
  } else {
    hideMissingModal();
  }
}

function handleMissingGo() {
  let nextMissing = STORE_DATA_STATE.data ? STORE_DATA_STATE.data.next_missing_date : null;
  if (nextMissing) {
    window.location.href = STORE_DATA_ROUTES.dailyReport + '?date=' + encodeURIComponent(nextMissing);
    return;
  }
  hideMissingModal();
}

/* - Loading - */
function buildSkeleton() {
  let cardTemplate = document.getElementById('tmpl-skeleton-card');
  let rowTemplate = document.getElementById('tmpl-skeleton-row');
  let cards = document.createDocumentFragment();
  let rows = document.createDocumentFragment();
  for (let i = 0; i < 6; i++) { cards.appendChild(cardTemplate.content.firstElementChild.cloneNode(true)); }
  for (let j = 0; j < 12; j++) { rows.appendChild(rowTemplate.content.firstElementChild.cloneNode(true)); }
  document.getElementById('skeleton-cards').replaceChildren(cards);
  document.getElementById('skeleton-rows').replaceChildren(rows);
}

function showSkeleton(visible) {
  document.getElementById('store-data-skeleton').classList.toggle('hidden', !visible);
  document.getElementById('store-data-content').classList.toggle('hidden', visible);
}

function renderAll() {
  let data = STORE_DATA_STATE.data;
  STORE_DATA_STATE.rows = buildRowDescriptors();
  document.getElementById('header-store-name').textContent = data.store.name;
  document.getElementById('filter-store-name').textContent = data.store.name;
  monthSelect.value = pad2(data.filters.month);
  yearSelect.value = String(data.filters.year);
  renderSummaryCells();
  renderOverviewTones();
  renderTable('sales', fillSalesRow);
  renderTable('aggregators', fillAggregatorsRow);
  renderTable('sbi', fillSbiRow);
  renderTable('cost', fillCostRow);
  renderTable('inventory', fillInventoryRow);
  initPosFilters();
  syncFullscreen();
  renderMissingDates();
}

function readJsonResponse(response) {
  return response.json();
}

function handleDataResponse(data) {
  showSkeleton(false);
  if (!data || data.type !== 'success') {
    toast.error((data && data.message) || 'Failed to load store data.');
    return;
  }
  STORE_DATA_STATE.data = data;
  renderAll();
}

function handleDataError(error) {
  showSkeleton(false);
  console.error(error);
  toast.error('Failed to load store data.');
}

function loadStoreData(shouldPush) {
  let month = monthSelect.value;
  let year = yearSelect.value;
  if (shouldPush) {
    history.pushState({ month: month, year: year }, '', '?month=' + encodeURIComponent(month) + '&year=' + encodeURIComponent(year));
  }
  showSkeleton(true);
  let query = new URLSearchParams({ month: month, year: year });
  fetch(STORE_DATA_ROUTES.data + '?' + query.toString(), { credentials: 'same-origin' })
    .then(readJsonResponse)
    .then(handleDataResponse)
    .catch(handleDataError);
}

function applyUrlToFilters() {
  let params = new URLSearchParams(window.location.search);
  monthSelect.value = pad2(parseInt(params.get('month') || STORE_DATA_INIT.month, 10));
  yearSelect.value = String(params.get('year') || STORE_DATA_INIT.year);
}

function handleFilterSubmit(event) {
  event.preventDefault();
  loadStoreData(true);
}

function handlePopState() {
  applyUrlToFilters();
  loadStoreData(false);
}

/* - Bind events - */
filterForm.addEventListener('submit', handleFilterSubmit);
window.addEventListener('popstate', handlePopState);
posOpenButton.addEventListener('click', openPosModal);
posOverlay.addEventListener('click', closePosModal);
posCloseButton.addEventListener('click', closePosModal);
posApplyButton.addEventListener('click', applyPosFilter);
posLatestButton.addEventListener('click', handlePosLatest);
posYearSelect.addEventListener('change', handlePosDatePartChange);
posMonthSelect.addEventListener('change', handlePosDatePartChange);
posDaySelect.addEventListener('change', applyPosFilter);
missingGoButton.addEventListener('click', handleMissingGo);

/* - Start - */
buildSkeleton();
applyUrlToFilters();
restoreTabState();
loadStoreData(false);
