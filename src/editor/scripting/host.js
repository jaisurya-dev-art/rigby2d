// SPDX-License-Identifier: MIT OR Apache-2.0
// Script host: runs Python scripts (Pyodide, CPython compiled to WebAssembly, bundled with the
// editor) against the open project. In the editor, Python runs sandboxed in a Web Worker
// (worker.js): it gets a copy of the project and sends back the changed one, so a script can't
// reach the editor, your files or the network, and a script that never ends can be stopped. A
// script run, or one tool run, is one undo step; when it raises, nothing changes and the traceback
// goes to the log.

import { Skeleton } from '../../core/model.js';
import { track } from '../analytics.js';
import * as log from '../log.js';
import { ScriptEngine, pythonError } from './engine.js';

export { pythonError };

/** The sandbox: the engine in a Web Worker. */
function workerEngine() {
  const worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  const pending = new Map();
  let next = 1;
  worker.onmessage = (e) => {
    const { id, ...result } = e.data ?? {};
    pending.get(id)?.(result);
    pending.delete(id);
  };
  worker.onerror = (e) => {
    for (const resolve of pending.values()) resolve({ ok: false, error: e.message || 'The Python worker failed' });
    pending.clear();
  };
  return {
    request: (msg) =>
      new Promise((resolve) => {
        const id = next++;
        pending.set(id, resolve);
        worker.postMessage({ id, ...msg });
      }),
    terminate: () => {
      worker.terminate();
      for (const resolve of pending.values()) resolve({ ok: false, error: 'Stopped' });
      pending.clear();
    },
  };
}

/** The engine in this thread, on a Pyodide instance from `loadRuntime` (tests). */
async function localEngine(loadRuntime, moduleSource) {
  const engine = new ScriptEngine(await loadRuntime(), moduleSource);
  return { request: async (msg) => engine.handle(msg), terminate() {} };
}

/**
 * `moduleSource` + `loadRuntime()` (a Pyodide instance) run Python in this thread; without them
 * Python runs in the sandbox worker. `onChange()` is called when the tools or the host state change.
 */
export class ScriptHost {
  constructor(app, { loadRuntime = null, moduleSource = null, onChange = () => {} } = {}) {
    this.app = app;
    this.loadRuntime = loadRuntime;
    this.moduleSource = moduleSource;
    this.onChange = onChange;
    /** 'idle' (not started), 'loading', 'ready' or 'failed'. */
    this.state = 'idle';
    this.engine = null;
    this.starting = null;
    /** Tools by id (`script\u0000label`): { id, script, label, description }. */
    this.tools = new Map();
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
      const engine = this.loadRuntime ? await localEngine(this.loadRuntime, this.moduleSource) : workerEngine();
      const r = await engine.request({ type: 'init' });
      if (!r.ok) throw new Error(r.error);
      this.engine = engine;
      this.state = 'ready';
      log.info(`Python ${r.python} ready (${((Date.now() - t0) / 1000).toFixed(1)} s)${this.loadRuntime ? '' : ', sandboxed'}`, { source: 'python' });
      return engine;
    } catch (e) {
      this.state = 'failed';
      this.starting = null;
      log.exception(e, { source: 'python', context: 'Python could not start' });
      throw e;
    } finally {
      this.onChange();
    }
  }

  /** Sends a request that does not touch the project (add-on files, addon_info). */
  async request(msg) {
    const engine = this.engine ?? (await this.ready());
    return engine.request(msg);
  }

  /** Stops a script that runs too long: Python restarts, and its tools are gone until reloaded. */
  stop() {
    this.engine?.terminate();
    this.engine = null;
    this.starting = null;
    this.state = 'idle';
    this.running = false;
    this.tools.clear();
    log.warn('Python was stopped; scripts and add-ons reload when used', { source: 'python' });
    this.onChange();
  }

  /**
   * Runs a script's source as one undo step. Tools it registers with @rigby.tool replace the
   * ones it registered before. Returns { ok, value: [tool labels], error, trace }.
   */
  async runScript(name, source) {
    await this.ready();
    track('editor-script-run');
    const r = await this.transaction(name, `Script '${name}' failed`, { type: 'run', name, source });
    if (!r.ok) return r;
    for (const [id, t] of this.tools) if (t.script === name) this.tools.delete(id);
    for (const t of r.result.tools ?? []) this.tools.set(toolId(name, t.label), { id: toolId(name, t.label), script: name, label: t.label, description: t.description });
    this.onChange();
    return { ok: true, value: (r.result.tools ?? []).map((t) => t.label) };
  }

  /** Removes a script's tools. */
  forget(name) {
    for (const [id, t] of this.tools) if (t.script === name) this.tools.delete(id);
    this.engine?.request({ type: 'forget', name });
    this.onChange();
  }

  /** Runs a tool as one undo step. */
  async runTool(id) {
    const t = this.tools.get(id);
    if (!t || !this.engine) return { ok: false, error: 'No such tool' };
    const before = this.app.status;
    const r = await this.transaction(t.script, `Tool '${t.label}' failed`, { type: 'tool', script: t.script, label: t.label });
    // A tool that reports its own result (rigby.status) keeps it in the status bar.
    if (r.ok && this.app.status === before) this.app.setStatus(`Ran ${t.label}`);
    return r;
  }

  /**
   * Sends the project to Python with `msg` and applies what comes back. Success: the edits become
   * one undo step. Failure: nothing changes, and the error (with its Python traceback) is logged.
   */
  async transaction(source, failure, msg) {
    const app = this.app;
    if (this.running) return { ok: false, error: 'A script is already running' };
    // Playback defers undo history; stop it so earlier edits get their own undo step and the
    // script's step holds only its changes.
    app.playing = false;
    app.commitHistory(false);
    const state = {
      snapshot: app.doc.toSnapshot(),
      anim: app.anim ?? null,
      mode: app.mode,
      time: app.time,
      sel: app.sel ?? null,
      multi: [...(app.multi ?? [])],
      path: app.path ?? null,
      workspace: app.workspace,
    };
    this.running = true;
    this.onChange();
    let r;
    try {
      r = await this.engine.request({ ...msg, state });
    } finally {
      this.running = false;
      this.onChange();
    }
    for (const entry of r.logs ?? []) log.log(entry.level, entry.text, { source });
    if (!r.ok) {
      log.error(`${failure}: ${r.error}`, { source, trace: r.trace ?? null });
      app.setStatus(`${failure}: ${r.error} (details in View ▸ Log)`, { log: false });
      return { ok: false, error: r.error, trace: r.trace ?? null };
    }
    if (r.snapshot) app.doc = Skeleton.fromObject(JSON.parse(r.snapshot));
    if (r.view) {
      app.anim = r.view.anim;
      app.mode = r.view.mode;
      app.time = r.view.time;
      app.sel = r.view.sel;
      app.multi = new Set(r.view.multi);
    }
    if (r.status !== null && r.status !== undefined) app.setStatus(r.status);
    app.sanitize();
    app.changed();
    return { ok: true, result: r };
  }
}

export const toolId = (script, label) => `${script}\u0000${label}`;
