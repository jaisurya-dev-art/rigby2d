// SPDX-License-Identifier: MIT OR Apache-2.0
// MCP AutoRig and retargeting: a generated layered PSD is rigged, animated and the animation is
// retargeted to a second, bigger character with other layer names.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { writePsd } from 'ag-psd';

import { createEditTools } from '../src/mcp/edits.js';
import { createRiggingTools } from '../src/mcp/rigging.js';
import { Workspace, createTools } from '../src/mcp/tools.js';
import { CHARACTER } from './fixtures/figure.js';
import { blink } from './fixtures/aseprite-writer.js';
import { loadProject } from '../src/mcp/tools.js';

/** A PSD with one ellipse layer per part (feet at the bottom of a 400 x 640 canvas). */
function psd(layers, scale = 1) {
  const W = 400 * scale;
  const H = 640 * scale;
  return writePsd(
    {
      width: W,
      height: H,
      children: layers.map(([name, x, y, w, h]) => {
        [x, y, w, h] = [x * scale, y * scale, Math.round(w * scale), Math.round(h * scale)];
        const data = new Uint8ClampedArray(w * h * 4);
        for (let py = 0; py < h; py++) {
          for (let px = 0; px < w; px++) {
            if (((px + 0.5 - w / 2) / (w / 2)) ** 2 + ((py + 0.5 - h / 2) / (h / 2)) ** 2 > 1) continue;
            data.set([180, 120, 90, 255], (py * w + px) * 4);
          }
        }
        return { name, left: Math.round(W / 2 + x - w / 2), top: Math.round(H - (y + h / 2)), imageData: { width: w, height: h, data } };
      }),
    },
    { noBackground: true, generateThumbnail: false },
  );
}

async function setup() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'rigby-mcp-rig-'));
  const ws = await Workspace.open([tmp]);
  const tools = Object.fromEntries([...createTools(ws), ...createEditTools(ws), ...createRiggingTools(ws)].map((t) => [t.name, t.handler]));
  return { tmp, tools };
}

test('mcp autorig: detect parts and rig a PSD into a new work file', async () => {
  const { tmp, tools } = await setup();
  await fs.writeFile(path.join(tmp, 'hero.psd'), new Uint8Array(psd(CHARACTER)));

  const detected = await tools.detect_parts({ psd_file: 'hero.psd' });
  const part = (n) => detected.parts.find((p) => p.name === n);
  assert.equal(part('Body').role, 'torso');
  assert.deepEqual([part('arm_r').role, part('arm_r').side, part('arm_r').found], ['arm', 'r', 'name']);
  assert.deepEqual(detected.unidentified, ['Layer 7']);

  await assert.rejects(tools.autorig({ psd_file: 'hero.psd' }), /give 'output'/);
  const r = await tools.autorig({ psd_file: 'hero.psd', output: 'hero.rigby', roles: { 'Layer 7': 'none' } });
  assert.ok(r.bones.includes('forearm_r') && r.ik.includes('ik_hand_l'));
  const info = await tools.inspect_project({ path: 'hero.rigby' });
  assert.equal(info.counts.slots, CHARACTER.length);
  assert.equal(info.counts.images, CHARACTER.length);
  const report = await tools.validate_project({ path: 'hero.rigby' });
  assert.equal(report.valid, true, JSON.stringify(report.problems ?? report));
  await assert.rejects(tools.autorig({ path: 'hero.rigby' }), /already has bones/);
  await assert.rejects(tools.autorig({ psd_file: 'hero.psd', output: 'hero.rigby' }), /already exists/);
});

test('mcp retarget: an animation moves to a bigger character with other names', async () => {
  const { tmp, tools } = await setup();
  const rename = { leg_r: 'Right Leg', thigh_l: 'L_Thigh', shin_l: 'L_Calf', foot_l: 'L_Shoe', Body: 'Torso', arm_r: 'R_Arm', upperarm_l: 'L_UpperArm', forearm_l: 'L_LowerArm', hand_l: 'L_Glove', Head: 'Head', eye_l: 'Eye.L', eye_r: 'Eye.R', mouth: 'Mouth', 'Layer 7': 'badge' };
  await fs.writeFile(path.join(tmp, 'a.psd'), new Uint8Array(psd(CHARACTER)));
  await fs.writeFile(path.join(tmp, 'b.psd'), new Uint8Array(psd(CHARACTER.map(([n, ...rest]) => [rename[n], ...rest]), 1.5)));
  await tools.autorig({ psd_file: 'a.psd', output: 'a.rigby' });
  await tools.autorig({ psd_file: 'b.psd', output: 'b.rigby' });

  await tools.add_animation({ path: 'a.rigby', name: 'jump' });
  await tools.set_bone_key({ path: 'a.rigby', animation: 'jump', bone: 'hip', channel: 'translate', time: 0, x: 0, y: 0 });
  await tools.set_bone_key({ path: 'a.rigby', animation: 'jump', bone: 'hip', channel: 'translate', time: 0.5, x: 0, y: 40, curve: 'easeOut' });
  await tools.set_bone_key({ path: 'a.rigby', animation: 'jump', bone: 'upperarm_l', channel: 'rotate', time: 0.5, value: 90 });
  await tools.set_event_key({ path: 'a.rigby', animation: 'jump', event: 'land', time: 0.5 });

  const map = await tools.map_bones({ source: 'a.rigby', path: 'b.rigby' });
  assert.ok(map.mapped.some((m) => m.source === 'upperarm_l' && m.target === 'upperarm_l'));

  const r = await tools.retarget_animation({ source: 'a.rigby', path: 'b.rigby', animation: 'jump', name: 'jump_big' });
  assert.ok(Math.abs(r.scale - 1.5) < 0.05, `scale ${r.scale}`);
  const a = await tools.sample_pose({ path: 'a.rigby', animation: 'jump', time: 0.5 });
  const b = await tools.sample_pose({ path: 'b.rigby', animation: 'jump_big', time: 0.5 });
  const a0 = await tools.sample_pose({ path: 'a.rigby' });
  const b0 = await tools.sample_pose({ path: 'b.rigby' });
  const y = (pose, n) => pose.bones.find((x) => x.name === n).y;
  // The hip rises 40 units on the small character and about 60 on the big one.
  assert.ok(Math.abs(y(a, 'hip') - y(a0, 'hip') - 40) < 0.5);
  assert.ok(Math.abs(y(b, 'hip') - y(b0, 'hip') - 40 * r.scale) < 1, `${y(b, 'hip') - y(b0, 'hip')}`);
  assert.deepEqual(b.eventsUpToTime, [{ time: 0.5, name: 'land' }]);
  await assert.rejects(tools.retarget_animation({ source: 'a.rigby', path: 'b.rigby', animation: 'jump', name: 'jump_big' }), /already has an animation/);
});

test('mcp import_aseprite: layers, pictures and tags become a work file', async () => {
  const { tmp, tools } = await setup();
  await fs.writeFile(path.join(tmp, 'hero.aseprite'), blink());
  await assert.rejects(tools.import_aseprite({ aseprite_file: 'hero.aseprite', output: 'hero.json' }), /\.rigby/);
  const r = await tools.import_aseprite({ aseprite_file: 'hero.aseprite', output: 'hero.rigby' });
  assert.deepEqual(r.slots, ['body', 'eyes', 'ghost', 'shade']);
  assert.equal(r.images, 5, 'body, two eye pictures, the ghost and the shade');
  assert.deepEqual(r.animations.map((a) => a.name), ['blink', 'bounce', 'blink · ghost', 'bounce · ghost']);
  assert.equal(r.animations[0].duration, 0.45);

  const p = await loadProject(path.join(tmp, 'hero.rigby'));
  assert.equal(p.doc.pixelGrid, 1, 'pixel art stays sharp');
  assert.equal(p.doc.textureFilter, 'nearest');
  assert.ok(p.entries.has('images/eyes_2.png'));
  const eyes = p.doc.slots.findIndex((s) => s.name === 'eyes');
  const blinkAnim = p.doc.animations.find((a) => a.name === 'blink');
  assert.deepEqual(blinkAnim.slotTimelineMut(eyes).attachment.map((k) => k.value), ['eyes', 'eyes_2', 'eyes']);

  await assert.rejects(tools.import_aseprite({ aseprite_file: 'hero.aseprite', output: 'hero.rigby' }), /already exists/);
});
