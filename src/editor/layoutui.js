// SPDX-License-Identifier: MIT OR Apache-2.0
// The "Window layouts" UI (View menu, desktop only): save the current arrangement of detached
// panels under a name, recall one, and a Manage panel to rename, rebind its Ctrl+Alt+<digit>
// shortcut, re-capture or delete. The submenu and the Manage panel flag the layout that is active
// now, and amber when the windows have been moved/opened/closed since it was last saved. The store
// is layouts.js; the windows are moved by panelsync.js.

import { confirmDialog } from './platform.js';
import { h, select, submenuItem, textField } from './widgets.js';
import { PANELS } from './dock.js';
import { assignHotkey, hotkeyLabel, loadLayouts, newLayoutId, removeLayout, renameLayout, saveLayouts, updatePanels, upsertLayout } from './layouts.js';

// Ctrl+Alt+<digit> options for a shortcut: none, then 1–9 and 0.
const HOTKEY_OPTIONS = [['', 'No shortcut'], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d) => [String(d), `Ctrl+Alt+${d}`])];
const toHotkey = (v) => (v === '' ? null : Number(v));
const hotkeyValue = (hotkey) => (hotkey === null || hotkey === undefined ? '' : String(hotkey));

/** A plain modal with an Escape-to-close backdrop; `build(close)` returns its contents. */
function modal(build, { wide = false } = {}) {
  const overlay = h('div', { class: 'modal-backdrop' });
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  document.addEventListener('keydown', onKey, true);
  overlay.append(h('div', { class: `modal${wide ? ' modal-wide' : ''}` }, ...build(close).filter(Boolean)));
  document.body.append(overlay);
  return close;
}

/** Which panels a layout pops out, as a readable list ("Timeline, Tree"), or "all docked". */
function summary(panels) {
  const ids = Object.keys(panels ?? {});
  return ids.length ? ids.map((id) => PANELS[id]?.label ?? id).join(', ') : 'all docked';
}

/** Items for the View ▸ Window layouts submenu (rebuilt each time it opens, so it stays current). */
export function windowLayoutsSubmenu(ctx) {
  const layouts = loadLayouts();
  const { id: activeId, dirty } = ctx.sync.activeLayout();
  return [
    { label: 'Save current layout…', action: () => openSaveLayout(ctx) },
    { label: 'Manage layouts…', disabled: !layouts.length, action: () => openManageLayouts(ctx) },
    'separator',
    ...(layouts.length
      ? layouts.map((l) => {
          const active = l.id === activeId;
          const unsaved = active && dirty;
          return {
            label: `${active ? '● ' : ''}${l.name}${unsaved ? ' — unsaved' : ''}`,
            shortcut: hotkeyLabel(l.hotkey),
            class: active ? (unsaved ? 'active unsaved' : 'active') : null,
            title: `${active ? (unsaved ? 'Active layout — the windows moved since it was saved. ' : 'Active layout. ') : ''}Load: ${summary(l.panels)}`,
            action: () => loadLayout(ctx, l),
          };
        })
      : [{ label: 'No saved layouts yet', disabled: true, action: () => {} }]),
  ];
}

/** The entry to drop into the View menu (a submenu that unfolds to the right). */
export function windowLayoutsMenuItem(ctx) {
  return submenuItem('Window layouts', () => windowLayoutsSubmenu(ctx), { title: 'Save and recall where the detached panels sit (for multi-monitor setups)' });
}

function loadLayout(ctx, layout) {
  ctx.sync.applyLayout(layout.panels, layout.id);
  ctx.app.setStatus(`Window layout: ${layout.name}`);
}

function openSaveLayout(ctx) {
  const existing = loadLayouts();
  let name = `Layout ${existing.length + 1}`;
  let hotkey = null;
  modal((close) => [
    h('h3', null, 'Save window layout'),
    h('p', { class: 'weak' }, 'Stores which panels are popped out and where, so you can bring the whole arrangement back later — handy across two monitors.'),
    h('p', { class: 'small weak' }, `Capturing: ${summary(currentPanelsHint(ctx))}.`),
    h(
      'div',
      { class: 'grid' },
      h('label', null, 'Name'),
      textField(name, (v) => (name = v), { width: '100%' }),
      h('label', null, 'Shortcut'),
      select(HOTKEY_OPTIONS, '', (v) => (hotkey = toHotkey(v))),
    ),
    h('p', { class: 'small weak' }, 'The shortcut is optional: Ctrl+Alt+<number> loads this layout from any Rigby2D window.'),
    h(
      'div',
      { class: 'modal-buttons' },
      h('button', { onclick: close }, 'Cancel'),
      h(
        'button',
        {
          class: 'primary',
          onclick: async (e) => {
            e.currentTarget.disabled = true;
            const panels = await ctx.sync.captureLayout();
            const layout = { id: newLayoutId(), name: name.trim() || `Layout ${existing.length + 1}`, hotkey, panels };
            saveLayouts(upsertLayout(loadLayouts(), layout));
            ctx.sync.setActiveLayout(layout.id); // the saved layout is now the active, clean one
            ctx.app.setStatus(`Saved window layout "${layout.name}"${hotkey !== null ? ` (${hotkeyLabel(hotkey)})` : ''}`);
            close();
          },
        },
        'Save',
      ),
    ),
  ]);
}

// A best-effort hint of what will be captured, for the dialog text (the real capture is async on Save).
function currentPanelsHint(ctx) {
  return Object.fromEntries(ctx.sync.detachedIds().map((id) => [id, true]));
}

function openManageLayouts(ctx) {
  modal((close) => {
    // (wider modal below so the row's name field, hotkey select and the Load/Update/Delete
    // actions keep their width once the "unsaved" badge joins them at the right edge.)
    const list = h('div', { class: 'layout-list' });
    const render = () => {
      const layouts = loadLayouts();
      const { id: activeId, dirty } = ctx.sync.activeLayout();
      const persist = (next) => {
        saveLayouts(next);
        render();
      };
      list.replaceChildren(
        ...(layouts.length
          ? layouts.map((l) => {
              const active = l.id === activeId;
              const unsaved = active && dirty;
              return h(
                'div',
                { class: `layout-row${active ? ' active' : ''}${unsaved ? ' dirty' : ''}`, title: `Panels: ${summary(l.panels)}` },
                h('span', { class: 'layout-dot', title: active ? (unsaved ? 'Active — unsaved window changes' : 'Active layout') : '' }, active ? '●' : ''),
                textField(l.name, (v) => saveLayouts(renameLayout(loadLayouts(), l.id, v)), { width: '100%' }),
                select(HOTKEY_OPTIONS, hotkeyValue(l.hotkey), (v) => persist(assignHotkey(loadLayouts(), l.id, toHotkey(v)))),
                h('div', { class: 'layout-actions' },
                  h('button', { title: 'Load this layout now', onclick: () => { loadLayout(ctx, l); render(); } }, 'Load'),
                  h('button', { title: 'Save the current window arrangement into this layout and make it the active one', onclick: async (e) => { e.currentTarget.disabled = true; const panels = await ctx.sync.captureLayout(); saveLayouts(updatePanels(loadLayouts(), l.id, panels)); ctx.sync.setActiveLayout(l.id); ctx.app.setStatus(`Updated "${l.name}" to the current arrangement`); render(); } }, 'Update'),
                  h('button', { title: 'Delete this layout', onclick: async () => { if (await confirmDialog(`Delete the layout "${l.name}"?`, 'Delete layout')) { if (active) ctx.sync.setActiveLayout(null); persist(removeLayout(loadLayouts(), l.id)); } } }, 'Delete'),
                ),
                unsaved ? h('span', { class: 'layout-badge', title: 'The windows moved since this layout was saved' }, 'unsaved') : null,
              );
            })
          : [h('p', { class: 'weak' }, 'No saved layouts yet. Use View ▸ Window layouts ▸ Save current layout.')]),
      );
    };
    render();
    return [
      h('h3', null, 'Manage window layouts'),
      h('p', { class: 'weak' }, 'Rename a layout, bind a Ctrl+Alt+<number> shortcut, update it to the current arrangement, or delete it.'),
      h('p', { class: 'small weak layout-legend' }, h('span', { class: 'layout-dot' }, '●'), ' current layout · ', h('span', { class: 'layout-badge' }, 'unsaved'), ' the windows moved since it was saved (use Update to save their new spots).'),
      list,
      h('div', { class: 'modal-buttons' }, h('button', { class: 'primary', onclick: close }, 'Done')),
    ];
  }, { wide: true });
}
