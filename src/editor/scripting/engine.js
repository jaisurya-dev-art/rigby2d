// SPDX-License-Identifier: MIT OR Apache-2.0
// The Python engine: runs scripts, tools and add-ons on a copy of the project. It has no DOM and
// no access to the editor: it receives the project as a snapshot with each request and returns the
// changed project, so it can run in a Web Worker (worker.js, the sandbox the editor uses) or in
// process (the tests). host.js applies the results to the editor as one undo step.
//
// Requests: { type: 'init' | 'run' | 'tool' | 'forget' | 'files' | 'removeFiles' | 'readInfo', … }.

import { Skeleton } from '../../core/model.js';
import { Pose } from '../../core/pose.js';
import { READ_INFO_PY } from '../addons.js';
import { callApi } from './bridge.js';

/** The members of the editor's App that bridge.js uses, over a copy of the project. */
class ScriptApp {
  load(state) {
    this.doc = Skeleton.fromObject(JSON.parse(state.snapshot));
    this.anim = state.anim ?? null;
    this.mode = state.mode ?? 'setup';
    this.time = state.time ?? 0;
    this.sel = state.sel ?? null;
    this.multi = new Set(state.multi ?? []);
    this.path = state.path ?? null;
    this.workspace = state.workspace ?? 'game';
    this.playing = false;
  }

  currentAnimation() {
    return this.anim === null || this.anim === undefined ? undefined : this.doc.animations[this.anim];
  }

  selectedBones() {
    const out = [...this.multi].filter((b) => b < this.doc.bones.length);
    const primary = this.sel && this.sel.bone !== undefined ? this.sel.bone : null;
    if (primary !== null && !out.includes(primary)) out.unshift(primary);
    return out;
  }

  pose() {
    const pose = new Pose(this.doc);
    const anim = this.currentAnimation();
    if (this.mode === 'animate' && anim) pose.apply(this.doc, anim, this.time, 1);
    pose.updateWorld(this.doc);
    return pose;
  }

  view() {
    return { anim: this.anim, mode: this.mode, time: this.time, sel: this.sel, multi: [...this.multi] };
  }
}

/** Removes a folder and everything in it from Pyodide's file system (if it exists). */
function removeTree(FS, path) {
  let stat;
  try {
    stat = FS.stat(path);
  } catch {
    return;
  }
  if (!FS.isDir(stat.mode)) return FS.unlink(path);
  for (const name of FS.readdir(path)) if (name !== '.' && name !== '..') removeTree(FS, `${path}/${name}`);
  FS.rmdir(path);
}

export class ScriptEngine {
  /** `py`: a Pyodide instance; `moduleSource`: the text of rigby.py. */
  constructor(py, moduleSource) {
    this.py = py;
    this.app = new ScriptApp();
    this.logs = [];
    this.status = null;
    py.setStdout({ batched: (text) => this.logs.push({ level: 'info', text }) });
    py.setStderr({ batched: (text) => this.logs.push({ level: 'warn', text }) });
    py.registerJsModule('_rigby_bridge', {
      call: (name, argsJson) =>
        callApi(
          this.app,
          {
            log: (level, text) => this.logs.push({ level: level === 'warn' || level === 'error' ? level : 'info', text: String(text) }),
            status: (text) => (this.status = String(text)),
          },
          name,
          argsJson,
        ),
    });
    py.FS.mkdirTree('/rigby');
    py.FS.writeFile('/rigby/rigby.py', moduleSource);
    // A fresh import binds the module to this engine's bridge (a runtime may be shared, as in tests).
    py.runPython("import sys\nif '/rigby' not in sys.path: sys.path.insert(0, '/rigby')\nsys.modules.pop('rigby', None)\nsys.modules.pop('_rigby_bridge', None)\nimport rigby");
    this.rigby = py.pyimport('rigby');
  }

  /** Handles one request; returns a plain (structured-clonable) result. */
  handle(msg) {
    const py = this.py;
    switch (msg.type) {
      case 'init':
        return { ok: true, python: py.runPython('import sys; sys.version.split()[0]') };
      case 'run':
        return this.transaction(msg.state, msg.name, () => {
          this.rigby._begin(msg.name);
          const globals = py.globals.get('dict')();
          try {
            globals.set('__name__', '__main__');
            py.runPython(msg.source, { globals, filename: msg.name });
          } finally {
            globals.destroy();
          }
          return { tools: JSON.parse(this.rigby._collect(msg.name)) };
        });
      case 'tool':
        return this.transaction(msg.state, msg.script, () => {
          this.rigby._run(msg.script, msg.label);
          return {};
        });
      case 'forget':
        this.rigby._forget(msg.name);
        return { ok: true };
      case 'files': {
        // Add-on files under `root` (/addons/<id>), replacing what was there.
        removeTree(py.FS, msg.root);
        for (const f of msg.files) {
          const target = `${msg.root}/${f.path}`;
          py.FS.mkdirTree(target.slice(0, target.lastIndexOf('/')));
          py.FS.writeFile(target, f.bytes);
        }
        return { ok: true };
      }
      case 'removeFiles':
        removeTree(py.FS, msg.root);
        return { ok: true };
      case 'readInfo':
        py.globals.set('_addon_source', msg.source);
        try {
          return { ok: true, info: JSON.parse(py.runPython(READ_INFO_PY)) };
        } catch (e) {
          return { ok: false, error: pythonError(e, 'addon_info').message };
        } finally {
          py.globals.delete('_addon_source');
        }
      default:
        return { ok: false, error: `unknown request '${msg.type}'` };
    }
  }

  /** Runs `fn` on the project in `state`; returns the changed project and view, or the error. */
  transaction(state, source, fn) {
    this.app.load(state);
    const before = this.app.doc.toSnapshot();
    this.logs = [];
    this.status = null;
    try {
      const value = fn();
      const after = this.app.doc.toSnapshot();
      return { ok: true, ...value, snapshot: after !== before ? after : null, view: this.app.view(), status: this.status, logs: this.logs };
    } catch (e) {
      const { message, trace } = pythonError(e, source);
      return { ok: false, error: message, trace, logs: this.logs };
    }
  }
}

/**
 * Message and traceback of a Python (or JavaScript) error. The traceback keeps the frames of the
 * user's script, dropping the editor's own (Pyodide internals and the rigby module).
 */
export function pythonError(e, source) {
  const text = String(e?.message ?? e);
  if (e?.type === undefined && !/Traceback \(most recent call last\)/.test(text)) {
    return { message: e?.message || String(e ?? 'Unknown error'), trace: e?.stack ?? null };
  }
  const lines = text.replace(/\s+$/, '').split('\n');
  const last = lines[lines.length - 1];
  const frames = [];
  let current = null;
  const header = [];
  const tail = [];
  for (const line of lines) {
    const m = /^ {2}File "([^"]*)", line \d+/.exec(line);
    if (m) {
      current = { file: m[1], lines: [line] };
      frames.push(current);
    } else if (current && /^ {4}/.test(line)) current.lines.push(line);
    else if (!frames.length) header.push(line);
    else {
      current = null;
      tail.push(line);
    }
  }
  const internal = (f) => f.file.startsWith('/lib/') || f.file.includes('_pyodide') || f.file === '/rigby/rigby.py' || f.file === '<exec>';
  const own = frames.filter((f) => !internal(f));
  const kept = own.length ? own : frames;
  const trace = [...header, ...kept.flatMap((f) => f.lines), ...tail].join('\n');
  // "rigby.RigbyError: No bone 'x'" reads better without the module path.
  const message = last.replace(/^rigby\.RigbyError: /, '').replace(/^RigbyError: /, '') || `${source} failed`;
  return { message, trace };
}
