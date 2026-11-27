// SPDX-License-Identifier: MIT OR Apache-2.0
// The scripting API as the code editor's autocomplete shows it, read from rigby.py itself: every
// public function, class, method and property with its signature and docstring, and what each
// returns (so `b = rigby.bone("arm")` then `b.` lists Bone's members). The docstrings in rigby.py
// are the one place the API is described. No DOM, so it is tested under Node.

/** Attributes a class reads dynamically (__getattr__), which a parse of `def` lines can't see. */
const DYNAMIC = {
  Bone: [
    ['x', 'Setup position X, relative to the parent bone. Setting it changes the setup pose.'],
    ['y', 'Setup position Y, relative to the parent bone.'],
    ['rotation', 'Setup rotation in degrees, relative to the parent bone.'],
    ['scale_x', 'Setup scale X (1 = unscaled).'],
    ['scale_y', 'Setup scale Y (1 = unscaled).'],
    ['shear_x', 'Setup shear X in degrees.'],
    ['shear_y', 'Setup shear Y in degrees.'],
    ['length', 'The bone length (0 for a point bone).'],
  ],
  Mesh: [
    ['name', 'The attachment name.'],
    ['slot', 'The slot name.'],
    ['type', "'mesh', 'linkedmesh', 'region', ..."],
    ['image', 'The image the mesh shows.'],
    ['vertex_count', 'How many vertices the mesh has.'],
    ['weighted', 'True when bones move the vertices (see weights).'],
    ['vertices', 'Setup vertices [(x, y), ...] in the bone space (unweighted meshes).'],
    ['weights', 'Per vertex: [{bone, x, y, weight}, ...] (weighted meshes).'],
    ['uvs', 'Texture coordinates [(u, v), ...], 0..1.'],
    ['triangles', 'Triangles as vertex index triples [(a, b, c), ...].'],
    ['hull', 'How many of the first vertices form the outline.'],
  ],
  Constraint: [
    ['type', "'ik', 'transform', 'path', 'physics' or 'slider'."],
    ['bones', 'The constrained bones (names).'],
    ['target', 'IK: the bone the chain reaches for.'],
    ['mix', 'How much the constraint applies, 0..1.'],
    ['softness', 'IK: how far before the target the chain starts to bend.'],
    ['bend_positive', 'IK: which way a two-bone chain bends.'],
    ['order', 'Where it is in the application order.'],
  ],
};

/**
 * Parses rigby.py: { module: [entry], classes: { Name: [entry] }, classDocs: { Name: doc } } with
 * entries { name, kind ('function'|'class'|'method'|'property'|'constant'), signature, doc,
 * returns (class name), returnsList (true for a list of it) }.
 */
export function parseApi(source) {
  const lines = source.split('\n');
  const all = (/__all__ = \[([\s\S]*?)\]/.exec(source)?.[1] ?? '').match(/"([^"]+)"/g)?.map((s) => s.slice(1, -1)) ?? [];
  const module = [];
  const classes = {};
  const classDocs = {};
  let owner = null;
  const docAt = (i) => {
    const first = lines[i]?.trim() ?? '';
    if (!first.startsWith('"""')) return '';
    let text = first.slice(3);
    if (text.endsWith('"""') && text.length >= 3) return text.slice(0, -3).trim();
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.includes('"""')) {
        text += `\n${l.slice(0, l.indexOf('"""'))}`;
        break;
      }
      text += `\n${l}`;
    }
    // The first paragraph, lines joined.
    return text.split(/\n\s*\n/)[0].replace(/\s*\n\s*/g, ' ').trim();
  };
  /** What a function returns: the class in `return Bone(...)`, `return [Bone(...)...]` or `return self`. */
  const returnsOf = (i, indent) => {
    const locals = new Map();
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (l.trim() && l.search(/\S/) <= indent) break;
      const local = /^\s*(\w+) = ([A-Z]\w*)\(/.exec(l);
      if (local) locals.set(local[1], local[2]);
      const m = /^\s*return (\[)?\s*([A-Z]\w*)\(/.exec(l);
      if (m) return { returns: m[2], returnsList: !!m[1] };
      const v = /^\s*return (\w+)\s*$/.exec(l);
      if (v && locals.has(v[1])) return { returns: locals.get(v[1]), returnsList: false };
      if (/^\s*return self\b/.test(l)) return { returns: owner, returnsList: false };
    }
    return {};
  };
  let decorator = null;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const cls = /^class (\w+)/.exec(line);
    if (cls) {
      owner = cls[1];
      classes[owner] = [];
      classDocs[owner] = docAt(i + 1);
      continue;
    }
    if (/^\S/.test(line) && !/^(def|@|class)/.test(line) && line.trim() && !line.startsWith('#')) owner = null;
    const dec = /^\s*@(\S+)/.exec(line);
    if (dec) {
      decorator = dec[1];
      continue;
    }
    const fn = /^(\s*)def (\w+)\((.*)\):/.exec(line);
    if (!fn) {
      decorator = null;
      continue;
    }
    const [, indentText, name, params] = fn;
    const indent = indentText.length;
    const inClass = indent > 0 && owner;
    if (!inClass && indent === 0) owner = null;
    const isSetter = decorator?.endsWith('.setter');
    const isProperty = decorator === 'property';
    decorator = null;
    if (name.startsWith('_') || isSetter) continue;
    const signature = params.replace(/^self,?\s*/, '').replace(/^\//, '');
    const entry = { name, kind: inClass ? (isProperty ? 'property' : 'method') : 'function', signature: isProperty ? '' : `(${signature})`, doc: docAt(i + 1), ...returnsOf(i, indent) };
    if (inClass) classes[owner].push(entry);
    else if (all.includes(name)) module.push(entry);
  }
  for (const [cls, extra] of Object.entries(DYNAMIC)) {
    if (!classes[cls]) continue;
    for (const [name, doc] of extra) if (!classes[cls].some((e) => e.name === name)) classes[cls].push({ name, kind: 'property', signature: '', doc });
  }
  for (const name of Object.keys(classes)) if (all.includes(name)) module.push({ name, kind: 'class', signature: '', doc: classDocs[name], returns: name });
  for (const m of source.matchAll(/^([A-Z]+) = \(([^)]*)\)/gm)) module.push({ name: m[1], kind: 'constant', signature: '', doc: m[2].replace(/"/g, "'") });
  module.sort((a, b) => all.indexOf(a.name) - all.indexOf(b.name));
  return { module, classes, classDocs };
}

const PICK_FUNCTIONS = { bone: 'bone', slot: 'slot', animation: 'animation', skin: 'skin', event: 'event', constraint: 'constraint', set_skin: 'skin', set_animation: 'animation' };
const PICK_KEYWORDS = { bone: 'bone', parent: 'bone', target: 'bone', source: 'bone', slot: 'slot', animation: 'animation', skin: 'skin', event: 'event' };

/**
 * Which project names fit a string being typed at the end of `before` (the text before the
 * cursor): 'bone' in rigby.bone(" or bone=", 'slot', 'animation', ... or null.
 */
export function stringContext(before) {
  const call = /rigby\.(\w+)\(\s*["']([^"']*)$/.exec(before);
  if (call && PICK_FUNCTIONS[call[1]]) return { kind: PICK_FUNCTIONS[call[1]], typed: call[2] };
  const kw = /\b(\w+)\s*=\s*["']([^"']*)$/.exec(before);
  if (kw && PICK_KEYWORDS[kw[1]]) return { kind: PICK_KEYWORDS[kw[1]], typed: kw[2] };
  return null;
}

/**
 * The class of the expression before a dot, as far as the script shows: `rigby.bone(...)`,
 * a variable assigned from a rigby call or a known method, a for-loop over a list, or a parameter
 * annotated `: rigby.Bone`. `text` is the script up to the cursor. Returns a class name or null.
 */
export function classOf(api, text, expr) {
  const types = new Map();
  const assign = (name, cls) => cls && types.set(name, cls);
  for (const line of text.split('\n')) {
    let m;
    if ((m = /^\s*(\w+)\s*=\s*(.+?)\s*$/.exec(line))) {
      const t = chainType(api, types, m[2]);
      assign(m[1], t && !t.list ? t.cls : null);
    } else if ((m = /^\s*for\s+(\w+)\s+in\s+(.+?)\s*:/.exec(line))) {
      const t = chainType(api, types, m[2]);
      assign(m[1], t?.list ? t.cls : null);
    }
    for (const p of line.matchAll(/(\w+)\s*:\s*rigby\.([A-Z]\w*)/g)) assign(p[1], p[2]);
  }
  const t = chainType(api, types, expr);
  return t && !t.list ? t.cls : null;
}

/** Splits `a.b(x.y).c` at its top-level dots: ['a', 'b(x.y)', 'c'] (null for anything else). */
function chainParts(expr) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let start = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (quote) {
      if (c === quote && expr[i - 1] !== '\\') quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === '.' && depth === 0) {
      parts.push(expr.slice(start, i));
      start = i + 1;
    }
  }
  if (depth || quote) return null;
  parts.push(expr.slice(start));
  return parts.every((p) => /^\w+(\(.*\))?$/s.test(p.trim())) ? parts.map((p) => p.trim()) : null;
}

/** The type of a call chain such as `rigby.slot("x").mesh()`: { cls, list } or null. */
function chainType(api, types, expr) {
  const parts = chainParts(expr.trim());
  if (!parts) return null;
  let cur = null;
  for (const [i, part] of parts.entries()) {
    const name = part.replace(/\(.*$/s, '');
    const called = part.includes('(');
    if (i === 0) {
      if (name === 'rigby') cur = { cls: 'rigby', list: false };
      else if (types.has(name) && !called) cur = { cls: types.get(name), list: false };
      else return null;
      continue;
    }
    if (cur.list) return null;
    const entry = cur.cls === 'rigby' ? api.module.find((e) => e.name === name) : api.classes[cur.cls]?.find((e) => e.name === name);
    if (!entry?.returns) return null;
    // A class itself (rigby.Bone) is not an instance; calling it (rigby.Bone("arm")) is.
    if (entry.kind === 'class' && !called) return null;
    cur = { cls: entry.returns, list: !!entry.returnsList };
  }
  return cur?.cls === 'rigby' ? null : cur;
}
