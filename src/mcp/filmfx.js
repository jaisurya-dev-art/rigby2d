// SPDX-License-Identifier: MIT OR Apache-2.0
// MCP tools for film effects (core/filmfx.js): the frame-wide light, colour grade, motion blur and
// depth of field; layer effects (shadow, shading, glow, blur, grade) on a bone's branch or a slot;
// and particle emitters. Film effects live only in .rigby work files and only change renders: the
// same data the editor's Film effects panel edits, checked by the same reader (readFilm).

import { EFFECTS, EFFECT_DEFAULTS, EMITTER_DEFAULTS, filmOf, findLayer, hasFilmFx, readFilm } from '../core/filmfx.js';
import { ToolError } from './protocol.js';

const fail = (message) => {
  throw new ToolError(message);
};

const COLOR = { description: "Colour as '#rrggbb' or '#rrggbbaa', or [r, g, b, a] in 0..1." };
const EFFECT = (what, fields) => ({
  description: `${what}. An object turns it on (given fields over the defaults: ${fields}); null or false turns it off.`,
  anyOf: [{ type: 'object' }, { type: 'null' }, { type: 'boolean' }],
});
const EFFECT_FIELDS = {
  shadow: 'x, y (offset in world units), softness, color',
  shading: 'width (edge band in units), shade and light (colours)',
  glow: 'radius, color, strength',
  blur: 'radius',
  grade: 'brightness, contrast, saturation (each -1..1), hue (degrees), tint (colour; its alpha is the amount)',
};
const COLOR_FIELDS = new Set(['color', 'colorEnd', 'shade', 'light', 'tint']);

/** A colour argument as [r, g, b, a]. */
function colorOf(v, what) {
  if (Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === 'number')) return v.slice();
  const m = typeof v === 'string' && /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(v);
  if (m) {
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, m[2] ? parseInt(m[2], 16) / 255 : 1];
  }
  fail(`${what} must be '#rrggbb', '#rrggbbaa' or [r, g, b, a].`);
}

/** Copies `args` fields onto `into`, converting colours; unknown fields are refused. */
function assign(into, args, allowed, what) {
  for (const [k, v] of Object.entries(args)) {
    if (!allowed.includes(k)) fail(`${what} has no setting '${k}'. Settings: ${allowed.join(', ')}.`);
    into[k] = COLOR_FIELDS.has(k) && v !== null ? colorOf(v, `${what} '${k}'`) : v;
  }
  return into;
}

/** An effect from its argument: null when turned off, else the existing or default settings with the given fields. */
function effectOf(kind, arg, current) {
  if (arg === null || arg === false) return null;
  if (arg === true) return current ?? structuredClone(EFFECT_DEFAULTS[kind]);
  if (typeof arg !== 'object' || Array.isArray(arg)) fail(`'${kind}' must be an object, null or false.`);
  const base = current ?? structuredClone(EFFECT_DEFAULTS[kind]);
  return assign({ ...base }, arg, Object.keys(EFFECT_DEFAULTS[kind]), `The ${kind} effect`);
}

/** Re-reads the film record through the work-file reader, so values are clamped as the editor clamps them. */
function normalize(doc) {
  doc.film = readFilm(JSON.parse(JSON.stringify(doc.film)));
}

const hex = (c) => (c ? `#${c.map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}` : null);
const effectSummary = (e) => (e ? Object.fromEntries(Object.entries(e).map(([k, v]) => [k, COLOR_FIELDS.has(k) ? hex(v) : v])) : null);

/** The film effects of a project, for inspect_project and the tools' replies. */
export function filmFxSummary(doc) {
  const f = doc.film;
  if (!f) return { active: false };
  return {
    active: hasFilmFx(doc),
    light: f.light,
    grade: effectSummary(f.grade),
    motionBlur: f.motionBlur,
    dof: f.dof,
    layers: f.layers.map((l) => ({
      target: l.target,
      enabled: l.enabled,
      depth: l.depth,
      ...Object.fromEntries(EFFECTS.filter((k) => l[k]).map((k) => [k, effectSummary(l[k])])),
    })),
    emitters: f.emitters.map((e) => ({ name: e.name, enabled: e.enabled, bone: e.bone, slot: e.slot, image: e.image, shape: e.shape, rate: e.rate })),
  };
}

const EMITTER_FIELDS = Object.keys(EMITTER_DEFAULTS).filter((k) => k !== 'name');

/**
 * The film effect tools, made with createFilmTools' `tool` helper (each loads the project, applies
 * the edit, validates and saves). `requireWorkFile(p, what)` refuses skeleton exports.
 */
export function filmFxTools(tool, requireWorkFile) {
  return [
    tool(
      'set_film_effects',
      'Set film effects',
      "Set the frame-wide film effects of a work file: the light direction used by layer shading, a colour grade over the whole frame, render-time motion blur and depth of field. Only the given ones change; null turns one off. They change only renders (Render, rigby render): skeleton exports and game runtimes never see them. Saves the work file.",
      {
        lightAngle: { type: 'number', description: 'Light direction in degrees: 0 = from the right, 90 = from above (default 135, upper left).' },
        grade: EFFECT('Colour grade of the whole frame', EFFECT_FIELDS.grade),
        motionBlur: {
          description: 'Motion blur: { samples (2..64, default 8), shutter (degrees, 180 = half a frame) }, or null to turn it off.',
          anyOf: [{ type: 'object' }, { type: 'null' }, { type: 'boolean' }],
        },
        dof: {
          description: "Depth of field: { focus (the layer depth in focus), aperture (blur radius per unit of depth away from it) }, or null. Layers get a depth with set_layer_effects.",
          anyOf: [{ type: 'object' }, { type: 'null' }, { type: 'boolean' }],
        },
      },
      [],
      (args, doc, p) => {
        requireWorkFile(p, 'Film effects');
        const f = filmOf(doc);
        const changed = [];
        if (args.lightAngle !== undefined) {
          f.light = { angle: args.lightAngle };
          changed.push('light');
        }
        if (args.grade !== undefined) {
          f.grade = effectOf('grade', args.grade, f.grade);
          changed.push('grade');
        }
        if (args.motionBlur !== undefined) {
          f.motionBlur = args.motionBlur === null || args.motionBlur === false ? null : assign({ samples: 8, shutter: 180, ...(f.motionBlur ?? {}) }, args.motionBlur === true ? {} : args.motionBlur, ['samples', 'shutter'], 'Motion blur');
          changed.push('motionBlur');
        }
        if (args.dof !== undefined) {
          f.dof = args.dof === null || args.dof === false ? null : assign({ focus: 0, aperture: 0.02, ...(f.dof ?? {}) }, args.dof === true ? {} : args.dof, ['focus', 'aperture'], 'Depth of field');
          changed.push('dof');
        }
        if (!changed.length) fail('Give at least one of lightAngle, grade, motionBlur, dof.');
        normalize(doc);
        return { changed, film: filmFxSummary(doc) };
      },
    ),
    tool(
      'set_layer_effects',
      'Set layer effects',
      "Set the film effects of one layer: a bone (its whole branch of slots, drawn as one layer) or a single slot. Effects: shadow, shading (light and shade from the light direction), glow, blur and grade; an object turns one on, null or false turns it off, and fields left out keep their value. 'depth' places the layer for depth of field. remove: true deletes the layer's effects. Saves the work file.",
      {
        bone: { type: 'string', description: "Bone whose branch is the layer (give 'bone' or 'slot')." },
        slot: { type: 'string', description: 'Slot that is the layer.' },
        enabled: { type: 'boolean' },
        depth: { type: 'number', description: 'Depth for depth of field (0 = the focus plane by default).' },
        ...Object.fromEntries(EFFECTS.map((k) => [k, EFFECT(k[0].toUpperCase() + k.slice(1), EFFECT_FIELDS[k])])),
        remove: { type: 'boolean', description: "Delete this layer's effects." },
      },
      [],
      (args, doc, p) => {
        requireWorkFile(p, 'Film effects');
        if (!!args.bone === !!args.slot) fail("Give either 'bone' or 'slot'.");
        if (args.bone && !doc.bones.some((b) => b.name === args.bone)) fail(`No bone '${args.bone}'.`);
        if (args.slot && !doc.slots.some((s) => s.name === args.slot)) fail(`No slot '${args.slot}'.`);
        const target = args.bone ? { bone: args.bone } : { slot: args.slot };
        const f = filmOf(doc);
        let layer = findLayer(doc, target);
        if (args.remove) {
          if (!layer) fail(`The ${args.bone ? `bone '${args.bone}'` : `slot '${args.slot}'`} has no layer effects.`);
          f.layers.splice(f.layers.indexOf(layer), 1);
          normalize(doc);
          return { removed: target, film: filmFxSummary(doc) };
        }
        if (!layer) {
          layer = { target, enabled: true, depth: 0, ...Object.fromEntries(EFFECTS.map((k) => [k, null])) };
          f.layers.push(layer);
        }
        if (args.enabled !== undefined) layer.enabled = args.enabled;
        if (args.depth !== undefined) layer.depth = args.depth;
        for (const k of EFFECTS) if (args[k] !== undefined) layer[k] = effectOf(k, args[k], layer[k]);
        normalize(doc);
        return { layer: filmFxSummary(doc).layers.find((l) => (target.bone ? l.target.bone === target.bone : l.target.slot === target.slot)) };
      },
    ),
    tool(
      'set_emitter',
      'Set particle emitter',
      `Add or change a particle emitter (snow, rain, dust, sparks...), found by name; a new one starts from gentle falling snow. Settings: ${EMITTER_FIELDS.join(', ')}. 'bone' moves the emitter with a bone, 'slot' draws the particles just below that slot (null = on top), 'image' is an attachment image name (null = soft dots). Ranges (life, speed, size, spin) are [min, max]. remove: true deletes it. Particles are deterministic (seeded) and only appear in renders. Saves the work file.`,
      {
        name: { type: 'string', description: 'Emitter name.' },
        settings: { type: 'object', description: 'Emitter settings; null removes a setting (back to its default).' },
        remove: { type: 'boolean', description: 'Delete the emitter.' },
      },
      ['name'],
      (args, doc, p) => {
        requireWorkFile(p, 'Particle emitters');
        if (!args.name.trim()) fail('The emitter name must not be empty.');
        const f = filmOf(doc);
        let e = f.emitters.find((x) => x.name === args.name);
        if (args.remove) {
          if (!e) fail(`No emitter '${args.name}'. Emitters: ${f.emitters.map((x) => x.name).join(', ') || 'none'}.`);
          f.emitters.splice(f.emitters.indexOf(e), 1);
          normalize(doc);
          return { removed: args.name, emitters: f.emitters.map((x) => x.name) };
        }
        const created = !e;
        if (!e) {
          e = { ...structuredClone(EMITTER_DEFAULTS), name: args.name };
          f.emitters.push(e);
        }
        const settings = args.settings ?? {};
        for (const [k, v] of Object.entries(settings)) {
          if (!EMITTER_FIELDS.includes(k)) fail(`Emitters have no setting '${k}'. Settings: ${EMITTER_FIELDS.join(', ')}.`);
          if (v === null) e[k] = structuredClone(EMITTER_DEFAULTS[k]);
          else e[k] = COLOR_FIELDS.has(k) ? colorOf(v, `Emitter '${k}'`) : v;
        }
        if (e.bone && !doc.bones.some((b) => b.name === e.bone)) fail(`No bone '${e.bone}'.`);
        if (e.slot && !doc.slots.some((s) => s.name === e.slot)) fail(`No slot '${e.slot}'.`);
        normalize(doc);
        const out = doc.film.emitters.find((x) => x.name === args.name);
        return { [created ? 'added' : 'changed']: args.name, emitter: { ...out, color: hex(out.color), colorEnd: hex(out.colorEnd) } };
      },
    ),
  ];
}
