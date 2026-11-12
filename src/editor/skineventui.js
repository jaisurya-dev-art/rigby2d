// SPDX-License-Identifier: MIT OR Apache-2.0
// Skin and event authoring: creating, renaming and deleting skins and events, skin bones and
// constraints, and event keys with their values.

import { listConstraints } from '../core/constraintdata.js';
import { FPS, Mode } from './app.js';
import { dragValue, h, textField } from './widgets.js';
import { button } from './ui.js';
import { t } from './i18n.js';

const row = (label, ...content) => [h('label', null, label), h('div', { class: 'cell' }, ...content)];

function uniqueIn(names, base) {
  if (!names.includes(base)) return base;
  for (let n = 2; ; n++) if (!names.includes(`${base}${n}`)) return `${base}${n}`;
}

const clone = (v) => JSON.parse(JSON.stringify(v));

// ---- skins -----------------------------------------------------------------------------------

export function createSkin(app, from = null) {
  const doc = app.doc;
  const name = uniqueIn(['default', ...doc.skins.map((s) => s.name)], from ? `${from.name}-copy` : 'skin');
  const skin = from ? { ...clone(from), name } : { name, slots: [], bones: [], ik: [], color: null, extra: {} };
  doc.skins.push(skin);
  doc.skin = name;
  app.sel = { skin: name };
  app.setStatus(t("Skin '{name}' created and active: images added to slots now go into it", { name }));
  app.changed();
}

function renameSkin(app, skin, to) {
  const doc = app.doc;
  if (!to || to === 'default' || doc.skins.some((s) => s.name === to)) return;
  const from = skin.name;
  skin.name = to;
  if (doc.skin === from) doc.skin = to;
  for (const a of doc.animations) {
    for (const d of a.deform) if (d.skin === from) d.skin = to;
    const atts = a.extra?.attachments;
    if (atts?.[from] !== undefined) {
      atts[to] = atts[from];
      delete atts[from];
    }
  }
  // Linked meshes can name the skin of their parent mesh.
  for (const list of [...doc.slots.map((s) => s.attachments), ...doc.skins.flatMap((k) => k.slots.map((e) => e.attachments))]) {
    for (const att of list) if (att.type === 'linkedmesh' && att.skin === from) att.skin = to;
  }
  app.sel = { skin: to };
  app.changed();
}

function deleteSkin(app, skin) {
  const doc = app.doc;
  doc.skins.splice(doc.skins.indexOf(skin), 1);
  if (doc.skin === skin.name) doc.skin = null;
  for (const a of doc.animations) {
    a.deform = a.deform.filter((d) => d.skin !== skin.name);
    if (a.extra?.attachments) delete a.extra.attachments[skin.name];
  }
  app.sel = null;
  app.changed();
}

/** Names of the skin's non-IK constraints (4.3 list, or the older per-type lists). */
function skinConstraintNames(skin) {
  const e = skin.extra ?? {};
  return new Set([e.constraints, e.transform, e.path, e.physics].filter(Array.isArray).flat());
}

export function skinUi(app, name) {
  const doc = app.doc;
  if (name === 'default') {
    return [
      h('h2', null, t('Skin: default')),
      h('div', { class: 'small weak' }, t('Attachments added while the default skin is active belong to every skin.')),
      h('div', { class: 'buttons' }, button(t('New skin'), { icon: 'plus', onclick: () => createSkin(app) })),
    ];
  }
  const skin = doc.skins.find((s) => s.name === name);
  if (!skin) return [h('p', { class: 'weak' }, t('Skin not found.'))];
  const setupMode = app.mode === Mode.Setup;
  const attachments = skin.slots.reduce((n, e) => n + e.attachments.length, 0);
  const names = skinConstraintNames(skin);
  const constraints = listConstraints(doc).filter((c) => (c.type === 'ik' ? doc.ik[c.ik].skinRequired : c.data.skin));
  const member = (c) => (c.type === 'ik' ? skin.ik.includes(c.ik) : names.has(c.name));
  const toggle = (c, on) => {
    if (c.type === 'ik') {
      skin.ik = on ? [...new Set([...skin.ik, c.ik])] : skin.ik.filter((i) => i !== c.ik);
    } else {
      skin.extra ??= {};
      const key = c.legacy ?? 'constraints';
      const list = (skin.extra[key] ??= []);
      if (on && !list.includes(c.name)) list.push(c.name);
      if (!on) skin.extra[key] = list.filter((n) => n !== c.name);
    }
    app.changed();
  };
  return [
    h('h2', null, t('Skin: {name}', { name: skin.name })),
    h(
      'div',
      { class: 'grid' },
      row(t('Name'), textField(skin.name, (v) => renameSkin(app, skin, v.trim()), { disabled: !setupMode })),
      row(
        t('Active'),
        h('button', { class: doc.skin === skin.name ? 'active' : '', onclick: () => ((doc.skin = skin.name), app.changed()) }, doc.skin === skin.name ? t('Active') : t('Make active')),
      ),
      row(t('Attachments'), String(attachments)),
      row(
        t('Bones'),
        h('span', null, skin.bones.map((b) => doc.bones[b]?.name).join(', ') || '(none)'),
        h(
          'button',
          {
            class: 'small',
            disabled: !setupMode,
            title: t('Bones marked "skin required" that this skin turns on'),
            onclick: () => {
              skin.bones = app.selectedBones();
              app.changed();
            },
          },
          t('Use selected'),
        ),
      ),
    ),
    h('strong', null, t('Attachments by slot')),
    skin.slots.length
      ? h(
          'table',
          { class: 'props' },
          skin.slots
            .slice()
            .sort((a, b) => b.slot - a.slot)
            .flatMap((entry) =>
              entry.attachments.map((att, i) =>
                h(
                  'tr',
                  null,
                  h(
                    'td',
                    null,
                    h(
                      'a',
                      {
                        href: '#',
                        title: t('Select the slot'),
                        onclick: (e) => {
                          e.preventDefault();
                          doc.skin = skin.name;
                          app.sel = { slot: entry.slot };
                          app.changed();
                        },
                      },
                      doc.slots[entry.slot]?.name ?? '?',
                    ),
                  ),
                  h('td', null, `${att.name}${att.type && att.type !== 'region' ? ` (${att.type})` : ''}`),
                  h(
                    'td',
                    null,
                    setupMode
                      ? h(
                          'button',
                          {
                            class: 'small',
                            title: t('Remove from this skin'),
                            onclick: () => {
                              entry.attachments.splice(i, 1);
                              skin.slots = skin.slots.filter((e) => e.attachments.length);
                              app.changed();
                            },
                          },
                          '✕',
                        )
                      : null,
                  ),
                ),
              ),
            ),
        )
      : h('div', { class: 'small weak' }, t('Make this skin active, select a slot and add images or shapes: they go into this skin.')),
    h('strong', null, t('Constraints')),
    constraints.length
      ? constraints.map((c) =>
          h('label', { class: 'check' }, h('input', { type: 'checkbox', disabled: !setupMode, checked: member(c), onchange: (e) => toggle(c, e.target.checked) }), ` ${c.name}`),
        )
      : h('div', { class: 'small weak' }, t('Constraints marked "skin required" can be added to this skin.')),
    h(
      'div',
      { class: 'buttons' },
      h('button', { disabled: !setupMode, onclick: () => createSkin(app, skin) }, t('Duplicate')),
      button(t('Delete skin'), { kind: 'danger', icon: 'trash-2', disabled: !setupMode, onclick: () => deleteSkin(app, skin) }),
    ),
  ];
}

// ---- events ----------------------------------------------------------------------------------

export function createEvent(app) {
  const doc = app.doc;
  const name = uniqueIn(doc.events.map((e) => e.name), 'event');
  doc.events.push({ name, int: 0, float: 0, string: null, audio: null, volume: 1, balance: 0 });
  app.sel = { event: name };
  app.changed();
}

function renameEvent(app, ev, to) {
  const doc = app.doc;
  if (!to || doc.events.some((e) => e.name === to)) return;
  for (const a of doc.animations) for (const k of a.events) if (k.name === ev.name) k.name = to;
  ev.name = to;
  app.sel = { event: to };
  app.changed();
}

function deleteEvent(app, ev) {
  const doc = app.doc;
  doc.events.splice(doc.events.indexOf(ev), 1);
  for (const a of doc.animations) a.events = a.events.filter((k) => k.name !== ev.name);
  app.sel = null;
  app.changed();
}

/** Adds (or replaces) a key of the event at the current time of the current animation. */
function keyEvent(app, ev) {
  const anim = app.currentAnimation();
  if (!anim) return app.setStatus(t('Choose an animation first'));
  const time = Math.round(app.time * FPS) / FPS;
  anim.events = anim.events.filter((k) => !(k.name === ev.name && Math.abs(k.time - time) < 1e-4));
  anim.events.push({ time, name: ev.name });
  anim.events.sort((x, y) => x.time - y.time);
  if (anim.duration < time) anim.duration = time;
  app.setStatus(t("Keyed event '{name}' at frame {frame}", { name: ev.name, frame: Math.round(time * FPS) }));
  app.changed();
}

export function eventUi(app, name) {
  const doc = app.doc;
  const ev = doc.events.find((e) => e.name === name);
  if (!ev) return [h('p', { class: 'weak' }, t('Event not found.'))];
  const setupMode = app.mode === Mode.Setup;
  const set = (key, v) => {
    ev[key] = v;
    app.changed();
  };
  const anim = app.currentAnimation();
  const keys = anim ? anim.events.filter((k) => k.name === ev.name) : [];
  const keyRow = (k) => {
    const setK = (key, v, def) => {
      if (v === def || v === '' || v === null) delete k[key];
      else k[key] = v;
      app.changed();
    };
    return h(
      'tr',
      null,
      h('td', null, `${Math.round(k.time * FPS)}`),
      h('td', null, dragValue(k.int ?? ev.int ?? 0, (v) => setK('int', Math.round(v), ev.int ?? 0), { speed: 0.2, decimals: 0 })),
      h('td', null, dragValue(k.float ?? ev.float ?? 0, (v) => setK('float', v, ev.float ?? 0), { speed: 0.01, decimals: 3 })),
      h('td', null, textField(k.string ?? ev.string ?? '', (v) => setK('string', v, ev.string ?? ''))),
      h(
        'td',
        null,
        h(
          'button',
          {
            class: 'small',
            title: t('Delete this key'),
            onclick: () => {
              anim.events.splice(anim.events.indexOf(k), 1);
              app.changed();
            },
          },
          '✕',
        ),
      ),
    );
  };
  return [
    h('h2', null, t('Event: {name}', { name: ev.name })),
    h(
      'div',
      { class: 'grid' },
      row(t('Name'), textField(ev.name, (v) => renameEvent(app, ev, v.trim()), { disabled: !setupMode })),
      row(t('Int'), dragValue(ev.int ?? 0, (v) => set('int', Math.round(v)), { speed: 0.2, decimals: 0, disabled: !setupMode })),
      row(t('Float'), dragValue(ev.float ?? 0, (v) => set('float', v), { speed: 0.01, decimals: 3, disabled: !setupMode })),
      row(t('String'), textField(ev.string ?? '', (v) => set('string', v || null), { disabled: !setupMode })),
      row(t('Audio'), textField(ev.audio ?? '', (v) => set('audio', v || null), { disabled: !setupMode })),
      ev.audio
        ? [
            row(t('Volume'), dragValue(ev.volume ?? 1, (v) => set('volume', v), { speed: 0.01, min: 0, max: 1, decimals: 2, disabled: !setupMode })),
            row(t('Balance'), dragValue(ev.balance ?? 0, (v) => set('balance', v), { speed: 0.01, min: -1, max: 1, decimals: 2, disabled: !setupMode })),
          ]
        : null,
    ),
    h('hr'),
    h('strong', null, anim ? t("Keys in '{name}'", { name: anim.name }) : t('Keys')),
    anim
      ? [
          h(
            'div',
            { class: 'buttons' },
            button(t('Key at frame {frame}', { frame: Math.round(app.time * FPS) }), { icon: 'flag', disabled: app.mode !== Mode.Animate, title: t('Switch to Animate mode to key events'), onclick: () => keyEvent(app, ev) }),
          ),
          keys.length
            ? h('table', { class: 'props' }, h('tr', null, h('th', null, t('Frame')), h('th', null, t('Int')), h('th', null, t('Float')), h('th', null, t('String')), h('th', null, '')), keys.map(keyRow))
            : h('div', { class: 'small weak' }, t('No keys yet. Each key can override the values above.')),
        ]
      : h('div', { class: 'small weak' }, t('Choose an animation to key this event.')),
    h('div', { class: 'buttons' }, button(t('Delete event'), { kind: 'danger', icon: 'trash-2', disabled: !setupMode, onclick: () => deleteEvent(app, ev) })),
  ];
}
