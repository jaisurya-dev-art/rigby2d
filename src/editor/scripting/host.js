// SPDX-License-Identifier: MIT OR Apache-2.0
// Script host: runs Python scripts (Pyodide, CPython compiled to WebAssembly, bundled with the
// editor) against the open project. A script run, or one tool run, is one undo step; when it
// raises, the project is put back as it was and the traceback goes to the log.

import { track } from '../analytics.js';
import * as log from '../log.js';
import { callApi } from './bridge.js';

/**
 * `loadRuntime()` resolves to a Pyodide instance; `moduleSource` is the text of rigby.py;
 * `onChange()` is called when the tools or the host state change.
 */
export class ScriptHost {
  constructor(app, { loadRuntime, moduleSource, onChange = () => {} }) {
    this.app = app;
    this.loadRuntime = loadRuntime;
    this.moduleSource = moduleSource;
    this.onChange = onChange;
    /** 'idle' (not started), 'loading', 'ready' or 'failed'. */
    this.state = 'idle';
    this.py = null;
    this.starting = null;
    /** Tools by id (`script\u0000label`): { id, script, label, description }. */
    this.tools = new Map();
    /** Name of the script whose output is being written (for log sources). */
    this.source = 'python';
    this.running = false;
  }

  /** Starts Python once; later calls wait for the same start. */
  ready() {
    this.starting ??= this.start();
    return this.starting;
  }

  async start() {
    this.state = 'loading';
    this.onChange();
    const t0 = Date.now();
    try {
      const py = await this.loadRuntime();
      py.setStdout({ batched: (line) => log.info(line, { source: this.source }) });
      py.setStderr({ batched: (line) => log.warn(line, { source: this.source }) });
      py.registerJsModule('_rigby_bridge', {
        call: (name, argsJson) =>
          callApi(
            this.app,
            {
              log: (level, text) => log.log(level === 'warn' || level === 'error' ? level : 'info', text, { source: this.source }),
              status: (text) => this.app.setStatus(String(text)),
            },
            name,
            argsJson,
          ),
      });
      py.FS.mkdirTree('/rigby');
      py.FS.writeFile('/rigby/rigby.py', this.moduleSource);
      // A fresh import binds the module to this host's bridge (a runtime may be shared, as in tests).
      py.runPython("import sys\nif '/rigby' not in sys.path: sys.path.insert(0, '/rigby')\nsys.modules.pop('rigby', None)\nsys.modules.pop('_rigby_bridge', None)\nimport rigby");
      this.py = py;
      this.rigby = py.pyimport('rigby');
      this.state = 'ready';
      log.info(`Python ${py.runPython('import sys; sys.version.split()[0]')} ready (${((Date.now() - t0) / 1000).toFixed(1)} s)`, { source: 'python' });
      return py;
    } catch (e) {
      this.state = 'failed';
      log.exception(e, { source: 'python', context: 'Python could not start' });
      throw e;
    } finally {
      this.onChange();
    }
  }

  /**
   * Runs a script's source as one undo step. Tools it registers with @rigby.tool replace the
   * ones it registered before. Returns { ok, tools: [labels], error }.
   */
  async runScript(name, source) {
    const py = await this.ready();
    track('editor-script-run');
    return this.transaction(name, `Script '${name}' failed`, () => {
      this.rigby._begin(name);
      const globals = py.globals.get('dict')();
      try {
        globals.set('__name__', '__main__');
        py.runPython(source, { globals, filename: name });
      } finally {
        globals.destroy();
      }
      const tools = JSON.parse(this.rigby._collect(name));
      for (const [id, t] of this.tools) if (t.script === name) this.tools.delete(id);
      for (const t of tools) this.tools.set(toolId(name, t.label), { id: toolId(name, t.label), script: name, label: t.label, description: t.description });
      return tools.map((t) => t.label);
    });
  }

  /** Removes a script's tools. */
  forget(name) {
    for (const [id, t] of this.tools) if (t.script === name) this.tools.delete(id);
    this.rigby?._forget(name);
    this.onChange();
  }

  /** Runs a tool as one undo step. */
  runTool(id) {
    const t = this.tools.get(id);
    if (!t || !this.rigby) return { ok: false, error: 'No such tool' };
    const result = this.transaction(t.script, `Tool '${t.label}' failed`, () => this.rigby._run(t.script, t.label));
    if (result.ok) this.app.setStatus(`Ran ${t.label}`);
    return result;
  }

  /**
   * Runs `fn` against the project. Success: the edits become one undo step. Failure: the project
   * is restored and the error (with its Python traceback) is logged.
   */
  transaction(source, failure, fn) {
    const app = this.app;
    if (this.running) return { ok: false, error: 'A script is already running' };
    // Playback defers undo history; stop it so earlier edits get their own undo step and the
    // script's step holds only its changes.
    app.playing = false;
    app.commitHistory(false);
    const before = app.doc.toSnapshot();
    const view = { mode: app.mode, anim: app.anim, time: app.time };
    this.running = true;
    this.source = source;
    try {
      const value = fn();
      app.sanitize();
      app.changed();
      return { ok: true, value };
    } catch (e) {
      const { message, trace } = pythonError(e, source);
      if (app.doc.toSnapshot() !== before) app.restore(before);
      Object.assign(app, view);
      app.sanitize();
      log.error(`${failure}: ${message}`, { source, trace });
      app.setStatus(`${failure}: ${message} (details in View ▸ Log)`, { log: false });
      return { ok: false, error: message, trace };
    } finally {
      this.running = false;
      this.source = 'python';
      this.onChange();
    }
  }
}

export const toolId = (script, label) => `${script}\u0000${label}`;

/**
 * Message and traceback of a Python (or JavaScript) error. The traceback keeps the frames of the
 * user's script, dropping the editor's own (Pyodide internals and the rigby module).
 */
export function pythonError(e, source) {
  const text = String(e?.message ?? e);
  if (e?.type === undefined && !/Traceback \(most recent call last\)/.test(text)) {
    return { message: log.errorMessage(e), trace: e?.stack ?? null };
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
