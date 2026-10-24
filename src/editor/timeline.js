// SPDX-License-Identifier: MIT OR Apache-2.0
// Bottom panel: animation list, transport controls and the dopesheet (the graph editor is graph.js).

import { has, timecode } from './workspaces.js';
import { Animation } from '../core/animation.js';
import { listConstraints } from '../core/constraintdata.js';
import { keyedChannels, setConstraintCurve } from '../core/constraintkeys.js';
import { EASE_IN, EASE_IN_OUT, EASE_OUT, LINEAR, STEPPED, cloneCurve, isBezier } from '../core/curve.js';
import { uniqueName } from '../core/model.js';
import { FPS, Mode, selBone, selSlot, snap } from './app.js';
import * as edit from './edit.js';
import { dragValue, h, popupMenu, select, textField } from './widgets.js';
// The dopesheet's row order and key-selection-by-index live in keyorder.js (core-only, so the
// selection round trip can be tested in Node). Re-exported here so the windows import them as before.
import { tracks, trackKeys } from './keyorder.js';
export { orderedKeys, keySelectionIndices, applyKeySelection } from './keyorder.js';

const GUTTER = 170;
const ROW = 20;
const RULER = 22;

/** Transport and animation controls (rebuilt when the app changes). */
export function renderControls(app, el) {
  const anim = app.currentAnimation();
  const names = app.doc.animations.map((a, i) => [i, a.name]);
  const play = h('button', { 'data-tut': 'timeline:play', disabled: app.anim === null, title: 'Play / pause (Space)', onclick: () => app.togglePlay() }, app.playing ? '⏸' : '▶');
  el.replaceChildren(
    ...[
      names.length
        ? select(
            names,
            app.anim ?? 0,
            (i) => {
              app.anim = i;
              app.time = 0;
              app.selectedKeys.clear();
              app.changed();
            },
            { tut: 'timeline:animations' },
          )
        : h('span', { class: 'weak' }, '(no animation)'),
      h(
        'button',
        {
          'data-tut': 'timeline:new',
          onclick: () => {
            app.doc.animations.push(new Animation(uniqueName('animation', (n) => app.doc.animations.some((a) => a.name === n)), 1));
            app.anim = app.doc.animations.length - 1;
            app.mode = Mode.Animate;
            app.time = 0;
            app.changed();
          },
        },
        '＋ New',
      ),
      anim
        ? [
            textField(
              anim.name,
              (v) => {
                anim.name = v;
                app.changed();
              },
              { width: '110px' },
            ),
            h('span', null, 'Length'),
            dragValue(
              anim.duration,
              (v) => {
                anim.duration = v;
                app.changed();
              },
              { speed: 0.01, min: 1 / FPS, max: 600, suffix: ' s', decimals: 2 },
            ),
            h(
              'button',
              {
                title: 'Delete animation',
                onclick: () => {
                  app.doc.animations.splice(app.anim, 1);
                  app.anim = app.doc.animations.length ? 0 : null;
                  app.selectedKeys.clear();
                  app.changed();
                },
              },
              '🗑',
            ),
          ]
        : null,
      h('span', { class: 'vsep' }),
      h(
        'button',
        {
          title: 'Go to start',
          onclick: () => {
            app.time = 0;
            app.playing = false;
            app.changed();
          },
        },
        '⏮',
      ),
      h('button', { title: 'Previous frame (←)', onclick: () => app.stepFrame(-1) }, '◀'),
      play,
      h('button', { 'data-tut': 'timeline:next', title: 'Next frame (→)', onclick: () => app.stepFrame(1) }, '▶|'),
      h(
        'label',
        null,
        h('input', {
          type: 'checkbox',
          checked: app.looping,
          onchange: (e) => {
            app.looping = e.target.checked;
            app.changed();
          },
        }),
        ' Loop',
      ),
      h(
        'span',
        { class: 'mono', title: has(app, 'timecode') ? 'Timecode (hours:minutes:seconds:frames) and frame' : 'Frame and seconds' },
        has(app, 'timecode') ? `${timecode(app.time, FPS)}  frame ${Math.round(app.time * FPS)}` : `frame ${String(Math.round(app.time * FPS)).padStart(3, ' ')}  ${app.time.toFixed(2)}s`,
      ),
      h('span', { class: 'vsep' }),
      h('button', { 'data-tut': 'timeline:key', disabled: app.mode !== Mode.Animate, onclick: () => edit.keySelection(app) }, '◆ Key (K)'),
      h('span', { class: 'vsep' }),
      h(
        'span',
        { class: 'segmented', title: 'Timeline view' },
        [
          ['dopesheet', 'Dopesheet'],
          ['graph', 'Graph'],
        ].map(([id, label]) =>
          h(
            'button',
            {
              class: app.timelineView === id ? 'active' : '',
              onclick: () => {
                app.timelineView = id;
                app.changed();
              },
            },
            label,
          ),
        ),
      ),
    ]
      .flat()
      .filter(Boolean),
  );
}

/** Deletes every selected key. */
export function deleteSelectedKeys(app) {
  const anim = app.currentAnimation();
  if (!anim || !app.selectedKeys.size) return;
  const drop = (keys) => {
    for (let i = keys.length - 1; i >= 0; i--) if (app.selectedKeys.has(keys[i])) keys.splice(i, 1);
  };
  for (const tl of [...anim.bones, ...anim.slots]) for (const v of Object.values(tl)) if (Array.isArray(v)) drop(v);
  for (const tl of [...anim.deform, ...anim.ik]) drop(tl.keys);
  drop(anim.drawOrder);
  drop(anim.events);
  for (const t of keyedChannels(anim, listConstraints(app.doc))) drop(t.keys);
  for (const keys of sequenceLists(anim)) drop(keys);
  pruneConstraintKeys(anim);
  const count = app.selectedKeys.size;
  app.selectedKeys.clear();
  anim.prune();
  app.setStatus(`Deleted ${count} key${count === 1 ? '' : 's'}`);
}

function keyFill(selected, curve) {
  if (selected) return 'rgb(255,190,60)';
  if (curve === STEPPED) return 'rgb(200,120,255)';
  if (isBezier(curve)) return 'rgb(120,220,140)';
  return 'rgb(230,230,230)';
}

export class Dopesheet {
  constructor(app, scroller, canvas) {
    this.app = app;
    this.scroller = scroller;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.keyRects = [];
    this.layout = null;
    this.press = null;
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', () => (this.press = null));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  draw() {
    const app = this.app;
    const anim = app.currentAnimation();
    const empty = this.scroller.parentElement.querySelector('.empty');
    empty.hidden = !!anim;
    this.scroller.hidden = !anim;
    if (!anim) return;

    const rows = tracks(app, anim);
    const duration = Math.max(anim.duration, 1 / FPS);
    const width = Math.max(1, this.scroller.clientWidth);
    const height = Math.max(RULER + Math.max(rows.length, 1) * ROW + 6, this.scroller.clientHeight);
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

    const trackLeft = GUTTER;
    const trackW = Math.max(10, width - 12 - trackLeft);
    const timeToX = (t) => trackLeft + (t / duration) * trackW;
    this.layout = { trackLeft, trackW, duration };

    // Ruler with frame ticks.
    ctx.fillStyle = 'rgb(45,45,45)';
    ctx.fillRect(0, 0, width, RULER);
    const frames = Math.round(duration * FPS);
    const pxPerFrame = trackW / (duration * FPS);
    const labelEvery = [1, 2, 5, 10, 15, 30, 60].find((n) => n * pxPerFrame >= 34) ?? 120;
    ctx.strokeStyle = 'rgb(120,120,120)';
    ctx.lineWidth = 1;
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgb(170,170,170)';
    ctx.beginPath();
    for (let f = 0; f <= frames; f++) {
      const x = Math.round(timeToX(f / FPS)) + 0.5;
      const major = f % labelEvery === 0;
      if (major || pxPerFrame >= 5) {
        ctx.moveTo(x, RULER - (major ? 10 : 5));
        ctx.lineTo(x, RULER);
      }
      if (major) ctx.fillText(String(f), x + 2, 2);
    }
    ctx.stroke();

    // Rows.
    const selectedBone = selBone(app.sel);
    const selectedSlot = selSlot(app.sel);
    this.keyRects = [];
    rows.forEach(({ track, label }, r) => {
      const y = RULER + r * ROW;
      const highlight = (track.bone !== undefined && track.bone === selectedBone) || (track.slot !== undefined && track.slot === selectedSlot);
      if (r % 2 === 1 || highlight) {
        ctx.fillStyle = highlight ? 'rgb(55,50,40)' : 'rgb(34,34,34)';
        ctx.fillRect(0, y, width, ROW);
      }
      ctx.font = '12px system-ui, "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgb(200,200,200)';
      ctx.fillText(label, 8, y + ROW / 2, GUTTER - 14);
      (trackKeys(anim, track) ?? []).forEach((k, index) => {
        const c = [timeToX(k.time), y + ROW / 2];
        diamond(ctx, c, 5.5, keyFill(app.selectedKeys.has(k), k.curve));
        this.keyRects.push({ x0: c[0] - 6, x1: c[0] + 6, y0: c[1] - 7, y1: c[1] + 7, key: k, keys: trackKeys(anim, track), index, time: k.time });
      });
    });
    ctx.strokeStyle = 'rgb(60,60,60)';
    ctx.beginPath();
    ctx.moveTo(trackLeft + 0.5, 0);
    ctx.lineTo(trackLeft + 0.5, height);
    ctx.stroke();

    // Selection box and retiming handles.
    if (this.press?.box) {
      const { from, to } = this.press.box;
      ctx.fillStyle = 'rgba(255,170,40,0.1)';
      ctx.strokeStyle = 'rgb(255,170,40)';
      ctx.lineWidth = 1;
      ctx.fillRect(Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
      ctx.strokeRect(Math.min(from[0], to[0]) + 0.5, Math.min(from[1], to[1]) + 0.5, Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
    }
    this.handles = null;
    const span = this.selectionSpan();
    if (span && span.max - span.min > 1e-6) {
      const x0 = timeToX(span.min);
      const x1 = timeToX(span.max);
      ctx.fillStyle = 'rgba(255,190,60,0.18)';
      ctx.fillRect(x0, RULER - 8, x1 - x0, 8);
      ctx.fillStyle = 'rgb(255,190,60)';
      for (const x of [x0, x1]) ctx.fillRect(x - 3, RULER - 12, 6, 12);
      this.handles = { x0, x1, min: span.min, max: span.max };
    }

    // Time cursor.
    const cx = timeToX(Math.min(app.time, duration));
    ctx.strokeStyle = 'rgb(255,90,70)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, height);
    ctx.stroke();
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  hit(p) {
    return this.keyRects.find((k) => p[0] >= k.x0 && p[0] <= k.x1 && p[1] >= k.y0 && p[1] <= k.y1) ?? null;
  }

  xToTime(x) {
    const { trackLeft, trackW, duration } = this.layout;
    return Math.min(duration, Math.max(0, ((x - trackLeft) / trackW) * duration));
  }

  /** Time range covered by the selected keys, or null. */
  selectionSpan() {
    if (this.app.selectedKeys.size < 2) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const k of this.app.selectedKeys) {
      min = Math.min(min, k.time);
      max = Math.max(max, k.time);
    }
    return { min, max };
  }

  onPointerDown(e) {
    if (!this.layout) return;
    const app = this.app;
    const p = this.pos(e);
    const add = e.ctrlKey || e.metaKey;
    if (e.button === 2) {
      const hit = this.hit(p);
      if (hit && !app.selectedKeys.has(hit.key)) {
        app.selectedKeys = new Set([hit.key]);
        app.changed();
      }
      if (app.selectedKeys.size) curveMenu(app, e.clientX, e.clientY);
      return;
    }
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    const hit = this.hit(p);
    const handle = this.handles && p[1] <= RULER && [this.handles.x0, this.handles.x1].findIndex((x) => Math.abs(p[0] - x) <= 5);
    this.press = { pos: p, started: false, add, hit, handle: handle >= 0 ? handle : null, inRuler: p[1] <= RULER };
  }

  onPointerMove(e) {
    if (!this.press || !(e.buttons & 1)) return;
    const app = this.app;
    const p = this.pos(e);
    const press = this.press;
    if (!press.started) {
      if (Math.hypot(p[0] - press.pos[0], p[1] - press.pos[1]) <= 3) return;
      press.started = true;
      app.playing = false;
      app.mode = Mode.Animate;
      if (press.handle !== null && press.handle !== undefined) {
        press.retime = this.beginEdit();
        press.span = { ...this.handles };
      } else if (press.hit) {
        if (!app.selectedKeys.has(press.hit.key)) app.selectedKeys = press.add ? new Set([...app.selectedKeys, press.hit.key]) : new Set([press.hit.key]);
        press.move = this.beginEdit();
        press.grabTime = press.hit.time;
      } else if (!press.inRuler) {
        press.box = { from: press.pos, to: p };
      }
    }
    const t = snap(this.xToTime(p[0]));
    if (press.move) {
      const dt = t - press.grabTime;
      for (const m of press.move) m.key.time = Math.max(0, snap(m.time + dt));
      app.time = Math.max(0, snap(press.grabTime + dt));
    } else if (press.retime) {
      // Scale times relative to the opposite edge of the selection.
      const { min, max } = press.span;
      const fixed = press.handle === 0 ? max : min;
      const moving = press.handle === 0 ? min : max;
      const factor = Math.abs(moving - fixed) > 1e-6 ? (t - fixed) / (moving - fixed) : 1;
      for (const m of press.retime) m.key.time = Math.max(0, snap(fixed + (m.time - fixed) * factor));
      app.time = t;
    } else if (press.box) {
      press.box.to = p;
    } else {
      app.time = t; // scrubbing the ruler or empty space
    }
    app.changed();
  }

  /** Remembers the selected keys' times before a move or retime. */
  beginEdit() {
    return [...this.app.selectedKeys].map((key) => ({ key, time: key.time }));
  }

  onPointerUp(e) {
    if (e.button !== 0 || !this.press) return;
    const app = this.app;
    const press = this.press;
    this.press = null;
    if (!press.started) {
      if (press.hit) {
        const k = press.hit.key;
        if (press.add) {
          const next = new Set(app.selectedKeys);
          if (next.has(k)) next.delete(k);
          else next.add(k);
          app.selectedKeys = next;
        } else {
          app.selectedKeys = new Set([k]);
          app.time = press.hit.time;
        }
      } else {
        if (!press.add) app.selectedKeys = new Set();
        app.time = snap(this.xToTime(press.pos[0]));
      }
      app.playing = false;
      app.mode = Mode.Animate;
    } else if (press.move || press.retime) {
      resortAnimation(app.currentAnimation());
      const n = app.selectedKeys.size;
      app.setStatus(`${press.move ? 'Moved' : 'Retimed'} ${n} key${n === 1 ? '' : 's'}`);
    } else if (press.box) {
      const { from, to } = press.box;
      const [x0, x1] = [Math.min(from[0], to[0]), Math.max(from[0], to[0])];
      const [y0, y1] = [Math.min(from[1], to[1]), Math.max(from[1], to[1])];
      const inside = this.keyRects.filter((r) => (r.x0 + r.x1) / 2 >= x0 && (r.x0 + r.x1) / 2 <= x1 && (r.y0 + r.y1) / 2 >= y0 && (r.y0 + r.y1) / 2 <= y1);
      const next = new Set(press.add ? app.selectedKeys : []);
      for (const r of inside) next.add(r.key);
      app.selectedKeys = next;
      app.setStatus(`${next.size} key${next.size === 1 ? '' : 's'} selected`);
    }
    app.changed();
  }
}

/** Removes constraint channels whose keys were all deleted. */
function pruneConstraintKeys(anim) {
  for (const type of ['transform', 'path', 'physics', 'slider']) {
    const byName = anim.extra?.[type];
    if (!byName) continue;
    for (const [name, v] of Object.entries(byName)) {
      if (Array.isArray(v)) {
        if (!v.length) delete byName[name];
        continue;
      }
      for (const [ch, keys] of Object.entries(v)) if (Array.isArray(keys) && !keys.length) delete v[ch];
      if (!Object.keys(v).length) delete byName[name];
    }
    if (!Object.keys(byName).length) delete anim.extra[type];
  }
}

/** Keeps every key list sorted by time after keys moved. */
export function resortAnimation(anim) {
  if (!anim) return;
  const sort = (keys) => keys.sort((a, b) => a.time - b.time);
  for (const tl of [...anim.bones, ...anim.slots]) for (const v of Object.values(tl)) if (Array.isArray(v)) sort(v);
  for (const tl of [...anim.deform, ...anim.ik]) sort(tl.keys);
  sort(anim.drawOrder);
  sort(anim.events);
  for (const tl of anim.extra ? keyedChannels(anim, listConstraintsOf(anim)) : []) sort(tl.keys);
  for (const keys of sequenceLists(anim)) sort(keys);
  const last = anim.lastKeyTime();
  if (last > anim.duration) anim.duration = last;
}

/** Every sequence key list of an animation. */
function sequenceLists(anim) {
  const out = [];
  for (const slots of Object.values(anim.extra?.attachments ?? {})) {
    for (const atts of Object.values(slots)) for (const t of Object.values(atts)) if (Array.isArray(t.sequence)) out.push(t.sequence);
  }
  return out;
}

/** Constraint names keyed in an animation (for sorting without the document). */
function listConstraintsOf(anim) {
  const out = [];
  for (const type of ['transform', 'path', 'physics', 'slider']) for (const name of Object.keys(anim.extra?.[type] ?? {})) out.push({ type, name });
  return out;
}

/** Curve presets and delete for the selected keys. */
export function curveMenu(app, x, y) {
  const setCurve = (curve) => () => {
    const anim = app.currentAnimation();
    if (!anim) return;
    // Constraint keys store absolute curves per value.
    const raw = new Set();
    for (const t of keyedChannels(anim, listConstraints(app.doc))) {
      t.keys.forEach((k, i) => {
        if (!app.selectedKeys.has(k)) return;
        raw.add(k);
        setConstraintCurve(t.keys, i, t.fields, t.defaults, curve);
      });
    }
    // Attachment, draw order and event keys have no curve.
    const skip = new Set([...raw, ...anim.events, ...anim.drawOrder, ...anim.slots.flatMap((s) => s.attachment ?? []), ...sequenceLists(anim).flat()]);
    for (const k of app.selectedKeys) if (!skip.has(k)) k.curve = cloneCurve(curve);
    app.changed();
  };
  popupMenu(x, y, [
    { label: 'Linear', action: setCurve(LINEAR) },
    { label: 'Ease in-out', action: setCurve(EASE_IN_OUT) },
    { label: 'Ease in', action: setCurve(EASE_IN) },
    { label: 'Ease out', action: setCurve(EASE_OUT) },
    { label: 'Stepped', action: setCurve(STEPPED) },
    'separator',
    { label: app.selectedKeys.size > 1 ? `Delete ${app.selectedKeys.size} keys` : 'Delete key', action: () => deleteSelectedKeys(app) },
  ]);
}

function diamond(ctx, c, r, fill) {
  ctx.beginPath();
  ctx.moveTo(c[0], c[1] - r);
  ctx.lineTo(c[0] + r, c[1]);
  ctx.lineTo(c[0], c[1] + r);
  ctx.lineTo(c[0] - r, c[1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 1;
  ctx.stroke();
}

