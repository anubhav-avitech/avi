(() => {
  const storageKey = 'avitec-inventory-theme';

  try {
    if (localStorage.getItem(storageKey) === 'night') {
      document.documentElement.dataset.theme = 'night';
    }
  } catch (error) {
    console.warn('Unable to read the saved theme preference.', error);
  }

  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.querySelector('.theme-toggle');
    if (!toggle) return;

    const syncToggle = () => {
      const isNight = document.documentElement.dataset.theme === 'night';
      toggle.setAttribute('aria-checked', String(isNight));
      toggle.title = isNight ? 'Switch to day theme' : 'Switch to night theme';
    };

    syncToggle();
    toggle.addEventListener('click', () => {
      const isNight = document.documentElement.dataset.theme !== 'night';
      document.documentElement.dataset.theme = isNight ? 'night' : 'day';
      syncToggle();

      try {
        localStorage.setItem(storageKey, isNight ? 'night' : 'day');
      } catch (error) {
        console.warn('Unable to save the theme preference.', error);
      }
    });
  });
})();
