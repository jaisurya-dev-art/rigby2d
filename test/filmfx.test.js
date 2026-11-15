// SPDX-License-Identifier: MIT OR Apache-2.0
// Film effects (core/filmfx.js): the work-file data, that projects without them are untouched,
// that skeleton exports never carry them, layer resolution, renames, and deterministic particles.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import { readSkeletonBinary } from '../src/core/binary.js';
import { renameBoneRefs, renameSlotRefs } from '../src/core/constraintdata.js';
import {
  EFFECT_DEFAULTS,
  EMITTER_DEFAULTS,
  ParticleField,
  ParticleSystem,
  dofRadius,
  emptyFilm,
  filmOf,
  hasFilmFx,
  readFilm,
  resolveLayers,
  shutterTimes,
} from '../src/core/filmfx.js';
import { readSkeletonJson, writeSkeletonJson } from '../src/core/interop.js';
import { Skeleton } from '../src/core/model.js';
import { gradeMatrix } from '../src/webgl/post.js';
import { WORKSPACES } from '../src/editor/workspaces.js';

const rigbytron = () => readSkeletonJson(readSkeletonBinary(new Uint8Array(fs.readFileSync(new URL('../branding/rigbytron/export/rigbytron.skel', import.meta.url)))), 'rigbytron').skeleton;
const clone = (o) => JSON.parse(JSON.stringify(o));

test('a project without film effects saves exactly as before', () => {
  const sk = rigbytron();
  assert.equal(sk.film, null);
  const o = sk.toObject();
  assert.equal('film' in o, false);
  // Reading it back and saving again gives the same work file, byte for byte.
  assert.equal(Skeleton.fromObject(clone(o)).toSnapshot(), sk.toSnapshot());
  assert.equal(hasFilmFx(sk), false);
});

test('film effects round-trip through the work file and survive undo snapshots', () => {
  const sk = rigbytron();
  const film = filmOf(sk);
  film.grade = clone(EFFECT_DEFAULTS.grade);
  film.motionBlur = { samples: 12, shutter: 270 };
  film.dof = { focus: 10, aperture: 0.05 };
  film.layers.push(readFilm({ layers: [{ target: { bone: sk.bones[1].name }, shadow: {}, glow: { radius: 5 } }] }).layers[0]);
  film.emitters.push(readFilm({ emitters: [{ name: 'sparks', bone: sk.bones[0].name, rate: 12 }] }).emitters[0]);
  const back = Skeleton.fromJson(sk.toSnapshot());
  assert.deepEqual(back.film, sk.film);
  assert.equal(back.toSnapshot(), sk.toSnapshot());
  assert.equal(hasFilmFx(back), true);
});

test('skeleton exports never carry film effects', () => {
  const sk = rigbytron();
  const plain = JSON.stringify(writeSkeletonJson(sk, { version: '4.2' }));
  filmOf(sk).layers.push(readFilm({ layers: [{ target: { bone: sk.bones[0].name }, glow: {} }] }).layers[0]);
  filmOf(sk).emitters.push(readFilm({ emitters: [{ name: 'snow' }] }).emitters[0]);
  // The export is identical with or without them.
  assert.equal(JSON.stringify(writeSkeletonJson(sk, { version: '4.2' })), plain);
});

test('film effects are a Film workspace feature only', () => {
  assert.equal(WORKSPACES.film.features.has('filmFx'), true);
  assert.equal(WORKSPACES.game.features.has('filmFx'), false);
});

test('reading film data fills defaults, clamps values and drops invalid entries', () => {
  assert.equal(readFilm(null), null);
  assert.equal(readFilm([1]), null);
  const f = readFilm({
    light: { angle: 'x' },
    motionBlur: { samples: 1000, shutter: -5 },
    layers: [{ target: { bone: 'a' }, shadow: { softness: -3, color: [2, 0, 0, 1] } }, { target: {} }, 'junk'],
    emitters: [{ rate: -4, life: [5, 1], shape: 'star', blend: 'x' }, null],
  });
  assert.equal(f.light.angle, 135);
  assert.deepEqual(f.motionBlur, { samples: 64, shutter: 1 });
  assert.equal(f.layers.length, 1);
  assert.equal(f.layers[0].shadow.softness, 0);
  assert.deepEqual(f.layers[0].shadow.color, [1, 0, 0, 1]);
  assert.equal(f.layers[0].glow, null);
  assert.equal(f.emitters.length, 1);
  assert.equal(f.emitters[0].rate, 0);
  assert.deepEqual(f.emitters[0].life, [1, 5]);
  assert.equal(f.emitters[0].shape, EMITTER_DEFAULTS.shape);
  assert.equal(f.emitters[0].blend, 'normal');
  // An empty record changes nothing in renders.
  const sk = new Skeleton();
  sk.film = emptyFilm();
  assert.equal(hasFilmFx(sk), false);
});

test('effect layers resolve to slots, nest, and follow renames', () => {
  const sk = rigbytron();
  const outer = sk.bones[1].name;
  // A bone deeper in the same branch, with slots of its own.
  const innerIndex = sk.bones.findIndex((b, i) => i > 1 && sk.isDescendant(i, 1) && sk.slots.some((s) => sk.isDescendant(s.bone, i)) && sk.slots.some((s) => sk.isDescendant(s.bone, 1) && !sk.isDescendant(s.bone, i)));
  const inner = sk.bones[innerIndex].name;
  sk.film = readFilm({ layers: [{ target: { bone: inner }, blur: {} }, { target: { bone: outer }, shadow: {} }, { target: { slot: sk.slots[0].name }, glow: {} }, { target: { bone: 'missing' }, glow: {} }] });
  const layers = resolveLayers(sk);
  const o = layers.findIndex((l) => l.layer.target.bone === outer);
  const i = layers.findIndex((l) => l.layer.target.bone === inner);
  assert.ok(o >= 0 && i >= 0);
  assert.equal(layers[i].parent, o, 'the inner bone layer sits inside the outer one');
  assert.ok([...layers[i].slots].every((s) => layers[o].slots.has(s)));
  assert.equal(layers.some((l) => l.layer.target.bone === 'missing'), false);
  // Layers without an effect (or disabled) are not drawn as layers.
  sk.film.layers[0].blur = null;
  assert.equal(resolveLayers(sk).some((l) => l.layer.target.bone === inner), false);
  // Renames keep references.
  sk.film.emitters.push(readFilm({ emitters: [{ bone: outer, slot: sk.slots[0].name }] }).emitters[0]);
  renameBoneRefs(sk, outer, 'renamed bone');
  renameSlotRefs(sk, sk.slots[0].name, 'renamed slot');
  assert.equal(sk.film.layers[1].target.bone, 'renamed bone');
  assert.equal(sk.film.layers[2].target.slot, 'renamed slot');
  assert.equal(sk.film.emitters[0].bone, 'renamed bone');
  assert.equal(sk.film.emitters[0].slot, 'renamed slot');
});

test('particles are deterministic, warm up, and start over when time goes back', () => {
  const e = readFilm({ emitters: [{ rate: 30, warmup: 2, seed: 5 }] }).emitters[0];
  const a = new ParticleSystem(e);
  const b = new ParticleSystem(e);
  a.advance(1.5, null);
  b.advance(0.5, null);
  b.advance(1.5, null);
  assert.deepEqual(a.sprites(), b.sprites(), 'stepping in pieces gives the same particles');
  // Warm-up: particles exist at time 0.
  const c = new ParticleSystem(e);
  c.advance(0, null);
  assert.ok(c.sprites().length > 30);
  // Going back in time restarts from the warm-up, so scrubbing matches playback.
  a.advance(0.25, null);
  const d = new ParticleSystem(e);
  d.advance(0.25, null);
  assert.deepEqual(a.sprites(), d.sprites());
  // A different seed differs.
  const other = new ParticleSystem({ ...e, seed: 6 });
  other.advance(1.5, null);
  assert.notDeepEqual(other.sprites(), b.sprites());
});

test('particles follow the emitter bone and the field restarts edited emitters', () => {
  const sk = new Skeleton();
  sk.film = readFilm({ emitters: [{ name: 'p', bone: 'root', shape: 'point', speed: [0, 0], gravity: 0, wind: 0, turbulence: 0, rate: 10, warmup: 0, spread: 0 }] });
  const field = new ParticleField();
  const at = (x, y) => () => ({ a: 1, b: 0, c: 0, d: 1, tx: x, ty: y });
  const first = field.update(sk, 1, at(100, 50));
  assert.ok(first[0].sprites.length >= 9);
  for (const s of first[0].sprites) assert.deepEqual([Math.round(s.x), Math.round(s.y)], [100, 50]);
  sk.film.emitters[0].rate = 0;
  assert.equal(field.update(sk, 1, at(0, 0))[0].sprites.length, 0, 'an edited emitter starts over');
});

test('motion blur sub-frames, focus blur and colour grade maths', () => {
  assert.deepEqual(shutterTimes(1, 24, null), [1]);
  const times = shutterTimes(1, 24, { samples: 4, shutter: 180 });
  assert.equal(times.length, 4);
  assert.ok(Math.abs(times[3] - 1) < 1e-12);
  assert.ok(Math.abs(times[0] - (1 - 1 / 48 + 1 / 192)) < 1e-12);
  assert.equal(dofRadius(null, 50), 0);
  assert.equal(dofRadius({ focus: 10, aperture: 0.5 }, 30), 10);
  const id = gradeMatrix({ brightness: 0, contrast: 0, saturation: 0, hue: 0, tint: [1, 1, 1, 0] });
  const close = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  assert.ok(close(id.matrix, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
  assert.ok(close(id.add, [0, 0, 0, 0]));
});
