import { useCompareStore } from '../store/compare';

/**
 * Register the service worker (production builds only) so the app works
 * offline after the first visit. A new version installs in the background;
 * the user is offered a reload instead of having the page swapped under them.
 */
export function registerServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('/sw.js')
      .then((registration) => {
        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          worker?.addEventListener('statechange', () => {
            // A first install has no controller: nothing to update yet.
            if (worker.state !== 'installed' || !navigator.serviceWorker.controller) return;
            useCompareStore.getState().notify('info', 'A new version of SQL Compare is ready.', {
              label: 'Reload',
              run: () => {
                navigator.serviceWorker.addEventListener('controllerchange', () =>
                  window.location.reload(),
                );
                worker.postMessage('skip-waiting');
              },
            });
          });
        });
      })
      .catch((err: unknown) => console.warn('[sql-compare] offline support unavailable', err));
  });
}
