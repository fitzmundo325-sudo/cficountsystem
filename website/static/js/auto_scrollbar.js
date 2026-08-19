(function () {
  let thumbEl = null;
  let hideTimer = null;
  let isDragging = false;
  let isHovered = false;
  let startY = 0;
  let startScrollTop = 0;

  function ensurePageScrollbarThumb() {
    if (thumbEl) return thumbEl;
    thumbEl = document.getElementById('page-scrollbar-thumb');
    if (!thumbEl && document.body) {
      thumbEl = document.createElement('div');
      thumbEl.id = 'page-scrollbar-thumb';
      thumbEl.className = 'page-scrollbar-thumb';
      document.body.appendChild(thumbEl);
      attachListeners(thumbEl);
    }
    return thumbEl;
  }

  function updatePageScrollbar() {
    const thumb = ensurePageScrollbarThumb();
    if (!thumb) return;

    const docEl = document.documentElement;
    const scrollHeight = docEl.scrollHeight;
    const viewHeight = window.innerHeight || docEl.clientHeight;

    if (scrollHeight <= viewHeight + 2) {
      thumb.classList.remove('is-visible');
      return;
    }

    const scrollTop = window.scrollY || docEl.scrollTop || 0;
    const thumbHeight = Math.max(36, Math.round((viewHeight / scrollHeight) * viewHeight));
    const maxThumbTop = Math.max(0, viewHeight - thumbHeight);
    const maxScroll = Math.max(1, scrollHeight - viewHeight);
    const scrollRatio = scrollTop / maxScroll;
    const thumbTop = Math.round(scrollRatio * maxThumbTop);

    thumb.style.top = `${thumbTop}px`;
    thumb.style.height = `${thumbHeight}px`;
    thumb.classList.add('is-visible');

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
      thumb.classList.add('is-visible');
      thumb.classList.add('is-hovered');
    });

    thumb.addEventListener('mouseleave', function () {
      isHovered = false;
      thumb.classList.remove('is-hovered');
      if (!isDragging) {
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
      startScrollTop = window.scrollY || document.documentElement.scrollTop || 0;
      thumb.classList.add('is-dragging');
      thumb.classList.add('is-visible');
      clearTimeout(hideTimer);
      document.body.style.userSelect = 'none';
    }

    function onDragMove(clientY) {
      if (!isDragging) return;
      const docEl = document.documentElement;
      const scrollHeight = docEl.scrollHeight;
      const viewHeight = window.innerHeight || docEl.clientHeight;
      const maxScroll = Math.max(1, scrollHeight - viewHeight);
      const thumbHeight = Math.max(36, Math.round((viewHeight / scrollHeight) * viewHeight));
      const maxThumbTop = Math.max(1, viewHeight - thumbHeight);

      const deltaY = clientY - startY;
      const scrollDelta = (deltaY / maxThumbTop) * maxScroll;
      const targetScroll = Math.min(maxScroll, Math.max(0, startScrollTop + scrollDelta));

      window.scrollTo({ top: targetScroll, behavior: 'instant' });
    }

    function onDragEnd() {
      if (!isDragging) return;
      isDragging = false;
      thumb.classList.remove('is-dragging');
      document.body.style.userSelect = '';
      if (!isHovered) {
        clearTimeout(hideTimer);
        hideTimer = setTimeout(function () {
          thumb.classList.remove('is-visible');
        }, 1600);
      }
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
  window.addEventListener('wheel', updatePageScrollbar, { passive: true });
  window.addEventListener('touchmove', updatePageScrollbar, { passive: true });
  window.addEventListener('resize', updatePageScrollbar, { passive: true });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', updatePageScrollbar);
  } else {
    updatePageScrollbar();
  }
})();
