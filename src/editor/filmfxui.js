// SPDX-License-Identifier: MIT OR Apache-2.0
// Film workspace UI for film effects (core/filmfx.js): the Effects section of the bone and slot
// inspectors, the Particles section of the bone inspector, and the Film effects settings in the
// project panel (light, frame grade, motion blur, depth of field).

import { EFFECT_DEFAULTS, EMITTER_DEFAULTS, filmOf, findLayer, readFilm } from '../core/filmfx.js';
import { t, tn } from './i18n.js';
import { colorButton } from './colorpicker.js';
import { hexToRgba, rgbaToHex } from './output.js';
import { button, hint, iconButton, section, toggleButton } from './ui.js';
import { dragValue, h, select, textField } from './widgets.js';
import { has } from './workspaces.js';

const row = (label, ...content) => [h('label', null, label), h('div', { class: 'cell' }, ...content)];
const clone = (o) => JSON.parse(JSON.stringify(o));

/** A colour with its opacity: a swatch and a percentage. */
function colorRow(label, value, onChange) {
  return row(
    label,
    colorButton(rgbaToHex(value), { label, onInput: (hex) => onChange([...hexToRgba(hex).slice(0, 3), value[3]]) }),
    dragValue(value[3] * 100, (v) => onChange([value[0], value[1], value[2], Math.max(0, Math.min(100, v)) / 100]), { speed: 1, min: 0, max: 100, decimals: 0, suffix: ' %' }),
  );
}

/** Settings rows of one layer effect. */
function effectRows(app, kind, fx) {
  const set = (change) => {
    Object.assign(fx, change);
    app.changed();
  };
  const units = { speed: 0.5, min: 0, max: 500, decimals: 1 };
  switch (kind) {
    case 'shadow':
      return [
        row(t('Offset'), dragValue(fx.x, (v) => set({ x: v }), { speed: 0.5, decimals: 1, prefix: 'x ' }), dragValue(fx.y, (v) => set({ y: v }), { speed: 0.5, decimals: 1, prefix: 'y ' })),
        row(t('Softness'), dragValue(fx.softness, (v) => set({ softness: v }), units)),
        colorRow(t('Color'), fx.color, (c) => set({ color: c })),
      ];
    case 'shading':
      return [
        row(t('Width'), dragValue(fx.width, (v) => set({ width: v }), units)),
        colorRow(t('Shade'), fx.shade, (c) => set({ shade: c })),
        colorRow(t('Light'), fx.light, (c) => set({ light: c })),
      ];
    case 'glow':
      return [
        row(t('Radius'), dragValue(fx.radius, (v) => set({ radius: v }), units)),
        row(t('Strength'), dragValue(fx.strength * 100, (v) => set({ strength: v / 100 }), { speed: 1, min: 0, max: 1000, decimals: 0, suffix: ' %' })),
        colorRow(t('Color'), fx.color, (c) => set({ color: c })),
      ];
    case 'blur':
      return [row(t('Radius'), dragValue(fx.radius, (v) => set({ radius: v }), units))];
    case 'grade':
      return gradeRows(app, fx);
    default:
      return [];
  }
}

function gradeRows(app, g) {
  const set = (change) => {
    Object.assign(g, change);
    app.changed();
  };
  const pct = (key, label) => row(label, dragValue(g[key] * 100, (v) => set({ [key]: v / 100 }), { speed: 1, min: -100, max: 100, decimals: 0, suffix: ' %' }));
  return [
    pct('brightness', t('Brightness')),
    pct('contrast', t('Contrast')),
    pct('saturation', t('Saturation')),
    row(t('Hue'), dragValue(g.hue, (v) => set({ hue: v }), { speed: 1, min: -180, max: 180, decimals: 0, suffix: '°' })),
    colorRow(t('Tint'), g.tint, (c) => set({ tint: c })),
  ];
}

const EFFECT_LABELS = { shadow: tn('Drop shadow'), shading: tn('Light shading'), glow: tn('Glow'), blur: tn('Blur'), grade: tn('Color grade') };
const EFFECT_TIPS = {
  shadow: tn('A soft shadow of the whole layer, offset like a cast shadow.'),
  shading: tn('Shade on the side away from the light and a rim on the side facing it, following the shapes. Set the light in the project panel.'),
  glow: tn('A soft halo around the layer.'),
  blur: tn('Softens the whole layer.'),
  grade: tn('Brightness, contrast, saturation, hue and tint of the layer.'),
};

/**
 * Film workspace: the Effects section for a bone (its whole branch, drawn as one layer) or a slot.
 * `target` is { bone: name } or { slot: name }.
 */
export function effectsUi(app, target) {
  if (!has(app, 'filmFx')) return null;
  const doc = app.doc;
  const layer = findLayer(doc, target);
  const ensure = () => {
    let l = findLayer(doc, target);
    if (!l) {
      l = readFilm({ layers: [{ target }] }).layers[0];
      filmOf(doc).layers.push(l);
    }
    return l;
  };
  const rows = [];
  for (const kind of Object.keys(EFFECT_LABELS)) {
    const on = !!layer?.[kind];
    rows.push(
      h(
        'div',
        { class: 'fx-head' },
        toggleButton(t(EFFECT_LABELS[kind]), on, (v) => {
          const l = ensure();
          l[kind] = v ? clone(EFFECT_DEFAULTS[kind]) : null;
          app.changed();
        }, { title: t(EFFECT_TIPS[kind]) }),
      ),
    );
    if (on) rows.push(h('div', { class: 'grid' }, effectRows(app, kind, layer[kind])));
  }
  if (doc.film?.dof) {
    rows.push(
      h(
        'div',
        { class: 'grid' },
        row(t('Depth'), dragValue(layer?.depth ?? 0, (v) => ((ensure().depth = v), app.changed()), { speed: 1, decimals: 0 })),
      ),
    );
  }
  rows.push(hint(target.bone ? t('Effects apply to every part on this bone and its children, drawn as one layer.') : t('Effects apply to this slot\'s picture.')));
  const count = layer ? Object.keys(EFFECT_LABELS).filter((k) => layer[k]).length : 0;
  return section(count ? t('Effects ({count})', { count }) : t('Effects'), rows, { id: 'film-effects', open: count > 0 });
}

const SHAPES = [
  ['point', tn('Point')],
  ['line', tn('Line')],
  ['box', tn('Box')],
];

/** Settings of one emitter. */
function emitterRows(app, e) {
  const set = (change) => {
    Object.assign(e, change);
    app.changed();
  };
  const pair = (key, label, opts) => row(label, dragValue(e[key][0], (v) => set({ [key]: [v, e[key][1]] }), opts), dragValue(e[key][1], (v) => set({ [key]: [e[key][0], v] }), opts));
  const one = (key, label, opts) => row(label, dragValue(e[key], (v) => set({ [key]: v }), opts));
  const images = [['', t('Soft dot')], ...app.doc.images.map((i) => [i.name, i.name])];
  return [
    row(t('Name'), textField(e.name, (v) => set({ name: v || e.name }))),
    row(t('Image'), select(images, e.image ?? '', (v) => set({ image: v || null }))),
    row(t('Drawn'), select([['', t('On top of everything')], ...app.doc.slots.map((s) => [s.name, t('Before {slot}', { slot: s.name })])], e.slot ?? '', (v) => set({ slot: v || null }))),
    row(t('Shape'), select(SHAPES.map(([v, l]) => [v, t(l)]), e.shape, (v) => set({ shape: v }))),
    e.shape !== 'point' ? row(t('Size'), dragValue(e.width, (v) => set({ width: v }), { speed: 2, min: 0, decimals: 0, prefix: 'w ' }), e.shape === 'box' ? dragValue(e.height, (v) => set({ height: v }), { speed: 2, min: 0, decimals: 0, prefix: 'h ' }) : null) : null,
    row(t('Offset'), dragValue(e.x, (v) => set({ x: v }), { speed: 1, decimals: 0, prefix: 'x ' }), dragValue(e.y, (v) => set({ y: v }), { speed: 1, decimals: 0, prefix: 'y ' })),
    one('rate', t('Rate'), { speed: 0.5, min: 0, max: 10000, decimals: 1, suffix: ' /s' }),
    pair('life', t('Lifetime'), { speed: 0.05, min: 0.01, decimals: 2, suffix: ' s' }),
    one('angle', t('Direction'), { speed: 1, decimals: 0, suffix: '°' }),
    one('spread', t('Spread'), { speed: 1, min: 0, max: 360, decimals: 0, suffix: '°' }),
    pair('speed', t('Speed'), { speed: 1, decimals: 0 }),
    one('gravity', t('Gravity'), { speed: 1, decimals: 0 }),
    one('wind', t('Wind'), { speed: 1, decimals: 0 }),
    one('turbulence', t('Turbulence'), { speed: 1, min: 0, decimals: 0 }),
    pair('size', t('Particle size'), { speed: 0.2, min: 0, decimals: 1 }),
    one('grow', t('Size at end'), { speed: 0.01, min: 0, decimals: 2, suffix: '×' }),
    pair('spin', t('Spin'), { speed: 1, decimals: 0, suffix: '°/s' }),
    colorRow(t('Color'), e.color, (c) => set({ color: c })),
    row(t('Blend'), select([['normal', t('Normal')], ['additive', t('Additive')], ['screen', t('Screen')], ['multiply', t('Multiply')]], e.blend, (v) => set({ blend: v }))),
    one('warmup', t('Warm-up'), { speed: 0.1, min: 0, max: 120, decimals: 1, suffix: ' s' }),
    one('seed', t('Seed'), { speed: 1, min: 0, decimals: 0 }),
  ];
}

/** Film workspace: particle emitters on bone `b` (they follow it), and a button to add one. */
export function particlesUi(app, b) {
  if (!has(app, 'filmFx')) return null;
  const doc = app.doc;
  const bone = doc.bones[b];
  const list = (doc.film?.emitters ?? []).filter((e) => e.bone === bone.name || (!e.bone && b === 0));
  const add = () => {
    const film = filmOf(doc);
    const names = new Set(film.emitters.map((e) => e.name));
    let name = 'particles';
    for (let i = 2; names.has(name); i++) name = `particles ${i}`;
    film.emitters.push(readFilm({ emitters: [{ ...clone(EMITTER_DEFAULTS), name, bone: bone.name }] }).emitters[0]);
    app.changed();
  };
  const items = list.map((e) =>
    h(
      'div',
      { class: 'fx-emitter' },
      h(
        'div',
        { class: 'fx-head' },
        toggleButton(e.name, e.enabled, (v) => ((e.enabled = v), app.changed()), { title: t('Turn this emitter on or off') }),
        iconButton('trash-2', { size: 'sm', title: t('Delete this emitter'), onclick: () => ((doc.film.emitters = doc.film.emitters.filter((x) => x !== e)), app.changed()) }),
      ),
      h('div', { class: 'grid' }, emitterRows(app, e)),
    ),
  );
  return section(
    list.length ? t('Particles ({count})', { count: list.length }) : t('Particles'),
    [
      items,
      h('div', { class: 'buttons' }, button(t('Add emitter'), { icon: 'plus', onclick: add })),
      hint(t('Snow, dust, sparks or rain, emitted from this bone. The same particles every time: playback, scrubbing and renders agree.')),
    ],
    { id: 'film-particles', open: list.length > 0 },
  );
}

/** Film workspace, project panel: light, frame grade, motion blur and depth of field. */
export function filmProjectUi(app) {
  if (!has(app, 'filmFx')) return null;
  const doc = app.doc;
  const film = doc.film;
  const light = film?.light?.angle ?? 135;
  const rows = [
    h(
      'div',
      { class: 'grid' },
      row(t('Light from'), dragValue(light, (v) => ((filmOf(doc).light = { angle: v }), app.changed()), { speed: 1, decimals: 0, suffix: '°' })),
    ),
    h('div', { class: 'fx-head' }, toggleButton(t('Color grade'), !!film?.grade, (v) => ((filmOf(doc).grade = v ? clone(EFFECT_DEFAULTS.grade) : null), app.changed()), { title: t('Grade the whole frame') })),
    film?.grade ? h('div', { class: 'grid' }, gradeRows(app, film.grade)) : null,
    h('div', { class: 'fx-head' }, toggleButton(t('Motion blur'), !!film?.motionBlur, (v) => ((filmOf(doc).motionBlur = v ? { samples: 8, shutter: 180 } : null), app.changed()), { title: t('Blur fast motion in renders, like a film camera\'s shutter') })),
    film?.motionBlur
      ? h(
          'div',
          { class: 'grid' },
          row(t('Shutter'), dragValue(film.motionBlur.shutter, (v) => ((film.motionBlur.shutter = v), app.changed()), { speed: 1, min: 1, max: 360, decimals: 0, suffix: '°' })),
          row(t('Samples'), dragValue(film.motionBlur.samples, (v) => ((film.motionBlur.samples = Math.round(v)), app.changed()), { speed: 0.1, min: 2, max: 64, decimals: 0 })),
        )
      : null,
    h('div', { class: 'fx-head' }, toggleButton(t('Depth of field'), !!film?.dof, (v) => ((filmOf(doc).dof = v ? { focus: 0, aperture: 0.02 } : null), app.changed()), { title: t('Blur layers by their distance from the focus') })),
    film?.dof
      ? h(
          'div',
          { class: 'grid' },
          row(t('Focus'), dragValue(film.dof.focus, (v) => ((film.dof.focus = v), app.changed()), { speed: 1, decimals: 0 })),
          row(t('Aperture'), dragValue(film.dof.aperture * 1000, (v) => ((film.dof.aperture = Math.max(0, v) / 1000), app.changed()), { speed: 0.5, min: 0, decimals: 1 })),
        )
      : null,
    hint(t('Motion blur shows in renders; the viewport previews everything else. Depth comes from each effect layer\'s Depth.')),
  ];
  return section(t('Film effects'), rows, { id: 'film-project', open: !!film });
}
