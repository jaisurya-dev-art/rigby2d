// SPDX-License-Identifier: MIT OR Apache-2.0
// The "Window layouts" UI (View menu, desktop only): save the current arrangement of detached
// panels under a name, recall one, and a Manage panel to rename, rebind its Ctrl+Alt+<digit>
// shortcut, re-capture or delete. The submenu and the Manage panel flag the layout that is active
// now, and amber when the windows have been moved/opened/closed since it was last saved. The store
// is layouts.js; the windows are moved by panelsync.js.

import { confirmDialog } from './platform.js';
import { h, select, submenuItem, textField } from './widgets.js';
import { button, dialog, fieldRow, fields, hint } from './ui.js';
import { PANELS } from './dock.js';
import { assignHotkey, hotkeyLabel, loadLayouts, newLayoutId, removeLayout, renameLayout, saveLayouts, updatePanels, upsertLayout } from './layouts.js';
import { t, tn } from './i18n.js';

// Ctrl+Alt+<digit> options for a shortcut: none, then 1–9 and 0.
const HOTKEY_OPTIONS = [['', tn('No shortcut')], ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((d) => [String(d), `Ctrl+Alt+${d}`])];
const toHotkey = (v) => (v === '' ? null : Number(v));
const hotkeyValue = (hotkey) => (hotkey === null || hotkey === undefined ? '' : String(hotkey));

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
    { label: t('Save current layout…'), action: () => openSaveLayout(ctx) },
    { label: t('Manage layouts…'), disabled: !layouts.length, action: () => openManageLayouts(ctx) },
    'separator',
    ...(layouts.length
      ? layouts.map((l) => {
          const active = l.id === activeId;
          const unsaved = active && dirty;
          return {
            label: `${active ? '● ' : ''}${l.name}${unsaved ? ' — unsaved' : ''}`,
            shortcut: hotkeyLabel(l.hotkey),
            class: active ? (unsaved ? 'active unsaved' : 'active') : null,
            title: (active ? (unsaved ? t('Active layout; its windows moved since it was saved.') + ' ' : t('Active layout.') + ' ') : '') + t('Load: {panels}', { panels: summary(l.panels) }),
            action: () => loadLayout(ctx, l),
          };
        })
      : [{ label: t('No saved layouts yet'), disabled: true, action: () => {} }]),
  ];
}

/** The entry to drop into the View menu (a submenu that unfolds to the right). */
export function windowLayoutsMenuItem(ctx) {
  return submenuItem(t('Window layouts'), () => windowLayoutsSubmenu(ctx), { title: t('Save and recall where the detached panels sit (for multi-monitor setups)') });
}

function loadLayout(ctx, layout) {
  ctx.sync.applyLayout(layout.panels, layout.id, layout.dock);
  ctx.app.setStatus(t('Window layout: {name}', { name: layout.name }));
}

function openSaveLayout(ctx) {
  const existing = loadLayouts();
  let name = t('Layout {number}', { number: existing.length + 1 });
  let hotkey = null;
  const save = button(t('Save'), {
    kind: 'primary',
    onclick: async () => {
      save.disabled = true;
      const panels = await ctx.sync.captureLayout();
      const layout = { id: newLayoutId(), name: name.trim() || t('Layout {number}', { number: existing.length + 1 }), hotkey, panels, dock: ctx.sync.captureDock() };
      saveLayouts(upsertLayout(loadLayouts(), layout));
      ctx.sync.setActiveLayout(layout.id); // the saved layout is now the active, clean one
      ctx.app.setStatus(t('Saved window layout "{name}"', { name: layout.name }) + (hotkey !== null ? ` (${hotkeyLabel(hotkey)})` : ''));
      close();
    },
  });
  const { body, close } = dialog({
    title: t('Save window layout'),
    subtitle: t('Capturing: {panels}.', { panels: summary(currentPanelsHint(ctx)) }),
    footer: [button(t('Cancel'), { onclick: () => close() }), save],
  });
  body.append(
    fields(
      ...fieldRow(t('Name'), textField(name, (v) => (name = v), { width: '100%' })),
      ...fieldRow(t('Shortcut'), select(HOTKEY_OPTIONS.map(([v, l]) => [v, t(l)]), '', (v) => (hotkey = toHotkey(v)))),
    ),
    hint(t('The shortcut is optional: Ctrl+Alt+<number> loads this layout from any Rigby2D window.')),
  );
}

// A best-effort hint of what will be captured, for the dialog text (the real capture is async on Save).
function currentPanelsHint(ctx) {
  return Object.fromEntries(ctx.sync.detachedIds().map((id) => [id, true]));
}

function openManageLayouts(ctx) {
  const { body, close } = dialog({
    title: t('Manage window layouts'),
    subtitle: t('Rename a layout, bind a Ctrl+Alt+<number> shortcut, update it to the current arrangement, or delete it.'),
    className: 'modal-wide',
    footer: [button(t('Close'), { onclick: () => close() })],
  });
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
              { class: `layout-row${active ? ' active' : ''}${unsaved ? ' dirty' : ''}`, title: t('Panels: {panels}', { panels: summary(l.panels) }) },
              h('span', { class: 'layout-dot', title: active ? (unsaved ? t('Active, with unsaved window changes') : t('Active layout')) : '' }),
              textField(l.name, (v) => saveLayouts(renameLayout(loadLayouts(), l.id, v)), { width: '100%' }),
              select(HOTKEY_OPTIONS.map(([v, l]) => [v, t(l)]), hotkeyValue(l.hotkey), (v) => persist(assignHotkey(loadLayouts(), l.id, toHotkey(v)))),
              h(
                'div',
                { class: 'layout-actions' },
                button(t('Load'), { size: 'sm', title: t('Load this layout now'), onclick: () => (loadLayout(ctx, l), render()) }),
                button(t('Update'), {
                  size: 'sm',
                  title: t('Save the current window arrangement into this layout and make it the active one'),
                  onclick: async (e) => {
                    e.currentTarget.disabled = true;
                    const panels = await ctx.sync.captureLayout();
                    saveLayouts(updatePanels(loadLayouts(), l.id, panels, ctx.sync.captureDock()));
                    ctx.sync.setActiveLayout(l.id);
                    ctx.app.setStatus(t('Updated "{name}" to the current arrangement', { name: l.name }));
                    render();
                  },
                }),
                button(t('Delete'), {
                  size: 'sm',
                  kind: 'danger',
                  title: t('Delete this layout'),
                  onclick: async () => {
                    if (!(await confirmDialog(t('Delete the layout "{name}"?', { name: l.name }), t('Delete layout')))) return;
                    if (active) ctx.sync.setActiveLayout(null);
                    persist(removeLayout(loadLayouts(), l.id));
                  },
                }),
              ),
              unsaved ? h('span', { class: 'layout-badge', title: t('The windows moved since this layout was saved') }, t('unsaved')) : null,
            );
          })
        : [h('p', { class: 'weak' }, t('No saved layouts yet. Use View ▸ Window layouts ▸ Save current layout.'))]),
    );
  };
  render();
  body.append(hint(t('A filled dot marks the active layout; "unsaved" means its windows moved since it was saved (Update saves them).')), list);
}
