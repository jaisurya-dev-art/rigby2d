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
import { cleanValue, pickerNames, startValues } from '../src/editor/scripting/toolargs.js';
import { classOf, parseApi, stringContext } from '../src/editor/scripting/apidoc.js';
import { errorLine } from '../src/editor/scripting/codeeditor.js';

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

// ---- the wider API: slots, draw order, meshes, skins, events, constraints ----------------------

/** fakeApp with two slots ('body' with two regions, 'cape' with an unweighted mesh) and a 'hand' bone. */
function richApp() {
  const app = fakeApp();
  const doc = app.doc;
  doc.bones.push(makeBone('hand', 1, transform(50, 0, 0), 20));
  const region = (name) => ({ name, type: 'region', image: name, offset: transform(0, 0, 0), width: 10, height: 10, color: [1, 1, 1, 1] });
  doc.slots.push({ name: 'body', bone: 1, attachments: [region('body'), region('body-alt')], attachment: 'body', color: [1, 1, 1, 1], dark: null, blend: 'normal' });
  const cape = { name: 'cape', type: 'mesh', image: 'cape', uvs: [0, 0, 1, 0, 1, 1, 0, 1], triangles: [0, 1, 2, 0, 2, 3], hull: 4, vertices: [0, 0, 10, 0, 10, 10, 0, 10], width: 10, height: 10, color: [1, 1, 1, 1] };
  doc.slots.push({ name: 'cape', bone: 0, attachments: [cape], attachment: 'cape', color: [1, 1, 1, 1], dark: null, blend: 'normal' });
  return app;
}

async function runApi(app, source) {
  const r = await hostFor(app).runScript('api.py', source);
  assert.equal(r.ok, true, `${r.error}\n${r.trace ?? ''}`);
  return r;
}

test('scripts add slots, reorder them and key the draw order', async () => {
  const app = richApp();
  await runApi(
    app,
    `
import rigby
fx = rigby.add_slot("fx", bone="hand")
assert [s.name for s in rigby.draw_order()] == ["body", "cape", "fx"]
rigby.set_draw_order([fx, "body", rigby.slot("cape")])
wave = rigby.animation("wave")
wave.key_draw_order(["cape", "body", "fx"], time=0.5)
keys = wave.draw_order_keys()
assert keys == [{"time": 0.5, "order": ["cape", "body", "fx"]}], keys
wave.key_draw_order(None, time=1)
`,
  );
  assert.deepEqual(app.doc.slots.map((s) => s.name), ['fx', 'body', 'cape']);
  assert.equal(app.doc.slots[0].bone, 2);
  const keys = app.doc.animations[0].drawOrder;
  assert.equal(keys.length, 2);
  assert.equal(keys[1].value, null);
  assert.equal(app.doc.validate(), null);
});

test('scripts key slot attachments and colors', async () => {
  const app = richApp();
  await runApi(
    app,
    `
import rigby
body = rigby.slot("body")
body.key_attachment("body-alt", time=0.25, animation="wave")
body.key_attachment(None, time=0.5, animation="wave")
body.key_color((1, 0, 0, 0.5), time=0.75, animation="wave", curve="ease_in")
assert [k["value"] for k in body.keys("attachment", animation="wave")] == ["body-alt", None]
assert body.keys("color", animation="wave")[0]["curve"] == "ease_in"
try:
    body.key_attachment("nope", time=0)
    raise AssertionError("expected an error")
except rigby.RigbyError as e:
    assert "no attachment 'nope'" in str(e), e
`,
  );
  const tl = app.doc.animations[0].slotTimeline(0);
  assert.deepEqual(tl.attachment.map((k) => k.value), ['body-alt', null]);
  assert.deepEqual(tl.color[0].value, [1, 0, 0, 0.5]);
});

test('scripts read meshes, move their vertices and key deforms', async () => {
  const app = richApp();
  await runApi(
    app,
    `
import rigby
m = rigby.slot("cape").mesh()
assert m.type == "mesh" and m.vertex_count == 4 and not m.weighted
assert m.vertices[2] == (10, 10) and m.triangles == [(0, 1, 2), (0, 2, 3)] and m.hull == 4
assert m.world()[1] == (10, 0)
m.set_vertices([(x, y * 2) for x, y in m.vertices])
m.key([(0, 0), (0, 0), (5, 0), (5, 0)], time=0.5, animation="wave")
assert m.keys(animation="wave")[0]["offsets"][2] == [5, 0]
try:
    m.set_vertices([(0, 0)])
    raise AssertionError("expected an error")
except rigby.RigbyError as e:
    assert "4 (x, y) pairs" in str(e), e
`,
  );
  assert.deepEqual(app.doc.slots[1].attachments[0].vertices, [0, 0, 10, 0, 10, 20, 0, 20]);
  const d = app.doc.animations[0].deform[0];
  assert.equal(d.attachment, 'cape');
  assert.deepEqual(d.keys[0].value.vertices, [0, 0, 0, 0, 5, 0, 5, 0]);
});

test('scripts make skins and fill them', async () => {
  const app = richApp();
  await runApi(
    app,
    `
import rigby
red = rigby.add_skin("red")
red.add("body", "body-alt")
assert red.attachments() == [{"slot": "body", "name": "body-alt", "type": "region"}]
red.show()
assert rigby.current_skin().name == "red"
blue = rigby.add_skin("blue", copy=red)
assert [s.name for s in rigby.skins()] == ["default", "red", "blue"]
blue.remove_attachment("body", "body-alt")
assert blue.attachments() == []
blue.remove()
`,
  );
  assert.deepEqual(app.doc.skins.map((s) => s.name), ['red']);
  assert.equal(app.doc.skin, 'red');
  assert.equal(app.doc.skins[0].slots[0].attachments[0].name, 'body-alt');
});

test('scripts add events and key them', async () => {
  const app = richApp();
  await runApi(
    app,
    `
import rigby
step = rigby.add_event("footstep", int=1, string="left")
assert step.int == 1 and step.string == "left"
step.key(time=0.25, animation="wave")
rigby.animation("wave").key_event("footstep", time=0.75, string="right")
keys = rigby.animation("wave").event_keys()
assert [k["time"] for k in keys] == [0.25, 0.75] and keys[1]["string"] == "right", keys
rigby.animation("wave").delete_event_key("footstep", time=0.25)
`,
  );
  assert.deepEqual(app.doc.events.map((e) => e.name), ['footstep']);
  assert.deepEqual(app.doc.animations[0].events, [{ time: 0.75, name: 'footstep', string: 'right' }]);
});

test('scripts add, change, key and remove constraints', async () => {
  const app = richApp();
  await runApi(
    app,
    `
import rigby
target = rigby.add_bone("target", x=60, y=10)
ik = rigby.add_ik("arm-ik", ["arm", "hand"], target, bend_positive=False)
assert ik.type == "ik" and ik.bones == ["arm", "hand"] and ik.target == "target" and ik.bend_positive is False
ik.set(mix=0.5, softness=4)
ik.mix = 0.25
assert ik.mix == 0.25 and ik.softness == 4
ik.key(time=0.5, animation="wave", mix=1)
phys = rigby.add_physics("hand-sway", "hand", rotate=1, x=0.5)
phys.set(inertia=0.5, damping=0.9)
phys.key(time=0.25, animation="wave", wind=2)
tr = rigby.add_transform("follow", "target", "hand")
tr.key(time=0, animation="wave", mix_rotate=0.5)
assert [c.name for c in rigby.constraints()] == ["arm-ik", "hand-sway", "follow"]
try:
    ik.set(speed=3)
    raise AssertionError("expected an error")
except rigby.RigbyError as e:
    assert "no setting 'speed'" in str(e), e
tr.remove()
`,
  );
  const doc = app.doc;
  assert.equal(doc.ik[0].mix, 0.25);
  assert.equal(doc.ik[0].bendPositive, false);
  assert.equal(doc.animations[0].ik[0].keys[0].value.mix, 1);
  const phys = doc.extra.constraints.find((e) => e.data.name === 'hand-sway').data;
  assert.equal(phys.inertia, 0.5);
  assert.equal(doc.animations[0].extra.physics['hand-sway'].wind[0].value, 2);
  assert.ok(!doc.extra.constraints.some((e) => e.data.name === 'follow'));
  assert.equal(doc.validate(), null);
});

test('tool parameters become a form, and its values reach the function', async () => {
  const app = richApp();
  const host = hostFor(app);
  const r = await host.runScript(
    'shake.py',
    `
import typing
import rigby

@rigby.tool("Shake", params={"amount": {"min": 0, "max": 90, "label": "Amount (degrees)"}})
def shake(bone: rigby.Bone, amount: float = 10.0, times: int = 3, axis: typing.Literal["x", "y"] = "y", loop: bool = True, note: str = ""):
    bone.rotation = bone.rotation + amount * times
    rigby.status(f"{axis} {loop} {note!r}")
`,
  );
  assert.equal(r.ok, true, r.error);
  const t = host.tools.get(toolId('shake.py', 'Shake'));
  assert.deepEqual(
    t.params.map((p) => [p.name, p.kind, p.default]),
    [
      ['bone', 'bone', null],
      ['amount', 'number', 10],
      ['times', 'integer', 3],
      ['axis', 'choice', 'y'],
      ['loop', 'boolean', true],
      ['note', 'text', ''],
    ],
  );
  assert.deepEqual(t.params[1], { name: 'amount', label: 'Amount (degrees)', default: 10, kind: 'number', min: 0, max: 90 });
  assert.deepEqual(t.params[3].choices, ['x', 'y']);
  const ran = await host.runTool(t.id, { bone: 'hand', amount: 5, times: 2, axis: 'x', loop: false, note: 'hi', stray: 1 });
  assert.equal(ran.ok, true, ran.error);
  assert.equal(app.doc.bones[2].setup.rotation, 10);
  assert.equal(app.status, "x False 'hi'");
  // A params entry naming no parameter is a mistake in the script.
  const bad = await host.runScript('bad.py', 'import rigby\n@rigby.tool("X", params={"nope": {}})\ndef x(a=1): pass\n');
  assert.equal(bad.ok, false);
  assert.match(bad.error, /params names no parameter of x: nope/);
});

test('the completion index covers every public name of rigby.py, with types to follow', () => {
  const api = parseApi(moduleSource);
  const all = /__all__ = \[([\s\S]*?)\]/.exec(moduleSource)[1].match(/"([^"]+)"/g).map((s) => s.slice(1, -1));
  assert.deepEqual(api.module.filter((e) => all.includes(e.name)).map((e) => e.name).sort(), [...all].sort());
  // Completion shows each docstring as help, so every public function and member has one.
  for (const e of api.module.filter((x) => x.kind === 'function')) assert.ok(e.doc, `rigby.${e.name} has no docstring`);
  for (const [cls, list] of Object.entries(api.classes)) for (const e of list) assert.ok(e.doc, `${cls}.${e.name} has no docstring`);
  const fn = (name) => api.module.find((e) => e.name === name);
  assert.deepEqual([fn('bone').returns, fn('bones').returnsList, fn('add_ik').returns, fn('slot').returns], ['Bone', true, 'Constraint', 'Slot']);
  assert.equal(fn('add_ik').signature, '(name, bones, target, bend_positive=True, mix=1.0)');
  const members = (cls) => api.classes[cls].map((e) => e.name);
  assert.ok(['x', 'rotation', 'key', 'remove', 'world'].every((m) => members('Bone').includes(m)));
  assert.ok(['key_color', 'mesh'].every((m) => members('Slot').includes(m)));
  assert.ok(!members('Bone').some((m) => m.startsWith('_')));
  // The type of a name, from what the script did with it.
  const script = 'arm = rigby.bone("arm")\nm = rigby.slot("cape").mesh()\nfor s in rigby.slots():\n    pass\ndef t(target: rigby.Bone, how: str):\n';
  assert.deepEqual(['arm', 'm', 's', 'target', 'how'].map((n) => classOf(api, script, n)), ['Bone', 'Mesh', 'Slot', 'Bone', null]);
  assert.equal(classOf(api, '', 'rigby.add_skin("red")'), 'Skin');
  // Project names inside strings.
  assert.deepEqual(stringContext('x = rigby.bone("ar'), { kind: 'bone', typed: 'ar' });
  assert.deepEqual(stringContext("b.key('rotate', 5, animation='wa"), { kind: 'animation', typed: 'wa' });
  assert.equal(stringContext('print("hello'), null);
  // The line a traceback points to in the user's script.
  assert.equal(errorLine('Traceback (most recent call last):\n  File "a.py", line 8, in <module>\n  File "a.py", line 3, in f\nRigbyError: x', 'a.py'), 3);
  assert.equal(errorLine('  File "other.py", line 2', 'a.py'), null);
});

test('tool forms start from remembered values, defaults or the selection, and keep values valid', () => {
  const app = richApp();
  app.multi = new Set([2]);
  const form = [
    { name: 'bone', kind: 'bone', default: null },
    { name: 'slot', kind: 'slot', default: 'cape' },
    { name: 'amount', kind: 'number', default: 10, min: 0, max: 90 },
    { name: 'times', kind: 'integer', default: 3 },
    { name: 'axis', kind: 'choice', default: 'y', choices: ['x', 'y'] },
    { name: 'loop', kind: 'boolean', default: true },
    { name: 'skin', kind: 'skin', default: null },
  ];
  assert.deepEqual(startValues(app, form), { bone: 'hand', slot: 'cape', amount: 10, times: 3, axis: 'y', loop: true, skin: 'default' });
  // Remembered values win while they are still valid; stale or out-of-range ones are fixed.
  const remembered = { bone: 'arm', slot: 'gone', amount: 500, times: 2.6, axis: 'z', loop: false };
  assert.deepEqual(startValues(app, form, remembered), { bone: 'arm', slot: 'cape', amount: 90, times: 3, axis: 'y', loop: false, skin: 'default' });
  assert.equal(cleanValue({ kind: 'integer', default: 1, min: 0 }, -4.2), 0);
  assert.equal(cleanValue({ kind: 'text', default: 'a' }, 7), 'a');
  assert.deepEqual(pickerNames(app.doc, 'animation'), ['wave']);
});

test('the console keeps its names, shows values and output, and edits are one undo step', async () => {
  const app = richApp();
  const host = hostFor(app);
  let r = await host.runConsole('arm = rigby.bone("arm")');
  assert.deepEqual([r.ok, r.value], [true, null]);
  r = await host.runConsole('arm.length');
  assert.equal(r.value, '50');
  r = await host.runConsole('print("hi", arm)');
  assert.equal(r.value, null);
  assert.deepEqual(
    r.output.map((o) => o.text),
    ["hi Bone('arm')"],
  );
  const steps = app.undoSteps;
  await host.runConsole('arm.x = 99');
  assert.equal(app.doc.bones[1].setup.x, 99);
  assert.equal(app.undoSteps, steps + 1);
  r = await host.runConsole('7 * 6');
  assert.equal(r.value, '42');
  r = await host.runConsole('rigby.bone("leg")');
  assert.equal(r.ok, false);
  assert.equal(r.error, "No bone 'leg'");
  assert.deepEqual(await host.consoleNames('ar'), ['arm']);
});
