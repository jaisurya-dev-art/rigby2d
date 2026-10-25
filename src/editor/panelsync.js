// SPDX-License-Identifier: MIT OR Apache-2.0
// Detaching panels into their own OS windows, and keeping them in sync with the editor. The editor
// window is the single authority (document, undo, selection); each detached window mirrors the
// shared state and forwards its shortcuts back here (see app.snapshotState / applyStateSnapshot,
// panel.js and dock.js). Split out of main.js, which was growing. It also drives saved window
// layouts (layouts.js): capturing where the panels are and arranging them back.

import { getCurrentWindow } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { emit, listen } from '@tauri-apps/api/event';
import { EV_SYNC, EV_CONTROL, EV_CLOSED, EV_PLACE, PANELS, panelLabel } from './dock.js';
import { saveSetting } from './app.js';
import { keySelectionIndices, applyKeySelection } from './keyorder.js';
import { byHotkey, layoutHotkeyDigit, loadLayouts } from './layouts.js';

// The shortcut matcher lives in layouts.js (no Tauri imports, so it is unit-tested in Node).
export { layoutHotkeyDigit };

/** A change signature over the shared state, so an unchanged frame sends nothing. Derived from the
 *  snapshot so new fields are covered automatically; docJson is excluded (huge, tracked separately). */
function stateSignature(s, keys) {
  return JSON.stringify({ ...s, docJson: undefined, keys });
}

const geomKey = (id) => `rigby.panel.${id}.geom`;

/**
 * Wires up panel detaching and sync for the editor window. `appEl` is the editor's #app element
 * (toggles a `detached-<id>` class per panel). `runForwardedAction(action)` runs a shortcut a
 * detached window forwarded, on the authoritative editor App. Returns the API main.js and the
 * window-layouts UI use.
 */
export function installPanelSync(app, { inTauri, appEl, runForwardedAction }) {
  // Open detached panel windows, by id (see dock.js PANELS). A change here broadcasts to every
  // open window, and each window forwards its shortcuts back.
  const detachedWindows = new Map();
  const geomUnlisten = new Map();
  let panelsReady = false;
  let lastSync = '';
  let lastSentDoc = null;

  // The saved layout currently in effect, and whether the windows have been moved/opened/closed since
  // it was loaded or saved (so the UI can flag "unsaved window changes"). applyLayout sets these.
  let activeLayoutId = null;
  let layoutDirty = false;
  let applyingLayout = false;
  // Opening/moving windows for a layout makes the OS fire move/resize events; ignore those as "edits"
  // until they settle, so loading a layout does not immediately flag itself as changed.
  let settleUntil = 0;
  const activeLayout = () => ({ id: activeLayoutId, dirty: layoutDirty });
  const setActiveLayout = (id) => {
    activeLayoutId = id;
    layoutDirty = false;
  };
  // A manual detach/dock/move diverges from the active layout (ignored while we apply one, and during
  // the brief settle after, when the move/resize events are the windows arriving at their target).
  const markLayoutDirty = () => {
    if (activeLayoutId && !applyingLayout && Date.now() >= settleUntil) layoutDirty = true;
  };

  const anyDetached = () => detachedWindows.size > 0;
  const detachedIds = () => [...detachedWindows.keys()];

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
      const g = await geomOf(win);
      if (g) saveSetting(geomKey(id), JSON.stringify(g));
      markLayoutDirty();
    };
    const stops = await Promise.all([win.onMoved(save), win.onResized(save)]);
    geomUnlisten.set(id, () => { for (const stop of stops) stop(); });
  }

  // A window's current position and size in logical px, or null if it can't be read.
  async function geomOf(win) {
    try {
      const sf = await win.scaleFactor();
      const p = await win.outerPosition();
      const s = await win.innerSize();
      return { x: Math.round(p.x / sf), y: Math.round(p.y / sf), w: Math.round(s.width / sf), h: Math.round(s.height / sf) };
    } catch {
      // Geometry is a convenience; ignore if the window info isn't available.
      return null;
    }
  }

  // Open a panel in its own OS window. `geom` (from a saved layout) overrides the remembered spot;
  // with neither, the OS places it on the editor's own monitor.
  function detachPanel(id, geom = null) {
    if (!inTauri || !PANELS[id] || detachedWindows.has(id)) return;
    const { label, width, height } = PANELS[id];
    detachedWindows.set(id, null);
    panelsReady = false;
    lastSync = '';
    lastSentDoc = null;
    appEl.classList.add(`detached-${id}`);
    const opts = { url: `panel.html?panel=${id}`, title: `Rigby2D - ${label}`, width, height, minWidth: 320, minHeight: 200 };
    const saved = geom ?? loadGeom(id);
    if (saved) Object.assign(opts, { width: saved.w, height: saved.h, x: saved.x, y: saved.y });
    const win = new WebviewWindow(panelLabel(id), opts);
    detachedWindows.set(id, win);
    trackGeom(id, win);
    win.once('tauri://error', (e) => {
      app.setStatus(`Could not open the ${label} window: ${e.payload}`);
      dockPanel(id);
    });
    markLayoutDirty();
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
    markLayoutDirty();
    app.changed();
  }

  /** The current arrangement: { panelId: { x, y, w, h } } for every panel that is popped out. */
  async function captureLayout() {
    const panels = {};
    for (const id of detachedWindows.keys()) {
      const g = await geomOf(detachedWindows.get(id));
      if (g) panels[id] = g;
    }
    return panels;
  }

  /** Arranges the windows to match a saved layout: docks the panels it leaves out, opens the ones it
   *  wants (at their saved spot), and moves any that are already open. `id` records which layout is
   *  now in effect, so the UI can show it as current (and flag later changes as unsaved). */
  function applyLayout(panels, id = null) {
    if (!inTauri) return;
    applyingLayout = true;
    const want = panels ?? {};
    for (const pid of [...detachedWindows.keys()]) if (!want[pid]) dockPanel(pid);
    for (const [pid, geom] of Object.entries(want)) {
      if (!PANELS[pid]) continue;
      // Already open: ask the panel to move itself (keeps the editor's permissions to create/destroy
      // only; the panel-* windows carry set-position/set-size). Otherwise open it at the saved spot.
      if (detachedWindows.has(pid)) emit(EV_PLACE, { panel: pid, ...geom });
      else detachPanel(pid, geom);
    }
    applyingLayout = false;
    settleUntil = Date.now() + 1000; // let the windows arrive before move/resize counts as an edit
    setActiveLayout(id);
  }

  /** Loads the layout bound to a Ctrl+Alt+<digit> shortcut, if any. */
  function triggerHotkey(digit) {
    const layout = byHotkey(loadLayouts(), digit);
    if (!layout) return false;
    applyLayout(layout.panels, layout.id);
    app.setStatus(`Window layout: ${layout.name}`);
    return true;
  }

  /** Sends the shared editor state to every detached window. `force` sends the full state now (on a
   *  window's first request); otherwise it is a no-op when nothing changed (cheap, called per frame). */
  function broadcastState(force) {
    const s = app.snapshotState();
    const keys = keySelectionIndices(app);
    const sig = stateSignature(s, keys);
    const docChanged = force || s.docJson !== lastSentDoc;
    if (!force && sig === lastSync && !docChanged) return;
    lastSync = sig;
    // Payload is the snapshot itself plus the key selection; the document rides only when it changed.
    const payload = { ...s, keys };
    if (docChanged) lastSentDoc = s.docJson;
    else delete payload.docJson;
    emit(EV_SYNC, payload);
  }

  function syncPanels() {
    if (!anyDetached() || !panelsReady) return;
    broadcastState(false);
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
      const p = e.payload ?? {};
      // A layout shortcut forwarded from a focused panel window works even with nothing detached-ready.
      if (p.layoutHotkey !== undefined) return void triggerHotkey(p.layoutHotkey);
      if (!anyDetached()) return;
      if (p.ready) {
        // A window is up and asks for the first full state. Send it now (not on the next frame) so a
        // panel just opened by a layout never shows a blank/empty document while it waits.
        panelsReady = true;
        broadcastState(true);
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
    // Ctrl+Alt+<digit> loads the layout bound to that digit (also forwarded from panel windows).
    // Capture phase: text fields stopPropagation() keydown, so a bubble-phase listener would miss
    // the shortcut whenever an input/select had focus.
    window.addEventListener('keydown', (e) => {
      const digit = layoutHotkeyDigit(e);
      if (digit !== null && triggerHotkey(digit)) e.preventDefault();
    }, true);
  }

  return { syncPanels, detachPanel, dockPanel, detachedIds, captureLayout, applyLayout, activeLayout, setActiveLayout };
}

/** A detached panel window positions itself when the editor sends EV_PLACE (loading a layout). */
export function listenForPlacement(panelId) {
  listen(EV_PLACE, async (e) => {
    const p = e.payload ?? {};
    if (p.panel !== panelId) return;
    const { LogicalPosition, LogicalSize } = await import('@tauri-apps/api/dpi');
    const win = getCurrentWindow();
    if ([p.x, p.y].every(Number.isFinite)) win.setPosition(new LogicalPosition(p.x, p.y)).catch(() => {});
    if ([p.w, p.h].every(Number.isFinite)) win.setSize(new LogicalSize(p.w, p.h)).catch(() => {});
  });
}
