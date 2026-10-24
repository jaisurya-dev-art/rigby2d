// SPDX-License-Identifier: MIT OR Apache-2.0
// Detached panel window: a real OS window (e.g. on a second monitor) that shows and edits one
// editor panel — chosen by ?panel=<id> in the URL. The editor window is the single authority (it
// owns the document, the undo history and the selection); this window forwards its shortcuts there
// and mirrors the state that comes back (see app.snapshotState / applyStateSnapshot and dock.js).
// Pointer edits run locally for instant feedback and are shipped to the editor, which records them
// as one undo step. To add a panel: register it in dock.js PANELS and add a builder below.

import './style.css';
import { App } from './app.js';
import { Dopesheet, renderControls, keySelectionIndices, applyKeySelection } from './timeline.js';
import { GraphEditor } from './graph.js';
import * as tree from './tree.js';
import * as inspector from './inspector.js';
import { installKeyboard } from './keys.js';
import { closeMenu, isMenuOpen, widgetState, h } from './widgets.js';
import { EV_SYNC, EV_CONTROL, EV_CLOSED, PANELS } from './dock.js';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { emit, listen } from '@tauri-apps/api/event';

// ---- panel views ------------------------------------------------------------------------------
// A builder returns { el, draw?(), rebuild?(), followsTime?, every? }: el is inserted into the
// window; draw runs every frame (canvas panels); rebuild runs when the document changes (DOM
// panels). followsTime panels also rebuild while playing, at most every `every` ms.

function buildTimeline(app) {
  const controls = h('div', { id: 'controls' });
  const dopeDiv = h('div', { id: 'dopesheet' }, h('canvas'));
  const graphDiv = h('div', { id: 'graph', hidden: true }, h('canvas'));
  const wrap = h('div', { class: 'dopesheet-wrap' }, h('div', { class: 'empty' }, 'No animation. Create one in the editor window.'), dopeDiv, graphDiv);
  const el = h('section', { id: 'timeline' }, controls, wrap);
  const dopesheet = new Dopesheet(app, dopeDiv, dopeDiv.querySelector('canvas'));
  const graph = new GraphEditor(app, graphDiv, graphDiv.querySelector('canvas'));
  return {
    el,
    followsTime: true,
    every: 66,
    draw() {
      const showGraph = app.timelineView === 'graph' && !!app.currentAnimation();
      graphDiv.hidden = !showGraph;
      if (showGraph) {
        dopeDiv.hidden = true;
        wrap.querySelector('.empty').hidden = true;
        graph.draw();
      } else {
        dopesheet.draw();
      }
    },
    rebuild() {
      renderControls(app, controls);
    },
  };
}

function buildTree(app) {
  const el = h('section', { id: 'tree', class: 'panel' });
  return { el, rebuild: () => tree.render(app, el) };
}

function buildInspector(app) {
  const content = h('div', { class: 'content scroll' });
  const el = h('section', { id: 'properties', class: 'panel' }, content);
  return { el, followsTime: true, every: 200, rebuild: () => inspector.render(app, content) };
}

const BUILDERS = { timeline: buildTimeline, tree: buildTree, inspector: buildInspector };

// ---- window setup -----------------------------------------------------------------------------

const panelId = new URLSearchParams(location.search).get('panel') || 'timeline';
const app = new App();
const $ = (sel) => document.querySelector(sel);
const body = $('#panel-body');
const view = (BUILDERS[panelId] ?? buildTimeline)(app);
body.replaceChildren(view.el);
document.title = `Rigby2D — ${PANELS[panelId]?.label ?? 'Panel'}`;

// The shared state last seen, so a change coming from the editor is not echoed straight back.
let lastSync = '';
let lastSentDoc = null;
let gotFirst = false;
let built = -1;
let builtTime = -1;
let builtAt = 0;

// Derived from the snapshot so new shared fields are covered automatically; docJson excluded (huge,
// tracked separately) and the key selection folded in. Mirrors stateSignature in the editor window.
const signature = (s, keys) => JSON.stringify({ ...s, docJson: undefined, keys });

// Every shortcut (Delete, Ctrl+Z, K, …) is run by the editor window, which owns the document and
// the single undo history — so this window forwards the action instead of running it locally.
installKeyboard(app, {
  onAction: (action) => emit(EV_CONTROL, { action }),
  closeMenu,
  isMenuOpen,
});

// Keep the panel from rebuilding mid-interaction (a held press inside it), so the click is not lost.
let pointersDown = 0;
let pressTarget = null;
window.addEventListener('pointerdown', (e) => ((pointersDown++), (pressTarget = e.target)), true);
window.addEventListener('pointerup', () => (pointersDown = Math.max(0, pointersDown - 1)), true);
window.addEventListener('pointercancel', () => (pointersDown = Math.max(0, pointersDown - 1)), true);
window.addEventListener('blur', () => (pointersDown = 0));

function busy() {
  const a = document.activeElement;
  if (pointersDown > 0 && pressTarget && body.contains(pressTarget)) return true;
  return widgetState.dragging || (a && ['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName));
}

listen(EV_SYNC, (e) => {
  app.applyStateSnapshot(e.payload);
  applyKeySelection(app, e.payload.keys);
  const s = app.snapshotState();
  lastSync = signature(s, keySelectionIndices(app));
  if (e.payload.docJson) lastSentDoc = s.docJson;
  gotFirst = true;
  built = -1;
});

// Docking (the ⤓ button) or closing the window both re-dock this panel into the editor.
function dockBack() {
  emit(EV_CLOSED, { panel: panelId });
  getCurrentWindow().destroy().catch(() => {});
}
$('#panel-dock').addEventListener('click', () => dockBack());
getCurrentWindow().onCloseRequested(() => emit(EV_CLOSED, { panel: panelId }));

/** Ships this window's edits and selection to the editor, once the first full state has arrived. */
function sendState() {
  if (!gotFirst) return;
  const s = app.snapshotState();
  const keys = keySelectionIndices(app);
  const sig = signature(s, keys);
  const docChanged = s.docJson !== lastSentDoc;
  if (sig === lastSync && !docChanged) return;
  lastSync = sig;
  // Payload is the snapshot itself plus the key selection; the document rides only when it changed.
  const payload = { ...s, keys };
  if (docChanged) lastSentDoc = s.docJson;
  else delete payload.docJson;
  emit(EV_CONTROL, payload);
}

/** Sets an element's text only when it differs (the loop runs 60 times a second). */
function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function frame(now) {
  // The editor window drives playback and syncs the time here; this window never advances it.
  app.sanitize();
  view.draw?.();
  const timeMoved = view.followsTime && builtTime !== app.timeVersion && now - builtAt >= (view.every ?? 66);
  if ((built !== app.version || timeMoved) && !busy()) {
    built = app.version;
    builtTime = app.timeVersion;
    builtAt = now;
    view.rebuild?.();
  }
  setText($('#status-text'), app.status);
  setText($('#status-info'), `${app.doc.bones.length} bones · ${app.doc.slots.length} slots`);

  // Settle a finished pointer edit into the document, then ship edits and selection to the editor.
  app.commitHistory(pointersDown > 0 || busy());
  sendState();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// Ask the editor for the first full state (it holds the open project).
emit(EV_CONTROL, { ready: true });
