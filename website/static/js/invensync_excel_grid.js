(function () {
	// NOTE (anti-duplication): This file attaches listeners to `document` (mouseup, keydown,
	// copy, paste, change). YOu never should include it twice or re-run it after an HTML swap, or on every
	// key press events, copy, and paste will fire twice. The guard below blocks accidental re-loading of this module and whatnot.
	if (window.__excelGridLoaded) return;
	window.__excelGridLoaded = true;

	let FIELD_LABELS = {
		beginning_qty: 'Beg',
		delivery_qty: 'Delivery',
		trans_in_qty: 'Trans-In',
		bo_qty: 'BO',
		adv_del_qty: 'Booth Sales',
		starlink_sold_qty: 'Starlink Sold',
		trans_out_qty: 'Trans-Out',
		wastage_qty: 'Waste Qty',
		wastage_amount: 'Waste Amt',
		csi_qty: 'CSI',
		quantity_sold: 'Sold',
		ending_d5_qty: 'D+5',
		ending_d4_qty: 'D+4',
		ending_d3_qty: 'D+3',
		total_ending_qty: 'Total Ending',
		total_peso_srp: 'Total Peso',
		theo_ending_qty: 'Theo Ending',
		variance_qty: 'Variance',
		variance_peso: 'Var Peso',
		remarks: 'Remarks'
	};

	let activeTable = null;
	let activeCell = null;
	let anchorCell = null;
	let editingCell = null;
	let editOriginalValue = '';
	let editModeType = 'caret';
	let liveCalcTimer = null;
	let isDraggingRange = false;
	let isDraggingFill = false;
	let selectedCellsList = [];
	let selectedHeadersList = [];
	let fillPreviewList = [];
	let includeHeaderInCopy = false;
	let undoStack = [];
	let redoStack = [];
	let MAX_HISTORY = 100;

	// NOTE (anti-duplication): while true, native "change" events are swallowed so that
	// inp.blur() inside commitEdit can't trigger a second updateInventoryRow
	// (from inline onchange="..." or another delegated change listener).
	let suppressNativeChange = false;
	document.addEventListener('change', (e) => {
		if (suppressNativeChange) e.stopPropagation();
	}, true);

	function pushUndoBatch(changes) {
		let valid = (changes || []).filter(c => c && c.td && c.oldVal !== c.newVal);
		if (!valid.length) return;
		undoStack.push(valid);
		if (undoStack.length > MAX_HISTORY) undoStack.shift();
		redoStack.length = 0;
	}

	function applyHistoryBatch(batch, useOld) {
		if (!batch || !batch.length) return;
		if (editingCell) commitEdit(false);
		for (let i = 0; i < batch.length; i++) {
			let item = batch[i];
			let val = useOld ? item.oldVal : item.newVal;
			setCellValue(item.td, val, true);
		}
		let firstTd = batch[0].td;
		let lastTd = batch[batch.length - 1].td;
		if (document.contains(firstTd)) {
			if (batch.length > 1 && document.contains(lastTd)) {
				anchorCell = firstTd;
				selectCell(lastTd, true);
			} else {
				selectCell(firstTd, false);
			}
		}
	}

	function undoLastEdit() {
		if (!undoStack.length) return;
		let batch = undoStack.pop();
		redoStack.push(batch);
		applyHistoryBatch(batch, true);
	}

	function redoLastEdit() {
		if (!redoStack.length) return;
		let batch = redoStack.pop();
		undoStack.push(batch);
		applyHistoryBatch(batch, false);
	}

	let fillHandleEl = document.createElement('div');
	fillHandleEl.className = 'excel-fill-handle';
	fillHandleEl.title = 'Drag to fill';

	function getActiveBarRefs() {
		let inFs = activeTable && activeTable.closest('#fullscreen-modal');
		if (inFs) {
			return {
				nameBox: document.getElementById('excel-fs-name-box'),
				formulaInput: document.getElementById('excel-fs-formula-input'),
				rangeSummary: document.getElementById('excel-fs-range-summary')
			};
		}
		return {
			nameBox: document.getElementById('excel-name-box'),
			formulaInput: document.getElementById('excel-formula-input'),
			rangeSummary: document.getElementById('excel-range-summary')
		};
	}

	function triggerLiveRowRecalc(inp) {
		if (!inp) return;
		if (liveCalcTimer) clearTimeout(liveCalcTimer);
		liveCalcTimer = setTimeout(() => {
			liveCalcTimer = null;
			if (typeof updateInventoryRow === 'function') {
				updateInventoryRow(inp);
			} else {
				inp.dispatchEvent(new Event('change', {
					bubbles: true
				}));
			}
		}, 120);
	}

	function getCellInput(td) {
		return td ? td.querySelector('input[type="number"], input[type="text"]') : null;
	}

	function isCellEditable(td) {
		let inp = getCellInput(td);
		return Boolean(inp && !inp.readOnly && !inp.disabled);
	}

	function getCellValue(td) {
		if (!td) return '';
		let inp = getCellInput(td);
		if (inp) return inp.value;
		if (td.matches('td:first-child')) {
			let tr = td.closest('tr[data-product-id]');
			if (tr && tr.dataset.productName) return tr.dataset.productName.trim();
			let nameEl = td.querySelector('.font-medium');
			if (nameEl) return (nameEl.textContent || '').trim();
		}
		return (td.textContent || '').trim();
	}

	function setCellValue(td, val, triggerUpdate) {
		let inp = getCellInput(td);
		if (!inp || inp.readOnly || inp.disabled) return false;
		let nextVal = String(val ?? '').trim();
		if (inp.type === 'number' && nextVal !== '') {
			let cleaned = nextVal.replace(/,/g, '');
			if (isNaN(Number(cleaned))) return false;
			nextVal = cleaned;
		}
		if (inp.value === nextVal) return false;
		inp.value = nextVal;
		if (triggerUpdate) {
			if (typeof updateInventoryRow === 'function') {
				updateInventoryRow(inp);
			} else {
				inp.dispatchEvent(new Event('change', {
					bubbles: true
				}));
			}
		}
		return true;
	}

	function getVisibleRows(table) {
		if (!table) return [];
		let rows = table.querySelectorAll('tbody tr[data-product-id]');
		let visible = [];
		for (let i = 0; i < rows.length; i++) {
			let tr = rows[i];
			if (tr.style.display !== 'none' && !tr.classList.contains('hidden')) {
				visible.push(tr);
			}
		}
		return visible;
	}

	function getVisibleRowCells(tr) {
		if (!tr) return [];
		let visible = [];
		let firstTd = tr.querySelector('td:first-child');
		if (firstTd && firstTd.style.display !== 'none' && !firstTd.classList.contains('hidden')) {
			visible.push(firstTd);
		}
		let tds = tr.querySelectorAll('td[data-field]');
		for (let i = 0; i < tds.length; i++) {
			let td = tds[i];
			if (td.style.display !== 'none' && !td.classList.contains('hidden')) {
				visible.push(td);
			}
		}
		return visible;
	}

	function getVisibleHeaders(table) {
		if (!table) return [];
		let ths = table.querySelectorAll('thead tr:nth-child(3) th');
		let visible = [];
		for (let i = 0; i < ths.length; i++) {
			let th = ths[i];
			if (th.style.display !== 'none' && !th.classList.contains('hidden')) {
				visible.push(th);
			}
		}
		return visible;
	}

	function getCellCoords(td) {
		let tr = td ? td.closest('tr[data-product-id]') : null;
		let table = tr ? tr.closest('table') : null;
		if (!tr || !table) return null;
		let rows = getVisibleRows(table);
		let rIdx = rows.indexOf(tr);
		let cells = getVisibleRowCells(tr);
		let cIdx = cells.indexOf(td);
		if (rIdx === -1 || cIdx === -1) return null;
		return {
			table,
			rows,
			rIdx,
			cIdx
		};
	}

	function clearSelectionVisuals() {
		if (activeCell) activeCell.classList.remove('excel-cell-active');
		for (let i = 0; i < selectedCellsList.length; i++) {
			selectedCellsList[i].classList.remove('excel-cell-selected');
		}
		selectedCellsList = [];
		for (let i = 0; i < selectedHeadersList.length; i++) {
			selectedHeadersList[i].classList.remove('excel-col-header-selected');
		}
		selectedHeadersList = [];
		for (let i = 0; i < fillPreviewList.length; i++) {
			fillPreviewList[i].classList.remove('excel-cell-fill-preview');
		}
		fillPreviewList = [];
		if (fillHandleEl.parentNode) fillHandleEl.parentNode.removeChild(fillHandleEl);
	}

	function refreshReadonlyMarkers(root) {
		let cells = (root || document).querySelectorAll('tbody tr[data-product-id] td[data-field]');
		for (let i = 0; i < cells.length; i++) {
			let td = cells[i];
			let inp = getCellInput(td);
			if (!inp || inp.readOnly || inp.disabled) {
				td.classList.add('excel-cell-readonly');
			} else {
				td.classList.remove('excel-cell-readonly');
			}
		}
	}

	function updateFormulaBar(selectedCells) {
		let {
			nameBox,
			formulaInput,
			rangeSummary
		} = getActiveBarRefs();
		if (!nameBox || !formulaInput) return;
		if (!activeCell) {
			nameBox.textContent = 'Click any cell';
			formulaInput.value = '';
			formulaInput.readOnly = true;
			if (rangeSummary) rangeSummary.classList.add('hidden');
			return;
		}

		let tr = activeCell.closest('tr[data-product-id]');
		let productName = tr ? (tr.dataset.productName || tr.querySelector('td:first-child')?.textContent?.trim() || 'Product') : '';
		let field = activeCell.dataset.field || (activeCell.matches('td:first-child') ? 'product' : '');
		let label = field === 'product' ? 'Product' : (FIELD_LABELS[field] || field);
		nameBox.textContent = includeHeaderInCopy ? `Column · ${label}` : `${productName} · ${label}`;
		nameBox.title = `${productName} (${label})`;

		formulaInput.value = getCellValue(activeCell);
		formulaInput.readOnly = !isCellEditable(activeCell);

		if (rangeSummary) {
			let cells = selectedCells && selectedCells.length ? selectedCells : [activeCell];
			if (cells.length > 1) {
				let sum = 0;
				let numCount = 0;
				for (let i = 0; i < cells.length; i++) {
					let n = parseFloat(String(getCellValue(cells[i])).replace(/,/g, ''));
					if (!isNaN(n)) {
						sum += n;
						numCount++;
					}
				}
				let avg = numCount ? (sum / numCount) : 0;
				rangeSummary.textContent = numCount ?
					`Count: ${cells.length}  |  Sum: ${Number.isInteger(sum) ? sum : sum.toFixed(2)}  |  Avg: ${avg.toFixed(2)}` :
					`Selected: ${cells.length} cells`;
				rangeSummary.classList.remove('hidden');
				rangeSummary.classList.add('inline-flex');
			} else {
				rangeSummary.classList.add('hidden');
				rangeSummary.classList.remove('inline-flex');
			}
		}
	}

	function getSelectedCells() {
		if (!activeTable || !anchorCell || !activeCell) return activeCell ? [activeCell] : [];
		if (anchorCell === activeCell) return [activeCell];
		let a = getCellCoords(anchorCell);
		let b = getCellCoords(activeCell);
		if (!a || !b || a.table !== b.table) return [activeCell];
		let rMin = Math.min(a.rIdx, b.rIdx);
		let rMax = Math.max(a.rIdx, b.rIdx);
		let cMin = Math.min(a.cIdx, b.cIdx);
		let cMax = Math.max(a.cIdx, b.cIdx);
		let list = [];
		for (let r = rMin; r <= rMax; r++) {
			let rowCells = getVisibleRowCells(a.rows[r]);
			for (let c = cMin; c <= cMax; c++) {
				if (rowCells[c]) list.push(rowCells[c]);
			}
		}
		return list;
	}

	function selectCell(td, extendRange, keepHeaderMode) {
		if (!td) return;
		if (editingCell && editingCell !== td) {
			commitEdit(false);
		}
		let coords = getCellCoords(td);
		if (!coords) return;

		if (!keepHeaderMode) includeHeaderInCopy = false;
		activeTable = coords.table;
		if (!extendRange || !anchorCell || anchorCell.closest('table') !== activeTable) {
			anchorCell = td;
		}

		clearSelectionVisuals();
		activeCell = td;

		if (document.activeElement && document.activeElement !== document.body && typeof document.activeElement.blur === 'function') {
			document.activeElement.blur();
		}

		let selected = getSelectedCells();
		selectedCellsList = selected;
		for (let i = 0; i < selected.length; i++) {
			selected[i].classList.add('excel-cell-selected');
		}
		if (!keepHeaderMode) {
			activeCell.classList.add('excel-cell-active');
			if (isCellEditable(activeCell)) {
				activeCell.appendChild(fillHandleEl);
			}
			activeCell.scrollIntoView({
				behavior: 'auto',
				block: 'nearest',
				inline: 'nearest'
			});
		}
		updateFormulaBar(selected);
	}

	function selectColumnByHeader(th, extendRange) {
		let table = th ? th.closest('table') : null;
		if (!table) return;
		let headers = getVisibleHeaders(table);
		let colIdx = headers.indexOf(th);
		let rows = getVisibleRows(table);
		if (colIdx === -1 || !rows.length) return;

		let firstRowCells = getVisibleRowCells(rows[0]);
		let lastRowCells = getVisibleRowCells(rows[rows.length - 1]);
		if (colIdx >= firstRowCells.length || colIdx >= lastRowCells.length) return;

		let cMin = colIdx;
		let cMax = colIdx;
		if (extendRange && anchorCell && anchorCell.closest('table') === table) {
			let anchorCoords = getCellCoords(anchorCell);
			if (anchorCoords) {
				cMin = Math.min(anchorCoords.cIdx, colIdx);
				cMax = Math.max(anchorCoords.cIdx, colIdx);
			}
		}

		includeHeaderInCopy = true;
		anchorCell = getVisibleRowCells(rows[0])[cMin];
		selectCell(getVisibleRowCells(rows[rows.length - 1])[cMax], true, true);

		for (let c = cMin; c <= cMax; c++) {
			if (headers[c]) {
				headers[c].classList.add('excel-col-header-selected');
				selectedHeadersList.push(headers[c]);
			}
			if (c === 0) {
				let topProductTh = table.querySelector('thead tr:first-child th:first-child');
				if (topProductTh) {
					topProductTh.classList.add('excel-col-header-selected');
					selectedHeadersList.push(topProductTh);
				}
			}
		}
	}

	function enterEditMode(td, initialChar) {
		if (!td || !isCellEditable(td)) return;
		let inp = getCellInput(td);
		if (!inp) return;
		if (editingCell && editingCell !== td) {
			commitEdit(false);
		}
		editingCell = td;
		editOriginalValue = inp.value;
		editModeType = (initialChar !== undefined && initialChar !== null) ? 'quick' : 'caret';
		td.classList.add('excel-cell-editing');

		let {
			formulaInput
		} = getActiveBarRefs();

		if (initialChar !== undefined && initialChar !== null) {
			if (inp.type === 'number' && !/^[0-9.\-]$/.test(initialChar)) {
				td.classList.remove('excel-cell-editing');
				editingCell = null;
				return;
			}
			inp.value = initialChar;
			if (formulaInput) formulaInput.value = inp.value;
			triggerLiveRowRecalc(inp);
			inp.focus({
				preventScroll: true
			});
			let len = inp.value.length;
			try {
				inp.setSelectionRange(len, len);
			} catch (_) {}
		} else {
			if (formulaInput) formulaInput.value = inp.value;
			inp.focus({
				preventScroll: true
			});
			try {
				inp.select();
			} catch (_) {}
		}
	}

	function commitEdit(cancel) {
		if (!editingCell) return;
		// NOTE (anti-duplication): cancel any pending live-recalc timer so the row
		// isn't recalculated a second time after the edit is committed.
		if (liveCalcTimer) {
			clearTimeout(liveCalcTimer);
			liveCalcTimer = null;
		}
		let td = editingCell;
		let inp = getCellInput(td);
		td.classList.remove('excel-cell-editing');
		editingCell = null;
		if (!inp) return;

		if (cancel) {
			inp.value = editOriginalValue;
		} else if (inp.value !== editOriginalValue) {
			pushUndoBatch([{
				td,
				oldVal: editOriginalValue,
				newVal: inp.value
			}]);
			if (typeof updateInventoryRow === 'function') {
				updateInventoryRow(inp);
			} else {
				inp.dispatchEvent(new Event('change', {
					bubbles: true
				}));
			}
		}
		// NOTE (anti-duplication): blur() can fire a native "change" event, which would run
		// updateInventoryRow again. We already called it above, so suppress that event.
		suppressNativeChange = true;
		try {
			inp.blur();
		} finally {
			suppressNativeChange = false;
		}
		updateFormulaBar(getSelectedCells());
	}

	function moveSelection(dr, dc, extendRange) {
		if (!activeCell) return;
		let coords = getCellCoords(activeCell);
		if (!coords) return;
		let nextR = Math.max(0, Math.min(coords.rows.length - 1, coords.rIdx + dr));
		let targetRowCells = getVisibleRowCells(coords.rows[nextR]);
		if (!targetRowCells.length) return;
		let nextC = Math.max(0, Math.min(targetRowCells.length - 1, coords.cIdx + dc));
		let target = targetRowCells[nextC];
		if (target) {
			selectCell(target, extendRange);
		}
	}

	function clearSelectedCells() {
		let cells = getSelectedCells();
		let changes = [];
		for (let i = 0; i < cells.length; i++) {
			let oldVal = getCellValue(cells[i]);
			if (setCellValue(cells[i], '', true)) {
				changes.push({
					td: cells[i],
					oldVal,
					newVal: ''
				});
			}
		}
		if (changes.length > 0) {
			pushUndoBatch(changes);
			updateFormulaBar(cells);
		}
	}

	function buildSelectionTSV() {
		let a = getCellCoords(anchorCell || activeCell);
		let b = getCellCoords(activeCell);
		if (!a || !b) return '';
		let rMin = Math.min(a.rIdx, b.rIdx);
		let rMax = Math.max(a.rIdx, b.rIdx);
		let cMin = Math.min(a.cIdx, b.cIdx);
		let cMax = Math.max(a.cIdx, b.cIdx);
		let lines = [];
		if (includeHeaderInCopy) {
			let headers = getVisibleHeaders(a.table);
			let headerVals = [];
			for (let c = cMin; c <= cMax; c++) {
				headerVals.push(headers[c] ? (headers[c].textContent || '').trim() : '');
			}
			lines.push(headerVals.join('\t'));
		}
		for (let r = rMin; r <= rMax; r++) {
			let rowCells = getVisibleRowCells(a.rows[r]);
			let vals = [];
			for (let c = cMin; c <= cMax; c++) {
				vals.push(rowCells[c] ? getCellValue(rowCells[c]) : '');
			}
			lines.push(vals.join('\t'));
		}
		return lines.join('\n');
	}

	function fallbackExecCopy(text) {
		let ta = document.createElement('textarea');
		ta.value = text;
		ta.setAttribute('readonly', '');
		ta.style.position = 'fixed';
		ta.style.top = '-9999px';
		ta.style.left = '-9999px';
		document.body.appendChild(ta);
		ta.select();
		let ok = false;
		try {
			ok = document.execCommand('copy');
		} catch (_) {
			ok = false;
		}
		document.body.removeChild(ta);
		return ok;
	}

	function showCopiedFeedback() {
		let cells = selectedCellsList.length ? selectedCellsList : (activeCell ? [activeCell] : []);
		for (let i = 0; i < cells.length; i++) {
			cells[i].classList.add('excel-cell-copied');
		}
		setTimeout(() => {
			for (let i = 0; i < cells.length; i++) {
				cells[i].classList.remove('excel-cell-copied');
			}
		}, 600);
		let {
			rangeSummary
		} = getActiveBarRefs();
		if (rangeSummary) {
			let prevText = rangeSummary.textContent;
			let wasHidden = rangeSummary.classList.contains('hidden');
			rangeSummary.textContent = `Copied ${cells.length} cell${cells.length === 1 ? '' : 's'}!`;
			rangeSummary.classList.remove('hidden');
			rangeSummary.classList.add('inline-flex');
			setTimeout(() => {
				if (wasHidden) {
					rangeSummary.classList.add('hidden');
					rangeSummary.classList.remove('inline-flex');
				} else {
					rangeSummary.textContent = prevText;
				}
			}, 1200);
		}
	}

	function copySelectionToClipboard() {
		let tsv = buildSelectionTSV();
		if (!tsv) return;
		if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
			navigator.clipboard.writeText(tsv).then(showCopiedFeedback).catch(() => {
				if (fallbackExecCopy(tsv)) showCopiedFeedback();
			});
		} else {
			if (fallbackExecCopy(tsv)) showCopiedFeedback();
		}
	}

	function applyPasteText(rawText) {
		if (!activeCell || !rawText) return;
		let start = getCellCoords(activeCell);
		if (!start) return;
		let rowsData = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
		if (rowsData.length > 1 && rowsData[rowsData.length - 1] === '') rowsData.pop();

		let changes = [];
		for (let rOff = 0; rOff < rowsData.length; rOff++) {
			let targetRow = start.rows[start.rIdx + rOff];
			if (!targetRow) break;
			let rowCells = getVisibleRowCells(targetRow);
			let cols = rowsData[rOff].split('\t');
			for (let cOff = 0; cOff < cols.length; cOff++) {
				let targetCell = rowCells[start.cIdx + cOff];
				if (targetCell) {
					let oldVal = getCellValue(targetCell);
					if (setCellValue(targetCell, cols[cOff], true)) {
						changes.push({
							td: targetCell,
							oldVal,
							newVal: getCellValue(targetCell)
						});
					}
				}
			}
		}
		pushUndoBatch(changes);
		updateFormulaBar(getSelectedCells());
	}

	function bindFormulaInput(inputEl) {
		if (!inputEl || inputEl.dataset.excelFormulaBound === '1') return;
		inputEl.dataset.excelFormulaBound = '1';

		inputEl.addEventListener('input', () => {
			if (!activeCell || inputEl.readOnly) return;
			let inp = getCellInput(activeCell);
			if (!inp || inp.readOnly || inp.disabled) return;
			let nextVal = inputEl.value;
			if (inp.type === 'number' && nextVal !== '') {
				let cleaned = nextVal.replace(/,/g, '');
				if (cleaned !== '-' && isNaN(Number(cleaned))) return;
				nextVal = cleaned;
			}
			inp.value = nextVal;
			triggerLiveRowRecalc(inp);
		});

		inputEl.addEventListener('keydown', (e) => {
			if (!activeCell || inputEl.readOnly) return;
			if (e.key === 'Enter') {
				e.preventDefault();
				setCellValue(activeCell, inputEl.value, true);
				inputEl.blur();
				moveSelection(1, 0, false);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				inputEl.value = getCellValue(activeCell);
				inputEl.blur();
			}
		});

		inputEl.addEventListener('blur', () => {
			if (activeCell && !inputEl.readOnly) {
				setCellValue(activeCell, inputEl.value, true);
			}
		});
	}

	function ensureFullscreenFormulaBar(fsModal) {
		if (!fsModal) return;
		let table = fsModal.querySelector('table');
		if (!table || fsModal.querySelector('#excel-fs-formula-bar')) return;

		let bar = document.createElement('div');
		bar.id = 'excel-fs-formula-bar';
		bar.className = 'flex flex-wrap items-center gap-2 px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-xs shrink-0';
		bar.innerHTML = `
      <div id="excel-fs-name-box" class="inline-flex items-center gap-1.5 px-2.5 py-1 bg-white border border-slate-300 rounded font-semibold text-slate-700 min-w-[140px] max-w-[260px] truncate" title="Active Cell">Click any cell</div>
      <span class="font-serif italic font-bold text-emerald-700 px-1 select-none">fx</span>
      <input type="text" id="excel-fs-formula-input" placeholder="Select a cell to view or edit..." readonly
        class="flex-1 min-w-[160px] px-2.5 py-1 bg-white border border-slate-300 rounded text-xs text-slate-800 outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-500">
      <div id="excel-fs-range-summary" class="hidden items-center gap-3 px-2.5 py-1 bg-emerald-50 border border-emerald-200 rounded text-emerald-800 font-medium"></div>
      <span class="hidden sm:inline-block text-[11px] text-slate-400 select-none">Arrows / Tab / Enter &middot; Type to edit &middot; Ctrl+C / Ctrl+V</span>
    `;
		let scrollParent = table.closest('.overflow-auto, .inventory-scroll-container') || table.parentElement;
		if (scrollParent && scrollParent.parentNode) {
			scrollParent.parentNode.insertBefore(bar, scrollParent);
		}
		bindFormulaInput(document.getElementById('excel-fs-formula-input'));
	}

	function attachGridEvents(container) {
		if (!container || container.dataset.excelGridBound === '1') return;
		container.dataset.excelGridBound = '1';
		refreshReadonlyMarkers(container);

		container.addEventListener('mousedown', (e) => {
			// NOTE (anti-duplication): if #fullscreen-modal is nested inside #main-content,
			// the same event bubbles through both containers. Handle it only once.
			if (e.__excelHandled) return;
			e.__excelHandled = true;

			let handle = e.target.closest('.excel-fill-handle');
			if (handle && activeCell) {
				e.preventDefault();
				isDraggingFill = true;
				return;
			}
			let productTopTh = e.target.closest('thead tr:first-child th:first-child');
			if (productTopTh) {
				e.preventDefault();
				let table = productTopTh.closest('table');
				let headers = getVisibleHeaders(table);
				if (headers[0]) selectColumnByHeader(headers[0], e.shiftKey);
				return;
			}
			let headerTh = e.target.closest('thead tr:nth-child(3) th');
			if (headerTh) {
				e.preventDefault();
				selectColumnByHeader(headerTh, e.shiftKey);
				return;
			}
			if (e.target.closest('.pos-review-badge, .bitbit-sold-badge, .motif-sold-badge')) {
				return;
			}
			let td = e.target.closest('tbody tr[data-product-id] td[data-field], tbody tr[data-product-id] td:first-child');
			if (!td) return;
			e.preventDefault();
			selectCell(td, e.shiftKey);
			isDraggingRange = true;
		});

		container.addEventListener('dblclick', (e) => {
			if (e.__excelHandled) return; // NOTE: same nested-container guard as above
			e.__excelHandled = true;

			let td = e.target.closest('tbody tr[data-product-id] td[data-field]');
			if (!td) return;
			e.preventDefault();
			enterEditMode(td);
		});

		container.addEventListener('input', (e) => {
			if (e.__excelHandled) return; // NOTE: same nested-container guard as above
			e.__excelHandled = true;

			if (!editingCell) return;
			let inp = getCellInput(editingCell);
			if (e.target !== inp) return;
			let {
				formulaInput
			} = getActiveBarRefs();
			if (formulaInput) formulaInput.value = inp.value;
			triggerLiveRowRecalc(inp);
		});

		container.addEventListener('mouseover', (e) => {
			if (e.__excelHandled) return; // NOTE: same nested-container guard as above
			e.__excelHandled = true;

			if (!isDraggingRange && !isDraggingFill) return;
			let td = e.target.closest('tbody tr[data-product-id] td[data-field], tbody tr[data-product-id] td:first-child');
			if (!td || td.closest('table') !== activeTable) return;
			if (isDraggingRange) {
				if (td !== activeCell) selectCell(td, true);
			} else if (isDraggingFill && activeCell) {
				for (let i = 0; i < fillPreviewList.length; i++) {
					fillPreviewList[i].classList.remove('excel-cell-fill-preview');
				}
				fillPreviewList = [];
				let a = getCellCoords(activeCell);
				let b = getCellCoords(td);
				if (!a || !b) return;
				let rMin = Math.min(a.rIdx, b.rIdx);
				let rMax = Math.max(a.rIdx, b.rIdx);
				for (let r = rMin; r <= rMax; r++) {
					let rowCells = getVisibleRowCells(a.rows[r]);
					let target = rowCells[a.cIdx];
					if (target && target !== activeCell && isCellEditable(target)) {
						target.classList.add('excel-cell-fill-preview');
						fillPreviewList.push(target);
					}
				}
			}
		});
	}

	document.addEventListener('mouseup', () => {
		if (isDraggingFill && activeCell && fillPreviewList.length) {
			let fillVal = getCellValue(activeCell);
			let changes = [];
			for (let i = 0; i < fillPreviewList.length; i++) {
				let cell = fillPreviewList[i];
				cell.classList.remove('excel-cell-fill-preview');
				let oldVal = getCellValue(cell);
				if (setCellValue(cell, fillVal, true)) {
					changes.push({
						td: cell,
						oldVal,
						newVal: getCellValue(cell)
					});
				}
			}
			pushUndoBatch(changes);
			fillPreviewList = [];
			updateFormulaBar(getSelectedCells());
		}
		isDraggingRange = false;
		isDraggingFill = false;
	});

	document.addEventListener('keydown', (e) => {
		let activeEl = document.activeElement;
		let focusedTd = activeEl && activeEl.closest ? activeEl.closest('tbody tr[data-product-id] td[data-field]') : null;
		if (focusedTd && activeEl === getCellInput(focusedTd)) {
			if (!editingCell) {
				editingCell = focusedTd;
				activeCell = focusedTd;
				anchorCell = anchorCell || focusedTd;
				activeTable = focusedTd.closest('table');
			}
		} else {
			let tag = (activeEl && activeEl.tagName || '').toLowerCase();
			if (tag === 'input' || tag === 'textarea' || tag === 'select') {
				return;
			}
		}

		if (editingCell) {
			if (e.key === 'Enter') {
				e.preventDefault();
				commitEdit(false);
				moveSelection(e.shiftKey ? -1 : 1, 0, false);
			} else if (e.key === 'Tab') {
				e.preventDefault();
				commitEdit(false);
				moveSelection(0, e.shiftKey ? -1 : 1, false);
			} else if (e.key === 'ArrowUp') {
				e.preventDefault();
				commitEdit(false);
				moveSelection(-1, 0, false);
			} else if (e.key === 'ArrowDown') {
				e.preventDefault();
				commitEdit(false);
				moveSelection(1, 0, false);
			} else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && editModeType === 'quick') {
				e.preventDefault();
				commitEdit(false);
				moveSelection(0, e.key === 'ArrowLeft' ? -1 : 1, false);
			} else if (e.key === 'Escape') {
				e.preventDefault();
				commitEdit(true);
			}
			return;
		}

		if (!activeCell) return;

		if (e.key === 'ArrowUp') {
			e.preventDefault();
			moveSelection(-1, 0, e.shiftKey);
		} else if (e.key === 'ArrowDown') {
			e.preventDefault();
			moveSelection(1, 0, e.shiftKey);
		} else if (e.key === 'ArrowLeft') {
			e.preventDefault();
			moveSelection(0, -1, e.shiftKey);
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			moveSelection(0, 1, e.shiftKey);
		} else if (e.key === 'Tab') {
			e.preventDefault();
			moveSelection(0, e.shiftKey ? -1 : 1, false);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			moveSelection(e.shiftKey ? -1 : 1, 0, false);
		} else if (e.key === 'F2') {
			e.preventDefault();
			enterEditMode(activeCell);
		} else if (e.key === 'Delete' || e.key === 'Backspace') {
			e.preventDefault();
			clearSelectedCells();
		} else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
			e.preventDefault();
			undoLastEdit();
		} else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
			e.preventDefault();
			redoLastEdit();
		} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
			e.preventDefault();
			copySelectionToClipboard();
		} else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
			if (navigator.clipboard && navigator.clipboard.readText) {
				e.preventDefault();
				navigator.clipboard.readText().then(applyPasteText).catch(() => {});
			}
		} else if (!e.ctrlKey && !e.metaKey && !e.altKey && e.key.length === 1) {
			e.preventDefault();
			enterEditMode(activeCell, e.key);
		}
	}, true);

	document.addEventListener('copy', (e) => {
		if (editingCell || !activeCell) return;
		let tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
		if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
		let tsv = buildSelectionTSV();
		if (tsv && e.clipboardData) {
			e.preventDefault();
			e.clipboardData.setData('text/plain', tsv);
			showCopiedFeedback();
		}
	});

	document.addEventListener('paste', (e) => {
		if (editingCell || !activeCell) return;
		let tag = (document.activeElement && document.activeElement.tagName || '').toLowerCase();
		if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
		let pasted = (e.clipboardData || window.clipboardData)?.getData('text');
		if (pasted) {
			e.preventDefault();
			applyPasteText(pasted);
		}
	});

	document.addEventListener('DOMContentLoaded', () => {
		bindFormulaInput(document.getElementById('excel-formula-input'));

		let mainContent = document.getElementById('main-content');
		if (mainContent) {
			attachGridEvents(mainContent);
			let rafPending = false;
			let bodyObs = new MutationObserver((mutations) => {
				// Ignore our own fill-handle append/remove
				if (mutations.every(m => m.target.classList?.contains('excel-cell-active') || Array.from(m.addedNodes).concat(Array.from(m.removedNodes)).every(n => n === fillHandleEl))) {
					return;
				}
				if (rafPending) return;
				rafPending = true;
				requestAnimationFrame(() => {
					rafPending = false;
					refreshReadonlyMarkers(mainContent);
				});
			});
			bodyObs.observe(mainContent, {
				childList: true,
				subtree: true
			});
		}

		let fsModal = document.getElementById('fullscreen-modal');
		if (fsModal) {
			let fsRafPending = false;
			let obs = new MutationObserver(() => {
				if (fsRafPending) return;
				fsRafPending = true;
				requestAnimationFrame(() => {
					fsRafPending = false;
					attachGridEvents(fsModal);
					ensureFullscreenFormulaBar(fsModal);
					refreshReadonlyMarkers(fsModal);
				});
			});
			obs.observe(fsModal, {
				childList: true,
				subtree: true
			});
		}
	});
})();