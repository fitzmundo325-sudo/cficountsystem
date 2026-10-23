let auditRowsTarget = document.getElementById('auditRows');
let auditRowTemplate = document.getElementById('auditRowTemplate');
let auditEmptyRow = document.getElementById('auditEmptyRow');
let auditEmptyText = document.getElementById('auditEmptyText');
let auditScrollTarget = document.getElementById('auditScroll');
let auditSearchInput = document.getElementById('auditSearch');
let auditVisibleCount = document.getElementById('auditVisibleCount');
let auditFilterButtons = document.querySelectorAll('.audit-filter');
let auditSortButtons = document.querySelectorAll('.audit-sort');
let auditPagination = document.getElementById('auditPagination');
let auditPaginationInfo = document.getElementById('auditPaginationInfo');
let auditPaginationControls = document.getElementById('auditPaginationControls');
let auditPageBtnTemplate = document.getElementById('auditPageBtnTemplate');
let auditPageGapTemplate = document.getElementById('auditPageGapTemplate');
let refreshAuditBtn = document.getElementById('refreshAuditBtn');

let auditPerPage = 50;
let auditCurrentPage = parseInt(initialPage) || 1;
let auditActiveFilter = initialFilter || 'all';
let auditSort = initialSort || '';
let auditOrder = initialOrder || 'asc';
let auditSearchTimer = null;

let auditActionLabels = {
    'auth.login.success': 'Successful sign-in',
    'auth.login.failed': 'Failed sign-in attempt',
    'auth.logout': 'User signed out',
    'admin.user.create': 'User account created',
    'admin.user.update': 'User account updated',
    'admin.user.delete': 'User account deleted',
    'admin.store.create': 'Store created',
    'admin.store.assign_manager': 'Store manager changed',
    'admin.cluster.create': 'Cluster created',
    'admin.cluster.add_stores': 'Stores added to cluster',
    'admin.cluster.remove_store': 'Store removed from cluster',
    'admin.cluster.delete': 'Cluster deleted',
    'admin.cluster.assign_manager': 'Cluster manager changed',
    'admin.targets.upload': 'Targets uploaded',
    'admin.targets.update': 'Target value changed',
    'report.submit': 'Daily report submitted',
    'report.update_field': 'Daily report field edited',
    'report.approve': 'Daily report approved',
    'store.supply_request.create': 'Supply request submitted',
    'admin.supply_request.approve': 'Supply request approved',
    'admin.supply_request.reject': 'Supply request rejected',
    'admin.supply_request.delete': 'Supply request deleted',
    'admin.supply_item.create': 'Supply item created',
    'admin.supply_item.update': 'Supply item updated',
    'admin.supply_item.delete': 'Supply item deleted'
};

let auditCategoryStyles = {
    auth: {label: 'Auth', classes: 'bg-indigo-100 text-indigo-700'},
    admin: {label: 'Admin', classes: 'bg-amber-100 text-amber-700'},
    report: {label: 'Report', classes: 'bg-emerald-100 text-emerald-700'},
    other: {label: 'Other', classes: 'bg-slate-100 text-slate-700'}
};

function setAuditCell(root, name, value) {
    root.querySelector('[data-cell="' + name + '"]').textContent = value;
}

function loadAuditLogs() {
    qBuilder.page = auditCurrentPage;
    qBuilder.search = auditSearchInput.value.trim();
    qBuilder.sort = auditSort;
    qBuilder.order_by = auditOrder;
    qBuilder.server_address = '/apis/admin/audit-logs';
    qBuilder.sendQuery(
        handleAuditSuccess,
        undefined,
        [{name: 'filter', value: auditActiveFilter}],
        handleAuditError
    );
}



function handleAuditSuccess(response) {
    let data = JSON.parse(response.responseText);

    if (data.type !== 'success') {
        toast.error(data.message || 'Failed to load audit logs.');
        return;
    }
    auditCurrentPage = data.current_page;
    renderAuditStats(data.stats);
    renderAuditRows(data.results);
    renderAuditPagination(data);
    auditVisibleCount.textContent = 'Showing ' + data.results.length + ' of ' + data.total_results + ' records.';
}

function handleAuditError() {
    toast.error('Unable to reach the server.');
}

function renderAuditStats(stats) {
    document.getElementById('statTotal').textContent = stats.total;
    document.getElementById('statVerified').textContent = stats.verified;
    document.getElementById('statTampered').textContent = stats.tampered;
    document.getElementById('countAuth').textContent = stats.auth_events;
    document.getElementById('countAdmin').textContent = stats.admin_events;
    document.getElementById('countReport').textContent = stats.data_events;
}

function renderAuditRows(rows) {
    let oldRows = auditRowsTarget.querySelectorAll('.audit-row');
    for (let i = 0; i < oldRows.length; i++) {
        oldRows[i].remove();
    }
    auditScrollTarget.scrollTop = 0;

    let isFiltered = auditSearchInput.value.trim() !== '' || auditActiveFilter !== 'all';
    auditEmptyText.textContent = isFiltered ? 'No records match the current filters.' : 'No audit records found.';
    auditEmptyRow.classList.toggle('hidden', rows.length > 0);

    for (let i = 0; i < rows.length; i++) {
        auditRowsTarget.insertBefore(buildAuditRow(rows[i]), auditEmptyRow);
    }
}

function buildAuditRow(item) {
    let clone = auditRowTemplate.content.cloneNode(true);
    let style = auditCategoryStyles[item.category] || auditCategoryStyles.other;
    let badge = clone.querySelector('[data-cell="badge"]');
    let integrity = clone.querySelector('[data-cell="integrity"]');

    setAuditCell(clone, 'date', item.event_date || '--');
    setAuditCell(clone, 'time', item.event_clock || '--');
    setAuditCell(clone, 'actor', item.actor_username || 'System/Unknown');
    setAuditCell(clone, 'actor_id', 'User ID: ' + (item.actor_user_id || '--'));
    setAuditCell(clone, 'ip', item.ip_address || '--');
    setAuditCell(clone, 'action_text', auditActionLabels[item.action] || item.action);
    setAuditCell(clone, 'code', 'Code: ' + item.action);
    setAuditCell(clone, 'entity', (item.entity_type || 'Event') + (item.entity_id ? ' #' + item.entity_id : ''));
    setAuditCell(clone, 'endpoint', (item.http_method || '--') + ' ' + (item.endpoint || '--'));
    setAuditCell(clone, 'reason', item.reason || '--');
    setAuditCell(clone, 'details', item.details);
    setAuditCell(clone, 'hash', item.hash_short);

    badge.textContent = style.label;
    badge.className = badge.className + ' ' + style.classes;

    if (item.tampered) {
        integrity.textContent = 'Needs review';
        integrity.className = integrity.className + ' bg-red-100 text-red-700';
    } else {
        integrity.textContent = 'Trusted';
        integrity.className = integrity.className + ' bg-emerald-100 text-emerald-700';
    }

    return clone;
}

function appendAuditPageButton(label, page, isActive) {
    let clone = auditPageBtnTemplate.content.cloneNode(true);
    let btn = clone.querySelector('[data-cell="button"]');
    btn.textContent = label;
    if (isActive) {
        btn.className = 'rounded bg-indigo-600 px-3 py-1 text-sm font-medium text-white';
    } else {
        btn.dataset.page = page;
        btn.addEventListener('click', handleAuditPageClick);
    }
    auditPaginationControls.appendChild(clone);
}

function appendAuditPageGap() {
    auditPaginationControls.appendChild(auditPageGapTemplate.content.cloneNode(true));
}

function renderAuditPagination(data) {
    auditPaginationControls.innerHTML = '';
    if (data.total_pages <= 1) {
        auditPagination.classList.add('hidden');
        return;
    }
    auditPagination.classList.remove('hidden');

    let start = ((data.current_page - 1) * auditPerPage) + 1;
    let end = Math.min(data.current_page * auditPerPage, data.total_results);
    auditPaginationInfo.textContent = 'Showing ' + start + '\u2013' + end + ' of ' + data.total_results + ' results';

    if (data.current_page > 1) {
        appendAuditPageButton('\u00ab Prev', data.current_page - 1, false);
    }
    for (let p = 1; p <= data.total_pages; p++) {
        if (p === data.current_page) {
            appendAuditPageButton(String(p), p, true);
        } else if (p <= 3 || p > data.total_pages - 3 || (p >= data.current_page - 1 && p <= data.current_page + 1)) {
            appendAuditPageButton(String(p), p, false);
        } else if (p === 4 || p === data.total_pages - 3) {
            appendAuditPageGap();
        }
    }
    if (data.current_page < data.total_pages) {
        appendAuditPageButton('Next \u00bb', data.current_page + 1, false);
    }
}

function setActiveAuditFilterButton() {
    for (let i = 0; i < auditFilterButtons.length; i++) {
        let btn = auditFilterButtons[i];
        let isActive = btn.dataset.filter === auditActiveFilter;
        btn.classList.toggle('bg-slate-900', isActive);
        btn.classList.toggle('text-white', isActive);
        btn.classList.toggle('bg-slate-100', !isActive);
        btn.classList.toggle('text-slate-700', !isActive);
    }
}

function setAuditSortIcons() {
    for (let i = 0; i < auditSortButtons.length; i++) {
        let btn = auditSortButtons[i];
        let icon = btn.querySelector('.audit-sort-icon');
        if (btn.dataset.sort === auditSort) {
            icon.textContent = auditOrder === 'desc' ? '\u25bc' : '\u25b2';
        } else {
            icon.textContent = '\u2195';
        }
    }
}

function handleAuditSortClick() {
    let column = this.dataset.sort;
    if (auditSort === column) {
        auditOrder = auditOrder === 'asc' ? 'desc' : 'asc';
    } else {
        auditSort = column;
        auditOrder = 'asc';
    }
    auditCurrentPage = 1;
    setAuditSortIcons();
    loadAuditLogs();
    syncAuditUrl();
}

function syncAuditUrl() {
    let params = new URLSearchParams(window.location.search);
    let query = auditSearchInput.value.trim();
    params.set('page', auditCurrentPage);
    if (query) {
        params.set('search', query);
    } else {
        params.delete('search');
    }
    if (auditActiveFilter !== 'all') {
        params.set('filter', auditActiveFilter);
    } else {
        params.delete('filter');
    }
    if (auditSort) {
        params.set('sort', auditSort);
        params.set('order_by', auditOrder);
    } else {
        params.delete('sort');
        params.delete('order_by');
    }
    history.pushState({}, '', '?' + params.toString());
}

function handleAuditPageClick() {
    auditCurrentPage = parseInt(this.dataset.page) || 1;
    loadAuditLogs();
    syncAuditUrl();
}

function handleAuditFilterClick() {
    auditActiveFilter = this.dataset.filter || 'all';
    auditCurrentPage = 1;
    setActiveAuditFilterButton();
    loadAuditLogs();
    syncAuditUrl();
}

function runAuditSearch() {
    auditCurrentPage = 1;
    loadAuditLogs();
    syncAuditUrl();
}

function handleAuditSearchInput() {
    clearTimeout(auditSearchTimer);
    auditSearchTimer = setTimeout(runAuditSearch, 350);
}

function handleAuditRefresh() {
    loadAuditLogs();
}

function handleAuditPopState() {
    let params = new URLSearchParams(window.location.search);
    auditCurrentPage = parseInt(params.get('page')) || 1;
    auditSearchInput.value = params.get('search') || '';
    auditActiveFilter = params.get('filter') || 'all';
    auditSort = params.get('sort') || '';
    auditOrder = params.get('order_by') || 'asc';
    setAuditSortIcons();
    setActiveAuditFilterButton();
    loadAuditLogs();
}

for (let i = 0; i < auditFilterButtons.length; i++) {
    auditFilterButtons[i].addEventListener('click', handleAuditFilterClick);
}
for (let i = 0; i < auditSortButtons.length; i++) {
    auditSortButtons[i].addEventListener('click', handleAuditSortClick);
}
auditSearchInput.addEventListener('input', handleAuditSearchInput);
refreshAuditBtn.addEventListener('click', handleAuditRefresh);
window.addEventListener('popstate', handleAuditPopState);

auditSearchInput.value = initialSearch || '';
setAuditSortIcons();
setActiveAuditFilterButton();
loadAuditLogs();