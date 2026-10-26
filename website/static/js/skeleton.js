let pageSkeletonEl = null;

function buildPageSkeleton() {
  let cards = '';
  for (let i = 0; i < 7; i++) {
    cards += '<div class="sk-card"><div class="sk-block"></div><div class="sk-block"></div><div class="sk-block"></div><div class="sk-block"></div></div>';
  }

  let rows = '';
  for (let i = 0; i < 6; i++) {
    rows += '<div class="sk-block"></div>';
  }

  let el = document.createElement('div');
  el.className = 'page-skeleton';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-busy', 'true');
  el.setAttribute('aria-label', 'Loading');
  el.innerHTML = `
    <div class="page-skeleton__bar"></div>
    <div class="page-skeleton__inner">
      <div class="sk-row" style="justify-content: space-between;">
        <div style="display:flex; flex-direction:column; gap:8px;">
          <div class="sk-block sk-title"></div>
          <div class="sk-block sk-sub"></div>
        </div>
        <div class="sk-block sk-pill"></div>
      </div>
      <div class="sk-row">
        <div class="sk-block sk-search"></div>
        <div class="sk-block sk-pill"></div>
        <div class="sk-block sk-pill"></div>
        <div class="sk-block sk-pill"></div>
      </div>
      <div class="sk-grid">${cards}</div>
      <div class="sk-table">${rows}</div>
    </div>`;
  document.body.appendChild(el);
  return el;
}

function showPageSkeleton() {
  if (!pageSkeletonEl) pageSkeletonEl = buildPageSkeleton();
  pageSkeletonEl.classList.add('is-visible');
}

function hidePageSkeleton() {
  if (!pageSkeletonEl) return;
  pageSkeletonEl.classList.remove('is-visible');
}