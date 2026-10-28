// SPDX-License-Identifier: MIT OR Apache-2.0
// Platform layer: native dialogs and file access in the desktop app (Tauri), and browser
// equivalents (folder/file pickers, File System Access API or ZIP download) in the web build.
//
// A "file system" here is { readFile(path), readText(path), writeFile(path, bytes),
// writeText(path, text), mkdir(path), list(dir), finish(), reusable }. `list` returns the file
// names in a folder (empty when listing is not possible). Paths use the host's separators on
// desktop and '/' in the browser.

import { ask, open, save } from '@tauri-apps/plugin-dialog';
import * as tfs from '@tauri-apps/plugin-fs';
import { openUrl } from '@tauri-apps/plugin-opener';

import { zip } from './zip.js';

export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const encoder = new TextEncoder();

// ---- desktop ----------------------------------------------------------------------------------

const desktopFs = {
  readFile: (p) => tfs.readFile(p),
  readText: (p) => tfs.readTextFile(p),
  writeFile: (p, bytes) => tfs.writeFile(p, bytes),
  writeText: (p, text) => tfs.writeTextFile(p, text),
  mkdir: (p) => tfs.mkdir(p, { recursive: true }),
  list: async (dir) => {
    try {
      return (await tfs.readDir(dir)).filter((e) => e.isFile).map((e) => e.name);
    } catch {
      return [];
    }
  },
  finish: async () => {},
  reusable: true,
};

// ---- browser ----------------------------------------------------------------------------------

/** Normalizes a '/' path, resolving '.' and '..'. */
function normalize(path) {
  const out = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** Read-only file system over files picked from a folder (keyed by their relative paths). */
export function memoryFs(files) {
  const byPath = new Map(files.map((f) => [normalize(f.webkitRelativePath || f.name), f]));
  const get = (p) => {
    const f = byPath.get(normalize(p));
    if (!f) throw new Error(`file not found: ${p}`);
    return f;
  };
  return {
    readFile: async (p) => new Uint8Array(await get(p).arrayBuffer()),
    readText: async (p) => get(p).text(),
    writeFile: async () => {
      throw new Error('read-only');
    },
    writeText: async () => {
      throw new Error('read-only');
    },
    mkdir: async () => {},
    list: async (dir) => {
      const prefix = normalize(dir);
      return [...byPath.keys()]
        .filter((k) => (prefix ? k.startsWith(prefix + '/') : true))
        .map((k) => k.slice(prefix ? prefix.length + 1 : 0))
        .filter((k) => k && !k.includes('/'));
    },
    finish: async () => {},
    reusable: false,
  };
}

/** Writable file system over a directory handle (File System Access API). */
function directoryFs(root) {
  const dirFor = async (parts, create) => {
    let dir = root;
    for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
    return dir;
  };
  const write = async (path, data) => {
    const parts = normalize(path).split('/');
    const name = parts.pop();
    const file = await (await dirFor(parts, true)).getFileHandle(name, { create: true });
    const w = await file.createWritable();
    await w.write(data);
    await w.close();
  };
  const read = async (path) => {
    const parts = normalize(path).split('/');
    const name = parts.pop();
    return (await (await dirFor(parts, false)).getFileHandle(name)).getFile();
  };
  return {
    readFile: async (p) => new Uint8Array(await (await read(p)).arrayBuffer()),
    readText: async (p) => (await read(p)).text(),
    writeFile: write,
    writeText: write,
    mkdir: async (p) => {
      await dirFor(normalize(p).split('/').filter(Boolean), true);
    },
    finish: async () => {},
    reusable: true,
  };
}

/** Collects one written file and downloads it as-is on finish() (single-file saves). */
function singleFileFs(fileName) {
  let data = null;
  return {
    readFile: async () => {
      throw new Error('write-only');
    },
    readText: async () => {
      throw new Error('write-only');
    },
    writeFile: async (_p, bytes) => (data = bytes),
    writeText: async (_p, text) => (data = encoder.encode(text)),
    mkdir: async () => {},
    list: async () => [],
    finish: async () => data && download(fileName, data),
    reusable: false,
  };
}

/** Collects written files and downloads them as a ZIP on finish(). */
function zipFs(zipName) {
  const files = new Map();
  return {
    readFile: async () => {
      throw new Error('write-only');
    },
    readText: async () => {
      throw new Error('write-only');
    },
    writeFile: async (p, bytes) => files.set(normalize(p), bytes),
    writeText: async (p, text) => files.set(normalize(p), encoder.encode(text)),
    mkdir: async () => {},
    finish: async () => download(zipName, zip([...files].map(([path, bytes]) => ({ path, bytes })))),
    reusable: false,
  };
}

function download(name, bytes) {
  const url = URL.createObjectURL(new Blob([bytes]));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Shows a hidden <input type=file>; resolves with the picked files (empty if cancelled). */
function pickWithInput({ accept, multiple = false, directory = false }) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.multiple = multiple;
    if (directory) input.webkitdirectory = true;
    input.addEventListener('change', () => resolve([...input.files]));
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}

// ---- public API -------------------------------------------------------------------------------

/** Opens an https link in the browser (the system browser on desktop, a new tab on the web). */
export async function openExternal(url) {
  if (isDesktop) await openUrl(url);
  else window.open(url, '_blank', 'noopener');
}

/** A project file at `path` on the desktop's disk (reopened from File ▸ Open recent), or null on the web. */
export function desktopFile(path) {
  return isDesktop ? { path, fs: desktopFs } : null;
}

export async function confirmDialog(message, title) {
  return isDesktop ? ask(message, { title, kind: 'warning' }) : window.confirm(message);
}

/**
 * Asks for a project to open. Desktop: a file dialog. Browser: a folder picker (so the
 * project's images can be read too). Returns { path, fs } or null.
 */
export async function pickProject() {
  if (isDesktop) {
    const path = await open({ filters: [{ name: 'Rigby2D work file or skeleton (.json, .skel)', extensions: ['rigby', 'json', 'skel'] }] });
    return path ? { path, fs: desktopFs } : null;
  }
  const files = await pickWithInput({ directory: true });
  const projects = files.filter((f) => /\.(rigby|json|skel)$/i.test(f.name));
  if (!projects.length) return files.length ? Promise.reject(new Error('no .rigby, .json or .skel file in that folder')) : null;
  projects.sort((a, b) => Number(/\.rigby$/i.test(b.name)) - Number(/\.rigby$/i.test(a.name)));
  let chosen = projects[0];
  if (projects.length > 1) {
    const list = projects.map((f, i) => `${i + 1}. ${f.webkitRelativePath}`).join('\n');
    const answer = window.prompt(`Several skeleton files found. Which one?\n${list}`, '1');
    if (answer === null) return null;
    chosen = projects[Number(answer) - 1] ?? chosen;
  }
  return { path: normalize(chosen.webkitRelativePath || chosen.name), fs: memoryFs(files) };
}

/**
 * Asks where to write `fileName` (plus sibling files). Desktop: a save dialog. Browser: a folder
 * picker when supported, otherwise a download (`single`: the file itself, else `<stem>.zip`).
 * Returns { path, fs }.
 */
export async function pickSaveTarget(fileName, filterName, extension, { single = false } = {}) {
  if (isDesktop) {
    const path = await save({ filters: [{ name: filterName, extensions: [extension] }], defaultPath: fileName });
    return path ? { path, fs: desktopFs } : null;
  }
  if (typeof window.showDirectoryPicker === 'function') {
    try {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      return { path: fileName, fs: directoryFs(dir) };
    } catch (e) {
      if (e.name === 'AbortError') return null;
      throw e;
    }
  }
  return { path: fileName, fs: single ? singleFileFs(fileName) : zipFs(fileName.replace(/\.[^.]+$/, '') + '.zip') };
}

/** Asks for files to import. Returns [{ name, bytes }] (empty if cancelled). */
export async function pickImportFiles(filterName, extensions, multiple) {
  if (isDesktop) {
    const picked = await open({ multiple, filters: [{ name: filterName, extensions }] });
    const paths = Array.isArray(picked) ? picked : picked ? [picked] : [];
    return Promise.all(paths.map(async (path) => ({ name: path, bytes: await tfs.readFile(path) })));
  }
  const files = await pickWithInput({ accept: extensions.map((e) => `.${e}`).join(','), multiple });
  return Promise.all(files.map(async (f) => ({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) })));
}

