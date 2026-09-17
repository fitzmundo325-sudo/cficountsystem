
// ==== v2 render/orchestration layer (new — bridges fetched JSON to the DOM v1 built via Jinja) ====

function computePageState(data) {
  let hiddenColumns = data.global_config_data.hidden_columns || [];
  let editableColumns = data.global_config_data.editable_columns || [];
  let lockedColumns = data.global_config_data.locked_columns || [];
  let canEnterBeginningStock = !!data.allow_beginning_stock_entry;

  let isDayLocked = !!data.inventory.is_finalized;
  let isBeginningLocked = (!!data.inventory.is_beginning_finalized || !!data.store_beginning_baseline_finalized) && !canEnterBeginningStock;
  let hideBeginningStock = hiddenColumns.includes('beginning_qty') && !canEnterBeginningStock;
  let lockBeginningStock = isDayLocked || isBeginningLocked || (
    !canEnterBeginningStock && (!editableColumns.includes('beginning_qty') || lockedColumns.includes('beginning_qty'))
  );

  return Object.assign(data, {
    is_day_locked: isDayLocked,
    is_beginning_locked: isBeginningLocked,
    hide_beginning_stock: hideBeginningStock,
    lock_beginning_stock: lockBeginningStock,
    can_enter_beginning_stock: canEnterBeginningStock
  });
}

function applyVisibilityRules(data) {
  document.querySelectorAll('[data-visible-role], [data-visible-when]').forEach(el => {
    let roleOk = true;
    let whenOk = true;
    if (el.dataset.visibleRole) {
      let roles = el.dataset.visibleRole.split(',');
      roleOk = roles.includes(currentUserRole);
    }
    if (el.dataset.visibleWhen) {
      let condition = el.dataset.visibleWhen;
      let negate = condition.startsWith('not:');
      let key = negate ? condition.slice(4) : condition;
      let value = !!data[key];
      whenOk = negate ? !value : value;
    }
    el.style.display = (roleOk && whenOk) ? '' : 'none';
  });
}

function computeHasAdminUnlock(adminUnlockScope) {
  let scope = adminUnlockScope || {};
  return !!(scope.all) || !!(scope.cells && scope.cells.length > 0);
}

function renderStatusBanners(data) {
  let isAdmin = ['Admin', 'Superadmin'].includes(currentUserRole);
  let isDayLocked = !!data.inventory.is_finalized;
  let hasNoWastage = !!data.has_no_wastage;
  let hasAdminUnlock = computeHasAdminUnlock(data.admin_unlock_scope);

  document.getElementById('noWastageBanner').classList.toggle('hidden', !(isAdmin && hasNoWastage && !isDayLocked));
  document.getElementById('lockedNoWastageBanner').classList.toggle('hidden', !(isDayLocked && isAdmin && hasNoWastage));
  document.getElementById('lockedAdminBanner').classList.toggle('hidden', !(isDayLocked && isAdmin && !hasNoWastage));
  document.getElementById('lockedAdminUnlockBanner').classList.toggle('hidden', !(isDayLocked && !isAdmin && hasAdminUnlock));
  document.getElementById('lockedViewOnlyBanner').classList.toggle('hidden', !(isDayLocked && !isAdmin && !hasAdminUnlock));
}

function renderFirstTimeModal(data) {
  let shouldShow = currentUserRole === 'Store Manager' && (data.is_first_time || initialGuideParam === '1');
  let modal = document.getElementById('first-time-modal');
  if (shouldShow) {
    document.getElementById('firstTimeModalStoreName').textContent = data.store.name;
    modal.classList.remove('hidden');
  } else {
    modal.classList.add('hidden');
  }
}
document.getElementById('first-time-modal').addEventListener('click', function (event) {
  if (event.target === this) this.classList.add('hidden');
});

function renderHeaderStoreInfo(data) {
  document.getElementById('headerStoreName').textContent = data.store.name;
  document.getElementById('pageStoreName').textContent = data.store.name;
  document.getElementById('exportModalStoreName').textContent = data.store.name;
  document.getElementById('invExportModalStoreName').textContent = data.store.name;
  
document.getElementById('exportInvenSyncForm').action = window.INVENSYNC_URLS.storeExcelExportBase.replace('/0', `/${data.store.id}`);
  
  
  document.getElementById('export_single_date').value = data.selected_date;
  document.getElementById('export_end_date').value = data.selected_date;
  document.getElementById('selected_date').value = data.selected_date;

  document.getElementById('invExportCurrentDateLabel').textContent = `Export only the selected date: ${data.selected_date}`;
  let currentDateParams = new URLSearchParams({ type: 'invensync', store_id: data.store.id, date: data.selected_date, scope: 'date' });
  document.getElementById('invExportCurrentDateLink').href = `${window.INVENSYNC_URLS.dataExportBase}?${currentDateParams.toString()}`;
  let monthParams = new URLSearchParams({ type: 'invensync', store_id: data.store.id, date: data.selected_date, scope: 'month' });
  document.getElementById('invExportMonthLink').href = `${window.INVENSYNC_URLS.dataExportBase}?${monthParams.toString()}`;
}

// --- Category filter buttons (rendered from fetched categories; filterInventoryCategory/
// setActiveCategoryButton/applyInventoryFilters below are v1's real functions, unchanged) ---
function renderCategoryFilters(categoryGroups) {
  let container = document.getElementById('inventory-category-guide-target');
  container.querySelectorAll('.category-filter-btn:not([data-category-filter="all"])').forEach(btn => btn.remove());

  categoryGroups.forEach(group => {
    if (!group.products.length) return;
    let button = document.createElement('button');
    button.type = 'button';
    button.className = 'category-filter-btn px-3 py-2 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-semibold hover:bg-slate-100 transition fancy_button';
    button.dataset.categoryFilter = group.id;
    button.textContent = (group.display_name || '').toUpperCase();
    button.setAttribute('onclick', `filterInventoryCategory('${group.id}')`);
    container.appendChild(button);
  });
  
  
  bindFancyButtons();
  
}



function blurProductTable(rowCount) {
  let tbody = document.getElementById('invensyncTableBody');
  tbody.classList.add("blur_element","bluring_element");
}


function unblurProductTable() {
  document.querySelectorAll('.bluring_element').forEach(el => {
    el.classList.remove('blur_element');
  });
}


// --- Table head ---
function isColumnHidden(config, field, canEnterBeginningStock) {
  if (field === 'beginning_qty' && canEnterBeginningStock) return false;
  return (config.hidden_columns || []).includes(field);
}

let INVENSYNC_CONFIG_KEY_MAP = {
  ending_d5_qty: 'd5_qty',
  ending_d4_qty: 'd4_qty',
  ending_d3_qty: 'd3_qty',
  total_ending_qty: 'total_ending_inventory',
  theo_ending_qty: 'theo_qty',
};

function configKeyFor(field) {
  return INVENSYNC_CONFIG_KEY_MAP[field] || field;
}

function isColumnHidden(config, field, canEnterBeginningStock) {
  if (field === 'beginning_qty' && canEnterBeginningStock) return false;
  return (config.hidden_columns || []).includes(configKeyFor(field));
}

function cloneCell(templateId) {
  return document.getElementById(templateId).content.cloneNode(true).querySelector('[data-cell]');
}


function makeFieldTh(field, label, id, extraBorderClass, useSpinner) {
  let th = cloneCell('theadFieldCellTemplate');
  th.dataset.col = field;
  if (useSpinner) {
    th.innerHTML = '<i class="fa fa-spinner fa-spin fa-2x"></i>';
  } else {
    th.textContent = label;
  }
  if (id) th.id = id;
  if (extraBorderClass) th.className = th.className.replace('border-r border-slate-300', extraBorderClass);
  return th;
}


let rowVisibilityObserver = null;

function observeRowVisibility(rootElement, container) {
  if (rowVisibilityObserver) {
    rowVisibilityObserver.disconnect();
  }
  if (!container) return;

  rowVisibilityObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      entry.target.classList.toggle('hide_child_inputs', !entry.isIntersecting);
    });
  }, {
    root: rootElement || null,
    rootMargin: '500px 0px',
    threshold: 0,
  });

  container.querySelectorAll('tr[data-product-id]').forEach(row => {
    rowVisibilityObserver.observe(row);
  });
}


function unobserveRowVisibility() {
  if (rowVisibilityObserver) {
    rowVisibilityObserver.disconnect();
    rowVisibilityObserver = null;
  }
}


function bindFancyButtons() {
  let buttons = document.querySelectorAll('.fancy_button');
  buttons.forEach(button => {
    button.addEventListener('mousedown', function() {
      button.classList.add('fancy_clicked');
    });
    button.addEventListener('mouseup', function() {
      button.classList.remove('fancy_clicked');
    });
    button.addEventListener('mouseleave', function() {
      button.classList.remove('fancy_clicked');
    });
  });
}


function renderTableHead(data) {
  let config = data.global_config_data;
  let thead = document.getElementById('invensyncTableHead');
  thead.innerHTML = '';

  let beforeColumns = [
    ['beginning_qty', 'Beg'], ['delivery_qty', 'Delivery'], ['trans_in_qty', 'Trans-In'],
    ['bo_qty', 'BO'], ['adv_del_qty', 'Booth Sales'], ['trans_out_qty', 'Trans-Out'],
    ['wastage_qty', 'Waste Qty'], ['wastage_amount', 'Waste Amt'], ['csi_qty', 'CSI'],
    ['quantity_sold', 'Sold'],
  ];
  let endingColumns = [
    ['ending_d5_qty', 'D+5', 'header-d5'], ['ending_d4_qty', 'D+4', 'header-d4'], ['ending_d3_qty', 'D+3', 'header-d3'],
  ];
  let afterColumns = [
    ['total_ending_qty', 'Total Ending Inventory'], ['total_peso_srp', 'Total Peso'],
    ['theo_ending_qty', 'Theoretical Ending'], ['variance_qty', 'Variance'],
    ['variance_peso', 'Var Peso'], ['remarks', 'Remarks'],
  ];

  let visibleBefore = beforeColumns.filter(([field]) => !isColumnHidden(config, field, data.can_enter_beginning_stock));
  let visibleEnding = endingColumns.filter(([field]) => !isColumnHidden(config, field, data.can_enter_beginning_stock));
  let visibleAfter = afterColumns.filter(([field]) => !isColumnHidden(config, field, data.can_enter_beginning_stock));
  let totalVisible = visibleBefore.length + visibleEnding.length + visibleAfter.length;
  
  
  let showAdjustCols = (currentUserRole === 'Inventory Staff');

  // --- Row 1: group banners ---
  let row1 = document.createElement('tr');
  let productTh = document.createElement('th');
  productTh.rowSpan = 2;
  productTh.className = 'px-2 py-3 text-center font-semibold bg-sky-100 text-black sticky top-0 left-0 z-50 min-w-[200px] shadow-lg';
  productTh.textContent = 'Product';
  row1.appendChild(productTh);

  let endingBannerTh = document.createElement('th');
  endingBannerTh.colSpan = totalVisible;
  endingBannerTh.className = 'px-2 py-3 text-center font-semibold bg-emerald-100 text-black border-l-2 border-emerald-200 sticky top-0 z-40';
  endingBannerTh.textContent = 'DAILY ENDING INVENTORY';
  row1.appendChild(endingBannerTh);

  if (showAdjustCols) {
    let adjustBannerTh = document.createElement('th');
    adjustBannerTh.colSpan = 4;
    adjustBannerTh.className = 'px-2 py-3 text-center font-semibold bg-violet-100 text-black border-l-2 border-violet-200 sticky top-0 z-40';
    adjustBannerTh.textContent = 'INVENTORY ADJUSTMENTS';
    row1.appendChild(adjustBannerTh);
  }
  thead.appendChild(row1);

  // --- Row 2: before/ending/after sub-banner ---
  let row2 = document.createElement('tr');
  row2.className = 'text-xs';

  if (visibleBefore.length) {
    let cell = cloneCell('theadSpacerCellTemplate');
    cell.colSpan = visibleBefore.length;
    cell.classList.add('border-l-2', 'border-emerald-200');
    row2.appendChild(cell);
  }
  if (visibleEnding.length) {
    let cell = cloneCell('theadEndingBannerCellTemplate');
    cell.colSpan = visibleEnding.length;
    row2.appendChild(cell);
  }
  if (visibleAfter.length) {
    let cell = cloneCell('theadSpacerCellTemplate');
    cell.colSpan = visibleAfter.length;
    cell.classList.add('border-r', 'border-slate-300');
    row2.appendChild(cell);
  }
  if (showAdjustCols) {
    let cell = cloneCell('theadSpacerCellTemplate');
    cell.colSpan = 4;
    cell.classList.add('bg-violet-50', 'border-l-2', 'border-violet-200', 'border-r', 'border-slate-300');
    row2.appendChild(cell);
  }
  thead.appendChild(row2);

  // --- Row 3: field labels ---
  let row3 = document.createElement('tr');
  row3.className = 'text-xs';

  let descTh = document.createElement('th');
  descTh.className = 'px-2 py-2 text-center font-semibold bg-sky-50 text-black sticky top-[42px] left-0 z-50 border-r border-slate-300 shadow-lg';
  descTh.textContent = 'Description | Code - Price';
  row3.appendChild(descTh);

  beforeColumns.forEach(([field, label], i) => {
    let th = makeFieldTh(field, label, null, i === 0 ? 'border-l-2 border-emerald-400 border-r border-slate-300' : null);
    if (isColumnHidden(config, field, data.can_enter_beginning_stock)) th.style.display = 'none';
    row3.appendChild(th);
  });
  endingColumns.forEach(([field, label, id]) => {
    let th = makeFieldTh(field, label, id, null, true);
    if (isColumnHidden(config, field, data.can_enter_beginning_stock)) th.style.display = 'none';
    row3.appendChild(th);
  });
  afterColumns.forEach(([field, label]) => {
    let th = makeFieldTh(field, label);
    if (isColumnHidden(config, field, data.can_enter_beginning_stock)) th.style.display = 'none';
    row3.appendChild(th);
  });

  if (showAdjustCols) {
    let typeTh = cloneCell('theadAdjustCellTemplate');
    typeTh.classList.add('border-l-2', 'border-violet-400');
    typeTh.title = 'Swapping, OFFSET, or Variance';
    typeTh.textContent = 'Adj Type';
    row3.appendChild(typeTh);

    let productAdjTh = cloneCell('theadAdjustCellTemplate');
    productAdjTh.textContent = 'Product';
    row3.appendChild(productAdjTh);

    let qtyTh = cloneCell('theadAdjustCellTemplate');
    qtyTh.textContent = 'Qty';
    row3.appendChild(qtyTh);

    let chargesTh = cloneCell('theadAdjustCellTemplate');
    chargesTh.id = 'header-adjust-charges';
    chargesTh.textContent = 'Charges (Variance)';
    row3.appendChild(chargesTh);
  }
  thead.appendChild(row3);

  thead.dataset.spacerColspan = totalVisible + (showAdjustCols ? 4 : 0);
}

async function renderTableBody(data) {
  let categoryGroups = data.category_groups;
  let config = data.global_config_data;
  let tbody = document.getElementById('invensyncTableBody');
  tbody.innerHTML = '';
  let categoryTemplate = document.getElementById('categoryHeaderRowTemplate');
  let rowTemplate = document.getElementById('productRowTemplate');
  let hiddenColumns = config.hidden_columns || [];
  let editableColumns = config.editable_columns || [];
  let lockedColumns = config.locked_columns || [];
  
  let showAdjustCols = ['Inventory Staff'].includes(currentUserRole);
  
  let showTrace = !!data.show_trans_trace;

  for (let group of categoryGroups) {
    if (!group.products.length) continue;
    await sleep(200);
	unblurProductTable();

    let catNode = categoryTemplate.content.cloneNode(true);
    let catRow = catNode.querySelector('[data-cell="row"]');
    catRow.dataset.category = group.id;
    catNode.querySelector('[data-cell="spacer"]').setAttribute('colspan', document.getElementById('invensyncTableHead').dataset.spacerColspan || '18');

    catNode.querySelector('[data-cell="name"]').textContent = group.display_name;
    catNode.querySelector('[data-cell="count"]').textContent = `${group.products.length} items`;
    tbody.appendChild(catNode);

    group.products.forEach(row => {
      let product = row;
      let item = row.inventory_item;
      let rowNode = rowTemplate.content.cloneNode(true);
      let tr = rowNode.querySelector('[data-cell="row"]');
      tr.dataset.productId = product.id;
      tr.dataset.productName = product.description;
      tr.dataset.category = product.category;
      tr.dataset.categoryId = group.id;
      tr.dataset.searchText = `${product.description} ${product.code} ${(item ? item.srp_price : product.tp)}`.toLowerCase();

      rowNode.querySelector('[data-cell="description"]').textContent = product.description || 'No Description';
      let priceLabel = item && item.srp_price ? `Php ${(item.srp_price)}` : (product.tp ? `Php ${(product.tp)}` : '');
      rowNode.querySelector('[data-cell="code-price"]').textContent = `${product.code || '-'}${priceLabel ? ' - ' + priceLabel : ''}`;

      let setInputCell = (field) => {
        let cellTd = rowNode.querySelector(`[data-field="${field}"]`);
        if (!cellTd) return;
        if (isColumnHidden(config, field, data.can_enter_beginning_stock)) {
          cellTd.style.display = 'none';
          return;
        }
        let input = cellTd.querySelector('input');
        if (!input) return;
		
        input.value = (item && item[field]) ? item[field] : '';
		
        let isLocked = field === 'beginning_qty'
          ? data.lock_beginning_stock
          : (!editableColumns.includes(field) || lockedColumns.includes(field) || data.is_day_locked);
        input.readOnly = isLocked;
        if (isLocked) input.classList.add('cursor-not-allowed', 'opacity-75');
      };

      ['beginning_qty', 'delivery_qty', 'trans_in_qty', 'bo_qty', 'adv_del_qty', 'trans_out_qty',
        'wastage_qty', 'csi_qty', 'quantity_sold', 'ending_d5_qty', 'ending_d4_qty',
        'ending_d3_qty', 'remarks'].forEach(setInputCell);

      let setDisplayCell = (field, formatter) => {
        let cellTd = rowNode.querySelector(`[data-field="${field}"]`);
        if (!cellTd) return;
        if (isColumnHidden(config, field, data.can_enter_beginning_stock)) {
          cellTd.style.display = 'none';
          return;
        }
        cellTd.textContent = formatter(item);
      };

      setDisplayCell('wastage_amount', i => (i ? i.wastage_amount : 0));
      setDisplayCell('total_ending_qty', i => i ? i.total_ending_qty : 0);
      setDisplayCell('total_peso_srp', i => (i ? i.total_peso_srp : 0));
      setDisplayCell('theo_ending_qty', i => i ? i.theo_ending_qty : 0);
      setDisplayCell('variance_qty', i => i ? i.variance_qty : 0);
      setDisplayCell('variance_peso', i => (i ? i.variance_peso : 0));

      if (showAdjustCols) {
        rowNode.querySelector('[data-cell="adjustment_type"]').value = (item && item.adjustment_type) || '';
        rowNode.querySelector('[data-cell="adjustment_product_input"]').value = '';
        rowNode.querySelector('[data-cell="adjustment_product_id"]').value = (item && item.adjustment_product_master_id) || '';
        rowNode.querySelector('[data-cell="adjustment_qty"]').value = (item && item.adjustment_qty) || '';
        rowNode.querySelector('[data-cell="adjustment_charges"]').value = (item && item.adjustment_charges) || '';
        if (item && item.adjustment_product_master_id) {
          let pool = (data.adj_product_options || []);
          let matched = pool.find(p => String(p.id) === String(item.adjustment_product_master_id));
          if (matched) rowNode.querySelector('[data-cell="adjustment_product_input"]').value = matched.description;
        }
      } else {
        ['type', 'product', 'qty', 'charges'].forEach(part => {
          let cell = rowNode.querySelector(`[data-adjust="${part}"]`);
          if (cell) cell.remove();
        });
      }

      if (showTrace) {
        rowNode.querySelectorAll('[data-trace]').forEach(el => {
          el.addEventListener('mouseenter', function () { showTransTrace(product.id, this.dataset.trace, this); });
          el.addEventListener('mouseleave', function () { hideTransTrace(); });
        });
      }

      rowNode.querySelector('[data-cell="item-id"]').value = item ? item.id : '';
      rowNode.querySelector('[data-cell="srp-price"]').value = item ? item.srp_price : 0;

      tbody.appendChild(rowNode);
    });
	
	
	
	
  }
}
// --- Missing dates modal content ---
function renderMissingDatesModal(data) {
  let list = document.getElementById('missingDatesList');
  list.innerHTML = '';
  let template = document.getElementById('missingDateRowTemplate');
  let dates = data.missing_dates || [];
  document.getElementById('missingDatesCount').textContent = dates.length
    ? `${dates.length} date${dates.length === 1 ? '' : 's'} missing this month.`
    : '';
  dates.forEach(d => {
    let node = template.content.cloneNode(true);
    node.querySelector('[data-cell="label"]').textContent = d.label || d.iso;
    node.querySelector('[data-cell="iso"]').textContent = d.iso || '';
    list.appendChild(node);
  });
}

// --- Motif breakdown groups (dynamic count from motif_charge_payload.quantity) ---
function renderMotifGroups(quantity) {
  let container = document.getElementById('motif-groups');
  container.innerHTML = '';
  document.getElementById('motifQuantityDisplay').textContent = quantity;
  let groupTemplate = document.getElementById('motifGroupTemplate');
  let rowTemplate = document.getElementById('motifRowTemplate');
  for (let motifNum = 1; motifNum <= quantity; motifNum++) {
    let groupNode = groupTemplate.content.cloneNode(true);
    let groupEl = groupNode.querySelector('[data-cell="group"]');
    groupEl.dataset.motifIndex = motifNum;
    groupNode.querySelector('[data-cell="title"]').textContent = `Motif #${motifNum}`;
    let rowsBody = groupNode.querySelector('[data-cell="rows"]');
    for (let rowNum = 1; rowNum <= 3; rowNum++) {
      let rowNode = rowTemplate.content.cloneNode(true);
      let rowEl = rowNode.querySelector('[data-cell="row"]');
      rowEl.dataset.motifIndex = motifNum;
      rowEl.dataset.rowIndex = rowNum;
      rowsBody.appendChild(rowNode);
    }
    container.appendChild(groupNode);
  }
}

document.getElementById('missing-dates-overlay').addEventListener('click', function() { hideMissingDatesModal(); });

document.getElementById('product-search-input').addEventListener('input', function() { applyInventoryFilters(); });



// --- Master fetch + orchestration ---
function loadInvenSyncDetailData() {


  let storeId = new URLSearchParams(window.location.search).get('store_id') || initialStoreId;
  let dateStr = new URLSearchParams(window.location.search).get('date') || initialDate || '';
  let params = new URLSearchParams();
  if (storeId) params.set('store_id', storeId);
  if (dateStr) params.set('date', dateStr);

  fetch(`/apis/get_invensync_detail_data?${params.toString()}`, { credentials: 'same-origin' })
    .then(response => response.json())
    .then(async data => {
      if (data.type !== 'success') {
        console.error('[InvenSync] API returned error:', data.message);
        toast.error(data.message || 'Unable to load inventory.');
        return;
      }
      data = computePageState(data);

      renderHeaderStoreInfo(data);
      applyVisibilityRules(data);
      renderStatusBanners(data);
      renderFirstTimeModal(data);
      renderCategoryFilters(data.category_groups);
      renderTableHead(data);
      await renderTableBody(data);
	  // initial load, in loadInvenSyncDetailData():
	  unobserveRowVisibility();
	observeRowVisibility(null, document.getElementById('invensyncTableBody'));
	  
      renderMissingDatesModal(data);
      if (data.motif_charge_payload && data.motif_charge_payload.detected) {
        renderMotifGroups(data.motif_charge_payload.quantity || 0);
      }

      initScriptState(data);
      initInventoryPageAfterRender();
	  unblurProductTable();
    })
    .catch(error => {
      console.error('[InvenSync] fetch/render failed:', error);
      toast.error(error.message || 'Failed to load inventory.');
	  unblurProductTable();
    });
}




//Data Loading



loadInvenSyncDetailData();

let inventoryId;
let inventoryInitialSnapshot = '';
let inventoryDraftKey = `invensyncInventoryDraft:${inventoryId}`;
let motifChargePayload;
let motifProductOptions;
let adjProductOptions;
let motifBreakdownKey;
let missingDates;
let nextMissingDate;
let isInvenSyncGuideMode;
let isStoreManagerInventory;
let requiresBeginningStockFirst;
let isDayFinalized;
let isBeginningFinalized;
let isSavingBeginningInventory = requiresBeginningStockFirst;
let missingBeginningNoticeOpen = false;
let beginningGuideActive = false;
let beginningGuideStepIndex = 0;
let beginningGuideRenderTimer = null;
let beginningGuideScrollRenderTimer = null;
let beginningGuideCompletionKey;
let motifGuideActive = false;
let motifGuideStepIndex = 0;
let motifGuideSeenKey = 'motifBreakdownGuideSeenV2';
let isAdminCorrectionMode;
let adminUnlockScope;
let hasAdminStoreUnlock = Boolean(adminUnlockScope?.all || (adminUnlockScope?.cells || []).length);
let adminAllCellsUnlocked = false;
let adminSelectedInput = null;
let adminSelectedInputs = [];
let adminOriginalValues = new Map();
let adminUndoStack = [];
let adminCellInstructionKey = 'invensyncAdminSelectionInstructionSeenV2';

let pageStoreId;
let pageStoreName;
let pageSelectedDate;
let isViewOnlyRole;

function initScriptState(data) {
  inventoryId = data.inventory.id;
  motifChargePayload = data.motif_charge_payload || null;
  motifProductOptions = data.motif_product_options || [];
  adjProductOptions = data.adj_product_options || [];
  motifBreakdownKey = `invensyncMotifBreakdown:${data.store.id}:${data.selected_date}`;
  missingDates = data.missing_dates || [];
  nextMissingDate = data.next_missing_date || null;
  isInvenSyncGuideMode = (initialGuideParam === '1');
  isStoreManagerInventory = (currentUserRole === 'Store Manager');
  requiresBeginningStockFirst = !!data.allow_beginning_stock_entry;
  isDayFinalized = data.is_day_locked;
  isBeginningFinalized = data.is_beginning_locked;
  isSavingBeginningInventory = requiresBeginningStockFirst;
  beginningGuideCompletionKey = `invensync-beginning-guide-completed-store-${data.store.id}`;
  isAdminCorrectionMode = ['Admin', 'Superadmin'].includes(currentUserRole);
  adminUnlockScope = data.admin_unlock_scope || { all: false, cells: [] };
  hasAdminStoreUnlock = Boolean(adminUnlockScope?.all || (adminUnlockScope?.cells || []).length);
  isInventoryAdjustmentsEditable = !!data.is_edit_adjustments;
  invAdjustmentsSaveUrl = window.INVENSYNC_URLS.saveAdjustments;
  pageStoreId = data.store.id;
  pageStoreName = data.store.name;
  pageSelectedDate = data.selected_date;
  isViewOnlyRole = !!data.is_view_only;

  if (isInvenSyncGuideMode && window.history && window.history.replaceState) {
    let cleanGuideUrl = new URL(window.location.href);
    cleanGuideUrl.searchParams.delete('guide');
    window.history.replaceState({}, '', `${cleanGuideUrl.pathname}${cleanGuideUrl.search}${cleanGuideUrl.hash}`);
  }
}

function getInventorySaveButtons() {
  return Array.from(document.querySelectorAll('[data-save-inventory]'));
}

function setInventorySaveButtons(options = {}) {
  getInventorySaveButtons().forEach(button => {
    if (Object.prototype.hasOwnProperty.call(options, 'text')) {
      button.textContent = options.text;
    }
    if (Object.prototype.hasOwnProperty.call(options, 'disabled')) {
      button.disabled = Boolean(options.disabled);
    }
  });
}

function adminEditableInputs() {
  let fullscreenModal = document.getElementById('fullscreen-modal');
  let scope = fullscreenModal && !fullscreenModal.classList.contains('hidden')
    ? fullscreenModal
    : document.getElementById('main-content');
  return Array.from(scope?.querySelectorAll('tbody tr[data-product-id] td[data-field] input:not([type="hidden"])') || []);
}

function unlockAdminInput(input) {
  if (!input || !isAdminCorrectionMode) return;
  if (!adminOriginalValues.has(input)) adminOriginalValues.set(input, input.value);
  input.disabled = false;
  input.readOnly = false;
  input.classList.remove('readonly', 'cursor-not-allowed', 'opacity-75');
  input.classList.add('ring-2', 'ring-amber-300', 'border-amber-400');
  input.addEventListener('input', refreshAdminCorrectionButton);
}

function getAdminUnlockCellsFromInputs(inputs) {
  let cells = [];
  let seen = new Set();
  (inputs || []).forEach(input => {
    let row = input.closest('tr[data-product-id]');
    let fieldCell = input.closest('td[data-field]');
    let itemId = row?.querySelector('.inv-item-id')?.value;
    let field = fieldCell?.dataset.field;
    if (!itemId || !field) return;
    let key = `${itemId}|${field}`;
    if (seen.has(key)) return;
    seen.add(key);
    cells.push({ item_id: itemId, field });
  });
  return cells;
}

function syncAdminUnlockScope(action, scope, inputs = []) {
  if (!isAdminCorrectionMode) return Promise.resolve();
  let cells = scope === 'cells' ? getAdminUnlockCellsFromInputs(inputs) : [];
  if (scope === 'cells' && !cells.length) return Promise.resolve();

  return fetch('/apis/update_invensync_unlock_scope', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      inventory_id: inventoryId,
      action,
      scope,
      cells
    })
  })
  .then(async response => {
    let data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || 'Unable to update store unlock state.');
    notify(data.message, action === 'unlock' ? 'success' : 'info');
    return data;
  })
  .catch(error => {
    notify(error.message, 'error');
  });
}

function unlockStoreInputFromAdmin(input) {
  if (!input) return;
  input.disabled = false;
  input.readOnly = false;
  input.classList.remove('readonly', 'cursor-not-allowed', 'opacity-75');
  input.classList.add('ring-2', 'ring-emerald-300', 'border-emerald-400');
  if (!input.dataset.adminUnlockedNotice) {
    input.title = input.title ? `${input.title} · Admin unlocked` : 'Admin unlocked';
    input.dataset.adminUnlockedNotice = '1';
  }
}

function applyAdminStoreUnlocks() {
  if (!hasAdminStoreUnlock) return;
  let unlockedCells = new Set(adminUnlockScope?.cells || []);
  document.querySelectorAll('#main-content tbody tr[data-product-id]').forEach(row => {
    let itemId = row.querySelector('.inv-item-id')?.value;
    row.querySelectorAll('td[data-field] input:not([type="hidden"])').forEach(input => {
      let field = input.closest('td[data-field]')?.dataset.field;
      if (!itemId || !field) return;
      if (adminUnlockScope?.all || unlockedCells.has(`${itemId}|${field}`)) {
        unlockStoreInputFromAdmin(input);
      }
    });
  });

  if (isDayFinalized) {
    setInventorySaveButtons({ text: 'Save', disabled: true });
  }
}

function toggleAdminSelectedCell() {
  let selectedInputs = adminSelectedInputs.length
    ? adminSelectedInputs
    : (adminSelectedInput ? [adminSelectedInput] : []);
  if (!selectedInputs.length) {
    notify('Select a cell, product row, or column first.', 'warning');
    return;
  }

  let shouldUnlock = selectedInputs.every(input => input.readOnly || input.disabled);
  if (shouldUnlock) {
    selectedInputs.forEach(unlockAdminInput);
    syncAdminUnlockScope('unlock', 'cells', selectedInputs);
    if (selectedInputs.length === 1) {
      selectedInputs[0].focus();
      selectedInputs[0].select();
    }
    updateAdminSelectedButton();
    notify(`${selectedInputs.length} selected cell(s) unlocked.`, 'success');
  } else {
    selectedInputs.forEach(input => {
      input.readOnly = true;
      input.classList.remove('ring-2', 'ring-amber-300', 'border-amber-400');
      input.classList.add('readonly', 'cursor-not-allowed', 'opacity-75');
    });
    syncAdminUnlockScope('lock', 'cells', selectedInputs);
    updateAdminSelectedButton();
    refreshAdminCorrectionButton();
    notify(`${selectedInputs.length} selected cell(s) locked. Pending changes remain ready to save.`, 'info');
  }
}

function toggleAllAdminCells() {
  if (adminAllCellsUnlocked) {
    lockAllAdminCells();
  } else {
    unlockAllAdminCells();
  }
}

function unlockAllAdminCells() {
  adminEditableInputs().forEach(unlockAdminInput);
  syncAdminUnlockScope('unlock', 'all');
  adminAllCellsUnlocked = true;
  resetAdminSelectionButton();
  document.querySelectorAll('[data-admin-all-toggle]').forEach(button => {
    button.querySelector('span').textContent = 'Lock All';
    button.title = 'Lock every input cell on this page';
    button.classList.remove('border-sky-300', 'bg-sky-50', 'text-sky-800', 'hover:bg-sky-100');
    button.classList.add('border-slate-300', 'bg-slate-100', 'text-slate-800', 'hover:bg-slate-200');
  });
  notify('All input cells are unlocked for this correction session.', 'success');
}

function lockAllAdminCells() {
  adminEditableInputs().forEach(input => {
    input.readOnly = true;
    input.classList.remove('ring-2', 'ring-amber-300', 'border-amber-400');
    input.classList.add('readonly', 'cursor-not-allowed', 'opacity-75');
  });
  syncAdminUnlockScope('lock', 'all');
  adminAllCellsUnlocked = false;
  resetAdminSelectionButton();
  document.querySelectorAll('[data-admin-all-toggle]').forEach(button => {
    button.querySelector('span').textContent = 'Unlock All';
    button.title = 'Unlock every input cell on this page';
    button.classList.remove('border-slate-300', 'bg-slate-100', 'text-slate-800', 'hover:bg-slate-200');
    button.classList.add('border-sky-300', 'bg-sky-50', 'text-sky-800', 'hover:bg-sky-100');
  });
  refreshAdminCorrectionButton();
  notify('All input cells are locked. Pending changes are still ready to save.', 'info');
}

function resetAdminSelectionButton() {
  adminEditableInputs().forEach(input => {
    input.classList.remove('ring-2', 'ring-violet-400', 'border-violet-400');
    if (input.readOnly) input.classList.add('opacity-75');
  });
  adminSelectedInput = null;
  adminSelectedInputs = [];
  document.querySelectorAll('.admin-range-selected').forEach(element => {
    element.classList.remove('admin-range-selected', 'ring-2', 'ring-inset', 'ring-violet-400');
  });
  document.querySelectorAll('[data-admin-selected-toggle]').forEach(button => {
    button.querySelector('span').textContent = 'Unlock Selected';
    button.title = 'Unlock the selected cells, row, or column';
    button.classList.remove('ring-2', 'ring-violet-400');
  });
}

function updateAdminSelectedButton() {
  let selectedInputs = adminSelectedInputs.length
    ? adminSelectedInputs
    : (adminSelectedInput ? [adminSelectedInput] : []);
  if (!selectedInputs.length) return;
  let isLocked = selectedInputs.every(input => input.readOnly || input.disabled);
  document.querySelectorAll('[data-admin-selected-toggle]').forEach(button => {
    button.querySelector('span').textContent = isLocked ? 'Unlock Selected' : 'Lock Selected';
    button.title = isLocked ? 'Unlock the selected cells, row, or column' : 'Lock the selected cells, row, or column';
    button.classList.add('ring-2', 'ring-violet-400');
  });
}

function showAdminCellInstructionOnce() {
  try {
    if (localStorage.getItem(adminCellInstructionKey) === '1') return;
    localStorage.setItem(adminCellInstructionKey, '1');
  } catch (error) {
    // Show the instruction when browser storage is unavailable.
  }
  notify('Select a cell, click a product name for a row, or click a column header. Then use Unlock Selected or Lock Selected.', 'info');
}

function refreshAdminCorrectionButton() {
  let changed = Array.from(adminOriginalValues.entries()).some(([input, original]) => input.value !== original);
  document.querySelectorAll('[data-admin-save-corrections]').forEach(button => {
    button.disabled = !changed;
  });
}

function getAdminKeyboardSelection() {
  return adminSelectedInputs.length
    ? adminSelectedInputs
    : (adminSelectedInput ? [adminSelectedInput] : []);
}

function clearAdminSelection() {
  if (!isAdminCorrectionMode) return;
  let inputs = getAdminKeyboardSelection();
  if (!inputs.length) return;
  let changes = inputs.map(input => ({ input, value: input.value }));
  if (!changes.some(change => change.value !== '')) return;
  adminUndoStack.push(changes);
  if (adminUndoStack.length > 30) adminUndoStack.shift();
  inputs.forEach(input => {
    unlockAdminInput(input);
    input.value = '';
    if (input.classList.contains('sold-input') || input.classList.contains('beginning-input') || input.classList.contains('delivery-input') || input.classList.contains('trans-in-input') || input.classList.contains('bo-input') || input.classList.contains('adv-del-input') || input.classList.contains('trans-out-input') || input.classList.contains('wastage-input') || input.classList.contains('csi-input') || input.classList.contains('ending-d5-input') || input.classList.contains('ending-d4-input') || input.classList.contains('ending-d3-input')) {
      updateInventoryRow(input);
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  refreshAdminCorrectionButton();
}

function undoAdminClear() {
  if (!isAdminCorrectionMode) return;
  let changes = adminUndoStack.pop();
  if (!changes?.length) return;
  changes.forEach(({ input, value }) => {
    input.value = value;
    if (input.type === 'number') updateInventoryRow(input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  refreshAdminCorrectionButton();
}

document.addEventListener('keydown', event => {
  if (!isAdminCorrectionMode) return;

  let active = document.activeElement;
  let isTypingElsewhere = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)
    && !getAdminKeyboardSelection().includes(active);

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    if (!isTypingElsewhere && getAdminKeyboardSelection().length) {
      event.preventDefault();
      event.stopPropagation();
      undoAdminClear();
    }
    return;
  }
  if (event.key === 'Backspace' && !event.ctrlKey && !event.metaKey && !event.altKey) {
    if (!isTypingElsewhere && getAdminKeyboardSelection().length) {
      event.preventDefault();
      event.stopPropagation();
      clearAdminSelection();
    }
    return;
  }
  let gridTarget = event.target.closest?.('#main-content tbody tr[data-product-id], #fullscreen-modal tbody tr[data-product-id]');
  if (!gridTarget) return;
}, true);



document.addEventListener('click', event => {
  if (!isAdminCorrectionMode) return;

  let header = event.target.closest('#main-content thead tr:nth-child(3) th, #fullscreen-modal thead tr:nth-child(3) th');
  if (header && header.cellIndex > 0) {
    event.preventDefault();
    let table = header.closest('table');
    let columnInputs = Array.from(table.querySelectorAll('tbody tr[data-product-id]'))
      .map(row => row.cells[header.cellIndex]?.querySelector('input:not([type="hidden"])'))
      .filter(Boolean);
    if (!columnInputs.length) return;
    resetAdminSelectionButton();
    adminSelectedInputs = columnInputs;
    header.classList.add('admin-range-selected', 'ring-2', 'ring-inset', 'ring-violet-400');
    columnInputs.forEach(input => input.classList.add('ring-2', 'ring-violet-400'));
    updateAdminSelectedButton();
    showAdminCellInstructionOnce();
    return;
  }

  let productCell = event.target.closest('#main-content tbody tr[data-product-id] td:first-child, #fullscreen-modal tbody tr[data-product-id] td:first-child');
  if (productCell) {
    event.preventDefault();
    let rowInputs = Array.from(productCell.closest('tr').querySelectorAll('td[data-field] input:not([type="hidden"])'));
    if (!rowInputs.length) return;
    resetAdminSelectionButton();
    adminSelectedInputs = rowInputs;
    productCell.classList.add('admin-range-selected', 'ring-2', 'ring-inset', 'ring-violet-400');
    rowInputs.forEach(input => input.classList.add('ring-2', 'ring-violet-400'));
    updateAdminSelectedButton();
    showAdminCellInstructionOnce();
    return;
  }

  let input = event.target.closest('tbody tr[data-product-id] td[data-field] input:not([type="hidden"])');
  if (!input) return;
  if (input.readOnly || input.disabled) event.preventDefault();
  resetAdminSelectionButton();
  adminSelectedInput = input;
  adminSelectedInputs = [input];
  if (input.readOnly || input.disabled) input.classList.remove('opacity-75');
  input.classList.add('ring-2', 'ring-violet-400', 'border-violet-400');
  updateAdminSelectedButton();
  showAdminCellInstructionOnce();
}, true);

function saveAdminCorrections() {
  let changes = [];
  adminOriginalValues.forEach((original, input) => {
    if (input.value === original) return;
    let row = input.closest('tr[data-product-id]');
    let cell = input.closest('td[data-field]');
    let itemId = row?.querySelector('.inv-item-id')?.value;
    if (itemId && cell?.dataset.field) {
      changes.push({item_id: itemId, field: cell.dataset.field, value: input.value});
    }
  });
  if (!changes.length) return;

  document.querySelectorAll('[data-admin-save-corrections]').forEach(button => {
    button.disabled = true;
  });
  fetch('/admin/invensync/inventory-correction', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({inventory_id: inventoryId, changes})
  })
  .then(async response => {
    let data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || 'Unable to save changes.');
    notify(data.message, 'success');
    window.location.reload();
  })
  .catch(error => {
    notify(error.message, 'error');
    refreshAdminCorrectionButton();
  });
}

function unfinalizeInventory() {
  if (!confirm('Unfinalize this day? The store will be able to edit and re-save data for this date.')) return;
  let btn = document.getElementById('admin-unfinalize-btn');
  if (btn) { btn.disabled = true; btn.classList.add('opacity-50', 'cursor-not-allowed'); }
  fetch('/admin/invensync/unfinalize', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({inventory_id: inventoryId})
  })
  .then(async response => {
    let data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || 'Unable to unfinalize.');
    notify(data.message, 'success');
    window.location.reload();
  })
  .catch(error => {
    notify(error.message, 'error');
    if (btn) { btn.disabled = false; btn.classList.remove('opacity-50', 'cursor-not-allowed'); }
  });
}

function notify(message, type = 'info') {
  if (typeof toast !== 'undefined' && typeof toast.show === 'function') {
    toast.show(message, type);
    return;
  }

  let container = document.getElementById('invensync-toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'invensync-toast-container';
    container.className = 'fixed top-4 right-4 z-[9999] flex flex-col gap-3 pointer-events-none';
    document.body.appendChild(container);
  }

  let styles = {
    success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800'
  };

  let item = document.createElement('div');
  item.className = `pointer-events-auto max-w-md rounded-xl border px-4 py-3 text-sm font-semibold shadow-lg transition-all duration-300 ${styles[type] || styles.info}`;
  item.textContent = message;
  container.appendChild(item);

  setTimeout(() => {
    item.classList.add('opacity-0', 'translate-x-full');
    setTimeout(() => item.remove(), 300);
  }, 4000);
}

function getMotifModal() {
  return document.getElementById('motif-breakdown-modal');
}

function formatPeso(value) {
  return formatToPHP(value);
}

function formatToPHP(amount,sign="P") {
  return sign  + Number(amount).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
  
 }

function readMotifBreakdownRows() {
  let modal = getMotifModal();
  if (!modal) return [];
  return Array.from(modal.querySelectorAll('tbody tr')).map(row => {
    let productInput = row.querySelector('.motif-product-input');
    let product = productInput?.value.trim() || '';
    let selectedProduct = findMotifProductOption(product);
    let quantity = Number(row.querySelector('.motif-qty-input')?.value || 0);
    let price = Number(row.querySelector('.motif-price-input')?.value || 0);
    let discount = Number(row.querySelector('.motif-discount-input')?.value || 0);
    return {
      product: selectedProduct?.description || product,
      product_id: selectedProduct?.id || null,
      product_code: selectedProduct?.code || null,
      motif_index: Number(row.dataset.motifIndex || row.closest('.motif-group')?.dataset.motifIndex || 1),
      row_index: Number(row.dataset.rowIndex || 1),
      quantity,
      unit_price: Number(selectedProduct?.price || 0),
      price,
      discount
    };
  });
}

function resetMotifBreakdownRow(row) {
  if (!row) return;
  let productInput = row.querySelector('.motif-product-input');
  if (productInput) {
    productInput.value = '';
    productInput.classList.remove('border-red-300');
    productInput.title = '';
  }
  let quantityInput = row.querySelector('.motif-qty-input');
  let priceInput = row.querySelector('.motif-price-input');
  let discountInput = row.querySelector('.motif-discount-input');
  [quantityInput, priceInput, discountInput].forEach(input => {
    if (!input) return;
    input.value = '';
    input.disabled = true;
    input.classList.add('bg-slate-100', 'text-slate-400', 'cursor-not-allowed');
  });
}

function disableMotifBreakdownRowFields(row) {
  if (!row) return;
  let quantityInput = row.querySelector('.motif-qty-input');
  let priceInput = row.querySelector('.motif-price-input');
  let discountInput = row.querySelector('.motif-discount-input');
  [quantityInput, priceInput, discountInput].forEach(input => {
    if (!input) return;
    input.value = '';
    input.disabled = true;
    input.classList.add('bg-slate-100', 'text-slate-400', 'cursor-not-allowed');
  });
}

function enableMotifBreakdownRow(row) {
  if (!row) return;
  let quantityInput = row.querySelector('.motif-qty-input');
  let priceInput = row.querySelector('.motif-price-input');
  let discountInput = row.querySelector('.motif-discount-input');
  [quantityInput, priceInput, discountInput].forEach(input => {
    if (!input) return;
    input.disabled = false;
    input.classList.remove('bg-slate-100', 'text-slate-400', 'cursor-not-allowed');
  });
  if (priceInput) {
    priceInput.readOnly = true;
    priceInput.classList.add('bg-slate-100', 'text-slate-600', 'cursor-not-allowed');
  }
}

function recalculateMotifPrice(row) {
  if (!row) return;
  let selectedProduct = findMotifProductOption(row.querySelector('.motif-product-input')?.value || '');
  let priceInput = row.querySelector('.motif-price-input');
  if (!priceInput) return;
  if (!selectedProduct) {
    priceInput.value = '';
    return;
  }
  let quantity = Math.max(0, Number(row.querySelector('.motif-qty-input')?.value || 0));
  let discount = Math.max(0, Number(row.querySelector('.motif-discount-input')?.value || 0));
  priceInput.value = Math.max(0, (Number(selectedProduct.price || 0) * quantity) - discount).toFixed(2);
}

function findMotifProductOption(productName) {
  let normalizedName = String(productName || '').trim().toLowerCase();
  if (!normalizedName) return null;
  return (motifProductOptions || []).find(product => String(product.description || '').trim().toLowerCase() === normalizedName) || null;
}

function hideMotifProductDropdown(input) {
  let dropdown = input?.closest('td')?.querySelector('.motif-product-dropdown');
  if (dropdown) dropdown.classList.add('hidden');
}

function positionMotifProductDropdown(input, dropdown) {
  if (!input || !dropdown) return;
  let rect = input.getBoundingClientRect();
  dropdown.style.left = `${rect.left}px`;
  dropdown.style.top = `${rect.bottom + 4}px`;
  dropdown.style.width = `${rect.width}px`;
}

function renderMotifProductDropdown(input) {
  let dropdown = input?.closest('td')?.querySelector('.motif-product-dropdown');
  if (!input || !dropdown) return;
  let query = String(input.value || '').trim().toLowerCase();
  let products = (motifProductOptions || [])
    .filter(product => {
      let description = String(product.description || '').toLowerCase();
      let code = String(product.code || '').toLowerCase();
      return !query || description.includes(query) || code.includes(query);
    })
    .slice(0, 80);

  dropdown.innerHTML = '';
  positionMotifProductDropdown(input, dropdown);
  if (!products.length) {
    let empty = document.createElement('div');
    empty.className = 'px-3 py-2 text-sm text-slate-500';
    empty.textContent = 'No product found';
    dropdown.appendChild(empty);
    dropdown.classList.remove('hidden');
    return;
  }

  products.forEach(product => {
    let button = document.createElement('button');
    button.type = 'button';
    button.className = 'block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-950';
    let name = document.createElement('span');
    name.className = 'font-semibold';
    name.textContent = product.description || '';
    let meta = document.createElement('span');
    meta.className = 'mt-0.5 block text-[11px] text-slate-500';
    meta.textContent = `${product.code || '-'} · ${(product.price || 0)}`;
    button.appendChild(name);
    button.appendChild(meta);
    button.addEventListener('mousedown', function(event) {
      event.preventDefault();
      input.value = product.description || '';
      hideMotifProductDropdown(input);
      syncMotifProductSelection(input, { clearInvalid: true });
    });
    dropdown.appendChild(button);
  });
  dropdown.classList.remove('hidden');
}

function syncMotifProductSelection(input, options = {}) {
  if (!input) return;
  let row = input.closest('tr');
  let selectedProduct = findMotifProductOption(input.value);
  input.classList.toggle('border-red-300', Boolean(input.value.trim()) && !selectedProduct);
  input.title = selectedProduct ? `Product Master Code: ${selectedProduct.code || '-'}` : (input.value.trim() ? 'Select a product from Product Master' : '');
  if (!row) return;
  if (!selectedProduct) {
    if (options.clearInvalid) {
      resetMotifBreakdownRow(row);
    } else {
      disableMotifBreakdownRowFields(row);
    }
    return;
  }
  enableMotifBreakdownRow(row);
  let quantityInput = row.querySelector('.motif-qty-input');
  if (quantityInput && !quantityInput.value) {
    quantityInput.value = '1';
  }
  recalculateMotifPrice(row);
}

function normalizeMotifProductName(value) {
  return String(value || '').trim().toLowerCase();
}

function getSavedMotifBreakdown() {
  try {
    let saved = JSON.parse(localStorage.getItem(motifBreakdownKey) || 'null');
    return saved && Array.isArray(saved.rows) ? saved : null;
  } catch (_) {
    return null;
  }
}

function buildMotifTagTitle(row, allRows = []) {
  let product = row.product || 'Motif product';
  let quantity = Number(row.quantity || 0);
  let unitPrice = Number(row.unit_price || 0);
  let price = Number(row.price || 0);
  let discount = Number(row.discount || 0);
  let motifSet = row.motif_index ? `Motif #${row.motif_index} | ` : '';
  let motifProducts = (allRows || [])
    .filter(item =>
      item
      && item.product
      && Number(item.motif_index || 1) === Number(row.motif_index || 1)
      && normalizeMotifProductName(item.product) !== normalizeMotifProductName(product)
    )
    .map(item => {
      let itemQty = Number(item.quantity || 0);
      return `${item.product}${itemQty ? ` (${itemQty})` : ''}`;
    });
  let comboText = motifProducts.length
    ? ` | Combo with: ${motifProducts.join(' + ')}`
    : '';
  return `${motifSet}${product} used in Additional Charge for Motif${comboText} | Sold Qty: ${quantity} | Unit Price: ${(unitPrice)} | Discount: ${(discount)} | Net Price: ${(price)}`;
}

function applyMotifTagsToSoldColumn() {
  let saved = getSavedMotifBreakdown();
  let savedRows = saved?.rows || [];
  let motifRows = savedRows.filter(row => row && row.product);
  let motifByName = new Map();
  motifRows.forEach(row => {
    let key = normalizeMotifProductName(row.product);
    let existing = motifByName.get(key);
    if (existing) {
      existing.quantity = Number(existing.quantity || 0) + Number(row.quantity || 0);
      existing.price = Number(existing.price || 0) + Number(row.price || 0);
      existing.discount = Number(existing.discount || 0) + Number(row.discount || 0);
    } else {
      motifByName.set(key, { ...row });
    }
  });

  document.querySelectorAll('#main-content tbody tr[data-product-id]').forEach(row => {
    let badgeStack = row.querySelector('td[data-field="quantity_sold"] .inline-flex');
    let soldInput = row.querySelector('.sold-input');
    if (!badgeStack) return;
    badgeStack.querySelectorAll('.motif-sold-badge').forEach(badge => badge.remove());
    let posBadge = badgeStack.querySelector('.pos-review-badge');
    let hasBitbitBadge = Boolean(badgeStack.querySelector('.bitbit-sold-badge'));
    if (posBadge && !hasBitbitBadge) {
      posBadge.classList.add('hidden');
    }
    if (soldInput) {
      if (soldInput.dataset.motifBaseSold === undefined) {
        soldInput.dataset.motifBaseSold = soldInput.value || '';
      }
      soldInput.value = soldInput.dataset.motifBaseSold || '';
    }
    let matchedMotifRow = motifByName.get(normalizeMotifProductName(row.dataset.productName));
    if (!matchedMotifRow) {
      return;
    }
    let motifQuantity = Math.max(0, Number(matchedMotifRow.quantity || 0));
    if (soldInput && motifQuantity > 0) {
      let baseSold = Number(soldInput.dataset.motifBaseSold || 0);
      soldInput.value = baseSold + motifQuantity;
      if (typeof updateInventoryRow === 'function') updateInventoryRow(soldInput);
    }

    let badge = document.createElement('span');
    badge.className = 'motif-sold-badge border border-emerald-200 bg-emerald-100 text-emerald-700 text-[8px] px-1 py-0.5 rounded whitespace-nowrap font-semibold leading-none cursor-default select-none transition-transform duration-150 ease-out hover:scale-110 hover:shadow-sm';
    badge.textContent = `MOTIF ${motifQuantity}`;
    badge.title = buildMotifTagTitle(matchedMotifRow, motifRows);
    badgeStack.appendChild(badge);
    if (posBadge) {
      posBadge.classList.remove('hidden');
    }
  });
}

function loadMotifBreakdown() {
  let modal = getMotifModal();
  if (!modal) return false;
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(motifBreakdownKey) || 'null');
  } catch (_) {
    saved = null;
  }
  if (!saved || !Array.isArray(saved.rows)) {
    return false;
  }
  let tableRows = Array.from(modal.querySelectorAll('tbody tr'));
  tableRows.forEach((row, index) => {
    let savedRow = (saved.rows || []).find(item =>
      Number(item.motif_index || 1) === Number(row.dataset.motifIndex || 1)
      && Number(item.row_index || 1) === Number(row.dataset.rowIndex || 1)
    ) || saved.rows[index] || {};
    let productInput = row.querySelector('.motif-product-input');
    let quantityInput = row.querySelector('.motif-qty-input');
    let priceInput = row.querySelector('.motif-price-input');
    let discountInput = row.querySelector('.motif-discount-input');
    if (productInput) productInput.value = savedRow.product || '';
    if (quantityInput) quantityInput.value = savedRow.quantity || '';
    if (priceInput) priceInput.value = savedRow.price || '';
    if (discountInput) discountInput.value = savedRow.discount || '';
    if (productInput) syncMotifProductSelection(productInput);
  });
  applyMotifTagsToSoldColumn();
  return true;
}

function openMotifBreakdownModal() {
  let modal = getMotifModal();
  if (!modal) return;
  loadMotifBreakdown();
  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
}

function closeMotifBreakdownModal() {
  let modal = getMotifModal();
  if (!modal) return;
  clearMotifBreakdownGuide();
  hideMotifGuideStartModal();
  modal.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
}

function getMotifGuideStartModal() {
  return document.getElementById('motif-guide-start-modal');
}

function showMotifGuideStartModal() {
  let modal = getMotifGuideStartModal();
  if (!modal || localStorage.getItem(motifGuideSeenKey) === '1') return;
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function hideMotifGuideStartModal() {
  let modal = getMotifGuideStartModal();
  if (!modal) return;
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function getMotifGuideStep() {
  let modal = getMotifModal();
  if (!modal) return null;
  let firstRow = modal.querySelector('tbody tr[data-motif-index="1"][data-row-index="1"]');
  let priceDiscountFields = [
    firstRow?.querySelector('.motif-price-input'),
    firstRow?.querySelector('.motif-discount-input')
  ].filter(Boolean);
  let steps = [
    {
      elements: [firstRow?.querySelector('.motif-product-input')],
      text: 'Type the product included in this motif, then select it from Product Master.',
      placement: 'right',
      nextText: 'Next'
    },
    {
      elements: [firstRow?.querySelector('.motif-qty-input')],
      text: 'Enter how many pieces of this product belong to this motif.',
      placement: 'left',
      nextText: 'Next'
    },
    {
      elements: priceDiscountFields,
      text: 'Price will follow the selected product. Add discount only if this motif product has one.',
      placement: 'left',
      nextText: 'Next'
    },
    {
      elements: [document.getElementById('motif-save-guide-target')],
      text: 'Click Save Breakdown so the motif products reflect in the InvenSync Sold column.',
      placement: 'top',
      nextText: 'Finish'
    }
  ];
  return steps[motifGuideStepIndex] || null;
}

function removeMotifTourPanels() {
  document.querySelectorAll('.motif-tour-panel').forEach(panel => panel.remove());
  document.querySelectorAll('.motif-tour-label').forEach(label => label.remove());
}

function clearMotifBreakdownGuide() {
  motifGuideActive = false;
  motifGuideStepIndex = 0;
  removeMotifTourPanels();
  document.querySelectorAll('.motif-tour-target').forEach(el => {
    el.classList.remove('motif-tour-target');
  });
}

function applyMotifGuideTarget() {
  document.querySelectorAll('.motif-tour-target').forEach(el => {
    el.classList.remove('motif-tour-target');
  });
  let step = getMotifGuideStep();
  if (!step) return;
  step.elements.forEach(el => {
    if (el) el.classList.add('motif-tour-target');
  });
}

function renderMotifGuideSpotlight() {
  removeMotifTourPanels();
  let step = getMotifGuideStep();
  if (!step) {
    localStorage.setItem(motifGuideSeenKey, '1');
    clearMotifBreakdownGuide();
    return;
  }
  let rect = getElementGroupRect(step.elements);
  if (!rect) return;
  let panels = [
    { top: 0, left: 0, width: window.innerWidth, height: rect.top },
    { top: rect.bottom, left: 0, width: window.innerWidth, height: window.innerHeight - rect.bottom },
    { top: rect.top, left: 0, width: rect.left, height: rect.bottom - rect.top },
    { top: rect.top, left: rect.right, width: window.innerWidth - rect.right, height: rect.bottom - rect.top }
  ];
  panels.forEach(panel => {
    let el = document.createElement('div');
    el.className = 'motif-tour-panel';
    el.style.top = `${panel.top}px`;
    el.style.left = `${panel.left}px`;
    el.style.width = `${Math.max(0, panel.width)}px`;
    el.style.height = `${Math.max(0, panel.height)}px`;
    document.body.appendChild(el);
  });

  let label = document.createElement('div');
  label.className = 'motif-tour-label';
  let message = document.createElement('div');
  message.textContent = step.text;
  let nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.textContent = step.nextText;
  nextButton.addEventListener('click', nextMotifBreakdownGuideStep);
  label.appendChild(message);
  label.appendChild(nextButton);

  if (step.placement === 'top') {
    label.style.left = `${Math.max(16, Math.min(rect.left, window.innerWidth - 376))}px`;
    label.style.top = `${Math.max(24, rect.top - 130)}px`;
  } else if (step.placement === 'left') {
    label.style.left = `${Math.max(16, rect.left - 380)}px`;
    label.style.top = `${Math.max(24, rect.top)}px`;
  } else if (step.placement === 'bottom') {
    label.style.left = `${Math.max(16, Math.min(rect.left, window.innerWidth - 376))}px`;
    label.style.top = `${Math.min(window.innerHeight - 120, rect.bottom + 18)}px`;
  } else {
    let labelLeft = rect.right + 24;
    let hasRightSpace = labelLeft + 320 <= window.innerWidth;
    label.style.left = `${hasRightSpace ? labelLeft : Math.max(16, rect.left - 340)}px`;
    label.style.top = `${Math.max(24, rect.top)}px`;
  }
  document.body.appendChild(label);
}

function showMotifBreakdownGuideStep() {
  let step = getMotifGuideStep();
  if (!step) {
    localStorage.setItem(motifGuideSeenKey, '1');
    clearMotifBreakdownGuide();
    return;
  }
  let target = step.elements.find(el => el && el.offsetParent !== null);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
  setTimeout(() => {
    applyMotifGuideTarget();
    renderMotifGuideSpotlight();
  }, 350);
}

function nextMotifBreakdownGuideStep() {
  motifGuideStepIndex += 1;
  showMotifBreakdownGuideStep();
}

function startMotifBreakdownGuide() {
  hideMotifGuideStartModal();
  localStorage.setItem(motifGuideSeenKey, '1');
  clearMotifBreakdownGuide();
  motifGuideActive = true;
  motifGuideStepIndex = 0;
  showMotifBreakdownGuideStep();
}

function updateMotifBreakdownBadge() {
  let badge = document.getElementById('motif-breakdown-badge');
  let button = document.getElementById('motif-breakdown-button');
  let saved = getSavedMotifBreakdown();
  let showButton = Boolean(motifChargePayload?.detected && !saved);
  if (button) {
    button.classList.toggle('hidden', !showButton);
  }
  if (!badge) return;
  let showNotification = showButton;
  badge.classList.toggle('hidden', !showNotification);
  if (!showNotification) {
    badge.textContent = '';
    badge.classList.remove('motif-button-badge--count');
    return;
  }
  let count = Number(motifChargePayload?.items?.length || 0);
  if (count > 1) {
    badge.textContent = count;
    badge.classList.add('motif-button-badge--count');
  } else {
    badge.textContent = '';
    badge.classList.remove('motif-button-badge--count');
  }
}

function saveMotifBreakdown() {
  let rows = readMotifBreakdownRows();
  let filledRows = rows.filter(row => row.product_id);
  if (filledRows.length === 0) {
    localStorage.removeItem(motifBreakdownKey);
    document.querySelectorAll('#main-content .motif-sold-badge').forEach(badge => badge.remove());
    document.querySelectorAll('#main-content .sold-input[data-motif-base-sold]').forEach(input => {
      input.value = input.dataset.motifBaseSold || '';
      delete input.dataset.motifBaseSold;
      if (typeof updateInventoryRow === 'function') updateInventoryRow(input);
    });
    notify('Motif breakdown cleared for this store/date.', 'info');
    updateMotifBreakdownBadge();
    closeMotifBreakdownModal();
    return;
  }
  if (filledRows.length === 1) {
    notify('Please select at least 2 Product Master items for the motif breakdown.', 'warning');
    return;
  }
  let invalidGroups = Array.from(document.querySelectorAll('#motif-groups .motif-group')).filter(group => {
    let groupRows = filledRows.filter(row => Number(row.motif_index || 1) === Number(group.dataset.motifIndex || 1));
    return groupRows.length < 2;
  });
  if (invalidGroups.length) {
    notify('Each Motif # must have at least 2 Product Master items, or clear all rows to remove the breakdown.', 'warning');
    return;
  }
  if (filledRows.some(row => !Number(row.quantity || 0))) {
    notify('Please enter Sold Qty for each motif product.', 'warning');
    return;
  }
  localStorage.setItem(motifBreakdownKey, JSON.stringify({
    saved_at: new Date().toISOString(),
    pos_payload: motifChargePayload,
    rows: rows.map(row => row.product_id ? row : {
      product: '',
      product_id: null,
      product_code: null,
      motif_index: row.motif_index,
      row_index: row.row_index,
      quantity: 0,
      unit_price: 0,
      price: 0,
      discount: 0
    })
  }));
  applyMotifTagsToSoldColumn();
  updateMotifBreakdownBadge();
  notify('Motif breakdown saved for this store/date.', 'success');
  closeMotifBreakdownModal();
}



window.addEventListener('resize', function() {
  document.querySelectorAll('.motif-product-input').forEach(input => hideMotifProductDropdown(input));
  if (motifGuideActive) renderMotifGuideSpotlight();
});

document.addEventListener('scroll', function(event) {
  if (event.target && event.target.closest?.('#motif-breakdown-modal')) {
    document.querySelectorAll('.motif-product-input').forEach(input => hideMotifProductDropdown(input));
  }
  if (motifGuideActive) renderMotifGuideSpotlight();
}, true);

function showInvenSyncFullSkeleton() {
  let shell = document.getElementById('invensync-page-shell');
  if (!shell) return;

  let skeletonRows = '';
  for (let i = 0; i < 10; i++) {
    skeletonRows += `
      <tr class="animate-pulse border-b border-slate-100">
        <td class="px-3 py-3 sticky left-0 z-10" style="background:#f0f9ff;">
          <div class="skeleton" style="height:14px;width:70%;border-radius:6px;margin-bottom:6px;"></div>
          <div class="skeleton" style="height:10px;width:45%;border-radius:4px;"></div>
        </td>
        <td class="px-2 py-3"><div class="skeleton" style="height:12px;width:75%;border-radius:4px;margin:auto;"></div></td>
        <td class="px-2 py-3"><div class="skeleton" style="height:12px;width:75%;border-radius:4px;margin:auto;"></div></td>
        <td class="px-2 py-3"><div class="skeleton" style="height:12px;width:75%;border-radius:4px;margin:auto;"></div></td>
        <td class="px-2 py-3"><div class="skeleton" style="height:12px;width:75%;border-radius:4px;margin:auto;"></div></td>
        <td class="px-2 py-3"><div class="skeleton" style="height:12px;width:75%;border-radius:4px;margin:auto;"></div></td>
        <td class="px-2 py-3"><div class="skeleton" style="height:12px;width:75%;border-radius:4px;margin:auto;"></div></td>
        <td class="px-2 py-3"><div class="skeleton" style="height:12px;width:75%;border-radius:4px;margin:auto;"></div></td>
        <td class="px-2 py-3"><div class="skeleton" style="height:12px;width:75%;border-radius:4px;margin:auto;"></div></td>
        <td class="px-2 py-3"><div class="skeleton" style="height:12px;width:75%;border-radius:4px;margin:auto;"></div></td>
        <td class="px-2 py-3"><div class="skeleton" style="height:12px;width:75%;border-radius:4px;margin:auto;"></div></td>
        <td class="px-2 py-3"><div class="skeleton" style="height:12px;width:75%;border-radius:4px;margin:auto;"></div></td>
        <td class="px-2 py-3"><div class="skeleton" style="height:12px;width:75%;border-radius:4px;margin:auto;"></div></td>
      </tr>
    `;
  }

  shell.innerHTML = `
    <!-- Skeleton: Page Header -->
    <section class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 animate-pulse">
      <div>
        <div class="skeleton" style="height:32px;width:340px;border-radius:8px;"></div>
        <div class="skeleton" style="height:14px;width:420px;border-radius:6px;margin-top:10px;"></div>
      </div>
      <div class="flex items-center gap-2">
        <div class="skeleton" style="height:36px;width:100px;border-radius:8px;"></div>
        <div class="skeleton" style="height:36px;width:110px;border-radius:8px;"></div>
        <div class="skeleton" style="height:36px;width:120px;border-radius:8px;"></div>
        <div class="skeleton" style="height:36px;width:100px;border-radius:8px;"></div>
      </div>
    </section>

    <!-- Skeleton: Search & Category Filter Row -->
    <div class="space-y-3 animate-pulse">
      <div class="skeleton" style="height:38px;max-width:448px;width:100%;border-radius:8px;"></div>
      <div class="flex flex-wrap items-center gap-2">
        <div class="skeleton" style="height:36px;width:56px;border-radius:8px;"></div>
        <div class="skeleton" style="height:36px;width:90px;border-radius:8px;"></div>
        <div class="skeleton" style="height:36px;width:110px;border-radius:8px;"></div>
        <div class="skeleton" style="height:36px;width:80px;border-radius:8px;"></div>
        <div class="skeleton" style="height:36px;width:100px;border-radius:8px;"></div>
        <div class="skeleton" style="height:36px;width:70px;border-radius:8px;"></div>
      </div>
    </div>

    <!-- Skeleton: Table -->
    <div class="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden animate-pulse">
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="border-b border-slate-200 bg-slate-50">
              <th class="px-4 py-3 text-left"><div class="skeleton" style="height:18px;width:160px;border-radius:5px;"></div></th>
              <th class="px-3 py-3"><div class="skeleton" style="height:18px;width:70px;border-radius:5px;margin:auto;"></div></th>
              <th class="px-3 py-3"><div class="skeleton" style="height:18px;width:70px;border-radius:5px;margin:auto;"></div></th>
              <th class="px-3 py-3"><div class="skeleton" style="height:18px;width:70px;border-radius:5px;margin:auto;"></div></th>
              <th class="px-3 py-3"><div class="skeleton" style="height:18px;width:70px;border-radius:5px;margin:auto;"></div></th>
              <th class="px-3 py-3"><div class="skeleton" style="height:18px;width:70px;border-radius:5px;margin:auto;"></div></th>
              <th class="px-3 py-3"><div class="skeleton" style="height:18px;width:70px;border-radius:5px;margin:auto;"></div></th>
            </tr>
          </thead>
          <tbody>
            ${skeletonRows}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

window.showInvenSyncFullSkeleton = showInvenSyncFullSkeleton;


function buildInvenSyncDateUrl(dateValue) {
  let url = new URL(window.location.href);
  url.searchParams.set('date', dateValue);
  return url.toString();
}

// Date navigation start =========================================

function changeDate(newDate) {
  if (!newDate) return;
  navigateToInvenSyncDate(newDate);
}

function navigateToInvenSyncDate(newDate) {
  let params = new URLSearchParams(window.location.search);
  params.set('date', newDate);
  let newUrl = `${window.location.pathname}?${params.toString()}`;
  history.pushState({ date: newDate }, '', newUrl);
  loadInvenSyncDetailData();
}

window.addEventListener('popstate', () => loadInvenSyncDetailData());

// Date navigation end ===========================================


function navigateInvenSyncDateOffset(days) {
  let dateInput = document.getElementById('selected_date');
  if (!dateInput || !dateInput.value) return;
  let parts = dateInput.value.split('-');
  if (parts.length !== 3) return;
  let current = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  if (isNaN(current.getTime())) return;
  current.setDate(current.getDate() + days);
  let year = current.getFullYear();
  let month = String(current.getMonth() + 1).padStart(2, '0');
  let day = String(current.getDate()).padStart(2, '0');
  let formatted = `${year}-${month}-${day}`;
  dateInput.value = formatted;
  changeDate(formatted);
}

function preloadAdjacentDates(currentUrl) {
  try {
    let url = new URL(currentUrl, window.location.origin);
    let dateStr = url.searchParams.get('date');
    if (!dateStr) return;
    
    let parts = dateStr.split('-');
    if (parts.length !== 3) return;
    let currDate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
    if (isNaN(currDate.getTime())) return;
    
    let prevDate = new Date(currDate);
    prevDate.setDate(prevDate.getDate() - 1);
    let nextDate = new Date(currDate);
    nextDate.setDate(nextDate.getDate() + 1);

    let prevStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(prevDate.getDate()).padStart(2, '0')}`;
    let nextStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}`;

    let prevUrl = buildInvenSyncDateUrl(prevStr);
    let nextUrl = buildInvenSyncDateUrl(nextStr);

    fetch(prevUrl).catch(() => {});
    fetch(nextUrl).catch(() => {});
  } catch(e) {}
}



function showMissingDatesModal() {
  let modal = document.getElementById('missing-dates-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
}

function hideMissingDatesModal() {
  let modal = document.getElementById('missing-dates-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
}



function updateDateHeaders() {
  let selectedDateStr = document.getElementById('selected_date')?.value;
  if (!selectedDateStr) return;
  
  let baseDate = new Date(selectedDateStr);
  
  // Calculate D+5, D+4, D+3
  let d5 = new Date(baseDate);
  d5.setDate(baseDate.getDate() + 5);
  let d4 = new Date(baseDate);
  d4.setDate(baseDate.getDate() + 4);
  let d3 = new Date(baseDate);
  d3.setDate(baseDate.getDate() + 3);
  
  // Format dates as MM/DD/YYYY
  let formatDate = (date) => {
    return `${date.getMonth() + 1}/${date.getDate()}/${date.getFullYear()}`;
  };
  
  // Update headers
  let headerD5 = document.getElementById('header-d5');
  let headerD4 = document.getElementById('header-d4');
  let headerD3 = document.getElementById('header-d3');
  
  if (headerD5) headerD5.textContent = formatDate(d5);
  if (headerD4) headerD4.textContent = formatDate(d4);
  if (headerD3) headerD3.textContent = formatDate(d3);
}

function isFilledInventoryInput(input) {
  if (!input) return false;
  if (input.type === 'checkbox') return input.checked;
  return String(input.value || '').trim() !== '';
}

function rowNeedsBeginningBeforeInput(row, sourceInput) {
  if (!row || !sourceInput) return false;
  if (sourceInput.classList.contains('beginning-input')) return false;
  if (sourceInput.classList.contains('inv-adjust-only')) return false;
  if (!isFilledInventoryInput(sourceInput)) return false;

  let beginningInput = row.querySelector('.beginning-input');
  if (!beginningInput) return false;

  return String(beginningInput.value || '').trim() === '';
}

function rowHasBlankBeginningWithOtherValues(row) {
  if (!row) return false;

  let beginningInput = row.querySelector('.beginning-input');
  if (!beginningInput) return false;
  if (beginningInput.disabled || beginningInput.readOnly) return false;
  if (String(beginningInput.value || '').trim() !== '') return false;

  let otherInputs = Array.from(row.querySelectorAll('input:not([type="hidden"]), select, textarea'))
    .filter(input => !input.classList.contains('beginning-input'))
    .filter(input => !input.classList.contains('inv-adjust-only'));

  return otherInputs.some(isFilledInventoryInput);
}

function findFirstRowMissingBeginning() {
  return Array.from(document.querySelectorAll('tbody tr[data-product-id]'))
    .find(rowHasBlankBeginningWithOtherValues);
}

function getBeginningGuideInputs() {
  return Array.from(document.querySelectorAll('tbody tr[data-product-id] .beginning-input'))
    .filter(input => !input.disabled && !input.readOnly && input.offsetParent !== null);
}

function getBeginningGuideElements() {
  return getInventoryColumnGuideElements('Beg', 'beginning_qty');
}

function getInventoryColumnGuideElements(headerLabel, dataField) {
  let firstCell = Array.from(document.querySelectorAll(`#main-content tbody tr[data-product-id] td[data-field="${dataField}"]`))
    .find(el => el.offsetParent !== null);
  let columnHeaders = Array.from(document.querySelectorAll('#main-content thead tr:nth-child(3) th'));
  let headerByColumn = firstCell && Number.isInteger(firstCell.cellIndex)
    ? columnHeaders[firstCell.cellIndex]
    : null;
  let header = headerByColumn && headerByColumn.offsetParent !== null
    ? headerByColumn
    : columnHeaders.find(el => el.offsetParent !== null && el.textContent.trim() === headerLabel);
  return [header, firstCell].filter(Boolean);
}

function getProductGuideElements() {
  let header = document.querySelector('#main-content thead tr:nth-child(3) th:first-child');
  let firstCell = Array.from(document.querySelectorAll('#main-content tbody tr[data-product-id] td:first-child'))
    .find(el => el.offsetParent !== null);
  return [header, firstCell].filter(el => el && el.offsetParent !== null);
}

function getElementGroupRect(elements) {
  let visibleElements = elements.filter(el => el && el.offsetParent !== null);
  if (!visibleElements.length) return null;

  let rects = visibleElements.map(el => el.getBoundingClientRect());
  let padding = 10;
  return {
    top: Math.max(0, Math.min(...rects.map(rect => rect.top)) - padding),
    left: Math.max(0, Math.min(...rects.map(rect => rect.left)) - padding),
    right: Math.min(window.innerWidth, Math.max(...rects.map(rect => rect.right)) + padding),
    bottom: Math.min(window.innerHeight, Math.max(...rects.map(rect => rect.bottom)) + padding)
  };
}

function getBeginningGuideStep() {
  let steps = [
    {
      elements: [document.getElementById('inventory-search-guide-target')],
      text: 'Search by product name, code, or price to quickly find an inventory row.',
      placement: 'right',
      nextText: 'Next'
    },
    {
      elements: [document.getElementById('inventory-category-guide-target')],
      text: 'Filter the table by product category when working through a large inventory list.',
      placement: 'bottom',
      nextText: 'Next'
    },
    {
      elements: getProductGuideElements(),
      text: 'Product identifies the item, product code, and selling price used by every quantity and peso calculation in this row.',
      placement: 'right',
      nextText: 'Next'
    },
    {
      elements: getBeginningGuideElements(),
      text: 'Beg is the stock available at the start of the day. On the first setup, enter and save it before other movements; afterward it carries forward from the previous ending inventory.',
      placement: 'right',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('Delivery', 'delivery_qty'),
      text: 'Delivery adds received stock. It is supplied by the Delivery page after the RSO or bulk delivery is reviewed and saved.',
      placement: 'right',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('Trans-In', 'trans_in_qty'),
      text: 'Trans-In adds stock received through a Product Transfer created in the TransAct form and confirmed for this store.',
      placement: 'right',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('BO', 'bo_qty'),
      text: 'BO adds Bulk Order stock quantities linked from reviewed bulk delivery data.',
      placement: 'right',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('Booth Sales', 'adv_del_qty'),
      text: 'Booth Sales records the quantity assigned to booth sales for the product.',
      placement: 'right',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('Trans-Out', 'trans_out_qty'),
      text: 'Trans-Out subtracts stock sent to another location through a TransAct Product Transfer or EGI Plant Transfer.',
      placement: 'left',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('Waste Qty', 'wastage_qty'),
      text: 'Waste Qty subtracts damaged or discarded stock recorded through the TransAct Wastage form.',
      placement: 'left',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('Waste Amt', 'wastage_amount'),
      text: 'Waste Amt is calculated automatically as Waste Qty multiplied by the product selling price.',
      placement: 'left',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('CSI', 'csi_qty'),
      text: 'CSI subtracts stock issued or consumed internally. Enter or review the CSI quantity linked to the store activity.',
      placement: 'left',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('Sold', 'quantity_sold'),
      text: 'Sold subtracts customer sales. POS Sold uploads feed this column after the Excel rows are scanned and reviewed; POS and motif badges show their source.',
      placement: 'left',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('D+5', 'ending_d5_qty'),
      text: 'D+5 is the physical ending count for products with five days of remaining shelf life.',
      placement: 'left',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('D+4', 'ending_d4_qty'),
      text: 'D+4 is the physical ending count for products with four days of remaining shelf life.',
      placement: 'left',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('D+3', 'ending_d3_qty'),
      text: 'D+3 is the physical ending count for products with three days of remaining shelf life.',
      placement: 'left',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('Total Ending Inventory', 'total_ending_qty'),
      text: 'Total Ending Inventory is calculated automatically as D+5 + D+4 + D+3. This is the actual physical stock counted.',
      placement: 'left',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('Total Peso', 'total_peso_srp'),
      text: 'Total Peso converts the actual ending quantity to value: Total Ending Inventory × selling price.',
      placement: 'left',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('Theoretical Ending', 'theo_ending_qty'),
      text: 'Theoretical Ending is the expected stock: Beg + Delivery + Trans-In + BO + Booth Sales − Trans-Out − Waste − CSI − POS Sold.',
      placement: 'left',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('Variance', 'variance_qty'),
      text: 'Variance compares actual with expected stock: Total Ending Inventory − Theoretical Ending. Zero means the count balances.',
      placement: 'left',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('Var Peso', 'variance_peso'),
      text: 'Var Peso shows the financial value of the difference: Variance × selling price.',
      placement: 'left',
      nextText: 'Next'
    },
    {
      elements: getInventoryColumnGuideElements('Remarks', 'remarks'),
      text: 'Use Remarks to explain shortages, overages, adjustments, or any unusual source transaction for the row.',
      placement: 'left',
      nextText: 'Next'
    },
    {
      elements: [document.getElementById('save-inventory-btn')],
      text: isDayFinalized
        ? 'This inventory date is finalized and locked. Review the source badges, ending counts, and variances as a completed record.'
        : (isSavingBeginningInventory
          ? 'Save Beginning locks the initial Beg values. Afterward, the daily movement columns become the working inventory flow.'
          : 'After reviewing Delivery, TransAct movements, Wastage, POS Sold, ending counts, and variances, click End of Day to finalize the date.'),
      placement: 'bottom',
      nextText: "Finish, let's start"
    }
  ];
  let availableSteps = steps.filter(step => step.elements.some(el => el && el.offsetParent !== null));
  return availableSteps[beginningGuideStepIndex] || null;
}

function renderBeginningSpotlight() {
  removeBeginningSpotlightPanels();

  let step = getBeginningGuideStep();
  if (!step) {
    clearBeginningStockGuide();
    return;
  }

  let rect = getElementGroupRect(step.elements);
  if (!rect) return;

  let panels = [
    { top: 0, left: 0, width: window.innerWidth, height: rect.top },
    { top: rect.bottom, left: 0, width: window.innerWidth, height: window.innerHeight - rect.bottom },
    { top: rect.top, left: 0, width: rect.left, height: rect.bottom - rect.top },
    { top: rect.top, left: rect.right, width: window.innerWidth - rect.right, height: rect.bottom - rect.top }
  ];

  panels.forEach(panel => {
    let el = document.createElement('div');
    el.className = 'beginning-spotlight-panel';
    el.style.top = `${panel.top}px`;
    el.style.left = `${panel.left}px`;
    el.style.width = `${Math.max(0, panel.width)}px`;
    el.style.height = `${Math.max(0, panel.height)}px`;
    document.body.appendChild(el);
  });

  let label = document.createElement('div');
  label.className = 'beginning-spotlight-label';
  let message = document.createElement('div');
  message.textContent = step.text;
  let nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.textContent = step.nextText;
  nextButton.addEventListener('click', nextBeginningStockGuideStep);
  label.appendChild(message);
  label.appendChild(nextButton);
  if (step.placement === 'bottom') {
    label.style.left = `${Math.max(16, Math.min(rect.left, window.innerWidth - 376))}px`;
    label.style.top = `${Math.min(window.innerHeight - 120, rect.bottom + 18)}px`;
  } else if (step.placement === 'left') {
    label.style.left = `${Math.max(16, rect.left - 380)}px`;
    label.style.top = `${Math.max(24, rect.top)}px`;
  } else {
    let labelLeft = rect.right + 24;
    let hasRightSpace = labelLeft + 320 <= window.innerWidth;
    label.style.left = `${hasRightSpace ? labelLeft : Math.max(16, rect.left - 340)}px`;
    label.style.top = `${Math.max(24, rect.top + Math.min(96, Math.max(0, (rect.bottom - rect.top) / 3)))}px`;
  }
  document.body.appendChild(label);
}

function removeBeginningSpotlightPanels() {
  document.querySelectorAll('.beginning-spotlight-panel').forEach(panel => panel.remove());
  document.querySelectorAll('.beginning-spotlight-label').forEach(label => label.remove());
}

function clearBeginningStockGuide() {
  beginningGuideActive = false;
  beginningGuideStepIndex = 0;
  if (beginningGuideRenderTimer) {
    window.clearTimeout(beginningGuideRenderTimer);
    beginningGuideRenderTimer = null;
  }
  if (beginningGuideScrollRenderTimer) {
    window.clearTimeout(beginningGuideScrollRenderTimer);
    beginningGuideScrollRenderTimer = null;
  }
  removeBeginningSpotlightPanels();
  document.querySelectorAll('.beginning-spotlight-target').forEach(el => {
    el.classList.remove('beginning-spotlight-target');
  });
}

function applyBeginningGuideTarget() {
  document.querySelectorAll('.beginning-spotlight-target').forEach(el => {
    el.classList.remove('beginning-spotlight-target');
  });

  let step = getBeginningGuideStep();
  if (!step) return;

  step.elements.forEach(el => {
    if (el) el.classList.add('beginning-spotlight-target');
  });
}

function showBeginningStockGuideStep() {
  let step = getBeginningGuideStep();
  if (!step) {
    clearBeginningStockGuide();
    return;
  }

  let target = step.elements.find(el => el && el.offsetParent !== null);
  if (target) {
    let isColumnHeader = target.matches('thead th');
    target.scrollIntoView({
      behavior: 'smooth',
      block: isColumnHeader ? 'nearest' : 'center',
      inline: 'center'
    });
  }

  removeBeginningSpotlightPanels();
  if (beginningGuideRenderTimer) window.clearTimeout(beginningGuideRenderTimer);
  beginningGuideRenderTimer = window.setTimeout(() => {
    beginningGuideRenderTimer = null;
    if (!beginningGuideActive) return;
    applyBeginningGuideTarget();
    renderBeginningSpotlight();
  }, 450);
}

function nextBeginningStockGuideStep() {
  removeBeginningSpotlightPanels();
  beginningGuideStepIndex += 1;
  if (!getBeginningGuideStep()) {
    localStorage.setItem(beginningGuideCompletionKey, '1');
    clearBeginningStockGuide();
    return;
  }
  showBeginningStockGuideStep();
}

function startBeginningStockGuide(force = false) {
  let modal = document.getElementById('first-time-modal');
  if (modal) modal.remove();

  let inputs = getBeginningGuideInputs();
  let firstInput = inputs[0];
  if (!firstInput && !force) return;

  clearBeginningStockGuide();
  beginningGuideActive = true;
  beginningGuideStepIndex = 0;
  showBeginningStockGuideStep();
}

if (!isInvenSyncGuideMode && localStorage.getItem(beginningGuideCompletionKey) === '1') {
  document.getElementById('first-time-modal')?.remove();
}

function showMissingBeginningPopup(row, options = {}) {
  if (missingBeginningNoticeOpen) return;

  let { showToastOnly = false } = options;
  let beginningInput = row?.querySelector('.beginning-input');
  let canFocusBeginning = beginningInput && !beginningInput.disabled && !beginningInput.readOnly;
  let focusBeginningInput = () => {
    missingBeginningNoticeOpen = false;
    if (canFocusBeginning) {
      beginningInput.focus();
      if (typeof beginningInput.select === 'function') {
        beginningInput.select();
      }
    }
  };

  missingBeginningNoticeOpen = true;
  if (!showToastOnly && typeof showConfirmationModal === 'function') {
    showConfirmationModal({
      title: 'Beginning Stock Required',
      message: 'Please enter the Beg column first before adding other inventory values.',
      confirmText: canFocusBeginning ? 'Enter Beg' : 'Close',
      cancelText: 'Close',
      onConfirm: focusBeginningInput,
      onCancel: focusBeginningInput
    });
    return;
  }

  notify('Please enter the Beg column first.', 'warning');
  setTimeout(() => {
    missingBeginningNoticeOpen = false;
    if (canFocusBeginning) focusBeginningInput();
  }, 250);
}

function refreshBeginningSaveMode() {
  if (isDayFinalized) {
    setInventorySaveButtons({
      text: hasAdminStoreUnlock ? 'Save' : 'Finalized',
      disabled: !hasAdminStoreUnlock
    });
    return;
  }

  if (isBeginningFinalized) {
    isSavingBeginningInventory = false;
  }

  isSavingBeginningInventory = !isBeginningFinalized && requiresBeginningStockFirst;

  setInventorySaveButtons({ text: isSavingBeginningInventory ? 'Save Beginning' : 'End of Day' });
}

function fillBlankBeginningInputsWithZero() {
  document.querySelectorAll('tbody tr[data-product-id] .beginning-input').forEach(input => {
    if (String(input.value || '').trim() === '') {
      input.value = '0';
      updateInventoryRow(input);
    }
  });
}

function lockBeginningInputs() {
  document.querySelectorAll('tbody tr[data-product-id] .beginning-input').forEach(input => {
    input.readOnly = true;
    input.classList.add('readonly', 'cursor-not-allowed', 'opacity-75');
  });
}

function lockDayInputs() {
  document.querySelectorAll('tbody tr[data-product-id] input:not([type="hidden"]):not(.inv-adjust-only), tbody tr[data-product-id] textarea:not(.inv-adjust-only)').forEach(input => {
    if (input.type === 'checkbox') {
      input.disabled = true;
    } else {
      input.readOnly = true;
    }
    input.classList.add('readonly', 'cursor-not-allowed', 'opacity-75');
  });

  document.querySelectorAll('tbody tr[data-product-id] select:not(.inv-adjust-only)').forEach(select => {
    select.disabled = true;
    select.classList.add('cursor-not-allowed', 'opacity-75');
  });

  setInventorySaveButtons({ text: 'Finalized', disabled: true });
}

function updateInventoryRow(input) {
  let row = input.closest('tr');
  if (rowNeedsBeginningBeforeInput(row, input)) {
    showMissingBeginningPopup(row);
  }

  let beginningInput = row.querySelector('.beginning-input');
  let beginning = beginningInput ? parseFloat(beginningInput.value) || 0 : parseFloat(row.querySelector('.beginning-qty').textContent) || 0;
  let delivery = parseFloat(row.querySelector('.delivery-input').value) || 0;
  let transIn = parseFloat(row.querySelector('.trans-in-input').value) || 0;
  let bo = parseFloat(row.querySelector('.bo-input').value) || 0;
  let advDel = parseFloat(row.querySelector('.adv-del-input').value) || 0;
  let transOut = parseFloat(row.querySelector('.trans-out-input').value) || 0;
  let wastage = parseFloat(row.querySelector('.wastage-input').value) || 0;
  let csi = parseFloat(row.querySelector('.csi-input').value) || 0;
  let sold = parseFloat(row.querySelector('.sold-input').value) || 0;
  let endingD5 = parseFloat(row.querySelector('.ending-d5-input').value) || 0;
  let endingD4 = parseFloat(row.querySelector('.ending-d4-input').value) || 0;
  let endingD3 = parseFloat(row.querySelector('.ending-d3-input').value) || 0;
  let srpPrice = parseFloat(row.querySelector('.srp-price').value) || 0;
  
  // Calculate values
  let totalEnding = endingD5 + endingD4 + endingD3;
  let totalPeso = totalEnding * srpPrice;
  let theoEnding = beginning + delivery + transIn + bo + advDel - transOut - wastage - csi - sold;
  let wastageAmount = wastage * srpPrice;

  // Update display
  row.querySelector('.total-ending').textContent = totalEnding;
  row.querySelector('.total-peso').textContent = totalPeso.toFixed(2);
  row.querySelector('.theo-ending').textContent = theoEnding;
  row.querySelector('.wastage-amount').textContent = wastageAmount.toFixed(2);

  // Re-apply variance cells (includes swap adjustments, if any)
  refreshVarianceDisplays();
}

// Compute a row's base variance. Prefers the displayed cells (kept in sync
// with inputs by updateInventoryRow) so swap adjustments act on what staff
// actually see; falls back to recomputing from inputs when the cells are
// hidden or the row lives in the fullscreen clone (stale cells there).
function computeRowVariance(row) {
  let inFullscreen = !!(row.closest && row.closest('#fullscreen-modal'));
  let totalCell = row.querySelector('.total-ending');
  let theoCell = row.querySelector('.theo-ending');
  let totalText = totalCell ? String(totalCell.textContent || '').trim() : '';
  let theoText = theoCell ? String(theoCell.textContent || '').trim() : '';
  let totalEnding;
  let theoEnding;
  if (!inFullscreen && totalText && theoText) {
    totalEnding = parseFloat(totalText) || 0;
    theoEnding = parseFloat(theoText) || 0;
  } else {
    let beginningInput = row.querySelector('.beginning-input');
    let beginning = beginningInput ? parseFloat(beginningInput.value) || 0 : parseFloat(row.querySelector('.beginning-qty').textContent) || 0;
    let delivery = parseFloat(row.querySelector('.delivery-input').value) || 0;
    let transIn = parseFloat(row.querySelector('.trans-in-input').value) || 0;
    let bo = parseFloat(row.querySelector('.bo-input').value) || 0;
    let advDel = parseFloat(row.querySelector('.adv-del-input').value) || 0;
    let transOut = parseFloat(row.querySelector('.trans-out-input').value) || 0;
    let wastage = parseFloat(row.querySelector('.wastage-input').value) || 0;
    let csi = parseFloat(row.querySelector('.csi-input').value) || 0;
    let sold = parseFloat(row.querySelector('.sold-input').value) || 0;
    let endingD5 = parseFloat(row.querySelector('.ending-d5-input').value) || 0;
    let endingD4 = parseFloat(row.querySelector('.ending-d4-input').value) || 0;
    let endingD3 = parseFloat(row.querySelector('.ending-d3-input').value) || 0;
    totalEnding = endingD5 + endingD4 + endingD3;
    theoEnding = beginning + delivery + transIn + bo + advDel - transOut - wastage - csi - sold;
  }
  let srp = parseFloat(row.querySelector('.srp-price').value) || 0;
  return {
    baseVariance: totalEnding - theoEnding,
    theoEnding: theoEnding,
    srp: srp
  };
}

// Return the swap-out qty for a row when it has an active Swapping adjustment
// on a same-price product (type=Swapping, qty>0, valid different product,
// selected product price matches the row product's price).
function getActiveSwap(row) {
  if (!row) return 0;
  if (row.dataset.autoLinked === '1') return 0;
  let typeSel = row.querySelector('.adjust-type');
  if (!typeSel || String(typeSel.value).trim() !== 'Swapping') return 0;
  let hidden = row.querySelector('input[type="hidden"].adjust-product');
  let selId = hidden ? String(hidden.value || '') : '';
  let rowProductId = String(row.dataset.productId || '');
  if (!selId || selId === rowProductId) return 0;
  let qty = parseInt(row.querySelector('.adjust-qty')?.value, 10) || 0;
  if (qty <= 0) return 0;

  let pool = (typeof adjProductOptions !== 'undefined' && adjProductOptions.length)
    ? adjProductOptions
    : (typeof motifProductOptions !== 'undefined' ? motifProductOptions : []);
  let rowProduct = pool.find(p => String(p.id) === rowProductId);
  let targetCents = rowProduct ? Math.round(parseFloat(rowProduct.price || rowProduct.price_p || 0) * 100) : 0;
  if (!targetCents) {
    let srpEl = row.querySelector('.srp-price');
    targetCents = Math.round((parseFloat(srpEl ? srpEl.value : '') || 0) * 100);
  }
  if (!targetCents) return 0;
  let sel = pool.find(p => String(p.id) === selId);
  if (!sel) return 0;
  let selPriceCents = Math.round(parseFloat(sel.price || sel.price_p || 0) * 100);
  if (selPriceCents !== targetCents) return 0;
  return qty;
}

// Re-render every row's Variance / Var Peso cells. Rows with an active
// Swapping adjustment show variance minus the swap qty; the same-price
// product row they point to shows variance plus the swap qty.
function refreshVarianceDisplays() {
  let rows = Array.from(document.querySelectorAll('tbody tr[data-product-id]'));
  if (!rows.length) return;
  let base = {};
  let swapsOut = {};
  let swapsIn = {};
  rows.forEach(row => {
    let id = String(row.dataset.productId || '');
    if (!id) return;
    base[id] = computeRowVariance(row);
    let qty = getActiveSwap(row);
    if (qty > 0) {
      swapsOut[id] = qty;
      let selId = String(row.querySelector('input[type="hidden"].adjust-product')?.value || '');
      if (selId && selId !== id) {
        swapsIn[selId] = (swapsIn[selId] || 0) + qty;
      }
    }
  });
  rows.forEach(row => {
    let id = String(row.dataset.productId || '');
    let data = base[id];
    if (!data) return;
    let displayVariance = data.baseVariance + (swapsIn[id] || 0) - (swapsOut[id] || 0);
    let displayPeso = displayVariance * data.srp;
    row.querySelector('.variance').textContent = displayVariance;
    row.querySelector('.variance-peso').textContent = displayPeso.toFixed(2);
    updateCellColors(row, data.theoEnding, displayVariance, displayPeso);
  });
}

// ==== Auto-link reciprocal Swapping adjustments ====
function getAdjProductPool() {
  return (typeof adjProductOptions !== 'undefined' && adjProductOptions.length)
    ? adjProductOptions
    : (typeof motifProductOptions !== 'undefined' ? motifProductOptions : []);
}

function readAdjustment(row) {
  let typeSel = row.querySelector('.adjust-type');
  let hidden = row.querySelector('input[type="hidden"].adjust-product');
  let qtyInput = row.querySelector('.adjust-qty');
  return {
    type: typeSel ? String(typeSel.value || '') : '',
    productId: hidden ? String(hidden.value || '') : '',
    qty: qtyInput ? String(qtyInput.value || '') : ''
  };
}

function writeAdjustment(row, adj) {
  let typeSel = row.querySelector('.adjust-type');
  let hidden = row.querySelector('input[type="hidden"].adjust-product');
  let visible = row.querySelector('.adjust-product-input');
  let qtyInput = row.querySelector('.adjust-qty');
  if (typeSel) typeSel.value = adj.type;
  if (visible) {
    let product = adj.productId
      ? getAdjProductPool().find(p => String(p.id) === String(adj.productId))
      : null;
    visible.value = product ? product.description : '';
  }
  if (hidden) hidden.value = adj.productId || '';
  if (qtyInput) qtyInput.value = (adj.qty === undefined || adj.qty === null || adj.qty === '') ? '' : String(adj.qty);
  if (typeSel) syncAdjustmentChargesCell(row);
}

function lockAdjustmentRow(row, sourceId) {
  if (row.dataset.autoLinked === '1' && row.dataset.autoLinkSource === String(sourceId)) return;
  row.dataset.autoLinked = '1';
  row.dataset.autoLinkSource = String(sourceId);
  row.querySelectorAll('.inv-adjust-only').forEach(field => {
    if (field.type === 'hidden') return;
    if (field.tagName === 'SELECT') {
      field.disabled = true;
    } else {
      field.readOnly = true;
    }
    field.classList.add('cursor-not-allowed', 'opacity-75');
  });
  let badge = row.querySelector('.auto-link-badge');
  if (!badge) {
    badge = document.createElement('span');
    badge.className = 'auto-link-badge';
    badge.style.cssText = 'display:inline-block;margin-left:3px;padding:0 3px;border-radius:4px;background:#ede9fe;color:#6d28d9;font-size:7px;font-weight:700;line-height:1.4;vertical-align:middle;white-space:nowrap;';
    let typeCell = row.querySelector('td[data-adjust="type"]');
    if (typeCell) typeCell.appendChild(badge);
  }
  let source = getAdjProductPool().find(p => String(p.id) === String(sourceId));
  badge.textContent = 'Auto';
  badge.title = 'Auto-linked from ' + (source ? source.description : 'another product') + ' - edit from that row';
  syncAdjustmentChargesHeader();
}

function unlockAdjustmentRow(row) {
  if (row.dataset.autoLinked !== '1') return;
  delete row.dataset.autoLinked;
  delete row.dataset.autoLinkSource;
  row.querySelectorAll('.inv-adjust-only').forEach(field => {
    if (field.type === 'hidden') return;
    field.disabled = false;
    field.readOnly = false;
    field.classList.remove('cursor-not-allowed', 'opacity-75');
  });
  let badge = row.querySelector('.auto-link-badge');
  if (badge) badge.remove();
  syncAdjustmentChargesHeader();
}

// Keep reciprocal swap pairs in sync: when a row has an active Swapping
// adjustment on another same-price product, that target row is auto-filled
// with the reciprocal swap and hard-locked (if still empty or already the
// same pair). Auto-filled rows are cleared and unlocked once the source swap
// is changed or removed.
function syncAllSwapPairs(notify) {
  let rows = Array.from(document.querySelectorAll('tbody tr[data-product-id]'));
  if (!rows.length) return;
  let byId = {};
  rows.forEach(row => {
    let id = String(row.dataset.productId || '');
    if (id) byId[id] = row;
  });

  let active = {};
  rows.forEach(row => {
    let id = String(row.dataset.productId || '');
    if (!id) return;
    let qty = getActiveSwap(row);
    if (qty > 0) {
      let selId = String(row.querySelector('input[type="hidden"].adjust-product')?.value || '');
      if (selId && selId !== id) active[id] = { targetId: selId, qty };
    }
  });

  Object.keys(active).forEach(sourceId => {
    let swap = active[sourceId];
    let targetRow = byId[swap.targetId];
    if (!targetRow) return;
    let current = readAdjustment(targetRow);
    let isEmpty = !current.type && !current.productId && !current.qty;
    let isSamePair = current.type === 'Swapping' && current.productId === sourceId;
    if (isEmpty || isSamePair) {
      let targetVar = computeRowVariance(targetRow).baseVariance;
      let covered = targetVar + swap.qty >= 0;
      writeAdjustment(targetRow, { type: 'Swapping', productId: sourceId, qty: covered ? 0 : swap.qty });
      lockAdjustmentRow(targetRow, sourceId);
    } else if (notify && typeof notify === 'function') {
      let targetProduct = getAdjProductPool().find(p => String(p.id) === swap.targetId);
      notify((targetProduct ? targetProduct.description : 'The selected product') + ' already has an adjustment - swap was not auto-linked (variance still adjusts).', 'info');
    }
  });

  rows.forEach(row => {
    if (row.dataset.autoLinked !== '1') return;
    let rowId = String(row.dataset.productId || '');
    let sourceId = row.dataset.autoLinkSource || '';
    let srcSwap = active[sourceId];
    let stillLinked = srcSwap && srcSwap.targetId === rowId;
    if (!stillLinked) {
      writeAdjustment(row, { type: '', productId: '', qty: '' });
      unlockAdjustmentRow(row);
    }
  });
}

// Apply color coding to cells based on values
function updateCellColors(row, theoValue, varValue, varPesoValue) {
  let theoCell = row.querySelector('.theo-ending');
  let varCell = row.querySelector('.variance');
  let varPesoCell = row.querySelector('.variance-peso');
  
  // Helper function to apply color based on value
  let applyCellColor = (cell, value) => {
    // Remove existing color classes
    cell.classList.remove('bg-green-100', 'text-green-800', 'bg-violet-100', 'text-violet-800', 'bg-red-100', 'text-red-800');
    
    if (value === 0) {
      // Green for zero
      cell.classList.add('bg-green-100', 'text-green-800');
    } else if (value >= 1) {
      // Purple for values >= 1
      cell.classList.add('bg-violet-100', 'text-violet-800');
    } else if (value < 0) {
      // Red for negative values
      cell.classList.add('bg-red-100', 'text-red-800');
    }
  };
  
  // Apply colors to var and var peso cells only (theo is always green)
  applyCellColor(varCell, varValue);
  applyCellColor(varPesoCell, varPesoValue);
}

// Apply color coding on page load
function applyColorCodingOnLoad() {
  let rows = document.querySelectorAll('tbody tr[data-product-id]');
  rows.forEach(row => {
    let varValue = parseFloat(row.querySelector('.variance')?.textContent) || 0;
    let varPesoValue = parseFloat(row.querySelector('.variance-peso')?.textContent) || 0;
    updateCellColors(row, 0, varValue, varPesoValue);
  });
}

function getInventoryEditableFields() {
  return Array.from(document.querySelectorAll('tbody tr[data-product-id] input:not([type="hidden"]), tbody tr[data-product-id] select, tbody tr[data-product-id] textarea'))
    .filter(field => !field.disabled && !field.readOnly && !field.closest('#fullscreen-modal') && !field.classList.contains('inv-adjust-only'));
}

function getInventoryFieldName(field) {
  return field.classList && field.classList.length ? field.classList[0] : field.name || '';
}

function buildInventorySnapshot() {
  return JSON.stringify(getInventoryEditableFields().map(field => ({
    row: field.closest('tr')?.dataset.productId || '',
    name: getInventoryFieldName(field),
    value: field.type === 'checkbox' ? field.checked : (field.type === 'number' ? String(parseFloat(field.value) || 0) : String(field.value || ''))
  })));
}

function setSaveButtonEnabled(enabled) {
  setInventorySaveButtons({ disabled: (isDayFinalized && !hasAdminStoreUnlock) || !enabled });
  refreshBeginningSaveMode();
}

function refreshSaveButtonState() {
  if (!inventoryInitialSnapshot) {
    setSaveButtonEnabled(false);
    return;
  }
  setSaveButtonEnabled(buildInventorySnapshot() !== inventoryInitialSnapshot);
}

function captureInventorySnapshot() {
  inventoryInitialSnapshot = buildInventorySnapshot();
  setSaveButtonEnabled(false);
}

function saveInventoryDraft() {
  try {
    let draft = getInventoryEditableFields().map(field => ({
      row: field.closest('tr')?.dataset.productId || '',
      name: getInventoryFieldName(field),
      value: field.type === 'checkbox' ? field.checked : field.value
    }));
    localStorage.setItem(inventoryDraftKey, JSON.stringify(draft));
  } catch (error) {
    console.warn('Could not save inventory draft:', error);
  }
}

function restoreInventoryDraft() {
  let draft = null;
  try {
    draft = JSON.parse(localStorage.getItem(inventoryDraftKey) || 'null');
  } catch (error) {
    console.warn('Could not read inventory draft:', error);
  }
  if (!Array.isArray(draft) || !draft.length) return;

  let touchedRows = new Set();
  draft.forEach(item => {
    let row = document.querySelector(`tbody tr[data-product-id="${item.row}"]`);
    if (!row) return;
    let field = row.querySelector(`.${item.name}`);
    if (!field || field.disabled || field.readOnly) return;
    if (field.type === 'checkbox') {
      field.checked = Boolean(item.value);
    } else {
      field.value = item.value;
    }
    touchedRows.add(row);
  });

  touchedRows.forEach(row => {
    let firstInput = row.querySelector('input:not([type="hidden"])');
    if (firstInput) updateInventoryRow(firstInput);
  });
  refreshSaveButtonState();
}

function clearInventoryDraft() {
  try {
    localStorage.removeItem(inventoryDraftKey);
  } catch (error) {
    console.warn('Could not clear inventory draft:', error);
  }
}

// ==== Inventory Adjustments (Inventory Staff only) ====
let isInventoryAdjustmentsEditable;
let invAdjustmentsSaveUrl;
let adjustmentsInitialSnapshot = '';

function getAdjustmentEditableFields() {
  return Array.from(document.querySelectorAll('#main-content tbody tr[data-product-id] .inv-adjust-only'))
    .filter(field => !field.disabled && !field.readOnly && field.type !== 'hidden');
}

function getAdjustmentFieldName(field) {
  if (field.classList.contains('adjust-type')) return 'type';
  if (field.classList.contains('adjust-product-input')) return 'product';
  if (field.classList.contains('adjust-qty')) return 'qty';
  return 'charges';
}

// ==== Adjust-Product Combobox ====
(function () {
  // One shared dropdown appended to body
  let DROP = document.createElement('div');
  DROP.id = 'adj-product-drop';
  DROP.style.cssText = 'position:fixed;z-index:99999;background:#fff;border:1px solid #e2e8f0;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.12);max-height:220px;overflow-y:auto;display:none;';
  document.body.appendChild(DROP);

  let activeInput = null;

  function getProducts() {
    return (typeof adjProductOptions !== 'undefined' && adjProductOptions.length)
      ? adjProductOptions
      : (typeof motifProductOptions !== 'undefined' ? motifProductOptions : []);
  }

  function getHidden(input) {
    return input?.closest('.adjust-product-wrap')?.querySelector('input[type="hidden"].adjust-product');
  }

  function position(input) {
    let r = input.getBoundingClientRect();
    DROP.style.left  = r.left + 'px';
    DROP.style.top   = (r.bottom + 4) + 'px';
    DROP.style.width = Math.max(r.width, 220) + 'px';
  }

  // For Swapping rows, only suggest products priced the same as the row's product.
  function getRowProductPool(input) {
    let pool = getProducts();
    let row = input ? input.closest('tr[data-product-id]') : null;
    if (!row) return pool;
    let typeSel = row.querySelector('.adjust-type');
    let isSwapping = typeSel && String(typeSel.value).trim() === 'Swapping';
    if (!isSwapping) return pool;
    // Use the row product's CURRENT price (same source as the suggestions) so a stale
    // stored SRP never makes the filter compare against the wrong price.
    let rowProduct = pool.find(p => String(p.id) === String(row.dataset.productId || ''));
    let targetCents = rowProduct ? Math.round(parseFloat(rowProduct.price || rowProduct.price_p || 0) * 100) : 0;
    if (!targetCents) {
      let srpEl = row.querySelector('.srp-price');
      targetCents = Math.round((parseFloat(srpEl ? srpEl.value : '') || 0) * 100);
    }
    if (targetCents > 0) {
      pool = pool.filter(p => Math.round(parseFloat(p.price || p.price_p || 0) * 100) === targetCents);
    }
    return pool;
  }

  function render(input) {
    activeInput = input;
    let q = (input.value || '').trim().toLowerCase();
    let list = getRowProductPool(input).filter(p =>
      !q ||
      String(p.description || '').toLowerCase().includes(q) ||
      String(p.code || '').toLowerCase().includes(q)
    ).slice(0, 60);

    DROP.innerHTML = '';
    if (!list.length) {
      let d = document.createElement('div');
      d.style.cssText = 'padding:8px 12px;font-size:13px;color:#94a3b8;font-style:italic;';
      d.textContent = 'No product found';
      DROP.appendChild(d);
    } else {
      list.forEach(function (p) {
        let row = document.createElement('div');
        row.style.cssText = 'padding:7px 12px;cursor:pointer;';
        row.onmouseenter = function () { row.style.background = '#f5f3ff'; };
        row.onmouseleave = function () { row.style.background = ''; };
        let name = document.createElement('div');
        name.style.cssText = 'font-size:13px;font-weight:600;color:#1e293b;';
        name.textContent = p.description || '';
        row.appendChild(name);
        if (p.code) {
          let code = document.createElement('div');
          code.style.cssText = 'font-size:11px;color:#94a3b8;margin-top:1px;';
          code.textContent = p.code;
          row.appendChild(code);
        }
        row.addEventListener('mousedown', function (e) {
          e.preventDefault();
          input.value = p.description || '';
          let hidden = getHidden(input);
          if (hidden) {
            hidden.value = p.id;
            hidden.dispatchEvent(new Event('change', { bubbles: true }));
          }
          input.classList.remove('border-red-300');
          DROP.style.display = 'none';
          activeInput = null;
          refreshAdjustmentsSaveButton();
        });
        DROP.appendChild(row);
      });
    }

    position(input);
    DROP.style.display = 'block';
  }

  function hide() {
    DROP.style.display = 'none';
    activeInput = null;
  }

  // Wire up every .adjust-product-input (handles rows rendered at page load)
  function bindInputs() {
    document.querySelectorAll('.adjust-product-input').forEach(function (input) {
      if (input.dataset.adjBound) return;
      input.dataset.adjBound = '1';

      input.addEventListener('input', function () { render(input); });
      input.addEventListener('focus', function () { render(input); });
      input.addEventListener('blur', function () {
        setTimeout(function () {
          hide();
          // If typed text doesn't exactly match, clear
          let q = (input.value || '').trim().toLowerCase();
          let exact = getRowProductPool(input).find(p => String(p.description || '').toLowerCase() === q);
          if (!exact && input.value.trim()) {
            input.value = '';
            input.classList.remove('border-red-300');
            let hidden = getHidden(input);
            if (hidden) {
              hidden.value = '';
              hidden.dispatchEvent(new Event('change', { bubbles: true }));
            }
            refreshAdjustmentsSaveButton();
          }
        }, 200);
      });
    });
  }

  // Close on outside click
  document.addEventListener('mousedown', function (e) {
    if (activeInput && !DROP.contains(e.target) && e.target !== activeInput) {
      hide();
    }
  });

  // Reposition on scroll/resize
  window.addEventListener('scroll', function () {
    if (activeInput && DROP.style.display !== 'none') position(activeInput);
  }, true);
  window.addEventListener('resize', function () {
    if (activeInput && DROP.style.display !== 'none') position(activeInput);
  });

  // Allow dynamic rebinding (e.g. fullscreen modal clones the table after load)
  window.bindAdjustProductCombobox = bindInputs;

  // Re-render the open dropdown for the active input (used when Type changes)
  window.refreshAdjustProductDropdown = function () {
    if (activeInput && DROP.style.display !== 'none') render(activeInput);
  };

  // When a row switches to Swapping, clear a selected product whose price
  // doesn't match the row product's current price (it can't be picked from the filtered list).
  window.clearMismatchedSwappingSelection = function (row) {
    if (!row) return;
    let hidden = row.querySelector('input[type="hidden"].adjust-product');
    let visible = row.querySelector('.adjust-product-input');
    let rowProduct = getProducts().find(p => String(p.id) === String(row.dataset.productId || ''));
    let srpEl = row.querySelector('.srp-price');
    let target = rowProduct
      ? Math.round(parseFloat(rowProduct.price || rowProduct.price_p || 0) * 100)
      : Math.round((parseFloat(srpEl ? srpEl.value : '') || 0) * 100);
    let selId = hidden ? String(hidden.value || '') : '';
    if (!selId || !target) return;
    let sel = getProducts().find(p => String(p.id) === selId);
    let selPrice = Math.round(parseFloat(sel ? (sel.price || sel.price_p || 0) : 0) * 100);
    if (sel && selPrice !== target) {
      if (visible) visible.value = '';
      if (hidden) {
        hidden.value = '';
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  };

  // When a row switches away from Swapping (blank / OFFSET / Variance), the
  // product and quantity columns must be cleared - they only apply to Swapping.
  window.clearAdjustmentForNonSwap = function (row) {
    if (!row) return;
    let typeSel = row.querySelector('.adjust-type');
    if (!typeSel || String(typeSel.value).trim() === 'Swapping') return;
    let hidden = row.querySelector('input[type="hidden"].adjust-product');
    let visible = row.querySelector('.adjust-product-input');
    let qtyInput = row.querySelector('.adjust-qty');
    let hasProduct = (hidden && String(hidden.value || '') !== '')
      || (visible && String(visible.value || '').trim() !== '');
    let hasQty = qtyInput && String(qtyInput.value || '').trim() !== '';
    if (hasProduct) {
      if (visible) visible.value = '';
      if (hidden) {
        hidden.value = '';
        hidden.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    if (hasQty) {
      qtyInput.value = '';
      qtyInput.dispatchEvent(new Event('change', { bubbles: true }));
    }
  };

})();

function buildAdjustmentsSnapshot() {
  return JSON.stringify(getAdjustmentEditableFields().map(field => ({
    row: field.closest('tr')?.dataset.productId || '',
    name: getAdjustmentFieldName(field),
    value: String(field.value || '')
  })));
}

function refreshAdjustmentsSaveButton() {
  let btn = document.getElementById('save-adjustments-btn');
  if (!btn) return;
  btn.disabled = !adjustmentsInitialSnapshot || (buildAdjustmentsSnapshot() === adjustmentsInitialSnapshot);
}

function captureAdjustmentsSnapshot() {
  adjustmentsInitialSnapshot = buildAdjustmentsSnapshot();
  refreshAdjustmentsSaveButton();
}

function syncAdjustmentChargesCell(row) {
  let typeSelect = row.querySelector('.adjust-type');
  let chargesCell = row.querySelector('td[data-adjust="charges"]');
  if (!typeSelect || !chargesCell) return;
  chargesCell.classList.toggle('hidden', typeSelect.value !== 'Variance');
  syncAdjustmentChargesHeader();
}

function syncAdjustmentChargesHeader() {
  let header = document.getElementById('header-adjust-charges');
  if (!header) return;
  let anyVariance = Array.from(document.querySelectorAll('#main-content tbody tr[data-product-id] .adjust-type'))
    .some(sel => sel.value === 'Variance');
  header.classList.toggle('hidden', !anyVariance);
}

document.addEventListener('change', function(event) {
  if (!event.target.classList || !event.target.classList.contains('inv-adjust-only')) return;
  let row = event.target.closest('tr[data-product-id]');
  if (row && event.target.classList.contains('adjust-type')) {
    syncAdjustmentChargesCell(row);
    if (event.target.value === 'Swapping' && typeof window.clearMismatchedSwappingSelection === 'function') {
      window.clearMismatchedSwappingSelection(row);
    } else if (typeof window.clearAdjustmentForNonSwap === 'function') {
      window.clearAdjustmentForNonSwap(row);
    }
    // If this row's product dropdown is open, filter to same-price products when Swapping.
    if (typeof window.refreshAdjustProductDropdown === 'function') {
      window.refreshAdjustProductDropdown();
    }
  }
  syncAllSwapPairs(true);
  refreshVarianceDisplays();
  refreshAdjustmentsSaveButton();
}, true);



function saveAdjustments() {
  if (!isInventoryAdjustmentsEditable) return;
  let button = document.getElementById('save-adjustments-btn');
  if (button && button.disabled) return;

  let items = [];
  document.querySelectorAll('#main-content tbody tr[data-product-id]').forEach(row => {
    let itemId = row.querySelector('.inv-item-id')?.value;
    if (!itemId) return;
    items.push({
      item_id: itemId,
      adjustment_type: row.querySelector('.adjust-type')?.value || '',
      adjustment_product_master_id: row.querySelector('.adjust-product')?.value || '',
      adjustment_qty: parseInt(row.querySelector('.adjust-qty')?.value, 10) || 0,
      adjustment_charges: row.querySelector('.adjust-charges')?.value || ''
    });
  });

  if (button) button.disabled = true;
  fetch(invAdjustmentsSaveUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ inventory_id: inventoryId, items })
  })
  .then(async response => {
    let data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.message || 'Unable to save adjustments.');
    notify(data.message, 'success');
    captureAdjustmentsSnapshot();
    return data;
  })
  .catch(error => {
    notify(error.message || 'Error saving adjustments', 'error');
    refreshAdjustmentsSaveButton();
  });
}

function clearConsumedAdminStoreUnlock() {
  if (!hasAdminStoreUnlock) return Promise.resolve();
  return fetch('/admin/invensync/unlock-scope', {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({
      inventory_id: inventoryId,
      action: 'lock',
      scope: 'all'
    })
  })
  .catch(error => {
    console.warn('Could not clear consumed admin unlock:', error);
  });
}

function finalizeAdminUnlockedViewAfterSave() {
  hasAdminStoreUnlock = false;
  lockDayInputs();
  setInventorySaveButtons({ text: 'Finalized', disabled: true });
}

function saveAll() {
  let button = document.getElementById('save-inventory-btn');
  if (isDayFinalized && !hasAdminStoreUnlock) {
    notify('This inventory day is finalized and locked.', 'info');
    return;
  }
  if (button && button.disabled) return;

  let missingBeginningRow = findFirstRowMissingBeginning();
  let isBeginningSave = isSavingBeginningInventory;
  let isEndOfDaySave = !isBeginningSave && !(isDayFinalized && hasAdminStoreUnlock);
  if (missingBeginningRow && !isBeginningSave) {
    showMissingBeginningPopup(missingBeginningRow);
    return;
  }
  if (typeof showConfirmationModal === 'function') {
    showConfirmationModal({
      title: isBeginningSave
        ? 'Save Beginning Inventory?'
        : (isDayFinalized && hasAdminStoreUnlock)
        ? 'Save Inventory Changes?'
        : 'Save End of Day Inventory?',
      message: isBeginningSave
        ? 'Blank Beg cells will be saved as 0. After saving, the Beg column will be locked and cannot be edited.'
        : (isDayFinalized && hasAdminStoreUnlock)
        ? 'This will save the admin-unlocked cells for this finalized inventory day.'
        : 'This will finalize and lock this inventory day for all users. After saving, users can view this date but can no longer edit it.',
      confirmText: 'Save',
      cancelText: 'Cancel',
      variant: isBeginningSave ? 'invensync' : '',
      modalWidth: isBeginningSave ? '420px' : '390px',
      onConfirm: () => runInventorySave(isBeginningSave, isEndOfDaySave)
    });
    return;
  }

  runInventorySave(isBeginningSave, isEndOfDaySave);
}

function runInventorySave(isBeginningSave = false, finalizeDay = false) {
  setInventorySaveButtons({ disabled: true });

  if (isBeginningSave) {
    fillBlankBeginningInputsWithZero();
  }

  saveInventory(isBeginningSave, finalizeDay).catch(err => {
    refreshSaveButtonState();
    notify('Error saving inventory', 'error');
    console.error(err);
  });
}

function saveInventory(isBeginningSave = false, finalizeDay = false) {
  let rows = document.querySelectorAll('tbody tr[data-product-id]');
  let items = [];
  
  rows.forEach(row => {
    let itemId = row.querySelector('.inv-item-id')?.value;
    if (!itemId) return;
    
    let beginningInput = row.querySelector('.beginning-input');
    let itemData = {
      item_id: itemId,
      delivery_qty: parseInt(row.querySelector('.delivery-input')?.value) || 0,
      trans_in_qty: parseInt(row.querySelector('.trans-in-input')?.value) || 0,
      bo_qty: parseInt(row.querySelector('.bo-input')?.value) || 0,
      adv_del_qty: parseInt(row.querySelector('.adv-del-input')?.value) || 0,
      trans_out_qty: parseInt(row.querySelector('.trans-out-input')?.value) || 0,
      wastage_qty: parseInt(row.querySelector('.wastage-input')?.value) || 0,
      csi_qty: parseInt(row.querySelector('.csi-input')?.value) || 0,
      quantity_sold: row.querySelector('.sold-input')?.value || '',
      ending_d5_qty: parseInt(row.querySelector('.ending-d5-input')?.value) || 0,
      ending_d4_qty: parseInt(row.querySelector('.ending-d4-input')?.value) || 0,
      ending_d3_qty: parseInt(row.querySelector('.ending-d3-input')?.value) || 0,
      remarks: row.querySelector('.remarks-input')?.value || ''
    };
    if (beginningInput) {
      itemData.beginning_qty = parseInt(beginningInput.value) || 0;
    }
    items.push(itemData);
  });
  
  return fetch('/store-manager/daily-ending-inventory/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      inventory_id: inventoryId,
      items: items,
      motif_breakdown: getSavedMotifBreakdown()?.rows || null,
      finalize_beginning: isBeginningSave,
      finalize_day: finalizeDay
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      let wasAdminUnlockedFinalizedSave = isDayFinalized && hasAdminStoreUnlock && !finalizeDay && !isBeginningSave;
      notify(
        isBeginningSave
          ? 'Beginning inventory saved and locked!'
          : (finalizeDay || wasAdminUnlockedFinalizedSave ? 'Inventory saved and finalized!' : 'Inventory changes saved!'),
        'success'
      );
      clearInventoryDraft();
      if (isBeginningSave) {
        lockBeginningInputs();
        isBeginningFinalized = true;
        isSavingBeginningInventory = false;
      }
      if (finalizeDay) {
        isDayFinalized = true;
        lockDayInputs();
      }
      if (wasAdminUnlockedFinalizedSave) {
        return clearConsumedAdminStoreUnlock().then(() => {
          finalizeAdminUnlockedViewAfterSave();
          captureInventorySnapshot();
          refreshBeginningSaveMode();
          return data;
        });
      }
      captureInventorySnapshot();
      refreshBeginningSaveMode();
      return data;
    } else {
      notify('Error: ' + data.error, 'error');
      throw new Error(data.error || 'Failed to save inventory');
    }
  })
  .catch(err => {
    notify('Error saving inventory', 'error');
    console.error(err);
    throw err;
  });
}


// Load previous date's Beginning Inventory (Total EI from previous day)
function loadPreviousDateInventory() {
  let selectedDateStr = document.getElementById('selected_date')?.value;
  if (!selectedDateStr) return;
  
  let selectedDate = new Date(selectedDateStr);
  let previousDate = new Date(selectedDate);
  previousDate.setDate(selectedDate.getDate() - 1);
  let previousDateStr = previousDate.toISOString().split('T')[0]; // Format: YYYY-MM-DD

  fetch(buildInvenSyncDateUrl(previousDateStr))
    .then(res => res.text())
    .then(html => {
      // Parse the HTML response
      let parser = new DOMParser();
      let doc = parser.parseFromString(html, 'text/html');
      
      // Extract previous day's inventory data
      let previousRows = doc.querySelectorAll('tbody tr[data-product-id]');
      let previousData = {};
      
      previousRows.forEach(row => {
        let productId = row.getAttribute('data-product-id');
        let totalEnding = parseFloat(row.querySelector('.total-ending')?.textContent) || 0;
        if (productId) {
          previousData[productId] = {
            totalEnding: totalEnding
          };
        }
      });
      
      // Update current page's beginning quantities
      let currentRows = document.querySelectorAll('tbody tr[data-product-id]');
      currentRows.forEach(row => {
        let productId = row.getAttribute('data-product-id');
        let beginningQtySpan = row.querySelector('.beginning-qty');
        
        if (previousData[productId] !== undefined) {
          // Update beginning quantity
          if (beginningQtySpan) {
            beginningQtySpan.textContent = Math.round(previousData[productId].totalEnding);
          }
          // Trigger inventory recalculation for this row if needed
          let firstInput = row.querySelector('input');
          if (firstInput) {
            updateInventoryRow(firstInput);
          }
        }
      });
    })
    .catch(err => {
      console.warn('Could not load previous date inventory:', err);
    });
}

// Horizontal scroll with Alt + Mouse Wheel
function enableHorizontalScroll() {
  // Enable for main content
  let scrollContainer = document.querySelector('#main-content .inventory-scroll-container');
  if (scrollContainer) {
    scrollContainer.addEventListener('wheel', function(e) {
      if (e.altKey) {
        e.preventDefault();
        let scrollAmount = e.deltaY > 0 ? 50 : -50;
        scrollContainer.scrollLeft += scrollAmount;
      }
    });
  }
  
  // Enable for fullscreen modal
  let fullscreenScrollContainer = document.querySelector('#fullscreen-modal .overflow-auto');
  if (fullscreenScrollContainer) {
    fullscreenScrollContainer.addEventListener('wheel', function(e) {
      if (e.altKey) {
        e.preventDefault();
        let scrollAmount = e.deltaY > 0 ? 50 : -50;
        fullscreenScrollContainer.scrollLeft += scrollAmount;
      }
    });
  }
}

function setActiveCategoryButton(categoryId) {
  document.querySelectorAll('.category-filter-btn').forEach(button => {
    let isActive = button.dataset.categoryFilter === categoryId;
    button.classList.toggle('bg-slate-900', isActive);
    button.classList.toggle('text-white', isActive);
    button.classList.toggle('hover:bg-slate-900', isActive);
    button.classList.toggle('bg-white', !isActive);
    button.classList.toggle('text-slate-700', !isActive);
    button.classList.toggle('hover:bg-slate-100', !isActive);
  });
}

let activeInventoryCategory = 'all';

function filterInventoryCategory(categoryId) {
  activeInventoryCategory = categoryId || 'all';
  applyInventoryFilters();
}



async function applyInventoryFilters() {
  let categoryId = activeInventoryCategory || 'all';
  let searchValue = (document.getElementById('product-search-input')?.value || '').trim().toLowerCase();
  setActiveCategoryButton(categoryId);
	
	blurProductTable();
	
  let rows = Array.from(document.querySelectorAll('tbody tr[data-product-id]'));
  let visibleCountByCategory = {};
  let batchSize = 50;

  for (let i = 0; i < rows.length; i += batchSize) {
    let batch = rows.slice(i, i + batchSize);
		
	
    batch.forEach(row => {
      let matchesCategory = categoryId === 'all' || row.dataset.categoryId === categoryId;
      let matchesSearch = !searchValue || (row.dataset.searchText || row.textContent || '').toLowerCase().includes(searchValue);
      let shouldShow = matchesCategory && matchesSearch;
      row.style.display = shouldShow ? '' : 'none';
      if (shouldShow) {
        visibleCountByCategory[row.dataset.categoryId] = (visibleCountByCategory[row.dataset.categoryId] || 0) + 1;
      }
    });
    await sleep(40);
  }

  document.querySelectorAll('tr.category-header').forEach(row => {
    let matchesCategory = categoryId === 'all' || row.dataset.category === categoryId;
    row.style.display = matchesCategory && visibleCountByCategory[row.dataset.category] ? '' : 'none';
  });
  
  await sleep (100);
  
  unblurProductTable();
  
}

// Initialize


function attachEnterNavigation(scope) {
  let table = scope.querySelector('table');
  if (!table) return;

  function isNavigableInventoryField(field) {
    return Boolean(
      field
      && field.offsetParent !== null
      && !field.disabled
      && !field.readOnly
      && field.type !== 'hidden'
      && field.type !== 'checkbox'
    );
  }

  function findNavigableField(cell) {
    if (!cell || cell.offsetParent === null) return null;
    return Array.from(cell.querySelectorAll('input, select, textarea')).find(isNavigableInventoryField) || null;
  }

  function focusInventoryField(field) {
    if (!field) return;
    field.focus({ preventScroll: true });
    field.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
    if (typeof field.select === 'function') field.select();
  }

  function getHorizontalTarget(currentCell, direction) {
    let row = currentCell?.closest('tr[data-product-id]');
    if (!row) return null;
    let cells = Array.from(row.querySelectorAll('td'));
    let cellIndex = cells.indexOf(currentCell) + direction;
    while (cellIndex >= 0 && cellIndex < cells.length) {
      let target = findNavigableField(cells[cellIndex]);
      if (target) return target;
      cellIndex += direction;
    }
    return null;
  }

  function getVerticalTarget(currentCell, direction) {
    let currentRow = currentCell?.closest('tr[data-product-id]');
    let dataField = currentCell?.dataset.field;
    if (!currentRow || !dataField) return null;
    let rows = Array.from(table.querySelectorAll('tbody tr[data-product-id]'))
      .filter(row => row.offsetParent !== null && row.style.display !== 'none');
    let rowIndex = rows.indexOf(currentRow) + direction;
    while (rowIndex >= 0 && rowIndex < rows.length) {
      let targetCell = Array.from(rows[rowIndex].querySelectorAll('td'))
        .find(cell => cell.dataset.field === dataField);
      let target = findNavigableField(targetCell);
      if (target) return target;
      rowIndex += direction;
    }
    return null;
  }

  let inputs = table.querySelectorAll('input:not([type="checkbox"]), select, textarea');
  inputs.forEach(input => {
    input.addEventListener('keydown', function(e) {
      if (
        isStoreManagerInventory
        && !e.isComposing
        && !e.ctrlKey
        && !e.altKey
        && !e.metaKey
        && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)
      ) {
        let currentCell = this.closest('td');
        let direction = ['ArrowLeft', 'ArrowUp'].includes(e.key) ? -1 : 1;
        let target = ['ArrowLeft', 'ArrowRight'].includes(e.key)
          ? getHorizontalTarget(currentCell, direction)
          : getVerticalTarget(currentCell, direction);
        e.preventDefault();
        if (target) focusInventoryField(target);
        return;
      }

      if (e.key !== 'Enter') return;
      e.preventDefault();

      let currentRow = this.closest('tr[data-product-id]');
      if (!currentRow) return;

      let nextRow = currentRow.nextElementSibling;
      while (nextRow && (!nextRow.dataset.productId || nextRow.style.display === 'none')) {
        nextRow = nextRow.nextElementSibling;
      }
      if (!nextRow) return;

      let currentCell = this.closest('td');
      if (!currentCell) return;

      let cellIndex = Array.from(currentRow.querySelectorAll('td')).indexOf(currentCell);
      if (cellIndex < 0) return;

      let targetCell = nextRow.querySelectorAll('td')[cellIndex];
      if (!targetCell) return;

      let targetInput = targetCell.querySelector('input:not([type="checkbox"]), select');
      if (targetInput) {
        targetInput.focus();
        if (typeof targetInput.select === 'function') {
          targetInput.select();
        }
      }
    });
  });
}

// Keyboard shortcuts for fullscreen (F or F11 to toggle, Escape to close)
function isEscapeKey(e) {
  return e.key === 'Escape' || e.key === 'Esc' || e.keyCode === 27 || e.which === 27;
}

function isF11Key(e) {
  return e.key === 'F11' || e.keyCode === 122 || e.which === 122;
}

function isFullscreenShortcut(e) {
  if (isF11Key(e)) return true;
  if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return false;
  let target = e.target;
  if (target && (target.matches('input, textarea, select') || target.isContentEditable)) return false;
  return String(e.key || '').toLowerCase() === 'f';
}

function handleFullscreenKey(e) {
  let modal = document.getElementById('fullscreen-modal');
  if (!modal || e.repeat) return;

  if (isFullscreenShortcut(e)) {
    e.preventDefault();
    toggleFullscreen();
  } else if (isEscapeKey(e) && !modal.classList.contains('hidden')) {
    e.preventDefault();
    toggleFullscreen();
  }
}

document.addEventListener('keydown', handleFullscreenKey);
function scheduleBeginningSpotlightRender() {
  if (!beginningGuideActive) return;
  if (beginningGuideScrollRenderTimer) window.clearTimeout(beginningGuideScrollRenderTimer);
  beginningGuideScrollRenderTimer = window.setTimeout(() => {
    beginningGuideScrollRenderTimer = null;
    if (beginningGuideActive) renderBeginningSpotlight();
  }, 100);
}

window.addEventListener('resize', function() {
  scheduleBeginningSpotlightRender();
});
window.addEventListener('scroll', function() {
  scheduleBeginningSpotlightRender();
}, true);

// Sync products from Product Masterlist
function syncProducts() {
  let selectedDate = document.getElementById('selected_date')?.value;

  if (!selectedDate) {
    notify('Please select a date first', 'error');
    return;
  }

  // Show loading state
  notify('Syncing products from Product Masterlist...', 'info');

  fetch('/store-manager/invensync/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      date: selectedDate
    })
  })
  .then(res => res.json())
  .then(data => {
    if (data.success) {
      let totalProducts = data.total_products ?? data.synced_inventory ?? 0;
      notify(`Synced ${totalProducts} products from Product Masterlist!`, 'success');
      // Reload the page to show updated products
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    } else {
      notify('Error: ' + (data.error || 'Failed to sync products'), 'error');
    }
  })
  .catch(err => {
    notify('Error syncing products', 'error');
    console.error(err);
  });
}



function toggleFullscreen() {
  let modal = document.getElementById('fullscreen-modal');
  let isHidden = modal.classList.contains('hidden');

  if (isHidden) {
    updateFullscreenContent();

    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';

    localStorage.setItem('dailyCombinedFullscreen', 'true');

    setTimeout(() => {
      enableHorizontalScroll();
observeRowVisibility(document.getElementById('fullscreen-scroll-container'), document.getElementById('modal-content'));
    }, 100);
  } else {
    modal.classList.add('hidden');
    document.body.style.overflow = '';

    localStorage.removeItem('dailyCombinedFullscreen');

	observeRowVisibility(null, document.getElementById('invensyncTableBody'));
  }
}


function updateFullscreenContent() {
  let modalContent = document.getElementById('modal-content');
  let tableContainer = document.querySelector('#main-content .inventory-scroll-container');

  if (!tableContainer) return;

  // Clone table content
  let table = tableContainer.querySelector('table');
  if (table) {
    modalContent.innerHTML = '';
    let clonedTable = table.cloneNode(true);

    clonedTable.removeAttribute('id');
    clonedTable.querySelectorAll('[id]').forEach(el => el.removeAttribute('id'));
	
	
    // Make inputs in cloned table functional
    clonedTable.querySelectorAll('input').forEach(input => {
      let syncToOriginal = function() {
        // Find the corresponding input in the original table
        let rowIndex = Array.from(this.closest('tbody').querySelectorAll('tr')).indexOf(this.closest('tr'));
        let cellIndex = Array.from(this.closest('tr').querySelectorAll('td')).indexOf(this.closest('td'));

        let originalTable = tableContainer.querySelector('table');
        let originalRow = originalTable.querySelectorAll('tbody tr')[rowIndex];
        if (originalRow) {
          let originalCell = originalRow.querySelectorAll('td')[cellIndex];
          if (originalCell) {
            let originalInput = originalCell.querySelector('input');
            if (originalInput) {
              originalInput.value = this.value;
              // Trigger change event on original input
              originalInput.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }
      };

      input.addEventListener('input', syncToOriginal);
      input.addEventListener('change', syncToOriginal);
    });

    clonedTable.querySelectorAll('select').forEach(select => {
      let syncToOriginal = function() {
        let rowIndex = Array.from(this.closest('tbody').querySelectorAll('tr')).indexOf(this.closest('tr'));
        let cellIndex = Array.from(this.closest('tr').querySelectorAll('td')).indexOf(this.closest('td'));

        let originalTable = tableContainer.querySelector('table');
        let originalRow = originalTable.querySelectorAll('tbody tr')[rowIndex];
        if (originalRow) {
          let originalCell = originalRow.querySelectorAll('td')[cellIndex];
          let originalSelect = originalCell ? originalCell.querySelector('select') : null;
          if (originalSelect) {
            originalSelect.value = this.value;
            originalSelect.dispatchEvent(new Event('change', { bubbles: true }));
          }
        }
      };

      select.addEventListener('change', syncToOriginal);
    });

    modalContent.appendChild(clonedTable);
    attachEnterNavigation(modalContent);

    // Inventory Adjustments: rebind product search/suggest in the cloned table
    // (clones inherit data-adj-bound but not the listeners, so strip and rebind).
    clonedTable.querySelectorAll('.adjust-product-input').forEach(input => {
      input.removeAttribute('data-adj-bound');
    });
    // Sync adjustment product selections made in fullscreen back to the main table
    // (visible description + hidden product id), so Save Adjustments sees the change.
    clonedTable.querySelectorAll('td[data-adjust="product"]').forEach(cell => {
      let wrap = cell.querySelector('.adjust-product-wrap');
      if (!wrap) return;
      let hidden = wrap.querySelector('input[type="hidden"].adjust-product');
      let visible = wrap.querySelector('input[type="text"].adjust-product-input');
      let syncAdjustmentProductToOriginal = function () {
        let rowIndex = Array.from(cell.closest('tbody').querySelectorAll('tr')).indexOf(cell.closest('tr'));
        let cellIndex = Array.from(cell.closest('tr').querySelectorAll('td')).indexOf(cell);
        let originalTable = tableContainer.querySelector('table');
        let originalRow = originalTable.querySelectorAll('tbody tr')[rowIndex];
        let originalCell = originalRow ? originalRow.querySelectorAll('td')[cellIndex] : null;
        let originalWrap = originalCell ? originalCell.querySelector('.adjust-product-wrap') : null;
        if (!originalWrap) return;
        let originalVisible = originalWrap.querySelector('input[type="text"].adjust-product-input');
        let originalHidden = originalWrap.querySelector('input[type="hidden"].adjust-product');
        if (visible && originalVisible && originalVisible.value !== visible.value) {
          originalVisible.value = visible.value;
          originalVisible.dispatchEvent(new Event('change', { bubbles: true }));
        }
        if (hidden && originalHidden && originalHidden.value !== hidden.value) {
          originalHidden.value = hidden.value;
          originalHidden.dispatchEvent(new Event('change', { bubbles: true }));
        }
      };
      if (hidden) hidden.addEventListener('change', syncAdjustmentProductToOriginal);
      if (visible) visible.addEventListener('change', syncAdjustmentProductToOriginal);
      if (visible) visible.addEventListener('blur', function () {
        setTimeout(syncAdjustmentProductToOriginal, 250);
      });
    });
    if (typeof window.bindAdjustProductCombobox === 'function') {
      window.bindAdjustProductCombobox();
    }
    refreshVarianceDisplays();
    syncAllSwapPairs(false);
  }

  // Update subtitle
  let selectedDate = document.getElementById('selected_date')?.value || pageSelectedDate;
  let subtitle = document.getElementById('fullscreen-subtitle');
  if (subtitle) {
    subtitle.textContent = pageStoreName + ' - ' + selectedDate;
  }
}

// Make inventory fields readonly for view-only roles.
function applyViewOnlyLockdown() {
  if (!isViewOnlyRole) return;
  document.querySelectorAll('#main-content tbody tr[data-product-id] input[type="number"], #main-content tbody tr[data-product-id] input[type="text"], #main-content tbody tr[data-product-id] input[type="checkbox"], #main-content tbody tr[data-product-id] select').forEach(function(input) {
    if (input.classList.contains('inv-adjust-only')) return;
    if (input.type === 'checkbox') {
      input.disabled = true;
    } else {
      input.readOnly = true;
    }
    input.classList.add('cursor-not-allowed', 'opacity-75');
  });

  document.querySelectorAll('#main-content tbody tr[data-product-id] [onchange]').forEach(function(el) {
    if (el.classList.contains('inv-adjust-only')) return;
    el.removeAttribute('onchange');
  });
}

// ==== Consolidated init (was 7 separate DOMContentLoaded blocks in v1; v2 fetches
// data asynchronously so the table doesn't exist at native DOMContentLoaded time).

function initInventoryPageAfterRender() {

  let modal = getMotifModal();
  if (modal) {
    let hasMotifPayload = Boolean(motifChargePayload?.detected);
    let hasSavedMotifBreakdown = loadMotifBreakdown();
    applyMotifTagsToSoldColumn();
    updateMotifBreakdownBadge();

    if (hasMotifPayload) {
      modal.querySelectorAll('.motif-product-input').forEach(input => {
        input.addEventListener('input', function() {
          renderMotifProductDropdown(input);
          syncMotifProductSelection(input);
        });
        input.addEventListener('change', function() {
          syncMotifProductSelection(input, { clearInvalid: true });
        });
        input.addEventListener('focus', function() {
          renderMotifProductDropdown(input);
        });
        input.addEventListener('blur', function() {
          setTimeout(() => hideMotifProductDropdown(input), 150);
        });
      });
      modal.querySelectorAll('.motif-qty-input, .motif-discount-input').forEach(input => {
        input.addEventListener('input', function() {
          recalculateMotifPrice(input.closest('tr'));
        });
        input.addEventListener('change', function() {
          recalculateMotifPrice(input.closest('tr'));
        });
      });
      modal.querySelectorAll('.clear-motif-row').forEach(button => {
        button.addEventListener('click', function() {
          resetMotifBreakdownRow(button.closest('tr'));
        });
      });
      modal.querySelectorAll('tbody tr').forEach(row => {
        let productInput = row.querySelector('.motif-product-input');
        if (!findMotifProductOption(productInput?.value || '')) {
          resetMotifBreakdownRow(row);
        }
      });
      if (!hasSavedMotifBreakdown) {
        setTimeout(() => {
          openMotifBreakdownModal();
          showMotifGuideStartModal();
        }, 250);
      }
    }
  }



  preloadAdjacentDates(window.location.href);



  let goMissingBtn = document.getElementById('missing-dates-go');
  if (goMissingBtn) {
    goMissingBtn.addEventListener('click', function() {
      if (!nextMissingDate) {
        hideMissingDatesModal();
        return;
      }
      window.location.href = buildInvenSyncDateUrl(nextMissingDate);
    });
  }

  if (!isInvenSyncGuideMode && Array.isArray(missingDates) && missingDates.length > 0) {
    showMissingDatesModal();
  }


  if (typeof window.bindAdjustProductCombobox === 'function') {
    window.bindAdjustProductCombobox();
  }


  syncAdjustmentChargesHeader();



  document.addEventListener('wheel', function(event) {
    if (event.target && event.target.matches('input[type="number"]')) {
      event.target.blur();
    }
  }, { passive: true });

  updateDateHeaders();
  applyColorCodingOnLoad();
  refreshVarianceDisplays();
  enableHorizontalScroll();
  filterInventoryCategory('all');
  if (isDayFinalized) {
    lockDayInputs();
  }
  applyAdminStoreUnlocks();
  captureInventorySnapshot();
  restoreInventoryDraft();
  refreshBeginningSaveMode();

  document.querySelectorAll('tbody tr[data-product-id]').forEach(row => {
    syncAdjustmentChargesCell(row);
  });
  syncAllSwapPairs(false);
  refreshVarianceDisplays();
  captureAdjustmentsSnapshot();

  let productSearchInput = document.getElementById('product-search-input');
  if (productSearchInput) {
    productSearchInput.addEventListener('input', applyInventoryFilters);
  }

  document.addEventListener('input', function(event) {
    if (event.target && event.target.closest('tbody tr[data-product-id]')) {
      let row = event.target.closest('tr[data-product-id]');
      if (rowNeedsBeginningBeforeInput(row, event.target)) {
        showMissingBeginningPopup(row);
      }
      saveInventoryDraft();
      refreshBeginningSaveMode();
      refreshSaveButtonState();
    }
  });

  document.addEventListener('change', function(event) {
    if (event.target && event.target.closest('tbody tr[data-product-id]')) {
      saveInventoryDraft();
      refreshBeginningSaveMode();
      refreshSaveButtonState();
    }
  });

  // Setup spreadsheet-style keyboard navigation in the main editable table.
  attachEnterNavigation(document);

  // Check for fullscreen state on page load
  let isFullscreen = localStorage.getItem('dailyCombinedFullscreen');
  if (isFullscreen === 'true') {
    toggleFullscreen();
  }

  setTimeout(refreshBeginningSaveMode, 100);


  applyViewOnlyLockdown();
}


//Other Functions ==================================================


function openInvensyncExportModal() {
  let modal = document.getElementById('invensync-export-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
}

function closeInvensyncExportModal() {
  let modal = document.getElementById('invensync-export-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
}



(function () {
  let TRANSFER_TRACE_URL = window.INVENSYNC_URLS.transferTrace;
  let traceCache = {};
  let hideTimer = null;

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function getTooltip() {
    let el = document.getElementById('trans-trace-tooltip');
    if (!el) {
      el = document.createElement('div');
      el.id = 'trans-trace-tooltip';
      el.className = 'trans-trace-tooltip';
      document.body.appendChild(el);
      el.addEventListener('mouseenter', clearHideTimer);
      el.addEventListener('mouseleave', scheduleHide);
    }
    return el;
  }

  function clearHideTimer() {
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function scheduleHide() {
    clearHideTimer();
    hideTimer = setTimeout(function () {
      getTooltip().classList.remove('show');
    }, 200);
  }

  function positionTooltip(anchor, tooltip) {
    let margin = 8;
    let rect = anchor.getBoundingClientRect();
    let tipRect = tooltip.getBoundingClientRect();
    let top = rect.bottom + margin;
    if (top + tipRect.height > window.innerHeight - margin) {
      top = rect.top - tipRect.height - margin;
    }
    if (top < margin) top = margin;
    let left = Math.min(rect.left, window.innerWidth - tipRect.width - margin);
    if (left < margin) left = margin;
    tooltip.style.top = top + 'px';
    tooltip.style.left = left + 'px';
  }

  async function showTransTrace(productId, direction, anchor) {
    clearHideTimer();
	
    let tooltip = getTooltip();
	if (anchor.value.length <= 0) {
		tooltip.classList.remove('show');
		return;
	}

    tooltip.innerHTML = '<div style="padding:6px 2px;color:#cbd5e1">Loading source...</div>';
    positionTooltip(anchor, tooltip);
    tooltip.classList.add('show');

    let cacheKey = pageStoreId + ':' + pageSelectedDate + ':' + productId + ':' + direction;
    try {
      if (traceCache[cacheKey] === undefined) {
        let params = new URLSearchParams({
          store_id: pageStoreId,
          date: pageSelectedDate,
          product_master_id: productId,
          direction: direction,
        });
        let response = await fetch(TRANSFER_TRACE_URL + '?' + params.toString(), {
          headers: { 'Accept': 'application/json' },
          //credentials: 'same-origin',
        });
		
		
        if (!response.ok) {
		  let errorBody = await response.text();
		  throw new Error(`Request failed (${response.status}): ${errorBody}`);
		}
		
		
        traceCache[cacheKey] = await response.json();
      }
      renderTrace(tooltip, traceCache[cacheKey], anchor);
      positionTooltip(anchor, tooltip);
    } catch (error) {
	
	
		console.log(error);
	
      tooltip.innerHTML = '<div style="padding:6px 2px;color:#fca5a5">Unable to load trace data.</div>';
    }
  }

  function renderTrace(tooltip, data, anchor) {
    if (!data || !data.ok) {
      tooltip.innerHTML = '<div style="padding:6px 2px;color:#fca5a5">Unable to load trace data.</div>';
      return;
    }
    let records = data.records || [];
    let directionLabel = data.direction === 'in' ? 'Trans-In source' : data.direction === 'out' ? 'Trans-Out source' : data.direction === 'delivery' ? 'Delivery source' : 'POS Sold source';
    let cellInput = anchor.closest('td') ? anchor.closest('td').querySelector('input') : null;
    let cellValue = cellInput ? (parseInt(cellInput.value || '0', 10) || 0) : null;

    let bodyHtml = '';
    if (!records.length) {
      bodyHtml = '<tr><td colspan="8" style="padding:10px 2px;color:#cbd5e1">No source records found for this product and day. The value may have been entered manually.</td></tr>';
    } else {
      bodyHtml = records.map(function (r) {
        return '<tr style="border-bottom:1px solid #1e293b">' +
          '<td style="padding:3px 8px 3px 0;white-space:nowrap;font-weight:700;color:#7dd3fc">' + escapeHtml(r.control_no) + '</td>' +
          '<td style="padding:3px 8px;white-space:nowrap">' + escapeHtml(r.transaction_date) + '</td>' +
          '<td style="padding:3px 8px;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escapeHtml(r.transfer_from) + ' \u2192 ' + escapeHtml(r.transfer_to) + '</td>' +
          '<td style="padding:3px 8px;text-align:center">' + escapeHtml(r.status) + '</td>' +
          '<td style="padding:3px 8px;text-align:center">' + escapeHtml(r.quantity) + '</td>' +
          '<td style="padding:3px 8px;text-align:center">' + escapeHtml(r.received_quantity) + '</td>' +
          '<td style="padding:3px 8px;text-align:center">' + escapeHtml(r.short_over_qty) + '</td>' +
          '<td style="padding:3px 8px">' + escapeHtml(r.remarks || '\u2014') + '</td>' +
          '</tr>';
      }).join('');
    }

    let noteHtml = (cellValue !== null && cellValue !== data.traced_total)
      ? '<div style="margin-top:6px;padding-top:6px;border-top:1px solid #334155;color:#fbbf24">Note: Column shows <b>' + cellValue + '</b> while traced total is <b>' + data.traced_total + '</b>. The difference may be a manual entry or adjustment.</div>'
      : '';

    tooltip.innerHTML =
      '<div style="margin-bottom:10px;font-weight:700;color:#fff">' + directionLabel + '</div>' +
      '<table style="width:100%;border-collapse:collapse">' +
        '<thead><tr style="color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:.04em">' +
          '<th style="text-align:left;padding:2px 8px 2px 0">Control No.</th>' +
          '<th style="text-align:left;padding:2px 8px">Date</th>' +
          '<th style="text-align:left;padding:2px 8px">From \u2192 To</th>' +
          '<th style="text-align:center;padding:2px 8px">Status</th>' +
          '<th style="text-align:center;padding:2px 8px">Sent</th>' +
          '<th style="text-align:center;padding:2px 8px">Rcvd</th>' +
          '<th style="text-align:center;padding:2px 8px">S/O</th>' +
          '<th style="text-align:left;padding:2px 8px">Remarks</th>' +
        '</tr></thead>' +
        '<tbody>' + bodyHtml + '</tbody>' +
      '</table>' +
      '<div style="margin-top:6px;color:#cbd5e1">Traced total: <b style="color:#fff">' + data.traced_total + '</b></div>' +
      noteHtml;
  }

  window.showTransTrace = showTransTrace;
  window.hideTransTrace = scheduleHide;
})();

// Export InvenSync Modal (Area Manager / Admin / Superadmin)
(function() {
  let modal = document.getElementById('exportInvenSyncModal');
  let openBtn = document.getElementById('openExportInvenSyncModal');
  if (!modal || !openBtn) return;

  let exportModal = new Modal('exportInvenSyncModal');
  let form = document.getElementById('exportInvenSyncForm');
  let submitBtn = form ? form.querySelector('button[type="submit"]') : null;
  let originalBtnHtml;

  function resetSubmitBtn() {
	"";
  }

  openBtn.addEventListener('click', () => {
    resetSubmitBtn();
    exportModal.open();
  });

  let originalClose = exportModal.close.bind(exportModal);
  exportModal.close = function() {
    originalClose();
    resetSubmitBtn();
  };

  let radioButtons = modal.querySelectorAll('input[name="export_type"]');
  let singleDateFields = modal.querySelector('#singleDateFields');
  let rangeDateFields = modal.querySelector('#rangeDateFields');

  radioButtons.forEach(radio => {
    radio.addEventListener('change', function() {
      singleDateFields.classList.toggle('hidden', this.value !== 'single');
      rangeDateFields.classList.toggle('hidden', this.value !== 'range');
    });
  });

  if (form) {
    form.addEventListener('submit', () => {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<svg class="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>Downloading...';
      }
      setTimeout(() => exportModal.close(), 1000);
    });
  }
})();




async function downloadInvenSyncExport() {
  let exportType = document.querySelector('#exportInvenSyncForm input[name="export_type"]:checked')?.value || 'single';
  let params = new URLSearchParams({ export_type: exportType });

  if (exportType === 'single') {
    params.set('date', document.getElementById('export_single_date').value);
  } else if (exportType === 'range') {
    params.set('start_date', document.getElementById('export_start_date').value);
    params.set('end_date', document.getElementById('export_end_date').value);
  }

  let url = `${window.INVENSYNC_URLS.storeExcelExportBase.replace('/0', `/${pageStoreId}`)}?${params.toString()}`;

  let fieldsView = document.getElementById('exportFieldsView');
  let progressView = document.getElementById('exportProgressView');
  let progressBar = document.getElementById('exportProgressBar');
  let progressLabel = document.getElementById('exportProgressLabel');
  let progressDetail = document.getElementById('exportProgressDetail');
  let submitBtn = document.getElementById('exportInvenSyncSubmitBtn');

  fieldsView.classList.add('hidden');
  progressView.classList.remove('hidden');
  submitBtn.disabled = true;
  progressBar.style.width = '0%';
  progressLabel.textContent = 'Preparing export...';
  progressDetail.textContent = '';

  try {
    let response = await fetch(url, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`Export failed (${response.status})`);

    let contentLength = response.headers.get('Content-Length');
    let total = contentLength ? parseInt(contentLength, 10) : 0;
    let reader = response.body.getReader();
    let chunks = [];
    let received = 0;

    progressLabel.textContent = 'Downloading...';

    while (true) {
      let { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;

      if (total) {
        let percent = Math.min(100, Math.round((received / total) * 100));
        progressBar.style.width = `${percent}%`;
        progressDetail.textContent = `${(received / 1024).toFixed(0)} KB of ${(total / 1024).toFixed(0)} KB`;
      } else {
        progressDetail.textContent = `${(received / 1024).toFixed(0)} KB downloaded`;
      }
    }

    progressBar.style.width = '100%';
    progressLabel.textContent = 'Finishing up...';

    let blob = new Blob(chunks);
    let disposition = response.headers.get('Content-Disposition') || '';
    let filenameMatch = disposition.match(/filename="?([^";]+)"?/);
    let filename = filenameMatch ? filenameMatch[1] : `invensync_export_${pageStoreId}.xlsx`;

    let objectUrl = URL.createObjectURL(blob);
    let link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);

    progressLabel.textContent = 'Download complete!';
    toast.success('Export downloaded.');

    setTimeout(() => {
      document.getElementById('exportInvenSyncModal').classList.add('hidden');
      fieldsView.classList.remove('hidden');
      progressView.classList.add('hidden');
      submitBtn.disabled = false;
    }, 1000);
  } catch (error) {
    console.error('[InvenSync] export failed:', error);
    progressLabel.textContent = 'Export failed.';
    progressDetail.textContent = error.message || 'Please try again.';
    progressBar.style.width = '0%';
    toast.error('Export failed: ' + (error.message || 'Unknown error.'));
    submitBtn.disabled = false;
    setTimeout(() => {
      fieldsView.classList.remove('hidden');
      progressView.classList.add('hidden');
    }, 2000);
  }
}

document.getElementById('exportInvenSyncSubmitBtn').addEventListener('click', downloadInvenSyncExport);

