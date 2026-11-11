// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D models for Defold: the files of a .rigbymodel component, which the rigby2d library
// (runtimes/defold/rigby2d) adds to Defold. The Defold editor plays a model live in the scene view
// (its editor plugin runs the Rigby2D runtime), and the game plays it with the native component.
//
//   const files = defoldModelFiles({ doc, images, name: 'hero', folder: '/assets/hero' });
//   // -> hero.rigbyskel, hero.atlas, images/*.png, hero.rigbymodel, hero.go
//
// The caller encodes the PNGs. No DOM: the MCP server and tests use it under Node.

import { writeSkeletonBinary } from '../core/binary.js';
import { regionEntry } from '../core/draw.js';
import { writeSkeletonJson } from '../core/interop.js';

/** A quoted Defold text-format string. */
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

/** Joins a Defold project folder ("/assets/hero") and a file name. */
const inFolder = (folder, file) => `${folder.replace(/\/+$/, '')}/${file}`;

/**
 * The Defold project path of a folder on disk ("/assets/hero"), or null when no game.project sits in
 * it or above it. `dir` is an absolute path; `hasProject(dir)` tells whether dir/game.project exists.
 */
export async function defoldFolderOf(dir, hasProject) {
  const parts = dir.replace(/\\/g, '/').replace(/\/+$/, '').split('/');
  for (let i = parts.length; i > 0; i--) {
    const root = parts.slice(0, i).join('/') || '/';
    if (await hasProject(root)) return `/${parts.slice(i).join('/')}`;
  }
  return null;
}

// ---- Rigby2D model components ---------------------------------------------------------------------
//
// The rigby2d library's .rigbymodel component (runtimes/defold/rigby2d) is the full integration: the
// Defold editor plays it live in the scene view, and the game plays it natively. Its files:
//
//   hero.rigbyskel         the skeleton (binary, format 4.3)
//   hero.atlas             a Defold atlas: one animation per image, its id the image's name
//   images/*.png           the images, unpacked
//   hero.rigbymodel        the component (skeleton, atlas, animation, skin)
//   hero.go                a game object holding it, to drop into a collection

/** A file name for an image ("arm/left" -> "arm_left.png"), unique within `used`. */
function imageFile(name, used) {
  const base = name.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '') || 'image';
  let file = `${base}.png`;
  for (let k = 2; used.has(file.toLowerCase()); k++) file = `${base}_${k}.png`;
  used.add(file.toLowerCase());
  return file;
}

/** A Defold atlas with one single-image animation per image: [{ id, image (project path) }]. */
export function defoldAtlasText(entries) {
  const lines = [];
  for (const e of entries) lines.push('animations {', `  id: ${q(e.id)}`, '  images {', `    image: ${q(e.image)}`, '  }', '  playback: PLAYBACK_NONE', '}');
  lines.push('margin: 0', 'extrude_borders: 2', 'inner_padding: 0', '');
  return lines.join('\n');
}

/** The .rigbymodel text (Defold's text format of RigbyModelDesc). */
export function rigbyModelText({ skeleton, atlas, animation = '', skin = '', loop = true }) {
  const lines = [`skeleton: ${q(skeleton)}`, `atlas: ${q(atlas)}`];
  if (animation) lines.push(`default_animation: ${q(animation)}`);
  if (skin) lines.push(`skin: ${q(skin)}`);
  if (!loop) lines.push('loop: false');
  return `${lines.join('\n')}\n`;
}

/**
 * Everything for a Rigby2D model component, in the export folder whose Defold project path is
 * `folder`. `images` maps each image name the skeleton uses to { width, height, rgba }. Returns
 * [{ path, bytes } | { path, text } | { path, png }] with paths relative to the folder.
 */
export function defoldModelFiles({ doc, images, name, folder, animation = '', skin = '', loop = true }) {
  const { json } = writeSkeletonJson(doc, { version: '4.3', binary: true });
  const used = new Set();
  const entries = [];
  const files = [{ path: `${name}.rigbyskel`, bytes: writeSkeletonBinary(json) }];
  for (const [image, picture] of images) {
    const file = imageFile(image, used);
    entries.push({ id: image, image: inFolder(folder, `images/${file}`) });
    files.push({ path: `images/${file}`, png: picture });
  }
  const model = inFolder(folder, `${name}.rigbymodel`);
  files.push({ path: `${name}.atlas`, text: defoldAtlasText(entries) });
  files.push({ path: `${name}.rigbymodel`, text: rigbyModelText({ skeleton: inFolder(folder, `${name}.rigbyskel`), atlas: inFolder(folder, `${name}.atlas`), animation, skin, loop }) });
  files.push({ path: `${name}.go`, text: `components {\n  id: "rigbymodel"\n  component: ${q(model)}\n}\n` });
  return files;
}

/**
 * The images of a packed atlas, unpacked to their original size: `pages` maps page names to
 * { width, height, data (RGBA, top row first) }. Returns Map(image name -> { width, height, rgba }).
 */
export function unpackAtlas(atlas, pages) {
  const out = new Map();
  const uv = [0, 0];
  for (const page of atlas.pages) {
    const tex = pages.get(page.name);
    if (!tex) continue;
    const pw = page.width || tex.width;
    const ph = page.height || tex.height;
    for (const r of page.regions) {
      const entry = regionEntry(tex, r, pw, ph);
      const w = Math.max(1, Math.round(r.originalWidth));
      const h = Math.max(1, Math.round(r.originalHeight));
      const rgba = new Uint8ClampedArray(w * h * 4);
      const [t0, t1, t2, t3] = entry.trim;
      for (let y = 0; y < h; y++) {
        const v = (y + 0.5) / h;
        if (v < t1 || v > t3) continue;
        for (let x = 0; x < w; x++) {
          const u = (x + 0.5) / w;
          if (u < t0 || u > t2) continue;
          entry.map(u, v, uv);
          const sx = Math.min(tex.width - 1, Math.max(0, Math.floor(uv[0] * tex.width)));
          const sy = Math.min(tex.height - 1, Math.max(0, Math.floor(uv[1] * tex.height)));
          const si = (sy * tex.width + sx) * 4;
          const di = (y * w + x) * 4;
          for (let k = 0; k < 4; k++) rgba[di + k] = tex.data[si + k];
        }
      }
      out.set(r.index >= 0 ? `${r.name}${r.index}` : r.name, { width: w, height: h, rgba });
    }
  }
  return out;
}
