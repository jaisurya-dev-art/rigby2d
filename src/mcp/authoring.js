// SPDX-License-Identifier: MIT OR Apache-2.0
// MCP authoring tools: constraint keys and world-space IK target keys, skins and attachment copies,
// meshes and weights, and physics baking (edit tools, so batch_edit takes them); plus two read-only
// tools, world_to_local and lint_animations. Built on the same helpers as the editor (meshdata.js,
// constraintkeys.js, keying.js), so a mesh or key made here is the one the editor would make.

import { setKey } from '../core/animation.js';
import { listConstraints } from '../core/constraintdata.js';
import { compileConstraints } from '../core/constraints.js';
import { constraintChannels, setConstraintCurve, setConstraintKey, setIkKey } from '../core/constraintkeys.js';
import { LINEAR } from '../core/curve.js';
import { normalizeWeights } from '../core/meshgeom.js';
import { MESH_DEFAULTS, generateMesh } from '../core/meshgen.js';
import { findAttachment } from '../core/model.js';
import { Pose } from '../core/pose.js';
import { poseAt, writeTargets } from '../core/keying.js';
import { bindMesh, meshState, regionToMesh, writeMesh } from '../editor/meshdata.js';
import { alphaOf, decodePng } from './png.js';
import { ToolError } from './protocol.js';
import { PATH, READ_ONLY, loadProject } from './tools.js';

const fail = (message) => {
  throw new ToolError(message);
};
const SAME_TIME = 5e-4;
const roundTime = (t) => Math.round(t * 1e6) / 1e6;
const NAME = (what) => ({ type: 'string', description: `${what} name.` });
const CURVE = {
  description: "Interpolation to the next key: 'linear' (default), 'stepped', 'easeIn', 'easeOut', 'easeInOut', or a custom cubic bezier [cx1, cy1, cx2, cy2].",
  anyOf: [
    { type: 'string', enum: ['linear', 'stepped', 'easeIn', 'easeOut', 'easeInOut'] },
    { type: 'array', items: { type: 'number' }, minItems: 4, maxItems: 4 },
  ],
};
const PRESETS = { linear: 'linear', stepped: 'stepped', easeIn: [0.42, 0, 1, 1], easeOut: [0, 0, 0.58, 1], easeInOut: [0.42, 0, 0.58, 1] };

/** A curve argument as the key curve the model stores ('linear', 'stepped' or { bezier }). */
function curveOf(curve = 'linear') {
  const c = typeof curve === 'string' ? PRESETS[curve] : curve;
  if (c === undefined) fail(`Unknown curve '${curve}'. Use ${Object.keys(PRESETS).join(', ')}, or [cx1, cy1, cx2, cy2].`);
  if (typeof c === 'string') return c;
  if (!Array.isArray(c) || c.length !== 4 || !c.every(Number.isFinite) || c[0] < 0 || c[0] > 1 || c[2] < 0 || c[2] > 1) fail('A custom curve is [cx1, cy1, cx2, cy2] with cx1 and cx2 within 0..1.');
  return { bezier: c.slice() };
}

const boneOf = (doc, name) => {
  const i = doc.bones.findIndex((b) => b.name === name);
  if (i < 0) fail(`No bone '${name}'.`);
  return i;
};
const slotOf = (doc, name) => {
  const i = doc.slots.findIndex((s) => s.name === name);
  if (i < 0) fail(`No slot '${name}'. Slots: ${doc.slots.map((s) => s.name).join(', ') || 'none'}.`);
  return i;
};
const animOf = (doc, name) => doc.animations.find((a) => a.name === name) ?? fail(`No animation '${name}'. Animations: ${doc.animations.map((a) => a.name).join(', ') || 'none'}.`);
const constraintOf = (doc, name) => listConstraints(doc).find((c) => c.name === name) ?? fail(`No constraint '${name}'. Constraints: ${listConstraints(doc).map((c) => c.name).join(', ') || 'none'}.`);
const skinOf = (doc, name) => doc.findSkin(name) ?? fail(`No skin '${name}'. Skins: ${doc.skins.map((s) => s.name).join(', ') || 'none'}.`);
const extend = (anim, time) => {
  if (time > anim.duration) anim.duration = time;
};

/** The attachment list of a slot in a skin (the default skin when `skin` is null or 'default'). */
function attachmentsIn(doc, slot, skin, create = false) {
  if (!skin || skin === 'default') return doc.slots[slot].attachments;
  const s = skinOf(doc, skin);
  let entry = s.slots.find((e) => e.slot === slot);
  if (!entry && create) s.slots.push((entry = { slot, attachments: [] }));
  return entry?.attachments ?? [];
}

/** A slot's attachment by name, in `skin` (default skin when left out). */
function attachmentOf(doc, slotName, name, skin) {
  const slot = slotOf(doc, slotName);
  const list = attachmentsIn(doc, slot, skin);
  const att = list.find((a) => a.name === name) ?? fail(`Slot '${slotName}' has no attachment '${name}'${skin ? ` in skin '${skin}'` : ''}. Attachments: ${list.map((a) => a.name).join(', ') || 'none'}.`);
  return { slot, att };
}

const meshOf = (doc, args) => {
  const { slot, att } = attachmentOf(doc, args.slot, args.attachment, args.skin);
  if (att.type !== 'mesh') fail(`'${args.attachment}' is a ${att.type}, not a mesh. Make one with make_mesh.`);
  return { slot, att };
};

/** Keys of a constraint value: the channels a set of values touches, per constraint type. */
function constraintKeyValues(type, values) {
  const out = [];
  for (const { channel, fields, defaults } of constraintChannels(type)) {
    const picked = {};
    if (channel === null || fields.length > 1) {
      for (const f of fields) if (values[f] !== undefined) picked[f] = values[f];
    } else if (values[channel] !== undefined) picked.value = values[channel];
    if (Object.keys(picked).length) out.push({ channel, fields, defaults, picked });
  }
  return out;
}

const KEYABLE = {
  ik: ['mix', 'softness', 'bendPositive', 'compress', 'stretch'],
  transform: ['mixRotate', 'mixX', 'mixY', 'mixScaleX', 'mixScaleY', 'mixShearY'],
  path: ['position', 'spacing', 'mixRotate', 'mixX', 'mixY'],
  physics: ['inertia', 'strength', 'damping', 'mass', 'wind', 'gravity', 'mix'],
  slider: ['time', 'mix'],
};

/** Edit tools ({ name, title, description, inputSchema, annotations, apply(doc, args, project) }). */
export function authoringTools(base, EDIT) {
  const tool = (name, title, description, properties, required, apply) => ({
    name,
    title,
    description,
    inputSchema: { type: 'object', properties: { ...base, ...properties }, required: ['path', ...required], additionalProperties: false },
    annotations: EDIT,
    apply,
  });
  const MESH = { slot: NAME('Slot'), attachment: NAME('Attachment'), skin: { type: 'string', description: 'Skin holding the attachment (default skin when left out).' } };

  return [
    // ---- constraint keys ---------------------------------------------------------------------
    tool(
      'set_constraint_key',
      'Set constraint key',
      `Key a constraint's values in an animation (replacing a key at the same time). Keyable values: IK ${KEYABLE.ik.join(', ')}; transform ${KEYABLE.transform.join(', ')}; path ${KEYABLE.path.join(', ')}; physics ${KEYABLE.physics.join(', ')}; slider ${KEYABLE.slider.join(', ')}. Values left out keep what the constraint has at that time. The animation grows to include the key. Saves the project.`,
      { animation: NAME('Animation'), constraint: NAME('Constraint'), time: { type: 'number', minimum: 0, description: 'Seconds.' }, values: { type: 'object' }, curve: CURVE },
      ['animation', 'constraint', 'time', 'values'],
      (doc, args) => {
        const anim = animOf(doc, args.animation);
        const c = constraintOf(doc, args.constraint);
        const time = roundTime(args.time);
        const allowed = KEYABLE[c.type] ?? [];
        for (const [k, v] of Object.entries(args.values)) {
          if (!allowed.includes(k)) fail(`${c.type} constraints have no keyable value '${k}'. Keyable: ${allowed.join(', ')}.`);
          if (typeof v !== (k === 'bendPositive' || k === 'compress' || k === 'stretch' ? 'boolean' : 'number')) fail(`'${k}' must be a ${k === 'bendPositive' || k === 'compress' || k === 'stretch' ? 'boolean' : 'number'}.`);
        }
        if (!Object.keys(args.values).length) fail('Give at least one value to key.');
        const curve = curveOf(args.curve);
        if (c.type === 'ik') {
          const st = poseAt(doc, anim, time).ik[c.ik];
          const value = { mix: st.mix, softness: st.softness, bendPositive: st.bendPositive, compress: st.compress, stretch: st.stretch, ...args.values };
          setIkKey(anim, c.ik, time, value);
          const keys = anim.ik.find((t) => t.constraint === c.ik).keys;
          keys.find((k) => Math.abs(k.time - time) < SAME_TIME).curve = curve;
        } else {
          for (const { channel, fields, defaults, picked } of constraintKeyValues(c.type, args.values)) {
            const key = setConstraintKey(anim, c.type, c.name, channel, time, picked);
            const keys = channel === null ? anim.extra[c.type][c.name] : anim.extra[c.type][c.name][channel];
            const i = keys.indexOf(key);
            setConstraintCurve(keys, i, fields, defaults, curve);
            // The key before keeps its shape toward the new key.
            if (i > 0 && keys[i - 1].curve && keys[i - 1].curve !== 'stepped') setConstraintCurve(keys, i - 1, fields, defaults, LINEAR);
          }
        }
        extend(anim, time);
        return { animation: anim.name, constraint: c.name, type: c.type, time, values: args.values };
      },
    ),
    tool(
      'set_ik_target_key',
      'Set IK target key',
      "Key an IK constraint's target bone so it reaches a world point (Y up) at a time, using the pose at that time: the point is converted into the target's parent space and keyed as translate (an offset from the setup pose). Saves the project.",
      { animation: NAME('Animation'), constraint: NAME('IK constraint'), time: { type: 'number', minimum: 0 }, world_point: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, curve: CURVE },
      ['animation', 'constraint', 'time', 'world_point'],
      (doc, args) => {
        const anim = animOf(doc, args.animation);
        const c = constraintOf(doc, args.constraint);
        if (c.type !== 'ik') fail(`'${c.name}' is a ${c.type} constraint, not IK.`);
        const time = roundTime(args.time);
        const bone = doc.ik[c.ik].target;
        const pose = poseAt(doc, anim, time);
        const parent = doc.bones[bone].parent;
        const [x, y] = parent === null ? args.world_point : pose.world[parent].inverse().apply(args.world_point);
        const setup = doc.bones[bone].setup;
        const value = [roundTime(x - setup.x), roundTime(y - setup.y)];
        const keys = anim.boneTimelineMut(bone).translate;
        const i = setKey(keys, time, value);
        keys[i].curve = curveOf(args.curve);
        extend(anim, time);
        return { bone: doc.bones[bone].name, time, value };
      },
    ),

    // ---- skins and attachments ---------------------------------------------------------------
    tool(
      'add_skin',
      'Add skin',
      "Add a skin (an outfit or variant). With 'copy_from', it starts with a copy of that skin's attachments, bones and constraints; otherwise empty. Fill it with duplicate_attachment. Saves the project.",
      { name: NAME('New skin'), copy_from: { type: 'string', description: 'Skin to copy.' } },
      ['name'],
      (doc, args) => {
        if (!args.name.trim() || args.name === 'default') fail(`'${args.name}' cannot be a skin name.`);
        if (doc.findSkin(args.name)) fail(`Skin '${args.name}' already exists.`);
        const from = args.copy_from ? skinOf(doc, args.copy_from) : null;
        const skin = from ? { ...structuredClone(from), name: args.name } : { name: args.name, slots: [], bones: [], ik: [], color: null, extra: {} };
        doc.skins.push(skin);
        return { added: args.name, skins: doc.skins.map((s) => s.name) };
      },
    ),
    tool(
      'delete_skin',
      'Delete skin',
      'Delete a skin and its attachments. If it was the active skin, the default skin becomes active. Saves the project.',
      { name: NAME('Skin') },
      ['name'],
      (doc, args) => {
        const skin = skinOf(doc, args.name);
        doc.skins.splice(doc.skins.indexOf(skin), 1);
        if (doc.skin === args.name) doc.skin = null;
        return { deleted: args.name, skins: doc.skins.map((s) => s.name) };
      },
    ),
    tool(
      'duplicate_attachment',
      'Duplicate attachment',
      "Copy an attachment of a slot (with its mesh and weights) under a new name, into the same skin or into 'target_skin' (default skin when left out). For skins, copy with the same name into the target skin and change it there. Saves the project.",
      { ...MESH, new_name: { type: 'string', description: 'Name of the copy (may equal the original in another skin).' }, target_skin: { type: 'string', description: "Skin to put the copy in ('default' for the default skin)." } },
      ['slot', 'attachment', 'new_name'],
      (doc, args) => {
        const { slot, att } = attachmentOf(doc, args.slot, args.attachment, args.skin);
        const target = args.target_skin ?? args.skin ?? null;
        const list = attachmentsIn(doc, slot, target, true);
        if (list.some((a) => a.name === args.new_name)) fail(`Slot '${args.slot}' already has '${args.new_name}'${target ? ` in skin '${target}'` : ''}.`);
        const copy = structuredClone(att);
        copy.name = args.new_name;
        // A renamed copy still shows the same image.
        if (copy.image === undefined && (copy.type === 'region' || copy.type === 'mesh')) copy.image = att.name;
        list.push(copy);
        return { slot: args.slot, attachment: args.new_name, skin: target ?? 'default', type: copy.type };
      },
    ),

    // ---- meshes and weights ------------------------------------------------------------------
    tool(
      'make_mesh',
      'Make mesh',
      "Turn a region attachment into a mesh so it can bend. mode 'outline' (default) traces the image's alpha, as the editor's Generate mesh does (work files only, since it needs the pixels): 'points' outline vertices (default 24) and 'interior' density (none, low, medium, high). mode 'grid' makes a rectangular grid with cells of about 'spacing' world units. The mesh starts rigid to the slot's bone; bind it with auto_weight. Saves the project.",
      { ...MESH, mode: { type: 'string', enum: ['outline', 'grid'] }, spacing: { type: 'number', exclusiveMinimum: 0, description: "Grid cell size in world units (mode 'grid')." }, points: { type: 'integer', minimum: 3 }, interior: { type: 'string', enum: ['none', 'low', 'medium', 'high'] } },
      ['slot', 'attachment'],
      (doc, args, p) => {
        const { slot, att } = attachmentOf(doc, args.slot, args.attachment, args.skin);
        if (att.type !== 'region') fail(`'${args.attachment}' is a ${att.type}; only region attachments become meshes (existing meshes are never replaced).`);
        const mode = args.mode ?? 'outline';
        let alpha = null;
        if (mode === 'outline') {
          if (p?.format !== 'rigby') fail("mode 'outline' reads the image's pixels, which only .rigby work files hold. Use mode 'grid', or a work file.");
          const bytes = p.entries?.get(`images/${att.image ?? att.name}.png`);
          if (!bytes) fail(`The work file has no image '${att.image ?? att.name}'.`);
          alpha = alphaOf(decodePng(bytes));
        }
        const mesh = regionToMesh(doc, slot, att);
        const corners = meshState(doc, slot, mesh).points; // uv (0,0), (1,0), (1,1), (0,1)
        const toWorld = ([u, v]) => [0, 1].map((k) => corners[0][k] + u * (corners[1][k] - corners[0][k]) + v * (corners[3][k] - corners[0][k]));
        let uvs;
        let hull;
        if (mode === 'grid') {
          const size = [Math.hypot(corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]), Math.hypot(corners[3][0] - corners[0][0], corners[3][1] - corners[0][1])];
          const spacing = args.spacing ?? Math.max(size[0], size[1]) / 4;
          const [nx, ny] = size.map((s) => Math.max(1, Math.min(64, Math.round(s / spacing))));
          const border = [];
          for (let i = 0; i < nx; i++) border.push([i / nx, 0]);
          for (let j = 0; j < ny; j++) border.push([1, j / ny]);
          for (let i = nx; i > 0; i--) border.push([i / nx, 1]);
          for (let j = ny; j > 0; j--) border.push([0, j / ny]);
          const inner = [];
          for (let j = 1; j < ny; j++) for (let i = 1; i < nx; i++) inner.push([i / nx, j / ny]);
          uvs = [...border, ...inner];
          hull = border.length;
        } else {
          const gen = generateMesh(alpha, { ...MESH_DEFAULTS, ...(args.points ? { points: args.points } : {}), ...(args.interior ? { interior: args.interior } : {}) });
          if (!gen) fail(`The image '${att.image ?? att.name}' has no solid pixels to trace.`);
          uvs = [];
          for (let i = 0; i < gen.uvs.length; i += 2) uvs.push([gen.uvs[i], gen.uvs[i + 1]]);
          hull = gen.hull;
        }
        writeMesh(doc, slot, mesh, { points: uvs.map(toWorld), uvs, weights: null, hull, edges: null });
        return { slot: args.slot, attachment: args.attachment, mode, vertices: uvs.length, triangles: mesh.triangles.length / 3 };
      },
    ),
    tool(
      'auto_weight',
      'Auto weight',
      "Bind a mesh to bones with automatic weights (by distance to each bone, as the editor's Bind does): each vertex follows the listed bones, at most four. Deform keys whose layout no longer fits are removed and counted. Saves the project.",
      { ...MESH, bones: { type: 'array', items: { type: 'string' }, minItems: 1 } },
      ['slot', 'attachment', 'bones'],
      (doc, args) => {
        const { slot, att } = meshOf(doc, args);
        const removed = bindMesh(doc, slot, att, args.bones.map((b) => boneOf(doc, b)));
        return { vertices: att.uvs.length / 2, bones: args.bones, removedDeformKeys: removed };
      },
    ),
    tool(
      'set_weights',
      'Set weights',
      'Set the weights of some vertices of a mesh: vertices[i] gets weights[i], a list of { bone, weight }. Weights are normalized and at most four kept; the mesh keeps its setup shape. An unweighted mesh becomes weighted (its other vertices follow the slot bone fully). Saves the project.',
      { ...MESH, vertices: { type: 'array', items: { type: 'integer', minimum: 0 } }, weights: { type: 'array', items: { type: 'array', items: { type: 'object' } } } },
      ['slot', 'attachment', 'vertices', 'weights'],
      (doc, args) => {
        const { slot, att } = meshOf(doc, args);
        if (args.vertices.length !== args.weights.length) fail("'vertices' and 'weights' must have the same length.");
        const state = meshState(doc, slot, att);
        state.weights ??= state.points.map(() => [{ bone: doc.slots[slot].bone, weight: 1 }]);
        args.vertices.forEach((v, k) => {
          if (v >= state.points.length) fail(`The mesh has ${state.points.length} vertices; there is no vertex ${v}.`);
          const list = args.weights[k].map((w) => {
            if (typeof w?.bone !== 'string' || typeof w.weight !== 'number' || w.weight < 0) fail('Each weight is { bone: name, weight: number ≥ 0 }.');
            return { bone: boneOf(doc, w.bone), weight: w.weight };
          });
          if (!list.some((w) => w.weight > 0)) fail(`Vertex ${v} needs at least one weight above 0.`);
          state.weights[v] = normalizeWeights(list);
        });
        const removed = writeMesh(doc, slot, att, state, { topology: false });
        return { vertices: args.vertices.length, removedDeformKeys: removed };
      },
    ),
    tool(
      'smooth_weights',
      'Smooth weights',
      "Smooth a weighted mesh's weights: each pass averages every vertex's weights with its triangle neighbours (geometry unchanged). Saves the project.",
      { ...MESH, iterations: { type: 'integer', minimum: 1, maximum: 100 } },
      ['slot', 'attachment'],
      (doc, args) => {
        const { slot, att } = meshOf(doc, args);
        const state = meshState(doc, slot, att);
        if (!state.weights) fail(`'${args.attachment}' is not weighted. Bind it first with auto_weight.`);
        const n = state.points.length;
        const near = Array.from({ length: n }, () => new Set());
        const t = state.triangles;
        for (let i = 0; i + 2 < t.length; i += 3) {
          for (const [a, b] of [[t[i], t[i + 1]], [t[i + 1], t[i + 2]], [t[i + 2], t[i]]]) {
            near[a].add(b);
            near[b].add(a);
          }
        }
        let w = state.weights;
        for (let pass = 0; pass < (args.iterations ?? 1); pass++) {
          w = w.map((own, v) => {
            const sum = new Map();
            const add = (list, f) => list.forEach(({ bone, weight }) => sum.set(bone, (sum.get(bone) ?? 0) + weight * f));
            add(own, 1);
            for (const u of near[v]) add(w[u], 1 / near[v].size);
            return normalizeWeights([...sum].map(([bone, weight]) => ({ bone, weight })));
          });
        }
        state.weights = w;
        const removed = writeMesh(doc, slot, att, state, { topology: false });
        return { vertices: n, iterations: args.iterations ?? 1, removedDeformKeys: removed };
      },
    ),

    // ---- physics baking ----------------------------------------------------------------------
    tool(
      'bake_physics',
      'Bake physics',
      "Simulate physics constraints over an animation and write the result as ordinary bone keys (rotate, translate, scale, shear at 'fps', default 30), for engines without physics or to hand-tune it. By default the baked constraints are then keyed off (mix 0) in this animation only. 'loop' settles one cycle first so the loop joins. Refuses bones that another constraint (IK, transform, path) also moves. Saves the project.",
      { animation: NAME('Animation'), constraints: { type: 'array', items: { type: 'string' }, description: 'Physics constraints to bake (default all).' }, fps: { type: 'number', minimum: 1, maximum: 240 }, loop: { type: 'boolean' }, disable: { type: 'boolean' } },
      ['animation'],
      (doc, args) => {
        const anim = animOf(doc, args.animation);
        const all = compileConstraints(doc).filter((c) => c.type === 'physics');
        const chosen = args.constraints ? args.constraints.map((n) => all.find((c) => c.name === n) ?? fail(`No physics constraint '${n}'.`)) : all;
        if (!chosen.length) fail('The project has no physics constraints.');
        const bones = [...new Set(chosen.map((c) => c.bone))];
        const others = compileConstraints(doc).filter((c) => c.type !== 'physics');
        for (const c of others) for (const b of c.bones ?? []) if (bones.includes(b)) fail(`Bone '${doc.bones[b].name}' is also moved by the ${c.type} constraint '${c.name}'; bake only works on bones physics alone moves.`);
        for (const ik of doc.ik) if (ik.bones.some((b) => bones.includes(b))) fail(`Bone in IK '${ik.name}' cannot be baked.`);
        const fps = args.fps ?? 30;
        const dt = 1 / fps;
        const frames = Math.max(1, Math.round(anim.duration * fps));
        const pose = new Pose(doc);
        const step = (time) => {
          pose.reset(doc);
          pose.apply(doc, anim, time, 1);
          pose.physicsDelta = dt;
          pose.updateWorld(doc);
        };
        // Settle: a loop runs one cycle first; otherwise the first frame is held a moment.
        if (args.loop) for (let f = 0; f < frames; f++) step(f * dt);
        else for (let k = 0; k < fps; k++) step(0);
        const samples = [];
        for (let f = 0; f <= frames; f++) {
          step(Math.min(f * dt, anim.duration));
          samples.push(new Map(bones.map((b) => [b, { ...pose.applied[b] }])));
        }
        // The simulated bones' own keys are replaced by the samples.
        for (const b of bones) {
          const tl = anim.boneTimelineMut(b);
          for (const ch of ['rotate', 'translate', 'scale', 'shear']) tl[ch].length = 0;
        }
        samples.forEach((m, f) => writeTargets(doc, { bones: m, slots: new Map() }, anim, roundTime(Math.min(f * dt, anim.duration))));
        if (args.loop) {
          for (const b of bones) {
            const tl = anim.boneTimelineMut(b);
            for (const ch of ['rotate', 'translate', 'scale', 'shear']) if (tl[ch].length > 1) tl[ch][tl[ch].length - 1].value = structuredClone(tl[ch][0].value);
          }
        }
        const disable = args.disable !== false;
        if (disable) for (const c of chosen) setConstraintKey(anim, 'physics', c.name, 'mix', 0, { value: 0 });
        return { animation: anim.name, constraints: chosen.map((c) => c.name), bones: bones.map((b) => doc.bones[b].name), frames: frames + 1, fps, disabled: disable };
      },
    ),
  ];
}

// ---- read-only ----------------------------------------------------------------------------------

const LOOP_NAMES = /idle|breath|walk|run|loop/i;

/** Advisory warnings about an animation's motion (see lint_animations). */
export function lintAnimations(doc, { animation = null, loop = null, fps = 30, jumpThreshold = 80, rotationThreshold = 45 } = {}) {
  const warnings = [];
  const anims = animation ? [animOf(doc, animation)] : doc.animations;
  for (const anim of anims) {
    const loops = loop ?? LOOP_NAMES.test(anim.name);
    const frames = Math.max(1, Math.round(anim.duration * fps));
    const at = (t) => poseAt(doc, anim, t);
    let prev = at(0);
    const first = prev;
    for (let f = 1; f <= frames; f++) {
      const cur = at(Math.min(f / fps, anim.duration));
      doc.bones.forEach((b, i) => {
        const a = prev.world[i].apply([0, 0]);
        const c = cur.world[i].apply([0, 0]);
        const moved = Math.hypot(c[0] - a[0], c[1] - a[1]);
        let turned = Math.abs(cur.world[i].rotation() - prev.world[i].rotation()) % 360;
        if (turned > 180) turned = 360 - turned;
        if (moved > jumpThreshold || turned > rotationThreshold) warnings.push({ code: 'frame_jump', animation: anim.name, bone: b.name, time: roundTime(f / fps), moved: Math.round(moved), turned: Math.round(turned) });
      });
      prev = cur;
    }
    if (loops && anim.duration > 0) {
      const last = prev;
      const seam = doc.bones.filter((b, i) => {
        const a = first.world[i].apply([0, 0]);
        const c = last.world[i].apply([0, 0]);
        return Math.hypot(c[0] - a[0], c[1] - a[1]) > 0.5 || Math.abs(first.world[i].rotation() - last.world[i].rotation()) > 0.5;
      });
      if (seam.length) warnings.push({ code: 'loop_seam', animation: anim.name, bones: seam.map((b) => b.name) });
      const swapped = doc.slots.filter((s, i) => first.attachment[i] !== last.attachment[i]);
      if (swapped.length) warnings.push({ code: 'loop_attachment', animation: anim.name, slots: swapped.map((s) => s.name) });
    }
    // Attachment keys naming an attachment the slot doesn't have (in any skin).
    for (const tl of anim.slots) {
      const slot = tl.slot;
      for (const k of tl.attachment ?? []) {
        if (k.value === null || k.value === undefined) continue;
        const has = doc.slots[slot].attachments.some((a) => a.name === k.value) || doc.skins.some((s) => s.slots.some((e) => e.slot === slot && e.attachments.some((a) => a.name === k.value)));
        if (!has) warnings.push({ code: 'missing_attachment', animation: anim.name, slot: doc.slots[slot].name, attachment: k.value, time: k.time });
      }
    }
    // Bone keys that an IK constraint at full mix overrides.
    for (const ik of doc.ik) {
      for (const b of ik.bones) {
        const tl = anim.boneTimeline(b);
        if (tl?.rotate?.length && !anim.ik.some((t) => t.constraint === doc.ik.indexOf(ik))) warnings.push({ code: 'overridden_keys', animation: anim.name, bone: doc.bones[b].name, constraint: ik.name });
      }
    }
  }
  return warnings;
}

/** The read-only authoring tools, bound to a workspace. */
export function authoringReadTools(ws) {
  const load = async (p) => loadProject(await ws.existing(p));
  return [
    {
      name: 'world_to_local',
      title: 'World to local',
      description: "Convert a world point (Y up) into a bone's local coordinates, in the setup pose or at a time in an animation. Useful to place keys or attachments at a world position.",
      inputSchema: {
        type: 'object',
        properties: { path: PATH, bone: NAME('Bone'), point: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, animation: NAME('Animation'), time: { type: 'number', minimum: 0 } },
        required: ['path', 'bone', 'point'],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      handler: async (args) => {
        const { doc } = await load(args.path);
        const bone = boneOf(doc, args.bone);
        const pose = poseAt(doc, args.animation ? animOf(doc, args.animation) : null, args.time ?? 0);
        const [x, y] = pose.world[bone].inverse().apply(args.point);
        return { bone: args.bone, point: [roundTime(x), roundTime(y)] };
      },
    },
    {
      name: 'lint_animations',
      title: 'Lint animations',
      description:
        "Check animations for common motion problems. Warnings: frame_jump (a bone moves more than 'jump_threshold' world units or turns more than 'rotation_threshold' degrees between frames), loop_seam and loop_attachment (a looping animation's last frame doesn't match its first; animations named idle, breath, walk, run or loop count as loops unless 'loop' says otherwise), missing_attachment (a key shows an attachment the slot doesn't have), overridden_keys (rotate keys on bones a full-mix IK constraint moves). Advisory only.",
      inputSchema: {
        type: 'object',
        properties: {
          path: PATH,
          animation: { type: 'string', description: 'One animation (default all).' },
          loop: { type: 'boolean' },
          fps: { type: 'number', minimum: 1, maximum: 240 },
          jump_threshold: { type: 'number', exclusiveMinimum: 0 },
          rotation_threshold: { type: 'number', exclusiveMinimum: 0 },
        },
        required: ['path'],
        additionalProperties: false,
      },
      annotations: READ_ONLY,
      handler: async (args) => {
        const { doc } = await load(args.path);
        const warnings = lintAnimations(doc, { animation: args.animation ?? null, loop: args.loop ?? null, fps: args.fps ?? 30, jumpThreshold: args.jump_threshold ?? 80, rotationThreshold: args.rotation_threshold ?? 45 });
        return { warnings, count: warnings.length };
      },
    },
  ];
}
