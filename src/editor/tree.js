// SPDX-License-Identifier: MIT OR Apache-2.0
// Tree panel: the skeleton (bones, slots and their attachments) plus draw order, skins,
// constraints, events, animations and images, in collapsible sections.

import { listConstraints } from '../core/constraintdata.js';
import { Mode, selBone, selSlot } from './app.js';
import { CONSTRAINT_LABELS, PHYSICS_HINT, createConstraint } from './constraintui.js';
import { dragOrderRow } from './draworderdnd.js';
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

export function render(app, el) {
  treeApp = app;
  const doc = app.doc;
  const selected = new Set(app.selectedBones());
  const select = (item) => (e) => app.select(item, e.ctrlKey || e.metaKey);
  const pose = app.pose();

  // Skeleton: bones nested by parent, each bone's slots, each slot's attachments.
  const skeleton = [];
  const visit = (bone, depth) => {
    const kids = doc.children(bone);
    const slots = doc.slots.map((s, i) => [s, i]).filter(([s]) => s.bone === bone);
    const key = `bone:${bone}`;
    const hasChildren = kids.length || slots.length;
    const open = !collapsed.has(key);
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
    skeleton.push(
      row(label(doc.bones[bone].length > 0 ? 'bone' : 'crosshair', doc.bones[bone].name), {
        tut: `bone:${doc.bones[bone].name}`,
        depth,
        selected: selected.has(bone),
        onclick: select({ bone }),
        extra: [marks, onionBtn, twisty],
        bone,
      }),
    );
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
      skeleton.push(row(label('layers', slot.name), { tut: `slot:${slot.name}`, depth: depth + 1, cls: 'slot', selected: selSlot(app.sel) === i, onclick: select({ slot: i }), extra: [shown, slotTwisty] }));
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

  // The tree is rebuilt on every change: keep where the user had scrolled to.
  const scrolled = el.querySelector('.tree-scroll')?.scrollTop ?? 0;
  el.replaceChildren(
    h('div', { class: 'tree-scroll scroll' },
      has(app, 'scene') || doc.scene?.actors.length
        ? section(app, 'scene', t('Scene'), doc.scene?.actors.length ?? 0, doc.scene?.actors.length ? sceneRows(app, row) : [h('div', { class: 'small weak pad' }, t('Characters acting together: + Actor adds one (File ▸ New ▸ Scene starts a stage with a camera).'))], addButton(t('Actor'), { title: t('Add a character to the scene'), onclick: (e) => { const r = e.currentTarget.getBoundingClientRect(); addActorMenu(app, r.left, r.bottom); } }))
        : null,
      section(app, 'skeleton', doc.name || t('Skeleton'), doc.bones.length, skeleton, [addBone, addPoint]),
      section(app, 'draworder', t('Draw order'), n, orderList),
      // With the Rig panel open (rigpanel.js), skins, constraints and events are listed there instead.
      app.rigPanel ? null : skinsSection(app),
      app.rigPanel ? null : constraintsSection(app),
      app.rigPanel ? null : eventsSection(app),
      section(app, 'animations', t('Animations'), doc.animations.length, animations),
      section(app, 'images', t('Images'), doc.images.length, doc.images.map((i) => row(label('image', i.name), { title: `${i.width}×${i.height}` }))),
    ),
  );
  el.querySelector('.tree-scroll').scrollTop = scrolled;
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
    row(`${doc.skin ? '○' : '●'} ${t('default')}`, { selected: app.sel?.skin === 'default', onclick: pickSkin('default') }),
    ...doc.skins.map((s) => row(`${doc.skin === s.name ? '●' : '○'} ${s.name}`, { selected: app.sel?.skin === s.name, onclick: pickSkin(s.name) })),
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
