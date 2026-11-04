// SPDX-License-Identifier: MIT OR Apache-2.0
// Sprite sheets: animations rendered frame by frame (with the software renderer, raster.js) and
// packed into one image with its data, for engines and tools that play frames rather than bones.
// No DOM here: the editor (spritesheetui.js), the MCP server and the tests all run it.
//
// Formats:
//   json:   <name>.png + <name>.json, a JSON hash (TexturePacker's format, read by Phaser, PixiJS,
//           Godot importers and others) with Aseprite's frameTags and durations, and a pivot at the
//           skeleton's origin.
//   defold: <name>/<animation>_<n>.png frames + <name>.atlas with one Defold animation per
//           animation (Defold packs and trims atlases itself).
//   frames: <name>/<animation>_<n>.png only.

import { Pose } from '../core/pose.js';
import { AnimationState } from '../core/state.js';
import { SoftRenderer } from './raster.js';

export const FORMATS = [
  ['json', 'JSON hash + PNG (Phaser, PixiJS, TexturePacker, Aseprite tags)'],
  ['defold', 'Defold atlas + frames'],
  ['frames', 'PNG frames'],
];

export const DEFAULTS = { fps: 30, scale: 1, padding: 2, layout: 'packed', trim: true, dedupe: true, loop: true, maxWidth: 4096, pot: false, smooth: null };

/** Number of frames an animation is cut into: a loop leaves out its last frame (it is the first). */
export function frameCount(duration, fps, loop) {
  const n = Math.max(1, Math.round(duration * fps));
  return loop && duration > 0 ? n : n + 1;
}

/** "<animation>_<nnn>" with as many digits as the longest animation needs (at least 3). */
export function frameName(animation, index, digits = 3) {
  return `${animation}_${String(index).padStart(digits, '0')}`;
}

/**
 * Plays animation `name` frame by frame, calling `visit(pose, index)` for each kept frame. Physics
 * steps every frame as in continuous playback; a loop first plays once round so physics has settled
 * into the loop and the first frame follows on from the last.
 */
export function playFrames(doc, name, { fps, loop }, visit) {
  const anim = doc.animations.find((a) => a.name === name);
  if (!anim) throw new Error(`no animation '${name}'`);
  const count = frameCount(anim.duration, fps, loop);
  const pose = new Pose(doc);
  const state = new AnimationState();
  state.setAnimation(doc, 0, name, loop, 0);
  const dt = 1 / fps;
  const preroll = loop && anim.duration > 0 ? count : 0;
  for (let f = 0; f < preroll + count; f++) {
    if (f > 0) state.update(doc, dt);
    state.apply(doc, pose);
    if (f >= preroll) visit(pose, f - preroll);
  }
  return count;
}

/** World bounds [x0, y0, x1, y1] of everything drawn in the frames of `names`, or null. */
export function framesBounds(doc, names, options) {
  let b = null;
  for (const name of names) {
    playFrames(doc, name, options, (pose) => {
      for (const q of pose.quads(doc)) {
        if (q.color[3] <= 0) continue;
        for (const [x, y] of q.positions) {
          if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
          if (!b) b = [x, y, x, y];
          else {
            if (x < b[0]) b[0] = x;
            if (y < b[1]) b[1] = y;
            if (x > b[2]) b[2] = x;
            if (y > b[3]) b[3] = y;
          }
        }
      }
    });
  }
  return b;
}

/** The rectangle of pixels that are not fully transparent, or null. */
export function opaqueRect(rgba, width, height) {
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width * 4;
    for (let x = 0; x < width; x++) {
      if (rgba[row + x * 4 + 3] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Copies rectangle `r` of an RGBA image `width` wide. */
export function crop(rgba, width, r) {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) out.set(rgba.subarray(((r.y + y) * width + r.x) * 4, ((r.y + y) * width + r.x + r.w) * 4), y * r.w * 4);
  return out;
}

/** A hash of bytes (FNV-1a), to find identical frames. */
export function hashBytes(bytes) {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) {
    h ^= bytes[i];
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Places rectangles [{ w, h }] on sheets. `packed`: shelves of decreasing height, the sheet about
 * square; `grid`: equal cells in rows. A sheet is at most `maxWidth` wide and `maxHeight` tall
 * (rectangles that don't fit start the next sheet). Returns { width, height (the first sheet's),
 * pages: [{ width, height }], places: [{ x, y, page }] (same order as `sizes`) }.
 */
export function packRects(sizes, { layout = 'packed', padding = 2, maxWidth = 4096, maxHeight = Infinity, pot = false } = {}) {
  const result = packShelves(sizes, { layout, padding, maxWidth, maxHeight });
  // Power-of-two sheets (some engines and older GPUs need them): each side rounds up.
  if (pot) for (const p of result.pages) [p.width, p.height] = [nextPow2(p.width), nextPow2(p.height)];
  result.width = result.pages[0].width;
  result.height = result.pages[0].height;
  return result;
}

const nextPow2 = (v) => 2 ** Math.ceil(Math.log2(Math.max(1, v)));

function packShelves(sizes, { layout, padding, maxWidth, maxHeight }) {
  const places = sizes.map(() => ({ x: 0, y: 0, page: 0 }));
  if (!sizes.length) return { width: 1, height: 1, places, pages: [{ width: 1, height: 1 }] };
  const widest = Math.max(...sizes.map((s) => s.w));
  if (layout === 'grid') {
    const cw = widest + padding;
    const ch = Math.max(...sizes.map((s) => s.h)) + padding;
    const columns = Math.max(1, Math.min(sizes.length, Math.ceil(Math.sqrt((sizes.length * ch) / cw)), Math.floor((maxWidth - padding) / cw) || 1));
    // Rows per sheet: as many as fit under maxHeight (always at least one).
    const allRows = Math.ceil(sizes.length / columns);
    const rows = Number.isFinite(maxHeight) ? Math.max(1, Math.min(allRows, Math.floor((maxHeight - padding) / ch) || 1)) : allRows;
    const perPage = rows * columns;
    sizes.forEach((_, i) => {
      const k = i % perPage;
      places[i] = { x: padding + (k % columns) * cw, y: padding + Math.floor(k / columns) * ch, page: Math.floor(i / perPage) };
    });
    const count = Math.ceil(sizes.length / perPage);
    const pages = Array.from({ length: count }, (_, p) => ({ width: padding + columns * cw, height: padding + Math.ceil(Math.min(perPage, sizes.length - p * perPage) / columns) * ch }));
    return { width: pages[0].width, height: pages[0].height, places, pages };
  }
  const area = sizes.reduce((n, s) => n + (s.w + padding) * (s.h + padding), 0);
  const width = Math.min(Math.max(widest + 2 * padding, Math.ceil(Math.sqrt(area) * 1.05)), Math.max(maxWidth, widest + 2 * padding));
  const order = sizes.map((s, i) => i).sort((a, b) => sizes[b].h - sizes[a].h || sizes[b].w - sizes[a].w);
  let x = padding;
  let y = padding;
  let shelf = 0;
  let used = 0;
  let page = 0;
  const pages = [];
  for (const i of order) {
    const s = sizes[i];
    if (x + s.w + padding > width && x > padding) {
      y += shelf + padding;
      x = padding;
      shelf = 0;
    }
    // The next shelf would pass maxHeight: this sheet is full, start the next one.
    if (y + s.h + padding > maxHeight && y > padding) {
      // (Only right after a new shelf starts, the shelves above end at y.)
      pages.push({ width: Math.max(used, 1), height: y });
      page++;
      x = padding;
      y = padding;
      shelf = 0;
      used = 0;
    }
    places[i] = { x, y, page };
    x += s.w + padding;
    shelf = Math.max(shelf, s.h);
    used = Math.max(used, x);
  }
  pages.push({ width: Math.max(used, 1), height: y + shelf + padding });
  return { width: pages[0].width, height: pages[0].height, places, pages };
}

/**
 * Renders the frames of animations `names`. `lookup(image name)` gives { tex, trim, map } entries
 * (core/draw.js) whose `tex` is a raster texture. All frames share one canvas, so the skeleton's
 * origin stays at the same pixel. `progress(done, total)` is called after each frame. Returns { width, height, origin: [x, y], frames: [{ name,
 * animation, index, rgba }] }, or null when nothing is drawn.
 */
export function renderFrames(doc, lookup, names, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const smooth = o.smooth ?? doc.textureFilter !== 'nearest';
  const rect = frameRect(framesBounds(doc, names, o), o.scale);
  if (!rect) return null;
  const { width, height, x0, y1, scale } = rect;
  // `o.renderer(width, height, frame, { smooth })` may give a faster drawer (the GPU's, glframes.js)
  // with the same clear / drawSkeleton / resolve; null falls back to the software renderer.
  const frame = { x0, y1, scale };
  const total = names.reduce((n, name) => n + frameCount(doc.animations.find((a) => a.name === name).duration, o.fps, o.loop), 0);
  const draw = (renderer) => {
    const frames = [];
    try {
      for (const name of names) {
        const count = frameCount(doc.animations.find((a) => a.name === name).duration, o.fps, o.loop);
        const digits = Math.max(3, String(count - 1).length);
        playFrames(doc, name, o, (pose, index) => {
          renderer.clear();
          renderer.drawSkeleton(doc, pose, lookup);
          frames.push({ name: frameName(name, index, digits), animation: name, index, rgba: renderer.resolve() });
          o.progress?.(frames.length, total);
        });
      }
    } finally {
      renderer.dispose?.();
    }
    return frames;
  };
  const result = (frames, gpu, gpuIssue = null) => ({ width, height, origin: [-x0 / scale, y1 / scale], frames, gpu, gpuIssue });
  const soft = () => new SoftRenderer(width, height, frame, { smooth });
  let gpu = null;
  try {
    gpu = o.renderer?.(width, height, frame, { smooth }) ?? null;
  } catch {
    gpu = null;
  }
  if (!gpu) return result(draw(soft()), false);
  // The GPU's frames, unless it failed or drew nothing (a lost context reads back empty) while
  // something is there to draw: then the software renderer draws them again.
  let issue;
  try {
    const frames = draw(gpu);
    if (frames.some((f) => hasPixels(f.rgba))) return result(frames, true);
    issue = 'the GPU drew empty frames';
  } catch (e) {
    issue = e?.message ?? String(e);
  }
  const frames = draw(soft());
  return result(frames, false, frames.some((f) => hasPixels(f.rgba)) ? issue : null);
}

/**
 * The canvas every frame is drawn on, from world `bounds` at output `size` (1 = 100%): its pixel
 * width and height, its left / top world edges `x0` / `y1`, and `scale` in world units per pixel.
 */
function frameRect(bounds, size) {
  if (!bounds) return null;
  const scale = 1 / size; // world units per pixel
  const margin = 2;
  const width = Math.max(1, Math.ceil((bounds[2] - bounds[0]) / scale) + 2 * margin);
  const height = Math.max(1, Math.ceil((bounds[3] - bounds[1]) / scale) + 2 * margin);
  // Whole pixels: the origin lands on a pixel corner, so pixel art stays crisp.
  const x0 = Math.floor(bounds[0] / scale - margin) * scale;
  const y1 = Math.ceil(bounds[3] / scale + margin) * scale;
  return { width, height, x0, y1, scale };
}

/**
 * What an export will make, before drawing anything (poses only, so it is quick): the frame size,
 * the frame count and, for a sheet, how many sheets and how big at most. Trimming and dedupe only
 * make it smaller. `sizes` (e.g. [0.25, 0.5, 1]) also reports `fitsOne`, the largest size that fits
 * on one sheet. Null when nothing is drawn.
 */
export function estimateSheet(doc, names, options = {}, sizes = []) {
  const o = { ...DEFAULTS, ...options };
  const bounds = framesBounds(doc, names, o);
  if (!bounds) return null;
  const frames = names.reduce((n, name) => n + frameCount(doc.animations.find((a) => a.name === name).duration, o.fps, o.loop), 0);
  const at = (size) => {
    const r = frameRect(bounds, size);
    const packed = packRects(Array.from({ length: frames }, () => ({ w: r.width, h: r.height })), { ...o, maxHeight: o.maxWidth });
    return {
      frameWidth: r.width,
      frameHeight: r.height,
      sheets: packed.pages.length,
      width: Math.max(...packed.pages.map((p) => p.width)),
      height: Math.max(...packed.pages.map((p) => p.height)),
      tooBig: r.width > MAX_SHEET_SIDE || r.height > MAX_SHEET_SIDE || r.width * r.height > MAX_SHEET_AREA,
    };
  };
  const result = { frames, ...at(o.scale) };
  result.fitsOne = [...sizes].sort((a, b) => b - a).find((s) => at(s).sheets === 1) ?? null;
  return result;
}

/** The largest PNG browsers encode: Chromium refuses canvases over 16384² pixels or 32767 on a side. */
export const MAX_SHEET_AREA = 16384 * 16384;
export const MAX_SHEET_SIDE = 32767;

/** Whether straight-alpha RGBA has any visible pixel. */
function hasPixels(rgba) {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 0) return true;
  return false;
}

/**
 * A sprite sheet of rendered frames (from renderFrames): trimmed and deduplicated as asked, packed.
 * Returns { width, height, rgba, sprites: [{ name, animation, index, frame: {x,y,w,h},
 * trimmed, source: {x,y,w,h} }], unique } where `source` is where the frame sits in the full canvas.
 */
export function packSheet(rendered, options = {}) {
  const o = { ...DEFAULTS, ...options };
  const { width: W, height: H } = rendered;
  const unique = [];
  const byHash = new Map();
  const sprites = rendered.frames.map((f) => {
    const r = (o.trim ? opaqueRect(f.rgba, W, H) : null) ?? (o.trim ? { x: 0, y: 0, w: 1, h: 1 } : { x: 0, y: 0, w: W, h: H });
    const pixels = r.w === W && r.h === H ? f.rgba : crop(f.rgba, W, r);
    let u = -1;
    if (o.dedupe) {
      const key = `${r.x},${r.y},${r.w},${r.h},${hashBytes(pixels)}`;
      const same = byHash.get(key);
      if (same !== undefined && equalBytes(unique[same].pixels, pixels)) u = same;
      else byHash.set(key, unique.length);
    }
    if (u < 0) {
      u = unique.length;
      unique.push({ w: r.w, h: r.h, pixels });
    }
    return { name: f.name, animation: f.animation, index: f.index, unique: u, source: r };
  });
  // Sheets of at most maxWidth × maxWidth (what GPUs load): frames that don't fit go on more sheets.
  const packed = packRects(unique, { ...o, maxHeight: o.maxWidth });
  for (const pg of packed.pages) {
    if (pg.width > MAX_SHEET_SIDE || pg.height > MAX_SHEET_SIDE || pg.width * pg.height > MAX_SHEET_AREA) {
      throw new Error(`one frame is ${W}×${H} px, larger than one image can be (about 16384×16384, or 32767 on a side). Lower the size, or choose the PNG frames format.`);
    }
  }
  const pages = packed.pages.map((pg) => ({ width: pg.width, height: pg.height, rgba: new Uint8ClampedArray(pg.width * pg.height * 4) }));
  unique.forEach((u, i) => {
    const p = packed.places[i];
    const pg = pages[p.page];
    for (let y = 0; y < u.h; y++) pg.rgba.set(u.pixels.subarray(y * u.w * 4, (y + 1) * u.w * 4), ((p.y + y) * pg.width + p.x) * 4);
  });
  return {
    // The first sheet as width / height / rgba (the only one when everything fits).
    width: pages[0].width,
    height: pages[0].height,
    rgba: pages[0].rgba,
    pages,
    unique: unique.length,
    sprites: sprites.map((s) => {
      const p = packed.places[s.unique];
      return {
        name: s.name,
        animation: s.animation,
        index: s.index,
        page: p.page,
        frame: { x: p.x, y: p.y, w: s.source.w, h: s.source.h },
        trimmed: s.source.w !== W || s.source.h !== H,
        source: s.source,
      };
    }),
  };
}

function equalBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The JSON hash for a sheet: TexturePacker's layout, with each frame's duration and pivot (the
 * skeleton's origin), Aseprite's frameTags and PixiJS's animations lists.
 */
export function sheetJson(sheet, rendered, { image, fps, version = '', page = null, related = null }) {
  const frames = {};
  const tags = [];
  const animations = {};
  const sprites = page === null ? sheet.sprites : sheet.sprites.filter((s) => s.page === page);
  const size = page === null ? sheet : sheet.pages[page];
  sprites.forEach((s, i) => {
    frames[s.name] = frameEntry(s, rendered, fps);
    const tag = tags[tags.length - 1];
    if (tag && tag.name === s.animation) tag.to = i;
    else tags.push({ name: s.animation, from: i, to: i, direction: 'forward' });
    (animations[s.animation] ??= []).push(s.name);
  });
  const meta = {
    app: 'https://rigby2d.com',
    version,
    image,
    format: 'RGBA8888',
    size: { w: size.width, h: size.height },
    scale: '1',
    frameTags: tags,
  };
  // A sheet of several: PixiJS loads the others with this one (TexturePacker's multipack).
  if (related?.length) meta.related_multi_packs = related;
  return `${JSON.stringify({ frames, animations, meta }, null, 2)}\n`;
}

/** One frame's entry in a JSON hash (TexturePacker's fields plus duration and pivot). */
function frameEntry(s, rendered, fps) {
  const [ox, oy] = rendered.origin;
  return {
    frame: s.frame,
    rotated: false,
    trimmed: s.trimmed,
    spriteSourceSize: { x: s.source.x, y: s.source.y, w: s.source.w, h: s.source.h },
    sourceSize: { w: rendered.width, h: rendered.height },
    pivot: { x: round(ox / rendered.width), y: round(oy / rendered.height) },
    duration: Math.round(1000 / fps),
  };
}

/**
 * A multi-atlas over several sheets (Phaser's `load.multiatlas`, TexturePacker's "Phaser 3"
 * format): `images[page]` names each sheet. frameTags count frames in export order.
 */
export function multiAtlasJson(sheet, rendered, { images, fps, version = '' }) {
  const tags = [];
  sheet.sprites.forEach((s, i) => {
    const tag = tags[tags.length - 1];
    if (tag && tag.name === s.animation) tag.to = i;
    else tags.push({ name: s.animation, from: i, to: i, direction: 'forward' });
  });
  const textures = sheet.pages.map((pg, page) => ({
    image: images[page],
    format: 'RGBA8888',
    size: { w: pg.width, h: pg.height },
    scale: 1,
    frames: sheet.sprites.filter((s) => s.page === page).map((s) => ({ filename: s.name, ...frameEntry(s, rendered, fps) })),
  }));
  return `${JSON.stringify({ textures, meta: { app: 'https://rigby2d.com', version, format: 'RGBA8888', scale: '1', frameTags: tags } }, null, 2)}\n`;
}

const round = (v) => Math.round(v * 10000) / 10000;

/**
 * A Defold .atlas for frames saved as `<folder>/<frame name>.png` (`folder` is the project path,
 * e.g. "/hero"): one animation per animation, at `fps`, looping or played once.
 */
export function defoldAtlas(frames, { folder, fps, loop }) {
  const byAnimation = new Map();
  for (const f of frames) {
    if (!byAnimation.has(f.animation)) byAnimation.set(f.animation, []);
    byAnimation.get(f.animation).push(f.name);
  }
  const dir = `/${folder.replace(/^\/+|\/+$/g, '')}`;
  const lines = [];
  for (const [name, list] of byAnimation) {
    lines.push('animations {', `  id: "${name.replace(/"/g, '\\"')}"`);
    for (const f of list) lines.push('  images {', `    image: "${dir}/${f}.png"`, '  }');
    lines.push(`  playback: ${loop ? 'PLAYBACK_LOOP_FORWARD' : 'PLAYBACK_ONCE_FORWARD'}`, `  fps: ${Math.round(fps)}`, '  flip_horizontal: 0', '  flip_vertical: 0', '}');
  }
  lines.push('margin: 0', 'extrude_borders: 2', 'inner_padding: 0', '');
  return lines.join('\n');
}

/**
 * Everything to write for a sprite sheet export. Returns { files: [{ path, png: { width, height,
 * rgba } } | { path, text }], summary } with paths relative to the export folder; the caller
 * encodes the PNGs. `name` is the base name; `animations` the names to include (all by default).
 */
export function buildSpriteSheet(doc, lookup, { name, format = 'json', animations = null, version = '', defoldFolder = null, ...options } = {}) {
  const o = { ...DEFAULTS, ...options };
  const names = (animations ?? doc.animations.map((a) => a.name)).filter((n) => doc.animations.some((a) => a.name === n));
  if (!names.length) throw new Error('no animations to export');
  const rendered = renderFrames(doc, lookup, names, o);
  if (!rendered) throw new Error('nothing is drawn: no visible images in these animations');
  const files = [];
  let summary;
  if (format === 'json') {
    const sheet = packSheet(rendered, o);
    if (sheet.pages.length === 1) {
      files.push({ path: `${name}.png`, png: { width: sheet.width, height: sheet.height, rgba: sheet.rgba } });
      files.push({ path: `${name}.json`, text: sheetJson(sheet, rendered, { image: `${name}.png`, fps: o.fps, version }) });
    } else {
      // Several sheets: name-0.png + name-0.json … (each a JSON hash naming the others, for PixiJS),
      // and name.json, a multi-atlas over all of them (Phaser).
      const images = sheet.pages.map((_, i) => `${name}-${i}.png`);
      const jsons = sheet.pages.map((_, i) => `${name}-${i}.json`);
      sheet.pages.forEach((pg, i) => {
        files.push({ path: images[i], png: { width: pg.width, height: pg.height, rgba: pg.rgba } });
        files.push({ path: jsons[i], text: sheetJson(sheet, rendered, { image: images[i], fps: o.fps, version, page: i, related: jsons.filter((_, k) => k !== i) }) });
      });
      files.push({ path: `${name}.json`, text: multiAtlasJson(sheet, rendered, { images, fps: o.fps, version }) });
    }
    const widest = Math.max(...sheet.pages.map((p) => p.width));
    const tallest = Math.max(...sheet.pages.map((p) => p.height));
    summary = { frames: rendered.frames.length, unique: sheet.unique, width: widest, height: tallest, sheets: sheet.pages.length, frameWidth: rendered.width, frameHeight: rendered.height };
  } else {
    for (const f of rendered.frames) files.push({ path: `${name}/${f.name}.png`, png: { width: rendered.width, height: rendered.height, rgba: f.rgba } });
    if (format === 'defold') files.push({ path: `${name}.atlas`, text: defoldAtlas(rendered.frames, { folder: defoldFolder ?? name, fps: o.fps, loop: o.loop }) });
    summary = { frames: rendered.frames.length, unique: rendered.frames.length, width: rendered.width, height: rendered.height, frameWidth: rendered.width, frameHeight: rendered.height };
  }
  return { files, summary: { ...summary, animations: names }, gpu: rendered.gpu, gpuIssue: rendered.gpuIssue };
}
