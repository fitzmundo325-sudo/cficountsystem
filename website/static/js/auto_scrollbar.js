(function () {
  const ACTIVE_CLASS = 'scrollbar-active';
  const HIDE_DELAY_MS = 1600;
  const timers = new WeakMap();

  function getScrollElement(target) {
    if (!target || target === document || target === window) {
      return document.documentElement;
    }
    if (target === document.body || target === document.documentElement) {
      return document.documentElement;
    }
    return target;
  }

  function activateScrollbar(target) {
    const element = getScrollElement(target);
    if (!element || !element.classList) return;

    element.classList.add(ACTIVE_CLASS);
    if (element === document.documentElement) {
      document.body.classList.add(ACTIVE_CLASS);
    }

    const existingTimer = timers.get(element);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(function () {
      element.classList.remove(ACTIVE_CLASS);
      if (element === document.documentElement) {
        document.body.classList.remove(ACTIVE_CLASS);
      }
      timers.delete(element);
    }, HIDE_DELAY_MS);

    timers.set(element, timer);
  }

  document.addEventListener('scroll', function (event) {
    activateScrollbar(event.target);
  }, true);

  window.addEventListener('wheel', function () {
    activateScrollbar(document.documentElement);
  }, { passive: true });

  window.addEventListener('touchmove', function () {
    activateScrollbar(document.documentElement);
  }, { passive: true });
})();
