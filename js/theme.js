/* ============================================================
   THEME SYSTEM - HappyFoodHappySilvassa
   Handles light/dark mode persistence and PWA registration.
   Load this BEFORE all other scripts on every page.
   ============================================================ */

(function () {
  const APP_VERSION = '20260313c';
  const STORAGE_KEY = 'hfhs-theme';
  const DARK_ICON = '\u2600\uFE0F';
  const LIGHT_ICON = '\uD83C\uDF19';
  const SW_URL = `/sw.js?v=${APP_VERSION}`;
  const isLocalDev = window.location.hostname === '127.0.0.1' || window.location.hostname === 'localhost';
  let isRefreshing = false;

  const stored = localStorage.getItem(STORAGE_KEY);
  const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = stored || (systemPrefersDark ? 'dark' : 'light');

  document.documentElement.setAttribute('data-theme', theme);

  const updateMetaTheme = (nextTheme) => {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content', nextTheme === 'dark' ? '#0F0D0B' : '#F2A541');
    }
  };
  updateMetaTheme(theme);

  const getThemeIcon = (nextTheme) => (nextTheme === 'dark' ? DARK_ICON : LIGHT_ICON);

  const clearDevelopmentCaches = async () => {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));

    if ('caches' in window) {
      const cacheKeys = await caches.keys();
      await Promise.all(cacheKeys.map((cacheKey) => caches.delete(cacheKey)));
    }
  };

  window.toggleTheme = () => {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem(STORAGE_KEY, next);
    updateMetaTheme(next);

    document.querySelectorAll('.theme-toggle').forEach((btn) => {
      btn.textContent = getThemeIcon(next);
      btn.style.transition = 'transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)';
      btn.style.transform = 'rotate(360deg) scale(1.1)';
      setTimeout(() => {
        btn.style.transform = 'rotate(0deg) scale(1)';
      }, 400);
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    const currentTheme = document.documentElement.getAttribute('data-theme');
    document.querySelectorAll('.theme-toggle').forEach((btn) => {
      btn.textContent = getThemeIcon(currentTheme);
    });
  });

  if ('serviceWorker' in navigator) {
    if (isLocalDev) {
      clearDevelopmentCaches().catch(() => {});
    } else {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (isRefreshing) return;
        isRefreshing = true;
        window.location.reload();
      });

      window.addEventListener('load', async () => {
        try {
          const registration = await navigator.serviceWorker.register(SW_URL, { updateViaCache: 'none' });

          if (registration.waiting) {
            registration.waiting.postMessage({ type: 'SKIP_WAITING' });
          }

          registration.addEventListener('updatefound', () => {
            const installing = registration.installing;
            if (!installing) return;

            installing.addEventListener('statechange', () => {
              if (installing.state === 'installed' && navigator.serviceWorker.controller) {
                installing.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          });

          registration.update().catch(() => {});
        } catch (_) {
          // Ignore registration errors in local/file contexts.
        }
      });
    }
  }

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (event) => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      const nextTheme = event.matches ? 'dark' : 'light';
      document.documentElement.setAttribute('data-theme', nextTheme);
      updateMetaTheme(nextTheme);
      document.querySelectorAll('.theme-toggle').forEach((btn) => {
        btn.textContent = getThemeIcon(nextTheme);
      });
    }
  });
})();
