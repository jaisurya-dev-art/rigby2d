// SPDX-License-Identifier: MIT OR Apache-2.0
// MCP tool run_script: runs a Python script with the editor's `rigby` module against a project
// file (Pyodide in Node.js), then saves it. The same scripts work in the editor's script editor.

import fs from 'node:fs/promises';

import { Skeleton } from '../core/model.js';
import { poseAt } from '../core/keying.js';
import * as log from '../editor/log.js';
import { ScriptHost } from '../editor/scripting/host.js';
import { EDIT, OUTPUT, OVERWRITE, animationOf, boneIndex, edit } from './edits.js';
import { ToolError } from './protocol.js';
import { PATH, loadProject } from './tools.js';

const moduleSource = fs.readFile(new URL('../editor/scripting/rigby.py', import.meta.url), 'utf8');
let runtime = null;

/** Pyodide, started once per server process (about 2 seconds) and reused. */
function loadRuntime() {
  // Standard output carries the MCP protocol: anything Pyodide prints goes to standard error.
  const toStderr = (line) => process.stderr.write(`${line}\n`);
  runtime ??= import('pyodide').then(({ loadPyodide }) => loadPyodide({ stdout: toStderr, stderr: toStderr }));
  runtime.catch(() => (runtime = null));
  return runtime;
}

/** The parts of the editor's state that scripts see: project, mode, time, animation, selection. */
class HeadlessApp {
  constructor(doc, file, { animation = null, time = 0, selection = [] } = {}) {
    this.doc = doc;
    this.path = file;
    this.anim = animation === null ? null : doc.animations.indexOf(animationOf(doc, animation));
    this.mode = this.anim === null ? 'setup' : 'animate';
    this.time = time;
    this.playing = false;
    const bones = selection.map((n) => boneIndex(doc, n));
    this.sel = bones.length ? { bone: bones[0] } : null;
    this.multi = new Set(bones);
    this.status = '';
    this.version = 0;
  }

  get workspace() {
    return this.doc.workspace ?? 'game';
  }

  currentAnimation() {
    return this.anim === null ? undefined : this.doc.animations[this.anim];
  }

  pose() {
    return poseAt(this.doc, this.mode === 'animate' ? (this.currentAnimation() ?? null) : null, this.time);
  }

  selectedBones() {
    return [...this.multi].filter((b) => b < this.doc.bones.length);
  }

  commitHistory() {}

  sanitize() {
    if (this.anim !== null && this.anim >= this.doc.animations.length) this.anim = this.doc.animations.length ? 0 : null;
  }

  changed() {
    this.version++;
  }

  restore(json) {
    this.doc = Skeleton.fromObject(JSON.parse(json));
  }

  setStatus(text) {
    this.status = text;
  }
}

/** Runs `source` against `p.doc`. Returns { output, tools, status }, or throws a ToolError. */
async function runOn(p, args, source) {
  const app = new HeadlessApp(p.doc, p.file, { animation: args.animation ?? null, time: args.time ?? 0, selection: args.selection ?? [] });
  const host = new ScriptHost(app, { loadRuntime, moduleSource: await moduleSource });
  const name = args.script_file ? args.script_file.split(/[\\/]/).pop() : 'script.py';
  const output = [];
  const stop = log.subscribe((e) => {
    if (e && (e.source === name || e.source === 'python') && !/^Python [\d.]+ ready/.test(e.message)) output.push(e.level === 'info' ? e.message : `${e.level}: ${e.message}`);
  });
  let r;
  try {
    r = await host.runScript(name, source);
  } catch (e) {
    const missing = /Cannot find (package|module) 'pyodide'/.test(log.errorMessage(e));
    throw new ToolError(missing ? 'run_script needs Pyodide: run npm install in the Rigby2D folder (the other tools work without it).' : `Python could not start: ${log.errorMessage(e)}`);
  } finally {
    stop();
  }
  if (!r.ok) {
    // The error line is in the traceback; the log entry for it would repeat it.
    const printed = output.filter((l) => !l.startsWith('error: Script '));
    throw new ToolError([`The script failed: ${r.error}`, r.trace, printed.length ? `Output before the error:\n${printed.join('\n')}` : ''].filter(Boolean).join('\n\n'));
  }
  // Scripts run on a copy of the project and return the changed one (scripting/engine.js).
  p.doc = app.doc;
  return { output, tools: r.value, status: app.status || null };
}

export function createScriptTools(ws) {
  return [
    {
      name: 'run_script',
      title: 'Run Python script',
      description:
        "Run a Python script against a project with the Rigby2D scripting API (`import rigby`: bones, slots, animations, keys, selection, time; see docs/scripting.md), then save the project. The script runs in a sandbox (CPython 3.14 on Pyodide, standard library only). print() output is returned. If the script raises, nothing is saved and the traceback is returned. dry_run: true runs it without saving (for queries). 'animation' and 'time' set what rigby.current_animation() and rigby.time() return; 'selection' sets rigby.selected_bones().",
      inputSchema: {
        type: 'object',
        properties: {
          path: PATH,
          script: { type: 'string', description: 'Python source.' },
          script_file: { type: 'string', description: 'A .py file inside the workspace, instead of script.' },
          animation: { type: 'string', description: 'Animation open while the script runs (Animate mode). Default: none (Setup mode).' },
          time: { type: 'number', minimum: 0 },
          selection: { type: 'array', items: { type: 'string' }, description: 'Selected bone names.' },
          dry_run: { type: 'boolean', description: 'Run without saving.' },
          output: OUTPUT,
          overwrite: OVERWRITE,
        },
        required: ['path'],
        additionalProperties: false,
      },
      annotations: { ...EDIT, idempotentHint: false },
      handler: async (args) => {
        if ((args.script === undefined) === (args.script_file === undefined)) throw new ToolError("Give either 'script' or 'script_file'.");
        const source = args.script ?? (await fs.readFile(await ws.existing(args.script_file), 'utf8'));
        if (args.dry_run) {
          const p = await loadProject(await ws.existing(args.path));
          return { dryRun: true, ...(await runOn(p, args, source)) };
        }
        return edit(ws, args, (doc, p) => runOn(p, args, source));
      },
    },
  ];
}
