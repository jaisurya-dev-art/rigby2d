// SPDX-License-Identifier: MIT OR Apache-2.0
// Golden geometry for the Python renderer: plays a skeleton with the JavaScript runtime and records,
// per frame, every piece drawSkeletonGeometry emits (page, blend, positions, UVs, triangles, tint),
// so clipping, atlas mapping (trimmed and rotated regions) and tints can be compared.
// Usage: node make_render_golden.mjs <out.render.json> <skeleton.json> <atlas> <animation>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const core = (p) => import(pathToFileURL(path.join(repo, 'src/core', p)).href);
const { readSkeletonJson } = await core('interop.js');
const { Pose } = await core('pose.js');
const { AnimationState } = await core('state.js');
const { parseAtlas } = await core('atlas.js');
const { atlasLookup, drawSkeletonGeometry } = await core('draw.js');

const [out, file, atlasFile, animation] = process.argv.slice(2);
const sk = readSkeletonJson(JSON.parse(fs.readFileSync(file, 'utf8')), 'x').skeleton;
const atlas = parseAtlas(fs.readFileSync(atlasFile, 'utf8'));
const lookup = atlasLookup(atlas, (page) => ({ page: atlas.pages.indexOf(page), width: page.width, height: page.height }));
const pose = new Pose(sk);
const state = new AnimationState();
state.setAnimation(sk, 0, animation, true, 0);
const frames = [];
for (let i = 1; i <= 40; i++) {
  state.update(sk, 1 / 30);
  state.apply(sk, pose);
  if (i % 4) continue;
  const pieces = [];
  drawSkeletonGeometry(sk, pose, lookup, (tex, blend, positions, uvs, triangles, light, dark) => {
    pieces.push({ page: tex.page, blend, positions: [...positions], uvs: [...uvs], triangles: [...triangles], light: [...light], dark: dark ? [...dark] : null });
  });
  frames.push(pieces);
}
const rel = (p) => path.relative(repo, path.resolve(p)).split(path.sep).join('/');
fs.writeFileSync(out, JSON.stringify({ file: rel(file), atlas: rel(atlasFile), animation, frames }));
console.log(`${out}: ${frames.length} frames`);
