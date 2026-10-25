// SPDX-License-Identifier: MIT OR Apache-2.0
// Tree panel: the skeleton (bones, slots and their attachments) plus draw order, skins,
// constraints, events, animations and images, in collapsible sections.

import { listConstraints } from '../core/constraintdata.js';
import { Mode, selBone, selSlot } from './app.js';
import { CONSTRAINT_LABELS, createConstraint } from './constraintui.js';
import * as edit from './edit.js';
import { onionBonePanel, rgbCss } from './onionui.js';
import { createEvent, createSkin } from './skineventui.js';
import { h, popupMenu } from './widgets.js';

/** Collapsed sections and bones (kept for the session). */
const collapsed = new Set(['images', 'events']);

function section(app, id, title, count, children, actions = null) {
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
      h('span', { class: 'twisty' }, open ? '▾' : '▸'),
      h('span', null, title),
      count !== null ? h('span', { class: 'count' }, String(count)) : null,
      actions ? h('span', { class: 'actions', onclick: (e) => e.stopPropagation() }, actions) : null,
    ),
    open ? children : null,
  );
}

function row(label, { depth = 0, selected = false, cls = '', onclick, extra = null, title, tut = null } = {}) {
  return h(
    'div',
    { class: `row${selected ? ' selected' : ''}${cls ? ` ${cls}` : ''}`, 'data-tut': tut, style: { paddingLeft: `${depth * 14 + 4}px` }, onclick, title },
    label,
    extra,
  );
}

export function render(app, el) {
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
            title: open ? 'Collapse' : 'Expand',
            onclick: (e) => {
              e.stopPropagation();
              if (open) collapsed.add(key);
              else collapsed.delete(key);
              app.changed();
            },
          },
          open ? '▾' : '▸',
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
            oc.past > 0 ? h('span', { class: 'onion-mark', title: `Showing ${oc.past} past frame(s)`, style: { color: rgbCss(oc.pastColor) } }, '◀') : null,
            oc.future > 0 ? h('span', { class: 'onion-mark', title: `Showing ${oc.future} future frame(s)`, style: { color: rgbCss(oc.futureColor) } }, '▶') : null,
          )
        : null;
    const onionBtn = animate
      ? h(
          'span',
          {
            class: `onion-bonebtn${direct ? ' on' : ''}`,
            title: 'Configure onion skin for this bone (past / future, color)',
            onclick: (e) => {
              e.stopPropagation();
              const r = e.target.getBoundingClientRect();
              onionBonePanel(app, bone, r.left, r.bottom);
            },
          },
          '◍',
        )
      : null;
    skeleton.push(
      row(`🦴 ${doc.bones[bone].name}`, {
        tut: `bone:${doc.bones[bone].name}`,
        depth,
        selected: selected.has(bone),
        onclick: select({ bone }),
        extra: [marks, onionBtn, twisty],
      }),
    );
    if (!open) return;
    for (const [slot, i] of slots) {
      skeleton.push(row(`▣ ${slot.name}`, { tut: `slot:${slot.name}`, depth: depth + 1, cls: 'slot', selected: selSlot(app.sel) === i, onclick: select({ slot: i }) }));
      const names = new Set(slot.attachments.map((a) => a.name));
      if (doc.skin) for (const a of doc.skinAttachments(i, doc.skin)) names.add(a.name);
      for (const name of names) {
        const visible = pose.attachment[i] === name;
        skeleton.push(
          row(`${visible ? '📎' : '·'} ${name}`, {
            depth: depth + 2,
            cls: `attachment${visible ? ' visible' : ''}`,
            title: visible ? 'Visible attachment' : 'Click to show this attachment (keys it in Animate mode)',
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
  const addBone = h(
    'button',
    { class: 'small', disabled: app.mode !== Mode.Setup, title: 'Add a child bone to the selected bone', onclick: () => edit.addChildBone(app, selBone(app.sel) ?? 0) },
    '＋ Bone',
  );

  // Draw order: front of the list is drawn on top.
  const n = doc.slots.length;
  const move = (from, to) => () => {
    doc.moveSlot(from, to);
    app.select({ slot: to });
  };
  const order = [];
  for (let i = n - 1; i >= 0; i--) {
    order.push(
      h(
        'div',
        { class: 'order-row' },
        h('button', { class: 'small', disabled: i + 1 >= n, onclick: move(i, i + 1), title: 'Draw in front' }, '▲'),
        h('button', { class: 'small', disabled: i === 0, onclick: move(i, i - 1), title: 'Draw behind' }, '▼'),
        row(`▣ ${doc.slots[i].name}`, { selected: selSlot(app.sel) === i, onclick: select({ slot: i }) }),
      ),
    );
  }

  // Skins: the active one shows the dot.
  // Clicking a skin makes it active and shows its settings.
  const pickSkin = (name) => () => {
    doc.skin = name === 'default' ? null : name;
    app.sel = { skin: name };
    app.multi.clear();
    app.changed();
  };
  const skins = [
    row(`${doc.skin ? '○' : '●'} default`, { selected: app.sel?.skin === 'default', onclick: pickSkin('default') }),
    ...doc.skins.map((s) => row(`${doc.skin === s.name ? '●' : '○'} ${s.name}`, { selected: app.sel?.skin === s.name, onclick: pickSkin(s.name) })),
  ];
  const setupOnly = app.mode !== Mode.Setup;
  const newSkin = h('button', { class: 'small', disabled: setupOnly, title: 'New skin (becomes active)', onclick: () => createSkin(app) }, '＋ New');
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
  const newEvent = h('button', { class: 'small', disabled: setupOnly, title: 'New event', onclick: () => createEvent(app) }, '＋ New');

  // Constraints in application order; click to edit their settings.
  const CONSTRAINT_ICONS = { ik: '⊸', transform: '⇄', path: '∿', physics: '≋', slider: '⇥' };
  const constraints = listConstraints(doc).map((c) => {
    const known = c.type in CONSTRAINT_LABELS;
    return row(`${CONSTRAINT_ICONS[c.type] ?? '⊸'} ${c.name}`, {
      cls: known ? '' : 'weak',
      selected: app.sel?.constraint === c.name,
      title: known ? `${CONSTRAINT_LABELS[c.type]} constraint` : `${c.type} constraint (kept, not evaluated)`,
      onclick: () => {
        app.sel = { constraint: c.name };
        app.multi.clear();
        app.changed();
      },
    });
  });
  const newConstraint = h(
    'button',
    {
      class: 'small',
      disabled: app.mode !== Mode.Setup,
      title: 'New constraint from the selected bones',
      onclick: (e) => {
        const r = e.target.getBoundingClientRect();
        popupMenu(
          r.left,
          r.bottom,
          Object.entries(CONSTRAINT_LABELS).map(([type, label]) => ({
            label: `${label} constraint`,
            action: () => {
              const result = createConstraint(app, type);
              if (result.startsWith('!')) app.setStatus(result.slice(1));
              else {
                app.sel = { constraint: result };
                app.multi.clear();
                app.setStatus(`Created ${label} constraint '${result}'`);
              }
              app.changed();
            },
          })),
        );
      },
    },
    '＋ New',
  );

  const animations = doc.animations.map((a, i) =>
    row(`${app.anim === i ? '▶' : '·'} ${a.name}`, {
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
      section(app, 'skeleton', doc.name || 'Skeleton', doc.bones.length, skeleton, addBone),
      section(app, 'draworder', 'Draw order', n, order),
      section(app, 'skins', 'Skins', doc.skins.length + 1, skins, newSkin),
      section(app, 'constraints', 'Constraints', constraints.length, constraints, newConstraint),
      section(app, 'events', 'Events', doc.events.length, events, newEvent),
      section(app, 'animations', 'Animations', doc.animations.length, animations),
      section(app, 'images', 'Images', doc.images.length, doc.images.map((i) => row(`🖼 ${i.name}`, { title: `${i.width}×${i.height}` }))),
    ),
  );
  el.querySelector('.tree-scroll').scrollTop = scrolled;
}
