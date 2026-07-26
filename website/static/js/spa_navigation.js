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
    var el = getOverlay();
    if (!el) return;
    el.classList.remove('spa-visible');
  }

  // Hide on page load/show (handles back/forward and first load)
  window.addEventListener('pageshow', hideLoading);
  window.addEventListener('load', hideLoading);

  // Show spinner on any internal link click
  document.addEventListener('click', function (e) {
    var anchor = e.target.closest('a[href]');
    if (!anchor) return;

    var href = anchor.getAttribute('href');
    // Skip: empty, hash-only, external, javascript:, target=_blank, download
    if (!href || href === '#' || href.startsWith('#') || href.startsWith('javascript:')) return;
    if (anchor.target === '_blank') return;
    if (anchor.hasAttribute('download')) return;

    try {
      var url = new URL(href, window.location.origin);
      // Only show spinner for same-origin navigation
      if (url.origin !== window.location.origin) return;
    } catch (err) {
      return;
    }

    // Show spinner after 300ms delay (CSS transition-delay handles the visual)
    showTimer = setTimeout(showLoading, 0);
  });

  // Also show on form submit (standard POST forms that navigate)
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.tagName !== 'FORM') return;
    // Only trigger for forms that navigate (not fetch/XHR forms)
    if (form.getAttribute('data-no-spinner')) return;
    showTimer = setTimeout(showLoading, 0);
  });

})();
