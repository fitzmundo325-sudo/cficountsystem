(function () {
  'use strict';

  var overlay = null;
  var showTimer = null;

  function getOverlay() {
    if (!overlay) {
      overlay = document.getElementById('spa-loading-overlay');
    }
    return overlay;
  }

  // Show loading spinner after a short delay (to avoid flicker on fast loads)
  function showLoading() {
    var el = getOverlay();
    if (!el) return;
    el.classList.add('spa-visible');
  }

  // Hide loading spinner
  function hideLoading() {
    clearTimeout(showTimer);
    showTimer = null;
    var el = getOverlay();
    if (!el) return;
    el.classList.remove('spa-visible');
  }

  window.hideSpaLoading = hideLoading;
  window.showSpaLoading = function () {
    clearTimeout(showTimer);
    showLoading();
  };

  // Hide on page load/show (handles back/forward and first load)
  window.addEventListener('pageshow', hideLoading);
  window.addEventListener('load', hideLoading);

  // Show spinner on any internal link click
  document.addEventListener('click', function (e) {
    var anchor = e.target.closest('a[href]');
    if (!anchor) return;

    var href = anchor.getAttribute('href');
    // Skip: empty, hash-only, external, javascript:, target=_blank, download, data-no-spinner
    if (!href || href === '#' || href.startsWith('#') || href.startsWith('javascript:')) return;
    if (anchor.target === '_blank') return;
    if (anchor.hasAttribute('download')) return;
    if (anchor.hasAttribute('data-no-spinner')) return;

    try {
      var url = new URL(href, window.location.origin);
      // Only show spinner for same-origin navigation
      if (url.origin !== window.location.origin) return;
    } catch (err) {
      return;
    }

    // Show spinner after 300ms delay (CSS transition-delay handles the visual)
    clearTimeout(showTimer);
    showTimer = setTimeout(showLoading, 0);
  });

  // Also show on form submit (standard POST forms that navigate)
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    if (e.defaultPrevented) return;
    // Only trigger for forms that navigate (not fetch/XHR forms)
    if (form.getAttribute('data-no-spinner')) return;
    clearTimeout(showTimer);
    showTimer = setTimeout(showLoading, 0);
  });

  // Fallback observer: automatically hide SPA loading overlay whenever any modal dialog is shown
  if (typeof MutationObserver !== 'undefined') {
    var checkModalVisibility = function (node) {
      if (!node || node.nodeType !== 1) return;
      var id = (node.id || '').toLowerCase();
      var className = (typeof node.className === 'string' ? node.className : '').toLowerCase();
      if (id.indexOf('modal') !== -1 || className.indexOf('modal') !== -1 || node.hasAttribute('data-modal-content')) {
        if (!node.classList.contains('hidden') && node.style.display !== 'none') {
          hideLoading();
        }
      }
    };

    var observer = new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i++) {
        var m = mutations[i];
        if (m.type === 'attributes') {
          checkModalVisibility(m.target);
        } else if (m.type === 'childList') {
          for (var j = 0; j < m.addedNodes.length; j++) {
            checkModalVisibility(m.addedNodes[j]);
          }
        }
      }
    });

    var startObserving = function () {
      if (document.body) {
        observer.observe(document.body, {
          attributes: true,
          attributeFilter: ['class', 'style', 'hidden'],
          subtree: true,
          childList: true
        });
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObserving);
    } else {
      startObserving();
    }
  }

})();
