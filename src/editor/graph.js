// SPDX-License-Identifier: MIT OR Apache-2.0
// Graph editor: bone channel values over time, with draggable keys and bezier handles.
//
// Curves are stored normalized per segment (x: fraction of the time between two keys, y: fraction
// of the value change), so a handle on a flat segment can move in time but not in value.

import { BONE_CHANNELS } from '../core/animation.js';
import { STEPPED, bezierFor, ease } from '../core/curve.js';
import { FPS, Mode, snap } from './app.js';
import { curveMenu, resortAnimation } from './timeline.js';

const GUTTER = 170;
const RULER = 22;
const ROW = 18;
const PAD = 14;
const HANDLE_LEN = 1 / 3;

const COMPONENT_COLORS = ['rgb(235,95,85)', 'rgb(110,200,95)', 'rgb(90,150,240)', 'rgb(230,200,80)'];
const SINGLE_COLOR = 'rgb(225,170,70)';
const COMPONENT_NAMES = { 0: 'x', 1: 'y' };

const valueOf = (k, c) => (Array.isArray(k.value) ? k.value[c] : k.value);
const componentCount = (k) => (Array.isArray(k.value) ? k.value.length : 1);
const numeric = (keys) => keys.length > 0 && (typeof keys[0].value === 'number' || (Array.isArray(keys[0].value) && typeof keys[0].value[0] === 'number'));

function setValue(k, c, v) {
  if (Array.isArray(k.value)) {
    k.value = k.value.slice();
    k.value[c] = v;
  } else {
    k.value = v;
  }
}

/** The bezier of component `c` on a curve, with linear curves as straight handles. */
function bezierOf(curve, c) {
  if (curve === STEPPED) return null;
  return bezierFor(curve, c) ?? [HANDLE_LEN, HANDLE_LEN, 1 - HANDLE_LEN, 1 - HANDLE_LEN];
}

/** Replaces component `c` of a key's curve with bezier `b`, keeping the other components. */
function setBezier(k, c, b) {
  const n = componentCount(k);
  if (n === 1) {
    k.curve = { bezier: b };
    return;
  }
  const all = [];
  for (let i = 0; i < n; i++) all.push(i === c ? b : bezierOf(k.curve, i).slice());
  k.curve = { beziers: all };
}

export class GraphEditor {
  constructor(app, scroller, canvas) {
    this.app = app;
    this.scroller = scroller;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    /** Hidden curves by id. */
    this.hidden = new Set();
    /** Value range shown, or null to fit the visible curves. */
    this.range = null;
    /** Time range shown ({ t0, t1 } in seconds), or null for the whole animation. */
    this.timeRange = null;
    /** Selected components per selected key (a key missing here has all components selected). */
    this.components = new Map();
    this.points = [];
    this.handles = [];
    this.rows = [];
    this.press = null;
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', () => (this.press = null));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('dblclick', (e) => {
      if (this.pos(e)[0] > GUTTER) this.fit();
    });
  }

  /** Curves of the selected bones (or of every keyed bone when none is selected). */
  curves(anim) {
    const app = this.app;
    const selected = new Set(app.selectedBones());
    const out = [];
    for (const tl of anim.bones) {
      if (selected.size && !selected.has(tl.bone)) continue;
      const name = app.doc.bones[tl.bone]?.name ?? `#${tl.bone}`;
      for (const channel of BONE_CHANNELS) {
        const keys = tl[channel];
        if (!numeric(keys)) continue;
        const n = componentCount(keys[0]);
        for (let c = 0; c < n; c++) {
          const label = `${name} · ${channel.replace(/([A-Z])/g, ' $1').toLowerCase()}${n > 1 ? ` ${COMPONENT_NAMES[c] ?? c}` : ''}`;
          out.push({ id: `${tl.bone}:${channel}:${c}`, keys, c, label, color: n > 1 ? COMPONENT_COLORS[c] : SINGLE_COLOR });
        }
      }
    }
    return out;
  }

  isSelected(k, c) {
    if (!this.app.selectedKeys.has(k)) return false;
    const comps = this.components.get(k);
    return !comps || comps.has(c);
  }

  fit() {
    this.range = null;
    this.timeRange = null;
    this.app.changed();
  }

  /** Shows the time range [t0, t1] (seconds); at least a few frames wide, inside the animation. */
  zoomTime(t0, t1) {
    const duration = this.layout?.duration ?? Math.max(this.app.currentAnimation()?.duration ?? 1, 1 / FPS);
    const span = Math.min(duration, Math.max(4 / FPS, t1 - t0));
    const start = Math.min(Math.max(0, t0), duration - span);
    this.timeRange = span >= duration - 1e-9 ? null : { t0: start, t1: start + span };
    this.app.changed();
  }

  draw() {
    const app = this.app;
    const anim = app.currentAnimation();
    if (!anim) return;
    for (const k of this.components.keys()) if (!app.selectedKeys.has(k)) this.components.delete(k);

    const curves = this.curves(anim);
    const visible = curves.filter((cv) => !this.hidden.has(cv.id));
    const duration = Math.max(anim.duration, 1 / FPS);
    const width = Math.max(1, this.scroller.clientWidth);
    const height = Math.max(RULER + curves.length * ROW + 6, this.scroller.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgb(30,30,30)';
    ctx.fillRect(0, 0, width, height);

    // Value range: fitted to the visible curves (including handles) unless zoomed.
    let range = this.range;
    if (!range) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const cv of visible) {
        for (const k of cv.keys) {
          lo = Math.min(lo, valueOf(k, cv.c));
          hi = Math.max(hi, valueOf(k, cv.c));
        }
      }
      if (!Number.isFinite(lo)) [lo, hi] = [-1, 1];
      if (hi - lo < 1e-3) [lo, hi] = [lo - 1, hi + 1];
      const margin = (hi - lo) * 0.12;
      range = { lo: lo - margin, hi: hi + margin };
    }
    const viewH = Math.max(40, this.scroller.clientHeight - RULER - PAD);
    const trackLeft = GUTTER;
    const trackW = Math.max(10, width - 12 - trackLeft);
    // Time range: the whole animation unless zoomed (Ctrl+wheel) or panned (Alt+wheel).
    const t0 = this.timeRange ? Math.max(0, this.timeRange.t0) : 0;
    const t1 = this.timeRange ? Math.min(duration, this.timeRange.t1) : duration;
    const timeToX = (t) => trackLeft + ((t - t0) / (t1 - t0)) * trackW;
    const valueToY = (v) => RULER + PAD / 2 + ((range.hi - v) / (range.hi - range.lo)) * viewH;
    this.layout = { trackLeft, trackW, duration, range, viewH, t0, t1 };

    // Value grid.
    ctx.save();
    ctx.beginPath();
    ctx.rect(trackLeft, RULER, width - trackLeft, height - RULER);
    ctx.clip();
    const step = niceStep((range.hi - range.lo) / Math.max(2, viewH / 40));
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'bottom';
    for (let v = Math.ceil(range.lo / step) * step; v <= range.hi; v += step) {
      const y = Math.round(valueToY(v)) + 0.5;
      ctx.strokeStyle = Math.abs(v) < step / 2 ? 'rgb(75,75,75)' : 'rgb(42,42,42)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(trackLeft, y);
      ctx.lineTo(width, y);
      ctx.stroke();
      ctx.fillStyle = 'rgb(120,120,120)';
      ctx.fillText(formatValue(v, step), trackLeft + 4, y - 1);
    }

    // Curves, keys and handles.
    this.points = [];
    this.handles = [];
    for (const cv of visible) {
      const { keys, c, color } = cv;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(trackLeft, valueToY(valueOf(keys[0], c)));
      for (let i = 0; i < keys.length; i++) {
        const a = keys[i];
        const va = valueOf(a, c);
        ctx.lineTo(timeToX(a.time), valueToY(va));
        const b = keys[i + 1];
        if (!b) break;
        const vb = valueOf(b, c);
        if (a.curve === STEPPED) {
          ctx.lineTo(timeToX(b.time), valueToY(va));
          continue;
        }
        const segs = Math.max(2, Math.min(48, Math.round((timeToX(b.time) - timeToX(a.time)) / 4)));
        for (let s = 1; s < segs; s++) {
          const t = s / segs;
          ctx.lineTo(timeToX(a.time + (b.time - a.time) * t), valueToY(va + (vb - va) * ease(a.curve, t, c)));
        }
      }
      ctx.lineTo(timeToX(duration), valueToY(valueOf(keys[keys.length - 1], c)));
      ctx.stroke();

      keys.forEach((k, i) => {
        const p = [timeToX(k.time), valueToY(valueOf(k, c))];
        const selected = this.isSelected(k, c);
        if (selected) this.drawHandles(ctx, keys, i, c, timeToX, valueToY, color);
        ctx.fillStyle = selected ? 'rgb(255,190,60)' : color;
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.rect(p[0] - 3.5, p[1] - 3.5, 7, 7);
        ctx.fill();
        ctx.stroke();
        this.points.push({ x: p[0], y: p[1], key: k, keys, c });
      });
    }

    if (this.press?.box) {
      const { from, to } = this.press.box;
      ctx.fillStyle = 'rgba(255,170,40,0.1)';
      ctx.strokeStyle = 'rgb(255,170,40)';
      ctx.fillRect(Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
      ctx.strokeRect(Math.min(from[0], to[0]) + 0.5, Math.min(from[1], to[1]) + 0.5, Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
    }
    ctx.restore();

    // Ruler.
    ctx.fillStyle = 'rgb(45,45,45)';
    ctx.fillRect(0, 0, width, RULER);
    const frames = Math.min(Math.round(duration * FPS), Math.ceil(t1 * FPS));
    const pxPerFrame = trackW / ((t1 - t0) * FPS);
    const labelEvery = [1, 2, 5, 10, 15, 30, 60].find((n) => n * pxPerFrame >= 34) ?? 120;
    ctx.strokeStyle = 'rgb(120,120,120)';
    ctx.lineWidth = 1;
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgb(170,170,170)';
    ctx.beginPath();
    for (let f = Math.max(0, Math.floor(t0 * FPS)); f <= frames; f++) {
      const x = Math.round(timeToX(f / FPS)) + 0.5;
      const major = f % labelEvery === 0;
      if (major || pxPerFrame >= 5) {
        ctx.moveTo(x, RULER - (major ? 10 : 5));
        ctx.lineTo(x, RULER);
      }
      if (major) ctx.fillText(String(f), x + 2, 2);
    }
    ctx.stroke();

    // Curve list.
    ctx.fillStyle = 'rgb(30,30,30)';
    ctx.fillRect(0, RULER, GUTTER, height - RULER);
    ctx.fillStyle = 'rgb(150,150,150)';
    ctx.font = '11px system-ui, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillText(curves.length ? (this.range || this.timeRange ? 'Double-click: fit' : 'Curves') : 'No keyed bone channels', 8, RULER / 2);
    this.rows = [];
    curves.forEach((cv, r) => {
      const y = RULER + r * ROW;
      const shown = !this.hidden.has(cv.id);
      ctx.fillStyle = shown ? cv.color : 'rgb(70,70,70)';
      ctx.fillRect(8, y + 5, 8, 8);
      ctx.fillStyle = shown ? 'rgb(210,210,210)' : 'rgb(110,110,110)';
      ctx.font = '12px system-ui, "Segoe UI", sans-serif';
      ctx.fillText(cv.label, 22, y + ROW / 2, GUTTER - 28);
      this.rows.push({ y0: y, y1: y + ROW, id: cv.id });
    });
    ctx.strokeStyle = 'rgb(60,60,60)';
    ctx.beginPath();
    ctx.moveTo(trackLeft + 0.5, 0);
    ctx.lineTo(trackLeft + 0.5, height);
    ctx.stroke();

    // Time cursor.
    const cx = timeToX(Math.min(app.time, duration));
    ctx.strokeStyle = 'rgb(255,90,70)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, height);
    ctx.stroke();
  }

  /** Draws the in and out handles of key `i` and records them for hit testing. */
  drawHandles(ctx, keys, i, c, timeToX, valueToY, color) {
    const k = keys[i];
    const pk = [timeToX(k.time), valueToY(valueOf(k, c))];
    const add = (seg, side) => {
      const a = keys[seg];
      const b = keys[seg + 1];
      const bz = b && bezierOf(a.curve, c);
      if (!bz) return;
      const va = valueOf(a, c);
      const vb = valueOf(b, c);
      const [hx, hy] = side === 'out' ? [bz[0], bz[1]] : [bz[2], bz[3]];
      const p = [timeToX(a.time + (b.time - a.time) * hx), valueToY(va + (vb - va) * hy)];
      ctx.strokeStyle = 'rgba(220,220,220,0.6)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(pk[0], pk[1]);
      ctx.lineTo(p[0], p[1]);
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(p[0], p[1], 3.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'black';
      ctx.stroke();
      this.handles.push({ x: p[0], y: p[1], keys, seg, side, c });
    };
    add(i, 'out');
    if (i > 0) add(i - 1, 'in');
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  xToTime(x) {
    const { trackLeft, trackW, duration, t0, t1 } = this.layout;
    return Math.min(duration, Math.max(0, t0 + ((x - trackLeft) / trackW) * (t1 - t0)));
  }

  yToValue(y) {
    const { range, viewH } = this.layout;
    return range.hi - ((y - RULER - PAD / 2) / viewH) * (range.hi - range.lo);
  }

  /** Value units per pixel. */
  valuePerPixel() {
    const { range, viewH } = this.layout;
    return (range.hi - range.lo) / viewH;
  }

  hitPoint(p) {
    for (let i = this.handles.length - 1; i >= 0; i--) {
      const h = this.handles[i];
      if (Math.hypot(p[0] - h.x, p[1] - h.y) <= 6) return { handle: h };
    }
    for (let i = this.points.length - 1; i >= 0; i--) {
      const pt = this.points[i];
      if (Math.abs(p[0] - pt.x) <= 6 && Math.abs(p[1] - pt.y) <= 6) return { point: pt };
    }
    return null;
  }

  selectPoints(points, add) {
    const app = this.app;
    if (!add) {
      app.selectedKeys = new Set();
      this.components.clear();
    }
    for (const pt of points) {
      const had = app.selectedKeys.has(pt.key);
      const comps = this.components.get(pt.key) ?? (had ? null : new Set());
      if (comps === null) continue; // already fully selected
      comps.add(pt.c);
      this.components.set(pt.key, comps);
      app.selectedKeys.add(pt.key);
    }
    app.selectedKeys = new Set(app.selectedKeys);
  }

  togglePoint(pt) {
    const app = this.app;
    if (this.isSelected(pt.key, pt.c)) {
      const comps = this.components.get(pt.key);
      if (comps) comps.delete(pt.c);
      if (!comps || !comps.size) {
        this.components.delete(pt.key);
        app.selectedKeys.delete(pt.key);
      }
      app.selectedKeys = new Set(app.selectedKeys);
    } else {
      this.selectPoints([pt], true);
    }
  }

  onWheel(e) {
    if (!this.layout || this.pos(e)[0] <= GUTTER) return;
    e.preventDefault();
    const { range, t0, t1 } = this.layout;
    if (e.ctrlKey || e.metaKey) {
      // Ctrl+wheel: zoom time around the cursor.
      const at = this.xToTime(this.pos(e)[0]);
      const f = Math.exp(Math.sign(e.deltaY) * 0.15);
      this.zoomTime(at + (t0 - at) * f, at + (t1 - at) * f);
      return;
    }
    if (e.altKey) {
      // Alt+wheel: pan time.
      const shift = (Math.sign(e.deltaY || e.deltaX) * (t1 - t0)) / 10;
      this.zoomTime(t0 + shift, t1 + shift);
      return;
    }
    if (e.shiftKey) {
      const shift = (Math.sign(e.deltaY) * (range.hi - range.lo)) / 10;
      this.range = { lo: range.lo - shift, hi: range.hi - shift };
    } else {
      const at = this.yToValue(this.pos(e)[1]);
      const f = Math.exp(Math.sign(e.deltaY) * 0.15);
      this.range = { lo: at + (range.lo - at) * f, hi: at + (range.hi - at) * f };
    }
    this.app.changed();
  }

  onPointerDown(e) {
    if (!this.layout) return;
    const app = this.app;
    const p = this.pos(e);
    const add = e.ctrlKey || e.metaKey;
    if (p[0] <= GUTTER && p[1] > RULER) {
      const row = this.rows.find((r) => p[1] >= r.y0 && p[1] < r.y1);
      if (row && e.button === 0) {
        if (this.hidden.has(row.id)) this.hidden.delete(row.id);
        else this.hidden.add(row.id);
        app.changed();
      }
      return;
    }
    if (e.button === 2) {
      const hit = this.hitPoint(p);
      if (hit?.point && !this.isSelected(hit.point.key, hit.point.c)) this.selectPoints([hit.point], false);
      if (app.selectedKeys.size) curveMenu(app, e.clientX, e.clientY);
      app.changed();
      return;
    }
    if (e.button === 1) {
      e.preventDefault();
      this.canvas.setPointerCapture(e.pointerId);
      this.press = { pan: { y: p[1], range: { ...this.layout.range } } };
      return;
    }
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.press = { pos: p, started: false, add, alt: e.altKey, hit: this.hitPoint(p), inRuler: p[1] <= RULER };
  }

  onPointerMove(e) {
    const press = this.press;
    if (!press) return;
    const app = this.app;
    const p = this.pos(e);
    if (press.pan) {
      const dv = (p[1] - press.pan.y) * ((press.pan.range.hi - press.pan.range.lo) / this.layout.viewH);
      this.range = { lo: press.pan.range.lo + dv, hi: press.pan.range.hi + dv };
      app.changed();
      return;
    }
    if (!(e.buttons & 1)) return;
    if (!press.started) {
      if (Math.hypot(p[0] - press.pos[0], p[1] - press.pos[1]) <= 3) return;
      press.started = true;
      app.playing = false;
      app.mode = Mode.Animate;
      // Freeze the value range while dragging so the view does not chase the edit.
      if (!this.range) this.range = { ...this.layout.range };
      if (press.hit?.handle) {
        press.handleDrag = this.beginHandleDrag(press.hit.handle);
      } else if (press.hit?.point) {
        const pt = press.hit.point;
        if (!this.isSelected(pt.key, pt.c)) this.selectPoints([pt], press.add);
        press.move = this.beginMove(pt);
      } else if (!press.inRuler) {
        press.box = { from: press.pos, to: p };
      }
    }
    if (press.handleDrag) this.dragHandle(press.handleDrag, p, e.altKey || press.alt);
    else if (press.move) this.dragMove(press.move, p, e.shiftKey);
    else if (press.box) press.box.to = p;
    else app.time = snap(this.xToTime(p[0]));
    app.changed();
  }

  onPointerUp(e) {
    const press = this.press;
    if (!press) return;
    this.press = null;
    const app = this.app;
    if (press.pan || e.button !== 0) return;
    if (!press.started) {
      const hit = press.hit;
      if (hit?.point) {
        if (press.add) this.togglePoint(hit.point);
        else {
          this.selectPoints([hit.point], false);
          app.time = hit.point.key.time;
        }
      } else if (!hit) {
        if (!press.add) {
          app.selectedKeys = new Set();
          this.components.clear();
        }
        app.time = snap(this.xToTime(press.pos[0]));
      }
      app.playing = false;
      app.mode = Mode.Animate;
    } else if (press.move) {
      resortAnimation(app.currentAnimation());
      app.setStatus(`Moved ${app.selectedKeys.size} key${app.selectedKeys.size === 1 ? '' : 's'}`);
    } else if (press.handleDrag) {
      app.setStatus('Curve edited');
    } else if (press.box) {
      const { from, to } = press.box;
      const [x0, x1] = [Math.min(from[0], to[0]), Math.max(from[0], to[0])];
      const [y0, y1] = [Math.min(from[1], to[1]), Math.max(from[1], to[1])];
      this.selectPoints(this.points.filter((pt) => pt.x >= x0 && pt.x <= x1 && pt.y >= y0 && pt.y <= y1), press.add);
      app.setStatus(`${app.selectedKeys.size} key${app.selectedKeys.size === 1 ? '' : 's'} selected`);
    }
    app.changed();
  }

  /** Records the selected keys' times and the selected values before a move. */
  beginMove(grab) {
    const entries = [];
    const keys = new Set();
    for (const pt of this.points) {
      if (!this.isSelected(pt.key, pt.c)) continue;
      entries.push({ key: pt.key, c: pt.c, value: valueOf(pt.key, pt.c) });
      keys.add(pt.key);
    }
    return { grab: [grab.key.time, valueOf(grab.key, grab.c)], start: this.press.pos, values: entries, times: [...keys].map((key) => ({ key, time: key.time })) };
  }

  /** Moves the selected keys in time and value; Shift locks to the larger direction. */
  dragMove(move, p, lock) {
    let dxPx = p[0] - move.start[0];
    let dyPx = p[1] - move.start[1];
    if (lock) {
      if (Math.abs(dxPx) > Math.abs(dyPx)) dyPx = 0;
      else dxPx = 0;
    }
    const dt = snap(move.grab[0] + (dxPx / this.layout.trackW) * (this.layout.t1 - this.layout.t0)) - move.grab[0];
    const dv = -dyPx * this.valuePerPixel();
    for (const m of move.times) m.key.time = Math.max(0, snap(m.time + dt));
    for (const m of move.values) setValue(m.key, m.c, m.value + dv);
    this.app.time = Math.max(0, move.grab[0] + dt);
  }

  beginHandleDrag(h) {
    const a = h.keys[h.seg];
    const b = h.keys[h.seg + 1];
    a.curve = cloneForEdit(a.curve, a);
    // The opposite handle across the key, kept aligned unless Alt is held.
    const pivot = h.side === 'out' ? a : b;
    const otherSeg = h.side === 'out' ? h.seg - 1 : h.seg + 1;
    const other = otherSeg >= 0 && otherSeg + 1 < h.keys.length && h.keys[otherSeg].curve !== STEPPED ? otherSeg : null;
    return { ...h, a, b, pivot, other };
  }

  dragHandle(d, p, broken) {
    const { a, b, c } = d;
    const dt = b.time - a.time;
    if (dt <= 0) return;
    const va = valueOf(a, c);
    const vb = valueOf(b, c);
    const bz = bezierOf(a.curve, c).slice();
    const x = Math.min(1, Math.max(0, (this.xToTime(p[0]) - a.time) / dt));
    const v = this.yToValue(p[1]);
    const dv = vb - va;
    const i = d.side === 'out' ? 0 : 2;
    bz[i] = x;
    if (Math.abs(dv) > 1e-9) bz[i + 1] = (v - va) / dv;
    setBezier(a, c, bz);
    if (broken || d.other === null) return;

    // Mirror the slope onto the handle on the other side of the key.
    const hx = a.time + bz[i] * dt;
    const hv = va + bz[i + 1] * dv;
    const pv = valueOf(d.pivot, c);
    const run = hx - d.pivot.time;
    if (Math.abs(run) < 1e-9) return;
    const slope = (hv - pv) / run;
    const oa = d.keys[d.other];
    const ob = d.keys[d.other + 1];
    const odt = ob.time - oa.time;
    const odv = valueOf(ob, c) - valueOf(oa, c);
    if (odt <= 0 || Math.abs(odv) < 1e-9) return;
    const obz = bezierOf(oa.curve, c).slice();
    const j = d.side === 'out' ? 2 : 0; // the other segment's handle at the pivot
    const ohx = oa.time + obz[j] * odt;
    const ohv = pv + slope * (ohx - d.pivot.time);
    obz[j + 1] = (ohv - valueOf(oa, c)) / odv;
    setBezier(oa, c, obz);
  }
}

/** A curve made editable: imported exact control points no longer apply once edited. */
function cloneForEdit(curve, k) {
  const n = componentCount(k);
  if (n === 1) return { bezier: bezierOf(curve, 0).slice() };
  const out = [];
  for (let i = 0; i < n; i++) out.push(bezierOf(curve, i).slice());
  return { beziers: out };
}

function niceStep(raw) {
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}

function formatValue(v, step) {
  const decimals = Math.max(0, -Math.floor(Math.log10(step)));
  return v.toFixed(Math.min(4, decimals));
}

