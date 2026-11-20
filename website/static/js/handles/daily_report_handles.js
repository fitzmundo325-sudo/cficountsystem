let reportForm = document.getElementById('daily-report-form');
let reportDateInput = document.getElementById('report_date');
let submitReportBtn = document.getElementById('submit-daily-report-btn');
let posSoldLink = document.getElementById('pos-sold-link');
let headerStoreName = document.getElementById('header-store-name');
let pageStoreName = document.getElementById('page-store-name');
let recentSection = document.getElementById('recent-reports-section');
let recentBody = document.getElementById('recent-reports-body');
let missingModal = document.getElementById('missing-dates-modal');
let missingList = document.getElementById('missing-dates-list');
let missingCount = document.getElementById('missing-dates-count');
let goMissingBtn = document.getElementById('missing-dates-go');

let storeName = '';
let missingDates = [];
let nextMissingDate = null;
let allowDailyReportSubmit = false;

let fieldsToWatch = [
  'pos_gross_sales', 'pos_net_sales', 'pos_tc',
  'ci_regular_gross_sales', 'ci_regular_net_sales', 'ci_tc'
];

/* - Helpers - */

function notifyError(message) {
  if (typeof toast !== 'undefined' && typeof toast.error === 'function') {
    toast.error(message);
  }
}

function appendQuery(url, name, value) {
  let joiner = url.indexOf('?') === -1 ? '?' : '&';
  return url + joiner + encodeURIComponent(name) + '=' + encodeURIComponent(value);
}

function buildPageUrl(dateValue, lockFlag) {
  let url = DAILY_REPORT_ROUTES.page;
  if (dateValue) url = appendQuery(url, 'date', dateValue);
  if (lockFlag) url = appendQuery(url, 'lock_date', '1');
  return url;
}

function updatePosSoldLink(dateValue) {
  if (!posSoldLink) return;
  let url = DAILY_REPORT_ROUTES.posSold;
  if (dateValue) url = appendQuery(url, 'date', dateValue);
  posSoldLink.href = url;
}

function setLoading(isLoading) {
  if (!submitReportBtn) return;
  submitReportBtn.disabled = isLoading;
}

function redirectHome() {
  window.location.href = DAILY_REPORT_ROUTES.home;
}

/* - Totals and formatting - */

function calculateTotals() {
  let posGross = parseFloat(document.getElementById('pos_gross_sales').value) || 0;
  let posNet = parseFloat(document.getElementById('pos_net_sales').value) || 0;
  let posTc = parseInt(document.getElementById('pos_tc').value) || 0;

  let ciGross = parseFloat(document.getElementById('ci_regular_gross_sales').value) || 0;
  let ciNet = parseFloat(document.getElementById('ci_regular_net_sales').value) || 0;
  let ciTc = parseInt(document.getElementById('ci_tc').value) || 0;

  let totalGross = posGross + ciGross;
  let totalNet = posNet + ciNet;
  let totalTc = posTc + ciTc;

  let totalGrossField = document.getElementById('total_gross_sales');
  let totalNetField = document.getElementById('total_net_sales');
  let totalTcField = document.getElementById('total_tc');
  if (totalGrossField) totalGrossField.value = totalGross.toFixed(2);
  if (totalNetField) totalNetField.value = totalNet.toFixed(2);
  if (totalTcField) totalTcField.value = totalTc;
}

function hasAnyReportValue(form) {
  let fields = form.querySelectorAll('input, select, textarea');
  for (let field of fields) {
    if (!field.name || field.disabled) continue;
    if (field.name === 'report_date') continue;
    if (field.type === 'submit' || field.type === 'button' || field.type === 'reset' || field.type === 'hidden') continue;
    if (field.type === 'checkbox' || field.type === 'radio') {
      if (field.checked) return true;
      continue;
    }
    if (field.value && field.value.trim() !== '') return true;
  }
  return false;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function getRawValue(form, fieldName) {
  let el = form.querySelector(`[name="${fieldName}"]`);
  if (!el) return '';
  return String(el.value || '').trim();
}

function formatAmount(raw) {
  if (raw === '') return '--';
  let value = Number(raw);
  if (Number.isNaN(value)) return '--';
  let isInteger = Number.isInteger(value);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: isInteger ? 0 : 2,
    maximumFractionDigits: isInteger ? 0 : 2
  }).format(value);
}

function formatCount(raw) {
  if (raw === '') return '--';
  let value = Number(raw);
  if (Number.isNaN(value)) return '--';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
}

function formatDateLong(isoDate) {
  if (!isoDate) return '--';
  let dt = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return isoDate;
  return dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function formatMonthShort(isoDate) {
  if (!isoDate) return '--';
  let dt = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return '--';
  return dt.toLocaleDateString('en-US', { month: 'short' });
}

function formatPair(form, salesField, tcField) {
  let sales = formatAmount(getRawValue(form, salesField));
  let tc = formatCount(getRawValue(form, tcField));
  return `${sales} / ${tc}`;
}

function formatPeso(value) {
  let amount = Number(value) || 0;
  return '\u20B1' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildSubmitSummary(form, name, reportDate) {
  let posGrossRaw = getRawValue(form, 'pos_gross_sales');
  let posNetRaw = getRawValue(form, 'pos_net_sales');
  let posTcRaw = getRawValue(form, 'pos_tc');
  let ciGrossRaw = getRawValue(form, 'ci_regular_gross_sales');
  let ciNetRaw = getRawValue(form, 'ci_regular_net_sales');
  let ciTcRaw = getRawValue(form, 'ci_tc');

  let totalGross = (Number(posGrossRaw || 0) + Number(ciGrossRaw || 0));
  let totalNet = (Number(posNetRaw || 0) + Number(ciNetRaw || 0));
  let totalTc = (Number(posTcRaw || 0) + Number(ciTcRaw || 0));
  let hasTotals = [posGrossRaw, ciGrossRaw, posNetRaw, ciNetRaw, posTcRaw, ciTcRaw].some(Boolean);

  let lines = [
    `📌Store: ${name || '--'}`,
    `📌Date: ${formatDateLong(reportDate)}`,
    '',
    `👉POS GROSS SALES: ${formatAmount(posGrossRaw)}`,
    `👉POS NET SALES: ${formatAmount(posNetRaw)}`,
    `👉TC: ${formatCount(posTcRaw)}`,
    '',
    `👉C.I Regular Gross Sales: ${formatAmount(ciGrossRaw)}`,
    `👉C.I Regular Net Sale: ${formatAmount(ciNetRaw)}`,
    `👉C.I. Tc: ${formatCount(ciTcRaw)}`,
    '',
    `✅CI Number: ${getRawValue(form, 'ci_number') || '--'}`,
    `✅CI Sales Discount: ${formatAmount(getRawValue(form, 'ci_sales_discount'))}`,
    '',
    `➡️Total Gross Sales: ${hasTotals ? formatAmount(String(totalGross)) : '--'}`,
    `➡️Total Net Sales: ${hasTotals ? formatAmount(String(totalNet)) : '--'}`,
    `➡️Total Tc: ${hasTotals ? formatCount(String(totalTc)) : '--'}`,
    `👉Total Tgt Sales: --`,
    `👉Total LY Sales: --`,
    `👉Total Tc LY: --`,
    '',
    `🔴SGA (Should be in Net Sales)`,
    `✅Boothselling/TC: ${formatPair(form, 'boothselling_sales', 'boothselling_tc')}`,
    `✅Bulk Order/TC: ${formatPair(form, 'bulk_order_sales', 'bulk_order_tc')}`,
    `✅Reseller/TC: ${formatPair(form, 'reseller_sales', 'reseller_tc')}`,
    `✅Tie-up/TC: ${formatPair(form, 'tieup_sales', 'tieup_tc')}`,
    `✅Ambulant Sales/TC: ${formatPair(form, 'ambulant_sales', 'ambulant_tc')}`,
    `✅Extended Hours/TC: ${formatPair(form, 'extended_hours_sales', 'extended_hours_tc')}`,
    '',
    `🔴Aggregators (Should be in Net Sales)`,
    `✅GDS/TC: ${formatPair(form, 'gds_sales', 'gds_tc')}`,
    `✅Grab/TC: ${formatPair(form, 'grab_sales', 'grab_tc')}`,
    `✅Foodpanda/TC: ${formatPair(form, 'foodpanda_sales', 'foodpanda_tc')}`,
    `✅Paymaya/TC: ${formatPair(form, 'paymaya_sales', 'paymaya_tc')}`,
    `✅Gcash/TC: ${formatPair(form, 'gcash_sales', 'gcash_tc')}`,
    '',
    `🔴Discount Monitoring`,
    `✅Senior / PWD: ${formatAmount(getRawValue(form, 'senior_pwd_discount'))}`,
    `✅Promo (LDTS): ${formatAmount(getRawValue(form, 'promo_ldts_discount'))}`,
    `✅Bulk Order: ${formatAmount(getRawValue(form, 'bulk_orders_discount'))}`,
  ];

  return lines.join('\n');
}

/* - Form state - */

function clearReportForm() {
  if (!reportForm) return;
  let fields = reportForm.querySelectorAll('input, select, textarea');
  for (let field of fields) {
    if (!field.name || field.name === 'report_date') continue;
    if (field.type === 'file' || field.type === 'hidden' || field.type === 'submit' || field.type === 'button' || field.type === 'reset') continue;
    field.value = '';
  }
}

function applyInitialFormValues(values) {
  if (!reportForm || !values || typeof values !== 'object') return;
  for (let fieldName of Object.keys(values)) {
    if (!fieldName || fieldName === 'report_date') continue;
    let field = reportForm.querySelector(`[name="${fieldName}"]`);
    if (!field) continue;
    if (field.type === 'file' || field.type === 'hidden' || field.type === 'submit' || field.type === 'button' || field.type === 'reset') continue;

    let rawValue = values[fieldName];
    if (rawValue === null || rawValue === undefined) {
      field.value = '';
      continue;
    }
    field.value = String(rawValue);
  }
  calculateTotals();
}

function lockReportDate(dateValue) {
  if (!reportForm || !reportDateInput || !dateValue) return;
  reportDateInput.value = dateValue;
  reportDateInput.disabled = true;
  reportDateInput.classList.add('bg-slate-100', 'text-slate-500', 'cursor-not-allowed');
  reportDateInput.setAttribute('aria-disabled', 'true');

  let hiddenDateInput = document.getElementById('report_date_hidden');
  if (!hiddenDateInput) {
    hiddenDateInput = document.createElement('input');
    hiddenDateInput.type = 'hidden';
    hiddenDateInput.id = 'report_date_hidden';
    hiddenDateInput.name = 'report_date';
    reportForm.appendChild(hiddenDateInput);
  }
  hiddenDateInput.value = dateValue;
}

function unlockReportDate() {
  if (!reportDateInput) return;
  reportDateInput.disabled = false;
  reportDateInput.classList.remove('bg-slate-100', 'text-slate-500', 'cursor-not-allowed');
  reportDateInput.removeAttribute('aria-disabled');

  let hiddenDateInput = document.getElementById('report_date_hidden');
  if (hiddenDateInput) hiddenDateInput.remove();
}

/* - Missing dates modal - */

function showMissingDatesModal() {
  if (!missingModal) return;
  missingModal.classList.remove('hidden');
  document.body.classList.add('overflow-hidden');
}

function hideMissingDatesModal() {
  if (!missingModal) return;
  missingModal.classList.add('hidden');
  document.body.classList.remove('overflow-hidden');
}

function renderMissingDates() {
  if (!missingList || !missingCount) return;
  let template = document.getElementById('tmpl-missing-row');
  missingList.innerHTML = '';

  for (let missing of missingDates) {
    let row = template.content.firstElementChild.cloneNode(true);
    row.querySelector('[data-cell="label"]').textContent = missing.label;
    row.querySelector('[data-cell="iso"]').textContent = missing.iso;
    missingList.appendChild(row);
  }

  let total = missingDates.length;
  missingCount.textContent = `${total} missing date${total === 1 ? '' : 's'} found for this month.`;
}

/* - Recent reports - */

function renderRecentReports(reports) {
  if (!recentBody || !recentSection) return;
  let template = document.getElementById('tmpl-recent-row');
  recentBody.innerHTML = '';

  if (!Array.isArray(reports) || reports.length === 0) {
    recentSection.classList.add('hidden');
    return;
  }

  for (let report of reports) {
    let row = template.content.firstElementChild.cloneNode(true);
    row.querySelector('[data-cell="date"]').textContent = report.date_label;
    row.querySelector('[data-cell="total-sales"]').textContent = formatPeso(report.total_net_sales);
    row.querySelector('[data-cell="total-tc"]').textContent = report.total_tc;
    row.querySelector('[data-cell="submitted-at"]').textContent = report.submitted_at_label;

    let badges = row.querySelectorAll('[data-status]');
    for (let badge of badges) {
      badge.classList.toggle('hidden', badge.getAttribute('data-status') !== report.status);
    }
    recentBody.appendChild(row);
  }

  recentSection.classList.remove('hidden');
}

/* - Loading - */

function parseJsonResponse(response) {
  return response.json();
}

function loadDailyReport(dateValue, lockFlag) {
  setLoading(true);
  let params = new URLSearchParams();
  if (dateValue) params.set('date', dateValue);
  if (lockFlag) params.set('lock_date', '1');
  let query = params.toString();
  let url = DAILY_REPORT_ROUTES.data + (query ? '?' + query : '');

  fetch(url, { headers: { 'Accept': 'application/json' } })
    .then(parseJsonResponse)
    .then(onDailyReportLoaded)
    .catch(onDailyReportFailed);
}

function onDailyReportLoaded(data) {
  setLoading(false);

  if (!data || data.type !== 'success') {
    notifyError((data && data.message) || 'Unable to load the daily report.');
    if (data && data.type === 'error') setTimeout(redirectHome, 1500);
    return;
  }

  storeName = data.store && data.store.name ? data.store.name : '';
  if (headerStoreName) headerStoreName.textContent = storeName || '--';
  if (pageStoreName) pageStoreName.textContent = storeName || 'your store';

  clearReportForm();
  unlockReportDate();
  if (reportDateInput) reportDateInput.value = data.selected_report_date || '';
  if (data.lock_report_date && reportDateInput && reportDateInput.value) {
    lockReportDate(reportDateInput.value);
  }

  applyInitialFormValues(data.initial_form_values);
  updatePosSoldLink(data.selected_report_date);
  renderRecentReports(data.recent_reports);

  missingDates = Array.isArray(data.missing_dates) ? data.missing_dates : [];
  nextMissingDate = data.next_missing_date || null;
  renderMissingDates();
  if (missingDates.length > 0) {
    showMissingDatesModal();
  } else {
    hideMissingDatesModal();
  }
}

function onDailyReportFailed(error) {
  console.error(error);
  setLoading(false);
  notifyError('Unable to load the daily report.');
}

/* - Navigation - */

function navigateToDate(dateValue, lockFlag) {
  history.pushState({ date: dateValue, lock: lockFlag }, '', buildPageUrl(dateValue, lockFlag));
  loadDailyReport(dateValue, lockFlag);
}

function onReportDateChange() {
  let selectedDate = reportDateInput.value || '';
  if (!selectedDate) return;
  navigateToDate(selectedDate, false);
}

function onMissingGoClick() {
  if (!nextMissingDate) {
    hideMissingDatesModal();
    return;
  }
  hideMissingDatesModal();
  navigateToDate(nextMissingDate, true);
}

function onPopState() {
  let params = new URLSearchParams(window.location.search);
  hideMissingDatesModal();
  loadDailyReport(params.get('date') || '', params.get('lock_date') === '1');
}

/* - Submit - */

function confirmSendReport() {
  allowDailyReportSubmit = true;
  reportForm.submit();
}

function onReportFormSubmit(event) {
  if (allowDailyReportSubmit) return;
  event.preventDefault();

  if (!hasAnyReportValue(reportForm)) {
    notifyError('Please enter at least one report value before submitting.');
    return;
  }

  let savingDate = reportDateInput ? reportDateInput.value : '';
  let summaryText = buildSubmitSummary(reportForm, storeName, savingDate);

  if (typeof showConfirmationModal !== 'function') {
    confirmSendReport();
    return;
  }

  showConfirmationModal({
    title: 'Send Daily Report Data?',
    size: 'large',
    modalWidth: '980px',
    compactHeader: true,
    messageHtml: `
      <div class="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-6 py-4 text-left">
        <p class="text-sm font-bold uppercase tracking-wide text-emerald-700">Saving Date Indicator</p>
        <p class="mt-2 text-[2rem] font-extrabold leading-tight text-slate-900">You're about to send a report date of: ${formatDateLong(savingDate)}</p>
        <p class="mt-2 text-base text-slate-600">This follows the date selected in the calendar.</p>
      </div>
      <p class="text-lg text-slate-700 mb-3">Are you sure you want to send this daily report data? Please review the summary below:</p>
      <pre style="white-space: pre-wrap; margin: 0; padding: 18px; border: 1px solid #e2e8f0; background: #f8fafc; border-radius: 18px; font-size: 15px; line-height: 1.7; color: #1e293b; max-height: 54vh; overflow-y: auto;">${escapeHtml(summaryText)}</pre>
    `,
    confirmText: 'Send Data',
    cancelText: 'Cancel',
    onConfirm: confirmSendReport
  });
}

/* - Event binding - */

function bindWatchedField(fieldId) {
  let field = document.getElementById(fieldId);
  if (!field) return;
  field.addEventListener('input', calculateTotals);
  field.addEventListener('change', calculateTotals);
}

if (reportDateInput) reportDateInput.addEventListener('change', onReportDateChange);
if (reportForm) reportForm.addEventListener('submit', onReportFormSubmit);
if (goMissingBtn) goMissingBtn.addEventListener('click', onMissingGoClick);
fieldsToWatch.forEach(bindWatchedField);
window.addEventListener('popstate', onPopState);

let initialParams = new URLSearchParams(window.location.search);
loadDailyReport(initialParams.get('date') || '', initialParams.get('lock_date') === '1');
