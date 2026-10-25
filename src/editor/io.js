// SPDX-License-Identifier: MIT OR Apache-2.0
// Project files, art import (PSD / PNG) and game export (JSON + packed atlas).
// File access goes through a platform file system (see platform.js); PNG coding uses canvas.


import { atlasFilter, parseAtlas, regionPlacement, textureFilterOf, writeAtlas } from '../core/atlas.js';
import { readSkeletonBinary, writeSkeletonBinary } from '../core/binary.js';
import { isSkeletonJson, readSkeletonJson, writeSkeletonJson } from '../core/interop.js';

import { transform } from '../core/math.js';
import { Pose } from '../core/pose.js';
import { sequenceFrameName } from '../core/sequence.js';
import { Skeleton, makeAttachment, makeSlot, uniqueName } from '../core/model.js';
import { pack } from './pack.js';
import { unzip, zip } from './zip.js';

const IMAGE_DIR = 'images';

// ---- paths ------------------------------------------------------------------------------------

const SEP = /[\\/]/;

export function dirname(path) {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i < 0 ? '.' : path.slice(0, i) || path.slice(0, 1);
}

export function basename(path) {
  return path.split(SEP).pop();
}

export function stem(path) {
  const base = basename(path);
  const dot = base.lastIndexOf('.');
  return dot > 0 ? base.slice(0, dot) : base;
}

export function withExtension(path, ext) {
  const dir = dirname(path);
  const name = `${stem(path)}.${ext}`;
  return dir === '.' && !SEP.test(path) ? name : joinPath(dir, name);
}

export function joinPath(dir, rel) {
  const sep = dir.includes('\\') ? '\\' : '/';
  const parts = rel.split(SEP).filter(Boolean);
  return [dir.replace(/[\\/]+$/, ''), ...parts].join(sep);
}

// ---- PNG coding -------------------------------------------------------------------------------

export async function decodeImage(bytes) {
  const bitmap = await createImageBitmap(new Blob([bytes]), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext('2d').drawImage(bitmap, 0, 0);
  bitmap.close();
  return canvas;
}

export async function encodePng(canvas) {
  const blob = await new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

async function loadImage(fs, path) {
  return decodeImage(await fs.readFile(path));
}

// ---- projects ---------------------------------------------------------------------------------

/** Work-file extension (like .blend): the editor's own single-file format. */
export const WORKFILE_EXT = 'rigby';

/**
 * Opens a `.rigby` work file, or imports a skeleton (.json or binary .skel, with its .atlas or loose
 * images from the skeleton's images folder). Returns { doc, warnings, imported }.
 */
export async function openProject(path, fs, images) {
  if (path.toLowerCase().endsWith(`.${WORKFILE_EXT}`)) return { ...(await openWorkfile(path, fs, images)), imported: false };
  if (path.toLowerCase().endsWith('.skel')) {
    const obj = readSkeletonBinary(await fs.readFile(path));
    return { ...(await openSkeletonJson(path, fs, obj, images)), imported: true };
  }
  const json = await fs.readText(path).catch((e) => {
    throw new Error(`reading ${path}: ${e}`);
  });
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    throw new Error(`invalid JSON: ${e.message}`);
  }
  if (!isSkeletonJson(parsed)) throw new Error('not a skeleton JSON file');
  return { ...(await openSkeletonJson(path, fs, parsed, images)), imported: true };
}

/**
 * `.rigby` work file: a ZIP holding `project.json` (the complete editor document) and every image
 * as `images/<name>.png`. It keeps everything, including data the export formats cannot hold.
 */
/** `extra`: more files to store, [{ path, bytes }] (sounds as audio/<name>). */
export async function saveWorkfile(path, fs, doc, images, extra = []) {
  const enc = new TextEncoder();
  const entries = [{ path: 'project.json', bytes: enc.encode(doc.toJson()) }, ...extra];
  const warnings = [];
  for (const name of new Set([...usedImages(doc), ...doc.images.map((i) => i.name)])) {
    const canvas = images.get(name);
    if (canvas) entries.push({ path: `images/${name}.png`, bytes: await encodePng(canvas) });
    else warnings.push(`image '${name}' is missing`);
  }
  await fs.writeFile(path, zip(entries)).catch((e) => {
    throw new Error(`writing ${path}: ${e}`);
  });
  return { warnings };
}

async function openWorkfile(path, fs, images) {
  const files = unzip(await fs.readFile(path));
  const project = files.get('project.json');
  if (!project) throw new Error('not a Rigby2D work file (project.json missing)');
  const doc = Skeleton.fromJson(new TextDecoder().decode(project));
  const warnings = [];
  const loaded = new Map();
  for (const [entry, bytes] of files) {
    if (!entry.startsWith('images/') || !entry.endsWith('.png')) continue;
    try {
      loaded.set(entry.slice('images/'.length, -'.png'.length), await decodeImage(bytes));
    } catch (e) {
      warnings.push(`${entry}: ${e}`);
    }
  }
  images.clear();
  for (const [name, canvas] of loaded) images.insert(name, canvas);
  for (const name of usedImages(doc)) if (!loaded.has(name)) warnings.push(`image '${name}' is missing`);
  const audio = new Map([...files].filter(([k]) => k.startsWith('audio/')).map(([k, bytes]) => [k.slice('audio/'.length), bytes]));
  return { doc, warnings, audio };
}

/** Every image referenced by an attachment in any skin. */
export function usedImages(doc) {
  const names = new Set();
  const visit = (a) => {
    if (a.type === 'region' || a.type === 'mesh' || a.type === 'linkedmesh' || a.type === undefined) {
      if (a.sequence) for (let i = 0; i < (a.sequence.count ?? 1); i++) names.add(sequenceFrameName(a, i));
      else names.add(a.image);
    }
  };
  for (const s of doc.slots) s.attachments.forEach(visit);
  for (const skin of doc.skins) for (const e of skin.slots) e.attachments.forEach(visit);
  return [...names].sort();
}

/** Converts premultiplied-alpha pixels to straight alpha in place. */
function unpremultiply(canvas) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3];
    if (a > 0 && a < 255) {
      d[i] = Math.min(255, (d[i] * 255) / a);
      d[i + 1] = Math.min(255, (d[i + 1] * 255) / a);
      d[i + 2] = Math.min(255, (d[i + 2] * 255) / a);
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Cuts a region out of an atlas page into an upright canvas of the region's original size. */
function extractRegion(page, region) {
  const p = regionPlacement(region);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, p.originalWidth);
  canvas.height = Math.max(1, p.originalHeight);
  const ctx = canvas.getContext('2d');
  ctx.translate(p.dst.x + p.dst.width / 2, p.dst.y + p.dst.height / 2);
  // Stored rotated counter-clockwise: rotate back clockwise (positive angles in canvas space).
  ctx.rotate((p.rotate * Math.PI) / 180);
  ctx.drawImage(page, p.src.x, p.src.y, p.src.width, p.src.height, -p.src.width / 2, -p.src.height / 2, p.src.width, p.src.height);
  return canvas;
}

async function tryReadText(fs, path) {
  try {
    return await fs.readText(path);
  } catch {
    return null;
  }
}

/**
 * Finds the texture atlas for a skeleton: one with the same name, otherwise the `.atlas` file in
 * the same folder whose regions cover the most of the skeleton's images. Returns its text or null.
 */
async function findAtlas(path, fs, doc) {
  const same = (await tryReadText(fs, withExtension(path, 'atlas'))) ?? (await tryReadText(fs, `${withExtension(path, 'atlas')}.txt`));
  if (same !== null) return same;
  const dir = dirname(path);
  const names = ((await fs.list?.(dir)) ?? []).filter((n) => /.atlas(.txt)?$/i.test(n)).sort();
  const wanted = new Set(usedImages(doc));
  let best = null;
  let bestScore = 0;
  for (const name of names) {
    const text = await tryReadText(fs, joinPath(dir, name));
    if (text === null) continue;
    let score = 0;
    for (const page of parseAtlas(text).pages) for (const r of page.regions) if (wanted.has(r.name)) score++;
    // Prefer straight-alpha atlases over premultiplied ones when both cover the same images.
    if (score > bestScore || (score === bestScore && best?.pma && !/pma/i.test(name))) {
      best = { text, pma: /pma/i.test(name) };
      bestScore = score;
    }
  }
  return best ? best.text : null;
}

/** Opens skeleton JSON: reads the JSON, then images from a sibling atlas or the images folder. */
async function openSkeletonJson(path, fs, obj, images) {
  const { skeleton: doc, warnings } = readSkeletonJson(obj, stem(path));
  const dir = dirname(path);
  const loaded = new Map();
  const atlasText = await findAtlas(path, fs, doc);
  if (atlasText !== null) {
    const { pages } = parseAtlas(atlasText);
    // A pixel-art (Nearest) atlas stays sharp in the editor and is exported as Nearest again.
    doc.textureFilter = textureFilterOf(pages);
    for (const page of pages) {
      let sheet;
      try {
        sheet = await loadImage(fs, joinPath(dir, page.name));
      } catch (e) {
        warnings.push(`atlas page ${page.name}: ${e}`);
        continue;
      }
      if (page.pma) unpremultiply(sheet);
      for (const r of page.regions) loaded.set(r.index >= 0 ? `${r.name}${r.index}` : r.name, extractRegion(sheet, r));
    }
  }
  const folder = joinPath(dir, (obj.skeleton.images ?? '').trim() || 'images');
  for (const name of usedImages(doc)) {
    if (loaded.has(name)) continue;
    let found = false;
    for (const base of [folder, dir]) {
      for (const ext of ['png', 'jpg', 'jpeg']) {
        try {
          loaded.set(name, await loadImage(fs, joinPath(base, `${name}.${ext}`)));
          found = true;
          break;
        } catch {
          // try the next location
        }
      }
      if (found) break;
    }
    if (!found) warnings.push(`image '${name}' not found`);
  }
  images.clear();
  doc.images = [];
  for (const [name, canvas] of loaded) {
    images.insert(name, canvas);
    doc.images.push({ name, path: null, width: canvas.width, height: canvas.height });
  }
  return { doc, warnings };
}

/** Packs the images used by `doc` into one sheet. Returns { sheet, width, height, regions }. */
function packSheet(doc, images) {
  const items = usedImages(doc).map((name) => {
    const canvas = images.get(name);
    if (!canvas) throw new Error(`image '${name}' is missing`);
    return { name, width: canvas.width, height: canvas.height, canvas };
  });
  const { width, height, regions } = pack(items);
  const sheet = document.createElement('canvas');
  sheet.width = width;
  sheet.height = height;
  const ctx = sheet.getContext('2d');
  for (const r of regions) ctx.drawImage(items.find((i) => i.name === r.name).canvas, r.x, r.y);
  return { sheet, width, height, regions };
}

/**
 * Exports skeleton JSON: `<name>.json` (version "3.8" or "4.2"), `<name>.atlas` and
 * `<name>.png`. Returns { atlasPath, warnings }.
 */
export async function exportSkeletonJson(path, fs, doc, images, version) {
  const { json, warnings } = writeSkeletonJson(doc, { version });
  const atlasPath = await writePackedAtlas(path, fs, doc, images);
  await fs.writeText(path, JSON.stringify(json, null, 2));
  return { atlasPath, warnings };
}

/** Exports a binary skeleton: `<name>.skel` (format 4.3), `<name>.atlas` and `<name>.png`. */
export async function exportSkeletonBinary(path, fs, doc, images) {
  const { json, warnings } = writeSkeletonJson(doc, { version: '4.3', binary: true });
  const bytes = writeSkeletonBinary(json);
  const atlasPath = await writePackedAtlas(path, fs, doc, images);
  await fs.writeFile(path, bytes);
  return { atlasPath, warnings };
}

/** Packs the used images into `<name>.png` and writes `<name>.atlas`. Returns the atlas path. */
async function writePackedAtlas(path, fs, doc, images) {
  const { sheet, width, height, regions } = packSheet(doc, images);
  const pngPath = withExtension(path, 'png');
  const atlasPath = withExtension(path, 'atlas');
  const page = { name: basename(pngPath), width, height, filter: atlasFilter(doc.textureFilter), regions: regions.map((r) => ({ ...r, rotate: 0, index: -1 })) };
  await fs.writeFile(pngPath, await encodePng(sheet));
  await fs.writeText(atlasPath, writeAtlas([page]));
  return atlasPath;
}

// ---- import -----------------------------------------------------------------------------------

function uniqueImageName(doc, images, base) {
  base = base.trim() || 'image';
  return uniqueName(base, (n) => images.contains(n) || doc.images.some((i) => i.name === n));
}

/** Adds an image and a slot showing it on `bone`, placed at `world` position in the setup pose. */
function addImageSlot(doc, images, base, canvas, bone, world, visible) {
  const name = uniqueImageName(doc, images, base);
  const { width: w, height: h } = canvas;
  images.insert(name, canvas);
  doc.images.push({ name, path: null, width: w, height: h });
  const setup = new Pose(doc);
  const local = setup.world[bone].inverse().apply(world);
  const att = makeAttachment(name, name, transform(local[0], local[1], 0), w, h);
  const slot = makeSlot(doc.uniqueSlotName(name), bone, att);
  if (!visible) slot.attachment = null;
  doc.slots.push(slot);
}

/** Flattens PSD layer groups into pixel layers, bottom-most first. */
function pixelLayers(children, parentHidden = false, out = []) {
  for (const layer of children ?? []) {
    const hidden = parentHidden || !!layer.hidden;
    if (layer.children) pixelLayers(layer.children, hidden, out);
    else if (layer.canvas) out.push({ layer, hidden });
  }
  return out;
}

/**
 * Imports every pixel layer of a PSD as an image + slot on the root bone, keeping layout.
 * The canvas' bottom-center becomes the origin. Returns the number of layers imported.
 */
/** `file` is { name, bytes }. */
export async function importPsd(file, doc, images) {
  const { bytes } = file;
  // Loaded on demand: the PSD reader is large and only needed here.
  const { readPsd } = await import('ag-psd');
  const psd = readPsd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), {
    skipCompositeImageData: true,
    skipThumbnail: true,
  });
  const cw = psd.width;
  const ch = psd.height;
  let count = 0;
  // ag-psd lists layers bottom-most first, which matches slot draw order (back to front).
  for (const { layer, hidden } of pixelLayers(psd.children)) {
    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    const l = Math.max(0, left);
    const t = Math.max(0, top);
    const r = Math.max(0, Math.min(cw, layer.right ?? left + layer.canvas.width));
    const b = Math.max(0, Math.min(ch, layer.bottom ?? top + layer.canvas.height));
    if (r <= l || b <= t) continue;
    const crop = document.createElement('canvas');
    crop.width = r - l;
    crop.height = b - t;
    const ctx = crop.getContext('2d');
    ctx.globalAlpha = layer.opacity ?? 1;
    ctx.drawImage(layer.canvas, left - l, top - t);
    const cx = (l + r) * 0.5 - cw * 0.5;
    const cy = ch - (t + b) * 0.5;
    addImageSlot(doc, images, layer.name ?? 'layer', crop, 0, [cx, cy], !hidden);
    count++;
  }
  if (count === 0) throw new Error('no pixel layers found');
  if (doc.name === 'untitled') doc.name = stem(file.name);
  return count;
}

/** Imports PNG files ([{ name, bytes }]) as slots on `bone`, laid out side by side above the origin. */
export async function importPngs(files, bone, doc, images) {
  let x = 0;
  for (const { name, bytes } of files) {
    const canvas = await decodeImage(bytes).catch((e) => {
      throw new Error(`loading ${name}: ${e}`);
    });
    const { width: w, height: h } = canvas;
    addImageSlot(doc, images, stem(name), canvas, bone, [x + w * 0.5, h * 0.5], true);
    x += w + 10;
  }
  return files.length;
}

