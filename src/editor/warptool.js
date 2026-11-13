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

  /**
   * The animation keys are written to: the side of a turn being shaped (warpEdit.anim), else the
   * current animation in Animate mode; null in Setup mode (where a drag reshapes for good).
   */
  animName() {
    if (this.app.warpEdit?.anim) return this.app.warpEdit.anim;
    return this.app.mode === Mode.Animate ? (this.app.currentAnimation()?.name ?? null) : null;
  }

  /** The time keys are written at (the side being shaped, else the playhead). */
  time() {
    return this.app.warpEdit?.time ?? this.app.time;
  }

  /** This warp's own offsets now (a copy; zeros in Setup mode or without keys). */
  ownOffsets(w) {
    const name = this.animName();
    return (name && warpOffsetsAt(w, name, this.time())) || new Array(pointsOf(w) * 2).fill(0);
  }

  /** The picked points (a Set of indices). */
  picked() {
    const e = this.app.warpEdit;
    if (!(e.picked instanceof Set)) e.picked = new Set();
    return e.picked;
  }

  /** The lattice points as drawn, in screen space. */
  screenPoints(w) {
    const app = this.app;
    const offsets = chainOffsetsAt(app.doc, w, this.animName(), this.time());
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

  /** Is a screen position inside the lattice (its outline as drawn)? */
  inside(w, pos) {
    const pts = this.screenPoints(w);
    const ring = [];
    for (let i = 0; i <= w.cols; i++) ring.push(pts[i]);
    for (let j = 1; j <= w.rows; j++) ring.push(pts[j * (w.cols + 1) + w.cols]);
    for (let i = w.cols - 1; i >= 0; i--) ring.push(pts[w.rows * (w.cols + 1) + i]);
    for (let j = w.rows - 1; j >= 1; j--) ring.push(pts[j * (w.cols + 1)]);
    let hit = false;
    for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
      const [xi, yi] = ring[i];
      const [xk, yk] = ring[k];
      if (yi > pos[1] !== yk > pos[1] && pos[0] < ((xk - xi) * (pos[1] - yi)) / (yk - yi) + xi) hit = !hit;
    }
    return hit;
  }

  /**
   * A press: on a point, picks it (Shift adds or removes it) and drags the picked points; inside
   * the lattice, drags every point (moves the whole shape).
   */
  down(pos, e = {}) {
    const w = this.warp();
    if (!w) return;
    if (this.app.mode === Mode.Animate && !this.animName()) {
      this.app.setStatus(t('Choose an animation to key the warp'));
      return;
    }
    const picked = this.picked();
    const index = this.pointAt(w, pos);
    let moving;
    if (index >= 0) {
      if (e.shiftKey) {
        if (picked.has(index)) picked.delete(index);
        else picked.add(index);
        this.app.changed();
        return;
      }
      if (!picked.has(index)) {
        picked.clear();
        picked.add(index);
      }
      moving = [...picked];
    } else if (this.inside(w, pos)) {
      moving = Array.from({ length: pointsOf(w) }, (_, i) => i);
    } else {
      picked.clear();
      this.app.changed();
      return;
    }
    const bone = this.app.doc.boneIndex(w.bone);
    const inv = this.app.pose().world[bone].inverse();
    this.drag = { moving, from: this.viewport.toWorld(pos), base: this.ownOffsets(w), offsets: this.ownOffsets(w), applied: [0, 0], inv };
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
    for (const i of d.moving) {
      d.offsets[2 * i] += bx;
      d.offsets[2 * i + 1] += by;
    }
    if (this.animName()) {
      keyWarp(w, this.animName(), Math.round(this.time() * 1e4) / 1e4, d.offsets);
      bakeWarps(app.doc);
    } else {
      // Setup: reshape the meshes by what the points moved since the last step.
      const step = new Array(pointsOf(w) * 2).fill(0);
      for (const i of d.moving) {
        step[2 * i] = bx - d.applied[0];
        step[2 * i + 1] = by - d.applied[1];
      }
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
    const picked = this.picked();
    pts.forEach(([x, y], i) => {
      ctx.beginPath();
      ctx.arc(x, y, picked.has(i) ? 5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = picked.has(i) ? line : fill;
      ctx.fill();
      ctx.strokeStyle = line;
      ctx.stroke();
    });
    ctx.restore();
  }
}
