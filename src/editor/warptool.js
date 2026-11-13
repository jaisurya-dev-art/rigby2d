// SPDX-License-Identifier: MIT OR Apache-2.0
// The viewport's warp tool: draws the lattice of the warp being edited (app.warpEdit) and drags its
// points. In Setup mode a drag reshapes the meshes for good (the lattice then rests again, like a
// paint program's warp); in Animate mode it keys the lattice at the current frame and bakes the
// warps into the meshes' deform keys.

import { Mode } from './app.js';
import { t } from './i18n.js';
import { applyToSetup, bakeWarps, chainOffsetsAt, keyWarp, latticeWorld, pointsOf, warpOffsetsAt } from './warp.js';

const HIT = 9; // px

/** A design token's colour (style.css), read when drawing. */
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export class WarpTool {
  constructor(app, viewport) {
    this.app = app;
    this.viewport = viewport;
    this.drag = null;
    this.hover = -1;
  }

  /** The warp being edited, or null. */
  warp() {
    const name = this.app.warpEdit?.name;
    return name ? (this.app.doc.warps.find((w) => w.name === name) ?? null) : null;
  }

  get active() {
    return this.warp() !== null;
  }

  /** The animation keys are written to (Animate mode), or null. */
  animName() {
    return this.app.mode === Mode.Animate ? (this.app.currentAnimation()?.name ?? null) : null;
  }

  /** This warp's own offsets now (a copy; zeros in Setup mode or without keys). */
  ownOffsets(w) {
    const name = this.animName();
    return (name && warpOffsetsAt(w, name, this.app.time)) || new Array(pointsOf(w) * 2).fill(0);
  }

  /** The lattice points as drawn, in screen space. */
  screenPoints(w) {
    const app = this.app;
    const offsets = chainOffsetsAt(app.doc, w, this.animName(), app.time);
    if (this.drag) offsets.set(w.name, this.drag.offsets);
    const pose = app.pose();
    // While a Setup drag reshapes the meshes, the handle follows the cursor.
    return latticeWorld(app.doc, pose, w, offsets).map((p) => this.viewport.toScreen(p));
  }

  pointAt(w, pos) {
    let best = -1;
    let bestD = HIT;
    this.screenPoints(w).forEach(([x, y], i) => {
      const d = Math.hypot(x - pos[0], y - pos[1]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return best;
  }

  down(pos) {
    const w = this.warp();
    if (!w) return;
    const index = this.pointAt(w, pos);
    if (index < 0) return;
    if (this.app.mode === Mode.Animate && !this.animName()) {
      this.app.setStatus(t('Choose an animation to key the warp'));
      return;
    }
    const bone = this.app.doc.boneIndex(w.bone);
    const inv = this.app.pose().world[bone].inverse();
    this.drag = { index, from: this.viewport.toWorld(pos), base: this.ownOffsets(w), offsets: this.ownOffsets(w), applied: [0, 0], inv };
    this.app.warpEdit.selected = index;
  }

  move(pos) {
    const w = this.warp();
    const d = this.drag;
    if (!w || !d) return;
    const app = this.app;
    const to = this.viewport.toWorld(pos);
    // The drag as a vector in the lattice's bone space.
    const wx = to[0] - d.from[0];
    const wy = to[1] - d.from[1];
    const bx = d.inv.a * wx + d.inv.c * wy;
    const by = d.inv.b * wx + d.inv.d * wy;
    d.offsets = d.base.slice();
    d.offsets[2 * d.index] += bx;
    d.offsets[2 * d.index + 1] += by;
    if (app.mode === Mode.Animate) {
      keyWarp(w, this.animName(), Math.round(app.time * 1e4) / 1e4, d.offsets);
      bakeWarps(app.doc);
    } else {
      // Setup: reshape the meshes by what the point moved since the last step.
      const step = new Array(pointsOf(w) * 2).fill(0);
      step[2 * d.index] = bx - d.applied[0];
      step[2 * d.index + 1] = by - d.applied[1];
      applyToSetup(app.doc, w, step);
      d.applied = [bx, by];
    }
    app.changed();
  }

  up() {
    if (!this.drag) return;
    this.drag = null;
    this.app.changed();
  }

  draw(ctx) {
    const w = this.warp();
    if (!w) return;
    const pts = this.screenPoints(w);
    const at = (i, j) => pts[j * (w.cols + 1) + i];
    const line = token('--warning');
    const fill = token('--surface-0');
    ctx.save();
    ctx.lineWidth = 1;
    ctx.strokeStyle = line;
    ctx.beginPath();
    for (let j = 0; j <= w.rows; j++) for (let i = 0; i <= w.cols; i++) {
      const p = at(i, j);
      if (i < w.cols) {
        const q = at(i + 1, j);
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
      }
      if (j < w.rows) {
        const q = at(i, j + 1);
        ctx.moveTo(p[0], p[1]);
        ctx.lineTo(q[0], q[1]);
      }
    }
    ctx.stroke();
    const selected = this.app.warpEdit?.selected;
    pts.forEach(([x, y], i) => {
      ctx.beginPath();
      ctx.arc(x, y, i === selected ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = i === selected ? line : fill;
      ctx.fill();
      ctx.strokeStyle = line;
      ctx.stroke();
    });
    ctx.restore();
  }
}
