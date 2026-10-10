(function () {
  let thumbEl = null;
  let railEl = null;
  let hideTimer = null;
  let isDragging = false;
  let isHovered = false;
  let startY = 0;
  let startScrollTop = 0;

  function getScrollTarget() {
    const fullscreen = document.getElementById('fullscreen-scroll-container');
    if (fullscreen && !fullscreen.closest('.hidden') && !fullscreen.classList.contains('hidden')) {
      return fullscreen;
    }

    return window;
  }

  function getScrollMetrics(target) {
    if (target === window) {
      const docEl = document.documentElement;
      return {
        scrollHeight: docEl.scrollHeight,
        viewHeight: window.innerHeight || docEl.clientHeight,
        scrollTop: window.scrollY || docEl.scrollTop || 0,
        top: 0,
        bottom: window.innerHeight || docEl.clientHeight
      };
    }
    const bounds = target.getBoundingClientRect();
    return {
      scrollHeight: target.scrollHeight,
      viewHeight: target.clientHeight,
      scrollTop: target.scrollTop,
      top: Math.max(0, bounds.top),
      bottom: Math.min(window.innerHeight, bounds.bottom)
    };
  }

  function setScrollTop(target, value) {
    if (target === window) {
      window.scrollTo({ top: value, behavior: 'instant' });
    } else {
      target.scrollTop = value;
    }
  }

  function ensurePageScrollbarThumb() {
    if (thumbEl) return thumbEl;
    const existingThumbs = Array.from(document.querySelectorAll('.page-scrollbar-thumb'));
    const existingRails = Array.from(document.querySelectorAll('.page-scrollbar-rail'));
    thumbEl = existingThumbs[0] || null;
    railEl = existingRails[0] || null;

    existingThumbs.slice(1).forEach(function (element) { element.remove(); });
    existingRails.slice(1).forEach(function (element) { element.remove(); });

    if (!railEl && document.body) {
      railEl = document.createElement('div');
      railEl.id = 'page-scrollbar-rail';
      railEl.className = 'page-scrollbar-rail';
      document.body.appendChild(railEl);
    }
    if (!thumbEl && document.body) {
      thumbEl = document.createElement('div');
      thumbEl.id = 'page-scrollbar-thumb';
      thumbEl.className = 'page-scrollbar-thumb';
    }
    if (railEl && thumbEl) {
      if (thumbEl.parentElement !== railEl) railEl.appendChild(thumbEl);
      if (!thumbEl.dataset.scrollbarBound) {
        thumbEl.dataset.scrollbarBound = 'true';
        attachListeners(thumbEl);
      }
    }
    return thumbEl;
  }

  function updatePageScrollbar() {
    const thumb = ensurePageScrollbarThumb();
    if (!thumb) return;

    const target = getScrollTarget();
    const metrics = getScrollMetrics(target);
    const scrollHeight = metrics.scrollHeight;
    const viewHeight = metrics.viewHeight;

    if (scrollHeight <= viewHeight + 2) {
      thumb.classList.remove('is-visible');
      railEl?.classList.remove('is-visible');
      return;
    }

    const scrollTop = metrics.scrollTop;
    const thumbHeight = Math.max(36, Math.round((viewHeight / scrollHeight) * viewHeight));
    const railInset = 3;
    const railHeight = Math.max(1, viewHeight - (railInset * 2));
    const maxThumbTop = Math.max(0, railHeight - thumbHeight);
    const maxScroll = Math.max(1, scrollHeight - viewHeight);
    const scrollRatio = scrollTop / maxScroll;
    const thumbTop = Math.round(scrollRatio * maxThumbTop);

    railEl.style.top = `${metrics.top + railInset}px`;
    railEl.style.bottom = `${Math.max(3, window.innerHeight - metrics.bottom + railInset)}px`;
    thumb.style.top = `${railInset + thumbTop}px`;
    thumb.style.height = `${thumbHeight}px`;
    thumb.classList.add('is-visible');
    railEl?.classList.add('is-visible');

    if (!isDragging && !isHovered) {
      clearTimeout(hideTimer);
      hideTimer = setTimeout(function () {
        thumb.classList.remove('is-visible');
      }, 1600);
    }
  }

  function attachListeners(thumb) {
    // Hover persistence listeners
    thumb.addEventListener('mouseenter', function () {
      isHovered = true;
      clearTimeout(hideTimer);
      if (!isDragging) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
          thumb.classList.remove('is-visible');
        }, 1600);
      }
      thumb.classList.add('is-hovered');
    });

    thumb.addEventListener('mouseleave', function () {
      isHovered = false;
      thumb.classList.remove('is-hovered');
      if (!isHovered) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
          thumb.classList.remove('is-visible');
        }, 1600);
      }
    });

    // Drag listeners
    function onDragStart(clientY) {
      isDragging = true;
      startY = clientY;
      startScrollTop = getScrollMetrics(getScrollTarget()).scrollTop;
      thumb.classList.add('is-dragging');
      thumb.classList.add('is-visible');
      clearTimeout(hideTimer);
      document.body.style.userSelect = 'none';
    }

    function onDragMove(clientY) {
      if (!isDragging) return;
      const target = getScrollTarget();
      const metrics = getScrollMetrics(target);
      const scrollHeight = metrics.scrollHeight;
      const viewHeight = metrics.viewHeight;
      const maxScroll = Math.max(1, scrollHeight - viewHeight);
      const thumbHeight = Math.max(36, Math.round((viewHeight / scrollHeight) * viewHeight));
      const railInset = 3;
      const railHeight = Math.max(1, viewHeight - (railInset * 2));
      const maxThumbTop = Math.max(1, railHeight - thumbHeight);

      const deltaY = clientY - startY;
      const scrollDelta = (deltaY / maxThumbTop) * maxScroll;
      const targetScroll = Math.min(maxScroll, Math.max(0, startScrollTop + scrollDelta));

      setScrollTop(target, targetScroll);
    }

    function onDragEnd() {
      if (!isDragging) return;
      isDragging = false;
      thumb.classList.remove('is-dragging');
      document.body.style.userSelect = '';
      thumb.classList.add('is-visible');
    }

    thumb.addEventListener('mousedown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      onDragStart(e.clientY);
    });

    thumb.addEventListener('touchstart', function (e) {
      if (e.touches && e.touches.length > 0) {
        onDragStart(e.touches[0].clientY);
      }
    }, { passive: true });

    window.addEventListener('mousemove', function (e) {
      if (isDragging) {
        e.preventDefault();
        onDragMove(e.clientY);
      }
    });

    window.addEventListener('touchmove', function (e) {
      if (isDragging && e.touches && e.touches.length > 0) {
        onDragMove(e.touches[0].clientY);
      }
    }, { passive: true });

    window.addEventListener('mouseup', onDragEnd);
    window.addEventListener('touchend', onDragEnd);
  }

  document.addEventListener('scroll', updatePageScrollbar, { passive: true });
  document.addEventListener('DOMContentLoaded', function () {
    const fullscreen = document.getElementById('fullscreen-scroll-container');
    if (fullscreen) fullscreen.addEventListener('scroll', updatePageScrollbar, { passive: true });
  });
  window.addEventListener('wheel', updatePageScrollbar, { passive: true });
  window.addEventListener('touchmove', updatePageScrollbar, { passive: true });
  window.addEventListener('resize', updatePageScrollbar, { passive: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updatePageScrollbar);
  } else {
    updatePageScrollbar();
  }
})();
