import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cloneKey, makeClipboard, pasteClipboard, planPaste } from '../src/editor/keyclip.js';

const FPS = 30;
const snap = (t) => Math.round(t * FPS) / FPS;
const f = (n) => n / FPS; // frame number -> seconds

test('makeClipboard captures origin, span and a deep copy', () => {
  const groups = [
    { track: { bone: 1, channel: 'rotate' }, keys: [{ time: f(5), value: 10, curve: 0 }, { time: f(8), value: 20, curve: 0 }] },
    { track: { bone: 2, channel: 'translate' }, keys: [{ time: f(6), value: [1, 2], curve: 0 }] },
  ];
  const clip = makeClipboard(groups);
  assert.equal(clip.count, 3);
  assert.equal(clip.origin, f(5));
  assert.ok(Math.abs(clip.span - f(3)) < 1e-9);
  // Deep copy: mutating the source must not touch the clipboard.
  groups[1].keys[0].value[0] = 99;
  assert.deepEqual(clip.groups[1].keys[0].value, [1, 2]);
});

test('makeClipboard returns null when nothing is selected', () => {
  assert.equal(makeClipboard([]), null);
  assert.equal(makeClipboard([{ track: {}, keys: [] }]), null);
});

test('planPaste fits within the animation', () => {
  const clip = { origin: f(0), span: f(5) };
  const plan = planPaste(clip, f(10), f(60), FPS); // keys 10..15 of a 60-frame animation
  assert.equal(plan.fits, true);
  assert.equal(plan.extraFrames, 0);
});

test('planPaste reports the overflow in frames', () => {
  const clip = { origin: f(0), span: f(5) };
  const plan = planPaste(clip, f(59), f(60), FPS); // 59..64 past a 60-frame end
  assert.equal(plan.fits, false);
  assert.equal(plan.extraFrames, 4); // need frame 64, have 60
  assert.ok(Math.abs(plan.lastTime - f(64)) < 1e-9);
});

test('planPaste counts a key on the last frame as fitting', () => {
  const clip = { origin: f(0), span: f(1) };
  const plan = planPaste(clip, f(59), f(60), FPS); // last key exactly on frame 60
  assert.equal(plan.fits, true);
  assert.equal(plan.extraFrames, 0);
});

test('pasteClipboard offsets to the playhead and keeps lists sorted', () => {
  const clip = makeClipboard([
    { track: { bone: 1, channel: 'rotate' }, keys: [{ time: f(5), value: 10, curve: 0 }, { time: f(7), value: 30, curve: 0 }] },
  ]);
  const dest = [{ time: f(0), value: 0, curve: 0 }];
  const pasted = pasteClipboard(clip, f(20), { mode: 'all', snap }, () => dest);
  assert.equal(pasted.length, 2);
  // First key lands on the playhead (frame 20), the second two frames later (frame 22).
  assert.deepEqual(dest.map((k) => Math.round(k.time * FPS)), [0, 20, 22]);
  assert.deepEqual(dest.map((k) => k.value), [0, 10, 30]);
});

test('pasteClipboard replaces a key already at the target time', () => {
  const clip = makeClipboard([{ track: { bone: 1, channel: 'rotate' }, keys: [{ time: f(0), value: 42, curve: 0 }] }]);
  const dest = [{ time: f(10), value: 1, curve: 0 }];
  pasteClipboard(clip, f(10), { mode: 'all', snap }, () => dest);
  assert.equal(dest.length, 1);
  assert.equal(dest[0].value, 42);
});

test('pasteClipboard clip mode drops keys past the limit', () => {
  const clip = makeClipboard([
    { track: { bone: 1, channel: 'rotate' }, keys: [{ time: f(0), value: 1, curve: 0 }, { time: f(5), value: 2, curve: 0 }] },
  ]);
  const dest = [];
  const pasted = pasteClipboard(clip, f(58), { mode: 'clip', limit: f(60), snap }, () => dest);
  // frame 58 fits, frame 63 is past the 60-frame limit.
  assert.equal(pasted.length, 1);
  assert.deepEqual(dest.map((k) => Math.round(k.time * FPS)), [58]);
});

test('pasteClipboard skips tracks resolve cannot provide', () => {
  const clip = makeClipboard([
    { track: { deform: 7 }, keys: [{ time: f(0), value: { offset: 0, vertices: [1, 2] }, curve: 0 }] },
  ]);
  const pasted = pasteClipboard(clip, f(0), { mode: 'all', snap }, () => null);
  assert.equal(pasted.length, 0);
});

test('cloneKey copies nested deform values', () => {
  const k = { time: 0, value: { offset: 3, vertices: [1, 2, 3] }, curve: [0, 0, 1, 1] };
  const c = cloneKey(k);
  c.value.vertices[0] = 99;
  c.curve[0] = 99;
  assert.deepEqual(k.value.vertices, [1, 2, 3]);
  assert.deepEqual(k.curve, [0, 0, 1, 1]);
});
