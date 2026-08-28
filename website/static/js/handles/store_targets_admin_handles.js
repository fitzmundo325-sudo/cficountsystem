// -----------------------------------
// State
// -----------------------------------
let allClusters   = PAGE_CLUSTERS;
let allStores     = PAGE_STORES;
let activeStoreId = null;
let activeMonth   = null;
let activeStoreName = '';
let sheetCells    = [];
let selectedCell  = null;
let selectedCells = [];
let undoStack     = [];

// -----------------------------------
// Elements
// -----------------------------------
let clusterSelect   = document.getElementById('cluster-select');
let storeSelect     = document.getElementById('store-select');
let monthSelect     = document.getElementById('target-month-select');
let saveBtn         = document.getElementById('save-targets-btn');
let sheetPanel      = document.getElementById('target-sheet-panel');
let sheetLoading    = document.getElementById('sheet-loading');
let sheetTableWrap  = document.getElementById('sheet-table-wrap');
let sheetTbody      = document.getElementById('sheet-tbody');
let sheetStoreName  = document.getElementById('sheet-store-name');
let sheetSubtitle   = document.getElementById('sheet-subtitle');
let viewClusterBtn  = document.getElementById('view-cluster-data-btn');
let clearBtn        = document.getElementById('clear-selected-target-cell');
let tmplRow         = document.getElementById('tmpl-target-row');
let tmplOption      = document.getElementById('tmpl-option');

// -----------------------------------
// Init: restore URL params
// -----------------------------------
function initFromUrl() {
let params = new URLSearchParams(window.location.search);
let clusterId = params.get('cluster_id') || '';
let storeId   = params.get('store_id') || '';
let month     = params.get('target_month') || todayMonth();

monthSelect.value = month;
populateClusters(clusterId);
populateStores(clusterId, storeId);

if (storeId) {
  activeStoreId = storeId;
  activeMonth   = month;
  loadSheet();
}
}

// -----------------------------------
// Helpers
// -----------------------------------
function todayMonth() {
let d = new Date();
return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

function pushState(clusterId, storeId, month) {
let params = new URLSearchParams();
if (clusterId) params.set('cluster_id', clusterId);
if (storeId)   params.set('store_id', storeId);
if (month)     params.set('target_month', month);
history.pushState({}, '', window.location.pathname + '?' + params.toString());
}

function makeOption(value, label, selected) {
let clone = tmplOption.content.cloneNode(true);
let opt   = clone.querySelector('[data-cell="option"]');
opt.value       = value;
opt.textContent = label;
opt.selected    = !!selected;
return opt;
}

function displaySheetValue(value) {
let raw = String(value ?? '').trim();
if (!raw) return '';
let num = Number(raw.replace(/,/g, ''));
return Number.isFinite(num) && num === 0 ? '' : raw;
}

function normalizeNumber(value) {
let cleaned = String(value || '')
  .replace(/[,\s₱$]/g, '')
  .replace(/[^\d.-]/g, '');
if (!cleaned || cleaned === '-' || cleaned === '.') return '';
let num = Number(cleaned);
if (!Number.isFinite(num) || num < 0 || num === 0) return '';
return num.toFixed(2);
}

function draftKey(storeId, month) {
return 'admin-target-sheet-draft:' + storeId + ':' + month;
}

// -----------------------------------
// Cluster / Store Dropdowns
// -----------------------------------
function populateClusters(selectedId) {
clusterSelect.innerHTML = '';
clusterSelect.appendChild(makeOption('', '-- All Clusters --', !selectedId));
allClusters.forEach(function(c) {
  clusterSelect.appendChild(makeOption(c.id, c.name, String(c.id) === String(selectedId)));
});
}

function populateStores(clusterId, selectedId) {
let filtered = clusterId
  ? allStores.filter(function(s) { return String(s.cluster_id) === String(clusterId); })
  : allStores;

storeSelect.innerHTML = '';
storeSelect.appendChild(makeOption('', '-- Choose a Store --', !selectedId));
filtered.forEach(function(s) {
  storeSelect.appendChild(makeOption(s.id, s.name, String(s.id) === String(selectedId)));
});
}

clusterSelect.addEventListener('change', function() {
let clusterId = clusterSelect.value;
populateStores(clusterId, '');
pushState(clusterId, '', monthSelect.value);
hideSheet();
saveBtn.disabled = true;
});

storeSelect.addEventListener('change', function() {
let storeId   = storeSelect.value;
let clusterId = clusterSelect.value;
let month     = monthSelect.value;
pushState(clusterId, storeId, month);
if (storeId && month) {
  activeStoreId = storeId;
  activeMonth   = month;
  loadSheet();
} else {
  hideSheet();
  saveBtn.disabled = true;
}
});

monthSelect.addEventListener('change', function() {
let storeId   = storeSelect.value;
let clusterId = clusterSelect.value;
let month     = monthSelect.value;
pushState(clusterId, storeId, month);
if (storeId && month) {
  activeStoreId = storeId;
  activeMonth   = month;
  loadSheet();
}
});




// -----------------------------------
// Sheet Visibility
// -----------------------------------
function showSheet() {
sheetPanel.classList.remove('hidden');
}

function hideSheet() {
sheetPanel.classList.add('hidden');
sheetTbody.innerHTML = '';
sheetCells = [];
selectedCell  = null;
selectedCells = [];
undoStack     = [];
}

// -----------------------------------
// Load Sheet from API
// -----------------------------------
function loadSheet() {
	showSheet();
	sheetLoading.classList.remove('hidden');
	sheetTableWrap.classList.add('hidden');
	saveBtn.disabled = true;

	let store = allStores.find(function(s) { return String(s.id) === String(activeStoreId); });
	activeStoreName = store ? store.name : '';

	sheetStoreName.textContent = 'Target Data for ' + activeStoreName;
	sheetSubtitle.textContent  = activeMonth + ' monthly target sheet. Saved values reflect in Cluster Data by date and selected store.';

	qBuilder.server_address = '/apis/targets/sheet';

	qBuilder.sendQuery(
		onSheetLoaded,
		undefined,
		[
			{ name: 'store_id', value: activeStoreId },
			{ name: 'month',    value: activeMonth   },
		]
	);
}

function onSheetLoaded(res) {
let data = JSON.parse(res.responseText);
sheetLoading.classList.add('hidden');
sheetTableWrap.classList.remove('hidden');

if (data.type !== 'success') {
  sheetTbody.innerHTML = '<tr><td colspan="4" class="px-4 py-6 text-center text-sm text-red-500">' + (data.message || 'Failed to load targets.') + '</td></tr>';
  return;
}

let rows = data.rows || [];
let clusterDataUrl = data.cluster_data_url || '';

if (clusterDataUrl) {
  viewClusterBtn.href = clusterDataUrl;
  viewClusterBtn.classList.remove('hidden');
} else {
  viewClusterBtn.classList.add('hidden');
}

sheetTbody.innerHTML = '';
sheetCells = [];
selectedCell  = null;
selectedCells = [];
undoStack     = [];

rows.forEach(function(row, rowIndex) {
  let clone = tmplRow.content.cloneNode(true);
  let tr    = clone.querySelector('tr');

  let dateHeader = clone.querySelector('[data-cell="date-header"]');
  let dateHidden = clone.querySelector('[data-cell="date-hidden"]');
  let dateLabel  = clone.querySelector('[data-cell="date-label"]');
  let inputNet   = clone.querySelector('[data-cell="target-net"]');
  let inputLY    = clone.querySelector('[data-cell="last-year-net"]');
  let inputGBI   = clone.querySelector('[data-cell="gbi-target"]');

  dateHeader.dataset.rowHeader = rowIndex;
  dateHidden.value             = row.date;
  dateLabel.textContent        = row.date_label;

  inputNet.dataset.row = rowIndex;
  inputLY.dataset.row  = rowIndex;
  inputGBI.dataset.row = rowIndex;

  inputNet.value = displaySheetValue(row.target_net);
  inputLY.value  = displaySheetValue(row.last_year_net);
  inputGBI.value = displaySheetValue(row.gbi_target);

  sheetTbody.appendChild(clone);
  sheetCells.push(inputNet, inputLY, inputGBI);
});

restoreDraft(activeStoreId, activeMonth);
bindSheetEvents();
bindHeaderEvents();
saveBtn.disabled = false;
}

// -----------------------------------
// Draft (localStorage)
// -----------------------------------
function saveDraft() {
let key = draftKey(activeStoreId, activeMonth);
let payload = {
  storeId: activeStoreId,
  targetMonth: activeMonth,
  savedAt: new Date().toISOString(),
  values: sheetCells.map(function(cell) {
	return {
	  row: cell.dataset.row,
	  col: cell.dataset.col,
	  value: displaySheetValue(cell.value),
	};
  }),
};
try { localStorage.setItem(key, JSON.stringify(payload)); } catch(e) {}
}

function restoreDraft(storeId, month) {
let key = draftKey(storeId, month);
let payload = null;
try { payload = JSON.parse(localStorage.getItem(key) || 'null'); } catch(e) {}
if (!payload || !Array.isArray(payload.values)) return;
payload.values.forEach(function(item) {
  let cell = getCell(item.row, item.col);
  if (cell) cell.value = displaySheetValue(item.value);
});
}

function clearDraft(storeId, month) {
try { localStorage.removeItem(draftKey(storeId, month)); } catch(e) {}
}

// -----------------------------------
// Cell Lookup
// -----------------------------------
function getCell(row, col) {
return sheetTbody.querySelector('.target-sheet-input[data-row="' + row + '"][data-col="' + col + '"]');
}

function getCellsForRow(row) {
return sheetCells.filter(function(c) { return Number(c.dataset.row) === Number(row); });
}

function getCellsForColumn(col) {
return sheetCells.filter(function(c) { return Number(c.dataset.col) === Number(col); });
}

// -----------------------------------
// Selection
// -----------------------------------
function clearSelectionStyles() {
sheetCells.forEach(function(c) { c.classList.remove('is-selected', 'is-range-selected'); });
sheetTbody.querySelectorAll('.target-sheet-cell.is-selected, .target-sheet-cell.is-range-selected').forEach(function(td) {
  td.classList.remove('is-selected', 'is-range-selected');
});
sheetTbody.querySelectorAll('.target-sheet-header.is-selected').forEach(function(th) {
  th.classList.remove('is-selected');
});
}

function selectCells(nextCells, primaryCell, header) {
clearSelectionStyles();
selectedCells = (nextCells || []).filter(Boolean);
selectedCell  = primaryCell || selectedCells[0] || null;
selectedCells.forEach(function(c) {
  let cls = c === selectedCell ? 'is-selected' : 'is-range-selected';
  c.classList.add(cls);
  c.closest('.target-sheet-cell')?.classList.add(cls);
});
if (header) header.classList.add('is-selected');
}

function selectCell(cell) {
if (!cell) return;
selectCells([cell], cell);
}

function selectRow(row, header) {
let rowCells = getCellsForRow(row);
selectCells(rowCells, rowCells[0], header);
}

function selectColumn(col, header) {
let colCells = getCellsForColumn(col);
selectCells(colCells, colCells[0], header);
}

function selectAll(header) {
selectCells(sheetCells, sheetCells[0], header);
}

// -----------------------------------
// Undo
// -----------------------------------
function pushUndo(changes) {
let filtered = (changes || []).filter(function(ch) { return ch.cell && ch.before !== ch.after; });
if (!filtered.length) return;
undoStack.push(filtered);
}

function undoLastChange() {
let changes = undoStack.pop();
if (!changes) return;
changes.forEach(function(ch) {
  ch.cell.value = displaySheetValue(ch.before);
  ch.cell.dispatchEvent(new Event('input', { bubbles: true }));
});
saveDraft();
if (changes[0]?.cell) changes[0].cell.focus();
}

// -----------------------------------
// Clear
// -----------------------------------
function clearCells(cellsToClear) {
let changes = [];
(cellsToClear || []).forEach(function(cell) {
  if (!cell) return;
  let before = cell.value;
  cell.value = '';
  cell.dispatchEvent(new Event('input', { bubbles: true }));
  changes.push({ cell: cell, before: before, after: '' });
});
saveDraft();
pushUndo(changes);
}

function clearSelection() {
clearCells(selectedCells.length ? selectedCells : [selectedCell]);
}

// -----------------------------------
// Paste
// -----------------------------------
function pasteTable(startCell, clipboardText) {
let startRow = Number(startCell.dataset.row || 0);
let startCol = Number(startCell.dataset.col || 0);
let rows = String(clipboardText || '')
  .replace(/\r/g, '')
  .split('\n')
  .filter(function(r, i, arr) { return r.length || i < arr.length - 1; })
  .map(function(r) { return r.split('\t'); });

let changes = [];
rows.forEach(function(rowVals, rowOffset) {
  rowVals.forEach(function(val, colOffset) {
	let cell = getCell(startRow + rowOffset, startCol + colOffset);
	if (cell) {
	  let before = cell.value;
	  let after  = normalizeNumber(val);
	  cell.value = after;
	  cell.dispatchEvent(new Event('input', { bubbles: true }));
	  changes.push({ cell: cell, before: before, after: after });
	}
  });
});
saveDraft();
pushUndo(changes);
}

// -----------------------------------
// Bind Sheet Cell Events
// -----------------------------------
function bindSheetEvents() {
sheetCells.forEach(function(cell) {
  cell.addEventListener('input', saveDraft);

  cell.addEventListener('focus', function() {
	cell.dataset.undoValue = cell.value;
	selectCell(cell);
	cell.select();
  });

  cell.addEventListener('click', function() { selectCell(cell); });

  cell.addEventListener('change', function() {
	let before = cell.dataset.undoValue || '';
	let after  = cell.value;
	pushUndo([{ cell: cell, before: before, after: after }]);
	cell.dataset.undoValue = after;
  });

  cell.addEventListener('paste', function(event) {
	let text = event.clipboardData?.getData('text/plain') || '';
	if (!text.includes('\t') && !text.includes('\n')) return;
	event.preventDefault();
	selectCell(cell);
	pasteTable(cell, text);
  });

  cell.addEventListener('keydown', function(event) {
	let row = Number(cell.dataset.row || 0);
	let col = Number(cell.dataset.col || 0);

	if ((event.key === 'Delete' || event.key === 'Backspace') && cell.selectionStart === 0 && cell.selectionEnd === cell.value.length) {
	  event.preventDefault();
	  clearSelection();
	  return;
	}

	if (event.key === 'Enter' || event.key === 'ArrowDown') {
	  event.preventDefault();
	  getCell(row + 1, col)?.focus();
	} else if (event.key === 'ArrowUp') {
	  event.preventDefault();
	  getCell(row - 1, col)?.focus();
	} else if (event.key === 'ArrowRight' && cell.selectionStart === cell.value.length) {
	  getCell(row, col + 1)?.focus();
	} else if (event.key === 'ArrowLeft' && cell.selectionStart === 0) {
	  getCell(row, col - 1)?.focus();
	}
  });
});
}

// -----------------------------------
// Bind Header Events
// -----------------------------------
function bindHeaderClick(header, fn) {
if (!header) return;
header.addEventListener('click', fn);
header.addEventListener('keydown', function(event) {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  fn();
});
}

function bindHeaderEvents() {
	sheetTbody.querySelectorAll('[data-row-header]').forEach(function(header) {
	  bindHeaderClick(header, function() {
		selectRow(header.dataset.rowHeader, header);
		header.focus();
	  });
	});

	document.querySelectorAll('[data-col-header]').forEach(function(header) {
	  bindHeaderClick(header, function() {
		selectColumn(header.dataset.colHeader, header);
		header.focus();
	  });
});

let allHeader = document.querySelector('[data-all-header]');
	bindHeaderClick(allHeader, function() {
	  selectAll(allHeader);
	  allHeader?.focus();
	});
	}

	// -----------------------------------
	// Clear Button
	// -----------------------------------
	clearBtn.addEventListener('click', function() {
	clearSelection();
	selectedCell?.focus();
});

// -----------------------------------
// Global Keyboard (Undo / Delete)
// -----------------------------------
document.addEventListener('keydown', function(event) {
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
	  event.preventDefault();
	  undoLastChange();
	  return;
	}
	if ((event.key === 'Delete' || event.key === 'Backspace') && selectedCells.length > 1 && !event.target?.classList?.contains('target-sheet-input')) {
	  event.preventDefault();
	  clearSelection();
	}
	
	if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveBtn.click();
        return;
    }
});

// -----------------------------------
// Save
// -----------------------------------

saveBtn.addEventListener('click', function() {
	if (!activeStoreId || !activeMonth) return;
	
	if(utility.spammingJam()){
		return  toast.warning("Please don't spam the save button");
	}
	
	let rows       = sheetTbody.querySelectorAll('[data-cell="date-hidden"]');
	let dates      = [];
	let targetNets = [];
	let lastYears  = [];
	let gbiTargets = [];

	rows.forEach(function(hidden) {
		let tr = hidden.closest('tr');
		dates.push(hidden.value);
		targetNets.push(tr.querySelector('[data-cell="target-net"]').value     || '0');
		lastYears.push(tr.querySelector('[data-cell="last-year-net"]').value   || '0');
		gbiTargets.push(tr.querySelector('[data-cell="gbi-target"]').value     || '0');
	});

	let params = [
		{ name: 'store_id',      value: activeStoreId          },
		{ name: 'cluster_id',    value: clusterSelect.value || '' },
		{ name: 'target_month',  value: activeMonth            },
	];
	dates.forEach(function(d)      { params.push({ name: 'target_date[]',   value: d }); });
	targetNets.forEach(function(v) { params.push({ name: 'target_net[]',    value: v }); });
	lastYears.forEach(function(v)  { params.push({ name: 'last_year_net[]', value: v }); });
	gbiTargets.forEach(function(v) { params.push({ name: 'gbi_target[]',    value: v }); });

	saveBtn.disabled        = true;
	saveBtn.textContent     = 'Saving...';

	qBuilder.server_address = '/apis/targets/save';
	qBuilder.sendQuery(onSaveComplete, undefined, params);
		
	
});

function onSaveComplete(res) {
    let data = JSON.parse(res.responseText);
    saveBtn.disabled    = false;
    saveBtn.textContent = 'Save';
    if (data.type === 'success') {
        clearDraft(activeStoreId, activeMonth);
		 toast.success('Targets saved successfully!');
    }
}

// Init
initFromUrl();

