(function (global) {
  if (global.Base2) return;

  function onReady(fn) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn);
    } else {
      fn();
    }
  }

  function initStoreScope() {
    let buttons = Array.from(document.querySelectorAll('.store-scope-btn'));
    if (!buttons.length) return;

    function updateButtonStyles(activeScope) {
      buttons.forEach((btn) => {
        let isSelected = (btn.getAttribute('data-scope') || 'official').toLowerCase() === activeScope.toLowerCase();
        if (isSelected) {
          btn.classList.add('bg-indigo-500', 'text-white');
          btn.classList.remove('text-slate-300', 'hover:bg-slate-800', 'hover:text-white');
        } else {
          btn.classList.remove('bg-indigo-500', 'text-white');
          btn.classList.add('text-slate-300', 'hover:bg-slate-800', 'hover:text-white');
        }
      });
    }

    buttons.forEach((btn) => {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        let scope = (this.getAttribute('data-scope') || 'official').toLowerCase();
        let maxAge = 60 * 60 * 24 * 365;
        document.cookie = `store_scope=${encodeURIComponent(scope)}; path=/; max-age=${maxAge}; samesite=lax`;

        updateButtonStyles(scope);

        let url = new URL(window.location.href);
        if (url.searchParams.has('store_id')) {
          url.searchParams.delete('store_id');
          window.history.replaceState({}, '', url.toString());
        }

        if (typeof window.reloadDashboard === 'function') {
          window.reloadDashboard(true);
        } else {
          let mainContent = document.getElementById('general_container');
          if (mainContent) {
            mainContent.style.opacity = '0.5';
            fetch(window.location.href)
              .then((res) => res.text())
              .then((html) => {
                let parser = new DOMParser();
                let doc = parser.parseFromString(html, 'text/html');
                let newMain = doc.getElementById('general_container');
                if (newMain) {
                  mainContent.innerHTML = newMain.innerHTML;
                  Array.from(mainContent.querySelectorAll('script')).forEach((oldScript) => {
                    let newScript = document.createElement('script');
                    Array.from(oldScript.attributes).forEach((attr) => newScript.setAttribute(attr.name, attr.value));
                    newScript.appendChild(document.createTextNode(oldScript.innerHTML));
                    oldScript.parentNode.replaceChild(newScript, oldScript);
                  });
                }
              })
              .catch(() => {
                window.location.reload();
              })
              .finally(() => {
                mainContent.style.opacity = '1';
              });
          } else {
            window.location.reload();
          }
        }
      });
    });
  }

  function initInventoryStaffSwitcher() {
    document.getElementById('inventory-staff-store-switcher')?.addEventListener('change', function() {
      let storeId = this.value;
      let scopedPaths = ['/store-manager/invensync-dashboard', '/'];
      if (scopedPaths.includes(window.location.pathname)) {
        window.location.href = `/store-manager/invensync?store_id=${encodeURIComponent(storeId)}`;
        return;
      }
      let target = new URL(window.location.href);
      target.searchParams.set('store_id', storeId);
      window.location.href = target.toString();
    });
  }

  function runStoreManagerGuide() {
    let guideParams = new URLSearchParams(window.location.search);
    if (guideParams.get('guide') !== '1') return;

    let path = window.location.pathname;
    let pageOwnedTours = [
      '/store-manager/daily-report/pos-sold',
      '/store-manager/delivery',
      '/store-manager/transaction-activity-form'
    ];
    if (pageOwnedTours.some(prefix => path.startsWith(prefix))) return;

    if (path.startsWith('/store-manager/invensync') && typeof window.startBeginningStockGuide === 'function') {
      setTimeout(() => window.startBeginningStockGuide(true), 500);
      return;
    }

    let guideStyle = document.createElement('style');
    guideStyle.textContent = `
      .store-help-tour-panel {
        position: fixed;
        z-index: 9998;
        background: rgba(15, 23, 42, 0.72);
        pointer-events: auto;
      }
      .store-help-tour-target {
        position: relative;
        z-index: 9999 !important;
        box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.45), 0 0 24px rgba(14, 165, 233, 0.6) !important;
      }
      .store-help-tour-label {
        position: fixed;
        z-index: 10000;
        max-width: min(380px, calc(100vw - 32px));
        background: #0f172a;
        color: #fff;
        padding: 18px 20px;
        border-radius: 14px;
        border: 1px solid rgba(148, 163, 184, 0.32);
        font-size: 17px;
        font-weight: 700;
        line-height: 1.35;
        text-shadow: 0 2px 10px rgba(0, 0, 0, 0.45);
        box-shadow: 0 22px 60px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(15, 23, 42, 0.95);
        pointer-events: auto;
      }
      .store-help-tour-label button {
        margin-top: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border-radius: 8px;
        background: #fff;
        color: #0f172a;
        padding: 10px 24px;
        font-size: 14px;
        font-weight: 800;
        text-shadow: none;
        box-shadow: 0 10px 22px rgba(0, 0, 0, 0.28);
      }
    `;
    document.head.appendChild(guideStyle);

    function visible(el) {
      return Boolean(el && el.offsetParent !== null);
    }

    function first(selectors) {
      for (let selector of selectors) {
        let found = Array.from(document.querySelectorAll(selector)).find(visible);
        if (found) return found;
      }
      return null;
    }

    function textButton(words) {
      let buttons = Array.from(document.querySelectorAll('button, a'));
      return buttons.find(el => visible(el) && words.some(word => String(el.textContent || '').toLowerCase().includes(word))) || null;
    }

    function rectFor(elements) {
      let visibleElements = elements.filter(visible);
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

    let pageTitles = {
      '/store-manager/daily-report': 'Daily Report',
      '/store-manager/oracle': 'Oracle',
      '/store-manager/store-data': 'Store Data',
      '/store-manager/trans': 'Trans-In',
      '/store-manager/trans-out': 'Trans-Out',
      '/store-manager/wastage': 'Wastage'
    };
    let pageTitle = Object.entries(pageTitles).find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`))?.[1] || 'This tool';
    let isTransferListGuide = path === '/store-manager/trans' || path === '/store-manager/trans-out';
    let transferActionTarget = first(['.transfer-action-guide-target']);

    let steps = [
      {
        elements: [first(['header nav', 'header'])],
        text: `Welcome to the ${pageTitle} walkthrough. This guide will point out the main areas of this tool.`,
        placement: 'bottom',
        nextText: 'Next'
      },
      {
        elements: [first(['input[type="date"]', 'select[name="month"]', 'select[name="year"]', 'form'])],
        text: 'Start here by choosing the correct date, month, year, or filter before reviewing data.',
        placement: 'bottom',
        nextText: 'Next'
      },
      {
        elements: [first(['table', 'form', 'section article', 'section', '.rounded-2xl', '.rounded-xl'])],
        text: 'This is the main work area. Review the rows, fields, cards, or records shown here.',
        placement: 'right',
        nextText: 'Next'
      },
      ...(isTransferListGuide && transferActionTarget ? [{
        elements: [transferActionTarget],
        text: path === '/store-manager/trans'
          ? 'Use the Action eye button to open an incoming transfer. From there, review the items and confirm or save the received quantities.'
          : 'Use the Action eye button to open an outgoing transfer. From there, view the full transfer details, destination, items, quantities, status, and remarks.',
        placement: 'left',
        nextText: 'Finish'
      }] : []),
      {
        elements: [textButton(['submit', 'save', 'export', 'view', 'open'])],
        text: 'Use the action button when you are ready to submit, save, export, or open the selected data.',
        placement: 'left',
        nextText: 'Finish'
      }
    ].filter(step => step.elements.some(Boolean));

    let stepIndex = 0;
    let tourActive = false;
    let renderTimer = null;

    function removeTour() {
      document.querySelectorAll('.store-help-tour-panel, .store-help-tour-label').forEach(el => el.remove());
      document.querySelectorAll('.store-help-tour-target').forEach(el => el.classList.remove('store-help-tour-target'));
    }

    function clearTour() {
      tourActive = false;
      removeTour();
      document.body.classList.remove('overflow-hidden');
      let url = new URL(window.location.href);
      url.searchParams.delete('guide');
      window.history.replaceState({}, document.title, url.toString());
    }

    function renderStep(options = {}) {
      if (!tourActive) return;
      let shouldScrollTarget = options.scrollTarget !== false;
      if (renderTimer) {
        clearTimeout(renderTimer);
        renderTimer = null;
      }
      removeTour();
      let step = steps[stepIndex];
      if (!step) {
        clearTour();
        return;
      }
      let target = step.elements.find(visible) || step.elements.find(Boolean);
      if (target && shouldScrollTarget) {
        target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
      }
      renderTimer = setTimeout(() => {
        renderTimer = null;
        let rect = rectFor(step.elements);
        if (!rect) {
          stepIndex += 1;
          renderStep();
          return;
        }
        step.elements.forEach(el => {
          if (el) el.classList.add('store-help-tour-target');
        });
        [
          { top: 0, left: 0, width: window.innerWidth, height: rect.top },
          { top: rect.bottom, left: 0, width: window.innerWidth, height: window.innerHeight - rect.bottom },
          { top: rect.top, left: 0, width: rect.left, height: rect.bottom - rect.top },
          { top: rect.top, left: rect.right, width: window.innerWidth - rect.right, height: rect.bottom - rect.top }
        ].forEach(panel => {
          let el = document.createElement('div');
          el.className = 'store-help-tour-panel';
          el.style.top = `${panel.top}px`;
          el.style.left = `${panel.left}px`;
          el.style.width = `${Math.max(0, panel.width)}px`;
          el.style.height = `${Math.max(0, panel.height)}px`;
          document.body.appendChild(el);
        });

        let label = document.createElement('div');
        label.className = 'store-help-tour-label';
        let message = document.createElement('div');
        message.textContent = step.text;
        let button = document.createElement('button');
        button.type = 'button';
        button.textContent = step.nextText;
        button.addEventListener('click', function() {
          stepIndex += 1;
          renderStep();
        });
        label.appendChild(message);
        label.appendChild(button);

        if (step.placement === 'left') {
          label.style.left = `${Math.max(16, rect.left - 400)}px`;
          label.style.top = `${Math.max(24, rect.top)}px`;
        } else if (step.placement === 'right') {
          let labelLeft = rect.right + 24;
          let hasRightSpace = labelLeft + 340 <= window.innerWidth;
          label.style.left = `${hasRightSpace ? labelLeft : Math.max(16, rect.left - 360)}px`;
          label.style.top = `${Math.max(24, rect.top)}px`;
        } else {
          label.style.left = `${Math.max(16, Math.min(rect.left, window.innerWidth - 396))}px`;
          label.style.top = `${Math.min(window.innerHeight - 120, rect.bottom + 18)}px`;
        }
        document.body.appendChild(label);
      }, 350);
    }

    if (steps.length) {
      tourActive = true;
      document.body.classList.add('overflow-hidden');
      setTimeout(renderStep, 400);
      window.addEventListener('resize', () => renderStep({ scrollTarget: false }));
    }
  }

  function initStoreManagerGuide() {
    onReady(runStoreManagerGuide);
  }

  function initPresence(pingUrl) {
    if (!pingUrl) return;
    let lastBrowsePresenceSentAt = 0;
    let lastTypingPresenceSentAt = 0;
    let lastPresenceType = '';
    let pingPresence = (activityType) => {
      let now = Date.now();
      if (activityType === 'typing' || activityType === 'uploading') {
        if ((lastPresenceType === 'typing' || lastPresenceType === 'uploading') && now - lastTypingPresenceSentAt < 10000) return;
        lastTypingPresenceSentAt = now;
      } else {
        if (lastPresenceType === 'browsing' && now - lastBrowsePresenceSentAt < 30000) return;
        lastBrowsePresenceSentAt = now;
      }
      lastPresenceType = activityType;
      fetch(pingUrl, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        },
        body: JSON.stringify({ activity_type: activityType }),
        keepalive: true
      }).catch(() => {});
    };
    document.addEventListener('keydown', event => {
      let target = event.target;
      if (target && (target.matches('input, textarea, select') || target.isContentEditable)) {
        pingPresence('typing');
      }
    });
    document.addEventListener('input', () => pingPresence('typing'), { passive: true });
    document.addEventListener('change', event => {
      let target = event.target;
      if (target && target.matches('input[type="file"]') && target.files && target.files.length) {
        pingPresence('uploading');
      }
    });
    document.addEventListener('submit', event => {
      let form = event.target;
      if (!form) return;
      let hasSelectedFile = Array.from(form.querySelectorAll('input[type="file"]'))
        .some(input => input.files && input.files.length);
      if (hasSelectedFile) pingPresence('uploading');
    });
    ['pointerdown', 'touchstart', 'scroll'].forEach(eventName => {
      document.addEventListener(eventName, () => pingPresence('browsing'), { passive: true });
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) pingPresence('browsing');
    });
  }

  global.Base2 = {
    initStoreScope: initStoreScope,
    initInventoryStaffSwitcher: initInventoryStaffSwitcher,
    initStoreManagerGuide: initStoreManagerGuide,
    initPresence: initPresence
  };

  onReady(initStoreScope);
})(window);
