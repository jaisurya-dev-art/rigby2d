// SPDX-License-Identifier: MIT OR Apache-2.0
// The PixiJS runtime posed by WebAssembly (runtimes/rust/rigby-wasm): it must draw the same triangles
// and UVs as the JavaScript runtime. Skipped when the module isn't built
// (cargo build --release -p rigby-wasm --target wasm32-unknown-unknown in runtimes/rust).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';

import * as PIXI from 'pixi.js';

import { AnimationState, drawSkeletonGeometry, Pose } from '../src/core/index.js';
import { loadRigbyWasm, rigbyPixi } from '../runtimes/pixi/rigby-pixi.js';

PIXI.DOMAdapter.set({ ...PIXI.DOMAdapter.get(), createCanvas: () => ({ getContext: () => null }) });

const wasmFile = new URL('../runtimes/rust/target/wasm32-unknown-unknown/release/rigby_wasm.wasm', import.meta.url);
const skip = !fs.existsSync(wasmFile) && 'rigby_wasm.wasm is not built';
const read = (p) => fs.readFileSync(new URL(`../branding/${p}`, import.meta.url));

/** Every visible mesh's triangle corners and UVs (skeleton axes), in draw order. */
function meshTriangles(sk) {
  const p = [];
  const t = [];
  for (const m of sk.children[0].children) {
    if (!m.visible) continue;
    const g = m.geometry;
    const pos = g.getBuffer('aPosition').data;
    const uv = g.getBuffer('aUV').data;
    for (const i of g.getIndex().data) p.push(pos[2 * i], pos[2 * i + 1]), t.push(uv[2 * i], uv[2 * i + 1]);
  }
  return { p, t };
}

function coreTriangles(data, pose) {
  const p = [];
  const t = [];
  drawSkeletonGeometry(data.skeleton, pose, data.lookup, (_tex, _blend, positions, uvs, triangles) => {
    for (const i of triangles) p.push(positions[2 * i], positions[2 * i + 1]), t.push(uvs[2 * i], uvs[2 * i + 1]);
  });
  return { p, t };
}

const close = (a, b, eps, what) => {
  assert.equal(a.length, b.length, `${what}: length`);
  for (let i = 0; i < a.length; i++) assert.ok(Math.abs(a[i] - b[i]) <= eps, `${what}: value ${i} ${a[i]} vs ${b[i]}`);
};

for (const [name, skel, atlas, anim] of [
  ['NILA', 'nila/export/nila.skel', 'nila/export/nila.atlas', 'wave'],
  ['Rigbytron', 'rigbytron/export/rigbytron.json', 'rigbytron/export/rigbytron.atlas', 'hold'],
]) {
  test(`${name} posed by WebAssembly draws the JavaScript runtime's triangles`, { skip }, async () => {
    const wasm = await loadRigbyWasm(fs.readFileSync(wasmFile));
    const { parseRigby, RigbySkeleton } = rigbyPixi(PIXI, { wasm });
    const bytes = read(skel);
    const data = parseRigby(skel.endsWith('.skel') ? new Uint8Array(bytes) : bytes.toString(), read(atlas).toString(), () => PIXI.Texture.WHITE);
    const sk = new RigbySkeleton(data, { animation: anim, autoUpdate: false });
    const pose = new Pose(data.skeleton);
    const state = new AnimationState();
    state.setAnimation(data.skeleton, 0, anim, true, 0);
    state.update(data.skeleton, 0);
    state.apply(data.skeleton, pose);
    for (let f = 1; f <= 90; f++) {
      sk.update(1 / 60);
      state.update(data.skeleton, 1 / 60);
      state.apply(data.skeleton, pose);
      if (f % 15) continue;
      const a = meshTriangles(sk);
      const b = coreTriangles(data, pose);
      close(a.p, b.p, 1e-2, `${name} frame ${f} positions`);
      close(a.t, b.t, 1e-5, `${name} frame ${f} uvs`);
    }
    const bone = data.skeleton.bones[data.skeleton.bones.length - 1].name;
    const t = sk.boneTransform(bone);
    const w = pose.world[data.skeleton.bones.length - 1];
    assert.ok(Math.abs(t.x - w.tx) < 1e-6 && Math.abs(t.y + w.ty) < 1e-6);
    sk.destroy();
  });
}
