// SPDX-License-Identifier: MIT OR Apache-2.0
// Film effects: layer effects (drop shadow, light shading, glow, blur, colour grade) on a bone's
// branch or a slot, particle emitters, and render-time motion blur and depth of field.
//
// All of it is film-only project data (`doc.film`, work files only): skeleton exports and the
// runtimes never see it, and a project without it renders exactly as before. Bones and slots are
// referred to by name, like scene depths, so reordering never breaks a reference.
//
//   doc.film = {
//     light: { angle },                         // degrees, 0 = from the right, 90 = from above
//     grade: { brightness, contrast, saturation, hue, tint: [r,g,b,a] } | null,   // whole frame
//     motionBlur: { samples, shutter } | null,  // shutter in degrees (180 = half a frame)
//     dof: { focus, aperture } | null,          // blur per unit of depth away from the focus
//     layers: [{ target: { bone } | { slot }, depth, shadow, shading, glow, blur, grade }],
//     emitters: [{ name, bone, slot (drawn before this slot; null = on top), image, ... }],
//   }

/** Default settings of each layer effect (an effect is off when its entry is null). */
export const EFFECT_DEFAULTS = Object.freeze({
  shadow: Object.freeze({ x: 12, y: -12, softness: 10, color: Object.freeze([0, 0, 0, 0.45]) }),
  shading: Object.freeze({ width: 24, shade: Object.freeze([0.05, 0.1, 0.25, 0.45]), light: Object.freeze([1, 0.92, 0.75, 0.35]) }),
  glow: Object.freeze({ radius: 24, color: Object.freeze([1, 0.8, 0.45, 1]), strength: 0.8 }),
  blur: Object.freeze({ radius: 6 }),
  grade: Object.freeze({ brightness: 0, contrast: 0, saturation: 0, hue: 0, tint: Object.freeze([1, 1, 1, 0]) }),
});

export const EFFECTS = Object.keys(EFFECT_DEFAULTS);

/** Default particle emitter: gentle falling snow from a 1600-unit line. */
export const EMITTER_DEFAULTS = Object.freeze({
  name: 'particles',
  bone: null,
  slot: null,
  image: null,
  enabled: true,
  seed: 1,
  shape: 'line', // point | line | box
  x: 0, // emitter position in the bone's space
  y: 0,
  width: 1600,
  height: 0,
  rate: 40, // per second
  max: 600,
  warmup: 6, // seconds simulated before frame 0, so the effect starts in full flow
  life: Object.freeze([6, 9]), // seconds
  angle: -90, // emission direction in degrees, in the emitter bone's space (−90 = down)
  spread: 20,
  speed: Object.freeze([40, 90]), // units per second
  gravity: -20, // units per second², world y (negative falls)
  wind: 15, // units per second², world x
  drag: 0.2,
  turbulence: 25, // sideways wander, units per second
  size: Object.freeze([6, 14]), // world units at birth
  grow: 1, // size at death relative to birth
  spin: Object.freeze([-90, 90]), // degrees per second
  color: Object.freeze([1, 1, 1, 0.9]),
  colorEnd: null, // null = same as color
  fadeIn: 0.1, // fraction of life
  fadeOut: 0.25,
  blend: 'normal',
});

const num = (v, def, min = -Infinity, max = Infinity) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def);
const rgba = (c, def) => (Array.isArray(c) && c.length === 4 && c.every((v) => typeof v === 'number' && Number.isFinite(v)) ? c.map((v) => Math.min(1, Math.max(0, v))) : def ? def.slice() : null);
const range = (r, def, min = -Infinity) => (Array.isArray(r) && r.length === 2 && r.every((v) => typeof v === 'number' && Number.isFinite(v)) ? [Math.max(min, Math.min(r[0], r[1])), Math.max(min, Math.max(r[0], r[1]))] : def.slice());
const str = (v, def) => (typeof v === 'string' && v ? v : def);
const plain = (o) => o && typeof o === 'object' && !Array.isArray(o);

function readEffect(kind, o) {
  if (!plain(o)) return null;
  const d = EFFECT_DEFAULTS[kind];
  switch (kind) {
    case 'shadow':
      return { x: num(o.x, d.x), y: num(o.y, d.y), softness: num(o.softness, d.softness, 0, 500), color: rgba(o.color, d.color) };
    case 'shading':
      return { width: num(o.width, d.width, 0, 500), shade: rgba(o.shade, d.shade), light: rgba(o.light, d.light) };
    case 'glow':
      return { radius: num(o.radius, d.radius, 0, 500), color: rgba(o.color, d.color), strength: num(o.strength, d.strength, 0, 10) };
    case 'blur':
      return { radius: num(o.radius, d.radius, 0, 500) };
    case 'grade':
      return {
        brightness: num(o.brightness, d.brightness, -1, 1),
        contrast: num(o.contrast, d.contrast, -1, 1),
        saturation: num(o.saturation, d.saturation, -1, 1),
        hue: num(o.hue, d.hue, -180, 180),
        tint: rgba(o.tint, d.tint),
      };
    default:
      return null;
  }
}

function readLayer(o) {
  if (!plain(o) || !plain(o.target)) return null;
  const target = typeof o.target.bone === 'string' ? { bone: o.target.bone } : typeof o.target.slot === 'string' ? { slot: o.target.slot } : null;
  if (!target) return null;
  const layer = { target, enabled: o.enabled !== false, depth: num(o.depth, 0, -1e6, 1e6) };
  for (const kind of EFFECTS) layer[kind] = readEffect(kind, o[kind]);
  return layer;
}

function readEmitter(o) {
  if (!plain(o)) return null;
  const d = EMITTER_DEFAULTS;
  return {
    name: str(o.name, d.name),
    bone: str(o.bone, null),
    slot: str(o.slot, null),
    image: str(o.image, null),
    enabled: o.enabled !== false,
    seed: Math.round(num(o.seed, d.seed, 0, 2 ** 31)),
    shape: ['point', 'line', 'box'].includes(o.shape) ? o.shape : d.shape,
    x: num(o.x, d.x, -1e6, 1e6),
    y: num(o.y, d.y, -1e6, 1e6),
    width: num(o.width, d.width, 0, 1e6),
    height: num(o.height, d.height, 0, 1e6),
    rate: num(o.rate, d.rate, 0, 10000),
    max: Math.round(num(o.max, d.max, 1, 20000)),
    warmup: num(o.warmup, d.warmup, 0, 120),
    life: range(o.life, d.life, 0.01),
    angle: num(o.angle, d.angle),
    spread: num(o.spread, d.spread, 0, 360),
    speed: range(o.speed, d.speed),
    gravity: num(o.gravity, d.gravity),
    wind: num(o.wind, d.wind),
    drag: num(o.drag, d.drag, 0, 50),
    turbulence: num(o.turbulence, d.turbulence, 0, 1e5),
    size: range(o.size, d.size, 0),
    grow: num(o.grow, d.grow, 0, 100),
    spin: range(o.spin, d.spin),
    color: rgba(o.color, d.color),
    colorEnd: rgba(o.colorEnd, null),
    fadeIn: num(o.fadeIn, d.fadeIn, 0, 1),
    fadeOut: num(o.fadeOut, d.fadeOut, 0, 1),
    blend: ['normal', 'additive', 'multiply', 'screen'].includes(o.blend) ? o.blend : d.blend,
  };
}

/** A new, empty film-effects record (light from the upper left). */
export function emptyFilm() {
  return { light: { angle: 135 }, grade: null, motionBlur: null, dof: null, layers: [], emitters: [] };
}

/** Film effects read from a work file; null when absent or empty-shaped. Invalid entries are dropped. */
export function readFilm(o) {
  if (!plain(o)) return null;
  const film = emptyFilm();
  if (plain(o.light)) film.light = { angle: num(o.light.angle, 135) };
  film.grade = readEffect('grade', o.grade);
  if (plain(o.motionBlur)) film.motionBlur = { samples: Math.round(num(o.motionBlur.samples, 8, 2, 64)), shutter: num(o.motionBlur.shutter, 180, 1, 360) };
  if (plain(o.dof)) film.dof = { focus: num(o.dof.focus, 0, -1e6, 1e6), aperture: num(o.dof.aperture, 0.02, 0, 100) };
  film.layers = (Array.isArray(o.layers) ? o.layers : []).map(readLayer).filter(Boolean);
  film.emitters = (Array.isArray(o.emitters) ? o.emitters : []).map(readEmitter).filter(Boolean);
  return film;
}

/** Whether the project has film effects that change how it renders. */
export function hasFilmFx(doc) {
  const f = doc?.film;
  if (!f) return false;
  return !!(
    f.grade ||
    f.motionBlur ||
    f.dof ||
    f.layers.some((l) => l.enabled && (EFFECTS.some((k) => l[k]) || (f.dof && l.depth))) ||
    f.emitters.some((e) => e.enabled && e.rate > 0)
  );
}

/** The film record of a document, created on first use. */
export function filmOf(doc) {
  doc.film ??= emptyFilm();
  return doc.film;
}

/** The layer whose target is `target` ({ bone } or { slot } by name), or null. */
export function findLayer(doc, target) {
  return doc.film?.layers.find((l) => (target.bone ? l.target.bone === target.bone : l.target.slot === target.slot)) ?? null;
}

/** Updates film references after a bone is renamed. */
export function renameFilmBone(doc, from, to) {
  for (const l of doc.film?.layers ?? []) if (l.target.bone === from) l.target.bone = to;
  for (const e of doc.film?.emitters ?? []) if (e.bone === from) e.bone = to;
}

/** Updates film references after a slot is renamed. */
export function renameFilmSlot(doc, from, to) {
  for (const l of doc.film?.layers ?? []) if (l.target.slot === from) l.target.slot = to;
  for (const e of doc.film?.emitters ?? []) if (e.slot === from) e.slot = to;
}

/**
 * The effect layers to draw: each enabled layer with an effect (or a depth, under depth of field),
 * resolved to its slots. A bone layer holds the slots of the bone's whole branch; a slot layer one
 * slot. Layers nest: a slot belongs to the innermost layer that holds it, and that layer is part of
 * the next one out. Returns [{ layer, slots: Set, parent (index or -1), depth }], outermost first.
 */
export function resolveLayers(doc) {
  const f = doc.film;
  if (!f) return [];
  const boneOf = new Map(doc.bones.map((b, i) => [b.name, i]));
  const slotOf = new Map(doc.slots.map((s, i) => [s.name, i]));
  const active = f.layers.filter((l) => l.enabled && (EFFECTS.some((k) => l[k]) || (f.dof && l.depth)));
  const out = [];
  for (const layer of active) {
    const slots = new Set();
    if (layer.target.bone !== undefined) {
      const b = boneOf.get(layer.target.bone);
      if (b === undefined) continue;
      doc.slots.forEach((s, i) => {
        if (doc.isDescendant(s.bone, b)) slots.add(i);
      });
    } else {
      const i = slotOf.get(layer.target.slot);
      if (i === undefined) continue;
      slots.add(i);
    }
    if (slots.size) out.push({ layer, slots, parent: -1, depth: layer.depth || 0 });
  }
  // Outermost first: larger layers before the ones inside them (ties keep file order).
  out.sort((a, b) => b.slots.size - a.slots.size);
  for (let i = 0; i < out.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if ([...out[i].slots].every((s) => out[j].slots.has(s)) && out[j].slots.size > out[i].slots.size) {
        out[i].parent = j;
        break;
      }
    }
    // Partial overlaps don't nest: the later layer takes the shared slots.
    if (out[i].parent === -1) for (let j = 0; j < i; j++) for (const s of out[i].slots) if (out[j].slots.has(s) && out[j].slots.size <= out[i].slots.size) out[j].slots.delete(s);
  }
  return out.filter((l) => l.slots.size);
}

// ---- Particles ------------------------------------------------------------------------------

/** Small deterministic random generator (mulberry32). */
export function random(seed) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STEP = 1 / 60;
const DEG = Math.PI / 180;

/**
 * A particle emitter's simulation. Deterministic: the same emitter, emitter motion and times give
 * the same particles, so scrubbing, playback and every render agree. Time runs from the warm-up
 * (−warmup seconds) in fixed steps; `advance(t, world)` steps to time `t` (seconds into the
 * animation) with the emitter bone's world transform `world` ({ a, b, c, d, tx, ty }); going back
 * in time starts over.
 */
export class ParticleSystem {
  constructor(emitter) {
    this.emitter = emitter;
    this.key = JSON.stringify(emitter);
    this.reset();
  }

  reset() {
    const e = this.emitter;
    this.rand = random(e.seed);
    this.time = -e.warmup;
    this.frac = 0;
    this.carry = 0;
    this.particles = [];
  }

  /**
   * Steps to time `t`. `world` is the emitter's world transform at `t` (used for new particles).
   * The simulation stays on its fixed-step grid; the part of a step left over (`frac`) moves each
   * particle on when it is drawn, so sub-frame times (motion blur) see it in motion.
   */
  advance(t, world) {
    if (t < this.time - 1e-9) this.reset();
    const steps = Math.min(Math.floor((t - this.time) / STEP + 1e-9), 60 * 600);
    for (let i = 0; i < steps; i++) this.step(STEP, world);
    this.time += steps * STEP;
    this.frac = Math.min(STEP, Math.max(0, t - this.time));
  }

  spawn(world) {
    const e = this.emitter;
    const r = this.rand;
    const between = ([lo, hi]) => lo + (hi - lo) * r();
    let lx = e.x;
    let ly = e.y;
    if (e.shape === 'line') lx += (r() - 0.5) * e.width;
    else if (e.shape === 'box') {
      lx += (r() - 0.5) * e.width;
      ly += (r() - 0.5) * e.height;
    }
    const m = world ?? { a: 1, b: 0, c: 0, d: 1, tx: 0, ty: 0 };
    const x = m.a * lx + m.c * ly + m.tx;
    const y = m.b * lx + m.d * ly + m.ty;
    const dir = (e.angle + (r() - 0.5) * e.spread) * DEG;
    const speed = between(e.speed);
    // Direction in the emitter bone's space, turned into world space.
    const dx = Math.cos(dir);
    const dy = Math.sin(dir);
    const len = Math.hypot(m.a * dx + m.c * dy, m.b * dx + m.d * dy) || 1;
    const vx = ((m.a * dx + m.c * dy) / len) * speed;
    const vy = ((m.b * dx + m.d * dy) / len) * speed;
    this.particles.push({ x, y, vx, vy, age: 0, life: between(e.life), size: between(e.size), rot: r() * 360, spin: between(e.spin), phase: r() * Math.PI * 2, freq: 0.3 + r() * 0.9 });
  }

  step(dt, world) {
    const e = this.emitter;
    this.carry += e.enabled ? e.rate * dt : 0;
    while (this.carry >= 1) {
      this.carry -= 1;
      if (this.particles.length < e.max) this.spawn(world);
    }
    const damp = Math.exp(-e.drag * dt);
    const alive = [];
    for (const p of this.particles) {
      p.age += dt;
      if (p.age >= p.life) continue;
      p.vx = (p.vx + e.wind * dt) * damp;
      p.vy = (p.vy + e.gravity * dt) * damp;
      const wander = Math.sin(p.phase + p.age * p.freq * Math.PI * 2) * e.turbulence;
      p.x += (p.vx + wander) * dt;
      p.y += p.vy * dt;
      p.rot += p.spin * dt;
      alive.push(p);
    }
    this.particles = alive;
  }

  /** Each live particle's look: [{ x, y, size, rotation (degrees), color: [r,g,b,a] }]. */
  sprites() {
    const e = this.emitter;
    const end = e.colorEnd ?? e.color;
    const f = this.frac ?? 0;
    return this.particles.map((p) => {
      const u = Math.min(1, (p.age + f) / p.life);
      const fade = Math.min(e.fadeIn > 0 ? u / e.fadeIn : 1, e.fadeOut > 0 ? (1 - u) / e.fadeOut : 1, 1);
      const color = e.color.map((c, k) => c + (end[k] - c) * u);
      color[3] *= Math.max(0, fade);
      const wander = Math.sin(p.phase + p.age * p.freq * Math.PI * 2) * e.turbulence;
      return { x: p.x + (p.vx + wander) * f, y: p.y + p.vy * f, size: p.size * (1 + (e.grow - 1) * u), rotation: p.rot + p.spin * f, color };
    });
  }
}

/**
 * Keeps one simulation per emitter for a document and advances them all. `world(boneName)` gives a
 * bone's world transform (null for the root / no bone). Emitters edited since the last call start over.
 */
export class ParticleField {
  constructor() {
    this.systems = new Map();
  }

  /** Advances every enabled emitter of `doc` to time `t`; returns [{ emitter, sprites }]. */
  update(doc, t, world) {
    const out = [];
    const seen = new Set();
    for (const e of doc.film?.emitters ?? []) {
      if (!e.enabled) continue;
      const key = JSON.stringify(e);
      seen.add(e.name + key);
      let sys = this.systems.get(e.name + key);
      if (!sys) this.systems.set(e.name + key, (sys = new ParticleSystem(e)));
      sys.advance(t, e.bone ? world(e.bone) : null);
      out.push({ emitter: e, sprites: sys.sprites() });
    }
    for (const k of [...this.systems.keys()]) if (!seen.has(k)) this.systems.delete(k);
    return out;
  }
}

/** Sub-frame times for motion blur: `samples` times spread over the shutter, ending at `t`. */
export function shutterTimes(t, fps, motionBlur) {
  if (!motionBlur) return [t];
  const open = (motionBlur.shutter / 360) / fps;
  const n = motionBlur.samples;
  return Array.from({ length: n }, (_, i) => t - open + (open * (i + 1)) / n);
}

/** Depth-of-field blur radius (world units) for a layer at `depth`. */
export function dofRadius(dof, depth) {
  if (!dof) return 0;
  return Math.abs((depth || 0) - dof.focus) * dof.aperture;
}
