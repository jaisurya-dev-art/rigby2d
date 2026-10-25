// SPDX-License-Identifier: MIT OR Apache-2.0
// MCP tools over Rigby2D projects: inspect, describe, sample, validate and convert `.rigby` work
// files and skeleton `.json` / `.skel` exports. Every path is confined to the workspace roots.

import fs from 'node:fs/promises';
import path from 'node:path';

import { parseAtlas } from '../core/atlas.js';
import { isSkeletonBinary, readSkeletonBinary, writeSkeletonBinary } from '../core/binary.js';
import { listConstraints } from '../core/constraintdata.js';
import { isSkeletonJson, readSkeletonJson, writeSkeletonJson } from '../core/interop.js';
import { Skeleton } from '../core/model.js';
import { Pose } from '../core/pose.js';
import { usedImages } from '../editor/io.js';
import { unzip } from '../editor/zip.js';
import { filmSummary } from './film.js';
import { ToolError } from './protocol.js';

const JSON_VERSIONS = ['3.8', '4.2', '4.3'];
const round = (v, digits = 4) => (Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : v);

// ---- workspace --------------------------------------------------------------------------------

/** Directories the tools may read and write. Paths outside them are refused. */
export class Workspace {
  /** `roots`: absolute or relative directories (resolved against the current directory). */
  static async open(roots) {
    const resolved = [];
    for (const r of roots.length ? roots : [process.cwd()]) {
      try {
        resolved.push(await fs.realpath(path.resolve(r)));
      } catch {
        throw new Error(`workspace root not found: ${r}`);
      }
    }
    return new Workspace(resolved);
  }

  constructor(roots) {
    this.roots = roots;
  }

  inside(p) {
    return this.roots.some((root) => {
      const rel = path.relative(root, p);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
  }

  /** An existing file inside the workspace (relative paths resolve against the first root). */
  async existing(p) {
    let real;
    try {
      real = await fs.realpath(path.resolve(this.roots[0], p));
    } catch {
      throw new ToolError(`File not found: ${p}`);
    }
    if (!this.inside(real)) throw new ToolError(`Access denied: ${p} is outside the workspace (${this.roots.join(', ')}).`);
    return real;
  }

  /** A file to write inside the workspace; its folder must exist. */
  async writable(p) {
    const target = path.resolve(this.roots[0], p);
    let dir;
    try {
      dir = await fs.realpath(path.dirname(target));
    } catch {
      throw new ToolError(`Folder not found: ${path.dirname(target)}`);
    }
    const real = path.join(dir, path.basename(target));
    if (!this.inside(real)) throw new ToolError(`Access denied: ${p} is outside the workspace (${this.roots.join(', ')}).`);
    return real;
  }
}

// ---- loading ----------------------------------------------------------------------------------

/**
 * Loads a project file. Returns { file, format ('rigby' | 'json' | 'skel'), version, doc,
 * warnings, images (names available: work file images or atlas regions, or null when unknown),
 * imageSource, entries (work files: every ZIP entry, to write the images back unchanged) }.
 */
export async function loadProject(file) {
  const bytes = new Uint8Array(await fs.readFile(file));
  const ext = path.extname(file).toLowerCase();
  const stem = path.basename(file, path.extname(file));
  if (ext === '.rigby') {
    let entries;
    try {
      entries = unzip(bytes);
    } catch (e) {
      throw new ToolError(`Not a readable .rigby work file: ${e.message}`);
    }
    const project = entries.get('project.json');
    if (!project) throw new ToolError('Not a Rigby2D work file: project.json is missing.');
    let doc;
    try {
      doc = Skeleton.fromJson(new TextDecoder().decode(project));
    } catch (e) {
      throw new ToolError(`The work file's project data is invalid: ${e.message}`);
    }
    const images = [...entries.keys()].filter((k) => k.startsWith('images/') && k.endsWith('.png')).map((k) => k.slice(7, -4));
    return { file, format: 'rigby', version: String(doc.format), doc, warnings: [], images, imageSource: 'work file', entries };
  }
  let obj;
  if (ext === '.skel' || isSkeletonBinary(bytes)) {
    try {
      obj = readSkeletonBinary(bytes);
    } catch (e) {
      throw new ToolError(`Cannot read binary skeleton: ${e.message}`);
    }
  } else if (ext === '.json') {
    try {
      obj = JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      throw new ToolError(`Invalid JSON: ${e.message}`);
    }
    if (!isSkeletonJson(obj)) throw new ToolError('This JSON file is not a skeleton export.');
  } else {
    throw new ToolError(`Unsupported file type '${ext || path.basename(file)}': use .rigby, .json or .skel.`);
  }
  let read;
  try {
    read = readSkeletonJson(obj, stem);
  } catch (e) {
    throw new ToolError(`Cannot read skeleton: ${e.message}`);
  }
  const { images, imageSource } = await findImages(file, stem, obj, usedImages(read.skeleton));
  return { file, format: ext === '.json' ? 'json' : 'skel', version: read.skeleton.header?.version ?? null, doc: read.skeleton, warnings: read.warnings, images, imageSource };
}

/**
 * Image names next to a skeleton export: the regions of its texture atlas, else the files in its
 * images folder. The atlas is `<name>.atlas` when present, otherwise the .atlas file in the same
 * folder that holds the most of the images the skeleton uses (exports often share one atlas).
 */
async function findImages(file, stem, obj, needed) {
  const dir = path.dirname(file);
  const names = await fs.readdir(dir).catch(() => []);
  const exact = [`${stem}.atlas`, `${stem}.atlas.txt`].find((n) => names.includes(n));
  const candidates = exact ? [exact] : names.filter((n) => /.atlas(.txt)?$/i.test(n)).sort();
  const want = new Set(needed);
  let best = null;
  for (const name of candidates) {
    let regions;
    try {
      const atlas = parseAtlas(await fs.readFile(path.join(dir, name), 'utf8'));
      regions = atlas.pages.flatMap((p) => p.regions.map((r) => (r.index >= 0 ? `${r.name}${r.index}` : r.name)));
    } catch {
      continue;
    }
    const covered = regions.filter((r) => want.has(r)).length;
    if (!best || covered > best.covered) best = { name, regions, covered };
  }
  if (best) return { images: best.regions, imageSource: `atlas ${best.name}` };
  const folder = path.join(dir, (obj.skeleton?.images ?? '').trim() || 'images');
  const files = await listImagesRecursive(folder);
  return files ? { images: files, imageSource: `folder ${path.relative(dir, folder) || '.'}` } : { images: null, imageSource: null };
}

async function listImagesRecursive(root) {
  const out = [];
  const walk = async (dir) => {
    for (const e of await fs.readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (/\.(png|jpe?g)$/i.test(e.name)) out.push(path.relative(root, p).replace(/\\/g, '/').replace(/\.(png|jpe?g)$/i, ''));
    }
  };
  try {
    await walk(root);
  } catch {
    return null;
  }
  return out;
}

// ---- descriptions ---------------------------------------------------------------------------

function timelineCount(anim) {
  const extra = Object.values(anim.extra ?? {}).reduce((n, v) => n + (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0), 0);
  return anim.bones.length + anim.slots.length + anim.deform.length + anim.ik.length + (anim.drawOrder.length ? 1 : 0) + (anim.events.length ? 1 : 0) + extra;
}

const attachmentInfo = (a) => ({ name: a.name, type: a.type ?? 'region', ...(a.image && a.image !== a.name ? { image: a.image } : {}) });

function summary(p) {
  const { doc } = p;
  const constraints = listConstraints(doc).map((c) => ({ type: c.type, name: c.name }));
  return {
    file: p.file,
    format: p.format,
    version: p.version,
    name: doc.name,
    workspace: doc.workspace ?? (p.format === 'rigby' ? 'default' : 'game'),
    ...(doc.textureFilter !== 'linear' ? { textureFilter: doc.textureFilter } : {}),
    counts: {
      bones: doc.bones.length,
      slots: doc.slots.length,
      skins: doc.skins.length + 1,
      constraints: constraints.length,
      events: doc.events.length,
      animations: doc.animations.length,
      images: usedImages(doc).length,
    },
    animations: doc.animations.map((a) => ({ name: a.name, duration: round(a.duration), timelines: timelineCount(a), events: a.events.length })),
    skins: ['default', ...doc.skins.map((s) => s.name)],
    constraints,
    events: doc.events.map((e) => e.name),
    // Work files also hold the film output, the pose library, face controls and audio tracks.
    ...(p.format === 'rigby' ? { film: filmSummary(doc) } : {}),
    warnings: p.warnings,
  };
}

function rig(doc) {
  return {
    bones: doc.bones.map((b) => ({
      name: b.name,
      parent: b.parent === null ? null : doc.bones[b.parent].name,
      length: round(b.length),
      x: round(b.setup.x),
      y: round(b.setup.y),
      rotation: round(b.setup.rotation),
      scaleX: round(b.setup.scale_x),
      scaleY: round(b.setup.scale_y),
      shearX: round(b.setup.shear_x),
      shearY: round(b.setup.shear_y),
      inherit: b.inherit ?? 'normal',
    })),
    slots: doc.slots.map((s) => ({
      name: s.name,
      bone: doc.bones[s.bone]?.name ?? null,
      attachment: s.attachment,
      blend: s.blend ?? 'normal',
      attachments: s.attachments.map(attachmentInfo),
    })),
    skins: doc.skins.map((skin) => ({
      name: skin.name,
      attachments: skin.slots.map((e) => ({ slot: doc.slots[e.slot]?.name ?? null, attachments: e.attachments.map(attachmentInfo) })),
    })),
  };
}

const keyTimes = (keys) => keys.map((k) => round(k.time));

function describeAnimation(doc, anim) {
  const channels = (tl, names) => Object.fromEntries(names.filter((ch) => tl[ch]?.length).map((ch) => [ch, keyTimes(tl[ch])]));
  const BONE = ['rotate', 'translate', 'scale', 'shear', 'translateX', 'translateY', 'scaleX', 'scaleY', 'shearX', 'shearY', 'inherit'];
  const SLOT = ['attachment', 'color', 'rgb', 'alpha', 'rgba2', 'rgb2'];
  return {
    name: anim.name,
    duration: round(anim.duration),
    bones: anim.bones.map((tl) => ({ bone: doc.bones[tl.bone]?.name ?? null, keys: channels(tl, BONE) })),
    slots: anim.slots.map((tl) => ({
      slot: doc.slots[tl.slot]?.name ?? null,
      keys: channels(tl, SLOT),
      ...(tl.attachment?.length ? { attachmentKeys: tl.attachment.map((k) => ({ time: round(k.time), name: k.value })) } : {}),
    })),
    deform: anim.deform.map((tl) => ({ skin: tl.skin ?? 'default', slot: doc.slots[tl.slot]?.name ?? null, attachment: tl.attachment, keys: keyTimes(tl.keys) })),
    ik: anim.ik.map((tl) => ({ constraint: doc.ik[tl.constraint]?.name ?? tl.constraint, keys: keyTimes(tl.keys) })),
    drawOrder: keyTimes(anim.drawOrder),
    events: anim.events.map((e) => ({ time: round(e.time), name: e.name })),
    otherTimelines: Object.keys(anim.extra ?? {}),
  };
}

function findAnimation(doc, name) {
  const anim = doc.animations.find((a) => a.name === name);
  if (!anim) throw new ToolError(`No animation '${name}'. Animations: ${doc.animations.map((a) => a.name).join(', ') || 'none'}.`);
  return anim;
}

function samplePose(doc, { animation, time = 0, skin }) {
  if (skin !== undefined && skin !== 'default' && !doc.skins.some((s) => s.name === skin)) {
    throw new ToolError(`No skin '${skin}'. Skins: default, ${doc.skins.map((s) => s.name).join(', ')}.`);
  }
  doc.skin = skin === undefined || skin === 'default' ? null : skin;
  const anim = animation === undefined ? null : findAnimation(doc, animation);
  const pose = new Pose(doc);
  pose.reset(doc);
  if (anim) pose.apply(doc, anim, time, 1);
  pose.updateWorld(doc);
  let bounds = null;
  for (const q of pose.quads(doc)) {
    for (const [x, y] of q.positions) {
      bounds ??= { minX: x, minY: y, maxX: x, maxY: y };
      bounds.minX = Math.min(bounds.minX, x);
      bounds.minY = Math.min(bounds.minY, y);
      bounds.maxX = Math.max(bounds.maxX, x);
      bounds.maxY = Math.max(bounds.maxY, y);
    }
  }
  return {
    animation: anim?.name ?? null,
    time: round(time),
    skin: skin ?? 'default',
    bones: doc.bones.map((b, i) => {
      const w = pose.world[i].decompose();
      return { name: b.name, x: round(w.x, 3), y: round(w.y, 3), rotation: round(w.rotation, 3), scaleX: round(w.scale_x), scaleY: round(w.scale_y) };
    }),
    slots: doc.slots.map((s, i) => ({ name: s.name, attachment: pose.slotAttachment(doc, i)?.name ?? null })),
    drawOrder: [...pose.drawOrder].map((i) => doc.slots[i]?.name),
    eventsUpToTime: anim ? anim.events.filter((e) => e.time <= time).map((e) => ({ time: round(e.time), name: e.name })) : [],
    bounds: bounds && Object.fromEntries(Object.entries(bounds).map(([k, v]) => [k, round(v, 2)])),
  };
}

// ---- validation -------------------------------------------------------------------------------

/**
 * Document data for round-trip checks, without what files do not carry as data: the import header,
 * the image table and format bookkeeping kept under `_` keys in `extra` (binary string table, editor
 * visibility). Bezier curves are compared by kind: files store their control points in absolute
 * units, rounded, while presets and edits keep a normalized form, so the numbers legitimately
 * differ after a round trip.
 */
function roundTripData(doc) {
  const o = doc.toObject();
  delete o.header;
  delete o.images;
  delete o.name;
  // Output settings, poses and controllers are project data, not skeleton data.
  delete o.settings;
  delete o.poses;
  delete o.controllers;
  delete o.workspace;
  delete o.audio;
  delete o.textureFilter;
  return normalize(o);
}

function normalize(v) {
  if (Array.isArray(v)) return v.map(normalize);
  if (v === null || typeof v !== 'object') return v;
  if ('bezier' in v || 'beziers' in v) return 'bezier';
  const out = {};
  for (const [k, x] of Object.entries(v)) {
    if (k === 'extra' && x && typeof x === 'object') {
      const kept = Object.fromEntries(Object.entries(x).filter(([e]) => !e.startsWith('_')));
      if (Object.keys(kept).length) out.extra = normalize(kept);
      continue;
    }
    out[k] = normalize(x);
  }
  return out;
}

/** Deep equality where numbers may differ by the rounding skeleton files use (5 decimals). */
function sameData(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-4 * Math.max(1, Math.abs(a), Math.abs(b));
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return a === b;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if (!sameData(a[k], b[k])) return false;
  return true;
}

function validate(p) {
  const { doc } = p;
  const errors = [];
  const warnings = [...p.warnings];
  const structure = doc.validate();
  if (structure) errors.push(`Structure: ${structure}.`);

  const needed = usedImages(doc);
  let missingImages = [];
  if (p.images) {
    const have = new Set(p.images);
    missingImages = needed.filter((n) => !have.has(n));
    if (missingImages.length) errors.push(`${missingImages.length} image(s) missing from the ${p.imageSource}: ${missingImages.slice(0, 20).join(', ')}${missingImages.length > 20 ? ', …' : ''}.`);
  } else if (needed.length) {
    warnings.push(`No .atlas or images folder found next to the file, so the ${needed.length} image(s) it uses were not checked.`);
  }

  for (const a of doc.animations) {
    if (!timelineCount(a)) warnings.push(`Animation '${a.name}' has no keys.`);
  }

  let roundTrip = 'ok';
  try {
    const { json } = writeSkeletonJson(doc, { version: '4.3' });
    const back = readSkeletonJson(JSON.parse(JSON.stringify(json)), doc.name).skeleton;
    if (!sameData(roundTripData(back), roundTripData(doc))) {
      roundTrip = 'changed';
      warnings.push('Writing skeleton JSON 4.3 and reading it back does not reproduce the data exactly.');
    }
  } catch (e) {
    roundTrip = 'failed';
    errors.push(`Skeleton JSON export fails: ${e.message}`);
  }

  let binaryExport = 'ok';
  try {
    writeSkeletonBinary(writeSkeletonJson(doc, { version: '4.3', binary: true }).json);
  } catch (e) {
    binaryExport = e.message;
    warnings.push(`Binary .skel export is not possible: ${e.message}`);
  }

  return {
    file: p.file,
    format: p.format,
    valid: errors.length === 0,
    errors,
    warnings,
    checks: { structure: structure ? 'failed' : 'ok', images: p.images ? (missingImages.length ? 'missing' : 'ok') : 'not checked', jsonRoundTrip: roundTrip, binaryExport },
  };
}

// ---- conversion -------------------------------------------------------------------------------

async function convert(ws, { input, output, version = '4.3', overwrite = false }) {
  const source = await ws.existing(input);
  const target = await ws.writable(output);
  if (path.resolve(source) === path.resolve(target)) throw new ToolError('The output must be a different file than the input.');
  const ext = path.extname(target).toLowerCase();
  if (ext !== '.json' && ext !== '.skel') throw new ToolError("The output must end in .json or .skel (write .rigby work files from the editor, which holds the images).");
  if (ext === '.skel' && version !== '4.3') throw new ToolError('Binary .skel files are written as format 4.3.');
  if (!overwrite) {
    const exists = await fs.stat(target).then(() => true, () => false);
    if (exists) throw new ToolError(`${output} already exists. Pass overwrite: true to replace it.`);
  }
  const p = await loadProject(source);
  let bytes;
  let warnings;
  try {
    if (ext === '.skel') {
      const out = writeSkeletonJson(p.doc, { version: '4.3', binary: true });
      bytes = writeSkeletonBinary(out.json);
      warnings = out.warnings;
    } else {
      const out = writeSkeletonJson(p.doc, { version });
      bytes = new TextEncoder().encode(JSON.stringify(out.json, null, 2));
      warnings = out.warnings;
    }
  } catch (e) {
    throw new ToolError(`Conversion failed: ${e.message}`);
  }
  await fs.writeFile(target, bytes);
  return {
    input: source,
    output: target,
    format: ext.slice(1),
    version: ext === '.skel' ? '4.3' : version,
    bytes: bytes.length,
    warnings,
    note: 'Only skeleton data is written. Use the existing .atlas and page images, or export from the Rigby2D editor to repack them.',
  };
}

// ---- tool table -------------------------------------------------------------------------------

export const PATH = { type: 'string', description: 'Project file: a .rigby work file or a skeleton .json / .skel export. Relative paths resolve against the first workspace root.' };
export const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

/** The tools, bound to a workspace. */
export function createTools(ws) {
  const load = async (p) => loadProject(await ws.existing(p));
  return [
    {
      name: 'inspect_project',
      title: 'Inspect project',
      description: 'Summarize a Rigby2D project file: format and version, counts of bones, slots, skins, constraints, events and images, the animations with their durations, and any read warnings.',
      inputSchema: { type: 'object', properties: { path: PATH }, required: ['path'], additionalProperties: false },
      annotations: READ_ONLY,
      handler: async ({ path: p }) => summary(await load(p)),
    },
    {
      name: 'describe_rig',
      title: 'Describe rig',
      description: 'List the bone hierarchy with setup-pose transforms (Y up, degrees), the slots in draw order with their attachments, and the attachments of each extra skin.',
      inputSchema: { type: 'object', properties: { path: PATH }, required: ['path'], additionalProperties: false },
      annotations: READ_ONLY,
      handler: async ({ path: p }) => ({ file: (await ws.existing(p)), ...rig((await load(p)).doc) }),
    },
    {
      name: 'describe_animation',
      title: 'Describe animation',
      description: 'Show one animation: its duration, the key times of every bone, slot, deform, IK and draw-order timeline, its events, and other timelines it holds.',
      inputSchema: {
        type: 'object',
        properties: { path: PATH, animation: { type: 'string', description: 'Animation name (see inspect_project).' } },
        required: ['path', 'animation'],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      handler: async ({ path: p, animation }) => {
        const { doc } = await load(p);
        return describeAnimation(doc, findAnimation(doc, animation));
      },
    },
    {
      name: 'sample_pose',
      title: 'Sample pose',
      description: 'Evaluate the skeleton with the Rigby2D runtime: the setup pose, or an animation at a time. Returns world transforms of every bone, the visible attachment of each slot, the draw order, events up to that time and the bounds of everything drawn.',
      inputSchema: {
        type: 'object',
        properties: {
          path: PATH,
          animation: { type: 'string', description: 'Animation to apply. Omit for the setup pose.' },
          time: { type: 'number', minimum: 0, description: 'Time in seconds (default 0).' },
          skin: { type: 'string', description: "Skin to show (default 'default')." },
        },
        required: ['path'],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      handler: async ({ path: p, ...opts }) => samplePose((await load(p)).doc, opts),
    },
    {
      name: 'validate_project',
      title: 'Validate project',
      description: 'Check a project for problems: structure, images missing from its work file, atlas or images folder, animations without keys, whether skeleton JSON 4.3 round-trips the data exactly, and whether binary .skel export is possible.',
      inputSchema: { type: 'object', properties: { path: PATH }, required: ['path'], additionalProperties: false },
      annotations: READ_ONLY,
      handler: async ({ path: p }) => validate(await load(p)),
    },
    {
      name: 'convert_project',
      title: 'Convert project',
      description: 'Write a project as skeleton JSON (format 3.8, 4.2 or 4.3) or binary .skel (4.3). Reads .rigby, .json or .skel. Writes skeleton data only; atlas and images are not repacked. Refuses to replace an existing file unless overwrite is true.',
      inputSchema: {
        type: 'object',
        properties: {
          input: PATH,
          output: { type: 'string', description: 'Output file ending in .json or .skel, inside the workspace. Its folder must exist.' },
          version: { type: 'string', enum: JSON_VERSIONS, description: 'Skeleton JSON format version (default 4.3; .skel is always 4.3).' },
          overwrite: { type: 'boolean', description: 'Replace the output file if it exists (default false).' },
        },
        required: ['input', 'output'],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
      handler: (args) => convert(ws, args),
    },
  ];
}
