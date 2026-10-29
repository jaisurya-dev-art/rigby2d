// SPDX-License-Identifier: MIT OR Apache-2.0
// Python scripting: the rigby module running in Pyodide against a project, tools, undo steps,
// rollback on errors and tracebacks in the log.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { before, test } from 'node:test';

import { loadPyodide } from 'pyodide';

import { Animation } from '../src/core/animation.js';
import { Skeleton, makeBone } from '../src/core/model.js';
import { transform } from '../src/core/math.js';
import { Pose } from '../src/core/pose.js';
import * as log from '../src/editor/log.js';
import { ScriptHost, pythonError, toolId } from '../src/editor/scripting/host.js';

const moduleSource = fs.readFileSync(new URL('../src/editor/scripting/rigby.py', import.meta.url), 'utf8');

/** The parts of the editor's App that scripts use. */
function fakeApp() {
  const doc = new Skeleton();
  doc.bones.push(makeBone('arm', 0, transform(10, 0, 30), 50));
  doc.animations.push(new Animation('wave', 1));
  return {
    doc,
    path: null,
    workspace: 'game',
    mode: 'setup',
    time: 0,
    anim: 0,
    sel: null,
    multi: new Set(),
    version: 0,
    undoSteps: 0,
    status: '',
    currentAnimation() {
      return this.anim === null ? undefined : this.doc.animations[this.anim];
    },
    pose() {
      const p = new Pose(this.doc);
      p.updateWorld(this.doc);
      return p;
    },
    selectedBones() {
      return [...this.multi];
    },
    commitHistory() {},
    sanitize() {},
    changed() {
      this.version++;
      this.undoSteps++;
    },
    restore(json) {
      this.doc = Skeleton.fromObject(JSON.parse(json));
    },
    setStatus(text) {
      this.status = text;
    },
  };
}

let py;
before(async () => {
  py = await loadPyodide();
});

const hostFor = (app) => new ScriptHost(app, { loadRuntime: async () => py, moduleSource });

test('scripts read and edit the project through the rigby module', async () => {
  const app = fakeApp();
  const host = hostFor(app);
  const r = await host.runScript(
    'edit.py',
    `
import rigby
arm = rigby.bone("arm")
assert arm.parent.name == "root" and arm.length == 50
arm.rotation = arm.rotation + 15
hand = rigby.add_bone("hand", parent=arm, x=50, length=20)
w = hand.world
assert abs(w["rotation"] - 45) < 1e-6, w
hand.key("rotate", 30, time=0.5, animation="wave", curve="ease_out")
print("bones:", [b.name for b in rigby.bones()])
`,
  );
  assert.equal(r.ok, true, r.error);
  assert.equal(app.doc.bones[1].setup.rotation, 45);
  assert.equal(app.doc.bones[2].name, 'hand');
  const keys = app.doc.animations[0].boneTimeline(2).rotate;
  assert.equal(keys[0].value, 30);
  assert.equal(app.undoSteps, 1);
  assert.ok(log.entries.some((e) => e.source === 'edit.py' && e.message === "bones: ['root', 'arm', 'hand']"));
});

test('tools register in the menu and each run is one undo step', async () => {
  const app = fakeApp();
  const host = hostFor(app);
  const r = await host.runScript(
    'tools.py',
    `
import rigby

@rigby.tool("Nudge arm", description="Moves the arm 5 units right")
def nudge():
    b = rigby.bone("arm")
    b.x += 5
    b.y += 1
`,
  );
  assert.deepEqual(r.value, ['Nudge arm']);
  const id = toolId('tools.py', 'Nudge arm');
  assert.equal(host.tools.get(id).description, 'Moves the arm 5 units right');
  const steps = app.undoSteps;
  assert.equal((await host.runTool(id)).ok, true);
  assert.equal((await host.runTool(id)).ok, true);
  assert.equal(app.doc.bones[1].setup.x, 20);
  assert.equal(app.undoSteps, steps + 2);
  // Reloading the script replaces its tools.
  await host.runScript('tools.py', 'import rigby\n');
  assert.equal(host.tools.size, 0);
});

test('a failing script leaves the project unchanged and logs the traceback', async () => {
  const app = fakeApp();
  const host = hostFor(app);
  const r = await host.runScript(
    'broken.py',
    `
import rigby
rigby.bone("arm").x = 999

def helper():
    return rigby.bone("leg")

helper()
`,
  );
  assert.equal(r.ok, false);
  assert.equal(r.error, "No bone 'leg'");
  assert.equal(app.doc.bones[1].setup.x, 10, 'rolled back');
  assert.match(r.trace, /File "broken\.py", line 6, in helper/);
  assert.match(r.trace, /File "broken\.py", line 8/);
  assert.doesNotMatch(r.trace, /_pyodide|rigby\.py/);
  const entry = log.entries.at(-1);
  assert.equal(entry.level, 'error');
  assert.equal(entry.source, 'broken.py');
  assert.match(app.status, /Script 'broken\.py' failed: No bone 'leg'/);
});

test('Python exceptions keep their type in the message', async () => {
  const host = hostFor(fakeApp());
  const r = await host.runScript('zero.py', 'x = 1 / 0\n');
  assert.equal(r.error, 'ZeroDivisionError: division by zero');
  assert.match(r.trace, /File "zero\.py", line 1/);
});

test('JavaScript errors pass through pythonError unchanged', () => {
  const e = new Error('boom');
  assert.deepEqual(pythonError(e, 'x'), { message: 'boom', trace: e.stack });
});
