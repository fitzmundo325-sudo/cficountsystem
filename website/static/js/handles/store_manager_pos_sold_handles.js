let POS_STATE = null;
let motifChargePayload = null;
let motifProductOptions = [];
let motifBreakdownKey = '';
let posTourCompletionKey = '';
let isPosGuideMode = false;
let shouldShowPosTour = false;
let posTourActive = false;
let posTourStepIndex = 0;
let motifGuideActive = false;
let motifGuideStepIndex = 0;
let motifGuideSeenKey = 'motifBreakdownGuideSeenV2';

let reportDateInput = byId('report_date');
let posFileInput = byId('pos_file');
let posFileLabel = byId('pos-file-label');
let goDailySummaryBtn = byId('go-daily-summary-btn');
let clearPosInlineBtn = byId('clear-pos-inline-btn');
let deleteAllBtn = byId('pos-delete-all-btn');
let scanForm = byId('pos-scan-form');
let posSaveForm = byId('pos-save-form');
let clearPosInlineForm = byId('clear-pos-inline-form');
let deleteAllForm = byId('pos-delete-all-form');
let zLateForm = byId('z-late-form');
let zReadingRequiredInput = byId('z_reading_image_required');
let missingDatesGoBtn = byId('missing-dates-go');
let posTourHelpBtn = byId('pos-tour-help-btn');
let posTourStartBtn = byId('pos-tour-start-btn');
let motifGroupsEl = byId('pos-motif-groups');


// ------------------ Helpers ------------------

function byId(id) {
  return document.getElementById(id);
}

function setVisible(el, visible) {
  if (!el) return;
  el.classList.toggle('hidden', !visible);
}

function setText(id, text) {
  let el = byId(id);
  if (el) el.textContent = text;
}

function setFieldValues(ids, value) {
  ids.forEach(function(id) {
    let el = byId(id);
    if (el) el.value = value;
  });
}

function fillCell(root, cellName, text) {
  let cell = root.querySelector('[data-cell="' + cellName + '"]');
  if (cell) cell.textContent = text;
}

function cloneTemplate(id) {
  let template = byId(id);
  if (!template) return null;
  return template.content.firstElementChild.cloneNode(true);
}

function storageGet(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (error) {
    return null;
  }
}

function storageSet(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (error) {
    return;
  }
}

function storageRemove(key) {
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    return;
  }
}

function isStoreManager() {
  return Boolean(POS_STATE) && POS_STATE.role === 'Store Manager';
}

function isInventoryStaff() {
  return Boolean(POS_STATE) && POS_STATE.role === 'Inventory Staff';
}

function notifyPos(message, type) {
  let kind = type || 'info';
  if (typeof toast !== 'undefined' && toast) {
    if (typeof toast[kind] === 'function') {
      toast[kind](message);
      return;
    }
    if (typeof toast.show === 'function') {
      toast.show(message, kind);
      return;
    }
  }
  console.warn(message);
}

function formatPeso(value) {
  return '₱' + Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatMoney(value) {
  return Number(value || 0).toFixed(2);
}

function formatReportDateLong(isoDate) {
  if (!isoDate) return '--';
  let parsedDate = new Date(isoDate + 'T00:00:00');
  if (Number.isNaN(parsedDate.getTime())) return isoDate;
  return parsedDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function getElementGroupRect(elements) {
  let visibleElements = elements.filter(function(el) {
    return el && el.offsetParent !== null;
  });
  if (!visibleElements.length) return null;
  let rects = visibleElements.map(function(el) {
    return el.getBoundingClientRect();
  });
  let padding = 10;
  return {
    top: Math.max(0, Math.min.apply(null, rects.map(function(rect) { return rect.top; })) - padding),
    left: Math.max(0, Math.min.apply(null, rects.map(function(rect) { return rect.left; })) - padding),
    right: Math.min(window.innerWidth, Math.max.apply(null, rects.map(function(rect) { return rect.right; })) + padding),
    bottom: Math.min(window.innerHeight, Math.max.apply(null, rects.map(function(rect) { return rect.bottom; })) + padding)
  };
}

function removeUrlParams(names) {
  if (!window.history || !window.history.replaceState) return;
  let url = new URL(window.location.href);
  let changed = false;
  names.forEach(function(name) {
    if (url.searchParams.has(name)) {
      url.searchParams.delete(name);
      changed = true;
    }
  });
  if (changed) {
    window.history.replaceState({}, '', url.pathname + url.search + url.hash);
  }
}


// ------------------ Loading ------------------

function readJsonResponse(response) {
  return response.json();
}

function handlePosSoldLoadError() {
  notifyPos('Unable to load POS Sold data. Please refresh the page.', 'error');
}

function loadPosSold() {
  fetch(POS_SOLD_ROUTES.data + window.location.search, { headers: { 'Accept': 'application/json' } })
    .then(readJsonResponse)
    .then(handlePosSoldLoaded)
    .catch(handlePosSoldLoadError);
}

function handlePosSoldLoaded(data) {
  if (!data || data.type !== 'success') {
    notifyPos((data && data.message) || 'Unable to load POS Sold data.', 'error');
    return;
  }
  POS_STATE = data;
  motifBreakdownKey = 'invensyncMotifBreakdown:' + POS_STATE.store.id + ':' + POS_STATE.selected_report_date;
  posTourCompletionKey = 'pos-tour-completed-store-' + POS_STATE.store.id;
  isPosGuideMode = Boolean(POS_STATE.guide_mode);
  shouldShowPosTour = Boolean(POS_STATE.show_pos_flow_guide);
  renderAll();
  runLoadEffects();
}

function runLoadEffects() {
  if (isPosGuideMode) {
    removeUrlParams(['guide']);
  }
  if (POS_STATE.pos_scan_success) {
    storageRemove(motifBreakdownKey);
  }
  handleScanSuccessNotice();
  let hasSavedMotifRows = renderMotifModal();
  handleMotifAutoOpen(hasSavedMotifRows);
  handleMissingDatesModal();
}

function handleScanSuccessNotice() {
  if (!POS_STATE.pos_scan_success) return;
  let rows = Number(POS_STATE.pos_scan_rows || 0);
  let itemLabel = rows === 1 ? 'item' : 'items';
  notifyPos('Successfully scanned ' + rows + ' POS sold ' + itemLabel + ' for ' + POS_STATE.selected_report_date + '.', 'success');
  removeUrlParams(['pos_scan_success', 'pos_scan_rows']);
}

function applyFormActions() {
  if (scanForm) scanForm.action = POS_SOLD_ROUTES.scan;
  if (posSaveForm) posSaveForm.action = POS_SOLD_ROUTES.save;
  if (clearPosInlineForm) clearPosInlineForm.action = POS_SOLD_ROUTES.clear;
  if (deleteAllForm) deleteAllForm.action = POS_SOLD_ROUTES.deleteAll;
  if (zLateForm) zLateForm.action = POS_SOLD_ROUTES.zReadingUpload;
}


// ------------------ Rendering ------------------

function renderAll() {
  renderHeader();
  renderStatus();
  renderBanners();
  renderUploadArea();
  renderItems();
  renderZReading();
  renderMissingDates();
  renderTourModal();
}

function renderHeader() {
  let storeName = POS_STATE.store.name || '';
  let date = POS_STATE.selected_report_date || POS_STATE.today;
  let dailyReportUrl = POS_SOLD_ROUTES.dailyReport + '?date=' + encodeURIComponent(date);

  setText('header-store-name', storeName);
  setText('page-store-name', storeName);
  setText('tour-store-name', storeName);
  setText('motif-guide-store-name', storeName);
  document.title = 'POS Sold - ' + storeName;

  if (reportDateInput) reportDateInput.value = date;

  let breadcrumb = byId('breadcrumb-daily-report');
  if (breadcrumb) breadcrumb.href = dailyReportUrl;
  let nextLink = byId('pos-next-link');
  if (nextLink) nextLink.href = dailyReportUrl;
  let tourNextTarget = byId('pos-tour-next-target');
  if (tourNextTarget) tourNextTarget.href = dailyReportUrl + '&lock_date=1';

  let exportLink = byId('pos-export-link');
  if (exportLink) {
    let showExport = isInventoryStaff() && Boolean(POS_STATE.export_url);
    setVisible(exportLink, showExport);
    if (showExport) exportLink.href = POS_STATE.export_url;
  }

  setFieldValues([
    'pos-upload-report-date',
    'pos-clear-report-date',
    'pos-save-report-date',
    'pos-delete-report-date',
    'pos-z-report-date'
  ], date);
}

function renderStatus() {
  let source = POS_STATE.pos_sold_source;
  let status = POS_STATE.report_status || '';
  let statusBadge = byId('pos-status-badge');
  let draftBadge = byId('pos-draft-badge');

  let showStatus = Boolean(status) && source !== 'draft';
  if (statusBadge) {
    let colorClass = 'bg-rose-100 text-rose-700';
    if (status === 'Pending') colorClass = 'bg-amber-100 text-amber-700';
    if (status === 'Approved') colorClass = 'bg-emerald-100 text-emerald-700';
    statusBadge.className = 'inline-flex items-center px-2 py-1 rounded-md text-xs font-medium ' + colorClass;
    statusBadge.textContent = status;
    setVisible(statusBadge, showStatus);
  }

  setVisible(draftBadge, !showStatus && source === 'draft' && Boolean(POS_STATE.pos_scan_success));
}

function renderBanners() {
  setText('pos-finalized-date', POS_STATE.selected_report_date || POS_STATE.today);
  setVisible(byId('pos-finalized-banner'), isStoreManager() && Boolean(POS_STATE.pos_sold_day_finalized));
}

function updatePosFileLabel() {
  if (!posFileLabel || !posFileInput) return;
  let hasFile = Boolean(posFileInput.files && posFileInput.files.length);
  posFileLabel.textContent = hasFile ? posFileInput.files[0].name : 'No file chosen';
  posFileLabel.classList.toggle('text-slate-700', hasFile);
  posFileLabel.classList.toggle('font-semibold', hasFile);
  posFileLabel.classList.toggle('text-slate-500', !hasFile);
}

function renderUploadArea() {
  let locked = Boolean(POS_STATE.pos_sold_locked);
  let source = POS_STATE.pos_sold_source;
  let hasItems = (POS_STATE.pos_sold_items || []).length > 0;
  let savedOrStaged = source === 'staged' || source === 'saved';
  let draftWithItems = source === 'draft' && hasItems;

  setVisible(byId('pos-sm-block'), isStoreManager());
  setVisible(byId('pos-file-guide-target'), !locked);
  setVisible(byId('pos-saved-indicator'), locked);
  setText('pos-saved-indicator-text', 'POS Sold saved for ' + POS_STATE.selected_report_date);

  if (posFileInput) {
    posFileInput.required = !locked;
    posFileInput.disabled = locked;
    posFileInput.value = '';
  }
  updatePosFileLabel();

  setVisible(byId('pos-next-link'), savedOrStaged);
  setVisible(deleteAllBtn, savedOrStaged && !POS_STATE.pos_sold_day_finalized);
  setVisible(goDailySummaryBtn, draftWithItems);
  setVisible(clearPosInlineBtn, draftWithItems);
  setVisible(byId('pos-scan-guide-target'), !savedOrStaged && !draftWithItems);

  if (goDailySummaryBtn) {
    goDailySummaryBtn.disabled = false;
    goDailySummaryBtn.textContent = 'Save';
    goDailySummaryBtn.classList.remove('cursor-not-allowed', 'opacity-70');
  }
}

function renderItems() {
  let items = POS_STATE.pos_sold_items || [];
  let source = POS_STATE.pos_sold_source;
  let hasItems = items.length > 0;
  let sm = isStoreManager();

  setVisible(byId('pos-uploaded-note'), !sm && hasItems);

  let sourceNote = byId('pos-source-note');
  let showSourceNote = hasItems && (source === 'draft' || source === 'staged');
  if (sourceNote) {
    if (source === 'draft') {
      sourceNote.textContent = 'Showing extracted preview data (not yet saved).';
      sourceNote.className = 'text-[11px] font-semibold text-amber-700';
    } else {
      sourceNote.textContent = 'Saved POS Sold — reflected in InvenSync and awaiting Daily Report submission.';
      sourceNote.className = 'text-[11px] font-semibold text-emerald-700';
    }
    setVisible(sourceNote, showSourceNote);
  }

  let showDeleteHint = hasItems && sm && !POS_STATE.pos_sold_day_finalized && (source === 'staged' || source === 'saved');
  setVisible(byId('pos-delete-hint'), showDeleteHint);

  let body = byId('pos-items-body');
  body.innerHTML = '';
  items.forEach(function(item) {
    let row = cloneTemplate('tmpl-pos-row');
    fillCell(row, 'product', item.product_name);
    fillCell(row, 'quantity', item.quantity);
    fillCell(row, 'gross', formatMoney(item.gross_sales));
    fillCell(row, 'discount', formatMoney(item.discount));
    fillCell(row, 'net', formatMoney(item.net_sales));
    body.appendChild(row);
  });

  setVisible(byId('pos-items-wrap'), hasItems);
  setVisible(byId('pos-empty-box'), !hasItems);
}

function renderZReading() {
  let zReading = POS_STATE.z_reading || {};
  let hasLink = Boolean(zReading.link);
  let locked = Boolean(POS_STATE.pos_sold_locked);
  let sm = isStoreManager();

  let currentImg = byId('z-current-img');
  if (currentImg && zReading.preview_url) currentImg.src = zReading.preview_url;
  setVisible(byId('z-current-wrap'), Boolean(zReading.preview_url));

  setVisible(byId('z-required-wrap'), sm && !hasLink && !locked);
  setVisible(zLateForm, sm && !hasLink && locked);
  setVisible(byId('z-staff-empty'), isInventoryStaff() && !hasLink);

  if (zReadingRequiredInput) zReadingRequiredInput.value = '';
  setVisible(byId('z-reading-local-preview'), false);
  let lateInput = byId('z_reading_image_late');
  if (lateInput) lateInput.value = '';
}

function renderMissingDates() {
  let missing = POS_STATE.missing_dates || [];
  let list = byId('missing-dates-list');
  if (!list) return;
  list.innerHTML = '';
  missing.forEach(function(item) {
    let row = cloneTemplate('tmpl-missing-row');
    fillCell(row, 'label', item.label);
    fillCell(row, 'iso', item.iso);
    list.appendChild(row);
  });
  let suffix = missing.length === 1 ? '' : 's';
  setText('missing-dates-count', missing.length + ' missing date' + suffix + ' found for this month.');
}

function renderTourModal() {
  setVisible(byId('pos-tour-start-modal'), shouldShowPosTour || isPosGuideMode);
}


// ------------------ Missing dates modal ------------------

function showMissingDatesModal() {
  let modal = byId('missing-dates-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
}

function hideMissingDatesModal() {
  let modal = byId('missing-dates-modal');
  if (!modal) return;
  modal.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
}

function handleMissingDatesModal() {
  let missing = POS_STATE.missing_dates || [];
  if (!isPosGuideMode && isStoreManager() && missing.length > 0) {
    showMissingDatesModal();
  } else {
    hideMissingDatesModal();
  }
}

function handleMissingDatesGo() {
  if (!POS_STATE || !POS_STATE.next_missing_date) {
    hideMissingDatesModal();
    return;
  }
  navigateToDate(POS_STATE.next_missing_date);
}


// ------------------ Date navigation ------------------

function resetTransientUi() {
  clearPosTour();
  closeMotifModal();
  hideMissingDatesModal();
}

function navigateToDate(dateValue) {
  resetTransientUi();
  window.history.pushState({}, '', POS_SOLD_ROUTES.page + '?date=' + encodeURIComponent(dateValue));
  loadPosSold();
}

function syncPosDateFields() {
  if (!reportDateInput) return;
  setFieldValues(['pos-upload-report-date', 'pos-clear-report-date'], reportDateInput.value || '');
}

function handleReportDateChange() {
  syncPosDateFields();
  let selectedDate = reportDateInput.value;
  if (selectedDate) navigateToDate(selectedDate);
}

function handlePopState() {
  resetTransientUi();
  loadPosSold();
}


// ------------------ Save, clear, delete ------------------

function shouldPromptForMotifBreakdown() {
  return Boolean(motifChargePayload && motifChargePayload.detected && !hasCompleteMotifBreakdown());
}

function submitPosSave() {
  if (!posSaveForm || !goDailySummaryBtn || goDailySummaryBtn.disabled) return;
  goDailySummaryBtn.disabled = true;
  goDailySummaryBtn.textContent = 'Saving...';
  goDailySummaryBtn.classList.add('cursor-not-allowed', 'opacity-70');
  posSaveForm.submit();
}

function handleGoDailySummary(event) {
  event.preventDefault();
  let savingDate = reportDateInput ? reportDateInput.value : POS_STATE.selected_report_date;
  if (shouldPromptForMotifBreakdown()) {
    notifyPos('Additional Charge for Motif was detected. You can save POS Sold now and complete the breakdown later in InvenSync.', 'warning');
  }
  setFieldValues(['pos-save-motif-json'], storageGet(motifBreakdownKey) || '');
  setFieldValues(['pos-save-redirect-to'], 'pos_sold');

  if (typeof showConfirmationModal === 'function') {
    showConfirmationModal({
      title: 'Save POS Sold?',
      size: 'large',
      modalWidth: '980px',
      messageHtml: `
        <div class="rounded-3xl border border-amber-200 bg-amber-50 px-8 py-7 text-left">
          <p class="text-base font-bold uppercase tracking-wide text-amber-700">Saving Date Indicator</p>
          <p class="mt-3 text-4xl font-extrabold leading-tight text-slate-900">You are saving for the day of: ${formatReportDateLong(savingDate)}</p>
          <p class="mt-3 text-lg text-slate-600">This follows the date selected in the calendar.</p>
        </div>
        <p class="mt-7 text-xl text-slate-700">Saving will permanently store the scanned POS Sold data and reflect it in InvenSync. A <strong>Next</strong> button will appear to proceed to the Daily Report.</p>
      `,
      confirmText: 'Yes, Save',
      cancelText: 'Cancel',
      onConfirm: submitPosSave
    });
    return;
  }
  if (window.confirm('Save POS Sold for ' + formatReportDateLong(savingDate) + '?')) {
    submitPosSave();
  }
}

function handleClearPosInline() {
  storageRemove(motifBreakdownKey);
  if (clearPosInlineForm) clearPosInlineForm.submit();
}

function submitDeleteAll() {
  if (deleteAllForm) deleteAllForm.submit();
}

function handleDeleteAll() {
  let dateValue = POS_STATE.selected_report_date || POS_STATE.today;
  let message = 'Delete ALL saved POS Sold records for ' + dateValue + '? Sold quantities in InvenSync will be cleared.';
  if (typeof showConfirmationModal === 'function') {
    showConfirmationModal({
      title: 'Delete All POS Sold?',
      message: message,
      confirmText: 'Yes, Delete All',
      cancelText: 'Cancel',
      onConfirm: submitDeleteAll
    });
    return;
  }
  if (window.confirm(message)) {
    submitDeleteAll();
  }
}

function handleZReadingChange() {
  let selectedFile = zReadingRequiredInput.files && zReadingRequiredInput.files[0];
  let preview = byId('z-reading-local-preview');
  if (!selectedFile) {
    setVisible(preview, false);
    return;
  }
  let previewImg = byId('z-reading-local-preview-img');
  if (previewImg) previewImg.src = URL.createObjectURL(selectedFile);
  setText('z-reading-local-preview-name', selectedFile.name || '');
  setVisible(preview, true);
}


// ------------------ Motif breakdown ------------------

function findMotifProductOption(productName) {
  let normalizedName = String(productName || '').trim().toLowerCase();
  if (!normalizedName) return null;
  return (motifProductOptions || []).find(function(product) {
    return String(product.description || '').trim().toLowerCase() === normalizedName;
  }) || null;
}

function setMotifFieldsDisabled(row, disabled) {
  row.querySelectorAll('.pos-motif-qty-input, .pos-motif-price-input, .pos-motif-discount-input').forEach(function(input) {
    if (disabled) {
      input.value = '';
    }
    input.disabled = disabled;
    input.classList.toggle('bg-slate-100', disabled);
    input.classList.toggle('text-slate-400', disabled);
    input.classList.toggle('cursor-not-allowed', disabled);
  });
}

function resetMotifRow(row) {
  if (!row) return;
  let productInput = row.querySelector('.pos-motif-product-input');
  if (productInput) {
    productInput.value = '';
    productInput.classList.remove('border-red-300');
    productInput.title = '';
  }
  setMotifFieldsDisabled(row, true);
}

function disableMotifRowFields(row) {
  if (!row) return;
  setMotifFieldsDisabled(row, true);
}

function enableMotifRow(row) {
  if (!row) return;
  row.querySelectorAll('.pos-motif-qty-input, .pos-motif-price-input, .pos-motif-discount-input').forEach(function(input) {
    input.disabled = false;
    input.classList.remove('bg-slate-100', 'text-slate-400', 'cursor-not-allowed');
  });
  let priceInput = row.querySelector('.pos-motif-price-input');
  if (priceInput) {
    priceInput.readOnly = true;
    priceInput.classList.add('bg-slate-100', 'text-slate-600', 'cursor-not-allowed');
  }
}

function recalculateMotifPrice(row) {
  if (!row) return;
  let productInput = row.querySelector('.pos-motif-product-input');
  let selectedProduct = findMotifProductOption(productInput ? productInput.value : '');
  let priceInput = row.querySelector('.pos-motif-price-input');
  if (!priceInput) return;
  if (!selectedProduct) {
    priceInput.value = '';
    return;
  }
  let quantity = Math.max(0, Number((row.querySelector('.pos-motif-qty-input') || {}).value || 0));
  let discount = Math.max(0, Number((row.querySelector('.pos-motif-discount-input') || {}).value || 0));
  priceInput.value = Math.max(0, (Number(selectedProduct.price || 0) * quantity) - discount).toFixed(2);
}

function getMotifDropdown(input) {
  let cell = input ? input.closest('td') : null;
  return cell ? cell.querySelector('.pos-motif-product-dropdown') : null;
}

function hidePosMotifProductDropdown(input) {
  let dropdown = getMotifDropdown(input);
  if (dropdown) dropdown.classList.add('hidden');
}

function hideAllMotifDropdowns() {
  document.querySelectorAll('.pos-motif-product-input').forEach(hidePosMotifProductDropdown);
}

function positionPosMotifProductDropdown(input, dropdown) {
  if (!input || !dropdown) return;
  let rect = input.getBoundingClientRect();
  dropdown.style.left = rect.left + 'px';
  dropdown.style.top = (rect.bottom + 4) + 'px';
  dropdown.style.width = rect.width + 'px';
}

function renderPosMotifProductDropdown(input) {
  let dropdown = getMotifDropdown(input);
  if (!input || !dropdown) return;
  let query = String(input.value || '').trim().toLowerCase();
  let products = (motifProductOptions || [])
    .filter(function(product) {
      let description = String(product.description || '').toLowerCase();
      let code = String(product.code || '').toLowerCase();
      return !query || description.includes(query) || code.includes(query);
    })
    .slice(0, 80);

  dropdown.innerHTML = '';
  positionPosMotifProductDropdown(input, dropdown);
  if (!products.length) {
    let empty = document.createElement('div');
    empty.className = 'px-3 py-2 text-sm text-slate-500';
    empty.textContent = 'No product found';
    dropdown.appendChild(empty);
    dropdown.classList.remove('hidden');
    return;
  }

  products.forEach(function(product) {
    let button = document.createElement('button');
    button.type = 'button';
    button.className = 'pos-motif-option block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 hover:text-slate-950';
    button.dataset.description = product.description || '';
    let name = document.createElement('span');
    name.className = 'font-semibold';
    name.textContent = product.description || '';
    let meta = document.createElement('span');
    meta.className = 'mt-0.5 block text-[11px] text-slate-500';
    meta.textContent = (product.code || '-') + ' · ' + formatPeso(product.price || 0);
    button.appendChild(name);
    button.appendChild(meta);
    dropdown.appendChild(button);
  });
  dropdown.classList.remove('hidden');
}

function syncMotifProductInput(input, options) {
  let settings = options || {};
  let row = input.closest('tr');
  let selectedProduct = findMotifProductOption(input.value);
  input.classList.toggle('border-red-300', Boolean(input.value.trim()) && !selectedProduct);
  input.title = selectedProduct
    ? 'Product Master Code: ' + (selectedProduct.code || '-')
    : (input.value.trim() ? 'Select a product from Product Master' : '');
  if (!selectedProduct) {
    if (settings.clearInvalid) {
      resetMotifRow(row);
    } else {
      disableMotifRowFields(row);
    }
    return;
  }
  enableMotifRow(row);
  let qtyInput = row.querySelector('.pos-motif-qty-input');
  if (qtyInput && !qtyInput.value) qtyInput.value = '1';
  recalculateMotifPrice(row);
}

function readMotifRows() {
  let modal = byId('pos-motif-breakdown-modal');
  if (!modal) return [];
  return Array.from(modal.querySelectorAll('tbody tr')).map(function(row) {
    let productInput = row.querySelector('.pos-motif-product-input');
    let selectedProduct = findMotifProductOption(productInput ? productInput.value : '');
    let group = row.closest('.pos-motif-group');
    return {
      product: selectedProduct ? selectedProduct.description : '',
      product_id: selectedProduct ? selectedProduct.id : null,
      product_code: selectedProduct ? selectedProduct.code : null,
      motif_index: Number(row.dataset.motifIndex || (group ? group.dataset.motifIndex : 1) || 1),
      row_index: Number(row.dataset.rowIndex || 1),
      quantity: Number((row.querySelector('.pos-motif-qty-input') || {}).value || 0),
      unit_price: Number(selectedProduct ? selectedProduct.price : 0),
      price: Number((row.querySelector('.pos-motif-price-input') || {}).value || 0),
      discount: Number((row.querySelector('.pos-motif-discount-input') || {}).value || 0)
    };
  });
}

function loadMotifRows() {
  let modal = byId('pos-motif-breakdown-modal');
  if (!modal) return false;
  let saved = null;
  try {
    saved = JSON.parse(storageGet(motifBreakdownKey) || 'null');
  } catch (error) {
    saved = null;
  }
  if (!saved || !Array.isArray(saved.rows)) return false;
  Array.from(modal.querySelectorAll('tbody tr')).forEach(function(row, index) {
    let savedRow = saved.rows.find(function(item) {
      return Number(item.motif_index || 1) === Number(row.dataset.motifIndex || 1)
        && Number(item.row_index || 1) === Number(row.dataset.rowIndex || 1);
    }) || saved.rows[index] || {};
    let productInput = row.querySelector('.pos-motif-product-input');
    let qtyInput = row.querySelector('.pos-motif-qty-input');
    let priceInput = row.querySelector('.pos-motif-price-input');
    let discountInput = row.querySelector('.pos-motif-discount-input');
    if (productInput) productInput.value = savedRow.product || '';
    if (qtyInput) qtyInput.value = savedRow.quantity || '';
    if (priceInput) priceInput.value = savedRow.price || '';
    if (discountInput) discountInput.value = savedRow.discount || '';
    if (productInput) syncMotifProductInput(productInput);
  });
  return true;
}

function buildMotifGroups(quantity) {
  motifGroupsEl.innerHTML = '';
  for (let motifNum = 1; motifNum <= quantity; motifNum += 1) {
    let group = cloneTemplate('tmpl-motif-group');
    group.dataset.motifIndex = String(motifNum);
    fillCell(group, 'motif-number', motifNum);
    let rowsBody = group.querySelector('[data-cell="rows"]');
    for (let rowNum = 1; rowNum <= 3; rowNum += 1) {
      let row = cloneTemplate('tmpl-motif-row');
      row.dataset.motifIndex = String(motifNum);
      row.dataset.rowIndex = String(rowNum);
      rowsBody.appendChild(row);
    }
    motifGroupsEl.appendChild(group);
  }
}

function renderMotifModal() {
  let modal = byId('pos-motif-breakdown-modal');
  motifChargePayload = null;
  motifProductOptions = [];
  motifGroupsEl.innerHTML = '';
  if (!modal) return false;
  if (!isStoreManager() || !POS_STATE.motif_charge_payload) {
    modal.classList.add('hidden');
    return false;
  }
  motifChargePayload = POS_STATE.motif_charge_payload;
  motifProductOptions = POS_STATE.motif_product_options || [];
  setText('pos-motif-quantity', motifChargePayload.quantity);
  buildMotifGroups(parseInt(motifChargePayload.quantity, 10) || 0);
  if (!motifChargePayload.detected) return false;
  modal.querySelectorAll('tbody tr').forEach(resetMotifRow);
  return loadMotifRows();
}

function handleMotifAutoOpen(hasSavedMotifRows) {
  if (!motifChargePayload || !motifChargePayload.detected) return;
  if (POS_STATE.pos_scan_success && !hasSavedMotifRows) {
    setTimeout(openMotifAndShowGuide, 250);
  }
}

function openMotifAndShowGuide() {
  openMotifModal();
  showMotifGuideStartModal();
}

function openMotifModal() {
  let modal = byId('pos-motif-breakdown-modal');
  if (!modal) return;
  loadMotifRows();
  modal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
}

function closeMotifModal() {
  let modal = byId('pos-motif-breakdown-modal');
  if (!modal) return;
  clearMotifGuide();
  hideMotifGuideStartModal();
  hideAllMotifDropdowns();
  modal.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
}

function saveMotifRows() {
  let rows = readMotifRows();
  let filledRows = rows.filter(function(row) { return row.product_id; });
  if (filledRows.length === 0) {
    storageRemove(motifBreakdownKey);
    notifyPos('Motif breakdown cleared for this store/date.', 'info');
    closeMotifModal();
    return;
  }
  if (filledRows.length === 1) {
    notifyPos('Please select at least 2 Product Master items for the motif breakdown.', 'warning');
    return;
  }
  let invalidGroups = Array.from(document.querySelectorAll('#pos-motif-groups .pos-motif-group')).filter(function(group) {
    let groupRows = filledRows.filter(function(row) {
      return Number(row.motif_index || 1) === Number(group.dataset.motifIndex || 1);
    });
    return groupRows.length < 2;
  });
  if (invalidGroups.length) {
    notifyPos('Each Motif # must have at least 2 Product Master items, or clear all rows to remove the breakdown.', 'warning');
    return;
  }
  if (filledRows.some(function(row) { return !Number(row.quantity || 0); })) {
    notifyPos('Please enter Sold Qty for each motif product.', 'warning');
    return;
  }
  storageSet(motifBreakdownKey, JSON.stringify({
    saved_at: new Date().toISOString(),
    pos_payload: motifChargePayload,
    rows: rows.map(function(row) {
      if (row.product_id) return row;
      return {
        product: '',
        product_id: null,
        product_code: null,
        motif_index: row.motif_index,
        row_index: row.row_index,
        quantity: 0,
        unit_price: 0,
        price: 0,
        discount: 0
      };
    })
  }));
  notifyPos('Motif breakdown saved. It will reflect in InvenSync for this store/date.', 'success');
  closeMotifModal();
}

function hasCompleteMotifBreakdown() {
  if (!motifChargePayload || !motifChargePayload.detected) return true;
  let saved = null;
  try {
    saved = JSON.parse(storageGet(motifBreakdownKey) || 'null');
  } catch (error) {
    return false;
  }
  if (!saved || !Array.isArray(saved.rows)) return false;
  if (Number((saved.pos_payload || {}).quantity || 0) !== Number(motifChargePayload.quantity || 0)) return false;
  let expectedMotifCount = Math.max(1, Number(motifChargePayload.quantity || 0));
  for (let motifIndex = 1; motifIndex <= expectedMotifCount; motifIndex += 1) {
    let completedRows = saved.rows.filter(function(row) {
      return Number((row || {}).motif_index || 1) === motifIndex
        && Boolean((row || {}).product_id)
        && Number((row || {}).quantity || 0) > 0;
    });
    if (completedRows.length < 2 || completedRows.length > 3) return false;
  }
  return true;
}

function handleMotifGroupsInput(event) {
  let target = event.target;
  if (target.matches('.pos-motif-product-input')) {
    renderPosMotifProductDropdown(target);
    syncMotifProductInput(target);
    return;
  }
  if (target.matches('.pos-motif-qty-input, .pos-motif-discount-input')) {
    recalculateMotifPrice(target.closest('tr'));
  }
}

function handleMotifGroupsChange(event) {
  let target = event.target;
  if (target.matches('.pos-motif-product-input')) {
    syncMotifProductInput(target, { clearInvalid: true });
    return;
  }
  if (target.matches('.pos-motif-qty-input, .pos-motif-discount-input')) {
    recalculateMotifPrice(target.closest('tr'));
  }
}

function handleMotifGroupsFocusIn(event) {
  if (event.target.matches('.pos-motif-product-input')) {
    renderPosMotifProductDropdown(event.target);
  }
}

function hideMotifDropdownLater(input) {
  hidePosMotifProductDropdown(input);
}

function handleMotifGroupsFocusOut(event) {
  let target = event.target;
  if (target.matches('.pos-motif-product-input')) {
    setTimeout(hideMotifDropdownLater, 150, target);
  }
}

function handleMotifGroupsMouseDown(event) {
  let option = event.target.closest('.pos-motif-option');
  if (!option) return;
  event.preventDefault();
  let cell = option.closest('td');
  let input = cell ? cell.querySelector('.pos-motif-product-input') : null;
  if (!input) return;
  input.value = option.dataset.description || '';
  hidePosMotifProductDropdown(input);
  syncMotifProductInput(input, { clearInvalid: true });
}

function handleMotifGroupsClick(event) {
  let button = event.target.closest('.clear-pos-motif-row');
  if (!button) return;
  resetMotifRow(button.closest('tr'));
}


// ------------------ Motif guide ------------------

function getMotifGuideStartModal() {
  return byId('pos-motif-guide-start-modal');
}

function showMotifGuideStartModal() {
  let modal = getMotifGuideStartModal();
  if (!modal || storageGet(motifGuideSeenKey) === '1') return;
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
  let modal = byId('pos-motif-breakdown-modal');
  if (!modal) return null;
  let firstRow = modal.querySelector('tbody tr[data-motif-index="1"][data-row-index="1"]');
  let priceDiscountFields = [
    firstRow ? firstRow.querySelector('.pos-motif-price-input') : null,
    firstRow ? firstRow.querySelector('.pos-motif-discount-input') : null
  ].filter(Boolean);
  let steps = [
    {
      elements: [firstRow ? firstRow.querySelector('.pos-motif-product-input') : null],
      text: 'Type the product included in this motif, then select it from Product Master.',
      placement: 'right',
      nextText: 'Next'
    },
    {
      elements: [firstRow ? firstRow.querySelector('.pos-motif-qty-input') : null],
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
      elements: [byId('pos-motif-save-btn')],
      text: 'Click Save Breakdown so the motif products reflect in the InvenSync Sold column.',
      placement: 'top',
      nextText: 'Finish'
    }
  ];
  return steps[motifGuideStepIndex] || null;
}

function removeMotifPanels() {
  document.querySelectorAll('.motif-tour-panel').forEach(function(panel) {
    panel.remove();
  });
  document.querySelectorAll('.motif-tour-label').forEach(function(label) {
    label.remove();
  });
}

function clearMotifGuide() {
  motifGuideActive = false;
  motifGuideStepIndex = 0;
  removeMotifPanels();
  document.querySelectorAll('.motif-tour-target').forEach(function(el) {
    el.classList.remove('motif-tour-target');
  });
}

function applyMotifGuideTarget() {
  document.querySelectorAll('.motif-tour-target').forEach(function(el) {
    el.classList.remove('motif-tour-target');
  });
  let step = getMotifGuideStep();
  if (!step) return;
  step.elements.forEach(function(el) {
    if (el) el.classList.add('motif-tour-target');
  });
}

function renderMotifGuideSpotlight() {
  removeMotifPanels();
  let step = getMotifGuideStep();
  if (!step) {
    storageSet(motifGuideSeenKey, '1');
    clearMotifGuide();
    return;
  }
  let rect = getElementGroupRect(step.elements);
  if (!rect) return;
  [
    { top: 0, left: 0, width: window.innerWidth, height: rect.top },
    { top: rect.bottom, left: 0, width: window.innerWidth, height: window.innerHeight - rect.bottom },
    { top: rect.top, left: 0, width: rect.left, height: rect.bottom - rect.top },
    { top: rect.top, left: rect.right, width: window.innerWidth - rect.right, height: rect.bottom - rect.top }
  ].forEach(function(panel) {
    let el = document.createElement('div');
    el.className = 'motif-tour-panel';
    el.style.top = panel.top + 'px';
    el.style.left = panel.left + 'px';
    el.style.width = Math.max(0, panel.width) + 'px';
    el.style.height = Math.max(0, panel.height) + 'px';
    document.body.appendChild(el);
  });

  let label = document.createElement('div');
  label.className = 'motif-tour-label';
  let message = document.createElement('div');
  message.textContent = step.text;
  let nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.textContent = step.nextText;
  nextButton.addEventListener('click', nextMotifGuideStep);
  label.appendChild(message);
  label.appendChild(nextButton);

  if (step.placement === 'top') {
    label.style.left = Math.max(16, Math.min(rect.left, window.innerWidth - 376)) + 'px';
    label.style.top = Math.max(24, rect.top - 130) + 'px';
  } else if (step.placement === 'left') {
    label.style.left = Math.max(16, rect.left - 380) + 'px';
    label.style.top = Math.max(24, rect.top) + 'px';
  } else if (step.placement === 'bottom') {
    label.style.left = Math.max(16, Math.min(rect.left, window.innerWidth - 376)) + 'px';
    label.style.top = Math.min(window.innerHeight - 120, rect.bottom + 18) + 'px';
  } else {
    let labelLeft = rect.right + 24;
    let hasRightSpace = labelLeft + 320 <= window.innerWidth;
    label.style.left = (hasRightSpace ? labelLeft : Math.max(16, rect.left - 340)) + 'px';
    label.style.top = Math.max(24, rect.top) + 'px';
  }
  document.body.appendChild(label);
}

function showMotifGuideStep() {
  let step = getMotifGuideStep();
  if (!step) {
    storageSet(motifGuideSeenKey, '1');
    clearMotifGuide();
    return;
  }
  let target = step.elements.find(function(el) {
    return el && el.offsetParent !== null;
  });
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
  setTimeout(applyAndRenderMotifGuide, 350);
}

function applyAndRenderMotifGuide() {
  applyMotifGuideTarget();
  renderMotifGuideSpotlight();
}

function nextMotifGuideStep() {
  motifGuideStepIndex += 1;
  showMotifGuideStep();
}

function startMotifGuide() {
  hideMotifGuideStartModal();
  storageSet(motifGuideSeenKey, '1');
  clearMotifGuide();
  motifGuideActive = true;
  motifGuideStepIndex = 0;
  showMotifGuideStep();
}


// ------------------ POS help tour ------------------

function getPosTourSteps() {
  let sm = isStoreManager();
  let locked = Boolean(POS_STATE.pos_sold_locked);
  let source = POS_STATE.pos_sold_source;
  let hasItems = (POS_STATE.pos_sold_items || []).length > 0;
  let savedOrStaged = source === 'staged' || source === 'saved';
  let draftWithItems = source === 'draft' && hasItems;
  let hasZLink = Boolean(POS_STATE.z_reading && POS_STATE.z_reading.link);
  let nextTarget = draftWithItems ? goDailySummaryBtn : byId('pos-tour-next-target');

  let steps = [
    {
      available: sm && !locked,
      elements: [byId('pos-file-guide-target')],
      text: 'Choose the POS Excel file for this report date.',
      placement: 'bottom',
      nextText: 'Next',
      showSample: false
    },
    {
      available: sm && !savedOrStaged && !draftWithItems,
      elements: [byId('pos-scan-guide-target')],
      text: 'Click Scan Data to extract the POS sold rows.',
      placement: 'left',
      nextText: 'Next',
      showSample: false
    },
    {
      available: sm,
      elements: [byId('pos-tour-sample-card')],
      text: 'After scanning, extracted POS rows will appear here for preview.',
      placement: 'bottom-right',
      align: 'right',
      nextText: 'Next',
      showSample: true
    },
    {
      available: sm,
      elements: [nextTarget],
      text: 'Click Next to permanently store the scanned POS Sold rows and proceed to the Daily Report.',
      placement: 'bottom',
      nextText: 'Next',
      showSample: true
    },
    {
      available: sm && !hasZLink && !locked,
      elements: [zReadingRequiredInput],
      text: 'Z Reading image is optional for now and can be uploaded later.',
      placement: 'top',
      nextText: 'Finish',
      showSample: true
    }
  ];
  return steps.filter(function(step) { return step.available; });
}

function getPosTourStep() {
  return getPosTourSteps()[posTourStepIndex] || null;
}

function removePosTourPanels() {
  document.querySelectorAll('.pos-tour-panel').forEach(function(panel) {
    panel.remove();
  });
  document.querySelectorAll('.pos-tour-label').forEach(function(label) {
    label.remove();
  });
}

function clearPosTour() {
  posTourActive = false;
  posTourStepIndex = 0;
  removePosTourPanels();
  document.querySelectorAll('.pos-tour-target').forEach(function(el) {
    el.classList.remove('pos-tour-target');
  });
  setVisible(byId('pos-tour-sample-card'), false);
}

function applyPosTourTarget() {
  document.querySelectorAll('.pos-tour-target').forEach(function(el) {
    el.classList.remove('pos-tour-target');
  });
  let step = getPosTourStep();
  if (!step) return;
  step.elements.forEach(function(el) {
    if (el) el.classList.add('pos-tour-target');
  });
}

function renderPosTourSpotlight() {
  removePosTourPanels();
  let step = getPosTourStep();
  if (!step) {
    clearPosTour();
    return;
  }
  let rect = getElementGroupRect(step.elements);
  if (!rect) return;

  [
    { top: 0, left: 0, width: window.innerWidth, height: rect.top },
    { top: rect.bottom, left: 0, width: window.innerWidth, height: window.innerHeight - rect.bottom },
    { top: rect.top, left: 0, width: rect.left, height: rect.bottom - rect.top },
    { top: rect.top, left: rect.right, width: window.innerWidth - rect.right, height: rect.bottom - rect.top }
  ].forEach(function(panel) {
    let el = document.createElement('div');
    el.className = 'pos-tour-panel';
    el.style.top = panel.top + 'px';
    el.style.left = panel.left + 'px';
    el.style.width = Math.max(0, panel.width) + 'px';
    el.style.height = Math.max(0, panel.height) + 'px';
    document.body.appendChild(el);
  });

  let label = document.createElement('div');
  label.className = 'pos-tour-label';
  let message = document.createElement('div');
  message.textContent = step.text;
  let nextButton = document.createElement('button');
  nextButton.type = 'button';
  nextButton.textContent = step.nextText;
  nextButton.addEventListener('click', nextPosTourStep);
  label.appendChild(message);
  label.appendChild(nextButton);
  if (step.align === 'right') {
    label.style.textAlign = 'right';
  }

  if (step.placement === 'bottom') {
    label.style.left = Math.max(16, Math.min(rect.left, window.innerWidth - 376)) + 'px';
    label.style.top = Math.min(window.innerHeight - 120, rect.bottom + 18) + 'px';
  } else if (step.placement === 'bottom-right') {
    label.style.left = Math.max(16, Math.min(rect.right - 360, window.innerWidth - 376)) + 'px';
    label.style.top = Math.min(window.innerHeight - 120, rect.bottom + 18) + 'px';
  } else if (step.placement === 'top') {
    label.style.left = Math.max(16, Math.min(rect.left, window.innerWidth - 376)) + 'px';
    label.style.top = Math.max(24, rect.top - 118) + 'px';
  } else if (step.placement === 'left') {
    label.style.left = Math.max(16, rect.left - 380) + 'px';
    label.style.top = Math.max(24, rect.top) + 'px';
  } else {
    let labelLeft = rect.right + 24;
    let hasRightSpace = labelLeft + 320 <= window.innerWidth;
    label.style.left = (hasRightSpace ? labelLeft : Math.max(16, rect.left - 340)) + 'px';
    label.style.top = Math.max(24, rect.top + Math.min(96, Math.max(0, (rect.bottom - rect.top) / 3))) + 'px';
  }
  document.body.appendChild(label);
}

function applyAndRenderPosTour() {
  applyPosTourTarget();
  renderPosTourSpotlight();
}

function showPosTourStep() {
  let step = getPosTourStep();
  if (!step) {
    clearPosTour();
    return;
  }
  setVisible(byId('pos-tour-sample-card'), step.showSample);
  let target = step.elements.find(function(el) {
    return el && el.offsetParent !== null;
  });
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }
  setTimeout(applyAndRenderPosTour, 350);
}

function nextPosTourStep() {
  posTourStepIndex += 1;
  if (!getPosTourStep()) {
    storageSet(posTourCompletionKey, '1');
    clearPosTour();
    return;
  }
  showPosTourStep();
}

function startPosTour(force) {
  if (!force && !shouldShowPosTour) return;
  setVisible(byId('pos-tour-start-modal'), false);
  clearPosTour();
  posTourActive = true;
  posTourStepIndex = 0;
  showPosTourStep();
}

function handlePosTourStart() {
  startPosTour(isPosGuideMode);
}

function handlePosTourHelp() {
  startPosTour(true);
}


// ------------------ Window listeners ------------------

function handleWindowResize() {
  hideAllMotifDropdowns();
  if (motifGuideActive) renderMotifGuideSpotlight();
  if (posTourActive) renderPosTourSpotlight();
}

function handleDocumentScroll(event) {
  if (event.target && event.target.closest && event.target.closest('#pos-motif-breakdown-modal')) {
    hideAllMotifDropdowns();
  }
  if (motifGuideActive) renderMotifGuideSpotlight();
}

function handleWindowScroll() {
  if (posTourActive) renderPosTourSpotlight();
}


// ------------------ Event binding ------------------

if (reportDateInput) {
  reportDateInput.addEventListener('change', handleReportDateChange);
  reportDateInput.addEventListener('input', syncPosDateFields);
}
if (posFileInput) posFileInput.addEventListener('change', updatePosFileLabel);
if (zReadingRequiredInput) zReadingRequiredInput.addEventListener('change', handleZReadingChange);
if (clearPosInlineBtn) clearPosInlineBtn.addEventListener('click', handleClearPosInline);
if (deleteAllBtn) deleteAllBtn.addEventListener('click', handleDeleteAll);
if (goDailySummaryBtn) goDailySummaryBtn.addEventListener('click', handleGoDailySummary);
if (missingDatesGoBtn) missingDatesGoBtn.addEventListener('click', handleMissingDatesGo);
if (posTourStartBtn) posTourStartBtn.addEventListener('click', handlePosTourStart);
if (posTourHelpBtn) posTourHelpBtn.addEventListener('click', handlePosTourHelp);

let motifGuideStartBtn = byId('pos-motif-guide-start-btn');
let motifCloseBtn = byId('pos-motif-close-btn');
let motifSaveBtn = byId('pos-motif-save-btn');
if (motifGuideStartBtn) motifGuideStartBtn.addEventListener('click', startMotifGuide);
if (motifCloseBtn) motifCloseBtn.addEventListener('click', closeMotifModal);
if (motifSaveBtn) motifSaveBtn.addEventListener('click', saveMotifRows);

if (motifGroupsEl) {
  motifGroupsEl.addEventListener('input', handleMotifGroupsInput);
  motifGroupsEl.addEventListener('change', handleMotifGroupsChange);
  motifGroupsEl.addEventListener('focusin', handleMotifGroupsFocusIn);
  motifGroupsEl.addEventListener('focusout', handleMotifGroupsFocusOut);
  motifGroupsEl.addEventListener('mousedown', handleMotifGroupsMouseDown);
  motifGroupsEl.addEventListener('click', handleMotifGroupsClick);
}

window.addEventListener('resize', handleWindowResize);
window.addEventListener('scroll', handleWindowScroll, { passive: true });
window.addEventListener('popstate', handlePopState);
document.addEventListener('scroll', handleDocumentScroll, true);

applyFormActions();
loadPosSold();
