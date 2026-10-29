// SPDX-License-Identifier: MIT OR Apache-2.0
// Add-on packages, without the DOM (tests run this under Node).
//
// An add-on is a Python package, installed from either:
// - a `.py` file: a single module (my_tool.py becomes the add-on `my_tool`), or
// - a `.zip` file: a package folder with `__init__.py`, at the top of the zip or inside one folder
//   (as GitHub's "Download ZIP" makes them), plus any modules and files it needs.
// The main module describes itself with an `addon_info` dictionary, read without running it:
//     addon_info = {"name": "Mirror tools", "version": (1, 0, 0), "author": "…",
//                   "description": "…", "rigby": (0, 4, 0)}
// and may define register() and unregister(), called when the add-on is enabled and disabled.
// Installed add-ons live in the `addons/<id>/` folder of the editor's user data (see platform.js).

import { unzip } from './zip.js';

/** Name of the file the editor writes next to an installed add-on's code, holding its details. */
export const MANIFEST_FILE = 'rigby-addon.json';
export const ADDON_EXTENSIONS = ['zip', 'py'];

/** A Python identifier made from a file or folder name: "Mirror Tools-main" -> "mirror_tools_main". */
export function addonId(name) {
  let id = String(name)
    .replace(/\.(zip|py)$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!id) id = 'addon';
  if (/^\d/.test(id)) id = `addon_${id}`;
  return id;
}

/**
 * The package inside an add-on file: { id, files: Map<relative path, bytes> }, where `__init__.py`
 * is the main module. `name` is the file name, `bytes` its contents.
 */
export function readAddonPackage(name, bytes) {
  if (/\.py$/i.test(name)) return { id: addonId(baseName(name)), files: new Map([['__init__.py', bytes]]) };
  if (!/\.zip$/i.test(name)) throw new Error('an add-on is a .zip or .py file');
  const entries = [...unzip(bytes)].filter(([path]) => !path.endsWith('/') && !/(^|\/)(__pycache__|\.git)\//.test(path) && !path.startsWith('__MACOSX/'));
  // The package root: the shallowest folder holding __init__.py.
  const inits = entries.map(([path]) => path).filter((p) => /(^|\/)__init__\.py$/.test(p));
  if (!inits.length) throw new Error('no __init__.py in the zip: an add-on zip holds a Python package');
  const init = inits.sort((a, b) => a.split('/').length - b.split('/').length)[0];
  const root = init.slice(0, -'__init__.py'.length);
  const files = new Map();
  for (const [path, data] of entries) {
    if (!path.startsWith(root)) continue;
    const rel = path.slice(root.length);
    if (rel.split('/').some((part) => part === '..' || part === '')) continue;
    files.set(rel, data);
  }
  const folder = root.replace(/\/$/, '').split('/').pop();
  return { id: addonId(folder || baseName(name)), files };
}

const baseName = (path) => String(path).split(/[\\/]/).pop();

/** A version tuple or string as text: (1, 2, 0) -> "1.2.0". */
export function versionText(v) {
  if (Array.isArray(v)) return v.join('.');
  return v === undefined || v === null ? '' : String(v);
}

/** Compares dotted versions: negative when a < b. Missing parts count as 0. */
export function compareVersions(a, b) {
  const pa = versionText(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = versionText(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Checks an `addon_info` dictionary (already parsed) and returns the stored manifest, or throws.
 * `editorVersion` refuses add-ons that need a newer editor.
 */
export function addonManifest(id, info, { editorVersion = '', file = '', now = new Date() } = {}) {
  if (!info || typeof info !== 'object') throw new Error('the add-on has no addon_info dictionary in its main module');
  const text = (v) => (typeof v === 'string' ? v.trim() : '');
  const name = text(info.name);
  if (!name) throw new Error('addon_info has no "name"');
  const needs = versionText(info.rigby);
  if (needs && editorVersion && compareVersions(editorVersion, needs) < 0) {
    throw new Error(`${name} needs Rigby2D ${needs} or newer (this is ${editorVersion})`);
  }
  return {
    id,
    name,
    version: versionText(info.version),
    author: text(info.author),
    description: text(info.description),
    rigby: needs,
    url: text(info.url ?? info.doc_url),
    file,
    installed: now.toISOString(),
  };
}

/**
 * Python code that reads `addon_info` from module source without running it (ast.literal_eval)
 * and returns it as JSON, or "null" when there is none. The source is passed as `_addon_source`.
 */
export const READ_INFO_PY = `
import ast, json
def _read_addon_info(source):
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == "addon_info" for t in node.targets):
            return json.dumps(ast.literal_eval(node.value))
    return "null"
_read_addon_info(_addon_source)
`;

/** Python that imports add-on `id` from /addons afresh and calls its register(). */
export function enableAddonPy(id) {
  return `import importlib, sys
if "/addons" not in sys.path: sys.path.insert(0, "/addons")
for _name in [m for m in sys.modules if m == "${id}" or m.startswith("${id}.")]: del sys.modules[_name]
importlib.invalidate_caches()
_module = importlib.import_module("${id}")
if hasattr(_module, "register"): _module.register()
`;
}

/** Python that calls add-on `id`'s unregister() and forgets its modules. */
export function disableAddonPy(id) {
  return `import sys
_module = sys.modules.get("${id}")
try:
    if _module is not None and hasattr(_module, "unregister"): _module.unregister()
finally:
    for _name in [m for m in sys.modules if m == "${id}" or m.startswith("${id}.")]: del sys.modules[_name]
`;
}
