let ROW_ID_PLACEHOLDER = '987654321';
let BASE_TYPE_OPTIONS = ['Product Transfer', 'Wastage Transfer', 'EGI Plant Transfer', 'Supplies Request'];
let STATUS_OPTIONS = ['Pending', 'Received', 'Received - Short', 'Received - Over', 'Received - Short/Over'];

let transferId = '';
let storeOptions = [];
let productPriceMap = {};
let currentTransferTo = '';
let nextTarget = 'taf';

let tafForm = document.getElementById('taf-edit-form');
let loadingPanel = document.getElementById('taf-loading');
let errorPanel = document.getElementById('taf-load-error');
let errorMessage = document.getElementById('taf-load-error-message');
let errorBack = document.getElementById('taf-error-back');
let contentPanel = document.getElementById('taf-content');
let itemRows = document.getElementById('item-rows');
let typeSelect = document.getElementById('taf-transaction-type');
let statusSelect = document.getElementById('taf-status');
let transferToSelect = document.getElementById('taf-transfer-to');
let discountInput = document.getElementById('discount_percent');
let saveBtn = document.getElementById('save-taf-btn');
let addItemBtn = document.getElementById('add-item-btn');
let presetButtons = document.querySelectorAll('.discount-preset-btn');

// - Helpers -

function routeFor(template, id) {
  return template.replace(ROW_ID_PLACEHOLDER, id);
}

function formatMoney(value) {
  return '₱' + value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseJson(response) {
  return response.json();
}

function setValue(id, value) {
  let el = document.getElementById(id);
  if (el) el.value = (value === null || value === undefined) ? '' : value;
}

function setText(id, value) {
  let el = document.getElementById(id);
  if (el) el.textContent = value;
}

function statusBadgeClasses(status) {
  let base = 'px-2.5 py-1 text-xs font-bold rounded-md border ';
  if (status === 'Received') return base + 'bg-emerald-50 text-emerald-700 border-emerald-200';
  if (status && (status.indexOf('Short') !== -1 || status.indexOf('Over') !== -1)) return base + 'bg-amber-50 text-amber-700 border-amber-200';
  return base + 'bg-sky-50 text-sky-700 border-sky-200';
}

function showLoadError(message) {
  loadingPanel.classList.add('hidden');
  contentPanel.classList.add('hidden');
  errorPanel.classList.remove('hidden');
  errorMessage.textContent = message;
  errorBack.href = TAF_EDIT_ROUTES.tafList;
  toast.error(message);
}

// - Select Rendering -

function fillSelect(select, options, selectedValue) {
  select.innerHTML = '';
  for (let i = 0; i < options.length; i++) {
    let option = document.createElement('option');
    option.value = options[i];
    option.textContent = options[i];
    option.selected = options[i] === selectedValue;
    select.appendChild(option);
  }
}

function renderTypeOptions(transfer) {
  let options = BASE_TYPE_OPTIONS.slice();
  if (transfer.transaction_type === 'Charge Slip') options.push('Charge Slip');
  let selected = transfer.transaction_type;
  if (selected === 'Supplies Transfer') selected = 'EGI Plant Transfer';
  fillSelect(typeSelect, options, selected);
}

function renderCatalog(names) {
  let list = document.getElementById('product-catalog-options');
  list.innerHTML = '';
  for (let i = 0; i < names.length; i++) {
    let option = document.createElement('option');
    option.value = names[i];
    list.appendChild(option);
  }
}

// - Item Rows -

function setCell(row, name, value) {
  let el = row.querySelector('[data-cell="' + name + '"]');
  if (el) el.value = value;
}

function addItemRow(item) {
  let tmpl = document.getElementById('tmpl-item-row');
  let clone = tmpl.content.cloneNode(true);
  let row = clone.querySelector('tr');
  if (item) {
    setCell(row, 'item_id', item.id);
    setCell(row, 'item_name', item.item_name || '');
    setCell(row, 'unit_cost', Number(item.unit_cost || 0).toFixed(2));
    setCell(row, 'quantity', item.quantity || 0);
    setCell(row, 'received_quantity', (item.received_quantity === null || item.received_quantity === undefined) ? '' : item.received_quantity);
    setCell(row, 'line_total', Number(item.line_total || 0).toFixed(2));
    setCell(row, 'remarks', item.remarks || '');
  }
  itemRows.appendChild(clone);
}

function renderItems(items) {
  itemRows.innerHTML = '';
  for (let i = 0; i < items.length; i++) {
    addItemRow(items[i]);
  }
}

// - Type Sync & Totals -

function setDisplay(selector, value) {
  let nodes = document.querySelectorAll(selector);
  for (let i = 0; i < nodes.length; i++) {
    nodes[i].style.display = value;
  }
}

function syncTransferTypeFields() {
  let transactionType = typeSelect.value || '';
  let isChargeSlip = transactionType === 'Charge Slip';

  setDisplay('#to-field-group', isChargeSlip ? 'none' : '');
  setDisplay('#customer-name-group', isChargeSlip ? '' : 'none');
  setDisplay('#charge-type-group', isChargeSlip ? '' : 'none');
  setDisplay('#discount-section', isChargeSlip ? '' : 'none');
  setDisplay('#net-charges-section', isChargeSlip ? '' : 'none');
  setDisplay('#approved-by-group', '');
  setDisplay('.received-qty-col', isChargeSlip ? 'none' : '');

  if (!isChargeSlip) {
    if (transactionType === 'Wastage Transfer') {
      fillSelect(transferToSelect, ['Main Office'], 'Main Office');
    } else if (transactionType === 'EGI Plant Transfer' || transactionType === 'Supplies Transfer') {
      fillSelect(transferToSelect, ['EGI Plant'], 'EGI Plant');
    } else {
      let picked = transferToSelect.value;
      if (storeOptions.indexOf(picked) === -1) picked = currentTransferTo;
      if (storeOptions.indexOf(picked) === -1) picked = storeOptions[0];
      fillSelect(transferToSelect, storeOptions, picked);
    }
  }
  recalculateTotals();
}

function recalculateTotals() {
  let rows = itemRows.querySelectorAll('.item-row');
  let grandTotal = 0;

  for (let i = 0; i < rows.length; i++) {
    let costInput = rows[i].querySelector('.item-cost-input');
    let qtyInput = rows[i].querySelector('.item-qty-input');
    let lineTotalInput = rows[i].querySelector('.item-line-total');
    let cost = parseFloat(costInput ? costInput.value : 0) || 0;
    let qty = parseInt(qtyInput ? qtyInput.value : 0, 10) || 0;
    let lineTotal = cost * qty;
    if (lineTotalInput) lineTotalInput.value = lineTotal.toFixed(2);
    grandTotal += lineTotal;
  }

  setText('cs-grand-total', formatMoney(grandTotal));

  let discountPercent = parseFloat(discountInput.value || 0) || 0;
  let netCharges = Math.max(0, grandTotal - (grandTotal * (discountPercent / 100)));
  setText('cs-net-charges', formatMoney(netCharges));
}

// - Load -

function populateForm(data) {
  let transfer = data.transfer;
  storeOptions = [];
  for (let i = 0; i < data.stores.length; i++) {
    storeOptions.push(data.stores[i].name);
  }
  productPriceMap = data.product_price_map || {};
  currentTransferTo = transfer.transfer_to || '';

  setText('hdr-title', 'Edit ' + (transfer.transaction_type || 'TAF'));
  setText('hdr-control-no', '#' + (transfer.control_no || ''));
  let statusBadge = document.getElementById('hdr-status');
  statusBadge.textContent = transfer.status || 'Pending';
  statusBadge.className = statusBadgeClasses(transfer.status);
  setText('hdr-store', transfer.transfer_from || '');
  setValue('transfer_from_display', transfer.transfer_from);

  let isChargeSlip = transfer.transaction_type === 'Charge Slip';
  let backLink = document.getElementById('back-link');
  //backLink.href = isChargeSlip ? TAF_EDIT_ROUTES.chargeSlips : TAF_EDIT_ROUTES.tafList;
  backLink.textContent = isChargeSlip ? 'Back to Charge Slips' : 'Back to TAF List';
  document.getElementById('breadcrumb-taf-link').href = TAF_EDIT_ROUTES.tafList;
  // document.getElementById('cancel-link').href = TAF_EDIT_ROUTES.tafList;

  setValue('transaction_date', transfer.transaction_date);
  setValue('control_no', transfer.control_no);
  renderTypeOptions(transfer);
  fillSelect(statusSelect, STATUS_OPTIONS, transfer.status);
  fillSelect(transferToSelect, storeOptions, transfer.transfer_to);

  setValue('customer_name', transfer.customer_name || '');
  let chargeRadios = document.querySelectorAll('input[name="charge_type"]');
  for (let i = 0; i < chargeRadios.length; i++) {
    if (transfer.charge_type === 'Spoilage') {
      chargeRadios[i].checked = chargeRadios[i].value === 'Spoilage';
    } else {
      chargeRadios[i].checked = chargeRadios[i].value === 'Charge';
    }
  }
  setValue('discount_percent', Number(transfer.discount_percent || 0).toFixed(2));
  setValue('prepared_by_name', transfer.prepared_by_name || '');
  setValue('approved_by_name', transfer.approved_by_name || '');
  setValue('received_by_name', transfer.received_by_name || '');

  renderCatalog(data.product_names || []);
  renderItems(data.items || []);
  syncTransferTypeFields();

  loadingPanel.classList.add('hidden');
  errorPanel.classList.add('hidden');
  contentPanel.classList.remove('hidden');
}

function handleLoadResponse(data) {
  if (!data || data.type !== 'success') {
    showLoadError((data && data.message) || 'Unable to load this record.');
    return;
  }
  populateForm(data);
}

function handleLoadFailure() {
  showLoadError('Unable to load this record. Please try again.');
}

function loadTransfer() {
  let params = new URLSearchParams(window.location.search);
  transferId = params.get('id') || params.get('transfer_id') || '';
  if (!transferId) {
    showLoadError('No transfer selected.');
    return;
  }
  fetch(routeFor(TAF_EDIT_ROUTES.get, transferId))
    .then(parseJson)
    .then(handleLoadResponse)
    .catch(handleLoadFailure);
}

// - Save -

function setSaving(isSaving) {
  saveBtn.disabled = isSaving;
  let label = saveBtn.querySelector('[data-cell="save-label"]');
  label.innerHTML = isSaving ? SPINNER_HTML + 'Saving...' : 'Save Changes';
}

function goNext() {
  window.location.href = nextTarget === 'charge_slips' ? TAF_EDIT_ROUTES.chargeSlips : TAF_EDIT_ROUTES.tafList;
}

async function handleSaveResponse(data) {
  if (data && data.type === 'success') {
    toast.success(data.message || 'TAF updated successfully.');
    nextTarget = data.next || 'taf';
    //setTimeout(goNext, 700);
	
	await sleep(1000);
	
	window.history.back();
	
    return;
  }
  setSaving(false);
  toast.error((data && data.message) || 'Unable to update TAF.');
}

function handleSaveFailure() {
  setSaving(false);
  toast.error('Unable to update TAF. Please try again.');
}

function handleSubmit(event) {
  event.preventDefault();
  setSaving(true);
  fetch(routeFor(TAF_EDIT_ROUTES.update, transferId), {
    method: 'POST',
    body: new FormData(tafForm)
  })
    .then(parseJson)
    .then(handleSaveResponse)
    .catch(handleSaveFailure);
}

// - Events -

function handleAddItem() {
  addItemRow(null);
  syncTransferTypeFields();
}

function handleRowInput(event) {
  let target = event.target;

  if (target.classList.contains('item-name-input')) {
    let selectedVal = target.value.trim();
    let row = target.closest('tr');
    let costInput = row ? row.querySelector('.item-cost-input') : null;
    if (selectedVal && Object.prototype.hasOwnProperty.call(productPriceMap, selectedVal) && costInput) {
      let suggestedPrice = productPriceMap[selectedVal] || 0;
      if (!costInput.value || parseFloat(costInput.value) === 0) {
        costInput.value = suggestedPrice.toFixed(2);
      }
    }
  }

  if (target.classList.contains('item-cost-input') || target.classList.contains('item-qty-input') || target.classList.contains('item-name-input')) {
    recalculateTotals();
  }
}

function handleRowClick(event) {
  let removeBtn = event.target.closest('.remove-item');
  if (removeBtn) {
    removeBtn.closest('tr').remove();
    recalculateTotals();
  }
}

function handlePresetClick(event) {
  let discountVal = event.currentTarget.getAttribute('data-discount');
  if (discountVal !== null) {
    discountInput.value = discountVal;
    recalculateTotals();
  }
}

for (let i = 0; i < presetButtons.length; i++) {
  presetButtons[i].addEventListener('click', handlePresetClick);
}
addItemBtn.addEventListener('click', handleAddItem);
itemRows.addEventListener('input', handleRowInput);
itemRows.addEventListener('click', handleRowClick);
discountInput.addEventListener('input', recalculateTotals);
typeSelect.addEventListener('change', syncTransferTypeFields);
tafForm.addEventListener('submit', handleSubmit);

loadTransfer();
