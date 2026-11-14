// SPDX-License-Identifier: MIT OR Apache-2.0
// Tree panel: the skeleton (bones, slots and their attachments) plus draw order, skins,
// constraints, events, animations and images, in collapsible sections.

import { listConstraints } from '../core/constraintdata.js';
import { Mode, selBone, selSlot } from './app.js';
import { CONSTRAINT_LABELS, PHYSICS_HINT, createConstraint, createTransform } from './constraintui.js';
import { dragBoneRow, rootDropTarget } from './bonednd.js';
import { dragOrderRow } from './draworderdnd.js';
import { treeMatches } from './treefind.js';
import * as edit from './edit.js';
import { onionBonePanel, rgbCss } from './onionui.js';
import { createEvent, createSkin } from './skineventui.js';
import { h, popupMenu } from './widgets.js';
import { button, iconButton, uiIcon } from './ui.js';
import { has } from './workspaces.js';
import { addActorMenu, sceneRows } from './sceneui.js';
import { t } from './i18n.js';

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
  const visit = (bone, depth) => {
    if (keep && !keep.has(bone)) return;
    const kids = childrenOf.get(bone) ?? [];
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
    const boneRow = row(label(doc.bones[bone].length > 0 ? 'bone' : 'crosshair', doc.bones[bone].name), {
      tut: `bone:${doc.bones[bone].name}`,
      depth,
      cls: q && named(doc.bones[bone]) ? 'match' : '',
      selected: selected.has(bone),
      // Picking a bone for a field: a click on its row answers it.
      onclick: (e) => (app.pick ? app.finishPick(bone) : select({ bone })(e)),
      extra: [marks, onionBtn, twisty],
      bone,
    });
    if (bone !== 0 && app.mode === Mode.Setup) dragBoneRow(app, boneRow, bone);
    skeleton.push(boneRow);
    if (!open) return;
    for (const [slot, i] of slots) {
      const names = new Set(slot.attachments.map((a) => a.name));
      if (doc.skin) for (const a of doc.skinAttachments(i, doc.skin)) names.add(a.name);
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
      const slotRow = row(label('layers', slot.name), { tut: `slot:${slot.name}`, depth: depth + 1, cls: 'slot', selected: selSlot(app.sel) === i, onclick: select({ slot: i }), extra: [shown, slotTwisty] });
      slotRow.dataset.slot = String(i);
      skeleton.push(slotRow);
      if (!slotOpen) continue;
      for (const name of names) {
        const visible = pose.attachment[i] === name;
        skeleton.push(
          row(label('image', name, !visible), {
            depth: depth + 2,
            cls: `attachment${visible ? ' visible' : ''}`,
            title: visible ? t('Visible attachment') : t('Click to show this attachment (keys it in Animate mode)'),
            onclick: () => {
              app.select({ slot: i });
              edit.setSlotAttachment(app, i, visible ? null : name);
            },
          }),
        );
      }
    }
    for (const c of kids) visit(c, depth + 1);
  };
  visit(0, 0);
  const addBone = addButton(t('Bone'), { disabled: app.mode !== Mode.Setup, title: t('Add a child bone to the selected bone'), onclick: () => edit.addChildBone(app, selBone(app.sel) ?? 0) });
  const addPoint = addButton(t('Point'), {
    disabled: app.mode !== Mode.Setup,
    title: t('Add a point bone (a pivot or anchor) at the tip of the selected bone'),
    onclick: () => edit.addPointBone(app, selBone(app.sel) ?? 0),
  });

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
      rootDropTarget(section(app, 'skeleton', doc.name || t('Skeleton'), doc.bones.length, skeletonBody, [addBone, addPoint])),
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
  const pickSkin = (name) => () => {
    doc.skin = name === 'default' ? null : name;
    app.sel = { skin: name };
    app.multi.clear();
    app.changed();
  };
  const skins = [
    row(h('span', { class: 'skin-pick' }, uiIcon(doc.skin ? 'circle' : 'circle-dot', 'sm'), t('default')), { selected: app.sel?.skin === 'default', onclick: pickSkin('default') }),
    ...doc.skins.map((s) => row(h('span', { class: 'skin-pick' }, uiIcon(doc.skin === s.name ? 'circle-dot' : 'circle', 'sm'), s.name), { selected: app.sel?.skin === s.name, onclick: pickSkin(s.name) })),
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
    if (!bones.length) return app.setStatus(t('Select the bones that should follow (Ctrl+click for several), then add the constraint'));
    const finish = (driven, driver) => {
      const names = createTransform(app, driven, driver);
      if (!names.length) return app.setStatus(t('A bone cannot drive itself'));
      app.sel = { constraint: names[0] };
      app.multi.clear();
      app.setStatus(t('{driven} now follow(s) {driver}. Nothing moved: offsets keep the current pose.', { driven: driven.filter((b) => b !== driver).map((b) => app.doc.bones[b].name).join(', '), driver: app.doc.bones[driver].name }));
    };
    if (bones.length === 1) return app.startPick(t('Click the bone that drives {bone}', { bone: app.doc.bones[bones[0]].name }), (driver) => finish(bones, driver));
    return finish(bones.slice(0, -1), bones.at(-1));
  }
  const result = createConstraint(app, type);
  if (result.startsWith('!')) app.setStatus(result.slice(1));
  else {
    app.sel = { constraint: result };
    app.multi.clear();
    app.setStatus(t("Created {type} constraint '{name}'", { type: t(label), name: result }) + (type === 'physics' ? `. ${t(PHYSICS_HINT)}` : ''));
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
