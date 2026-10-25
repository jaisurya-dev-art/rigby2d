// SPDX-License-Identifier: MIT OR Apache-2.0
// Anonymous usage counts for the website and the browser editor, with GoatCounter
// (https://www.goatcounter.com): page views, plus a few named editor events such as "export-json".
// No cookies, no personal data and nothing from the project itself, only the event name. It runs
// only on the public website: never in the desktop app, in local development or in tests.

/** The GoatCounter site code (the dashboard is https://<code>.goatcounter.com). Empty: off. */
export const GOATCOUNTER_CODE = 'rigby2d';

/** Hosts that count. Anything else (localhost, the desktop app, forks' Pages sites) does not. */
const HOSTS = ['jaisurya-dev-art.github.io'];

let started = false;
const queued = [];

/** Whether counting is on in this page. */
export function analyticsEnabled() {
  return (
    !!GOATCOUNTER_CODE &&
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    !('__TAURI_INTERNALS__' in window) &&
    HOSTS.includes(window.location.hostname)
  );
}

/** Loads the counter, which counts this page view. Elements with data-goatcounter-click count their clicks. */
export function startAnalytics() {
  if (started || !analyticsEnabled()) return;
  started = true;
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://gc.zgo.at/count.js';
  script.dataset.goatcounter = `https://${GOATCOUNTER_CODE}.goatcounter.com/count`;
  script.addEventListener('load', () => {
    for (const name of queued.splice(0)) send(name);
  });
  document.head.append(script);
}

function send(name) {
  window.goatcounter?.count?.({ path: name, title: name, event: true });
}

/** Counts a named event (e.g. "editor-export-json"). A no-op when counting is off. */
export function track(name) {
  if (!started) return;
  if (window.goatcounter?.count) send(name);
  else queued.push(name);
}
