let PER_PAGE = 50;
let SENTINEL_ID = '987654321';
let SENTINEL_INDEX = '123456789';
let API_FILTERS = '/apis/pos_sold_filters';
let API_CONSOLIDATED = '/apis/pos_sold_consolidated';
let API_REVIEW = '/apis/pos_sold_review';
let URL_KEYS = ['tab', 'apply', 'cluster_id', 'store_id', 'start_date', 'end_date', 'page', 'review_store_id', 'review_date'];

let state = {
  tab: 'consolidated',
  canEdit: false,
  clusters: [],
  stores: [],
  defaultStartDate: '',
  today: '',
  page: 1,
  filtersReady: false,
  consolidatedLoaded: false,
  review: { loaded: false, storeId: '', date: '', rows: [], isStaged: false, stagingId: null, reportId: null },
  pendingRow: null
};

let editModal = null;
let deleteModal = null;
let deleteAllModal = null;
let exportModal = null;
let exportButtonHtml = '';

// - Helpers -

function byId(id) {
  return document.getElementById(id);
}

function setCell(node, name, text) {
  let el = node.querySelector('[data-cell="' + name + '"]');
  if (el) {
    el.textContent = text;
  }
  return el;
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildBody(params) {
  let body = new URLSearchParams();
  Object.keys(params).forEach(function(key) {
    body.append(key, params[key]);
  });
  return body;
}

function fetchJson(url, params) {
  return fetch(url, { method: 'POST', body: buildBody(params), credentials: 'same-origin' })
    .then(function(response) { return response.json(); });
}

function postLegacy(url, params) {
  return fetch(url, { method: 'POST', body: buildBody(params), credentials: 'same-origin', redirect: 'manual' });
}

function setBusy(button, busy) {
  if (button) {
    button.disabled = busy;
  }
}

// - URL sync -

function syncUrl(extra) {
  let params = new URLSearchParams(window.location.search);
  URL_KEYS.forEach(function(key) { params.delete(key); });
  Object.keys(extra).forEach(function(key) {
    if (extra[key] !== '' && extra[key] !== null && extra[key] !== undefined) {
      params.set(key, extra[key]);
    }
  });
  history.pushState({}, '', '?' + params.toString());
}

function syncCurrentUrl() {
  let extra = { tab: state.tab };
  if (state.tab === 'consolidated' && state.consolidatedLoaded) {
    extra.apply = '1';
    extra.cluster_id = byId('cluster_id').value;
    extra.store_id = byId('store_id').value;
    extra.start_date = byId('consolidated_start_date').value;
    extra.end_date = byId('consolidated_end_date').value;
    extra.page = state.page;
  }
  if (state.tab === 'review' && state.review.loaded) {
    extra.review_store_id = state.review.storeId;
    extra.review_date = state.review.date;
  }
  syncUrl(extra);
}

// - Tabs -

function setTab(tab) {
  state.tab = tab;
  byId('panel-consolidated').classList.toggle('hidden', tab !== 'consolidated');
  byId('panel-review').classList.toggle('hidden', tab !== 'review');
  document.querySelectorAll('.tab-btn').forEach(function(button) {
    let active = button.dataset.tab === tab;
    UI_CLASSES.tabActive.split(' ').forEach(function(name) { button.classList.toggle(name, active); });
    UI_CLASSES.tabInactive.split(' ').forEach(function(name) { button.classList.toggle(name, !active); });
  });
}

function onTabClick(event) {
  let button = event.target.closest('.tab-btn');
  if (!button) {
    return;
  }
  setTab(button.dataset.tab);
  syncCurrentUrl();
}

// - Filters -

function fillClusterSelect(select, placeholder, selectedId) {
  select.innerHTML = '';
  if (placeholder) {
    let blank = document.createElement('option');
    blank.value = '';
    blank.text = placeholder;
    select.appendChild(blank);
  }
  state.clusters.forEach(function(cluster) {
    let option = document.createElement('option');
    option.value = String(cluster.id);
    option.text = cluster.name;
    if (selectedId && String(cluster.id) === String(selectedId)) {
      option.selected = true;
    }
    select.appendChild(option);
  });
}

function populateStoreSelect(clusterId, selectedId) {
  let select = byId('store_id');
  select.innerHTML = '';
  let blank = document.createElement('option');
  blank.value = '';
  if (!clusterId) {
    blank.text = 'Select Cluster First';
    select.appendChild(blank);
    select.disabled = true;
    return;
  }
  blank.text = 'Select Store (Optional)';
  select.appendChild(blank);
  select.disabled = false;
  state.stores
    .filter(function(store) { return Number(store.cluster_id) === Number(clusterId); })
    .sort(function(a, b) { return String(a.name || '').localeCompare(String(b.name || '')); })
    .forEach(function(store) {
      let option = document.createElement('option');
      option.value = String(store.id);
      option.text = store.name || ('Store ' + store.id);
      if (selectedId && String(store.id) === String(selectedId)) {
        option.selected = true;
      }
      select.appendChild(option);
    });
}

function populateReviewStores() {
  let select = byId('review_store_id');
  select.innerHTML = '';
  let blank = document.createElement('option');
  blank.value = '';
  blank.text = 'Select Store';
  select.appendChild(blank);
  state.stores.forEach(function(store) {
    let option = document.createElement('option');
    option.value = String(store.id);
    option.text = store.name || ('Store ' + store.id);
    select.appendChild(option);
  });
}

function loadFilters() {
  fetchJson(API_FILTERS, {})
    .then(onFiltersLoaded)
    .catch(function() { toast.error('Failed to load filters.'); });
}

function onFiltersLoaded(data) {
  if (data.type !== 'success') {
    toast.error(data.message || 'Failed to load filters.');
    return;
  }
  state.clusters = data.clusters || [];
  state.stores = data.stores || [];
  state.canEdit = !!data.can_edit;
  state.defaultStartDate = data.default_start_date || '';
  state.today = data.today || '';
  state.filtersReady = true;
  fillClusterSelect(byId('cluster_id'), 'Select Cluster', '');
  populateReviewStores();
  if (data.warning) {
    toast.warn(data.warning);
  }
  restoreFromUrl();
}

function onClusterChange() {
  populateStoreSelect(byId('cluster_id').value, '');
}

function restoreFromUrl() {
  let params = new URLSearchParams(window.location.search);
  let tab = params.get('tab') === 'review' ? 'review' : 'consolidated';
  let clusterId = params.get('cluster_id') || '';
  byId('cluster_id').value = clusterId;
  if (byId('cluster_id').value !== clusterId) {
    clusterId = '';
  }
  populateStoreSelect(clusterId, params.get('store_id') || '');
  byId('consolidated_start_date').value = params.get('start_date') || state.defaultStartDate;
  byId('consolidated_end_date').value = params.get('end_date') || '';
  byId('review_store_id').value = params.get('review_store_id') || '';
  byId('review_date').value = params.get('review_date') || state.today;
  state.page = Number(params.get('page')) || 1;
  setTab(tab);
  if (tab === 'consolidated' && params.get('apply') === '1' && clusterId) {
    loadConsolidated(false);
  } else if (tab === 'consolidated') {
    showConsolidatedInitial();
  }
  if (tab === 'review' && params.get('review_store_id')) {
    loadReview(false);
  }
}

function onPopState() {
  if (state.filtersReady) {
    restoreFromUrl();
  }
}

// - Consolidated -

function showConsolidatedInitial() {
  state.consolidatedLoaded = false;
  byId('consolidated-initial').classList.remove('hidden');
  byId('consolidated-results').classList.add('hidden');
  byId('openExportPosSoldModal').classList.add('hidden');
  byId('consolidated-warning').classList.add('hidden');
}

function setApplyBusy(busy) {
  setBusy(byId('apply-btn'), busy);
}

function onConsolidatedSubmit(event) {
  event.preventDefault();
  state.page = 1;
  loadConsolidated(true);
}

function loadConsolidated(push) {
  let clusterId = byId('cluster_id').value;
  let storeId = byId('store_id').value;
  let startDate = byId('consolidated_start_date').value;
  let endDate = byId('consolidated_end_date').value;
  if (!clusterId) {
    toast.warn('Please select a cluster first.');
    return;
  }
  if (!startDate || !endDate) {
    toast.warn('Please select valid start and end dates.');
    return;
  }
  let params = { cluster_id: clusterId, start_date: startDate, end_date: endDate, page: state.page };
  if (storeId) {
    params.store_id = storeId;
  }
  setApplyBusy(true);
  fetchJson(API_CONSOLIDATED, params)
    .then(function(data) { onConsolidatedSuccess(data, push); })
    .catch(onConsolidatedError);
}

function onConsolidatedSuccess(data, push) {
  setApplyBusy(false);
  if (data.type !== 'success') {
    toast.error(data.message || 'Failed to load POS sold data.');
    showConsolidatedInitial();
    return;
  }
  byId('consolidated_start_date').value = data.start_date;
  byId('consolidated_end_date').value = data.end_date;
  state.page = data.current_page;

  let warning = byId('consolidated-warning');
  if (data.warning) {
    warning.textContent = data.warning;
    warning.classList.remove('hidden');
    byId('store_id').value = '';
  } else {
    warning.classList.add('hidden');
  }

  state.consolidatedLoaded = true;
  byId('consolidated-initial').classList.add('hidden');
  byId('consolidated-results').classList.remove('hidden');
  byId('openExportPosSoldModal').classList.remove('hidden');

  renderSummary(data.summary);
  renderCategories(data.category_metrics || []);
  renderConsolidatedRows(data.data || []);
  renderPagination(data);

  if (push) {
    syncCurrentUrl();
  }
}

function onConsolidatedError() {
  setApplyBusy(false);
  toast.error('Failed to load POS sold data.');
}

function renderSummary(summary) {
  byId('sum-rows').textContent = summary.rows_count;
  byId('sum-stores').textContent = summary.stores_count;
  byId('sum-qty').textContent = summary.total_qty;
  byId('sum-net').textContent = formatMoney(summary.total_net_sales);
  byId('sum-gross-discount').textContent = 'Gross: ' + formatMoney(summary.total_gross_sales) + ' | Discount: ' + formatMoney(summary.total_discount);
}

function renderCategories(metrics) {
  let grid = byId('category-grid');
  let template = byId('tmpl-category-card');
  grid.innerHTML = '';
  byId('category-section').classList.toggle('hidden', metrics.length === 0);
  metrics.forEach(function(metric) {
    let node = template.content.firstElementChild.cloneNode(true);
    setCell(node, 'short', metric.short);
    setCell(node, 'category', metric.category);
    setCell(node, 'quantity', metric.quantity);
    node.querySelector('[data-cell="title"]').title = metric.short + ' ' + metric.category;
    grid.appendChild(node);
  });
}

function renderConsolidatedRows(rows) {
  let body = byId('consolidated-body');
  let template = byId('tmpl-pos-row');
  body.innerHTML = '';
  byId('consolidated-empty').classList.toggle('hidden', rows.length > 0);
  rows.forEach(function(row) {
    let node = template.content.firstElementChild.cloneNode(true);
    setCell(node, 'product', row.product_name);
    setCell(node, 'category', row.category || 'Uncategorized');
    setCell(node, 'quantity', row.quantity);
    setCell(node, 'gross', formatMoney(row.gross_sales));
    setCell(node, 'discount', formatMoney(row.discount));
    setCell(node, 'net', formatMoney(row.net_sales));
    node.querySelector(row.in_masterlist ? '[data-cell="not-in-masterlist"]' : '[data-cell="in-masterlist"]').remove();
    body.appendChild(node);
  });
}

function makePageButton(label, page) {
  let button = document.createElement('button');
  button.type = 'button';
  button.dataset.page = String(page);
  button.className = UI_CLASSES.pageButton;
  button.textContent = label;
  return button;
}

function renderPagination(data) {
  let container = byId('consolidated-pagination');
  let page = data.current_page;
  let totalPages = data.total_pages;
  let total = data.total_results;
  if (totalPages <= 1) {
    container.classList.add('hidden');
    return;
  }
  container.classList.remove('hidden');
  let start = ((page - 1) * PER_PAGE) + 1;
  let end = Math.min(page * PER_PAGE, total);
  byId('pagination-info').textContent = 'Showing ' + start + '\u2013' + end + ' of ' + total + ' results';

  let holder = byId('pagination-buttons');
  holder.innerHTML = '';
  if (page > 1) {
    holder.appendChild(makePageButton('\u00ab Prev', page - 1));
  }
  for (let p = 1; p <= totalPages; p++) {
    if (p === page) {
      let current = document.createElement('span');
      current.className = UI_CLASSES.pageCurrent;
      current.textContent = String(p);
      holder.appendChild(current);
    } else if (p <= 3 || p > totalPages - 3 || (p >= page - 1 && p <= page + 1)) {
      holder.appendChild(makePageButton(String(p), p));
    } else if (p === 4 || p === totalPages - 3) {
      let gap = document.createElement('span');
      gap.className = UI_CLASSES.pageGap;
      gap.textContent = '\u2026';
      holder.appendChild(gap);
    }
  }
  if (page < totalPages) {
    holder.appendChild(makePageButton('Next \u00bb', page + 1));
  }
}

function onPaginationClick(event) {
  let button = event.target.closest('[data-page]');
  if (!button) {
    return;
  }
  state.page = Number(button.dataset.page);
  loadConsolidated(true);
}

function onConsolidatedReset() {
  byId('cluster_id').value = '';
  populateStoreSelect('', '');
  byId('consolidated_start_date').value = state.defaultStartDate;
  byId('consolidated_end_date').value = '';
  state.page = 1;
  showConsolidatedInitial();
  syncCurrentUrl();
}

// - Export -

function currentExportOption() {
  let checked = document.querySelector('#exportPosSoldModal input[name="export_option"]:checked');
  return checked ? checked.value : 'cluster_range';
}

function applyExportOption(optionValue) {
  let parts = (optionValue || 'cluster_range').split('_');
  let scope = parts[0] === 'all' ? 'all' : 'cluster';
  let type = parts[1] === 'all' ? 'all' : 'range';
  byId('export_scope').value = scope;
  byId('export_type').value = type;
  byId('posSoldRangeFields').classList.toggle('hidden', type !== 'range');
  byId('posSoldExportClusterField').classList.toggle('hidden', scope !== 'cluster');
  byId('export_pos_cluster_id').required = scope === 'cluster';
  if (scope !== 'cluster') {
    byId('export_store_id').value = '';
  }
}

function onExportOptionChange(event) {
  applyExportOption(event.target.value);
}

function onExportClusterChange() {
  byId('export_store_id').value = '';
}

function resetExportButton() {
  let button = byId('export-submit');
  button.disabled = false;
  button.innerHTML = exportButtonHtml;
}

function openExportModal() {
  let select = byId('export_pos_cluster_id');
  let selectedCluster = byId('cluster_id').value;
  if (state.clusters.length === 0) {
    select.innerHTML = '<option value="">No Clusters Available</option>';
  } else {
    fillClusterSelect(select, selectedCluster ? '' : 'Select a Cluster', selectedCluster);
  }
  byId('export_pos_start_date').value = byId('consolidated_start_date').value;
  byId('export_pos_end_date').value = byId('consolidated_end_date').value;
  byId('export_store_id').value = byId('store_id').value;
  resetExportButton();
  applyExportOption(currentExportOption());
  exportModal.open();
}

function closeExportModal() {
  exportModal.close();
  resetExportButton();
}

function onExportSubmit() {
  applyExportOption(currentExportOption());
  let button = byId('export-submit');
  button.disabled = true;
  button.innerHTML = SPINNER_HTML + 'Downloading...';
  setTimeout(closeExportModal, 1000);
}

// - Review -

function requestReview(storeId, date) {
  return fetchJson(API_REVIEW, { review_store_id: storeId, review_date: date });
}

function onReviewSubmit(event) {
  event.preventDefault();
  loadReview(true);
}

function loadReview(push) {
  let storeId = byId('review_store_id').value;
  let date = byId('review_date').value;
  if (!storeId) {
    toast.warn('Please select a store first.');
    return;
  }
  setBusy(byId('review-submit'), true);
  requestReview(storeId, date)
    .then(function(data) { onReviewLoaded(data, storeId, push); })
    .catch(onReviewError);
}

function onReviewLoaded(data, storeId, push) {
  setBusy(byId('review-submit'), false);
  if (data.type !== 'success') {
    toast.error(data.message || 'Failed to load review.');
    byId('review-results').classList.add('hidden');
    return;
  }
  state.review.storeId = storeId;
  state.review.loaded = true;
  renderReview(data);
  if (push) {
    syncCurrentUrl();
  }
}

function onReviewError() {
  setBusy(byId('review-submit'), false);
  toast.error('Failed to load review.');
}

function renderReview(data) {
  state.canEdit = !!data.can_edit;
  state.review.date = data.review_date;
  state.review.rows = data.data || [];
  state.review.isStaged = !!data.is_staged;
  state.review.stagingId = data.staging_id;
  state.review.reportId = data.report_id;
  byId('review_date').value = data.review_date;
  byId('review-results').classList.remove('hidden');

  let summary = data.summary;
  byId('rev-rows').textContent = summary.rows_count;
  byId('rev-qty').textContent = summary.total_qty;
  byId('rev-gross').textContent = formatMoney(summary.total_gross_sales);
  byId('rev-discount').textContent = formatMoney(summary.total_discount);
  byId('rev-net').textContent = formatMoney(summary.total_net_sales);

  let meta = byId('review-meta');
  if (data.is_staged) {
    meta.textContent = data.review_date;
  } else if (data.report_id) {
    meta.textContent = 'Report #' + data.report_id + ' \u00b7 ' + data.review_date;
  } else {
    meta.textContent = 'No daily report found for the selected store/date.';
  }
  byId('review-staged-badge').classList.toggle('hidden', !data.is_staged);
  byId('openDeleteAllPosSoldModal').classList.toggle('hidden', !(state.canEdit && state.review.rows.length > 0));
  byId('review-actions-th').classList.toggle('hidden', !state.canEdit);
  renderReviewRows();
}

function renderReviewRows() {
  let body = byId('review-body');
  let template = byId('tmpl-review-row');
  body.innerHTML = '';
  byId('review-empty').classList.toggle('hidden', state.review.rows.length > 0);
  state.review.rows.forEach(function(row, index) {
    let node = template.content.firstElementChild.cloneNode(true);
    setCell(node, 'product', row.product_name);
    setCell(node, 'quantity', row.quantity);
    setCell(node, 'gross', formatMoney(row.gross_sales));
    setCell(node, 'discount', formatMoney(row.discount));
    setCell(node, 'net', formatMoney(row.net_sales));
    if (state.canEdit) {
      node.querySelectorAll('[data-action]').forEach(function(button) { button.dataset.index = String(index); });
    } else {
      node.querySelector('[data-cell="actions"]').remove();
    }
    body.appendChild(node);
  });
}

function onReviewReset() {
  byId('review_store_id').value = '';
  byId('review_date').value = state.today;
  state.review.loaded = false;
  byId('review-results').classList.add('hidden');
  syncCurrentUrl();
}

function onReviewBodyClick(event) {
  let button = event.target.closest('[data-action]');
  if (!button) {
    return;
  }
  let row = state.review.rows[Number(button.dataset.index)];
  if (!row) {
    return;
  }
  if (button.dataset.action === 'edit') {
    openEditModal(row);
  } else {
    openDeleteModal(row);
  }
}

// - Row actions -

function buildRowUrl(row, kind) {
  if (state.review.isStaged) {
    let stagedTemplate = kind === 'edit' ? POS_SOLD_ROUTES.editStaged : POS_SOLD_ROUTES.removeStaged;
    return stagedTemplate.replace(SENTINEL_ID, state.review.stagingId).replace(SENTINEL_INDEX, row.staged_index);
  }
  let template = kind === 'edit' ? POS_SOLD_ROUTES.edit : POS_SOLD_ROUTES.remove;
  return template.replace(SENTINEL_ID, row.id);
}

function buildDeleteAllUrl() {
  if (state.review.isStaged) {
    return POS_SOLD_ROUTES.removeAllStaged.replace(SENTINEL_ID, state.review.stagingId);
  }
  return POS_SOLD_ROUTES.removeAll;
}

function baseActionParams() {
  return { review_store_id: state.review.storeId, review_date: state.review.date };
}

function runLegacyAction(config) {
  let before = state.review.rows.length;
  setBusy(config.button, true);
  postLegacy(config.url, config.params)
    .then(function() { return requestReview(state.review.storeId, state.review.date); })
    .then(function(data) {
      setBusy(config.button, false);
      if (data.type !== 'success') {
        toast.error(data.message || 'Failed to refresh review.');
        return;
      }
      renderReview(data);
      if (config.check(data, before)) {
        config.modal.close();
        toast.success(config.successMessage);
      } else {
        toast.error(config.failMessage);
      }
    })
    .catch(function() {
      setBusy(config.button, false);
      toast.error('Request failed. Please try again.');
    });
}

function rowQuantityMatches(data, row, quantity) {
  let found = (data.data || []).find(function(item) {
    if (data.is_staged) {
      return item.staged_index === row.staged_index;
    }
    return item.id === row.id;
  });
  return !!found && Number(found.quantity) === Number(quantity);
}

function openEditModal(row) {
  state.pendingRow = row;
  byId('editPosSoldProductName').textContent = row.product_name || 'This item';
  byId('edit_pos_sold_quantity').value = row.quantity;
  editModal.open();
  setTimeout(function() { byId('edit_pos_sold_quantity').focus(); }, 50);
}

function onEditSubmit(event) {
  event.preventDefault();
  let row = state.pendingRow;
  let quantity = byId('edit_pos_sold_quantity').value;
  if (!row || quantity === '' || Number(quantity) < 0) {
    toast.warn('Please enter a valid quantity.');
    return;
  }
  let params = baseActionParams();
  params.quantity = quantity;
  runLegacyAction({
    url: buildRowUrl(row, 'edit'),
    params: params,
    button: byId('editPosSoldBtn'),
    modal: editModal,
    check: function(data) { return rowQuantityMatches(data, row, quantity); },
    successMessage: 'Quantity updated.',
    failMessage: 'Quantity was not updated. Please try again.'
  });
}

function openDeleteModal(row) {
  state.pendingRow = row;
  byId('deletePosSoldProductName').textContent = row.product_name || 'This item';
  byId('deletePosSoldQty').textContent = row.quantity;
  byId('deletePosSoldNet').textContent = formatMoney(row.net_sales);
  byId('delete_row_admin_password').value = '';
  deleteModal.open();
  setTimeout(function() { byId('delete_row_admin_password').focus(); }, 50);
}

function onDeleteSubmit(event) {
  event.preventDefault();
  let row = state.pendingRow;
  let password = byId('delete_row_admin_password').value;
  if (!row || !password) {
    toast.warn('Please enter your admin password.');
    return;
  }
  let params = baseActionParams();
  params.admin_password = password;
  runLegacyAction({
    url: buildRowUrl(row, 'delete'),
    params: params,
    button: byId('deletePosSoldBtn'),
    modal: deleteModal,
    check: function(data, before) { return data.summary.rows_count < before; },
    successMessage: 'POS Sold entry deleted.',
    failMessage: 'Entry was not deleted. Please check your admin password.'
  });
  byId('delete_row_admin_password').value = '';
}

function openDeleteAllModal() {
  byId('deleteAllPosSoldCount').textContent = state.review.rows.length;
  byId('delete_all_admin_password').value = '';
  deleteAllModal.open();
  setTimeout(function() { byId('delete_all_admin_password').focus(); }, 50);
}

function onDeleteAllSubmit(event) {
  event.preventDefault();
  let password = byId('delete_all_admin_password').value;
  if (!password) {
    toast.warn('Please enter your admin password.');
    return;
  }
  let params = baseActionParams();
  params.admin_password = password;
  runLegacyAction({
    url: buildDeleteAllUrl(),
    params: params,
    button: byId('deleteAllPosSoldBtn'),
    modal: deleteAllModal,
    check: function(data) { return data.summary.rows_count === 0; },
    successMessage: 'All POS Sold entries deleted.',
    failMessage: 'Entries were not deleted. Please check your admin password.'
  });
  byId('delete_all_admin_password').value = '';
}

// - Init -

function initPage() {
  editModal = new Modal('editPosSoldModal');
  deleteModal = new Modal('deletePosSoldModal');
  deleteAllModal = new Modal('deleteAllPosSoldModal');
  exportModal = new Modal('exportPosSoldModal');
  exportButtonHtml = byId('export-submit').innerHTML;
  byId('exportPosSoldForm').action = POS_SOLD_ROUTES.exportExcel;
  loadFilters();
}

// - Event listeners -

document.querySelector('.tab-btn').parentElement.addEventListener('click', onTabClick);
byId('cluster_id').addEventListener('change', onClusterChange);
byId('consolidated-form').addEventListener('submit', onConsolidatedSubmit);
byId('reset-consolidated-btn').addEventListener('click', onConsolidatedReset);
byId('pagination-buttons').addEventListener('click', onPaginationClick);
byId('openExportPosSoldModal').addEventListener('click', openExportModal);
byId('exportPosSoldForm').addEventListener('submit', onExportSubmit);
byId('export_pos_cluster_id').addEventListener('change', onExportClusterChange);
document.querySelectorAll('#exportPosSoldModal input[name="export_option"]').forEach(function(radio) {
  radio.addEventListener('change', onExportOptionChange);
});
byId('review-form').addEventListener('submit', onReviewSubmit);
byId('reset-review-btn').addEventListener('click', onReviewReset);
byId('review-body').addEventListener('click', onReviewBodyClick);
byId('openDeleteAllPosSoldModal').addEventListener('click', openDeleteAllModal);
byId('editPosSoldForm').addEventListener('submit', onEditSubmit);
byId('deletePosSoldForm').addEventListener('submit', onDeleteSubmit);
byId('deleteAllPosSoldForm').addEventListener('submit', onDeleteAllSubmit);
window.addEventListener('popstate', onPopState);

initPage();
