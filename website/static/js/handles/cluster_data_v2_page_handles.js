/* - Constants - */
let API_CLUSTER_DATA = '/apis/cluster_data_v2';
let API_POS_SOLD = '/apis/cluster_data_pos_sold';

let MONTH_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
let MONTH_FULL = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
let TAB_ORDER = ['sales', 'aggregators', 'sbi', 'cost', 'inventory'];
let TAB_LABELS = {
  sales: 'Sales Data',
  aggregators: 'Aggregators',
  sbi: 'SBI',
  cost: 'Cost Monitoring',
  inventory: 'Inventory Monitoring'
};

let FORMATTERS = {
  peso: formatPeso,
  dec2: formatDecimal2,
  int: formatInteger,
  pct1: formatPercent1,
  pct2: formatPercent2
};

/* - Field definitions - */
let AGGREGATOR_FIELDS = [
  ['gds_sales', 'peso'], ['gds_tc', 'int'],
  ['grab_sales', 'peso'], ['grab_tc', 'int'],
  ['foodpanda_sales', 'peso'], ['foodpanda_tc', 'int']
];
let AGGREGATOR_SALES = ['gds_sales', 'grab_sales', 'foodpanda_sales'];
let AGGREGATOR_TC = ['gds_tc', 'grab_tc', 'foodpanda_tc'];

let SBI_FIELDS = [
  ['boothselling_sales', 'peso'], ['boothselling_tc', 'int'],
  ['bulk_order_sales', 'peso'], ['bulk_order_tc', 'int'],
  ['reseller_sales', 'peso'], ['reseller_tc', 'int'],
  ['tieup_sales', 'peso'], ['tieup_tc', 'int'],
  ['gow_sales', 'peso'], ['gow_tc', 'int'],
  ['ambulant_sales', 'peso'], ['ambulant_tc', 'int']
];
let SBI_SALES = ['boothselling_sales', 'bulk_order_sales', 'reseller_sales', 'tieup_sales', 'gow_sales', 'ambulant_sales'];
let SBI_TC = ['boothselling_tc', 'bulk_order_tc', 'reseller_tc', 'tieup_tc', 'gow_tc', 'ambulant_tc'];

let COST_REPORT_FIELDS = [
  ['senior_pwd_discount', 'dec2'],
  ['promo_ldts_discount', 'dec2'],
  ['bulk_orders_discount', 'dec2']
];

let INVENTORY_FIELDS = [
  ['pos_qty_gc', 'int'], ['pos_qty_rolls', 'int'], ['pos_qty_premium', 'int'],
  ['pos_qty_cheesy_ensay', 'int'], ['pos_qty_slices', 'int'], ['pos_qty_mamon', 'int'],
  ['ending_inv_gc', 'int'], ['ending_inv_rolls', 'int'], ['ending_inv_premium', 'int']
];

let AGGREGATOR_EDITABLE = buildSimpleEditable(fieldNames(AGGREGATOR_FIELDS));
let SBI_EDITABLE = buildSimpleEditable(fieldNames(SBI_FIELDS));
let COST_EDITABLE = {
  wastage_amount: {fields: ['spoilage_gc', 'spoilage_rolls', 'spoilage_premium', 'spoilage_others'], border: true},
  wastage_percent: {fields: ['spoilage_percentage'], border: false},
  senior_pwd_discount: {fields: ['senior_pwd_discount'], border: true},
  promo_ldts_discount: {fields: ['promo_ldts_discount'], border: true},
  bulk_orders_discount: {fields: ['bulk_orders_discount'], border: true},
  total_discount: {fields: ['total_discount'], border: false},
  discount_percent: {fields: ['discount_percentage'], border: false}
};

let FOOTER_FORMATS = {
  sales: formatMap({
    peso: ['gross_sales', 'ci_sales', 'total_gross_sales', 'target_net', 'last_year_net', 'net_sales', 'acc_net_sales', 'acc_target_net', 'acc_ly_net', 'gbi_target', 'acc_gbi'],
    pct1: ['vs_tgt_percent', 'mtd_vs_tgt_percent', 'mtd_vs_ly_percent', 'ar_percent', 'vs_ly_percent'],
    int: ['tc', 'ac']
  }),
  aggregators: formatMap({
    peso: ['gds_sales', 'grab_sales', 'foodpanda_sales', 'maxim_sales', 'total_agg_sales'],
    int: ['gds_tc', 'grab_tc', 'foodpanda_tc', 'maxim_tc', 'total_agg_tc']
  }),
  sbi: formatMap({
    peso: ['boothselling_sales', 'bulk_order_sales', 'reseller_sales', 'tieup_sales', 'gow_sales', 'ambulant_sales', 'other_sbi_sales', 'total_sbi_sales'],
    int: ['boothselling_tc', 'bulk_order_tc', 'reseller_tc', 'tieup_tc', 'gow_tc', 'ambulant_tc', 'other_sbi_tc', 'total_sbi_tc']
  }),
  cost: formatMap({
    dec2: ['wastage_amount', 'senior_pwd_discount', 'promo_ldts_discount', 'bulk_orders_discount', 'total_discount'],
    pct2: ['wastage_daily_percent', 'discount_daily_percent']
  }),
  inventory: formatMap({
    int: ['pos_qty_gc', 'pos_qty_rolls', 'pos_qty_premium', 'pos_qty_cheesy_ensay', 'pos_qty_slices', 'pos_qty_mamon', 'ending_inv_gc', 'ending_inv_rolls', 'ending_inv_premium']
  })
};

let TAB_CONFIG = {
  sales: {bodyId: 'salesBody', footerId: 'salesFooter', templateId: 'salesRowTemplate', pinPending: false, rowMode: 'report', dateBorder: false, fill: fillSalesRow, editable: null, pendingTitleCells: []},
  aggregators: {bodyId: 'aggregatorsBody', footerId: 'aggregatorsFooter', templateId: 'aggregatorsRowTemplate', pinPending: true, rowMode: 'report', dateBorder: false, fill: fillAggregatorsRow, editable: AGGREGATOR_EDITABLE, pendingTitleCells: []},
  sbi: {bodyId: 'sbiBody', footerId: 'sbiFooter', templateId: 'sbiRowTemplate', pinPending: true, rowMode: 'report', dateBorder: false, fill: fillSbiRow, editable: SBI_EDITABLE, pendingTitleCells: []},
  cost: {bodyId: 'costBody', footerId: 'costFooter', templateId: 'costRowTemplate', pinPending: true, rowMode: 'report', dateBorder: true, fill: fillCostRow, editable: COST_EDITABLE, pendingTitleCells: []},
  inventory: {bodyId: 'inventoryBody', footerId: 'inventoryFooter', templateId: 'inventoryRowTemplate', pinPending: true, rowMode: 'plain', dateBorder: true, fill: fillInventoryRow, editable: null, pendingTitleCells: ['ending_inv_gc', 'ending_inv_rolls', 'ending_inv_premium']}
};

/* - State - */
let clusterState = {data: null, activeTab: 'sales', editMode: false};
let filterState = {cluster_id: initialClusterId, month: initialMonth, year: initialYear, store_id: initialStoreId};
let posState = {initialized: false, scopeKey: ''};
let exportModal = null;
let exportSubmitHtml = '';

/* - Generic helpers - */
function byId(id) {
  return document.getElementById(id);
}

function toNumber(value) {
  let number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function formatNumber(value, decimals) {
  return toNumber(value).toLocaleString('en-US', {minimumFractionDigits: decimals, maximumFractionDigits: decimals});
}

function formatPeso(value) {
  return '\u20B1' + formatNumber(value, 2);
}

function formatDecimal2(value) {
  return formatNumber(value, 2);
}

function formatInteger(value) {
  return formatNumber(value, 0);
}

function formatPercent1(value) {
  return formatNumber(value, 1) + '%';
}

function formatPercent2(value) {
  return formatNumber(value, 2) + '%';
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function sumFields(source, names) {
  let total = 0;
  names.forEach(function (name) {
    total += toNumber(source[name]);
  });
  return total;
}

function fieldNames(fields) {
  return fields.map(function (field) {
    return field[0];
  });
}

function formatMap(spec) {
  let map = {};
  Object.keys(spec).forEach(function (format) {
    spec[format].forEach(function (key) {
      map[key] = format;
    });
  });
  return map;
}

function buildSimpleEditable(names) {
  let map = {};
  names.forEach(function (name) {
    map[name] = {fields: [name], border: true};
  });
  return map;
}

function cloneTemplate(id) {
  return byId(id).content.firstElementChild.cloneNode(true);
}

function getCell(root, name) {
  return root.querySelector('[data-cell="' + name + '"]');
}

function setCellText(root, name, text) {
  let cell = getCell(root, name);
  if (cell) cell.textContent = text;
  return cell;
}

function setText(id, text) {
  let element = byId(id);
  if (element) element.textContent = text;
  return element;
}

function setTone(element, tone, allTones) {
  if (!element) return;
  element.classList.remove.apply(element.classList, allTones);
  if (tone) element.classList.add(tone);
}

function setSignedCell(root, name, value, formatter) {
  let cell = getCell(root, name);
  if (!cell) return;
  cell.classList.remove('text-slate-700', 'text-slate-500', 'text-emerald-600', 'text-red-600');
  if (value === null || value === undefined) {
    cell.textContent = '-';
    cell.classList.add('text-slate-500');
    return;
  }
  cell.textContent = formatter(value);
  cell.classList.add(toNumber(value) >= 0 ? 'text-emerald-600' : 'text-red-600');
}

function fillFields(row, source, fields) {
  fields.forEach(function (field) {
    setCellText(row, field[0], FORMATTERS[field[1]](source[field[0]]));
  });
}

function showToastError(message) {
  toast.error(message);
}

/* - Row fillers - */
function fillSalesRow(row, report, dateKey) {
  let data = clusterState.data;
  let daily = data.daily_targets[dateKey] || {};
  let accTargets = data.acc_daily_targets[dateKey] || {};
  let accSales = data.acc_daily_sales[dateKey] || {};
  let mtd = data.mtd_metrics_by_day[dateKey] || {};
  let calc = report ? report.calc : null;
  let source = report || {};

  setCellText(row, 'pos_gross_sales', formatPeso(source.pos_gross_sales));
  setCellText(row, 'ci_regular_gross_sales', formatPeso(source.ci_regular_gross_sales));
  setCellText(row, 'total_gross_sales', formatPeso(calc ? calc.total_gross_sales : 0));
  setCellText(row, 'target_net', formatPeso(daily.target_net));
  setCellText(row, 'last_year_net', formatPeso(daily.last_year_net));
  setSignedCell(row, 'vs_tgt', calc ? calc.vs_tgt : null, formatPercent1);
  setCellText(row, 'net_sales', formatPeso(calc ? calc.net_sales : 0));
  setCellText(row, 'acc_net_sales', formatPeso(accSales.net_sales));
  setCellText(row, 'acc_target_net', formatPeso(accTargets.target_net));
  setCellText(row, 'acc_ly_net', formatPeso(accTargets.last_year_net));
  setSignedCell(row, 'mtd_vs_tgt', mtd.mtd_vs_tgt, formatPercent1);
  setSignedCell(row, 'mtd_vs_ly', mtd.mtd_vs_ly, formatPercent1);
  setCellText(row, 'gbi_target', formatPeso(daily.gbi_target));
  setCellText(row, 'acc_gbi_target', formatPeso(accTargets.gbi_target));
  setCellText(row, 'ar', calc ? formatPercent1(calc.ar) : '-');
  setSignedCell(row, 'vs_ly', calc ? calc.vs_ly : null, formatPercent1);
  setCellText(row, 'tc', calc ? formatInteger(calc.tc_total) : '0');
  setCellText(row, 'ac', calc ? formatInteger(calc.ac) : '0');
}

function fillAggregatorsRow(row, report) {
  let source = report || {};
  fillFields(row, source, AGGREGATOR_FIELDS);
  setCellText(row, 'maxim_sales', formatPeso(0));
  setCellText(row, 'maxim_tc', formatInteger(0));
  setCellText(row, 'total_agg_sales', formatPeso(sumFields(source, AGGREGATOR_SALES)));
  setCellText(row, 'total_agg_tc', formatInteger(sumFields(source, AGGREGATOR_TC)));
}

function fillSbiRow(row, report) {
  let source = report || {};
  fillFields(row, source, SBI_FIELDS);
  setCellText(row, 'other_sbi_sales', formatPeso(0));
  setCellText(row, 'other_sbi_tc', formatInteger(0));
  setCellText(row, 'total_sbi_sales', formatPeso(sumFields(source, SBI_SALES)));
  setCellText(row, 'total_sbi_tc', formatInteger(sumFields(source, SBI_TC)));
}

function fillCostRow(row, report) {
  let source = report || {};
  let calc = report ? report.calc : null;
  setCellText(row, 'wastage_amount', formatDecimal2(calc ? calc.wastage_amount : 0));
  setCellText(row, 'wastage_percent', formatPercent2(calc ? calc.wastage_percent : 0));
  fillFields(row, source, COST_REPORT_FIELDS);
  setCellText(row, 'total_discount', formatDecimal2(calc ? calc.total_discount : 0));
  setCellText(row, 'discount_percent', formatPercent2(calc ? calc.discount_percent : 0));
}

function fillInventoryRow(row, report) {
  fillFields(row, report || {}, INVENTORY_FIELDS);
}

/* - Row building - */
function markEditable(row, editable) {
  if (!editable) return;
  Object.keys(editable).forEach(function (name) {
    let cell = getCell(row, name);
    if (!cell) return;
    let spec = editable[name];
    cell.classList.add('editable-cell');
    cell.title = 'Click to edit';
    spec.fields.forEach(function (field, index) {
      cell.setAttribute(index === 0 ? 'data-field' : 'data-field' + (index + 1), field);
    });
    if (spec.border) cell.classList.add('border-2', 'border-yellow-400');
  });
}

function getCutoffDay() {
  let data = clusterState.data;
  if (data.filters.year === data.today.year && data.filters.month === data.today.month) return data.today.day;
  return data.days_in_month;
}

function buildDateCell(config, day, report, mode) {
  let data = clusterState.data;
  let cell = cloneTemplate('clusterDateCellTemplate');
  let label = getCell(cell, 'dateLabel');
  let missing = getCell(cell, 'missing');
  let approve = getCell(cell, 'approve');

  label.textContent = MONTH_SHORT[data.filters.month] + ' ' + pad2(day) + ', ' + data.filters.year;
  if (config.dateBorder) cell.classList.add('border-r', 'border-slate-100');

  if (mode === 'pending') {
    cell.classList.add('date-cell-pending');
    cell.dataset.reportId = report.id;
    missing.remove();
    return cell;
  }

  approve.remove();
  if (mode === 'blank' && day <= getCutoffDay()) {
    label.classList.add('text-red-700', 'font-semibold');
  } else {
    missing.remove();
  }
  return cell;
}

function buildRow(tab, report, day, mode) {
  let config = TAB_CONFIG[tab];
  let data = clusterState.data;
  let dateKey = data.filters.year + '-' + pad2(data.filters.month) + '-' + pad2(day);
  let row = cloneTemplate(config.templateId);

  row.replaceChild(buildDateCell(config, day, report, mode), getCell(row, 'dateCell'));
  config.fill(row, report, dateKey);

  if (mode === 'pending') {
    row.classList.add('editable-row');
    row.dataset.reportId = report.id;
    markEditable(row, config.editable);
    config.pendingTitleCells.forEach(function (name) {
      let cell = getCell(row, name);
      if (cell) cell.title = 'Automated from InvenSync';
    });
    return row;
  }

  row.classList.add('hover:bg-slate-50');
  if (mode === 'report' && config.rowMode === 'report') {
    row.classList.add('report-row', 'editable-row');
    row.dataset.reportId = report.id;
    row.dataset.reportStatus = report.status;
  }
  return row;
}

function getDayKey(day) {
  let filters = clusterState.data.filters;
  return filters.year + '-' + pad2(filters.month) + '-' + pad2(day);
}

function getDayReports(day) {
  return clusterState.data.reports_by_date[getDayKey(day)] || [];
}

function renderTab(tab) {
  let config = TAB_CONFIG[tab];
  let fragment = document.createDocumentFragment();
  let totalDays = clusterState.data.days_in_month;

  if (config.pinPending) {
    for (let day = 1; day <= totalDays; day += 1) {
      getDayReports(day).forEach(function (report) {
        if (report.status === 'Pending') fragment.appendChild(buildRow(tab, report, day, 'pending'));
      });
    }
  }

  for (let day = 1; day <= totalDays; day += 1) {
    let reports = getDayReports(day);
    if (config.pinPending) {
      reports = reports.filter(function (report) {
        return report.status === 'Approved' || report.status === 'Rejected';
      });
    }
    if (reports.length) {
      reports.forEach(function (report) {
        fragment.appendChild(buildRow(tab, report, day, 'report'));
      });
    } else {
      fragment.appendChild(buildRow(tab, null, day, 'blank'));
    }
  }

  byId(config.bodyId).replaceChildren(fragment);
}

function renderFooter(tab) {
  let footer = byId(TAB_CONFIG[tab].footerId);
  let summary = clusterState.data.summary[tab] || {};
  let formats = FOOTER_FORMATS[tab];
  Object.keys(formats).forEach(function (key) {
    setCellText(footer, key, FORMATTERS[formats[key]](summary[key]));
  });
}

/* - Overview and filters - */
function renderOverview(data) {
  let overview = data.summary.overview;
  let varianceTones = ['text-emerald-600', 'text-red-600'];
  let amountTones = ['text-emerald-700', 'text-red-700'];
  let levelTones = ['text-red-600', 'text-amber-600', 'text-emerald-600'];

  setText('overview-store-name', data.selected_store_name);
  setText('overview-month', MONTH_FULL[data.filters.month]);
  setText('mtd-sales-value', formatPeso(overview.mtd_sales));
  setText('target-value', formatPeso(overview.total_target));

  let targetVariance = byId('target-variance');
  if (toNumber(overview.total_target) > 0) {
    targetVariance.textContent = formatPercent1(overview.variance_percent);
    setTone(targetVariance, toNumber(overview.variance_percent) >= 0 ? 'text-emerald-600' : 'text-red-600', varianceTones);
  } else {
    targetVariance.textContent = '-';
    setTone(targetVariance, null, varianceTones);
  }

  let varianceValue = byId('variance-value');
  varianceValue.textContent = formatPeso(overview.variance_amount);
  setTone(varianceValue, toNumber(overview.variance_amount) >= 0 ? 'text-emerald-700' : 'text-red-700', amountTones);

  setText('performance-sbi-value', formatPeso(overview.sbi_sales));
  setText('performance-sbi-percentage', formatPercent2(overview.sbi_percent));

  setText('performance-mtd-wastage', formatPeso(overview.wastage_amount));
  let wastagePercent = toNumber(overview.wastage_percent);
  setText('performance-mtd-wastage-percent', formatPercent2(wastagePercent));
  setTone(byId('performance-mtd-wastage-percent'), wastagePercent >= 3 ? 'text-red-600' : (wastagePercent >= 1.5 ? 'text-amber-600' : 'text-emerald-600'), levelTones);

  setText('performance-mtd-discount', formatPeso(overview.discount_amount));
  let discountPercent = toNumber(overview.discount_percent);
  setText('performance-mtd-discount-percent', formatPercent2(discountPercent));
  setTone(byId('performance-mtd-discount-percent'), discountPercent >= 5 ? 'text-red-600' : (discountPercent >= 2 ? 'text-amber-600' : 'text-emerald-600'), levelTones);
}

function renderFilters(data) {
  let storeSelect = byId('filter-store');
  let monthSelect = byId('filter-month');
  let yearSelect = byId('filter-year');

  storeSelect.replaceChildren(new Option('All Stores', ''));
  data.stores.forEach(function (store) {
    storeSelect.appendChild(new Option(store.name, String(store.id)));
  });
  storeSelect.value = data.filters.store_id;

  monthSelect.value = pad2(data.filters.month);

  let yearValue = String(data.filters.year);
  let hasYear = Array.from(yearSelect.options).some(function (option) {
    return option.value === yearValue;
  });
  if (!hasYear) yearSelect.appendChild(new Option(yearValue, yearValue));
  yearSelect.value = yearValue;

  filterState.month = pad2(data.filters.month);
  filterState.year = yearValue;
  filterState.store_id = data.filters.store_id;
  filterState.cluster_id = String(data.cluster.id);
}

function syncExportForm(data) {
  byId('export-cluster-id').value = data.cluster.id;
  byId('export-month').value = pad2(data.filters.month);
  byId('export-year').value = data.filters.year;
  byId('export-store-id').value = data.filters.store_id;
}

function renderAll(data) {
  setText('headerClusterName', data.cluster.name);
  renderFilters(data);
  renderOverview(data);
  TAB_ORDER.forEach(function (tab) {
    renderTab(tab);
    renderFooter(tab);
  });
  syncExportForm(data);
  if (isFullscreenOpen()) renderFullscreen();
}

/* - Loading - */
function buildQueryParams() {
  let params = new URLSearchParams();
  if (filterState.cluster_id) params.set('cluster_id', filterState.cluster_id);
  if (filterState.month) params.set('month', filterState.month);
  if (filterState.year) params.set('year', filterState.year);
  if (filterState.store_id) params.set('store_id', filterState.store_id);
  if (initialStoreScope) params.set('store_scope', initialStoreScope);
  return params;
}

function setLoading(isLoading) {
  byId('clusterDataLoading').classList.toggle('hidden', !isLoading);
  byId('main-content').classList.toggle('opacity-60', isLoading);
}

function syncUrl() {
  let url = new URL(window.location.href);
  let entries = {cluster_id: filterState.cluster_id, month: filterState.month, year: filterState.year, store_id: filterState.store_id};
  Object.keys(entries).forEach(function (key) {
    if (entries[key]) {
      url.searchParams.set(key, entries[key]);
    } else {
      url.searchParams.delete(key);
    }
  });
  history.pushState({}, '', url.toString());
}

async function loadClusterData(pushHistory) {
  setLoading(true);
  try {
    let response = await fetch(API_CLUSTER_DATA + '?' + buildQueryParams().toString(), {
      headers: {'Accept': 'application/json'},
      credentials: 'same-origin'
    });
    let data = await response.json();
    if (data.type !== 'success') {
      showToastError(data.message || 'Unable to load cluster data.');
      return;
    }
    clusterState.data = data;
    renderAll(data);
    if (posState.scopeKey !== data.cluster.id + ':' + data.filters.store_id) {
      posState.initialized = false;
      posState.scopeKey = data.cluster.id + ':' + data.filters.store_id;
    }
    if (pushHistory) syncUrl();
  } catch (error) {
    showToastError('Failed to load cluster data.');
  } finally {
    setLoading(false);
  }
}

function handleFilterSubmit(event) {
  event.preventDefault();
  filterState.store_id = byId('filter-store').value;
  filterState.month = byId('filter-month').value;
  filterState.year = byId('filter-year').value;
  loadClusterData(true);
}

function handlePopState() {
  let params = new URLSearchParams(window.location.search);
  filterState.cluster_id = params.get('cluster_id') || '';
  filterState.month = params.get('month') || '';
  filterState.year = params.get('year') || '';
  filterState.store_id = params.get('store_id') || '';
  loadClusterData(false);
}

/* - Tabs, edit toggle, fullscreen - */
function setActiveTab(tab) {
  clusterState.activeTab = tab;
  TAB_ORDER.forEach(function (name) {
    let button = byId('tab-' + name);
    let content = byId('content-' + name);
    let isActive = name === tab;
    content.classList.toggle('hidden', !isActive);
    button.classList.toggle('border-indigo-600', isActive);
    button.classList.toggle('text-indigo-600', isActive);
    button.classList.toggle('border-transparent', !isActive);
    button.classList.toggle('text-slate-600', !isActive);
    button.classList.toggle('hover:text-slate-900', !isActive);
    button.classList.toggle('hover:border-slate-300', !isActive);
  });
}

function handleTabClick(event) {
  setActiveTab(event.currentTarget.dataset.tab);
  if (isFullscreenOpen()) renderFullscreen();
}

function toggleEditMode() {
  clusterState.editMode = !clusterState.editMode;
  let isOn = clusterState.editMode;
  let toggle = byId('edit-mode-toggle');
  let circle = byId('edit-mode-toggle-circle');
  let label = byId('edit-mode-toggle-label');

  toggle.setAttribute('aria-pressed', String(isOn));
  toggle.classList.toggle('bg-indigo-600', isOn);
  toggle.classList.toggle('bg-slate-300', !isOn);
  circle.classList.toggle('translate-x-6', isOn);
  circle.classList.toggle('translate-x-1', !isOn);
  label.textContent = isOn ? 'ON' : 'OFF';
  label.classList.toggle('text-indigo-600', isOn);
  label.classList.toggle('text-slate-500', !isOn);
  byId('main-content').classList.toggle('edit-mode-on', isOn);
}

function isFullscreenOpen() {
  return !byId('fullscreen-modal').classList.contains('hidden');
}

function renderFullscreen() {
  let data = clusterState.data;
  let source = byId('content-' + clusterState.activeTab);
  let clone = source.cloneNode(true);

  clone.classList.remove('hidden');
  clone.removeAttribute('id');
  clone.querySelectorAll('[id]').forEach(function (node) {
    node.removeAttribute('id');
  });
  byId('modal-content').replaceChildren(clone);

  setText('fullscreen-title', TAB_LABELS[clusterState.activeTab]);
  if (data) {
    let subtitle = data.cluster.name + ' - ' + MONTH_FULL[data.filters.month] + ' ' + data.filters.year;
    if (data.filters.store_id) subtitle += ' - ' + data.selected_store_name;
    setText('fullscreen-subtitle', subtitle);
  }
}

function toggleFullscreen() {
  let modal = byId('fullscreen-modal');
  if (isFullscreenOpen()) {
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    return;
  }
  renderFullscreen();
  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
}

function navigateTab(direction) {
  let index = TAB_ORDER.indexOf(clusterState.activeTab);
  let step = direction === 'next' ? 1 : -1;
  setActiveTab(TAB_ORDER[(index + step + TAB_ORDER.length) % TAB_ORDER.length]);
  renderFullscreen();
}

function handleFullscreenPrev() {
  navigateTab('prev');
}

function handleFullscreenNext() {
  navigateTab('next');
}

/* - POS Sold modal - */
function openPosModal() {
  byId('pos-sold-modal').classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
  if (!posState.initialized) loadPosSold('');
}

function closePosModal() {
  byId('pos-sold-modal').classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
}

function setPosDayOptions(year, month, day) {
  let daySelect = byId('pos-filter-day');
  let totalDays = new Date(year, month, 0).getDate();
  let safeDay = Math.min(day, totalDays);
  daySelect.replaceChildren();
  for (let value = 1; value <= totalDays; value += 1) {
    daySelect.appendChild(new Option(String(value), String(value)));
  }
  daySelect.value = String(safeDay);
}

function syncPosControls(data) {
  let today = clusterState.data.today;
  let years = (data.years || []).slice();
  let baseYear = today.year;
  let baseMonth = today.month;
  let baseDay = today.day;

  if (data.date) {
    let parts = data.date.split('-');
    baseYear = parseInt(parts[0], 10);
    baseMonth = parseInt(parts[1], 10);
    baseDay = parseInt(parts[2], 10);
  }
  [today.year, baseYear].forEach(function (year) {
    if (years.indexOf(year) === -1) years.push(year);
  });
  years.sort(function (a, b) {
    return a - b;
  });

  let yearSelect = byId('pos-filter-year');
  yearSelect.replaceChildren();
  years.forEach(function (year) {
    yearSelect.appendChild(new Option(String(year), String(year)));
  });
  yearSelect.value = String(baseYear);
  byId('pos-filter-month').value = String(baseMonth);
  setPosDayOptions(baseYear, baseMonth, baseDay);
}

function showPosEmpty(message, tone) {
  let empty = byId('pos-sold-empty');
  empty.textContent = message;
  empty.classList.remove('bg-slate-50', 'border-slate-200', 'text-slate-600', 'bg-amber-50', 'border-amber-200', 'text-amber-800');
  if (tone === 'amber') {
    empty.classList.add('bg-amber-50', 'border-amber-200', 'text-amber-800');
  } else {
    empty.classList.add('bg-slate-50', 'border-slate-200', 'text-slate-600');
  }
  empty.classList.remove('hidden');
  byId('pos-sold-table-wrap').classList.add('hidden');
}

function renderPosResults(data) {
  let reports = data.reports || [];
  let caption = byId('pos-sold-caption');

  if (!reports.length) {
    caption.textContent = 'No submitted POS sold data found for selected date';
    showPosEmpty('No submitted POS sold data available for selected date.', 'slate');
    return;
  }

  let label = reports[0].label || data.date;
  let storeCount = new Set(reports.map(function (report) {
    return report.store_id;
  })).size;
  caption.textContent = storeCount > 1 ? 'Showing ' + label + ' across ' + storeCount + ' stores' : 'Showing ' + label;

  let fragment = document.createDocumentFragment();
  reports.forEach(function (report) {
    (report.items || []).forEach(function (item) {
      let row = cloneTemplate('posSoldRowTemplate');
      setCellText(row, 'store', report.store_name);
      setCellText(row, 'product', item.product_name);
      setCellText(row, 'quantity', formatInteger(item.quantity));
      fragment.appendChild(row);
    });
  });

  if (!fragment.childNodes.length) {
    showPosEmpty('No POS sold rows found for ' + label + '.', 'amber');
    return;
  }

  byId('pos-sold-body').replaceChildren(fragment);
  byId('pos-sold-empty').classList.add('hidden');
  byId('pos-sold-table-wrap').classList.remove('hidden');
}

async function loadPosSold(isoDate) {
  let params = new URLSearchParams();
  params.set('cluster_id', String(clusterState.data.cluster.id));
  if (clusterState.data.filters.store_id) params.set('store_id', clusterState.data.filters.store_id);
  if (initialStoreScope) params.set('store_scope', initialStoreScope);
  if (isoDate) params.set('date', isoDate);

  try {
    let response = await fetch(API_POS_SOLD + '?' + params.toString(), {
      headers: {'Accept': 'application/json'},
      credentials: 'same-origin'
    });
    let data = await response.json();
    if (data.type !== 'success') {
      showToastError(data.message || 'Unable to load POS sold data.');
      return;
    }
    posState.initialized = true;
    syncPosControls(data);
    renderPosResults(data);
  } catch (error) {
    showToastError('Failed to load POS sold data.');
  }
}

function applyPosFilter() {
  let year = parseInt(byId('pos-filter-year').value, 10);
  let month = parseInt(byId('pos-filter-month').value, 10);
  let day = parseInt(byId('pos-filter-day').value, 10);
  loadPosSold(year + '-' + pad2(month) + '-' + pad2(day));
}

function handlePosYearMonthChange() {
  let year = parseInt(byId('pos-filter-year').value, 10);
  let month = parseInt(byId('pos-filter-month').value, 10);
  let day = parseInt(byId('pos-filter-day').value, 10);
  setPosDayOptions(year, month, day);
  applyPosFilter();
}

function handlePosLatest() {
  loadPosSold('');
}

/* - Export modal - */
function resetExportSubmit() {
  let submit = byId('exportClusterDataForm').querySelector('button[type="submit"]');
  submit.disabled = false;
  submit.innerHTML = exportSubmitHtml;
}

function openExportModal() {
  resetExportSubmit();
  if (exportModal) exportModal.open();
}

function closeExportModal() {
  if (exportModal) exportModal.close();
  resetExportSubmit();
}

function handleExportSubmit() {
  let submit = byId('exportClusterDataForm').querySelector('button[type="submit"]');
  submit.disabled = true;
  submit.innerHTML = '<svg class="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Downloading...';
  setTimeout(closeExportModal, 1000);
}

/* - Bindings - */
exportSubmitHtml = byId('exportClusterDataForm').querySelector('button[type="submit"]').innerHTML;
if (typeof Modal !== 'undefined') exportModal = new Modal('exportClusterDataModal');

byId('clusterFilterForm').addEventListener('submit', handleFilterSubmit);
document.querySelectorAll('.tab-button').forEach(function (button) {
  button.addEventListener('click', handleTabClick);
});
byId('edit-mode-toggle').addEventListener('click', toggleEditMode);
byId('fullscreen-open-btn').addEventListener('click', toggleFullscreen);
byId('fullscreen-exit').addEventListener('click', toggleFullscreen);
byId('fullscreen-prev').addEventListener('click', handleFullscreenPrev);
byId('fullscreen-next').addEventListener('click', handleFullscreenNext);

byId('open-pos-sold-modal-btn').addEventListener('click', openPosModal);
byId('pos-sold-overlay').addEventListener('click', closePosModal);
byId('pos-sold-close').addEventListener('click', closePosModal);
byId('pos-filter-year').addEventListener('change', handlePosYearMonthChange);
byId('pos-filter-month').addEventListener('change', handlePosYearMonthChange);
byId('pos-filter-day').addEventListener('change', applyPosFilter);
byId('pos-filter-apply').addEventListener('click', applyPosFilter);
byId('pos-filter-latest').addEventListener('click', handlePosLatest);

byId('openExportClusterDataModal').addEventListener('click', openExportModal);
byId('exportClusterDataForm').addEventListener('submit', handleExportSubmit);

window.addEventListener('popstate', handlePopState);

setActiveTab('sales');
loadClusterData(false);
