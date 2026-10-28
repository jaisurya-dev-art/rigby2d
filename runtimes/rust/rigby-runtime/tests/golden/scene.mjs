// SPDX-License-Identifier: MIT OR Apache-2.0
// Golden data for scenes: plays an exported scene (<name>.scene.json) with the JavaScript runtime's
// ScenePlayer through every shot and records the stage's and each character's bone world matrices,
// drawables and the scene's draw list.
// Usage: node scene.mjs <out.golden.json> <manifest (.scene.json)> [label]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../..');
const core = (p) => import(pathToFileURL(path.join(repo, 'src/core', p)).href);
const { readSkeletonJson } = await core('interop.js');
const { isSkeletonBinary, readSkeletonBinary } = await core('binary.js');
const { loadScene, sceneDrawList } = await core('scene.js');

const [out, file, label] = process.argv.slice(2);
const dir = path.dirname(path.resolve(file));
const load = (f) => {
  const bytes = new Uint8Array(fs.readFileSync(path.join(dir, f)));
  return readSkeletonJson(isSkeletonBinary(bytes) ? readSkeletonBinary(bytes) : JSON.parse(new TextDecoder().decode(bytes)), 'x').skeleton;
};
const player = await loadScene(JSON.parse(fs.readFileSync(file, 'utf8')), load);
const DT = 1 / 30;
const world = (pose) => pose.world.flatMap((m) => [m.a, m.b, m.c, m.d, m.tx, m.ty]);
const quads = (sk, pose) => pose.quads(sk).map((q) => ({ slot: q.slot, image: q.image, positions: q.positions.flat(), color: q.color.slice(0, 4) }));

const shots = [];
for (const anim of player.stage.animations) {
  player.play(anim.name, true);
  const steps = Math.ceil((player.duration() + 0.5) / DT); // past the end: the loop wraps around
  const frames = [];
  for (let i = 1; i <= steps; i++) {
    player.update(DT);
    if (i % 3) continue;
    const full = i % 15 === 0;
    frames.push({
      time: player.time,
      stage: world(player.pose),
      layers: sceneDrawList(player.stage, player.scene, player.pose).map((l) => [l.slot, l.actor ? player.scene.actors.indexOf(l.actor) : -1]),
      actors: [...player.actorPoses].map(([id, pose]) => ({ id, world: world(pose), quads: full ? quads(player.actorDocs.get(id), pose) : null })),
    });
  }
  shots.push({ shot: anim.name, frames });
}
const rel = path.relative(repo, path.resolve(file)).split(path.sep).join('/');
fs.writeFileSync(out, JSON.stringify({ label: label ?? rel, scene: rel, shots }));
console.log(`${out}: ${shots.length} shots, ${shots.reduce((n, s) => n + s.frames.length, 0)} frames, ${(fs.statSync(out).size / 1e6).toFixed(1)} MB`);
