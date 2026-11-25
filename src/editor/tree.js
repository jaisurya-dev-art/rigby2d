// SPDX-License-Identifier: MIT OR Apache-2.0
// Tree panel: the skeleton (bones, slots and their attachments) plus draw order, skins,
// constraints, events, animations and images, in collapsible sections.

import { listConstraints } from '../core/constraintdata.js';
import { Mode, selBone, selSlot } from './app.js';
import { CONSTRAINT_LABELS, PHYSICS_HINT, createConstraint, createTransform } from './constraintui.js';
import { dragBoneRow, dragSlotRow, rootDropTarget } from './bonednd.js';
import { dragOrderRow } from './draworderdnd.js';
import { treeMatches } from './treefind.js';
import * as edit from './edit.js';
import { onionBonePanel, rgbCss } from './onionui.js';
import { createEvent, createSkin } from './skineventui.js';
import { h, popupMenu } from './widgets.js';
import { button, iconButton, uiIcon } from './ui.js';
import { isBoneHidden, isBoneLocked, isSlotHidden, isSlotLocked, toggleBone, toggleSlot } from './visibility.js';
import { has } from './workspaces.js';
import { askText } from './resultui.js';
import { addActorMenu, sceneRows } from './sceneui.js';
import { joinStatus, statusMessage, t, tn } from './i18n.js';

/** Collapsed sections and bones (kept for the session). */
const collapsed = new Set(['images', 'events']);
/** The Find box's text (kept for the session). */
let query = '';
// Slots whose attachments are listed (by slot name). Slots start folded, showing only the visible
// attachment on their row, so rigs with many images stay readable.
const openSlots = new Set();

/** The app and the tree's root, so bone-hover updates reach the live DOM between rebuilds. */
let treeApp = null;
let treeRoot = null;

/**
 * Toggles the hover class on bone rows. Registered as `app.onHoverChange` on every rebuild so the
 * callback always points at the current DOM; hover never rebuilds the tree, only re-paints classes.
 */
function applyBoneHover(bone) {
  if (!treeRoot) return;
  for (const r of treeRoot.querySelectorAll('.row[data-bone]')) {
    r.classList.toggle('bone-hover', Number(r.dataset.bone) === bone);
  }
}

/** A collapsible section (also used by the Rig panel, rigpanel.js). */
export function section(app, id, title, count, children, actions = null) {
  const open = !collapsed.has(id);
  return h(
    'div',
    { class: 'tree-section' },
    h(
      'div',
      {
        class: 'tree-heading',
        onclick: () => {
          if (open) collapsed.add(id);
          else collapsed.delete(id);
          app.changed();
        },
      },
      h('span', { class: 'twisty' }, chevron(open)),
      h('span', null, title),
      count !== null ? h('span', { class: 'count' }, String(count)) : null,
      actions ? h('span', { class: 'actions', onclick: (e) => e.stopPropagation() }, actions) : null,
    ),
    open ? children : null,
  );
}

/** A row label: a type icon (dimmed with `faint`) and the name. */
export const label = (iconName, text, faint = false) => [h('span', { class: `row-icon${faint ? ' faint' : ''}` }, uiIcon(iconName, 'sm')), h('span', { class: 'row-name' }, text)];

/** A fold toggle: chevron right (folded) or down (open), with an optional count. */
const chevron = (open, count = null) => [uiIcon(open ? 'chevron-down' : 'chevron-right', 'sm'), count !== null ? h('span', { class: 'twisty-count' }, String(count)) : null];

/**
 * A row's eye or lock toggle (`kind` 'hidden' or 'locked'), shown on hover and always while on.
 * `toggle(e)` flips it (Alt+click on a bone: its whole branch).
 */
function viewToggle(kind, on, toggle, branchHint) {
  const hide = kind === 'hidden';
  const title = hide ? (on ? t('Show in the viewport') : t('Hide in the viewport')) : on ? t('Unlock: pick it in the viewport again') : t('Lock: the viewport no longer picks it');
  return h(
    'button',
    {
      type: 'button',
      class: `view-toggle${on ? ' on' : ''}`,
      'aria-pressed': on ? 'true' : 'false',
      'aria-label': title,
      title: branchHint ? `${title}
${t('Alt+click: the whole branch')}` : title,
      onclick: (e) => {
        e.stopPropagation();
        toggle(e);
      },
    },
    uiIcon(hide ? (on ? 'eye-off' : 'eye') : on ? 'lock' : 'lock-open', 'sm'),
  );
}

/** A section's add button (ghost, with a plus). */
export const addButton = (text, { title, disabled = false, onclick }) => button(text, { kind: 'ghost', size: 'sm', icon: 'plus', title, disabled, onclick });

export function row(label, { depth = 0, selected = false, cls = '', onclick, extra = null, title, tut = null, bone = null } = {}) {
  const attrs = { class: `row${selected ? ' selected' : ''}${cls ? ` ${cls}` : ''}`, 'data-tut': tut, style: depth ? `--depth: ${depth}` : undefined, onclick, title };
  // Bone rows drive (and show) the shared hover: hovering one lights the bone up here, in the
  // viewport and in the timeline. Done with mouse enter/leave so it never rebuilds the tree.
  if (bone !== null) {
    attrs['data-bone'] = String(bone);
    attrs.onmouseenter = () => treeApp?.setHover(bone);
    attrs.onmouseleave = () => treeApp?.setHover(null);
  }
  return h('div', attrs, label, extra);
}

/** Draws a connector at each ancestor with remaining siblings, then an elbow to this row. */
function skeletonRow(label, options, branches) {
  const item = row(label, { ...options, depth: branches.length });
  if (!branches.length) return item;
  item.classList.add('with-branches');
  const last = branches.length - 1;
  item.prepend(h('span', { class: 'tree-branches', 'aria-hidden': 'true' }, branches.map((continues, level) => {
    if (!continues && level !== last) return null;
    const cls = level === last ? ` elbow${continues ? '' : ' end'}` : '';
    return h('span', { class: `tree-branch${cls}`, style: `--branch-level: ${level}` });
  })));
  return item;
}

// ---- Right-click menus ---------------------------------------------------------------------------

/** Asks for a new name and applies it with `rename(name)`; says so when the name is taken. */
async function renameRow(app, title, value, rename) {
  const name = await askText({ title, value, okLabel: 'Rename' });
  if (name && name !== value && !rename(name)) app.setStatus(statusMessage('That name is already used'));
}

/** Selects the keys of a bone or slot, and says how many (or why there are none). */
function selectKeys(app, item, name) {
  const n = edit.selectKeysOf(app, item);
  app.setStatus(n ? statusMessage('Selected {count} key(s) of {name}', { count: n, name }) : statusMessage('{name} has no keys in this animation', { name }));
}

/** The menu of a bone's row: what you would otherwise find in the inspector, the row and the toolbar. */
function boneMenu(app, bone, x, y) {
  const doc = app.doc;
  const name = doc.bones[bone].name;
  const setup = app.mode === Mode.Setup;
  const hidden = isBoneHidden(doc, bone);
  const locked = isBoneLocked(doc, bone);
  const view = (kind, branch) => () => {
    toggleBone(doc, kind, bone, branch);
    app.changed();
  };
  const hasKids = doc.bones.some((b) => b.parent === bone);
  popupMenu(x, y, [
    { label: t('Rename…'), disabled: !setup, title: setup ? null : t('In Setup mode'), action: () => renameRow(app, t('Rename bone'), name, (n) => edit.renameBone(app, bone, n)) },
    { label: t('Add child bone'), disabled: !setup, action: () => edit.addChildBone(app, bone) },
    { label: t('Add point bone'), disabled: !setup, action: () => edit.addPointBone(app, bone) },
    { label: t('Duplicate bone'), disabled: !setup || bone === 0, action: () => edit.duplicateSelection(app) },
    { label: t('Mirror to the other side'), disabled: !setup || bone === 0, action: () => edit.duplicateSelection(app, { mirror: true }) },
    'separator',
    { label: hidden ? t('Show') : t('Hide'), action: view('hidden', false) },
    { label: locked ? t('Unlock') : t('Lock'), action: view('locked', false) },
    hasKids && { label: hidden ? t('Show with its children') : t('Hide with its children'), action: view('hidden', true) },
    hasKids && { label: locked ? t('Unlock with its children') : t('Lock with its children'), action: view('locked', true) },
    'separator',
    { label: t('Select its keys'), disabled: !app.currentAnimation(), title: t('Selects every key of this bone in the current animation'), action: () => selectKeys(app, { bone }, name) },
    hasKids && { label: t('Select its branch'), action: () => edit.selectRelated(app, 'branch') },
    'separator',
    { label: t('Delete'), disabled: !setup || bone === 0, title: bone === 0 ? t('The root bone cannot be deleted') : null, action: () => {
      app.select({ bone });
      edit.deleteSelection(app);
      app.changed();
    } },
  ]);
}

/** The menu of a slot's row. */
function slotMenu(app, slot, x, y) {
  const doc = app.doc;
  const name = doc.slots[slot].name;
  const setup = app.mode === Mode.Setup;
  const view = (kind) => () => {
    toggleSlot(doc, kind, slot);
    app.changed();
  };
  popupMenu(x, y, [
    { label: t('Rename…'), disabled: !setup, title: setup ? null : t('In Setup mode'), action: () => renameRow(app, t('Rename slot'), name, (n) => edit.renameSlot(app, slot, n)) },
    'separator',
    { label: isSlotHidden(doc, slot) ? t('Show') : t('Hide'), action: view('hidden') },
    { label: isSlotLocked(doc, slot) ? t('Unlock') : t('Lock'), action: view('locked') },
    'separator',
    { label: t('Select its keys'), disabled: !app.currentAnimation(), title: t('Selects every key of this slot in the current animation'), action: () => selectKeys(app, { slot }, name) },
    'separator',
    { label: t('Delete'), disabled: !setup, action: () => {
      app.select({ slot });
      edit.deleteSelection(app);
      app.changed();
    } },
  ]);
}

/**
 * Renames a bone or slot in its row: the name turns into a text field; Enter or leaving it applies,
 * Escape cancels. Setup mode only (names are part of the rig).
 */
function renameInline(app, row, item) {
  if (app.mode !== Mode.Setup) {
    app.setStatus(statusMessage('Rename in Setup mode (Tab)'));
    return;
  }
  const nameEl = row.querySelector('.row-name');
  if (!nameEl || row.querySelector('.row-rename')) return;
  const isBone = item.bone !== undefined;
  const old = isBone ? app.doc.bones[item.bone].name : app.doc.slots[item.slot].name;
  let done = false;
  const finish = (apply) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    input.remove();
    nameEl.hidden = false;
    if (apply && name && name !== old) {
      const ok = isBone ? edit.renameBone(app, item.bone, name) : edit.renameSlot(app, item.slot, name);
      if (!ok) app.setStatus(statusMessage('That name is already used'));
    }
    app.changed();
  };
  const input = h('input', {
    class: 'row-rename',
    value: old,
    spellcheck: false,
    'aria-label': isBone ? t('Rename bone') : t('Rename slot'),
    onkeydown: (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    },
    onblur: () => finish(true),
    onclick: (e) => e.stopPropagation(),
    onpointerdown: (e) => e.stopPropagation(),
  });
  nameEl.hidden = true;
  nameEl.after(input);
  input.focus();
  input.select();
}

/** Opens `menu(app, index, x, y)` on a right-click of `row`, selecting what the row shows first. */
function withMenu(app, row, item, menu) {
  row.addEventListener('dblclick', (e) => {
    if (e.target.closest('button, .twisty, input')) return;
    e.preventDefault();
    renameInline(app, row, item);
  });
  row.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (app.pick) return;
    app.select(item);
    menu(app, item.bone ?? item.slot, e.clientX, e.clientY);
  });
}

/**
 * Which skins give a slot images, as small tags on its row (the skins shown now stand out). Up to two
 * names, then a count; the title lists them all. Nothing for a slot only the default skin fills.
 */
function skinTags(doc, slot, active) {
  const skins = doc.skins.filter((k) => k.slots.some((e) => e.slot === slot && e.attachments.length)).map((k) => k.name);
  if (!skins.length) return null;
  const shown = skins.slice(0, 2);
  return h(
    'span',
    { class: 'skin-tags', title: t('In skins: {skins}', { skins: skins.join(', ') }) },
    shown.map((name) => h('span', { class: `skin-tag${active.has(name) ? ' on' : ''}` }, name)),
    skins.length > shown.length ? h('span', { class: 'skin-tag more' }, `+${skins.length - shown.length}`) : null,
  );
}

/** The selection the tree last showed, so a new one (from the viewport, say) is revealed once. */
let shownSel = '';

/** Unfolds the bones above the selected bone or slot, so its row is in the tree. */
function revealSelection(app) {
  const doc = app.doc;
  const slot = selSlot(app.sel);
  let b = slot !== null ? doc.slots[slot]?.bone : selBone(app.sel);
  if (b === null || b === undefined || !doc.bones[b]) return;
  if (slot === null) b = doc.bones[b].parent;
  while (b !== null && b !== undefined && doc.bones[b]) {
    collapsed.delete(`bone:${b}`);
    b = doc.bones[b].parent;
  }
  collapsed.delete('skeleton');
}

/** Rows the arrow keys move through: bones and slots of the skeleton, top to bottom. */
const navRows = (el) => [...el.querySelectorAll('.tree-section .row[data-bone], .tree-section .row[data-slot]')].filter((r) => r.closest('.order-list') === null);

/** Arrow keys in the tree: up/down move the selection, left folds (or goes to the parent), right unfolds. */
function treeKeys(app, el, e) {
  // F2 renames the selected bone or slot in its row.
  if (e.key === 'F2') {
    const b = selBone(app.sel);
    const sl = selSlot(app.sel);
    const row = b !== null ? el.querySelector(`.row[data-bone="${b}"]`) : sl !== null ? el.querySelector(`.row.slot[data-slot="${sl}"]`) : null;
    if (row) {
      e.preventDefault();
      renameInline(app, row, b !== null ? { bone: b } : { slot: sl });
    }
    return;
  }
  if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
  const rows = navRows(el);
  if (!rows.length) return;
  e.preventDefault();
  e.stopPropagation();
  const at = rows.findIndex((r) => r.classList.contains('selected'));
  const pick = (r) => {
    if (!r) return;
    if (r.dataset.slot !== undefined) app.select({ slot: Number(r.dataset.slot) });
    else app.select({ bone: Number(r.dataset.bone) });
  };
  if (e.key === 'ArrowUp') return pick(rows[at < 0 ? 0 : Math.max(0, at - 1)]);
  if (e.key === 'ArrowDown') return pick(rows[at < 0 ? 0 : Math.min(rows.length - 1, at + 1)]);
  const bone = selBone(app.sel);
  if (bone === null) {
    // A slot: left goes to its bone.
    const slot = selSlot(app.sel);
    if (e.key === 'ArrowLeft' && slot !== null) app.select({ bone: app.doc.slots[slot].bone });
    return;
  }
  const key = `bone:${bone}`;
  if (e.key === 'ArrowRight') {
    if (collapsed.has(key)) {
      collapsed.delete(key);
      app.changed();
    }
  } else if (!collapsed.has(key) && (app.doc.children(bone).length || app.doc.slots.some((s) => s.bone === bone))) {
    collapsed.add(key);
    app.changed();
  } else if (app.doc.bones[bone].parent !== null) {
    app.select({ bone: app.doc.bones[bone].parent });
  }
}

export function render(app, el) {
  treeApp = app;
  const doc = app.doc;
  const selKey = JSON.stringify(app.sel ?? null);
  const revealing = selKey !== shownSel;
  if (revealing) {
    shownSel = selKey;
    revealSelection(app);
  }
  const selected = new Set(app.selectedBones());
  const select = (item) => (e) => app.select(item, e.ctrlKey || e.metaKey);
  const pose = app.pose();
  const active = new Set(doc.activeSkins());

  // Find: only the bones and slots whose names match, with the bones above them, all unfolded.
  const q = query.trim().toLowerCase();
  const named = (x) => x.name.toLowerCase().includes(q);
  const keep = treeMatches(doc, query);

  // Skeleton: bones nested by parent, each bone's slots, each slot's attachments.
  const skeleton = [];
  // A bone's slots are listed front first (drawn on top first), like the Draw order section and the
  // layer panels of Photoshop and Aseprite.
  const slotsOf = new Map();
  doc.slots.forEach((s, i) => {
    if (!slotsOf.has(s.bone)) slotsOf.set(s.bone, []);
    slotsOf.get(s.bone).unshift([s, i]);
  });
  const childrenOf = new Map();
  doc.bones.forEach((b, i) => {
    if (b.parent === null) return;
    if (!childrenOf.has(b.parent)) childrenOf.set(b.parent, []);
    childrenOf.get(b.parent).push(i);
  });
  const visit = (bone, branches) => {
    const kids = (childrenOf.get(bone) ?? []).filter((child) => !keep || keep.has(child));
    const slots = (slotsOf.get(bone) ?? []).filter(([s]) => !keep || named(s) || named(doc.bones[bone]));
    const key = `bone:${bone}`;
    const hasChildren = kids.length || slots.length;
    const open = keep ? true : !collapsed.has(key);
    const twisty = hasChildren
      ? h(
          'span',
          {
            class: 'twisty right',
            title: open ? t('Collapse') : t('Expand'),
            onclick: (e) => {
              e.stopPropagation();
              if (open) collapsed.add(key);
              else collapsed.delete(key);
              app.changed();
            },
          },
          chevron(open),
        )
      : null;
    // Onion skinning: a per-bone toggle plus marks showing which direction(s) are ghosted.
    const animate = app.mode === Mode.Animate;
    const oc = animate && app.onion.enabled ? app.onionFor(bone) : null;
    const direct = !!app.onionOverride(bone);
    const marks =
      oc && app.onionOverrideCount() > 0
        ? h(
            'span',
            { class: 'onion-marks' },
            oc.past > 0 ? h('span', { class: 'onion-mark', title: t('Showing {count} past frame(s)', { count: oc.past }), style: { color: rgbCss(oc.pastColor) } }, uiIcon('chevron-left', 'sm')) : null,
            oc.future > 0 ? h('span', { class: 'onion-mark', title: t('Showing {count} future frame(s)', { count: oc.future }), style: { color: rgbCss(oc.futureColor) } }, uiIcon('chevron-right', 'sm')) : null,
          )
        : null;
    const onionBtn = animate
      ? h(
          'span',
          {
            class: `onion-bonebtn${direct ? ' on' : ''}`,
            title: t('Configure onion skin for this bone (past / future, color)'),
            onclick: (e) => {
              e.stopPropagation();
              const r = e.target.getBoundingClientRect();
              onionBonePanel(app, bone, r.left, r.bottom);
            },
          },
          uiIcon('layers', 'sm'),
        )
      : null;
    const boneHidden = isBoneHidden(doc, bone);
    const boneToggles = ['hidden', 'locked'].map((kind) =>
      viewToggle(kind, kind === 'hidden' ? boneHidden : isBoneLocked(doc, bone), (e) => {
        toggleBone(doc, kind, bone, e.altKey);
        app.changed();
      }, true),
    );
    const boneRow = skeletonRow(label(doc.bones[bone].length > 0 ? 'bone' : 'crosshair', doc.bones[bone].name), {
      tut: `bone:${doc.bones[bone].name}`,
      cls: `${q && named(doc.bones[bone]) ? 'match' : ''}${boneHidden ? ' view-hidden' : ''}`,
      selected: selected.has(bone),
      // Picking a bone for a field: a click on its row answers it.
      onclick: (e) => (app.pick ? app.finishPick(bone) : select({ bone })(e)),
      extra: [marks, onionBtn, ...boneToggles, twisty],
      bone,
    }, branches);
    if (bone !== 0 && app.mode === Mode.Setup) dragBoneRow(app, boneRow, bone);
    withMenu(app, boneRow, { bone }, boneMenu);
    skeleton.push(boneRow);
    if (!open) return;
    for (const [index, [slot, i]] of slots.entries()) {
      const slotBranches = [...branches, index < slots.length - 1 || kids.length > 0];
      const names = new Set(slot.attachments.map((a) => a.name));
      for (const skin of doc.activeSkins()) for (const a of doc.skinAttachments(i, skin)) names.add(a.name);
      const slotOpen = openSlots.has(slot.name);
      const slotTwisty = names.size
        ? h(
            'span',
            {
              class: 'twisty right',
              title: slotOpen ? t('Hide the attachments') : t('Show the attachments'),
              onclick: (e) => {
                e.stopPropagation();
                if (slotOpen) openSlots.delete(slot.name);
                else openSlots.add(slot.name);
                app.changed();
              },
            },
            chevron(slotOpen, slotOpen ? null : names.size),
          )
        : null;
      // Folded: the visible attachment's name follows the slot's.
      // (Not when it has the slot's own name, as most single-image slots do.)
      const shown = !slotOpen && pose.attachment[i] && pose.attachment[i] !== slot.name ? h('span', { class: 'slot-shown', title: t('Visible attachment') }, pose.attachment[i]) : null;
      const slotHidden = isSlotHidden(doc, i);
      const slotToggles = ['hidden', 'locked'].map((kind) =>
        viewToggle(kind, kind === 'hidden' ? slotHidden : isSlotLocked(doc, i), () => {
          toggleSlot(doc, kind, i);
          app.changed();
        }, false),
      );
      const tags = skinTags(doc, i, active);
      const slotRow = skeletonRow(label('layers', slot.name), { tut: `slot:${slot.name}`, cls: `slot${slotHidden ? ' view-hidden' : ''}`, selected: selSlot(app.sel) === i, onclick: select({ slot: i }), extra: [tags, shown, ...slotToggles, slotTwisty] }, slotBranches);
      slotRow.dataset.slot = String(i);
      if (app.mode === Mode.Setup) dragSlotRow(app, slotRow, i);
      withMenu(app, slotRow, { slot: i }, slotMenu);
      skeleton.push(slotRow);
      if (!slotOpen) continue;
      for (const [index, name] of [...names].entries()) {
        const visible = pose.attachment[i] === name;
        skeleton.push(
          skeletonRow(label('image', name, !visible), {
            cls: `attachment${visible ? ' visible' : ''}`,
            title: visible ? t('Visible attachment') : t('Click to show this attachment (keys it in Animate mode)'),
            onclick: () => {
              app.select({ slot: i });
              edit.setSlotAttachment(app, i, visible ? null : name);
            },
          }, [...slotBranches, index < names.size - 1]),
        );
      }
    }
    kids.forEach((child, index) => visit(child, [...branches, index < kids.length - 1]));
  };
  if (!keep || keep.has(0)) visit(0, []);
  const addBone = addButton(t('Bone'), { disabled: app.mode !== Mode.Setup, title: t('Add a child bone to the selected bone'), onclick: () => edit.addChildBone(app, selBone(app.sel) ?? 0) });
  const addPoint = addButton(t('Point'), {
    disabled: app.mode !== Mode.Setup,
    title: t('Add a point bone (a pivot or anchor) at the tip of the selected bone'),
    onclick: () => edit.addPointBone(app, selBone(app.sel) ?? 0),
  });

  // Fold every bone (the top level stays listed, e.g. each plant of a scene) or unfold them all.
  const foldAll = (fold) => () => {
    collapsed.delete('skeleton');
    for (const k of [...collapsed]) if (k.startsWith('bone:')) collapsed.delete(k);
    if (fold) doc.bones.forEach((_, i) => i !== 0 && collapsed.add(`bone:${i}`));
    app.changed();
  };
  const collapseAll = iconButton('chevrons-down-up', { size: 'sm', title: t('Collapse all bones'), onclick: foldAll(true) });
  const expandAll = iconButton('chevrons-up-down', { size: 'sm', title: t('Expand all bones'), onclick: foldAll(false) });

  // Draw order: front of the list is drawn on top.
  const n = doc.slots.length;
  const move = (from, to) => () => {
    doc.moveSlot(from, to);
    app.select({ slot: to });
  };
  const order = [];
  for (let i = n - 1; i >= 0; i--) {
    const slotRow = row(label('layers', doc.slots[i].name), { selected: selSlot(app.sel) === i, onclick: select({ slot: i }), title: t('Drag to reorder') });
    dragOrderRow(app, slotRow, i, n);
    order.push(
      h(
        'div',
        { class: 'order-row', 'data-slot': i },
        iconButton('chevron-up', { size: 'sm', disabled: i + 1 >= n, onclick: move(i, i + 1), title: t('Draw in front') }),
        iconButton('chevron-down', { size: 'sm', disabled: i === 0, onclick: move(i, i - 1), title: t('Draw behind') }),
        slotRow,
      ),
    );
  }
  const orderList = h('div', { class: 'order-list' }, ...order);

  const animations = doc.animations.map((a, i) =>
    row(label('play', a.name, app.anim !== i), {
      selected: app.anim === i,
      onclick: () => {
        app.anim = i;
        app.mode = Mode.Animate;
        app.time = 0;
        app.selectedKeys.clear();
        app.changed();
      },
    }),
  );

  const search = h('input', {
    type: 'search',
    class: 'tree-search',
    value: query,
    placeholder: t('Find a bone or slot'),
    'aria-label': t('Find a bone or slot'),
    spellcheck: false,
    // The tree is not rebuilt while typing in it, so the filter rebuilds it here and keeps the caret.
    oninput: (e) => {
      query = e.target.value;
      const caret = e.target.selectionStart;
      render(app, el);
      const next = el.querySelector('.tree-search');
      next?.focus();
      next?.setSelectionRange(caret, caret);
    },
    onkeydown: (e) => {
      e.stopPropagation();
      if (e.key === 'Escape' && query) {
        query = '';
        render(app, el);
        el.querySelector('.tree-search')?.focus();
      }
    },
  });
  const skeletonBody = [search, keep && !keep.size ? h('div', { class: 'small weak pad' }, t('No bone or slot matches “{query}”.', { query: query.trim() })) : null, ...skeleton];

  // The tree is rebuilt on every change: keep where the user had scrolled to.
  const scrolled = el.querySelector('.tree-scroll')?.scrollTop ?? 0;
  const focused = document.activeElement?.classList?.contains('tree-scroll') && el.contains(document.activeElement);
  el.replaceChildren(
    h('div', {
      class: 'tree-scroll scroll',
      tabindex: '0',
      'aria-label': t('Tree'),
      onkeydown: (e) => treeKeys(app, el, e),
      // A click on a row leaves the keyboard in the tree, so the arrow keys move from there.
      onpointerdown: (e) => {
        if (!e.target.closest('input, button, select, textarea')) e.currentTarget.focus({ preventScroll: true });
      },
    },
      has(app, 'scene') || doc.scene?.actors.length
        ? section(app, 'scene', t('Scene'), doc.scene?.actors.length ?? 0, doc.scene?.actors.length ? sceneRows(app, row) : [h('div', { class: 'small weak pad' }, t('Characters acting together: + Actor adds one (File ▸ New ▸ Scene starts a stage with a camera).'))], addButton(t('Actor'), { title: t('Add a character to the scene'), onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); addActorMenu(app, r.left, r.bottom); } }))
        : null,
      rootDropTarget(section(app, 'skeleton', doc.name || t('Skeleton'), doc.bones.length, skeletonBody, [collapseAll, expandAll, addBone, addPoint])),
      section(app, 'draworder', t('Draw order'), n, orderList),
      // With the Rig panel open (rigpanel.js), skins, constraints and events are listed there instead.
      app.rigPanel ? null : skinsSection(app),
      app.rigPanel ? null : constraintsSection(app),
      app.rigPanel ? null : eventsSection(app),
      section(app, 'animations', t('Animations'), doc.animations.length, animations),
      section(app, 'images', t('Images'), doc.images.length, doc.images.map((i) => row(label('image', i.name), { title: `${i.width}×${i.height}` }))),
    ),
  );
  const scroller = el.querySelector('.tree-scroll');
  scroller.scrollTop = scrolled;
  if (focused) scroller.focus({ preventScroll: true });
  // A new selection (from the viewport, the timeline, the keys) scrolls its row into view.
  if (revealing) scroller.querySelector('.tree-section .row.selected[data-bone], .tree-section .row.selected[data-slot]')?.scrollIntoView({ block: 'nearest' });
  // Keep hover alive across the rebuild and keep the callback pointing at this fresh DOM.
  treeRoot = el;
  app.onHoverChange = applyBoneHover;
  applyBoneHover(app.hoverBone);
}

// ---- skins, constraints and events ----------------------------------------------------------------
// Listed in the tree, or in the Rig panel when it is open (rigpanel.js builds on these).

/** Skins: the active one shows the dot; clicking one makes it active and shows its settings. */
export function skinsSection(app) {
  const doc = app.doc;
  // A click makes a skin the active one; Ctrl+click (or its + button) also shows it on top of the
  // active skin, to preview a combination (an outfit, a hat and a weapon). Later ones win.
  const extra = doc.extraSkins;
  const toggleExtra = (name) => {
    doc.extraSkins = extra.includes(name) ? extra.filter((n) => n !== name) : [...extra, name];
    app.changed();
  };
  const pickSkin = (name) => (e) => {
    if (name !== 'default' && (e.ctrlKey || e.metaKey) && doc.skin !== name) return toggleExtra(name);
    doc.skin = name === 'default' ? null : name;
    doc.extraSkins = extra.filter((n) => n !== doc.skin);
    app.sel = { skin: name };
    app.multi.clear();
    app.changed();
  };
  const combineButton = (name) =>
    doc.skin === name
      ? null
      : h(
          'button',
          {
            class: `skin-combine${extra.includes(name) ? ' on' : ''}`,
            title: extra.includes(name) ? t('Stop showing this skin on top') : t('Show this skin on top of the active one (Ctrl+click)'),
            'aria-pressed': extra.includes(name) ? 'true' : 'false',
            onclick: (e) => {
              e.stopPropagation();
              toggleExtra(name);
            },
          },
          uiIcon('circle-plus', 'sm'),
        );
  const skinIcon = (name) => (doc.skin === name ? 'circle-dot' : extra.includes(name) ? 'circle-plus' : 'circle');
  const skins = [
    row(h('span', { class: 'skin-pick' }, uiIcon(doc.skin ? 'circle' : 'circle-dot', 'sm'), t('default')), { selected: app.sel?.skin === 'default', onclick: pickSkin('default') }),
    ...doc.skins.map((s) =>
      row(h('span', { class: 'skin-pick' }, uiIcon(skinIcon(s.name), 'sm'), s.name), {
        selected: app.sel?.skin === s.name,
        cls: extra.includes(s.name) ? 'skin-combined' : '',
        onclick: pickSkin(s.name),
        extra: [combineButton(s.name)],
      }),
    ),
    extra.length ? h('div', { class: 'small weak pad skin-combo-note' }, t('Previewing {skins} together. Renders and exports use one skin at a time.', { skins: doc.activeSkins().join(' + ') })) : null,
  ];
  const newSkin = addButton(t('New'), { disabled: app.mode !== Mode.Setup, title: t('New skin (becomes active)'), onclick: () => createSkin(app) });
  return section(app, 'skins', t('Skins'), doc.skins.length + 1, skins, newSkin);
}

/** Events: click one to edit it. */
export function eventsSection(app) {
  const doc = app.doc;
  const events = doc.events.map((e) =>
    row(`⚑ ${e.name}`, {
      selected: app.sel?.event === e.name,
      onclick: () => {
        app.sel = { event: e.name };
        app.multi.clear();
        app.changed();
      },
    }),
  );
  const newEvent = addButton(t('New'), { disabled: app.mode !== Mode.Setup, title: t('New event'), onclick: () => createEvent(app) });
  return section(app, 'events', t('Events'), doc.events.length, events, newEvent);
}

const CONSTRAINT_ICONS = { ik: 'link', transform: 'arrow-left-right', path: 'spline', physics: 'waves', slider: 'move-horizontal' };

/** A row for a constraint; click to edit its settings. */
function constraintRow(app, c, depth = 0) {
  const known = c.type in CONSTRAINT_LABELS;
  return row(label(CONSTRAINT_ICONS[c.type] ?? 'link', c.name, !known), {
    depth,
    cls: known ? '' : 'weak',
    selected: app.sel?.constraint === c.name,
    title: known ? t('{type} constraint', { type: t(CONSTRAINT_LABELS[c.type]) }) : t('{type} constraint (kept, not evaluated)', { type: c.type }),
    onclick: () => {
      app.sel = { constraint: c.name };
      app.multi.clear();
      app.changed();
    },
  });
}

/** Makes a constraint of `type` from the selected bones and selects it. */
export function newConstraint(app, type) {
  const label = CONSTRAINT_LABELS[type];
  // Transform: the selected bones follow a driver, the last one selected, or picked next.
  if (type === 'transform') {
    const bones = app.selectedBones();
    if (!bones.length) return app.setStatus(statusMessage('Select the bones that should follow (Ctrl+click for several), then add the constraint'));
    const finish = (driven, driver) => {
      const names = createTransform(app, driven, driver);
      if (!names.length) return app.setStatus(statusMessage('A bone cannot drive itself'));
      app.sel = { constraint: names[0] };
      app.multi.clear();
      app.setStatus(statusMessage('{driven} now follow(s) {driver}. Nothing moved: offsets keep the current pose.', { driven: driven.filter((b) => b !== driver).map((b) => app.doc.bones[b].name).join(', '), driver: app.doc.bones[driver].name }));
    };
    if (bones.length === 1) return app.startPick(tn('Click the bone that drives {bone}'), (driver) => finish(bones, driver), { bone: app.doc.bones[bones[0]].name });
    return finish(bones.slice(0, -1), bones.at(-1));
  }
  const result = createConstraint(app, type);
  if (result.startsWith('!')) app.setStatus(() => t(result).slice(1));
  else {
    app.sel = { constraint: result };
    app.multi.clear();
    app.setStatus(joinStatus(
      statusMessage("Created {type} constraint '{name}'", { type: statusMessage(label), name: result }),
      type === 'physics' ? joinStatus('. ', statusMessage(PHYSICS_HINT)) : '',
    ));
  }
  app.changed();
}

/**
 * Constraints in application order. `byType` (the Rig panel) groups them under each constraint type,
 * each with its own add button; otherwise one list with an add menu.
 */
export function constraintsSection(app, { byType = false } = {}) {
  const list = listConstraints(app.doc);
  const setup = app.mode === Mode.Setup;
  if (byType) {
    const groups = Object.entries(CONSTRAINT_LABELS).map(([type, label]) => {
      const of = list.filter((c) => c.type === type);
      return h(
        'div',
        { class: 'tree-subsection' },
        h(
          'div',
          { class: 'tree-subheading' },
          h('span', null, t(label)),
          h('span', { class: 'count' }, String(of.length)),
          h('span', { class: 'actions' }, addButton(t('New'), { disabled: !setup, title: t('New {type} constraint from the selected bones', { type: t(label) }), onclick: () => newConstraint(app, type) })),
        ),
        of.map((c) => constraintRow(app, c, 1)),
      );
    });
    const other = list.filter((c) => !(c.type in CONSTRAINT_LABELS)).map((c) => constraintRow(app, c));
    return section(app, 'constraints', t('Constraints'), list.length, [...groups, ...other]);
  }
  const add = addButton(t('New'), {
    disabled: !setup,
    title: t('New constraint from the selected bones'),
    onclick: (e) => {
      const r = e.target.getBoundingClientRect();
      popupMenu(
        r.left,
        r.bottom,
        Object.entries(CONSTRAINT_LABELS).map(([type, label]) => ({ label: t('{type} constraint', { type: t(label) }), action: () => newConstraint(app, type) })),
      );
    },
  });
  return section(app, 'constraints', t('Constraints'), list.length, list.map((c) => constraintRow(app, c)), add);
}
