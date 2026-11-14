// SPDX-License-Identifier: MIT OR Apache-2.0
// Constraint authoring: creating IK, transform, path, physics and slider constraints from the
// selection, and the properties panel with every setting of each type.

import {
  addConstraint,
  addIk,
  listConstraints,
  moveConstraint,
  removeConstraint,
  renameConstraint,
  uniqueConstraintName,
} from '../core/constraintdata.js';
import { channelKeys, constraintChannels, setConstraintKey, setIkKey } from '../core/constraintkeys.js';
import { identityTransform } from '../core/math.js';
import { makeBone, makeSlot, uniqueName } from '../core/model.js';
import { Pose } from '../core/pose.js';
import { FPS, Mode } from './app.js';
import { keepPoseOffsets } from './constraintoffsets.js';
import { dragValue, h, select, textField } from './widgets.js';
import { button, iconButton, uiIcon } from './ui.js';
import { t, tn } from './i18n.js';

export const CONSTRAINT_LABELS = { ik: 'IK', transform: tn('Transform'), path: tn('Path'), physics: tn('Physics'), slider: tn('Slider') };

/** Physics only simulates during playback: said where it's set up and when it's created. */
export const PHYSICS_HINT = tn('Physics only moves while an animation plays: key the parent bone, then press play to see it.');
const PROPERTIES = ['rotate', 'x', 'y', 'scaleX', 'scaleY', 'shearY'];
const PROPERTY_LABELS = { rotate: tn('Rotate'), x: 'X', y: 'Y', scaleX: tn('Scale X'), scaleY: tn('Scale Y'), shearY: tn('Shear Y') };
const OFFSET_KEYS = { rotate: 'rotation', x: 'x', y: 'y', scaleX: 'scaleX', scaleY: 'scaleY', shearY: 'shearY' };
const MIX_KEYS = { rotate: 'mixRotate', x: 'mixX', y: 'mixY', scaleX: 'mixScaleX', scaleY: 'mixScaleY', shearY: 'mixShearY' };

const boneName = (doc, i) => doc.bones[i].name;
const isChild = (doc, child, parent) => doc.bones[child]?.parent === parent;

/** World position of a bone's tip in the setup pose. */
function tipOf(doc, pose, b) {
  return pose.world[b].apply([doc.bones[b].length, 0]);
}

/** Adds a bone under the root at a world position; returns its index. */
function addBoneAt(doc, pose, name, world) {
  const [x, y] = pose.world[0].inverse().apply(world);
  const setup = { ...identityTransform(), x, y };
  return doc.addBone(makeBone(uniqueName(name, (n) => doc.bones.some((b) => b.name === n)), 0, setup, 0));
}

/**
 * Creates a constraint of `type` from the selected bones. Returns its name, or a message string
 * prefixed with "!" explaining what to select.
 */
export function createConstraint(app, type) {
  const doc = app.doc;
  const bones = app.selectedBones();
  const pose = new Pose(doc);
  if (type === 'ik') {
    if (!bones.length) return t('!Select 1 or 2 chain bones (then optionally the target bone) first');
    let chain = [bones[0]];
    let rest = bones.slice(1);
    if (rest.length && isChild(doc, rest[0], bones[0])) {
      chain = [bones[0], rest[0]];
      rest = rest.slice(1);
    }
    // The target: the next selected bone, or a new bone at the chain's tip.
    let target = rest[0];
    if (target === undefined) {
      target = addBoneAt(doc, pose, `${boneName(doc, chain.at(-1))}-target`, tipOf(doc, pose, chain.at(-1)));
      // Adding a bone may shift indices after it.
      chain = chain.map((b) => (b >= target ? b + 1 : b));
    }
    const name = uniqueConstraintName(doc, `${boneName(doc, chain.at(-1))}-ik`);
    addIk(doc, { name, bones: chain, target });
    return name;
  }
  if (type === 'transform') {
    if (bones.length < 2) return t('!Select the bones that should follow, then the driver bone last');
    return createTransform(app, bones.slice(0, -1), bones.at(-1))[0];
  }
  if (type === 'path') {
    if (!bones.length) return t('!Select the bones to place along the path first');
    const name = uniqueConstraintName(doc, `${boneName(doc, bones[0])}-path`);
    // A new path through the selected bones' origins and the last bone's tip.
    const points = [...bones.map((b) => pose.world[b].apply([0, 0])), tipOf(doc, pose, bones.at(-1))];
    const slotName = uniqueName(name, (n) => doc.slots.some((s) => s.name === n));
    doc.slots.push(makeSlot(slotName, 0, straightPath(slotName, points, pose.world[0].inverse())));
    addConstraint(doc, { type: 'path', name, bones: bones.map((b) => boneName(doc, b)), slot: slotName, rotateMode: 'chain' });
    return name;
  }
  if (type === 'physics') {
    if (!bones.length) return t('!Select the bones that should move with physics first');
    let last = null;
    for (const b of bones) {
      last = uniqueConstraintName(doc, `${boneName(doc, b)}-physics`);
      addConstraint(doc, { type: 'physics', name: last, bone: boneName(doc, b), rotate: 1 });
    }
    return last;
  }
  if (type === 'slider') {
    if (!doc.animations.length) return t('!A slider plays an animation; create one first');
    const anim = doc.animations[0];
    const name = uniqueConstraintName(doc, `${anim.name}-slider`);
    const data = { type: 'slider', name, animation: anim.name, loop: true };
    if (bones.length) Object.assign(data, { bone: boneName(doc, bones[0]), property: 'rotate', scale: (anim.duration || 1) / 360, local: true });
    addConstraint(doc, data);
    return name;
  }
  return t('!Unknown constraint type');
}

/**
 * Transform constraints that make each `driven` bone follow `driver`, one per driven bone so each
 * keeps its own pose (a constraint's offsets are shared by its bones). Nothing moves when they are
 * created. Returns their names.
 */
export function createTransform(app, driven, driver) {
  const doc = app.doc;
  const names = [];
  for (const b of driven) {
    if (b === driver) continue;
    const name = uniqueConstraintName(doc, `${boneName(doc, b)}-transform`);
    const d = addConstraint(doc, {
      type: 'transform',
      name,
      bones: [boneName(doc, b)],
      source: boneName(doc, driver),
      properties: Object.fromEntries(PROPERTIES.map((p) => [p, { to: { [p]: {} } }])),
    });
    keepPoseOffsets(doc, d);
    names.push(name);
  }
  return names;
}

/** An open path attachment through world points, with handles a third of the way to neighbors. */
function straightPath(name, points, toLocal) {
  const local = points.map((p) => toLocal.apply(p));
  const vertices = [];
  local.forEach((p, i) => {
    const prev = local[i - 1] ?? p;
    const next = local[i + 1] ?? p;
    const inH = i > 0 ? [p[0] + (prev[0] - p[0]) / 3, p[1] + (prev[1] - p[1]) / 3] : [p[0] - (next[0] - p[0]) / 3, p[1] - (next[1] - p[1]) / 3];
    const outH = i < local.length - 1 ? [p[0] + (next[0] - p[0]) / 3, p[1] + (next[1] - p[1]) / 3] : [p[0] + (p[0] - prev[0]) / 3, p[1] + (p[1] - prev[1]) / 3];
    vertices.push(...inH, ...p, ...outH);
  });
  // Cumulative curve lengths, one per point: like stored paths, the last closes the loop.
  const lengths = [];
  let total = 0;
  for (let i = 0; i < local.length; i++) {
    const next = local[(i + 1) % local.length];
    total += Math.hypot(next[0] - local[i][0], next[1] - local[i][1]);
    lengths.push(total);
  }
  return { name, type: 'path', image: name, vertexCount: local.length * 3, vertices, closed: false, constantSpeed: true, lengths };
}

// ---- properties panel ----------------------------------------------------------------------

const row = (label, ...content) => [h('label', null, label), h('div', { class: 'cell' }, ...content)];

function checkbox(checked, onChange, label, title) {
  return h(
    'label',
    { class: 'check', title },
    h('input', { type: 'checkbox', checked: !!checked, onchange: (e) => onChange(e.target.checked) }),
    ` ${label}`,
  );
}

const num = (value, onChange, opts = {}) => dragValue(value, onChange, { speed: 0.01, decimals: 3, ...opts });
const mixField = (value, onChange) => num(value, onChange, { min: -1, max: 1, speed: 0.005 });

/** Properties of the selected constraint. */
export function constraintUi(app, name) {
  const doc = app.doc;
  const c = listConstraints(doc).find((x) => x.name === name);
  if (!c) return [h('p', { class: 'weak' }, t('Constraint not found.'))];
  const setupMode = app.mode === Mode.Setup;
  const changed = () => app.changed();
  const boneChoices = doc.bones.map((b, i) => [i, b.name]);
  const boneNameChoices = doc.bones.map((b) => [b.name, b.name]);
  const header = [
    h('h2', null, t('{type} constraint', { type: c.type in CONSTRAINT_LABELS ? t(CONSTRAINT_LABELS[c.type]) : c.type })),
    h(
      'div',
      { class: 'grid' },
      row(
        t('Name'),
        textField(c.name, (v) => {
          const next = v.trim();
          if (next && renameConstraint(doc, c.name, next)) {
            app.sel = { constraint: next };
            changed();
          }
        }),
      ),
      row(
        t('Order'),
        h('span', null, t('{index} of {count}', { index: listConstraints(doc).findIndex((x) => x.name === c.name) + 1, count: listConstraints(doc).length })),
        h('button', { class: 'small', title: t('Apply earlier'), onclick: () => moveConstraint(doc, c.name, -1) && changed() }, '▲'),
        h('button', { class: 'small', title: t('Apply later'), onclick: () => moveConstraint(doc, c.name, 1) && changed() }, '▼'),
      ),
      row(
        t('Skin'),
        checkbox(c.type === 'ik' ? doc.ik[c.ik].skinRequired : c.data.skin, (v) => {
          if (c.type === 'ik') doc.ik[c.ik].skinRequired = v;
          else if (v) c.data.skin = true;
          else delete c.data.skin;
          changed();
        }, t('Skin required'), t('Only active when the current skin includes this constraint')),
      ),
    ),
  ];
  const body = !setupMode ? animUi(app, c) : c.type === 'ik' ? ikUi(app, doc.ik[c.ik], boneChoices) : TYPE_UI[c.type]?.(app, c.data, boneNameChoices) ?? [];
  const footer = h(
    'div',
    { class: 'buttons' },
    button(t('Delete constraint'), {
      kind: 'danger',
      icon: 'trash-2',
      disabled: !setupMode,
      onclick: () => {
        removeConstraint(doc, c.name);
        app.sel = null;
        changed();
      },
    }),
  );
  return [header, body, footer];
}

const CHANNEL_LABELS = {
  mixRotate: tn('Mix rotate'),
  mixX: tn('Mix X'),
  mixY: tn('Mix Y'),
  mixScaleX: tn('Mix scale X'),
  mixScaleY: tn('Mix scale Y'),
  mixShearY: tn('Mix shear Y'),
};

/** Animate mode: the constraint's animated values at the current frame; edits set keys. */
function animUi(app, c) {
  const anim = app.currentAnimation();
  if (!anim) return [h('div', { class: 'small weak' }, t('Choose an animation to key this constraint.'))];
  const doc = app.doc;
  const pose = app.pose();
  const time = Math.round(app.time * FPS) / FPS;
  const keyButton = (keyed, onclick) => h('button', { class: `keybtn ${keyed ? 'keyed' : 'none'}`, title: keyed ? t('Keyed at this frame') : t('Key at this frame'), onclick }, '◆');
  const note = h('div', { class: 'small weak' }, t('Changes set keys at frame {frame}.', { frame: Math.round(time * FPS) }));
  if (c.type === 'ik') {
    const st = pose.ik[c.ik];
    const value = { mix: st.mix, softness: st.softness, bendPositive: st.bendPositive, compress: st.compress, stretch: st.stretch };
    const key = (changes) => {
      setIkKey(anim, c.ik, time, { ...value, ...changes });
      app.changed();
    };
    const keyed = !!anim.ik.find((t) => t.constraint === c.ik)?.keys.some((k) => Math.abs(k.time - time) < 5e-4);
    return [
      note,
      h(
        'div',
        { class: 'grid' },
        row(t('Mix'), num(value.mix, (v) => key({ mix: v }), { min: 0, max: 1 }), keyButton(keyed, () => key({}))),
        row(t('Softness'), num(value.softness, (v) => key({ softness: v }), { min: 0, speed: 0.5, decimals: 2 })),
        row(
          t('Bend'),
          h('span', { class: 'segmented' },
            h('button', { class: value.bendPositive ? 'active' : '', title: t('Bend positive'), 'aria-label': t('Bend positive'), onclick: () => key({ bendPositive: true }) }, uiIcon('plus', 'sm')),
            h('button', { class: value.bendPositive ? '' : 'active', title: t('Bend negative'), 'aria-label': t('Bend negative'), onclick: () => key({ bendPositive: false }) }, uiIcon('minus', 'sm')),
          ),
        ),
        row('', checkbox(value.compress, (v) => key({ compress: v }), t('Compress'))),
        row('', checkbox(value.stretch, (v) => key({ stretch: v }), t('Stretch'))),
      ),
    ];
  }
  const i = pose.constraintList?.findIndex((x) => x.name === c.name) ?? -1;
  const st = pose.constraintState?.[i];
  if (!st) return [h('div', { class: 'small weak' }, t('This constraint is not active.'))];
  const current = (channel) => {
    if (c.type === 'transform') {
      const m = st.mix;
      return { mixRotate: m.rotate, mixX: m.x, mixY: m.y, mixScaleX: m.scaleX, mixScaleY: m.scaleY, mixShearY: m.shearY };
    }
    if (c.type === 'path' && channel === 'mix') return { mixRotate: st.mixRotate, mixX: st.mixX, mixY: st.mixY };
    return { value: st[channel] };
  };
  const rows = [];
  for (const { channel, fields } of constraintChannels(c.type)) {
    const values = current(channel);
    const keys = channelKeys(anim, c.type, c.name, channel);
    const keyed = !!keys?.some((k) => Math.abs(k.time - time) < 5e-4);
    const key = (changes) => {
      setConstraintKey(anim, c.type, c.name, channel, time, { ...values, ...changes });
      app.changed();
    };
    fields.forEach((field, n) => {
      const label = field === 'value' ? channel[0].toUpperCase() + channel.slice(1) : t(CHANNEL_LABELS[field]);
      const opts = field === 'value' && ['position', 'spacing', 'strength', 'wind', 'gravity', 'time'].includes(channel) ? { speed: channel === 'time' ? 0.01 : 0.5, decimals: 3 } : { min: -1, max: 1, speed: 0.005 };
      rows.push(row(label, num(values[field], (v) => key({ [field]: v }), opts), n === 0 ? keyButton(keyed, () => key({})) : null));
    });
  }
  return [note, h('div', { class: 'grid' }, rows)];
}

function ikUi(app, ik, boneChoices) {
  const doc = app.doc;
  const set = (key, v) => {
    ik[key] = v;
    app.changed();
  };
  return [
    h(
      'div',
      { class: 'grid' },
      row(t('Bones'), h('span', null, ik.bones.map((b) => doc.bones[b].name).join(' → '))),
      row(t('Target'), select(boneChoices, ik.target, (v) => set('target', Number(v))), pickButton(app, t('Click the IK target bone'), (b) => set('target', b))),
      row(t('Mix'), num(ik.mix, (v) => set('mix', v), { min: 0, max: 1 })),
      row(t('Softness'), num(ik.softness, (v) => set('softness', v), { min: 0, speed: 0.5, decimals: 2 })),
      row(
        t('Bend'),
        h('span', { class: 'segmented' },
          h('button', { class: ik.bendPositive ? 'active' : '', title: t('Bend positive'), 'aria-label': t('Bend positive'), onclick: () => set('bendPositive', true) }, uiIcon('plus', 'sm')),
          h('button', { class: ik.bendPositive ? '' : 'active', title: t('Bend negative'), 'aria-label': t('Bend negative'), onclick: () => set('bendPositive', false) }, uiIcon('minus', 'sm')),
        ),
      ),
      row('', checkbox(ik.compress, (v) => set('compress', v), t('Compress'), t('Scale the bones down when the target is closer than their length'))),
      row('', checkbox(ik.stretch, (v) => set('stretch', v), t('Stretch'), t('Scale the bones up when the target is farther than their length'))),
      row('', checkbox(ik.uniform, (v) => set('uniform', v), t('Uniform'), t('Compress and stretch scale both axes'))),
    ),
    h('div', { class: 'buttons' }, h('button', { onclick: () => setIkBones(app, ik) }, t('Use selected bones as chain'))),
  ];
}

function setIkBones(app, ik) {
  const doc = app.doc;
  const bones = app.selectedBones().filter((b) => b !== ik.target);
  if (!bones.length) return app.setStatus(t('Select 1 or 2 bones for the chain'));
  ik.bones = bones.length > 1 && isChild(doc, bones[1], bones[0]) ? [bones[0], bones[1]] : [bones[0]];
  app.changed();
}

/** Bone list editor: names and a button to take the selected bones. */
function boneListUi(app, data) {
  return row(
    t('Bones'),
    h('span', null, (data.bones ?? []).join(', ') || '(none)'),
    h(
      'button',
      {
        class: 'small',
        title: t('Constrain the selected bones'),
        onclick: () => {
          const names = app.selectedBones().map((b) => app.doc.bones[b].name);
          if (!names.length) return app.setStatus(t('Select bones first'));
          data.bones = names;
          app.changed();
        },
      },
      t('Use selected'),
    ),
  );
}

function setter(app, data) {
  return (key, v, def) => {
    if (v === def || v === undefined) delete data[key];
    else data[key] = v;
    app.changed();
  };
}

/** A button that picks a bone in the viewport or tree for a field; `done(boneIndex)`. */
export function pickButton(app, prompt, done) {
  return iconButton('crosshair', { size: 'sm', title: t('Pick a bone in the viewport or tree'), active: app.pick?.prompt === prompt, onclick: () => (app.pick?.prompt === prompt ? app.finishPick(null) : app.startPick(prompt, done)) });
}

/** How transform constraint X/Y offsets are typed: along the driver's axes, or the world's. */
let offsetAxes = 'driver';

const TYPE_UI = {
  transform(app, d, boneNames) {
    const set = setter(app, d);
    const doc = app.doc;
    d.properties ??= Object.fromEntries(PROPERTIES.map((p) => [p, { to: { [p]: {} } }]));
    const mapped = new Set(Object.values(d.properties).flatMap((e) => Object.keys(e.to ?? {})));
    const x = d.mixX ?? 1;
    const sx = d.mixScaleX ?? 1;
    const mixDefault = { mixRotate: 1, mixX: 1, mixY: x, mixScaleX: 1, mixScaleY: sx, mixShearY: 1 };
    const sourceKey = d.source !== undefined || d.target === undefined ? 'source' : 'target';
    const driver = d[sourceKey];
    // Changing who drives or who follows keeps the driven bone where it is.
    const keep = () => {
      keepPoseOffsets(doc, d);
      app.changed();
    };
    const setDriver = (name) => {
      d[sourceKey] = name;
      keep();
    };
    const driven = d.bones ?? [];
    const swap = () => {
      d.bones = [driver];
      d[sourceKey] = driven[0];
      keep();
      app.setStatus(t('{driven} now follows {driver}', { driven: driver, driver: driven[0] }));
    };
    // World X/Y offsets are a point in the driver's space; World axes type them along the screen.
    const pointOffsets = !(d.localSource ?? d.local);
    const si = doc.boneIndex(driver) ?? -1;
    const s = pointOffsets && si >= 0 ? new Pose(doc).world[si] : null;
    const worldAxes = offsetAxes === 'world' && s;
    const worldOffset = worldAxes ? s.applyVector([d.x ?? 0, d.y ?? 0]) : null;
    const setWorldOffset = (axis, v) => {
      const w = [...worldOffset];
      w[axis === 'x' ? 0 : 1] = v;
      const [ox, oy] = s.inverse().applyVector(w);
      set('x', Math.round(ox * 1e4) / 1e4, 0);
      set('y', Math.round(oy * 1e4) / 1e4, 0);
    };
    const offsetField = (p) =>
      worldAxes && (p === 'x' || p === 'y')
        ? num(worldOffset[p === 'x' ? 0 : 1], (v) => setWorldOffset(p, v), { speed: 0.5, decimals: 2 })
        : num(d[OFFSET_KEYS[p]] ?? 0, (v) => set(OFFSET_KEYS[p], v, 0), { speed: p.startsWith('scale') ? 0.01 : 0.5, decimals: 2 });
    return [
      h('div', { class: 'small weak' }, t('The driven bones follow the driver. Move or turn a driven bone in Setup mode to change its offset.')),
      h(
        'div',
        { class: 'grid' },
        row(
          t('Driver'),
          select(boneNames, driver, setDriver),
          pickButton(app, t('Click the driver bone'), (b) => setDriver(doc.bones[b].name)),
        ),
        row(
          t('Driven'),
          h('span', { class: 'driven-list' }, driven.join(', ') || t('(none)')),
          h(
            'button',
            {
              class: 'small',
              title: t('Make the selected bones the driven bones'),
              onclick: () => {
                const names = app.selectedBones().map((b) => doc.bones[b].name).filter((n) => n !== driver);
                if (!names.length) return app.setStatus(t('Select bones first'));
                d.bones = names;
                keep();
              },
            },
            t('Use selected'),
          ),
          pickButton(app, t('Click the bone that should follow'), (b) => {
            if (doc.bones[b].name === driver) return app.setStatus(t('A bone cannot drive itself'));
            d.bones = [doc.bones[b].name];
            keep();
          }),
          driven.length === 1 ? iconButton('arrow-left-right', { size: 'sm', title: t('Swap driver and driven'), onclick: swap }) : null,
        ),
        row('', checkbox(d.localSource ?? d.local, (v) => set('localSource', v, false), t('Local source'), t('Read the source bone in its parent space'))),
        row('', checkbox(d.localTarget ?? d.local, (v) => set('localTarget', v, false), t('Local target'), t('Change the constrained bones in their parent space'))),
        row('', checkbox(d.additive ?? d.relative, (v) => set('additive', v, false), t('Additive'), t('Add the source values instead of matching them'))),
        row('', checkbox(d.clamp, (v) => set('clamp', v, false), t('Clamp'), t('Limit mapped values to each mapping range'))),
      ),
      h(
        'div',
        { class: 'props-head' },
        h('strong', null, t('Properties')),
        pointOffsets
          ? h(
              'span',
              { class: 'segmented', title: t('Which axes the X and Y offsets follow') },
              h('button', { class: worldAxes ? '' : 'active', onclick: () => ((offsetAxes = 'driver'), app.changed()) }, t('Driver axes')),
              h('button', { class: worldAxes ? 'active' : '', onclick: () => ((offsetAxes = 'world'), app.changed()) }, t('World axes')),
            )
          : null,
      ),
      h(
        'table',
        { class: 'props' },
        h('tr', null, h('th', null, ''), h('th', null, t('Offset')), h('th', null, t('Mix'))),
        PROPERTIES.map((p) =>
          h(
            'tr',
            { class: mapped.has(p) ? '' : 'weak' },
            h('td', null, checkbox(mapped.has(p), (on) => toggleProperty(app, d, p, on), t(PROPERTY_LABELS[p]))),
            h('td', null, offsetField(p)),
            h('td', null, mixField(d[MIX_KEYS[p]] ?? mixDefault[MIX_KEYS[p]], (v) => set(MIX_KEYS[p], v, 1))),
          ),
        ),
      ),
      mappingUi(app, d),
      h(
        'div',
        { class: 'buttons' },
        button(t('Offsets from current pose'), {
          title: t('Set the offsets so the driven bone stays where it is now'),
          onclick: () => {
            if (keepPoseOffsets(doc, d)) app.setStatus(t('Offsets set: {bone} stays where it is', { bone: driven[0] }));
            app.changed();
          },
        }),
      ),
    ];
  },

  path(app, d) {
    const set = setter(app, d);
    const doc = app.doc;
    const pathSlots = doc.slots.filter((s, i) => s.attachments.some((a) => a.type === 'path') || doc.skins.some((k) => k.slots.some((e) => e.slot === i && e.attachments.some((a) => a.type === 'path'))));
    const slotKey = d.slot !== undefined || d.target === undefined ? 'slot' : 'target';
    const x = d.mixX ?? d.translateMix ?? 1;
    return [
      h(
        'div',
        { class: 'grid' },
        boneListUi(app, d),
        row(t('Path slot'), select(pathSlots.map((s) => [s.name, s.name]), d[slotKey], (v) => set(slotKey, v))),
        row(t('Position'), select([['fixed', t('Fixed')], ['percent', t('Percent')]], d.positionMode ?? 'percent', (v) => set('positionMode', v, 'percent'))),
        row(t('Spacing'), select([['length', t('Length')], ['fixed', t('Fixed')], ['percent', t('Percent')], ['proportional', t('Proportional')]], d.spacingMode ?? 'length', (v) => set('spacingMode', v, 'length'))),
        row(t('Rotate'), select([['tangent', t('Tangent')], ['chain', t('Chain')], ['chainScale', t('Chain scale')]], d.rotateMode ?? 'tangent', (v) => set('rotateMode', v, 'tangent'))),
        row(t('Rotation offset'), num(d.rotation ?? 0, (v) => set('rotation', v, 0), { speed: 0.5, decimals: 2, suffix: '°' })),
        row(t('Position value'), num(d.position ?? 0, (v) => set('position', v, 0), { speed: (d.positionMode ?? 'percent') === 'percent' ? 0.002 : 0.5 })),
        row(t('Spacing value'), num(d.spacing ?? 0, (v) => set('spacing', v, 0), { speed: (d.spacingMode ?? 'length') === 'percent' ? 0.002 : 0.5 })),
        row(t('Mix rotate'), mixField(d.mixRotate ?? d.rotateMix ?? 1, (v) => set('mixRotate', v, 1))),
        row(t('Mix X'), mixField(x, (v) => set('mixX', v, 1))),
        row(t('Mix Y'), mixField(d.mixY ?? x, (v) => set('mixY', v, x))),
      ),
    ];
  },

  physics(app, d, boneNames) {
    const set = setter(app, d);
    const globalBox = (key) => checkbox(d[`${key}Global`], (v) => set(`${key}Global`, v, false), t('Global'), t('Also follows skeleton-wide physics keys'));
    return [
      // First, where it can't be missed: in Setup, or paused, nothing visibly happens (#27).
      h('div', { class: 'small physics-hint' }, t(PHYSICS_HINT)),
      h(
        'div',
        { class: 'grid' },
        row(t('Bone'), select(boneNames, d.bone, (v) => set('bone', v)), pickButton(app, t('Click the bone that moves with physics'), (b) => set('bone', app.doc.bones[b].name))),
        row(t('Translate X'), mixField(d.x ?? 0, (v) => set('x', v, 0))),
        row(t('Translate Y'), mixField(d.y ?? 0, (v) => set('y', v, 0))),
        row(t('Rotate'), mixField(d.rotate ?? 0, (v) => set('rotate', v, 0))),
        row(t('Scale X'), mixField(d.scaleX ?? 0, (v) => set('scaleX', v, 0))),
        row(t('Shear X'), mixField(d.shearX ?? 0, (v) => set('shearX', v, 0))),
        row(t('Limit'), num(d.limit ?? 5000, (v) => set('limit', v, 5000), { min: 0, speed: 10, decimals: 0 })),
        row(t('Step'), num(d.fps ?? 60, (v) => set('fps', Math.round(v), 60), { min: 1, max: 240, speed: 0.5, decimals: 0, suffix: ' fps' })),
        row(t('Inertia'), num(d.inertia ?? 0.5, (v) => set('inertia', v, 0.5), { min: 0, max: 1 }), globalBox('inertia')),
        row(t('Strength'), num(d.strength ?? 100, (v) => set('strength', v, 100), { min: 0, speed: 0.5, decimals: 1 }), globalBox('strength')),
        row(t('Damping'), num(d.damping ?? 0.85, (v) => set('damping', v, 0.85), { min: 0, max: 1 }), globalBox('damping')),
        row(t('Mass'), num(d.mass ?? 1, (v) => set('mass', v, 1), { min: 0.01, speed: 0.01 }), globalBox('mass')),
        row(t('Wind'), num(d.wind ?? 0, (v) => set('wind', v, 0), { speed: 0.1, decimals: 2 }), globalBox('wind')),
        row(t('Gravity'), num(d.gravity ?? 0, (v) => set('gravity', v, 0), { speed: 0.1, decimals: 2 }), globalBox('gravity')),
        row(t('Mix'), num(d.mix ?? 1, (v) => set('mix', v, 1), { min: 0, max: 1 }), globalBox('mix')),
      ),
    ];
  },

  slider(app, d, boneNames) {
    const set = setter(app, d);
    const doc = app.doc;
    return [
      h(
        'div',
        { class: 'grid' },
        row(t('Animation'), select(doc.animations.map((a) => [a.name, a.name]), d.animation, (v) => set('animation', v))),
        row(t('Time'), num(d.time ?? 0, (v) => set('time', v, 0), { min: 0, speed: 0.01, decimals: 3, suffix: ' s' })),
        row(t('Mix'), num(d.mix ?? 1, (v) => set('mix', v, 1), { min: 0, max: 1 })),
        row('', checkbox(d.loop, (v) => set('loop', v, false), t('Loop'), t('Wrap the time around the animation length'))),
        row('', checkbox(d.additive, (v) => set('additive', v, false), t('Additive'), t('Add the animation on top instead of replacing'))),
        row(
          t('Bone'),
          select([['', '(time only)'], ...boneNames], d.bone ?? '', (v) => {
            if (v) set('bone', v);
            else for (const key of ['bone', 'property', 'scale', 'local']) delete d[key];
            app.changed();
          }),
        ),
        d.bone !== undefined
          ? [
              row(t('Property'), select(PROPERTIES.map((p) => [p, t(PROPERTY_LABELS[p])]), d.property ?? 'rotate', (v) => set('property', v))),
              row(t('Scale'), num(d.scale ?? 1, (v) => set('scale', v, 1), { speed: 0.0005, decimals: 5 })),
              row('', checkbox(d.local, (v) => set('local', v, false), t('Local'), t('Read the property in the parent bone space'))),
            ]
          : null,
      ),
      h('div', { class: 'small weak' }, d.bone !== undefined ? t('Time = bone property × scale.') : t('Key the time to scrub the animation.')),
    ];
  },
};

function toggleProperty(app, d, p, on) {
  if (on) d.properties[p] = { to: { [p]: {} } };
  else {
    delete d.properties[p];
    for (const e of Object.values(d.properties)) if (e.to) delete e.to[p];
  }
  app.changed();
}

/** Advanced mapping: each source property can drive other target properties with offset/scale. */
function mappingUi(app, d) {
  const rows = [];
  for (const [from, entry] of Object.entries(d.properties)) {
    for (const [to, target] of Object.entries(entry.to ?? {})) {
      const setT = (key, v, def) => {
        if (v === def) delete target[key];
        else target[key] = v;
        app.changed();
      };
      rows.push(
        h(
          'tr',
          null,
          h('td', null, `${t(PROPERTY_LABELS[from])} → `, select(PROPERTIES.map((p) => [p, t(PROPERTY_LABELS[p])]), to, (v) => {
            delete entry.to[to];
            entry.to[v] = target;
            app.changed();
          })),
          h('td', null, num(target.offset ?? 0, (v) => setT('offset', v, 0), { speed: 0.5, decimals: 2 })),
          h('td', null, num(target.scale ?? 1, (v) => setT('scale', v, 1), { speed: 0.01 })),
          h('td', null, num(target.max ?? 1, (v) => setT('max', v, 1), { speed: 0.5, decimals: 2 })),
        ),
      );
    }
  }
  return h(
    'details',
    null,
    h('summary', null, t('Property mapping')),
    h('table', { class: 'props' }, h('tr', null, h('th', null, t('Source → target')), h('th', null, t('Offset')), h('th', null, t('Scale')), h('th', null, t('Max'))), rows),
    h('div', { class: 'small weak' }, t('Max applies when Clamp is on.')),
  );
}

