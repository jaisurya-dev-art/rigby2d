// SPDX-License-Identifier: MIT OR Apache-2.0
// Detaching panels into their own OS windows, and keeping them in sync with the editor. The editor
// window is the single authority (document, undo, selection); each detached window mirrors the
// shared state and forwards its shortcuts back here (see app.snapshotState / applyStateSnapshot,
// panel.js and dock.js). Split out of main.js, which was growing.

import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emit, listen } from '@tauri-apps/api/event';
import { EV_SYNC, EV_CONTROL, EV_CLOSED, PANELS, panelLabel } from './dock.js';
import { saveSetting } from './app.js';
import { keySelectionIndices, applyKeySelection } from './keyorder.js';

/** A change signature over the shared state, so an unchanged frame sends nothing. Derived from the
 *  snapshot so new fields are covered automatically; docJson is excluded (huge, tracked separately). */
function stateSignature(s, keys) {
  return JSON.stringify({ ...s, docJson: undefined, keys });
}

const geomKey = (id) => `rigby.panel.${id}.geom`;

/**
 * Wires up panel detaching and sync for the editor window. `appEl` is the editor's #app element
 * (toggles a `detached-<id>` class per panel). `runForwardedAction(action)` runs a shortcut a
 * detached window forwarded, on the authoritative editor App. Returns the API main.js uses.
 */
export function installPanelSync(app, { inTauri, appEl, runForwardedAction }) {
  // Open detached panel windows, by id (see dock.js PANELS). A change here broadcasts to every
  // open window, and each window forwards its shortcuts back.
  const detachedWindows = new Map();
  const geomUnlisten = new Map();
  let panelsReady = false;
  let lastSync = '';
  let lastSentDoc = null;

  const anyDetached = () => detachedWindows.size > 0;

  // Where the user last left a panel window (logical px). Null when never detached or unreadable.
  function loadGeom(id) {
    try {
      const g = JSON.parse(globalThis.localStorage?.getItem(geomKey(id)) ?? 'null');
      return g && [g.x, g.y, g.w, g.h].every(Number.isFinite) ? g : null;
    } catch {
      return null;
    }
  }

  // Persist a panel window's position and size as the user moves/resizes it, so it reopens the same.
  async function trackGeom(id, win) {
    const save = async () => {
      try {
        const sf = await win.scaleFactor();
        const p = await win.outerPosition();
        const s = await win.innerSize();
        saveSetting(geomKey(id), JSON.stringify({ x: Math.round(p.x / sf), y: Math.round(p.y / sf), w: Math.round(s.width / sf), h: Math.round(s.height / sf) }));
      } catch {
        // Geometry is a convenience; ignore if the window info isn't available.
      }
    };
    const stops = await Promise.all([win.onMoved(save), win.onResized(save)]);
    geomUnlisten.set(id, () => { for (const stop of stops) stop(); });
  }

  function detachPanel(id) {
    if (!inTauri || !PANELS[id] || detachedWindows.has(id)) return;
    const { label, width, height } = PANELS[id];
    detachedWindows.set(id, null);
    panelsReady = false;
    lastSync = '';
    lastSentDoc = null;
    appEl.classList.add(`detached-${id}`);
    const opts = { url: `panel.html?panel=${id}`, title: `Rigby2D - ${label}`, width, height, minWidth: 320, minHeight: 200 };
    // Reopen where the user last left this panel (possibly on another monitor). With nothing saved,
    // the OS places it on the editor's own monitor; drag it anywhere once and it sticks from then on.
    const saved = loadGeom(id);
    if (saved) Object.assign(opts, { width: saved.w, height: saved.h, x: saved.x, y: saved.y });
    const win = new WebviewWindow(panelLabel(id), opts);
    detachedWindows.set(id, win);
    trackGeom(id, win);
    win.once('tauri://error', (e) => {
      app.setStatus(`Could not open the ${label} window: ${e.payload}`);
      dockPanel(id);
    });
    app.setStatus(`${label} popped out to its own window. Close it to dock it back.`);
  }

  function dockPanel(id) {
    if (!detachedWindows.has(id)) return;
    const win = detachedWindows.get(id);
    detachedWindows.delete(id);
    const stop = geomUnlisten.get(id);
    if (stop) { stop(); geomUnlisten.delete(id); }
    appEl.classList.remove(`detached-${id}`);
    if (win) win.destroy().catch(() => {});
    app.changed();
  }

  /** Broadcasts the shared editor state to every detached window (per frame; cheap when unchanged). */
  function syncPanels() {
    if (!anyDetached() || !panelsReady) return;
    const s = app.snapshotState();
    const keys = keySelectionIndices(app);
    const sig = stateSignature(s, keys);
    const docChanged = s.docJson !== lastSentDoc;
    if (sig === lastSync && !docChanged) return;
    lastSync = sig;
    // Payload is the snapshot itself plus the key selection; the document rides only when it changed.
    const payload = { ...s, keys };
    if (docChanged) lastSentDoc = s.docJson;
    else delete payload.docJson;
    emit(EV_SYNC, payload);
  }

  // Adopts the state a detached window sent (document edits as one undo step), without echoing it.
  function applyFromPanel(p) {
    app.applyStateSnapshot(p, { undo: true });
    applyKeySelection(app, p.keys);
    const s = app.snapshotState();
    lastSync = stateSignature(s, keySelectionIndices(app));
    if (p.docJson) lastSentDoc = s.docJson;
  }

  if (inTauri) {
    listen(EV_CONTROL, (e) => {
      if (!anyDetached()) return;
      const p = e.payload ?? {};
      if (p.ready) {
        // A window is up and asks for the first full state (broadcast reaches every window).
        panelsReady = true;
        lastSync = '';
        lastSentDoc = null;
        return;
      }
      if (p.action) return void runForwardedAction(p.action);
      applyFromPanel(p);
    });
    listen(EV_CLOSED, (e) => dockPanel(e.payload?.panel));
    // Closing the editor closes the whole program: tear down any detached panel windows too.
    getCurrentWindow().onCloseRequested(() => {
      for (const [, win] of detachedWindows) win?.destroy().catch(() => {});
    });
  }

  return { syncPanels, detachPanel, dockPanel };
}
