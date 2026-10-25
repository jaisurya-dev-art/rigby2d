// SPDX-License-Identifier: MIT OR Apache-2.0
// The canvas: draws the rig and handles pan/zoom, selection and the transform tools.

import { has, timecode } from './workspaces.js';
import { animationBounds, describeOutput, outputFrame } from './output.js';
import { Affine, toAffine, transform, wrapDegrees } from '../core/math.js';
import { makeBone } from '../core/model.js';
import { Pose } from '../core/pose.js';
import { FPS, Mode, TOOLS, selBone, selSlot } from './app.js';
import * as edit from './edit.js';
import { GLView } from './glview.js';
import { MeshTool } from './meshtool.js';
import { ShapeTool } from './shapetool.js';

const SELECTED = 'rgb(255,170,40)';
const BONE = 'rgb(110,200,230)';
const DRAG_THRESHOLD = 3;

const rgba = (rgb, a) => rgb.replace('rgb(', 'rgba(').replace(')', `,${a})`);

export class Viewport {
  constructor(app, canvas, glCanvas = null) {
    this.app = app;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    /** WebGL layer under this canvas for attachments, or null (Canvas 2D only). */
    this.glCanvas = glCanvas;
    this.glView = glCanvas ? GLView.create(glCanvas) : null;
    this.meshTool = new MeshTool(app, this);
    this.shapeTool = new ShapeTool(app, this);
    this.meshPress = false;
    this.width = 1;
    this.height = 1;
    /** Active tool drag: { kind: 'bone'|'slot'|'create', index, start, last }. */
    this.drag = null;
    this.press = null;
    this.panning = null;
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', (e) => this.onPointerUp(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  toScreen(p) {
    const v = this.app.view;
    return [this.width / 2 + v.panX + p[0] * v.zoom, this.height / 2 + v.panY - p[1] * v.zoom];
  }

  toWorld(p) {
    const v = this.app.view;
    return [(p[0] - this.width / 2 - v.panX) / v.zoom, -(p[1] - this.height / 2 - v.panY) / v.zoom];
  }

  /** World-to-screen as an affine matrix. */
  screenAffine() {
    const v = this.app.view;
    return new Affine(v.zoom, 0, 0, -v.zoom, this.width / 2 + v.panX, this.height / 2 + v.panY);
  }

  eventPos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const r = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, r.width);
    this.height = Math.max(1, r.height);
    const w = Math.round(this.width * dpr);
    const h = Math.round(this.height * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    return dpr;
  }

  draw() {
    const app = this.app;
    const dpr = this.resize();
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (app.frameRequest) {
      this.frameAll();
      app.frameRequest = false;
    }
    const pose = app.pose();
    const t0 = performance.now();
    const gl = app.renderer !== 'canvas' && this.glView?.draw(app, pose, this.width, this.height, dpr);
    if (this.glCanvas) this.glCanvas.hidden = !gl;
    if (gl) {
      // The WebGL layer drew the background, grid and attachments; this canvas only overlays.
      ctx.clearRect(0, 0, this.width, this.height);
      this.drawOutlines(pose);
    } else {
      ctx.fillStyle = 'rgb(38,38,38)';
      ctx.fillRect(0, 0, this.width, this.height);
      this.drawGrid();
      this.drawAttachments(pose, dpr);
    }
    this.attachmentTime = performance.now() - t0;
    this.drawShapes(pose);
    if (app.showBones) this.drawBones(pose);
    this.meshTool.draw(this.ctx);
    this.shapeTool.draw(this.ctx);
    if (this.drag?.kind === 'box') {
      const { from, to } = this.drag;
      this.ctx.save();
      this.ctx.setLineDash([4, 3]);
      this.polygon([from, [to[0], from[1]], to, [from[0], to[1]]], 'rgba(255,170,40,0.08)', SELECTED, 1);
      this.ctx.restore();
    }
    if (this.drag?.kind === 'create') {
      this.line(this.toScreen(this.drag.start), this.toScreen(this.drag.last), SELECTED, 2);
    }
    if (app.showFrame && has(app, 'outputFrame')) this.drawFrameGate();
    this.drawOverlay();
  }

  /** The output frame in world units for the current animation (auto framing is cached briefly). */
  outputFrame() {
    const app = this.app;
    const s = app.doc.settings;
    if (s.frame?.camera) {
      const i = app.doc.bones.findIndex((b) => b.name === 'camera');
      const pose = app.pose();
      if (i >= 0) {
        const m = pose.world[i];
        return outputFrame({ ...s, frame: { x: m.tx, y: m.ty, scale: s.frame.scale / (Math.hypot(m.a, m.b) || 1) } }, null);
      }
    }
    if (s.frame) return outputFrame(s, null);
    const key = `${app.mode}:${app.anim}`;
    const now = performance.now();
    if (!this.autoFrame || this.autoFrame.key !== key || now - this.autoFrame.at > 1000) {
      this.autoFrame = { key, at: now, bounds: animationBounds(app.doc, app.mode === 'animate' ? app.anim : null, s.fps) };
    }
    return outputFrame(s, this.autoFrame.bounds);
  }

  /** A fixed output frame that fits in the visible part of the viewport. */
  frameFromView() {
    const s = this.app.doc.settings;
    const [cx, cy] = this.toWorld([this.width / 2, this.height / 2]);
    const zoom = this.app.view.zoom;
    const scale = Math.max(1e-6, (Math.min(this.width / s.width, this.height / s.height) * 0.9) / zoom);
    return { x: cx, y: cy, scale };
  }

  /** Darkens what lies outside the output frame and outlines it. */
  drawFrameGate() {
    const f = this.outputFrame();
    const [x0, y0] = this.toScreen([f.x0, f.y1]);
    const [x1, y1] = this.toScreen([f.x1, f.y0]);
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.fillRect(0, 0, this.width, Math.max(0, y0));
    ctx.fillRect(0, y1, this.width, Math.max(0, this.height - y1));
    ctx.fillRect(0, y0, Math.max(0, x0), y1 - y0);
    ctx.fillRect(x1, y0, Math.max(0, this.width - x1), y1 - y0);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(x1 - x0), Math.round(y1 - y0));
    ctx.font = '11px system-ui, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.textBaseline = 'bottom';
    const label = `${describeOutput(this.app.doc.settings)}${this.app.doc.settings.frame ? '' : ' · auto framing'}`;
    ctx.fillText(label, x0 + 4, y0 - 3);
  }

  line(a, b, color, width = 1) {
    const ctx = this.ctx;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  frameAll() {
    const app = this.app;
    const pose = new Pose(app.doc);
    const pts = pose.quads(app.doc).flatMap((q) => q.positions);
    app.doc.bones.forEach((b, i) => {
      pts.push(pose.world[i].apply([0, 0]));
      pts.push(pose.world[i].apply([b.length, 0]));
    });
    let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [x, y] of pts) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    if (!pts.length || (x1 - x0 < 1 && y1 - y0 < 1)) {
      app.view = { panX: 0, panY: this.height * 0.25, zoom: 1 };
      return;
    }
    const zoom = Math.min(20, Math.max(0.05, Math.min(this.width / Math.max(1, x1 - x0), this.height / Math.max(1, y1 - y0)) * 0.8));
    const cx = (x0 + x1) * 0.5;
    const cy = (y0 + y1) * 0.5;
    app.view = { panX: -cx * zoom, panY: cy * zoom, zoom };
    app.changed();
  }

  drawGrid() {
    const zoom = this.app.view.zoom;
    let step = 50;
    while (step * zoom < 24) step *= 2;
    while (step * zoom > 120) step /= 2;
    const tl = this.toWorld([0, 0]);
    const br = this.toWorld([this.width, this.height]);
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgb(48,48,48)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = Math.floor(tl[0] / step) * step; x <= br[0]; x += step) {
      const sx = Math.round(this.toScreen([x, 0])[0]) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, this.height);
    }
    for (let y = Math.floor(br[1] / step) * step; y <= tl[1]; y += step) {
      const sy = Math.round(this.toScreen([0, y])[1]) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(this.width, sy);
    }
    ctx.stroke();
    const o = this.toScreen([0, 0]);
    this.line([0, o[1]], [this.width, o[1]], 'rgb(90,60,60)');
    this.line([o[0], 0], [o[0], this.height], 'rgb(60,90,60)');
  }

  drawAttachments(pose, dpr) {
    const app = this.app;
    const ctx = this.ctx;
    const screen = this.screenAffine();
    for (const q of pose.quads(app.doc)) {
      const att = q.attachment;
      const img = app.images.tinted(q.image, q.color);
      const pts = q.positions.map((p) => this.toScreen(p));
      const hasImage = img && img.width > 0 && img.height > 0;
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.max(0, q.color[3]));
      ctx.globalCompositeOperation = BLEND_OPS[q.blend] ?? 'source-over';
      ctx.imageSmoothingEnabled = app.doc.textureFilter !== 'nearest';
      if (q.kind === 'mesh') {
        if (hasImage) this.drawMesh(img, pts, q.uvs, q.triangles, dpr);
      } else if (hasImage) {
        // Image pixel (px, py) -> attachment-local point, then world, then screen.
        const toLocal = new Affine(att.width / img.width, 0, 0, -att.height / img.height, -att.width / 2, att.height / 2);
        const m = screen.mul(pose.attachmentWorld(app.doc, q.slot, att)).mul(toLocal);
        ctx.setTransform(dpr * m.a, dpr * m.b, dpr * m.c, dpr * m.d, dpr * m.tx, dpr * m.ty);
        ctx.drawImage(img, 0, 0);
      }
      ctx.restore();
      if (!hasImage) this.outline(q, pts, 'rgb(255,0,200)');
      if (selSlot(app.sel) === q.slot) this.outline(q, pts, SELECTED);
    }
  }

  /** Bounding boxes, clipping polygons, paths and points: shapes without an image. */
  drawShapes(pose) {
    const doc = this.app.doc;
    const ctx = this.ctx;
    const selected = selSlot(this.app.sel);
    const colors = { boundingbox: 'rgb(96,240,0)', clipping: 'rgb(206,58,58)', path: 'rgb(255,127,0)', point: 'rgb(241,241,0)' };
    ctx.save();
    for (let i = 0; i < doc.slots.length; i++) {
      const att = pose.slotAttachment(doc, i);
      if (!att || !(att.type in colors)) continue;
      const color = att.color ? `rgb(${att.color.slice(0, 3).map((c) => Math.round(c * 255)).join(',')})` : colors[att.type];
      ctx.strokeStyle = color;
      ctx.fillStyle = color;
      ctx.lineWidth = i === selected ? 2.5 : 1.25;
      if (att.type === 'point') {
        const m = pose.attachmentWorld(doc, i, att);
        const [o, tip] = [m.apply([0, 0]), m.apply([20 / this.app.view.zoom, 0])].map((p) => this.toScreen(p));
        ctx.beginPath();
        ctx.arc(o[0], o[1], 4, 0, Math.PI * 2);
        ctx.moveTo(o[0], o[1]);
        ctx.lineTo(tip[0], tip[1]);
        ctx.stroke();
        continue;
      }
      const flat = pose.worldVertices(doc, i, att);
      const pts = [];
      for (let k = 0; k + 1 < flat.length; k += 2) pts.push(this.toScreen([flat[k], flat[k + 1]]));
      if (att.type === 'path') {
        // Points are stored as [in-handle, point, out-handle].
        const n = Math.floor(pts.length / 3);
        const curves = att.closed ? n : n - 1;
        ctx.beginPath();
        for (let c = 0; c < curves; c++) {
          const p0 = pts[3 * c + 1];
          const c1 = pts[3 * c + 2];
          const next = (c + 1) % n;
          const c2 = pts[3 * next];
          const p1 = pts[3 * next + 1];
          if (c === 0) ctx.moveTo(p0[0], p0[1]);
          ctx.bezierCurveTo(c1[0], c1[1], c2[0], c2[1], p1[0], p1[1]);
        }
        ctx.stroke();
        if (i === selected) {
          for (let k = 0; k < n; k++) {
            const [hIn, p, hOut] = [pts[3 * k], pts[3 * k + 1], pts[3 * k + 2]];
            ctx.globalAlpha = 0.6;
            ctx.beginPath();
            ctx.moveTo(hIn[0], hIn[1]);
            ctx.lineTo(hOut[0], hOut[1]);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.fillRect(p[0] - 3, p[1] - 3, 6, 6);
          }
        }
        continue;
      }
      ctx.beginPath();
      pts.forEach((p, k) => (k ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      if (att.type === 'clipping') ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.restore();
  }

  /** Outlines of the selected slot and of attachments whose image is missing. */
  drawOutlines(pose) {
    const app = this.app;
    const selected = selSlot(app.sel);
    for (const q of pose.quads(app.doc)) {
      const img = app.images.get(q.image);
      const missing = !img || !img.width || !img.height;
      if (!missing && selected !== q.slot) continue;
      const pts = q.positions.map((p) => this.toScreen(p));
      if (missing) this.outline(q, pts, 'rgb(255,0,200)');
      if (selected === q.slot) this.outline(q, pts, SELECTED);
    }
  }

  /** Outline of a drawable: the quad, or the mesh hull. */
  outline(q, pts, color) {
    if (q.kind === 'mesh') {
      const hull = (this.app.doc.meshSource(q.slot, q.attachment)?.hull || pts.length) | 0;
      this.polygon(pts.slice(0, Math.max(3, Math.min(hull, pts.length))), null, color, 1.5);
    } else {
      this.polygon(pts, null, color, 1.5);
    }
  }

  /** Draws a textured triangle mesh: each triangle maps its UV triangle onto its screen triangle. */
  drawMesh(img, pts, uvs, triangles, dpr) {
    const ctx = this.ctx;
    const w = img.width;
    const h = img.height;
    for (let i = 0; i + 2 < triangles.length; i += 3) {
      const [i0, i1, i2] = [triangles[i], triangles[i + 1], triangles[i + 2]];
      const p0 = pts[i0];
      const p1 = pts[i1];
      const p2 = pts[i2];
      if (!p0 || !p1 || !p2) continue;
      const s0 = [uvs[i0][0] * w, uvs[i0][1] * h];
      const s1 = [uvs[i1][0] * w, uvs[i1][1] * h];
      const s2 = [uvs[i2][0] * w, uvs[i2][1] * h];
      // Affine map taking image pixels s0, s1, s2 to screen points p0, p1, p2.
      const su = [s1[0] - s0[0], s1[1] - s0[1]];
      const sv = [s2[0] - s0[0], s2[1] - s0[1]];
      const det = su[0] * sv[1] - sv[0] * su[1];
      if (Math.abs(det) < 1e-9) continue;
      const pu = [p1[0] - p0[0], p1[1] - p0[1]];
      const pv = [p2[0] - p0[0], p2[1] - p0[1]];
      const a = (pu[0] * sv[1] - pv[0] * su[1]) / det;
      const b = (pu[1] * sv[1] - pv[1] * su[1]) / det;
      const c = (pv[0] * su[0] - pu[0] * sv[0]) / det;
      const d = (pv[1] * su[0] - pu[1] * sv[0]) / det;
      const tx = p0[0] - a * s0[0] - c * s0[1];
      const ty = p0[1] - b * s0[0] - d * s0[1];
      // Clip to the screen triangle, grown by half a pixel to hide seams between triangles.
      const cx = (p0[0] + p1[0] + p2[0]) / 3;
      const cy = (p0[1] + p1[1] + p2[1]) / 3;
      const grow = (p) => {
        const dx = p[0] - cx;
        const dy = p[1] - cy;
        const l = Math.hypot(dx, dy) || 1;
        return [p[0] + (dx / l) * 0.5, p[1] + (dy / l) * 0.5];
      };
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.beginPath();
      for (const [k, p] of [p0, p1, p2].map(grow).entries()) (k ? ctx.lineTo : ctx.moveTo).call(ctx, p[0], p[1]);
      ctx.closePath();
      ctx.clip();
      ctx.setTransform(dpr * a, dpr * b, dpr * c, dpr * d, dpr * tx, dpr * ty);
      ctx.drawImage(img, 0, 0);
      ctx.restore();
    }
  }

  polygon(pts, fill, stroke, width) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = width;
      ctx.stroke();
    }
  }

  circle(c, r, fill, stroke, width) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(c[0], c[1], r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  drawBones(pose) {
    const app = this.app;
    const selection = new Set(app.selectedBones());
    app.doc.bones.forEach((b, i) => {
      const selected = selection.has(i);
      const color = selected ? SELECTED : BONE;
      const o = this.toScreen(pose.world[i].apply([0, 0]));
      const t = this.toScreen(pose.world[i].apply([b.length, 0]));
      const dir = [t[0] - o[0], t[1] - o[1]];
      const len = Math.hypot(dir[0], dir[1]);
      if (len < 4) {
        this.circle(o, 6, rgba(color, 0.35), color, 1.5);
        return;
      }
      const w = Math.min(12, Math.max(3, len * 0.1));
      const n = [(-dir[1] / len) * w, (dir[0] / len) * w];
      const mid = [o[0] + dir[0] * 0.18, o[1] + dir[1] * 0.18];
      this.polygon([o, [mid[0] + n[0], mid[1] + n[1]], t, [mid[0] - n[0], mid[1] - n[1]]], rgba(color, selected ? 0.55 : 0.3), color, 1.5);
      this.circle(o, w * 0.55, 'rgb(30,30,30)', color, 1.5);
    });
  }

  drawOverlay() {
    const app = this.app;
    let text = 'SETUP';
    if (app.mode === Mode.Animate) {
      const at = has(app, 'timecode') ? timecode(app.time, FPS) : `frame ${Math.round(app.time * FPS)}`;
      text = `ANIMATE · ${app.currentAnimation()?.name ?? ''} · ${at}`;
    }
    text += `   ${TOOLS.find((t) => t.id === app.tool)?.label ?? ''}`;
    const ctx = this.ctx;
    ctx.font = '13px system-ui, "Segoe UI", sans-serif';
    ctx.fillStyle = 'rgb(200,200,200)';
    ctx.textBaseline = 'top';
    ctx.fillText(text, 10, 8);
    // Events fired during playback fade out over a moment.
    const now = performance.now();
    let row = 0;
    for (const f of app.firedEvents) {
      const age = (now - f.at) / 1200;
      if (age >= 1) continue;
      ctx.fillStyle = `rgba(255,200,90,${1 - age})`;
      ctx.fillText(`⚑ ${f.name}`, 10, 30 + row++ * 18);
    }
    if (app.mode === Mode.Animate) {
      ctx.strokeStyle = 'rgba(255,110,80,0.7)';
      ctx.lineWidth = 2;
      ctx.strokeRect(2, 2, this.width - 4, this.height - 4);
    }
  }

  /** Finds the bone or slot under a screen position (bones first, then topmost image). */
  hitTest(pose, pos) {
    const app = this.app;
    if (app.showBones) {
      let best = null;
      app.doc.bones.forEach((b, i) => {
        const o = this.toScreen(pose.world[i].apply([0, 0]));
        const t = this.toScreen(pose.world[i].apply([b.length, 0]));
        const d = distToSegment(pos, o, t);
        const len = Math.hypot(t[0] - o[0], t[1] - o[1]);
        const reach = len < 4 ? 8 : Math.min(12, Math.max(5, len * 0.1));
        if (d <= reach && (best === null || d < best.d)) best = { d, i };
      });
      if (best) return { bone: best.i };
    }
    const world = this.toWorld(pos);
    for (const q of pose.quads(app.doc).reverse()) {
      const att = q.attachment;
      if (q.kind === 'mesh') {
        const t = q.triangles;
        for (let i = 0; i + 2 < t.length; i += 3) {
          if (pointInTriangle(world, q.positions[t[i]], q.positions[t[i + 1]], q.positions[t[i + 2]])) return { slot: q.slot };
        }
        continue;
      }
      const [lx, ly] = pose.attachmentWorld(app.doc, q.slot, att).inverse().apply(world);
      const { width: w, height: h } = att;
      if (Math.abs(lx) > w * 0.5 || Math.abs(ly) > h * 0.5) continue;
      const img = app.images.get(q.image);
      let opaque = true;
      if (img) {
        const px = Math.min(Math.floor((lx / w + 0.5) * img.width), img.width - 1);
        const py = Math.min(Math.floor((0.5 - ly / h) * img.height), img.height - 1);
        opaque = app.images.alphaAt(q.image, px, py) > 16;
      }
      if (opaque) return { slot: q.slot };
    }
    return null;
  }

  // ---- input --------------------------------------------------------------------------------

  onWheel(e) {
    e.preventDefault();
    const app = this.app;
    const delta = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    const factor = Math.exp(-delta * 0.0015);
    if (Math.abs(factor - 1) <= 1e-4) return;
    const cursor = this.eventPos(e);
    const old = app.view.zoom;
    const zoom = Math.min(20, Math.max(0.05, old * factor));
    const rel = [cursor[0] - this.width / 2 - app.view.panX, cursor[1] - this.height / 2 - app.view.panY];
    app.view.panX += rel[0] - rel[0] * (zoom / old);
    app.view.panY += rel[1] - rel[1] * (zoom / old);
    app.view.zoom = zoom;
    app.changed();
  }

  onPointerDown(e) {
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // The pointer is already gone (a very quick tap): handle the press without capture.
    }
    document.activeElement?.blur?.();
    const pos = this.eventPos(e);
    const editTool = this.meshTool.active ? this.meshTool : this.shapeTool.active ? this.shapeTool : null;
    if (e.button === 0 && editTool) {
      this.meshPress = editTool;
      editTool.down(pos, e);
    } else if (e.button === 0) {
      this.press = { pos, started: false, add: e.ctrlKey || e.metaKey };
    } else if (e.button === 1 || e.button === 2) {
      e.preventDefault();
      this.panning = pos;
    }
  }

  onPointerMove(e) {
    const app = this.app;
    const pos = this.eventPos(e);
    if (this.meshTool.active) {
      this.meshTool.hover = pos;
      if (this.meshPress === this.meshTool && e.buttons & 1) this.meshTool.move(pos);
      else if (app.meshEdit?.mode === 'weights') app.changed(); // brush outline follows the cursor
    }
    if (this.meshPress === this.shapeTool && e.buttons & 1) this.shapeTool.move(pos);
    if (this.panning) {
      app.view.panX += pos[0] - this.panning[0];
      app.view.panY += pos[1] - this.panning[1];
      this.panning = pos;
      app.changed();
    }
    if (this.press && e.buttons & 1) {
      if (!this.press.started && Math.hypot(pos[0] - this.press.pos[0], pos[1] - this.press.pos[1]) > DRAG_THRESHOLD) {
        this.press.started = true;
        this.dragStart(this.press.pos);
      }
      if (this.press.started) this.dragMove(pos);
    }
  }

  onPointerUp(e) {
    if (e.button === 1 || e.button === 2) this.panning = null;
    if (this.meshPress && (e.button === 0 || e.type === 'pointercancel')) {
      this.meshPress.up();
      this.meshPress = false;
      return;
    }
    if (e.button === 0 && this.press) {
      if (this.press.started) this.dragStop();
      else if (e.type === 'pointerup') this.click(this.press.pos, this.press.add);
      this.press = null;
    }
    if (e.type === 'pointercancel') {
      this.panning = null;
      this.press = null;
      this.drag = null;
    }
  }

  /** Click: select what is under the cursor; Ctrl adds or removes bones; empty space deselects. */
  click(pos, add) {
    const app = this.app;
    const hit = this.hitTest(app.pose(), pos);
    if (hit) app.select(hit, add);
    else if (!add) app.deselect();
    app.selectedKeys.clear();
    app.changed();
  }

  dragStart(press) {
    const app = this.app;
    const start = this.toWorld(press);
    const add = this.press?.add;
    let drag = null;
    if (app.tool === 'create') {
      if (app.mode === Mode.Animate) app.setStatus('Bones can only be created in Setup mode (Tab)');
      else drag = { kind: 'create', index: selBone(app.sel) ?? 0 };
    } else if (add) {
      drag = { kind: 'box', from: press, to: press };
    } else {
      const pose = app.pose();
      const hit = this.hitTest(pose, press);
      const bones = app.selectedBones();
      if (hit && selBone(hit) !== null) {
        if (!bones.includes(selBone(hit))) app.select(hit);
        if (app.tool === 'pose') {
          const b = selBone(hit);
          const origin = this.toScreen(pose.world[b].apply([0, 0]));
          const nearOrigin = Math.hypot(press[0] - origin[0], press[1] - origin[1]) < 10;
          drag = { kind: nearOrigin ? 'poseTranslate' : 'poseAim', index: b };
        } else {
          drag = { kind: 'bones' };
        }
      } else if (hit) {
        app.select(hit);
        drag = { kind: 'slot', index: selSlot(hit) };
      } else if (bones.length && app.tool !== 'pose') {
        // Dragging empty space transforms the current selection.
        drag = { kind: 'bones' };
      } else if (selSlot(app.sel) !== null && app.tool !== 'pose') {
        drag = { kind: 'slot', index: selSlot(app.sel) };
      } else {
        drag = { kind: 'box', from: press, to: press };
      }
    }
    this.drag = drag ? { ...drag, start, last: start } : null;
    app.changed();
  }

  dragMove(pos) {
    const d = this.drag;
    if (!d) return;
    const app = this.app;
    const world = this.toWorld(pos);
    if (d.kind === 'box') {
      d.to = pos;
    } else {
      const pose = app.pose();
      if (d.kind === 'bones') {
        for (const b of this.topLevel(app.selectedBones())) this.dragBone(pose, b, d.last, world, app.tool);
      } else if (d.kind === 'poseTranslate') {
        this.dragBone(pose, d.index, d.last, world, 'translate');
      } else if (d.kind === 'poseAim') {
        this.aimBone(pose, d.index, world);
      } else if (d.kind === 'slot') {
        this.dragSlot(pose, d.index, d.last, world);
      }
    }
    d.last = world;
    app.changed();
  }

  dragStop() {
    const d = this.drag;
    this.drag = null;
    if (d?.kind === 'create') this.createBone(this.app.pose(), d.index, d.start, d.last);
    if (d?.kind === 'box') this.boxSelect(d.from, d.to, this.press?.add);
    this.app.changed();
  }

  /** Selects the bones whose origin or tip lies inside the screen rectangle. */
  boxSelect(a, b, add) {
    const app = this.app;
    const pose = app.pose();
    const [x0, x1] = [Math.min(a[0], b[0]), Math.max(a[0], b[0])];
    const [y0, y1] = [Math.min(a[1], b[1]), Math.max(a[1], b[1])];
    const inside = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
    const hits = [];
    app.doc.bones.forEach((bone, i) => {
      const o = this.toScreen(pose.world[i].apply([0, 0]));
      const t = this.toScreen(pose.world[i].apply([bone.length, 0]));
      if (inside(o) || inside(t)) hits.push(i);
    });
    const bones = new Set(add ? app.selectedBones() : []);
    for (const h of hits) bones.add(h);
    app.multi = bones;
    app.sel = bones.size ? { bone: hits[0] ?? [...bones][0] } : null;
    app.setStatus(bones.size ? `${bones.size} bone${bones.size === 1 ? '' : 's'} selected` : 'Nothing selected');
  }

  /** Bones without a selected ancestor (their descendants move with them). */
  topLevel(bones) {
    const set = new Set(bones);
    const doc = this.app.doc;
    return bones.filter((b) => {
      for (let p = doc.bones[b].parent; p !== null; p = doc.bones[p].parent) if (set.has(p)) return false;
      return true;
    });
  }

  dragBone(pose, b, last, cur, tool) {
    const app = this.app;
    const local = { ...pose.local[b] };
    const parentIdx = app.doc.bones[b].parent;
    const parent = parentIdx === null ? new Affine() : pose.world[parentIdx];
    const origin = pose.world[b].apply([0, 0]);
    const sign = parent.determinant() < 0 ? -1 : 1;
    switch (tool) {
      case 'rotate':
        local.rotation += sign * angleBetween(origin, last, cur);
        break;
      case 'translate': {
        const d = parent.inverse().applyVector([cur[0] - last[0], cur[1] - last[1]]);
        local.x += d[0];
        local.y += d[1];
        break;
      }
      case 'scale': {
        const r = distanceRatio(origin, last, cur);
        local.scale_x *= r;
        local.scale_y *= r;
        break;
      }
      case 'shear':
        local.shear_y = (local.shear_y ?? 0) + sign * angleBetween(origin, last, cur);
        break;
      default:
        return;
    }
    edit.setBoneLocal(app, b, local);
  }

  /** Pose tool: rotates the bone so it points at the cursor. */
  aimBone(pose, b, cur) {
    const app = this.app;
    const w = pose.world[b];
    const origin = w.apply([0, 0]);
    const parentIdx = app.doc.bones[b].parent;
    const sign = parentIdx !== null && pose.world[parentIdx].determinant() < 0 ? -1 : 1;
    const desired = (Math.atan2(cur[1] - origin[1], cur[0] - origin[0]) * 180) / Math.PI;
    const local = { ...pose.local[b] };
    local.rotation += sign * wrapDegrees(desired - w.rotation());
    edit.setBoneLocal(app, b, local);
  }

  dragSlot(pose, s, last, cur) {
    const app = this.app;
    const att = pose.slotAttachment(app.doc, s);
    if (!att) return;
    if (!att.offset) {
      app.status = 'Only region images can be moved with the transform tools; meshes follow their bones';
      return;
    }
    const boneWorld = pose.world[app.doc.slots[s].bone];
    const center = boneWorld.mul(toAffine(att.offset)).apply([0, 0]);
    switch (app.tool) {
      case 'rotate':
        att.offset.rotation += (boneWorld.determinant() < 0 ? -1 : 1) * angleBetween(center, last, cur);
        break;
      case 'translate': {
        const d = boneWorld.inverse().applyVector([cur[0] - last[0], cur[1] - last[1]]);
        att.offset.x += d[0];
        att.offset.y += d[1];
        break;
      }
      case 'scale': {
        const r = distanceRatio(center, last, cur);
        att.offset.scale_x *= r;
        att.offset.scale_y *= r;
        break;
      }
      default:
        break;
    }
    if (app.mode === Mode.Animate) {
      app.status = 'Image placement is part of the setup pose; animate bones to move images over time';
    }
  }

  createBone(pose, parent, start, end) {
    const app = this.app;
    if (Math.hypot(end[0] - start[0], end[1] - start[1]) * app.view.zoom < 4) return;
    const inv = pose.world[parent].inverse();
    const p = inv.apply(start);
    const d = inv.applyVector([end[0] - start[0], end[1] - start[1]]);
    const name = app.doc.uniqueBoneName('bone');
    const setup = transform(p[0], p[1], (Math.atan2(d[1], d[0]) * 180) / Math.PI);
    const i = app.doc.addBone(makeBone(name, parent, setup, Math.hypot(d[0], d[1])));
    app.sel = { bone: i };
    app.setStatus(`Created ${name}: drag again to chain a child bone`);
  }
}

const BLEND_OPS = { normal: 'source-over', additive: 'lighter', multiply: 'multiply', screen: 'screen' };

function pointInTriangle(p, a, b, c) {
  if (!a || !b || !c) return false;
  const sign = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

function distToSegment(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1]];
  const lenSq = ab[0] * ab[0] + ab[1] * ab[1];
  const t = lenSq > 0 ? Math.min(1, Math.max(0, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / lenSq)) : 0;
  return Math.hypot(p[0] - (a[0] + ab[0] * t), p[1] - (a[1] + ab[1] * t));
}

function angleBetween(origin, a, b) {
  const a0 = Math.atan2(a[1] - origin[1], a[0] - origin[0]);
  const a1 = Math.atan2(b[1] - origin[1], b[0] - origin[0]);
  let d = ((a1 - a0) * 180) / Math.PI;
  if (d > 180) d -= 360;
  else if (d < -180) d += 360;
  return d;
}

function distanceRatio(origin, a, b) {
  const da = Math.hypot(a[0] - origin[0], a[1] - origin[1]);
  const db = Math.hypot(b[0] - origin[0], b[1] - origin[1]);
  return da < 1 ? 1 : db / da;
}
