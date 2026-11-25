// SPDX-License-Identifier: MIT OR Apache-2.0
// MCP tools for Rigby AutoRig (layered artwork to an editable rig), Aseprite import and animation
// retargeting (an animation made for one character, played by another).

import fs from 'node:fs/promises';
import path from 'node:path';

import { PART_ROLES, autoRig, findParts } from '../core/autorig.js';
import { makeAttachment, makeSlot, Skeleton, uniqueName } from '../core/model.js';
import { transform } from '../core/math.js';
import { mapBones, retarget } from '../core/retarget.js';
import { addAsepriteParts, asepriteParts, readAseprite } from '../editor/aseprite.js';
import { applyPixelArt } from '../editor/io.js';
import { EDIT, OUTPUT, OVERWRITE, edit, save } from './edits.js';
import { alphaOf as alphaChannel, decodePng, encodePng } from './png.js';
import { ToolError } from './protocol.js';
import { PATH, READ_ONLY, loadProject } from './tools.js';

const PSD = { type: 'string', description: 'Layered artwork (.psd) inside the workspace, one layer per body part. Instead of path.' };
const ROLES = { type: 'object', additionalProperties: { type: 'string', enum: [...PART_ROLES, 'none'] }, description: "Override detected roles: { layerName: role }. 'none' leaves a layer unrigged." };
const SIDES = { type: 'object', additionalProperties: { type: ['string', 'null'], enum: ['l', 'r', null] }, description: "Override sides: { layerName: 'l' | 'r' }. The character's left (l) is on the image's right when it faces the viewer." };
const MAPPING = { type: 'object', additionalProperties: { type: ['string', 'null'] }, description: 'Override bone matches: { sourceBone: targetBone }, or null to leave a source bone out.' };

/** Pixel layers of a PSD, bottom-most first (the draw order), with their hidden state. */
function pixelLayers(children, parentHidden = false, out = []) {
  for (const layer of children ?? []) {
    const hidden = parentHidden || !!layer.hidden;
    if (layer.children) pixelLayers(layer.children, hidden, out);
    else if (layer.imageData) out.push({ layer, hidden });
  }
  return out;
}

/**
 * Imports a PSD like the editor's File > Import PSD: every pixel layer becomes an image and a slot
 * on the root bone, keeping the layout (the canvas' bottom center is the origin).
 * Returns { doc, entries (images/<name>.png), pixels (name -> RGBA) }.
 */
export async function importPsd(file) {
  let readPsd;
  try {
    let initializeCanvas;
    ({ readPsd, initializeCanvas } = await import('ag-psd'));
    // Node.js has no canvas: layers are read as plain pixel data.
    initializeCanvas(
      () => {
        throw new Error('this PSD needs a canvas to decode (for example JPEG-compressed data)');
      },
      (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
    );
  } catch {
    throw new ToolError('Reading PSD files needs the ag-psd package: run npm install in the Rigby2D folder.');
  }
  const bytes = await fs.readFile(file);
  let psd;
  try {
    psd = readPsd(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), { useImageData: true, skipCompositeImageData: true, skipThumbnail: true });
  } catch (e) {
    throw new ToolError(`Cannot read the PSD: ${e.message}`);
  }
  const doc = new Skeleton();
  doc.name = path.basename(file, path.extname(file));
  const entries = new Map();
  const pixels = new Map();
  for (const { layer, hidden } of pixelLayers(psd.children)) {
    const src = layer.imageData;
    const left = layer.left ?? 0;
    const top = layer.top ?? 0;
    const l = Math.max(0, left);
    const t = Math.max(0, top);
    const r = Math.min(psd.width, left + src.width);
    const b = Math.min(psd.height, top + src.height);
    if (r <= l || b <= t) continue;
    const w = r - l;
    const h = b - t;
    const data = new Uint8Array(w * h * 4);
    const opacity = layer.opacity ?? 1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const s = ((y + t - top) * src.width + (x + l - left)) * 4;
        const d = (y * w + x) * 4;
        data.set(src.data.subarray(s, s + 3), d);
        data[d + 3] = Math.round(src.data[s + 3] * opacity);
      }
    }
    const name = uniqueName((layer.name ?? 'layer').trim() || 'layer', (n) => doc.images.some((i) => i.name === n));
    const rgba = { width: w, height: h, data };
    pixels.set(name, rgba);
    entries.set(`images/${name}.png`, encodePng(rgba));
    doc.images.push({ name, path: null, width: w, height: h });
    const att = makeAttachment(name, name, transform((l + r) / 2 - psd.width / 2, psd.height - (t + b) / 2, 0), w, h);
    const slot = makeSlot(doc.uniqueSlotName(name), 0, att);
    if (hidden) slot.attachment = null;
    doc.slots.push(slot);
  }
  if (!doc.slots.length) throw new ToolError('The PSD has no pixel layers.');
  return { doc, entries, pixels };
}

/**
 * Imports an Aseprite file like the editor's File > Import > Aseprite: every image layer becomes a
 * slot on the root bone, placed where it was drawn, with one image per different picture it shows,
 * and each tag (or the whole timeline) an animation that swaps them at Aseprite's frame durations.
 * Pixel art stays sharp (pixel grid 1, nearest filtering). Returns { doc, entries, report }.
 */
export async function importAsepriteFile(file) {
  const name = path.basename(file, path.extname(file));
  let parts;
  try {
    parts = asepriteParts(readAseprite(new Uint8Array(await fs.readFile(file))), name || 'animation');
  } catch (e) {
    throw new ToolError(`Cannot read the Aseprite file: ${e.message}`);
  }
  if (!parts.slots.length) throw new ToolError('No layer of the Aseprite file shows any pixels.');
  const doc = new Skeleton();
  doc.name = name;
  const entries = new Map();
  const report = addAsepriteParts(parts, doc, 0, (base, pic) => {
    const image = uniqueName(base.trim() || 'image', (n) => doc.images.some((i) => i.name === n));
    entries.set(`images/${image}.png`, encodePng({ width: pic.width, height: pic.height, data: pic.data }));
    doc.images.push({ name: image, path: null, width: pic.width, height: pic.height });
    return image;
  });
  applyPixelArt(doc, false, 1);
  return { doc, entries, report };
}

/** Alpha of a work file's images, decoded when first asked for. */
function alphaFromEntries(entries) {
  const cache = new Map();
  return (name) => {
    if (!cache.has(name)) {
      const bytes = entries.get(`images/${name}.png`);
      let alpha = null;
      if (bytes) {
        try {
          alpha = alphaChannel(decodePng(bytes));
        } catch {
          alpha = null;
        }
      }
      cache.set(name, alpha);
    }
    return cache.get(name);
  };
}

/** Artwork to rig: a PSD (imported) or an unrigged .rigby work file. */
async function artwork(ws, args) {
  if ((args.path === undefined) === (args.psd_file === undefined)) throw new ToolError("Give either 'path' (a .rigby work file) or 'psd_file'.");
  if (args.psd_file) {
    const { doc, entries } = await importPsd(await ws.existing(args.psd_file));
    return { doc, entries, alphaOf: alphaFromEntries(entries) };
  }
  const p = await loadProject(await ws.existing(args.path));
  if (p.format !== 'rigby') throw new ToolError('AutoRig needs artwork with its images: a .rigby work file, or a PSD (psd_file).');
  return { doc: p.doc, entries: p.entries, alphaOf: alphaFromEntries(p.entries), project: p };
}

const partSummary = (p) => ({
  name: p.name,
  role: p.role,
  side: p.side,
  found: p.from ?? 'unknown',
  center: p.g.c.map((v) => Math.round(v * 10) / 10),
  size: [Math.round(p.g.box.x1 - p.g.box.x0), Math.round(p.g.box.y1 - p.g.box.y0)],
});

function wrapError(e) {
  if (e instanceof ToolError) return e;
  return new ToolError(e.message);
}

export function createRiggingTools(ws) {
  return [
    {
      name: 'detect_parts',
      title: 'Detect body parts',
      description:
        "Preview Rigby AutoRig on layered artwork: which body part each layer is (head, torso, upperarm, forearm, hand, arm, thigh, shin, foot, leg, eye, mouth, hair, tail, ...), its side and whether that came from the layer name or its position. Nothing is saved. Use the roles and sides arguments of autorig to correct it.",
      inputSchema: { type: 'object', properties: { path: PATH, psd_file: PSD, roles: ROLES, sides: SIDES }, additionalProperties: false },
      annotations: READ_ONLY,
      handler: async (args) => {
        const { doc, alphaOf } = await artwork(ws, args);
        let parts;
        try {
          parts = findParts(doc, alphaOf, args);
        } catch (e) {
          throw wrapError(e);
        }
        return { parts: parts.map(partSummary), unidentified: parts.filter((p) => !p.from || p.role === 'extra').map((p) => p.name) };
      },
    },
    {
      name: 'autorig',
      title: 'AutoRig artwork',
      description:
        "Rigby AutoRig: rig layered artwork in one step. Identifies body parts from layer names (or positions), places joints where parts meet, builds the skeleton (hip, chest, neck, head, arms, legs, face, hair, ears, tail, wings), attaches every layer to its bone, turns parts that bend across bones into weighted meshes (a single arm layer gets an elbow) and adds IK for arms and legs. From psd_file it writes a new .rigby work file to 'output'; from path it rigs an unrigged .rigby work file. The result is ordinary, editable rig data.",
      inputSchema: {
        type: 'object',
        properties: {
          path: PATH,
          psd_file: PSD,
          meshes: { type: 'string', enum: ['deforming', 'all', 'none'], description: "'deforming' (default): meshes for parts that bend across bones; 'all': every part; 'none'." },
          ik: { type: 'boolean', description: 'IK for two-bone arms and legs (default true).' },
          roles: ROLES,
          sides: SIDES,
          output: { ...OUTPUT, description: 'Where to save. Required with psd_file (a new .rigby file).' },
          overwrite: OVERWRITE,
        },
        additionalProperties: false,
      },
      annotations: EDIT,
      handler: async (args) => {
        const rig = (doc, alphaOf) => {
          try {
            return autoRig(doc, alphaOf, args);
          } catch (e) {
            throw wrapError(e);
          }
        };
        if (args.psd_file !== undefined) {
          if (args.path !== undefined) throw new ToolError("Give either 'path' or 'psd_file'.");
          if (!args.output || path.extname(args.output).toLowerCase() !== '.rigby') throw new ToolError("With psd_file, give 'output': the new .rigby work file.");
          const { doc, entries, alphaOf } = await artwork(ws, args);
          const report = rig(doc, alphaOf);
          const target = await ws.writable(args.output);
          if (!args.overwrite && (await fs.stat(target).then(() => true, () => false))) throw new ToolError(`${args.output} already exists. Pass overwrite: true to replace it.`);
          const file = await save(ws, { file: target, format: 'rigby', doc, entries }, {});
          return { file, ...report };
        }
        return edit(ws, args, (doc, p) => {
          if (p.format !== 'rigby') throw new ToolError('AutoRig needs artwork with its images: a .rigby work file, or a PSD (psd_file).');
          return rig(doc, alphaFromEntries(p.entries));
        });
      },
    },
    {
      name: 'import_aseprite',
      title: 'Import an Aseprite file',
      description:
        "Turns an Aseprite file (.aseprite / .ase) into a new .rigby work file, like the editor's File > Import > Aseprite: every image layer becomes a slot on the root bone where it was drawn, with one image per different picture it shows; each tag (or the whole timeline) becomes an animation that swaps the images at Aseprite's frame durations. Hidden layers become variant animations. Pixel art stays sharp. Rig it afterwards with autorig or the edit tools.",
      inputSchema: {
        type: 'object',
        properties: {
          aseprite_file: { type: 'string', description: 'The Aseprite file (.aseprite or .ase) inside the workspace.' },
          output: { ...OUTPUT, description: 'The new .rigby work file to write.' },
          overwrite: OVERWRITE,
        },
        required: ['aseprite_file', 'output'],
        additionalProperties: false,
      },
      annotations: EDIT,
      handler: async (args) => {
        if (!['.aseprite', '.ase'].includes(path.extname(args.aseprite_file).toLowerCase())) throw new ToolError("'aseprite_file' must be an .aseprite or .ase file.");
        if (path.extname(args.output).toLowerCase() !== '.rigby') throw new ToolError("'output' must be a .rigby work file.");
        const { doc, entries, report } = await importAsepriteFile(await ws.existing(args.aseprite_file));
        const err = doc.validate();
        if (err) throw new ToolError(`The import would make an invalid project: ${err}`);
        const target = await ws.writable(args.output);
        if (!args.overwrite && (await fs.stat(target).then(() => true, () => false))) throw new ToolError(`${args.output} already exists. Pass overwrite: true to replace it.`);
        const file = await save(ws, { file: target, format: 'rigby', doc, entries }, {});
        return {
          file,
          slots: doc.slots.map((sl) => sl.name),
          images: report.images,
          animations: doc.animations.map((a) => ({ name: a.name, duration: Math.round(a.duration * 1000) / 1000 })),
          ...(report.baked.length ? { baked: report.baked } : {}),
          ...(report.skipped.length ? { skipped: report.skipped } : {}),
        };
      },
    },
    {
      name: 'map_bones',
      title: 'Map bones',
      description: 'Preview how retarget_animation matches the bones of a source character to a target character: by name, similar name ("L_Arm" and "arm.l"), body part ("UpperArm_Left" and "upperarm_l") or your mapping. Lists unmatched bones.',
      inputSchema: { type: 'object', properties: { source: { ...PATH, description: 'Character the animation comes from.' }, path: { ...PATH, description: 'Character to retarget to.' }, mapping: MAPPING }, required: ['source', 'path'], additionalProperties: false },
      annotations: READ_ONLY,
      handler: async (args) => {
        const s = await loadProject(await ws.existing(args.source));
        const t = await loadProject(await ws.existing(args.path));
        let m;
        try {
          m = mapBones(s.doc, t.doc, args.mapping ?? {});
        } catch (e) {
          throw wrapError(e);
        }
        return {
          mapped: m.pairs.map((p) => ({ source: s.doc.bones[p.source].name, target: t.doc.bones[p.target].name, how: p.how })),
          unmatched: m.unmapped.map((i) => s.doc.bones[i].name),
          targetUnused: t.doc.bones.filter((_, i) => !m.pairs.some((p) => p.target === i)).map((b) => b.name),
        };
      },
    },
    {
      name: 'retarget_animation',
      title: 'Retarget animation',
      description:
        "Copy animations from one character to another (any format): bones are matched automatically (see map_bones; override with mapping), movement is scaled to the target's size (scale 'auto') and rotated into its bones' frames, curves are kept, and slot, event and IK keys follow by name. mode 'relative' (default) keeps the target's own rest pose; 'world' makes bones point the way the source's do, compensating for different rest poses. Saves the target.",
      inputSchema: {
        type: 'object',
        properties: {
          source: { ...PATH, description: 'Character the animations come from.' },
          path: { ...PATH, description: 'Character to retarget to (saved).' },
          animation: { type: 'string', description: 'Source animation.' },
          animations: { type: 'array', items: { type: 'string' }, description: 'Several source animations, instead of animation.' },
          name: { type: 'string', description: 'Name in the target (single animation only; default: the same name).' },
          mode: { type: 'string', enum: ['relative', 'world'] },
          scale: { type: 'number', exclusiveMinimum: 0, description: "Movement scale (default: target height / source height)." },
          mapping: MAPPING,
          replace: { type: 'boolean', description: 'Replace target animations with the same name.' },
          output: OUTPUT,
          overwrite: OVERWRITE,
        },
        required: ['source', 'path'],
        additionalProperties: false,
      },
      annotations: EDIT,
      handler: async (args) => {
        const names = args.animations ?? (args.animation !== undefined ? [args.animation] : []);
        if (!names.length) throw new ToolError("Give 'animation' or 'animations'.");
        if (args.name !== undefined && names.length > 1) throw new ToolError("'name' works with a single animation.");
        const s = await loadProject(await ws.existing(args.source));
        return edit(ws, args, (doc) => {
          const results = [];
          for (const n of names) {
            try {
              results.push(retarget(s.doc, n, doc, { name: args.name, mode: args.mode, scale: args.scale, mapping: args.mapping, replace: args.replace }).report);
            } catch (e) {
              throw wrapError(e);
            }
          }
          return names.length === 1 ? results[0] : { animations: results };
        });
      },
    },
  ];
}
