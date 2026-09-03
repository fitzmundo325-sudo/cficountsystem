  // -------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------
  let systemAnalyzerData = { start_date: '', end_date: '', unmatched_items: [], unmatched_rso_items: [], pos_upload_details: {}, rso_upload_details: {}, master_name_options: [] };
  let posCurrentPage = 1;
  let rsoCurrentPage = 1;
  let rowsPerPage = 10;
  let uploadModalScrollTop = 0;
  let linkModalScrollTop = 0;

  // -------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------
  function loadSystemAnalyzerData(startDate, endDate, presetLinkAlias) {
    let params = new URLSearchParams();
    if (startDate) params.set('start_date', startDate);
    if (endDate) params.set('end_date', endDate);
    let requestUrl = systemAnalyzerApiUrl + (params.toString() ? '?' + params.toString() : '');

    fetch(requestUrl, { method: 'GET', headers: { 'Content-Type': 'application/json' } })
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (result.type !== 'success') {
          toast.error(result.message || 'Failed to load system analyzer data.');
          return;
        }
        systemAnalyzerData = result.data;
        posCurrentPage = 1;
        rsoCurrentPage = 1;
        _('analyzer-start-date').value = systemAnalyzerData.start_date;
        _('analyzer-end-date').value = systemAnalyzerData.end_date;
        updateDateRangeLabels();
        populateMasterlistDatalist();
        renderPosTable();
        renderRsoTable();
        if (presetLinkAlias) {
          openLinkProductModal(presetLinkAlias);
        }
      })
      .catch(function () {
        toast.error('Failed to load system analyzer data.');
      });
  }

  function updateDateRangeLabels() {
    _('pos-date-range-label').textContent = `Date Range: ${systemAnalyzerData.start_date} to ${systemAnalyzerData.end_date}`;
    _('rso-date-range-label').textContent = `Delivery and Bulk Order RSO · ${systemAnalyzerData.start_date} to ${systemAnalyzerData.end_date}`;
  }

  function populateMasterlistDatalist() {
    let datalist = _('master-product-options');
    datalist.innerHTML = '';
    systemAnalyzerData.master_name_options.forEach(function (optionValue) {
      let option = document.createElement('option');
      option.value = optionValue;
      datalist.appendChild(option);
    });
  }

  // -------------------------------------------------------------------
  // Filtering
  // -------------------------------------------------------------------
  function getFilteredItems(items, searchTerm) {
    if (!searchTerm) return items;
    return items.filter(function (item) {
      let haystack = [
        item.product_code,
        item.product_name,
        item.total_qty,
        item.total_net_sales,
        item.total_received_qty,
        item.store_count,
        item.entry_count,
        item.latest_report_date
      ].join(' ').toLowerCase();
      return haystack.includes(searchTerm);
    });
  }

  // -------------------------------------------------------------------
  // Row builders
  // -------------------------------------------------------------------
  function buildPosRow(item) {
    let template = _('pos-row-template');
    let row = template.content.firstElementChild.cloneNode(true);
    row.querySelector('[data-cell="product_code"]').textContent = item.product_code || '-';
    row.querySelector('[data-cell="product_name"]').textContent = item.product_name || '-';
    row.querySelector('[data-cell="total_qty"]').textContent = item.total_qty;
    row.querySelector('[data-cell="total_net_sales"]').textContent = formatCurrency(item.total_net_sales);
    row.querySelector('[data-cell="store_count"]').textContent = item.store_count;
    row.querySelector('[data-cell="entry_count"]').textContent = item.entry_count;
    row.querySelector('[data-cell="latest_report_date"]').textContent = item.latest_report_date || '-';
    row.querySelector('.open-upload-modal').setAttribute('data-product', item.product_name);
    row.querySelector('.open-link-modal').setAttribute('data-alias', item.product_name);
    row.querySelector('.search-masterlist-link').href = masterlistBaseUrl + '?q=' + encodeURIComponent(item.product_name);
    return row;
  }

  function buildRsoRow(item) {
    let template = _('rso-row-template');
    let row = template.content.firstElementChild.cloneNode(true);
    row.querySelector('[data-cell="product_code"]').textContent = item.product_code || '-';
    row.querySelector('[data-cell="product_name"]').textContent = item.product_name || '-';
    row.querySelector('[data-cell="total_qty"]').textContent = item.total_qty;
    row.querySelector('[data-cell="total_received_qty"]').textContent = item.total_received_qty;
    row.querySelector('[data-cell="store_count"]').textContent = item.store_count;
    row.querySelector('[data-cell="entry_count"]').textContent = item.entry_count;
    row.querySelector('[data-cell="latest_report_date"]').textContent = item.latest_report_date || '-';
    row.querySelector('.open-upload-modal').setAttribute('data-product', item.product_name);
    row.querySelector('.open-link-modal').setAttribute('data-alias', item.product_name);
    row.querySelector('.search-masterlist-link').href = masterlistBaseUrl + '?q=' + encodeURIComponent(item.product_name);
    return row;
  }

  // -------------------------------------------------------------------
  // Table rendering
  // -------------------------------------------------------------------
  function clearTableBody(tbody) {
    tbody.innerHTML = '';
  }

  function showEmptyMessage(tbody, message) {
    let row = document.createElement('tr');
    let cell = document.createElement('td');
    cell.colSpan = 8;
    cell.className = 'px-4 py-8 text-center text-sm text-slate-500';
    cell.textContent = message;
    row.appendChild(cell);
    tbody.appendChild(row);
  }

  function renderPosTable() {
    let tbody = _('pos-table-body');
    let searchTerm = (_('pos-product-search').value || '').trim().toLowerCase();
    let filteredItems = getFilteredItems(systemAnalyzerData.unmatched_items, searchTerm);
    let totalItems = filteredItems.length;
    let totalPages = Math.max(1, Math.ceil(totalItems / rowsPerPage));
    posCurrentPage = Math.min(Math.max(posCurrentPage, 1), totalPages);
    let startIndex = (posCurrentPage - 1) * rowsPerPage;
    let endIndex = Math.min(startIndex + rowsPerPage, totalItems);
    let pageItems = filteredItems.slice(startIndex, endIndex);

    clearTableBody(tbody);

    if (systemAnalyzerData.unmatched_items.length === 0) {
      showEmptyMessage(tbody, 'No new POS items detected for this date range.');
    } else if (totalItems === 0) {
      showEmptyMessage(tbody, 'No POS products match your search.');
    } else {
      pageItems.forEach(function (item) {
        tbody.appendChild(buildPosRow(item));
      });
    }

    renderPaginationControls({
      paginationId: 'pos-pagination',
      summaryId: 'pos-pagination-summary',
      pageNumbersId: 'pos-page-numbers',
      currentPage: posCurrentPage,
      totalItems: totalItems,
      totalPages: totalPages,
      startIndex: startIndex,
      endIndex: endIndex,
      onPageChange: function (page) { posCurrentPage = page; renderPosTable(); }
    });

    _('pos-prev-page').disabled = posCurrentPage <= 1 || totalItems === 0;
    _('pos-next-page').disabled = posCurrentPage >= totalPages || totalItems === 0;
  }

  function renderRsoTable() {
    let tbody = _('rso-table-body');
    let searchTerm = (_('rso-product-search').value || '').trim().toLowerCase();
    let filteredItems = getFilteredItems(systemAnalyzerData.unmatched_rso_items, searchTerm);
    let totalItems = filteredItems.length;
    let totalPages = Math.max(1, Math.ceil(totalItems / rowsPerPage));
    rsoCurrentPage = Math.min(Math.max(rsoCurrentPage, 1), totalPages);
    let startIndex = (rsoCurrentPage - 1) * rowsPerPage;
    let endIndex = Math.min(startIndex + rowsPerPage, totalItems);
    let pageItems = filteredItems.slice(startIndex, endIndex);

    clearTableBody(tbody);

    if (systemAnalyzerData.unmatched_rso_items.length === 0) {
      showEmptyMessage(tbody, 'No unmatched RSO products detected for this date range.');
    } else if (totalItems === 0) {
      showEmptyMessage(tbody, 'No RSO products match your search.');
    } else {
      pageItems.forEach(function (item) {
        tbody.appendChild(buildRsoRow(item));
      });
    }

    renderPaginationControls({
      paginationId: 'rso-pagination',
      summaryId: 'rso-pagination-summary',
      pageNumbersId: 'rso-page-numbers',
      currentPage: rsoCurrentPage,
      totalItems: totalItems,
      totalPages: totalPages,
      startIndex: startIndex,
      endIndex: endIndex,
      onPageChange: function (page) { rsoCurrentPage = page; renderRsoTable(); }
    });

    _('rso-prev-page').disabled = rsoCurrentPage <= 1 || totalItems === 0;
    _('rso-next-page').disabled = rsoCurrentPage >= totalPages || totalItems === 0;
  }

  function renderPaginationControls(config) {
    let pagination = _(config.paginationId);
    let summary = _(config.summaryId);
    let pageNumbers = _(config.pageNumbersId);

    pagination.classList.toggle('hidden', config.totalItems === 0);
    summary.textContent = config.totalItems
      ? `Showing ${config.startIndex + 1}-${config.endIndex} of ${config.totalItems}`
      : 'Showing 0 of 0';

    pageNumbers.innerHTML = '';
    for (let page = 1; page <= config.totalPages; page += 1) {
      let button = document.createElement('button');
      button.type = 'button';
      button.textContent = String(page);
      button.className = [
        'min-w-8 px-2.5 py-1.5 rounded-lg border text-xs font-medium transition-colors',
        page === config.currentPage
          ? 'bg-slate-900 border-slate-900 text-white'
          : 'border-slate-300 text-slate-600 hover:bg-slate-50'
      ].join(' ');
      button.addEventListener('click', function () {
        config.onPageChange(page);
      });
      pageNumbers.appendChild(button);
    }
  }

  function handlePosPrevClick() {
    if (posCurrentPage > 1) {
      posCurrentPage -= 1;
      renderPosTable();
    }
  }

  function handlePosNextClick() {
    posCurrentPage += 1;
    renderPosTable();
  }

  function handleRsoPrevClick() {
    if (rsoCurrentPage > 1) {
      rsoCurrentPage -= 1;
      renderRsoTable();
    }
  }

  function handleRsoNextClick() {
    rsoCurrentPage += 1;
    renderRsoTable();
  }

  function handlePosSearchInput() {
    posCurrentPage = 1;
    renderPosTable();
  }

  function handleRsoSearchInput() {
    rsoCurrentPage = 1;
    renderRsoTable();
  }

  // -------------------------------------------------------------------
  // Formatting helpers
  // -------------------------------------------------------------------
  function formatCurrency(value) {
    return '₱' + Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // -------------------------------------------------------------------
  // Analyze button / URL sync
  // -------------------------------------------------------------------
  function handleAnalyzeClick() {
    let startDate = _('analyzer-start-date').value;
    let endDate = _('analyzer-end-date').value;
    updateUrlDateParams(startDate, endDate);
    loadSystemAnalyzerData(startDate, endDate, '');
  }

  function updateUrlDateParams(startDate, endDate) {
    let params = new URLSearchParams(window.location.search);
    if (startDate) { params.set('start_date', startDate); } else { params.delete('start_date'); }
    if (endDate) { params.set('end_date', endDate); } else { params.delete('end_date'); }
    let newUrl = window.location.pathname + '?' + params.toString();
    history.pushState({}, '', newUrl);
  }

  // -------------------------------------------------------------------
  // Upload Details modal
  // -------------------------------------------------------------------
  function positionUploadModalInsideMainContent() {
    let positioner = _('upload-details-positioner');
    if (!positioner) return;
    let mainContent = _('main-content');
    if (!mainContent || window.innerWidth < 1024) {
      positioner.style.marginLeft = '0px';
      positioner.style.width = '100%';
      return;
    }
    let rect = mainContent.getBoundingClientRect();
    let leftOffset = Math.max(0, Math.round(rect.left) - 64);
    positioner.style.marginLeft = `${leftOffset}px`;
    positioner.style.width = `calc(100% - ${leftOffset}px)`;
  }

  function lockUploadModalScroll() {
    uploadModalScrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    document.documentElement.classList.add('modal-open');
    document.body.classList.add('modal-open');
    document.body.style.position = 'fixed';
    document.body.style.top = `-${uploadModalScrollTop}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }

  function unlockUploadModalScroll() {
    document.documentElement.classList.remove('modal-open');
    document.body.classList.remove('modal-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, uploadModalScrollTop);
  }

  function openUploadDetailsModal(source, productName) {
    let isRso = source === 'rso';
    let detailsMap = isRso ? systemAnalyzerData.rso_upload_details : systemAnalyzerData.pos_upload_details;
    let rows = detailsMap[productName] || [];
    let title = _('upload-details-title');
    let subtitle = _('upload-details-subtitle');
    let body = _('upload-details-body');

    title.textContent = `${isRso ? 'RSO' : 'POS Sold'} Upload Details`;
    subtitle.textContent = productName || 'Selected product';

    if (!rows.length) {
      body.innerHTML = '<div class="rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">No upload details found for this product in the selected date range.</div>';
    } else {
      let headers = isRso
        ? ['Store', 'Report Date', 'Source', 'Rows', 'Qty', 'Received', 'Uploaded By', 'Latest Upload']
        : ['Store', 'Report Date', 'Rows', 'Qty', 'Net Sales', 'Uploaded By', 'Latest Upload'];

      let rowsHtml = rows.map(function (row) {
        return isRso ? `
          <tr class="hover:bg-slate-50">
            <td class="px-4 py-3 text-sm font-semibold text-slate-900">${escapeHtml(row.store_name)}</td>
            <td class="px-4 py-3 text-sm text-slate-700">${escapeHtml(row.report_date)}</td>
            <td class="px-4 py-3 text-sm text-slate-700">${escapeHtml(row.upload_source)}</td>
            <td class="px-4 py-3 text-sm text-right text-slate-800">${escapeHtml(row.entry_count)}</td>
            <td class="px-4 py-3 text-sm text-right text-slate-800">${escapeHtml(row.total_qty)}</td>
            <td class="px-4 py-3 text-sm text-right text-slate-800">${escapeHtml(row.total_received_qty)}</td>
            <td class="px-4 py-3 text-sm text-slate-700">${escapeHtml(row.uploaded_by)}</td>
            <td class="px-4 py-3 text-sm text-slate-700">${escapeHtml(row.latest_uploaded_at)}</td>
          </tr>
        ` : `
          <tr class="hover:bg-slate-50">
            <td class="px-4 py-3 text-sm font-semibold text-slate-900">${escapeHtml(row.store_name)}</td>
            <td class="px-4 py-3 text-sm text-slate-700">${escapeHtml(row.report_date)}</td>
            <td class="px-4 py-3 text-sm text-right text-slate-800">${escapeHtml(row.entry_count)}</td>
            <td class="px-4 py-3 text-sm text-right text-slate-800">${escapeHtml(row.total_qty)}</td>
            <td class="px-4 py-3 text-sm text-right text-slate-800">${formatCurrency(row.total_net_sales)}</td>
            <td class="px-4 py-3 text-sm text-slate-700">${escapeHtml(row.uploaded_by)}</td>
            <td class="px-4 py-3 text-sm text-slate-700">${escapeHtml(row.latest_uploaded_at)}</td>
          </tr>
        `;
      }).join('');

      body.innerHTML = `
        <div class="overflow-x-auto rounded-xl border border-slate-200">
          <table class="min-w-full divide-y divide-slate-200">
            <thead class="bg-slate-50">
              <tr>${headers.map(function (header, index) {
                let alignClass = (index >= 3 && header !== 'Uploaded By' && header !== 'Latest Upload') ? 'text-right' : 'text-left';
                return `<th class="px-4 py-3 ${alignClass} text-xs font-semibold text-slate-500 uppercase">${escapeHtml(header)}</th>`;
              }).join('')}</tr>
            </thead>
            <tbody class="divide-y divide-slate-100">${rowsHtml}</tbody>
          </table>
        </div>
      `;
    }

    positionUploadModalInsideMainContent();
    _('upload-details-modal').classList.remove('hidden');
    lockUploadModalScroll();
  }

  function closeUploadDetailsModal() {
    _('upload-details-modal').classList.add('hidden');
    unlockUploadModalScroll();
  }

  // -------------------------------------------------------------------
  // Link Product modal
  // -------------------------------------------------------------------
  function lockLinkModalScroll() {
    linkModalScrollTop = window.scrollY || document.documentElement.scrollTop || 0;
    document.documentElement.classList.add('modal-open');
    document.body.classList.add('modal-open');
    document.body.style.position = 'fixed';
    document.body.style.top = `-${linkModalScrollTop}px`;
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
  }

  function unlockLinkModalScroll() {
    document.documentElement.classList.remove('modal-open');
    document.body.classList.remove('modal-open');
    document.body.style.position = '';
    document.body.style.top = '';
    document.body.style.left = '';
    document.body.style.right = '';
    document.body.style.width = '';
    window.scrollTo(0, linkModalScrollTop);
  }

  function openLinkProductModal(aliasValue) {
    let aliasInput = _('link-alias-name');
    let masterInput = document.querySelector('input[name="master_product_name"]');
    aliasInput.value = aliasValue || '';
    masterInput.value = '';
    _('link-product-modal').classList.remove('hidden');
    lockLinkModalScroll();
    aliasInput.focus();
  }

  function closeLinkProductModal() {
    _('link-product-modal').classList.add('hidden');
    unlockLinkModalScroll();
  }

  function handleLinkProductSubmit(event) {
    event.preventDefault();
    let aliasInput = _('link-alias-name');
    let masterInput = document.querySelector('input[name="master_product_name"]');
    let aliasValue = (aliasInput.value || '').trim();
    let masterValue = (masterInput.value || '').trim();

    if (!aliasValue || !masterValue) {
      toast.error('Please fill the detected name and master product name first.');
      return;
    }

    showConfirmationModal({
      title: 'Confirm Product Link',
      message: `Link "${aliasValue}" to "${masterValue}"?`,
      confirmText: 'Link Product',
      cancelText: 'Cancel',
      onConfirm: function () {
        submitLinkProduct(aliasValue, masterValue);
      }
    });
  }

  function submitLinkProduct(aliasValue, masterValue) {
    fetch(linkProductApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        alias_name: aliasValue,
        master_product_name: masterValue
      })
    })
      .then(function (response) { return response.json(); })
      .then(function (result) {
        if (result.type !== 'success') {
          toast.error(result.message || 'Error linking product alias.');
          return;
        }
        toast.success(result.message);
        closeLinkProductModal();
        let startDate = _('analyzer-start-date').value;
        let endDate = _('analyzer-end-date').value;
        loadSystemAnalyzerData(startDate, endDate, '');
      })
      .catch(function () {
        toast.error('Error linking product alias.');
      });
  }

  // -------------------------------------------------------------------
  // Shared modal / table-action handlers
  // -------------------------------------------------------------------
  function handleGlobalTableActionClick(event) {
    let uploadBtn = event.target.closest('.open-upload-modal');
    if (uploadBtn) {
      event.preventDefault();
      openUploadDetailsModal(uploadBtn.getAttribute('data-source') || 'pos', uploadBtn.getAttribute('data-product') || '');
      return;
    }
    let linkBtn = event.target.closest('.open-link-modal');
    if (linkBtn) {
      event.preventDefault();
      openLinkProductModal(linkBtn.getAttribute('data-alias') || '');
    }
  }

  function handleModalEscapeKey(event) {
    if (event.key !== 'Escape') return;
    let uploadModal = _('upload-details-modal');
    let linkModal = _('link-product-modal');
    if (uploadModal && !uploadModal.classList.contains('hidden')) {
      event.preventDefault();
      closeUploadDetailsModal();
    } else if (linkModal && !linkModal.classList.contains('hidden')) {
      event.preventDefault();
      closeLinkProductModal();
    }
  }

  function preventBackdropWheelScroll(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function handleWindowResize() {
    let uploadModal = _('upload-details-modal');
    if (uploadModal && !uploadModal.classList.contains('hidden')) {
      positionUploadModalInsideMainContent();
    }
  }

  // -------------------------------------------------------------------
  // Init
  // -------------------------------------------------------------------
  function initializeSystemAnalyzer() {
    let params = new URLSearchParams(window.location.search);
    loadSystemAnalyzerData(params.get('start_date') || '', params.get('end_date') || '', params.get('link_alias') || '');
  }

  // -------------------------------------------------------------------
  // Event listeners
  // -------------------------------------------------------------------
  _('analyzer-analyze-btn').addEventListener('click', handleAnalyzeClick);
  _('pos-product-search').addEventListener('input', handlePosSearchInput);
  _('rso-product-search').addEventListener('input', handleRsoSearchInput);
  _('pos-prev-page').addEventListener('click', handlePosPrevClick);
  _('pos-next-page').addEventListener('click', handlePosNextClick);
  _('rso-prev-page').addEventListener('click', handleRsoPrevClick);
  _('rso-next-page').addEventListener('click', handleRsoNextClick);
  document.addEventListener('click', handleGlobalTableActionClick);
  document.addEventListener('keydown', handleModalEscapeKey);
  window.addEventListener('resize', handleWindowResize);

  _('upload-details-close').addEventListener('click', closeUploadDetailsModal);
  _('upload-details-backdrop').addEventListener('click', closeUploadDetailsModal);
  _('upload-details-backdrop').addEventListener('wheel', preventBackdropWheelScroll, { passive: false });

  _('link-product-close-x').addEventListener('click', closeLinkProductModal);
  _('link-product-cancel').addEventListener('click', closeLinkProductModal);
  _('link-product-backdrop').addEventListener('click', closeLinkProductModal);
  _('link-product-backdrop').addEventListener('wheel', preventBackdropWheelScroll, { passive: false });
  _('link-product-form').addEventListener('submit', handleLinkProductSubmit);

  initializeSystemAnalyzer();