// SPDX-License-Identifier: MIT OR Apache-2.0
// The editor's keyboard shortcuts: maps a key press to a keymap action and runs it. Both the main
// window and the detached panel windows install this, so every shortcut (now and future) works
// in both without being listed twice.

import { REPEATING, actionFor, actionsFor, comboOf } from './keymap.js';
import * as edit from './edit.js';

/** True while the user is typing in a text field (only File shortcuts run then). */
export const isTyping = (el) =>
  el && ((el.tagName === 'INPUT' && !el.readOnly && !['checkbox', 'radio', 'color'].includes(el.type)) || el.tagName === 'TEXTAREA');

/**
 * Runs a keymap action against `app`. `ctx` supplies the parts only some windows have: `viewport`
 * (viewport-only tools), `zoomActual`, `deleteSelectedKeys`, `closeMenu`, and `onFile` (when set,
 * File actions are handed off instead of run here — the detached window forwards them to the editor).
 */
export function runAction(app, action, ctx) {
  const { viewport, zoomActual, deleteSelectedKeys, onFile, closeMenu } = ctx;
  if (onFile && action.startsWith('file.')) return onFile(action);
  const setTool = (tool) => () => {
    app.tool = tool;
    app.changed();
  };
  const handlers = {
    'tool.pose': setTool('pose'),
    'tool.create': setTool('create'),
    'tool.rotate': setTool('rotate'),
    'tool.translate': setTool('translate'),
    'tool.scale': setTool('scale'),
    'tool.shear': setTool('shear'),
    'mode.toggle': () => app.toggleMode(),
    'play.forward': () => app.togglePlay(1),
    'play.backward': () => app.togglePlay(-1),
    'time.start': () => app.setTime(0),
    'time.end': () => app.jumpToEnd(),
    'key.next': () => app.stepKey(1),
    'key.previous': () => app.stepKey(-1),
    'frame.next': () => app.stepFrame(1),
    'frame.previous': () => app.stepFrame(-1),
    'frame.next10': () => app.stepFrame(10),
    'frame.previous10': () => app.stepFrame(-10),
    'loop.toggle': () => {
      app.looping = !app.looping;
      app.setStatus(`Looping ${app.looping ? 'on' : 'off'}`);
    },
    'key.changed': () => edit.keyChanged(app),
    'key.tool': () => edit.keyTool(app),
    'key.transforms': () => edit.keySelection(app),
    'key.shown': () => edit.keyShown(app),
    'autokey.toggle': () => {
      app.autoKey = !app.autoKey;
      app.changed();
    },
    'select.none': () => app.deselect(),
    'view.fit': () => (app.frameRequest = true),
    'view.actual': () => zoomActual?.(),
    'edit.delete': () => {
      if (viewport && (viewport.meshTool.deleteSelected() || viewport.shapeTool.deleteSelected())) return;
      if (app.selectedKeys.size) deleteSelectedKeys(app);
      else edit.deleteSelection(app);
    },
    'edit.undo': () => app.undo(),
    'edit.redo': () => app.redo(),
    'file.open': () => app.openDialog(),
    'file.save': () => app.save(false),
    'file.saveAs': () => app.save(true),
    'file.export': () => app.exportSkeletonJson(app.saveVersion()),
    'menu.close': () => closeMenu?.(),
  };
  handlers[action]?.();
}

/** Installs the window keydown handler that turns presses into actions and runs them. */
export function installKeyboard(app, ctx) {
  const { closeMenu, isMenuOpen } = ctx;
  window.addEventListener('keydown', (e) => {
    const combo = comboOf(e);
    if (!combo) return;
    let action = actionFor(app.keymap, combo);
    if (!action) return;
    const typing = isTyping(e.target);
    // While typing, only file shortcuts work (text fields keep their own undo, delete, etc.).
    if (typing && !action.startsWith('file.')) return;
    if (e.target.tagName === 'SELECT' && !['mode.toggle', 'menu.close'].includes(action) && !action.startsWith('file.')) return;
    // A key bound to "close menus" closes an open menu; otherwise it runs its other action (deselect).
    if (action === 'menu.close') {
      e.preventDefault();
      if (isMenuOpen?.()) return closeMenu?.();
      action = actionsFor(app.keymap, combo).find((a) => a !== 'menu.close');
      if (!action) return;
    }
    if (e.repeat && !REPEATING.has(action)) return;
    e.preventDefault();
    closeMenu?.();
    // A window can forward the action instead of running it (the detached window hands every
    // shortcut to the editor, which owns the document and the single undo history).
    if (ctx.onAction) ctx.onAction(action);
    else runAction(app, action, ctx);
  });
}
