// SPDX-License-Identifier: MIT OR Apache-2.0
// The add-on registry (registry/ in the repository, listed on rigby2d.com/addons), without the DOM
// or the network: the scripts in registry/, the website build, the editor and the tests share it.
//
// An add-on is published from its own GitHub repository. Its entry, registry/addons/<id>.json,
// names the repository; registry/sync.mjs reads the repository's releases (or its default branch
// when it has none), checks each version's package and records it in registry/index.json; the
// website build mirrors the newest version of each add-on on rigby2d.com and lists it.

import { addonManifest, compareVersions, versionText } from './addons.js';

export const ID_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;
export const TAGS = ['rigging', 'animation', 'mesh', 'export', 'import', 'film', 'workflow', 'utility'];
export const LIMITS = { files: 300, bytes: 5 * 1024 * 1024 };
// Files a Python add-on can ship. Native libraries cannot load in the sandbox, so they are refused.
const ALLOWED = /\.(py|pyi|json|toml|txt|md|rst|csv|png|jpe?g|svg|webp|gif|license)$|(^|\/)(LICENSE|COPYING|NOTICE|README)[^/]*$/i;

/**
 * Reads `addon_info` from Python source without running it: the first top-level assignment, parsed
 * as a Python literal (dicts, tuples, lists, strings, numbers, True, False, None). Returns null when
 * there is none, and throws when it is not a literal.
 */
export function readAddonInfo(source) {
  const m = /^addon_info\s*=\s*/m.exec(source);
  if (!m) return null;
  return new PyLiteral(source, m.index + m[0].length).value();
}

class PyLiteral {
  constructor(src, pos) {
    this.src = src;
    this.pos = pos;
  }

  fail(what) {
    const line = this.src.slice(0, this.pos).split('\n').length;
    throw new Error(`addon_info is not a plain literal (${what} on line ${line})`);
  }

  skip() {
    for (;;) {
      const rest = this.src.slice(this.pos);
      const ws = /^(?:\s|\\\n|#[^\n]*)+/.exec(rest);
      if (!ws) return;
      this.pos += ws[0].length;
    }
  }

  value() {
    this.skip();
    const c = this.src[this.pos];
    if (c === '{') return this.dict();
    if (c === '(' || c === '[') return this.sequence(c === '(' ? ')' : ']');
    if (c === '"' || c === "'" || /[rRuUbB]/.test(c ?? '') && /["']/.test(this.src[this.pos + 1] ?? '')) return this.strings();
    const word = /^(?:-?\d[\d_]*(?:\.\d+)?(?:[eE][+-]?\d+)?|True|False|None)\b/.exec(this.src.slice(this.pos));
    if (!word) this.fail(`unexpected ${JSON.stringify(c ?? 'end')}`);
    this.pos += word[0].length;
    if (word[0] === 'True') return true;
    if (word[0] === 'False') return false;
    if (word[0] === 'None') return null;
    return Number(word[0].replace(/_/g, ''));
  }

  // Adjacent string literals join, as in Python ("a" "b" is "ab").
  strings() {
    let out = '';
    do {
      out += this.string();
      this.skip();
    } while (/["']/.test(this.src[this.pos] ?? '') || (/[rRuU]/.test(this.src[this.pos] ?? '') && /["']/.test(this.src[this.pos + 1] ?? '')));
    return out;
  }

  string() {
    let raw = false;
    if (/[rRuUbB]/.test(this.src[this.pos])) {
      raw = /[rR]/.test(this.src[this.pos]);
      this.pos++;
    }
    const triple = this.src.startsWith(this.src[this.pos].repeat(3), this.pos);
    const quote = triple ? this.src[this.pos].repeat(3) : this.src[this.pos];
    this.pos += quote.length;
    let out = '';
    for (;;) {
      if (this.pos >= this.src.length) this.fail('an unterminated string');
      if (this.src.startsWith(quote, this.pos)) {
        this.pos += quote.length;
        return out;
      }
      const ch = this.src[this.pos++];
      if (ch === '\n' && !triple) this.fail('a line break in a string');
      if (ch !== '\\' || raw) {
        out += ch;
        continue;
      }
      const e = this.src[this.pos++];
      const simple = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '\n': '', 0: '\0' };
      if (e in simple) out += simple[e];
      else if (e === 'x' || e === 'u' || e === 'U') {
        const n = { x: 2, u: 4, U: 8 }[e];
        out += String.fromCodePoint(parseInt(this.src.slice(this.pos, this.pos + n), 16));
        this.pos += n;
      } else out += `\\${e}`;
    }
  }

  sequence(close) {
    this.pos++;
    const out = [];
    for (;;) {
      this.skip();
      if (this.src[this.pos] === close) {
        this.pos++;
        return out;
      }
      out.push(this.value());
      this.skip();
      if (this.src[this.pos] === ',') this.pos++;
      else if (this.src[this.pos] !== close) this.fail(`expected "," or "${close}"`);
    }
  }

  dict() {
    this.pos++;
    const out = {};
    for (;;) {
      this.skip();
      if (this.src[this.pos] === '}') {
        this.pos++;
        return out;
      }
      const key = this.value();
      if (typeof key !== 'string') this.fail('a key that is not a string');
      this.skip();
      if (this.src[this.pos++] !== ':') this.fail('expected ":"');
      out[key] = this.value();
      this.skip();
      if (this.src[this.pos] === ',') this.pos++;
      else if (this.src[this.pos] !== '}') this.fail('expected "," or "}"');
    }
  }
}

/** "owner/name" from a GitHub repository URL or "owner/name"; null when it is neither. */
export function parseRepo(text) {
  const m = /^(?:https?:\/\/(?:www\.)?github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?(?:[?#].*)?$/.exec(String(text ?? '').trim());
  return m ? `${m[1]}/${m[2]}` : null;
}

/** Problems with a registry entry (registry/addons/<id>.json); an empty list when it is fine. */
export function entryProblems(id, entry) {
  const problems = [];
  if (!ID_PATTERN.test(id)) problems.push(`the id "${id}" must be 2-40 lowercase letters, digits and _, starting with a letter`);
  if (!entry || typeof entry !== 'object') return [...problems, 'the entry is not a JSON object'];
  if (!entry.path && !parseRepo(entry.repo)) problems.push('"repo" must be a GitHub repository ("owner/name")');
  if (entry.path && !/^addons\/[a-z0-9_]+$/.test(entry.path)) problems.push('"path" is only for the official add-ons in addons/');
  if (!Array.isArray(entry.tags) || !entry.tags.length) problems.push(`"tags" needs at least one of: ${TAGS.join(', ')}`);
  else for (const tag of entry.tags) if (!TAGS.includes(tag)) problems.push(`unknown tag "${tag}" (use ${TAGS.join(', ')})`);
  if (entry.official && !entry.path) problems.push('only the add-ons in addons/ are official');
  return problems;
}

/**
 * Checks one version of an add-on: `files` is its package (readAddonPackage). Returns
 * { manifest, problems }: the manifest as the editor would store it, and what keeps it out of the
 * registry (empty when it is fine).
 */
export function checkPackage(id, files) {
  const problems = [];
  let manifest = null;
  let total = 0;
  for (const [path, bytes] of files) {
    total += bytes.length;
    if (!ALLOWED.test(path)) problems.push(`${path}: only Python, text, data and image files can be in an add-on`);
  }
  if (files.size > LIMITS.files) problems.push(`${files.size} files (the limit is ${LIMITS.files})`);
  if (total > LIMITS.bytes) problems.push(`${(total / 1048576).toFixed(1)} MB (the limit is ${LIMITS.bytes / 1048576} MB)`);
  const init = files.get('__init__.py');
  if (!init) problems.push('no __init__.py');
  else {
    try {
      manifest = addonManifest(id, readAddonInfo(new TextDecoder().decode(init)));
      delete manifest.installed;
      delete manifest.file;
      if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) problems.push(`addon_info "version" must be numbers, like (1, 0, 0) (it is "${manifest.version}")`);
      if (!manifest.description) problems.push('addon_info has no "description"');
      if (!manifest.author) problems.push('addon_info has no "author"');
    } catch (e) {
      problems.push(e.message);
    }
  }
  return { manifest, problems };
}

/** The newest version of a registry index entry that the editor (`editorVersion`, '' for any) can run. */
export function latestVersion(addon, editorVersion = '') {
  const ok = (addon.versions ?? []).filter((v) => !v.rigby || !editorVersion || compareVersions(editorVersion, v.rigby) >= 0);
  return ok.sort((a, b) => compareVersions(b.version, a.version))[0] ?? null;
}

/**
 * The fields of a GitHub issue form ("### Label\n\nvalue" blocks) by label. "_No response_" is empty;
 * checkbox lists become arrays of the checked labels.
 */
export function issueFields(body) {
  const fields = {};
  for (const block of String(body ?? '').replace(/\r\n/g, '\n').split(/^### /m).slice(1)) {
    const nl = block.indexOf('\n');
    const label = block.slice(0, nl < 0 ? undefined : nl).trim();
    const value = nl < 0 ? '' : block.slice(nl + 1).trim();
    const boxes = [...value.matchAll(/^- \[([ xX])\] (.*)$/gm)];
    fields[label] = boxes.length ? boxes.filter((b) => b[1] !== ' ').map((b) => b[2].trim()) : value === '_No response_' ? '' : value;
  }
  return fields;
}

/** Tags typed or picked in an issue form ("Rigging, export") that are registry tags. */
export const issueTags = (text) => [...new Set(String(text ?? '').toLowerCase().split(/[\s,]+/).filter((t) => TAGS.includes(t)))];

/** Text for search: name, description, author, publisher and tags. */
export const searchText = (a) => [a.name, a.description, a.author, a.publisher, ...(a.tags ?? [])].join(' ').toLowerCase();

export { compareVersions, versionText };
