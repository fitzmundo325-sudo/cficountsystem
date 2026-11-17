let PAGE_SIZE = 20;
let DEFAULT_SORT = 'transaction_date';
let SEARCH_DELAY = 500;

let headerDate = document.getElementById('dateInput');
let refreshBtn = document.getElementById('refresh-btn');
let tafForm = document.getElementById('taf-filter-form');
let searchInput = document.getElementById('taf-search');
let typeSelect = document.getElementById('taf-type-filter');
let statusSelect = document.getElementById('taf-status-filter');
let storeSelect = document.getElementById('taf-store-filter');
let applyBtn = document.getElementById('apply-btn');
let resetBtn = document.getElementById('reset-btn');
let matchingInfo = document.getElementById('matching-info');
let tafHead = document.getElementById('taf-head');
let tafBody = document.getElementById('taf-body');
let tafEmpty = document.getElementById('taf-empty');
let emptyMessage = document.getElementById('empty-message');
let actionsTh = document.getElementById('actions-th');
let rowTemplate = document.getElementById('tmpl-taf-row');
let paginationBar = document.getElementById('taf-pagination');
let paginationInfo = document.getElementById('pagination-info');
let paginationButtons = document.getElementById('pagination-buttons');

let currentPage = 1;
let currentSort = DEFAULT_SORT;
let currentOrder = 'desc';
let canManage = false;
let pendingDeleteId = null;
let skipNextPush = false;
let searchTimer = null;

// - helpers -

function readJson(res) {
  return res.json();
}

function parseResponse(datas) {
  try {
    return JSON.parse(datas.responseText);
  } catch (err) {
    return null;
  }
}

function setCell(node, name, text) {
  node.querySelector('[data-cell="' + name + '"]').textContent = text;
}

function hasActiveFilters() {
  return !!(searchInput.value.trim() || typeSelect.value || statusSelect.value || storeSelect.value);
}

function hasParamValue(param) {
  return param.value !== '' && param.value !== null && param.value !== undefined;
}

// - loading -

function setLoading(state) {
  applyBtn.disabled = state;
  applyBtn.innerHTML = state ? SPINNER_HTML + 'Search' : 'Search';
}

function buildParams() {
  let candidates = [
    { name: 'type', value: typeSelect.value },
    { name: 'status', value: statusSelect.value },
    { name: 'store_id', value: storeSelect.value },
    { name: 'rows', value: PAGE_SIZE }
  ];
  return candidates.filter(hasParamValue);
}

function loadTransfers() {
  qBuilder.server_address = '/apis/taf_transfers';
  qBuilder.search = searchInput.value.trim();
  qBuilder.page = currentPage;
  qBuilder.sort = currentSort;
  qBuilder.order_by = currentOrder;
  setLoading(true);
  qBuilder.sendQuery(onTransfersLoaded, undefined, buildParams(), onTransfersError);
}

function onTransfersLoaded(datas) {
  setLoading(false);
  let data = parseResponse(datas);
  if (!data || data.type !== 'success') {
    toast.error((data && data.message) || 'Failed to load Transaction Activity Forms.');
    return;
  }
  currentPage = data.current_page;
  canManage = !!data.can_manage;
  actionsTh.classList.toggle('hidden', !canManage);
  renderRows(data.data);
  renderPagination(data);
  updateSortIcons();
  matchingInfo.textContent = 'Showing ' + data.total_results + ' matching record' + (data.total_results === 1 ? '' : 's') + ' across all pages.';
  syncUrl();
}

function onTransfersError() {
  setLoading(false);
  toast.error('An error occurred while loading Transaction Activity Forms.');
}

// - rendering -

function renderRows(rows) {
  tafBody.innerHTML = '';
  if (!rows || !rows.length) {
    emptyMessage.textContent = hasActiveFilters()
      ? 'No TAF records match the selected filters.'
      : 'No transaction activity forms have been submitted yet.';
    tafEmpty.classList.remove('hidden');
    return;
  }
  tafEmpty.classList.add('hidden');
  for (let i = 0; i < rows.length; i++) {
    appendRow(rows[i]);
  }
}

function appendRow(row) {
  let node = rowTemplate.content.cloneNode(true);

  setCell(node, 'date', row.date_label);
  setCell(node, 'control_no', row.control_no);
  setCell(node, 'from', row.transfer_from);
  setCell(node, 'to', row.transfer_to);
  setCell(node, 'items', row.items_count);
  setCell(node, 'total', '₱' + Number(row.grand_total || 0).toFixed(2));
  setCell(node, 'store', row.store_name);

  let typeBadge = node.querySelector('[data-cell="type"]');
  typeBadge.textContent = row.transaction_type;
  typeBadge.className = UI_CLASSES.typeBase + ' ' + (UI_CLASSES.typeMap[row.transaction_type] || UI_CLASSES.badgeDefault);

  let statusBadge = node.querySelector('[data-cell="status"]');
  statusBadge.textContent = row.status;
  statusBadge.className = UI_CLASSES.statusBase + ' ' + (UI_CLASSES.statusMap[row.status] || UI_CLASSES.badgeDefault);

  let actionsCell = node.querySelector('[data-cell="actions"]');
  if (canManage) {
    let editLink = node.querySelector('[data-action="edit"]');
    editLink.href = TAF_ROUTES.edit.replace('987654321', row.id);
    let deleteBtn = node.querySelector('[data-action="delete"]');
    deleteBtn.dataset.id = row.id;
    deleteBtn.dataset.control = row.control_no;
  } else {
    actionsCell.remove();
  }

  tafBody.appendChild(node);
}

function buildPageList(current, total) {
  let pages = [];
  let last = 0;
  for (let n = 1; n <= total; n++) {
    let onEdge = n <= 1 || n > total - 1;
    let nearCurrent = n >= current - 2 && n <= current + 2;
    if (onEdge || nearCurrent) {
      if (last && n - last > 1) {
        pages.push(0);
      }
      pages.push(n);
      last = n;
    }
  }
  return pages;
}

function createPageButton(label, page, isCurrent) {
  let button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.dataset.page = page;
  button.className = isCurrent ? UI_CLASSES.pageCurrent : UI_CLASSES.pageButton;
  return button;
}

function createPageGap() {
  let gap = document.createElement('span');
  gap.textContent = '…';
  gap.className = UI_CLASSES.pageGap;
  return gap;
}

function renderPagination(data) {
  paginationButtons.innerHTML = '';
  if (data.total_pages <= 1) {
    paginationBar.classList.add('hidden');
    return;
  }
  paginationBar.classList.remove('hidden');

  let start = ((data.current_page - 1) * PAGE_SIZE) + 1;
  let end = Math.min(data.current_page * PAGE_SIZE, data.total_results);
  paginationInfo.textContent = 'Showing ' + start + '–' + end + ' of ' + data.total_results;

  if (data.current_page > 1) {
    paginationButtons.appendChild(createPageButton('Previous', data.current_page - 1, false));
  }
  let pages = buildPageList(data.current_page, data.total_pages);
  for (let i = 0; i < pages.length; i++) {
    let n = pages[i];
    if (n === 0) {
      paginationButtons.appendChild(createPageGap());
    } else {
      paginationButtons.appendChild(createPageButton(n, n, n === data.current_page));
    }
  }
  if (data.current_page < data.total_pages) {
    paginationButtons.appendChild(createPageButton('Next', data.current_page + 1, false));
  }
}

// - sorting -

function styleSortHeader(th) {
  let icon = th.querySelector('[data-sort-icon]');
  let active = th.dataset.sort === currentSort;
  th.setAttribute('aria-sort', active ? (currentOrder === 'asc' ? 'ascending' : 'descending') : 'none');
  icon.className = 'ml-1 ' + (active ? UI_CLASSES.sortActive : UI_CLASSES.sortInactive);
  icon.innerHTML = active ? (currentOrder === 'asc' ? '&#9650;' : '&#9660;') : '&#8597;';
}

function updateSortIcons() {
  let headers = tafHead.querySelectorAll('th[data-sort]');
  for (let i = 0; i < headers.length; i++) {
    styleSortHeader(headers[i]);
  }
}

function onSortClick(event) {
  let th = event.target.closest('th[data-sort]');
  if (!th) {
    return;
  }
  let key = th.dataset.sort;
  if (currentSort === key) {
    currentOrder = currentOrder === 'asc' ? 'desc' : 'asc';
  } else {
    currentSort = key;
    currentOrder = key === DEFAULT_SORT ? 'desc' : 'asc';
  }
  currentPage = 1;
  loadTransfers();
}

// - url sync -

function syncUrl() {
  if (skipNextPush) {
    skipNextPush = false;
    return;
  }
  let url = new URL(window.location.href);
  let isDefaultSort = currentSort === DEFAULT_SORT && currentOrder === 'desc';
  let values = {
    q: searchInput.value.trim(),
    type: typeSelect.value,
    status: statusSelect.value,
    store_id: storeSelect.value,
    sort: isDefaultSort ? '' : currentSort,
    order_by: isDefaultSort ? '' : currentOrder,
    page: currentPage > 1 ? currentPage : ''
  };
  let keys = Object.keys(values);
  for (let i = 0; i < keys.length; i++) {
    if (values[keys[i]]) {
      url.searchParams.set(keys[i], values[keys[i]]);
    } else {
      url.searchParams.delete(keys[i]);
    }
  }
  history.pushState({}, '', url.toString());
}

function restoreFromUrl() {
  let params = new URL(window.location.href).searchParams;
  searchInput.value = params.get('q') || '';
  typeSelect.value = params.get('type') || '';
  statusSelect.value = params.get('status') || '';
  storeSelect.value = params.get('store_id') || '';
  currentSort = params.get('sort') || DEFAULT_SORT;
  currentOrder = params.get('order_by') || (currentSort === DEFAULT_SORT ? 'desc' : 'asc');
  currentPage = parseInt(params.get('page'), 10) || 1;
}

function onPopState() {
  restoreFromUrl();
  skipNextPush = true;
  loadTransfers();
}

// - filters -

function appendStoreOption(store) {
  let option = document.createElement('option');
  option.value = store.id;
  option.textContent = store.name;
  storeSelect.appendChild(option);
}

function fillStoreOptions(data) {
  if (data.type !== 'success') {
    toast.error(data.message || 'Failed to load stores.');
    return;
  }
  for (let i = 0; i < data.stores.length; i++) {
    appendStoreOption(data.stores[i]);
  }
}

function onStoreOptionsFailed() {
  toast.error('Failed to load stores.');
}

function loadStoreOptions() {
  return fetch('/apis/taf_transfers_filters')
    .then(readJson)
    .then(fillStoreOptions)
    .catch(onStoreOptionsFailed);
}

function onFormSubmit(event) {
  event.preventDefault();
  window.clearTimeout(searchTimer);
  currentPage = 1;
  loadTransfers();
}

function onSearchInput() {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(onSearchTimeout, SEARCH_DELAY);
}

function onSearchTimeout() {
  currentPage = 1;
  loadTransfers();
}

function onFilterChange() {
  currentPage = 1;
  loadTransfers();
}

function onRefreshClick() {
  currentPage = 1;
  loadTransfers();
}

function onDateKeyPress(event) {
  if (event.key === 'Enter') {
    onRefreshClick();
  }
}

function onResetClick() {
  searchInput.value = '';
  typeSelect.value = '';
  statusSelect.value = '';
  storeSelect.value = '';
  currentSort = DEFAULT_SORT;
  currentOrder = 'desc';
  currentPage = 1;
  loadTransfers();
}

function onPaginationClick(event) {
  let button = event.target.closest('[data-page]');
  if (!button) {
    return;
  }
  currentPage = parseInt(button.dataset.page, 10) || 1;
  loadTransfers();
}

// - delete -

function onBodyClick(event) {
  let button = event.target.closest('[data-action="delete"]');
  if (!button) {
    return;
  }
  askDelete(button.dataset.id, button.dataset.control);
}

function askDelete(id, controlNo) {
  let message = 'Are you sure you want to delete transfer "' + controlNo + '"?\n\nThis will also remove the reflected inventory data from both sender and receiver stores.';
  pendingDeleteId = id;
  if (typeof showConfirmationModal === 'function') {
    showConfirmationModal({
      title: 'Delete Transfer?',
      message: message,
      confirmText: 'Delete',
      cancelText: 'Cancel',
      onConfirm: runPendingDelete
    });
    return;
  }
  if (confirm(message)) {
    runPendingDelete();
  }
}

function runPendingDelete() {
  if (!pendingDeleteId) {
    return;
  }
  let id = pendingDeleteId;
  pendingDeleteId = null;
  fetch(TAF_ROUTES.remove.replace('987654321', id), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    }
  })
    .then(readJson)
    .then(onDeleteResult)
    .catch(onDeleteFailed);
}

function onDeleteResult(data) {
  if (data.success || data.type === 'success') {
    toast.success(data.message || 'Transfer deleted successfully!');
    loadTransfers();
    return;
  }
  toast.error(data.error || data.message || 'Failed to delete transfer');
}

function onDeleteFailed(err) {
  console.error('Error deleting transfer:', err);
  toast.error('Error deleting transfer');
}

// - init -

function initialLoad() {
  restoreFromUrl();
  skipNextPush = true;
  loadTransfers();
}

tafForm.addEventListener('submit', onFormSubmit);
searchInput.addEventListener('input', onSearchInput);
typeSelect.addEventListener('change', onFilterChange);
statusSelect.addEventListener('change', onFilterChange);
storeSelect.addEventListener('change', onFilterChange);
refreshBtn.addEventListener('click', onRefreshClick);
headerDate.addEventListener('keypress', onDateKeyPress);
resetBtn.addEventListener('click', onResetClick);
tafHead.addEventListener('click', onSortClick);
tafBody.addEventListener('click', onBodyClick);
paginationButtons.addEventListener('click', onPaginationClick);
window.addEventListener('popstate', onPopState);

headerDate.value = new Date().toISOString().slice(0, 10);
loadStoreOptions().then(initialLoad);
