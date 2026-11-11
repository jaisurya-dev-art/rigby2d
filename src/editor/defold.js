// SPDX-License-Identifier: MIT OR Apache-2.0
// Defold game objects for an exported skeleton: a .go to drop into a collection, which shows the
// character in the Defold editor and plays it in the game with the rigby2d library
// (runtimes/defold). Defold's editor can't draw a third-party component, but it draws sprites, so
// the game object carries a sprite of the setup pose (a picture rendered here, in a small Defold
// atlas of its own) placed exactly over the skeleton. In the game its script hides the sprite and
// the player draws the skeleton instead.
//
//   const files = defoldFiles({ doc, lookup, name: 'hero', folder: '/assets/hero', skeleton: 'hero.skel' });
//   // -> [{ path: 'hero.go', text }, { path: 'hero.script', text },
//   //     { path: 'hero_preview.atlas', text }, { path: 'hero_preview.png', png: { width, height, rgba } }]
//
// The caller encodes the PNG. No DOM: the MCP server and tests use it under Node.

import { Pose } from '../core/pose.js';
import { SoftRenderer } from './raster.js';

/** The library's piece prototype (runtimes/defold/rigby2d). */
export const DEFOLD_PIECE = '/rigby2d/piece.go';
export const SPRITE_MATERIAL = '/builtins/materials/sprite.material';

const round = (v) => Math.round(v * 1e4) / 1e4;

/**
 * The setup pose (with `skin`, or the default skin) drawn into a picture whose longest side is at
 * most `maxSide` pixels (never enlarged). Returns { width, height, rgba, center: [x, y], scale }:
 * `center` is the picture's middle in skeleton units, `scale` skeleton units per pixel. Null when
 * nothing is drawn.
 */
export function setupPicture(doc, lookup, { skin = null, maxSide = 1024 } = {}) {
  const active = doc.skin;
  doc.skin = skin && skin !== 'default' ? skin : null;
  try {
    const pose = new Pose(doc);
    let b = null;
    for (const q of pose.quads(doc)) {
      if (q.color[3] <= 0) continue;
      for (const [x, y] of q.positions) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
        b = b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y];
      }
    }
    if (!b) return null;
    const margin = 2;
    const scale = Math.max(1, Math.max(b[2] - b[0], b[3] - b[1]) / (maxSide - 2 * margin));
    const width = Math.max(1, Math.ceil((b[2] - b[0]) / scale) + 2 * margin);
    const height = Math.max(1, Math.ceil((b[3] - b[1]) / scale) + 2 * margin);
    const x0 = b[0] - margin * scale;
    const y1 = b[3] + margin * scale;
    const smooth = doc.textureFilter !== 'nearest' && !(doc.pixelGrid > 0);
    const r = new SoftRenderer(width, height, { x0, y1, scale }, { smooth });
    r.drawSkeleton(doc, pose, lookup);
    return { width, height, rgba: r.resolve(), center: [x0 + (width * scale) / 2, y1 - (height * scale) / 2], scale };
  } finally {
    doc.skin = active;
  }
}

/** A quoted Defold text-format string. */
const q = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`;

/** An embedded component of a .go file (`data`: the component's own text), with an optional transform. */
function embedded(id, type, data, { position = null, scale = null } = {}) {
  const lines = data.split('\n').filter(Boolean).map((l) => `  ${q(`${l}\n`)}`);
  const out = [`embedded_components {`, `  id: ${q(id)}`, `  type: ${q(type)}`, `  data: ${lines.join('\n').trimStart()}`, `  ""`];
  if (position) out.push('  position {', `    x: ${round(position[0])}`, `    y: ${round(position[1])}`, '  }');
  if (scale) out.push('  scale {', `    x: ${round(scale)}`, `    y: ${round(scale)}`, '    z: 1.0', '  }');
  out.push('}');
  return out.join('\n');
}

/** A Defold atlas holding one image (`image`: its project path); its animation id is the file name. */
export function previewAtlasText(image) {
  return `images {\n  image: ${q(image)}\n}\nmargin: 0\nextrude_borders: 2\ninner_padding: 0\n`;
}

/**
 * The .go file: the script (`script`: its project path), the piece factory and, with a `preview`
 * ({ atlas, animation, center, scale }), the sprite that shows the setup pose in the editor.
 */
export function gameObjectText({ script, preview = null }) {
  const parts = [`components {\n  id: "rigby2d_player"\n  component: ${q(script)}\n}`, embedded('rigby2d', 'factory', `prototype: ${q(DEFOLD_PIECE)}`)];
  if (preview) {
    const sprite = [`default_animation: ${q(preview.animation)}`, `material: ${q(SPRITE_MATERIAL)}`, 'textures {', '  sampler: "texture_sampler"', `  texture: ${q(preview.atlas)}`, '}'].join('\n');
    parts.push(embedded('preview', 'sprite', sprite, { position: preview.center, scale: preview.scale === 1 ? null : preview.scale }));
  }
  return `${parts.join('\n')}\n`;
}

/** Lua string literal. */
const lua = (s) => `"${String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/**
 * The game object's script: properties shown in the Defold editor (animation, skin, loop, speed)
 * and the shared component code from the library, pointed at this skeleton.
 */
export function scriptText({ name, skeleton, atlas, animation = '', skin = '', preview = true }) {
  return `-- Generated by Rigby2D for ${name}: plays it with the rigby2d library (rigby2d/component.lua).
-- Export again from Rigby2D to update it; set the properties in the Defold editor.

go.property("animation", hash(${lua(animation)}))
go.property("skin", hash(${lua(skin)}))
go.property("loop", true)
go.property("speed", 1)

local component = require("rigby2d.component").new({
\tskeleton = ${lua(skeleton)},
\tatlas = ${lua(atlas)},
\tpreview = ${preview ? 'true' : 'false'},
})

function init(self) component.init(self) end
function update(self, dt) component.update(self, dt) end
function on_message(self, message_id, message, sender) component.on_message(self, message_id, message, sender) end
function final(self) component.final(self) end
`;
}

/** Joins a Defold project folder ("/assets/hero") and a file name. */
const inFolder = (folder, file) => `${folder.replace(/\/+$/, '')}/${file}`;

/**
 * Everything to write next to an exported skeleton for Defold. `folder` is the export folder's path
 * in the Defold project ("/assets/hero"); `skeleton` the skeleton file name ("hero.skel"); the atlas
 * is `<name>.atlas` with its pages next to it. `lookup` gives the images (core/draw.js), for the
 * preview picture; `animation` and `skin` preset the properties (the preview shows that skin).
 * Returns [{ path, text } | { path, png: { width, height, rgba } }], paths relative to the folder.
 */
export function defoldFiles({ doc, lookup, name, folder, skeleton, animation = '', skin = '', maxSide = 1024 }) {
  const picture = setupPicture(doc, lookup, { skin, maxSide });
  const image = `${name}_preview.png`;
  const atlas = `${name}_preview.atlas`;
  const preview = picture && { atlas: inFolder(folder, atlas), animation: `${name}_preview`, center: picture.center, scale: picture.scale };
  const files = [
    { path: `${name}.go`, text: gameObjectText({ script: inFolder(folder, `${name}.script`), preview }) },
    { path: `${name}.script`, text: scriptText({ name, skeleton: inFolder(folder, skeleton), atlas: inFolder(folder, `${name}.atlas`), animation, skin, preview: !!picture }) },
  ];
  if (picture) {
    files.push({ path: atlas, text: previewAtlasText(inFolder(folder, image)) });
    files.push({ path: image, png: { width: picture.width, height: picture.height, rgba: picture.rgba } });
  }
  return files;
}

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
