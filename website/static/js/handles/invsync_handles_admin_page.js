let invenSyncData = null;
let currentTab = 'summary';

function loadInvenSyncData() {
    let storeScope = localStorage.getItem('storeScope') || 'official';
    const url = `/apis/get_invensync_data?store_scope=${encodeURIComponent(storeScope)}`;

    fetch(url, { credentials: 'same-origin' })
        .then(response => response.json())
        .then(data => {
            if (data.type !== 'success') {
                toast.error(data.message || 'Unable to load Invensync data.');
                return;
            }
            invenSyncData = data;
            renderStoreCards(data.store_summaries);
            populateForceBeginningSelect(data.stores);
            populateStoreConfigSelect(data.stores);
            renderGlobalConfigFields(data.config_fields, data.global_invensync_config);
            renderStoreConfigFields(data.config_fields);
            renderForceBeginningWaiting(data.stores, data.global_invensync_config);
            filterInvensyncStores();
            document.getElementById('invensyncStoreLoading').style.display = 'none';
        })
        .catch(error => {
            toast.error(error.message || 'Failed to load Invensync data.');
        });
}

// --- Tab switching ---

function initTabsFromRole() {
    const restrictedRoles = ('General Manager', 'Auditor', 'Area Manager');
    if (!restrictedRoles.includes(currentUserRole)) {
        document.getElementById('configTabBtn').style.display = '';
        document.getElementById('storeConfigTabBtn').style.display = '';
    }
}

function switchInvenSyncTab(tab, pushState) {
    const restrictedRoles = ['General Manager', 'Auditor', 'Area Manager'];
    if (restrictedRoles.includes(currentUserRole) && (tab === 'config' || tab === 'store_config')) {
        tab = 'summary';
    }
    currentTab = tab;

    document.getElementById('summaryTab').style.display = tab === 'summary' ? 'block' : 'none';
    document.getElementById('configTab').style.display = tab === 'config' ? 'block' : 'none';
    document.getElementById('storeConfigTab').style.display = tab === 'store_config' ? 'block' : 'none';

    [
        [document.getElementById('summaryTabBtn'), tab === 'summary'],
        [document.getElementById('configTabBtn'), tab === 'config'],
        [document.getElementById('storeConfigTabBtn'), tab === 'store_config']
    ].forEach(([button, isActive]) => {
        if (!button) return;
        button.classList.toggle('bg-slate-900', isActive);
        button.classList.toggle('text-white', isActive);
        button.classList.toggle('bg-slate-100', !isActive);
        button.classList.toggle('text-slate-700', !isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    if (pushState) {
        const params = new URLSearchParams(window.location.search);
        params.set('tab', tab);
        history.pushState({ tab }, '', `${window.location.pathname}?${params.toString()}`);
    }
}

function handleSummaryTabClick() { switchInvenSyncTab('summary', true); }
function handleConfigTabClick() { switchInvenSyncTab('config', true); }
function handleStoreConfigTabClick() { switchInvenSyncTab('store_config', true); }

window.addEventListener('popstate', (event) => {
    const tab = (event.state && event.state.tab) || 'summary';
    switchInvenSyncTab(tab, false);
});

// --- Store card rendering ---

function getStoreNameSizeClass(name) {
    const storeScope = localStorage.getItem('storeScope') || 'official';
    const length = (name || '').length;
    if (storeScope === 'starlink' && length > 32) return 'text-xs';
    if (storeScope === 'starlink' && length > 22) return 'text-sm';
    return 'text-base';
}

function getPresenceClasses(state) {
    if (state === 'online') return ['shadow-[0_0_20px_6px_rgba(52,211,153,0.45)]', 'ring-emerald-400/50'];
    if (state === 'active') return ['shadow-[0_0_20px_6px_rgba(56,189,248,0.45)]', 'ring-sky-400/50'];
    if (state === 'idle') return ['shadow-[0_0_20px_6px_rgba(148,163,184,0.4)]', 'ring-slate-400/50'];
    return ['shadow-[0_0_20px_6px_rgba(248,113,113,0.45)]', 'ring-red-400/50'];
}

function getPresenceTitle(state) {
    if (state === 'online') return 'Online / Browsing';
    if (state === 'active') return 'Typing / Inputting / Uploading';
    if (state === 'idle') return 'Idle / AFK';
    return 'Offline';
}

function fillStatusPill(container, status, label) {
    const template = document.getElementById('statusPillTemplate');
    const node = template.content.cloneNode(true);
    const wrapper = node.querySelector('[data-cell="wrapper"]');
    const titleText = node.querySelector('[data-cell="title-text"]');
    const dot = node.querySelector('[data-cell="dot"]');
    const copy = node.querySelector('[data-cell="copy"]');
    const pills = node.querySelector('[data-cell="pills"]');

    const isUpToDate = status ? status.is_up_to_date : false;

    if (isUpToDate) {
        wrapper.classList.add('is-current', 'border-emerald-200', 'bg-emerald-50');
        wrapper.querySelector('[data-cell="title-row"]').classList.add('text-emerald-700');
        dot.classList.add('bg-emerald-500');
        titleText.textContent = `${label} up to date through ${status.latest_date || 'N/A'}`;
    } else {
        wrapper.classList.add('is-missing', 'border-amber-200', 'bg-amber-50');
        wrapper.querySelector('[data-cell="title-row"]').classList.add('text-amber-800');
        dot.classList.add('bg-amber-500');
        titleText.textContent = `${label} not up to date`;

        const missingCount = status ? status.missing_count : 0;
        copy.textContent = `${missingCount} missing date${missingCount === 1 ? '' : 's'} this month.`;
        copy.classList.add('text-amber-800/80');
        copy.style.display = '';

        const missingDates = (status && status.missing_dates) || [];
        const missingRanges = (status && status.missing_ranges) || [];
        let pillItems = [];
        if (missingDates.length && missingDates.length <= 3) {
            pillItems = missingDates.slice(0, 3).map(d => d.label);
        } else if (missingRanges.length) {
            pillItems = missingRanges.slice(0, 3).map(r => r.label);
            if (missingRanges.length > 3) {
                pillItems.push(`+${missingRanges.length - 3} more range${missingRanges.length - 3 === 1 ? '' : 's'}`);
            }
        }
        if (pillItems.length) {
            pillItems.forEach(text => {
                const pillSpan = document.createElement('span');
                pillSpan.className = 'status-pill rounded-full bg-white/80 px-2 py-0.5 text-[11px] font-semibold text-amber-800 ring-1 ring-amber-200';
                pillSpan.textContent = text;
                pills.appendChild(pillSpan);
            });
            pills.style.display = '';
        }
    }

    container.appendChild(node);
}

function renderStoreCards(storeSummaries) {
    const grid = document.getElementById('invensyncStoreGrid');
    grid.innerHTML = '';
    const template = document.getElementById('storeCardTemplate');

    storeSummaries.forEach(summary => {
        const node = template.content.cloneNode(true);
        const card = node.querySelector('[data-cell="card"]');
        const store = summary.store;

        card.dataset.storeSearch = `${store.name} ${store.id}`.toLowerCase();

        const presenceIcon = node.querySelector('[data-cell="presence-icon"]');
        presenceIcon.dataset.storeId = store.id;
        presenceIcon.classList.add(...getPresenceClasses(summary.presence_state));
        presenceIcon.title = getPresenceTitle(summary.presence_state);
        presenceIcon.classList.add('invensync-presence-icon');

        const nameEl = node.querySelector('[data-cell="store-name"]');
        nameEl.textContent = store.name;
        nameEl.classList.add(getStoreNameSizeClass(store.name));

        node.querySelector('[data-cell="store-id"]').textContent = `Store ID: ${store.id}`;

        if (summary.has_data && summary.inventory) {
            const link = node.querySelector('[data-cell="view-details-link"]');
            const params = new URLSearchParams();
            if (summary.inventory.inventory_date_iso) params.set('date', summary.inventory.inventory_date_iso);
            params.set('store_id', store.id);
            link.href = `${invenSyncDetailBaseUrl}?${params.toString()}`;
            link.style.display = '';

            const dateWrap = node.querySelector('[data-cell="inventory-date-wrap"]');
            node.querySelector('[data-cell="inventory-date"]').textContent = summary.inventory.inventory_date || 'N/A';
            dateWrap.style.display = '';
        } else {
            node.querySelector('[data-cell="no-data-badge"]').style.display = '';
            node.querySelector('[data-cell="no-records"]').style.display = '';
        }

        const statusScroll = node.querySelector('[data-cell="status-scroll"]');
        statusScroll.setAttribute('aria-label', `Update status for ${store.name}`);
        fillStatusPill(statusScroll, summary.update_status.inventory, 'Inventory');
        fillStatusPill(statusScroll, summary.update_status.pos_sold, 'POS Sold');
        fillStatusPill(statusScroll, summary.update_status.delivery, 'Delivery');

        const tierNoneBtn = node.querySelector('[data-cell="tier-none-btn"]');
        const tierPremiumBtn = node.querySelector('[data-cell="tier-premium-btn"]');
        tierNoneBtn.id = `tier-none-${store.id}`;
        tierPremiumBtn.id = `tier-premium-${store.id}`;
        applyTierButtonClasses(tierNoneBtn, tierPremiumBtn, store.store_group);
        tierNoneBtn.addEventListener('click', () => changePricingTier(store.id, 'non_premium'));
        tierPremiumBtn.addEventListener('click', () => changePricingTier(store.id, 'premium'));

        grid.appendChild(node);
    });

    initializeInvensyncCardScrolling();
}

function applyTierButtonClasses(noneBtn, premiumBtn, storeGroup) {
    const base = 'flex-1 text-center px-3 py-2 text-xs font-medium rounded-lg transition';
    noneBtn.className = storeGroup === 'non_premium'
        ? `${base} bg-amber-600 text-white`
        : `${base} bg-slate-200 text-slate-700 hover:bg-slate-300`;
    premiumBtn.className = storeGroup === 'premium'
        ? `${base} bg-indigo-600 text-white`
        : `${base} bg-slate-200 text-slate-700 hover:bg-slate-300`;
}

// --- Search filter ---

function filterInvensyncStores() {
    const searchInput = document.getElementById('invensyncStoreSearch');
    const query = String(searchInput?.value || '').trim().toLowerCase();
    const cards = Array.from(document.querySelectorAll('.invensync-store-card'));
    let visibleCount = 0;

    cards.forEach((card) => {
        const haystack = `${card.dataset.storeSearch || ''} ${card.textContent || ''}`.toLowerCase();
        const isMatch = !query || haystack.includes(query);
        card.classList.toggle('hidden', !isMatch);
        if (isMatch) visibleCount += 1;
    });

    const noResults = document.getElementById('invensyncStoreNoResults');
    if (noResults) noResults.classList.toggle('hidden', visibleCount !== 0 || cards.length === 0);
}

// --- Card scroll activation ---

function initializeInvensyncCardScrolling() {
    const cards = Array.from(document.querySelectorAll('.invensync-store-card'));

    const deactivateCards = (exceptCard = null) => {
        cards.forEach((card) => {
            if (card === exceptCard) return;
            card.classList.remove('is-scroll-active');
            card.querySelector('.invensync-card-status-scroll')?.setAttribute('tabindex', '-1');
        });
    };

    cards.forEach((card) => {
        card.addEventListener('click', () => {
            const statusList = card.querySelector('.invensync-card-status-scroll');
            if (!statusList) return;
            deactivateCards(card);
            card.classList.add('is-scroll-active');
            statusList.setAttribute('tabindex', '0');
            statusList.focus({ preventScroll: true });
        });
    });

    document.addEventListener('click', (event) => {
        if (!event.target.closest('.invensync-store-card')) deactivateCards();
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') deactivateCards();
    });
}

// --- Pricing tier ---

function changePricingTier(storeId, tier) {
    fetch('/apis/update_store_pricing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: storeId, tier: tier })
    })
        .then(response => response.json())
        .then(data => {
            if (data.type === 'success') {
                const noneBtn = document.getElementById(`tier-none-${storeId}`);
                const premiumBtn = document.getElementById(`tier-premium-${storeId}`);
                applyTierButtonClasses(noneBtn, premiumBtn, tier === 'premium' ? 'premium' : 'non_premium');
                toast.success(`Pricing tier updated to ${tier === 'premium' ? 'PREMIUM' : 'NONE'}.`);
            } else {
                toast.error(data.message || 'Error updating pricing tier');
            }
        })
        .catch(error => toast.error('Error updating pricing tier: ' + error.message));
}

// --- Global config tab ---

function populateForceBeginningSelect(stores) {
    const select = document.getElementById('forceBeginningStore');
    select.innerHTML = '<option value="">Select affected store</option>';
    stores.forEach(store => {
        const option = document.createElement('option');
        option.value = store.id;
        option.textContent = store.name;
        select.appendChild(option);
    });
}

function renderForceBeginningWaiting(stores, config) {
    const forcedIds = new Set((config.force_beginning_store_ids || []).map(String));
    const waitingWrap = document.getElementById('forceBeginningWaiting');
    const waitingList = document.getElementById('forceBeginningWaitingList');
    waitingList.innerHTML = '';

    const waitingStores = stores.filter(store => forcedIds.has(String(store.id)));
    if (!waitingStores.length) {
        waitingWrap.style.display = 'none';
        return;
    }
    waitingStores.forEach(store => {
        const badge = document.createElement('span');
        badge.className = 'ml-1 inline-flex rounded-full bg-amber-200 px-2 py-1 font-semibold';
        badge.textContent = store.name;
        waitingList.appendChild(badge);
    });
    waitingWrap.style.display = '';
}

function forceBeginningEntry() {
    const storeId = document.getElementById('forceBeginningStore').value;
    const button = document.getElementById('forceBeginningBtn');
    if (!storeId) {
        toast.warn('Please select a store.');
        return;
    }
    button.disabled = true;
    button.classList.add('opacity-50', 'cursor-not-allowed');

    fetch('/apis/force_invensync_beginning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ store_id: Number(storeId) })
    })
        .then(response => response.json())
        .then(data => {
            if (data.type !== 'success') throw new Error(data.message || 'Unable to enable Beginning entry.');
            toast.success(data.message);
            loadInvenSyncData();
        })
        .catch(error => toast.error(error.message))
        .finally(() => {
            button.disabled = false;
            button.classList.remove('opacity-50', 'cursor-not-allowed');
        });
}

function backfillPosSold() {
    const button = document.getElementById('backfillPosSoldBtn');
    button.disabled = true;
    button.classList.add('opacity-50', 'cursor-not-allowed');
    button.textContent = 'Running backfill...';

    fetch('/apis/backfill_pos_sold', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
        .then(response => response.json())
        .then(data => {
            if (data.type === 'success') {
                toast.success(data.message || 'Backfill complete.');
            } else {
                toast.error(data.message || 'Backfill failed.');
            }
        })
        .catch(error => toast.error(error.message || 'Request failed.'))
        .finally(() => {
            button.disabled = false;
            button.classList.remove('opacity-50', 'cursor-not-allowed');
            button.textContent = 'Run Backfill';
        });
}

function toggleSelectAll(cls, btn) {
    const checkboxes = document.querySelectorAll('.' + cls);
    const allChecked = Array.from(checkboxes).every(cb => cb.checked);
    checkboxes.forEach(cb => cb.checked = !allChecked);
    btn.textContent = allChecked ? 'Select All' : 'Deselect All';
}

function renderGlobalConfigFields(configFields, globalConfig) {
    const tbody = document.getElementById('globalConfigFieldsBody');
    tbody.innerHTML = '';
    const template = document.getElementById('configFieldRowTemplate');
    const hidden = new Set(globalConfig.hidden_columns || []);
    const locked = new Set(globalConfig.locked_columns || []);
    const editable = new Set(globalConfig.editable_columns || []);

    configFields.forEach(field => {
        const node = template.content.cloneNode(true);
        node.querySelector('[data-cell="label"]').textContent = field.label;
        const hiddenCb = node.querySelector('[data-cell="hidden-checkbox"]');
        const lockedCb = node.querySelector('[data-cell="locked-checkbox"]');
        const editableCb = node.querySelector('[data-cell="editable-checkbox"]');
        hiddenCb.value = field.value;
        lockedCb.value = field.value;
        editableCb.value = field.value;
        hiddenCb.checked = hidden.has(field.value);
        lockedCb.checked = locked.has(field.value);
        editableCb.checked = editable.has(field.value);
        tbody.appendChild(node);
    });
}

function saveInvensyncConfig() {
    const hiddenColumns = Array.from(document.querySelectorAll('.hidden-column-checkbox:checked')).map(el => el.value);
    const lockedColumns = Array.from(document.querySelectorAll('.locked-column-checkbox:checked')).map(el => el.value);
    const editableColumns = Array.from(document.querySelectorAll('.editable-column-checkbox:checked')).map(el => el.value);
    const globalConfig = invenSyncData.global_invensync_config;

    const saveBtn = document.getElementById('saveConfigBtn');
    saveBtn.disabled = true;
    saveBtn.classList.add('opacity-50', 'cursor-not-allowed');
    saveBtn.textContent = 'Saving...';

    fetch('/apis/update_invensync_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            hidden_rows: globalConfig.hidden_rows || [],
            hidden_columns: hiddenColumns,
            hidden_cells: globalConfig.hidden_cells || [],
            locked_rows: globalConfig.locked_rows || [],
            locked_columns: lockedColumns,
            locked_cells: globalConfig.locked_cells || [],
            editable_columns: editableColumns
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.type === 'success') {
                toast.success(data.message || 'Global config saved.');
            } else {
                toast.error(data.message || 'Unable to save config.');
            }
        })
        .catch(() => toast.error('Error saving config.'))
        .finally(() => {
            saveBtn.disabled = false;
            saveBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            saveBtn.textContent = 'Save Global Config';
        });
}

// --- Store config tab ---

function populateStoreConfigSelect(stores) {
    const select = document.getElementById('storeConfigSelect');
    select.innerHTML = '<option value="">Select store</option>';
    stores.forEach(store => {
        const option = document.createElement('option');
        option.value = store.id;
        option.textContent = store.name;
        select.appendChild(option);
    });
}

function renderStoreConfigFields(configFields) {
    const tbody = document.getElementById('storeConfigFieldsBody');
    tbody.innerHTML = '';
    const template = document.getElementById('storeConfigFieldRowTemplate');

    configFields.forEach(field => {
        const node = template.content.cloneNode(true);
        node.querySelector('[data-cell="label"]').textContent = field.label;
        node.querySelector('[data-cell="hidden-checkbox"]').value = field.value;
        node.querySelector('[data-cell="locked-checkbox"]').value = field.value;
        node.querySelector('[data-cell="editable-checkbox"]').value = field.value;
        tbody.appendChild(node);
    });
}

function setCheckboxGroupValues(cls, values) {
    const valueSet = new Set((values || []).map(value => String(value)));
    document.querySelectorAll('.' + cls).forEach((checkbox) => {
        checkbox.checked = valueSet.has(String(checkbox.value));
    });
}

function getCheckboxGroupValues(cls) {
    return Array.from(document.querySelectorAll('.' + cls + ':checked')).map(el => el.value);
}

function loadStoreInvensyncConfig() {
    const storeSelect = document.getElementById('storeConfigSelect');
    const storeId = storeSelect.value;
    const saveBtn = document.getElementById('saveStoreConfigBtn');
    const storeConfigs = invenSyncData.store_invensync_configs || {};
    const globalColumnConfig = invenSyncData.global_invensync_config;

    const storeConfig = storeId && storeConfigs[String(storeId)]
        ? storeConfigs[String(storeId)]
        : globalColumnConfig;

    setCheckboxGroupValues('store-hidden-column-checkbox', storeConfig.hidden_columns || []);
    setCheckboxGroupValues('store-locked-column-checkbox', storeConfig.locked_columns || []);
    setCheckboxGroupValues('store-editable-column-checkbox', storeConfig.editable_columns || []);

    saveBtn.disabled = !storeId;
    saveBtn.classList.toggle('opacity-50', !storeId);
    saveBtn.classList.toggle('cursor-not-allowed', !storeId);
}

function saveStoreInvensyncConfig() {
    const storeSelect = document.getElementById('storeConfigSelect');
    const storeId = storeSelect.value;
    const saveBtn = document.getElementById('saveStoreConfigBtn');

    if (!storeId) {
        toast.warn('Please select a store.');
        return;
    }

    saveBtn.disabled = true;
    saveBtn.classList.add('opacity-50', 'cursor-not-allowed');
    saveBtn.textContent = 'Saving...';

    fetch('/apis/update_store_invensync_config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            store_id: Number(storeId),
            hidden_columns: getCheckboxGroupValues('store-hidden-column-checkbox'),
            locked_columns: getCheckboxGroupValues('store-locked-column-checkbox'),
            editable_columns: getCheckboxGroupValues('store-editable-column-checkbox')
        })
    })
        .then(response => response.json())
        .then(data => {
            if (data.type !== 'success') throw new Error(data.message || 'Unable to save store config.');
            invenSyncData.store_invensync_configs[String(storeId)] = {
                hidden_columns: getCheckboxGroupValues('store-hidden-column-checkbox'),
                locked_columns: getCheckboxGroupValues('store-locked-column-checkbox'),
                editable_columns: getCheckboxGroupValues('store-editable-column-checkbox')
            };
            toast.success(data.message || 'Store config saved.');
        })
        .catch(error => toast.error(error.message))
        .finally(() => {
            saveBtn.disabled = false;
            saveBtn.classList.remove('opacity-50', 'cursor-not-allowed');
            saveBtn.textContent = 'Save Store Config';
        });
}

// --- Presence polling ---

let presenceRefreshInFlight = false;
function refreshInvensyncPresence() {
    if (presenceRefreshInFlight) return;
    presenceRefreshInFlight = true;
    fetch(storePresenceUrl, { credentials: 'same-origin', cache: 'no-store' })
        .then(response => response.ok ? response.json() : Promise.reject(new Error('Presence unavailable')))
        .then(data => {
            const statuses = data.stores || {};
            document.querySelectorAll('.invensync-presence-icon').forEach(icon => {
                const state = statuses[String(icon.dataset.storeId)] || 'offline';
                icon.classList.remove(
                    'shadow-[0_0_20px_6px_rgba(52,211,153,0.45)]', 'ring-emerald-400/50',
                    'shadow-[0_0_20px_6px_rgba(56,189,248,0.45)]', 'ring-sky-400/50',
                    'shadow-[0_0_20px_6px_rgba(148,163,184,0.4)]', 'ring-slate-400/50',
                    'shadow-[0_0_20px_6px_rgba(248,113,113,0.45)]', 'ring-red-400/50'
                );
                icon.classList.add(...getPresenceClasses(state));
                icon.title = getPresenceTitle(state);
            });
        })
        .catch(() => {})
        .finally(() => { presenceRefreshInFlight = false; });
}

// --- Init ---

initTabsFromRole();

const initialTab = new URLSearchParams(window.location.search).get('tab') || 'summary';
switchInvenSyncTab(initialTab, false);

document.getElementById('summaryTabBtn').addEventListener('click', handleSummaryTabClick);
document.getElementById('configTabBtn').addEventListener('click', handleConfigTabClick);
document.getElementById('storeConfigTabBtn').addEventListener('click', handleStoreConfigTabClick);

const invensyncStoreSearch = document.getElementById('invensyncStoreSearch');
invensyncStoreSearch?.addEventListener('input', filterInvensyncStores);
invensyncStoreSearch?.addEventListener('search', filterInvensyncStores);

document.getElementById('forceBeginningBtn').addEventListener('click', forceBeginningEntry);
document.getElementById('backfillPosSoldBtn').addEventListener('click', backfillPosSold);
document.getElementById('saveConfigBtn').addEventListener('click', saveInvensyncConfig);
document.getElementById('storeConfigSelect').addEventListener('change', loadStoreInvensyncConfig);
document.getElementById('saveStoreConfigBtn').addEventListener('click', saveStoreInvensyncConfig);

document.getElementById('selectAllHiddenGlobalBtn').addEventListener('click', function () { toggleSelectAll('hidden-column-checkbox', this); });
document.getElementById('selectAllLockedGlobalBtn').addEventListener('click', function () { toggleSelectAll('locked-column-checkbox', this); });
document.getElementById('selectAllEditableGlobalBtn').addEventListener('click', function () { toggleSelectAll('editable-column-checkbox', this); });
document.getElementById('selectAllHiddenStoreBtn').addEventListener('click', function () { toggleSelectAll('store-hidden-column-checkbox', this); });
document.getElementById('selectAllLockedStoreBtn').addEventListener('click', function () { toggleSelectAll('store-locked-column-checkbox', this); });
document.getElementById('selectAllEditableStoreBtn').addEventListener('click', function () { toggleSelectAll('store-editable-column-checkbox', this); });

loadInvenSyncData();
window.setInterval(refreshInvensyncPresence, 5000);
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refreshInvensyncPresence();
});





function monitorChangesHere(key="shouldReload",loader=undefined, custom_counter=2000){
	let timer_c = setInterval(check, custom_counter);
	function check(){
		if(firstLoad){
			firstLoad = false;
			return;
		}
		let rl = localStorage.getItem(key);
		if(rl == 'true'){
			localStorage.removeItem(key);
			if(loader == undefined){
			}else{
				loader();
			}
			
		}
	}
}



//Extra Changes Monitor
monitorChangesHere("hasStoreScopeChanges", handleStoreScopeChanges, 1000);
let hasFirstOpen = true;

function handleStoreScopeChanges(){
	
	let storeScope = localStorage.getItem('storeScope') || 'official';
	
	loadInvenSyncData();

	if(hasFirstOpen){
		return hasFirstOpen = false;
	}
	toast.info("Store View Changed to "+ storeScope);
}

