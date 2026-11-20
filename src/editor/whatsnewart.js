// SPDX-License-Identifier: MIT OR Apache-2.0
// Live art for the What's new tour: each feature screen draws its own small animation on a canvas
// (no video, no screenshots), so it is crisp at any size and costs almost nothing in the app.
// Every drawing stops itself once its canvas leaves the page.

import { t } from './i18n.js';
import { h } from './widgets.js';

// The tour's palette (it is always dark, whatever the editor theme).
const C = {
  bg: 'hsl(214 32% 7%)',
  panel: 'hsl(214 22% 13%)',
  panel2: 'hsl(214 20% 17%)',
  line: 'hsl(214 16% 26%)',
  text: 'hsl(240 5% 92%)',
  dim: 'hsl(220 6% 58%)',
  ice: 'hsl(205 60% 82%)',
  steel: 'hsl(205 38% 62%)',
  accent: 'hsl(205 80% 60%)',
  orange: 'hsl(24 92% 56%)',
  amber: 'hsl(38 95% 62%)',
};
const FONT = 'Inter, "Segoe UI Variable Display", system-ui, "Segoe UI", sans-serif';
const W = 720;
const H = 405;

const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const ease = (x) => (x = clamp(x), x * x * (3 - 2 * x));
const mix = (a, b, k) => a + (b - a) * k;

/** A canvas drawn every frame by `draw(ctx, seconds, state)` in a 720×405 space, until it leaves the page. */
function stage(draw, { interactive = false } = {}) {
  const canvas = h('canvas', { class: 'wn-live', width: W, height: H, 'aria-hidden': 'true' });
  const ctx = canvas.getContext('2d');
  const state = { mouse: null, moved: -1e9 };
  if (interactive) {
    const target = () => canvas.closest('.wn-backdrop') ?? canvas;
    queueMicrotask(() =>
      target().addEventListener('pointermove', (e) => {
        const r = canvas.getBoundingClientRect();
        state.mouse = [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H];
        state.moved = performance.now();
      }),
    );
  }
  const t0 = performance.now();
  const frame = (now) => {
    if (!canvas.isConnected && now - t0 > 500) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const scale = (canvas.clientWidth / W || 1) * dpr;
    if (canvas.width !== Math.round(W * scale)) {
      canvas.width = Math.round(W * scale);
      canvas.height = Math.round(H * scale);
    }
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    draw(ctx, (now - t0) / 1000, state, now);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  return canvas;
}

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}
function label(ctx, text, x, y, { size = 13, color = C.dim, weight = 500, align = 'left' } = {}) {
  ctx.font = `${weight} ${size}px ${FONT}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}
/** A bone as the editor draws it: a slim kite from (x0, y0) to (x1, y1) with a ring at its origin. */
function bone(ctx, x0, y0, x1, y1, color = C.ice, width = 9) {
  const len = Math.hypot(x1 - x0, y1 - y0) || 1;
  const nx = -(y1 - y0) / len;
  const ny = (x1 - x0) / len;
  const kx = x0 + (x1 - x0) * 0.18;
  const ky = y0 + (y1 - y0) * 0.18;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(kx + nx * width, ky + ny * width);
  ctx.lineTo(x1, y1);
  ctx.lineTo(kx - nx * width, ky - ny * width);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.85;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(x0, y0, 5, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}
function cursor(ctx, x, y, down = false) {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(0, 17);
  ctx.lineTo(4.5, 13);
  ctx.lineTo(8, 20);
  ctx.lineTo(10.5, 19);
  ctx.lineTo(7, 12);
  ctx.lineTo(12.5, 12);
  ctx.closePath();
  ctx.fillStyle = C.text;
  ctx.strokeStyle = C.bg;
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
  if (down) {
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, Math.PI * 2);
    ctx.strokeStyle = C.accent;
    ctx.stroke();
  }
  ctx.restore();
}

// ---- Dock it. Tab it. -----------------------------------------------------------------------------

/** A small editor: panels, a viewport and tabs, in the colours of `p`. */
function miniEditor(ctx, p, { dragging = null, tabs = ['Tree'], active = 0, zone = 0 } = {}) {
  const x = 60;
  const y = 30;
  const w = 600;
  const hgt = 345;
  rr(ctx, x, y, w, hgt, 12);
  ctx.fillStyle = p.bg;
  ctx.fill();
  ctx.strokeStyle = p.line;
  ctx.lineWidth = 1;
  ctx.stroke();
  // Top bar.
  rr(ctx, x + 12, y + 12, 22, 14, 3);
  ctx.fillStyle = p.accent;
  ctx.fill();
  for (let i = 0; i < 4; i++) {
    rr(ctx, x + 46 + i * 44, y + 15, 30, 8, 4);
    ctx.fillStyle = p.line;
    ctx.fill();
  }
  // Left panel with tabs.
  const lx = x + 12;
  const ly = y + 40;
  rr(ctx, lx, ly, 150, hgt - 52, 8);
  ctx.fillStyle = p.panel;
  ctx.fill();
  tabs.forEach((name, i) => {
    const tx = lx + 8 + i * 72;
    rr(ctx, tx, ly + 8, 66, 22, 6);
    ctx.fillStyle = i === active ? p.panel2 : p.panel;
    ctx.fill();
    label(ctx, t(name), tx + 33, ly + 19, { size: 11, align: 'center', color: i === active ? p.text : p.dim, weight: 600 });
  });
  for (let i = 0; i < 8; i++) {
    rr(ctx, lx + 14 + (i % 3) * 10, ly + 46 + i * 26, 90 - (i % 3) * 14, 8, 4);
    ctx.fillStyle = p.line;
    ctx.fill();
  }
  if (zone > 0) {
    rr(ctx, lx, ly, 150, hgt - 52, 8);
    ctx.fillStyle = p.accent;
    ctx.globalAlpha = 0.18 * zone;
    ctx.fill();
    ctx.globalAlpha = zone;
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }
  // Viewport.
  const vx = lx + 160;
  rr(ctx, vx, ly, 270, hgt - 52, 8);
  ctx.fillStyle = p.canvas;
  ctx.fill();
  ctx.strokeStyle = p.line;
  ctx.globalAlpha = 0.5;
  for (let gx = vx + 30; gx < vx + 270; gx += 30) {
    ctx.beginPath();
    ctx.moveTo(gx, ly + 4);
    ctx.lineTo(gx, ly + hgt - 56);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  bone(ctx, vx + 100, ly + 210, vx + 150, ly + 120, p.accent, 8);
  bone(ctx, vx + 150, ly + 120, vx + 200, ly + 70, p.accent, 7);
  // Right panel.
  const rx = vx + 280;
  if (!dragging) {
    rr(ctx, rx, ly, 146, hgt - 52, 8);
    ctx.fillStyle = p.panel;
    ctx.fill();
  }
  const panel = (px, py, alpha) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.shadowColor = 'hsl(0 0% 0% / 0.5)';
    ctx.shadowBlur = dragging ? 24 : 0;
    rr(ctx, px, py, 146, hgt - 52, 8);
    ctx.fillStyle = p.panel;
    ctx.fill();
    ctx.shadowBlur = 0;
    rr(ctx, px + 8, py + 8, 80, 22, 6);
    ctx.fillStyle = p.panel2;
    ctx.fill();
    label(ctx, t('Inspector'), px + 48, py + 19, { size: 11, align: 'center', color: p.text, weight: 600 });
    for (let i = 0; i < 7; i++) {
      rr(ctx, px + 12, py + 48 + i * 28, 50, 8, 4);
      ctx.fillStyle = p.line;
      ctx.fill();
      rr(ctx, px + 70, py + 44 + i * 28, 64, 16, 4);
      ctx.fillStyle = p.panel2;
      ctx.fill();
    }
    ctx.restore();
  };
  if (dragging) {
    rr(ctx, rx, ly, 146, hgt - 52, 8);
    ctx.setLineDash([5, 5]);
    ctx.strokeStyle = p.line;
    ctx.stroke();
    ctx.setLineDash([]);
    panel(dragging[0], dragging[1], dragging[2]);
  } else if (tabs.length < 2) panel(rx, ly, 1);
  return { lx, ly, rx };
}

const DARK = { bg: C.bg, panel: C.panel, panel2: C.panel2, line: C.line, text: C.text, dim: C.dim, accent: C.accent, canvas: 'hsl(214 30% 10%)' };

export function dockArt() {
  return stage((ctx, s) => {
    const k = s % 7;
    const lift = ease(k / 0.6);
    const move = ease((k - 0.8) / 1.4);
    const drop = ease((k - 2.4) / 0.4);
    const back = ease((k - 6.2) / 0.6);
    const ly = 70;
    const rx = 452;
    const docked = k > 2.8 && k < 6.2;
    if (docked) {
      const active = k > 4.2 ? 1 : 0;
      miniEditor(ctx, DARK, { tabs: ['Tree', 'Inspector'], active });
      const tx = active ? 82 + 72 + 33 : 82 + 33;
      cursor(ctx, k < 3.8 ? 150 : mix(150, tx + 6, ease((k - 3.8) / 0.4)), k < 3.8 ? 90 : 84, k > 4.15 && k < 4.35);
      return;
    }
    const px = mix(rx, 72, move);
    const py = ly - 10 * lift + 10 * drop;
    const fade = k > 6.2 ? 1 - back * 0 : 1;
    miniEditor(ctx, DARK, { dragging: k > 6.2 ? [mix(72, rx, back), ly, fade] : [px, py, 1], zone: k > 0.8 && k < 2.8 ? ease((k - 1.2) / 0.5) : 0 });
    cursor(ctx, (k > 6.2 ? mix(72, rx, back) : px) + 48, (k > 6.2 ? ly : py) + 19, k < 2.8);
  });
}

// ---- Themes ---------------------------------------------------------------------------------------

const THEMES = [
  ['Rigby Dark', DARK],
  ['Mammoth', { bg: 'hsl(208 40% 8%)', panel: 'hsl(206 34% 14%)', panel2: 'hsl(205 32% 20%)', line: 'hsl(205 26% 28%)', text: 'hsl(40 40% 90%)', dim: 'hsl(205 18% 62%)', accent: C.amber, canvas: 'hsl(206 38% 11%)' }],
  ['Rigby Light', { bg: 'hsl(220 14% 94%)', panel: 'hsl(0 0% 100%)', panel2: 'hsl(220 14% 90%)', line: 'hsl(220 10% 80%)', text: 'hsl(220 15% 15%)', dim: 'hsl(220 8% 45%)', accent: 'hsl(212 80% 50%)', canvas: 'hsl(220 16% 97%)' }],
  ['Your own', { bg: 'hsl(280 24% 9%)', panel: 'hsl(282 20% 15%)', panel2: 'hsl(284 20% 21%)', line: 'hsl(284 14% 30%)', text: 'hsl(300 20% 92%)', dim: 'hsl(284 10% 62%)', accent: 'hsl(330 85% 62%)', canvas: 'hsl(280 26% 11%)' }],
];
const parse = (c) => c.match(/[\d.]+/g).map(Number);
function blend(a, b, k) {
  const out = {};
  for (const key of Object.keys(a)) {
    const [h1, s1, l1] = parse(a[key]);
    let [h2, s2, l2] = parse(b[key]);
    if (Math.abs(h2 - h1) > 180) h2 += h2 < h1 ? 360 : -360;
    out[key] = `hsl(${mix(h1, h2, k)} ${mix(s1, s2, k)}% ${mix(l1, l2, k)}%)`;
  }
  return out;
}

export function themesArt() {
  return stage((ctx, s) => {
    const per = 2.6;
    const i = Math.floor(s / per) % THEMES.length;
    const k = ease(((s % per) - 2) / 0.6);
    const [name, p] = THEMES[i];
    const [nextName, q] = THEMES[(i + 1) % THEMES.length];
    miniEditor(ctx, blend(p, q, k), { tabs: ['Tree'] });
    rr(ctx, 260, 352, 200, 34, 17);
    ctx.fillStyle = 'hsl(214 30% 4% / 0.7)';
    ctx.fill();
    label(ctx, t(k < 0.5 ? name : nextName), 360, 369, { size: 15, align: 'center', color: C.text, weight: 600 });
  });
}

// ---- Weights --------------------------------------------------------------------------------------

export function weightsArt() {
  const COLS = 22;
  const ROWS = 4;
  return stage((ctx, s) => {
    const jx = 360;
    const y0 = 210;
    const len = 170;
    const bend = Math.sin(s * 2.2) * 0.75;
    // The brush sweeps over the joint, softening the blend as it paints.
    const paint = 0.5 + 0.5 * Math.sin(s * 0.7);
    const soft = mix(12, 70, paint);
    const pt = (x, y) => {
      const w = clamp(0.5 + (x - jx) / (2 * soft));
      const c = Math.cos(bend * w);
      const sn = Math.sin(bend * w);
      const dx = x - jx;
      const dy = y - y0;
      return [jx + dx * c - dy * sn, y0 + dx * sn + dy * c, w];
    };
    const grid = [];
    for (let r = 0; r <= ROWS; r++) {
      const row = [];
      for (let c = 0; c <= COLS; c++) {
        const x = jx - len + (2 * len * c) / COLS;
        const taper = 1 - Math.abs(c / COLS - 0.5) * 0.35;
        row.push(pt(x, y0 + (r / ROWS - 0.5) * 72 * taper));
      }
      grid.push(row);
    }
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        const a = grid[r][c];
        const b = grid[r][c + 1];
        const d = grid[r + 1][c];
        const e = grid[r + 1][c + 1];
        const w = (a[2] + b[2] + d[2] + e[2]) / 4;
        ctx.fillStyle = `hsl(${mix(220, 0, w)} 85% ${mix(52, 55, w)}% / 0.85)`;
        ctx.beginPath();
        ctx.moveTo(a[0], a[1]);
        ctx.lineTo(b[0], b[1]);
        ctx.lineTo(e[0], e[1]);
        ctx.lineTo(d[0], d[1]);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = 'hsl(0 0% 100% / 0.28)';
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
    }
    bone(ctx, jx - len, y0, jx, y0, C.text, 10);
    bone(ctx, jx, y0, jx + len * Math.cos(bend), y0 + len * Math.sin(bend), C.text, 10);
    // The brush, circling the joint.
    const bx = jx + Math.cos(s * 1.3) * 26;
    const by = y0 - 46 + Math.sin(s * 2.6) * 10;
    ctx.beginPath();
    ctx.arc(bx, by, soft * 0.7 + 8, 0, Math.PI * 2);
    ctx.strokeStyle = C.text;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, t('Wiggle'), 360, 360, { size: 13, align: 'center', color: C.dim });
  });
}

// ---- Bone only ------------------------------------------------------------------------------------

export function boneOnlyArt() {
  return stage((ctx, s) => {
    const k = s % 5;
    const go = ease((k - 0.6) / 1.1) - ease((k - 3.2) / 1.1);
    const sx = 230;
    const sy = 150;
    const ex0 = 380;
    const ey0 = 230;
    const ex = mix(ex0, 360, go);
    const ey = mix(ey0, 190, go);
    const hx = 520;
    const hy = 210;
    // The art: an upper arm and a forearm that never move.
    const limb = (x0, y0, x1, y1, r, color) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = r * 2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    };
    limb(ex0, ey0, hx, hy, 30, 'hsl(24 70% 46%)');
    limb(sx, sy, ex0, ey0, 34, C.orange);
    ctx.beginPath();
    ctx.arc(hx + 18, hy - 2, 30, 0, Math.PI * 2);
    ctx.fillStyle = 'hsl(30 80% 70%)';
    ctx.fill();
    ctx.lineCap = 'butt';
    // The bones: the elbow moves, the hand bone stays where it is drawn.
    bone(ctx, sx, sy, ex, ey, C.text, 9);
    bone(ctx, ex, ey, hx, hy, C.text, 9);
    bone(ctx, hx, hy, hx + 46, hy - 4, C.text, 6);
    if (go > 0.01 && go < 0.99) {
      ctx.beginPath();
      ctx.arc(ex0, ey0, 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'hsl(0 0% 100% / 0.3)';
      ctx.setLineDash([3, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    cursor(ctx, ex + 3, ey + 3, k > 0.5 && k < 1.8 || (k > 3.1 && k < 4.4));
    // The toolbar toggle.
    rr(ctx, 290, 340, 140, 34, 17);
    ctx.fillStyle = C.accent;
    ctx.fill();
    label(ctx, t('Bone only'), 360, 357, { size: 14, align: 'center', color: C.bg, weight: 600 });
  });
}

// ---- 2.5D turn ------------------------------------------------------------------------------------

export function turnArt() {
  let yaw = 0;
  let pitch = 0;
  return stage(
    (ctx, s, st, now) => {
      const idle = now - st.moved > 2500 || !st.mouse;
      const ty = idle ? Math.sin(s * 0.9) * 0.55 : clamp((st.mouse[0] - 360) / 260, -1, 1) * 0.65;
      const tp = idle ? Math.sin(s * 0.6 + 1) * 0.25 : clamp((st.mouse[1] - 200) / 220, -1, 1) * 0.35;
      yaw = mix(yaw, ty, 0.12);
      pitch = mix(pitch, tp, 0.12);
      const cx = 360;
      const cy = 200;
      const R = 112;
      // A part at (u, v) on a rounded head, depth d out of the surface: where it lands on screen and
      // how much it faces us.
      const at = (u, v, d = 0) => {
        const lon = u + yaw;
        const lat = v - pitch;
        const r = R + d;
        return { x: cx + Math.sin(lon) * Math.cos(lat) * r, y: cy + Math.sin(lat) * r * 0.95, face: Math.cos(lon) * Math.cos(lat) };
      };
      const blob = (p, rx, ry, color, squash = true) => {
        if (p.face < -0.05) return;
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, rx * (squash ? clamp(p.face, 0.15) : 1), ry, 0, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      };
      // Back hair, a little behind the head: it slides the other way.
      ctx.beginPath();
      ctx.ellipse(cx - Math.sin(yaw) * 26, cy - 4 - pitch * 14, R * 1.1, R * 1.12, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'hsl(212 30% 24%)';
      ctx.fill();
      // Ears: the far one hides, the near one shows.
      for (const side of [-1, 1]) {
        const e = at(side * 1.45, 0.05, -4);
        if (e.face > -0.35) blob({ ...e, face: 1 }, 18, 26, 'hsl(28 60% 62%)', false);
      }
      // Head.
      ctx.beginPath();
      ctx.ellipse(cx + Math.sin(yaw) * 14, cy + pitch * 8, R, R * 1.05, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'hsl(30 70% 72%)';
      ctx.fill();
      // Cheeks, eyes, brows, nose, mouth.
      for (const side of [-1, 1]) {
        blob(at(side * 0.55, 0.25, 6), 16, 9, 'hsl(4 75% 72% / 0.6)');
        const eye = at(side * 0.38, -0.05, 10);
        blob(eye, 15, 19, 'hsl(0 0% 98%)');
        blob(at(side * 0.38 + yaw * 0.08, -0.03, 14), 9, 12, 'hsl(212 50% 25%)');
        blob(at(side * 0.38, -0.3, 12), 18, 4, 'hsl(212 30% 26%)');
      }
      blob(at(0, 0.18, 26), 8, 10, 'hsl(24 60% 60%)');
      blob(at(0, 0.42, 12), 18, 7, 'hsl(350 55% 45%)');
      // Front hair: a cap over the top of the head, nearer than the face, so it leads the turn.
      ctx.save();
      ctx.beginPath();
      ctx.ellipse(cx + Math.sin(yaw) * 14, cy + pitch * 8, R + 3, R * 1.05 + 3, 0, 0, Math.PI * 2);
      ctx.clip();
      const cap = at(0, -1.0, 30);
      ctx.beginPath();
      ctx.ellipse(cap.x, cy - R * 1.02 + pitch * 30, R * 1.12, R * 0.64, yaw * 0.25, 0, Math.PI * 2);
      ctx.fillStyle = 'hsl(212 30% 30%)';
      ctx.fill();
      ctx.restore();
      // The control handle.
      const hx = cx + yaw * 220;
      const hy = 360 + pitch * 30;
      ctx.beginPath();
      ctx.arc(hx, hy, 10, 0, Math.PI * 2);
      ctx.fillStyle = C.accent;
      ctx.fill();
      ctx.strokeStyle = C.text;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (idle) label(ctx, t('Move your mouse'), 360, 390, { size: 12, align: 'center', color: C.dim });
    },
    { interactive: true },
  );
}

// ---- Warp deformers -------------------------------------------------------------------------------

export function warpArt() {
  // A fish: an outline and a few stripes, in the lattice's 0..1 space.
  const body = [];
  for (let i = 0; i <= 40; i++) {
    const a = (i / 40) * Math.PI * 2;
    body.push([0.42 + 0.32 * Math.cos(a), 0.5 + 0.26 * Math.sin(a) * (0.55 + 0.45 * Math.cos(a))]);
  }
  const tail = [[0.12, 0.5], [0.02, 0.28], [0.06, 0.5], [0.02, 0.72]];
  const N = 4;
  return stage((ctx, s) => {
    const x0 = 180;
    const y0 = 60;
    const size = [360, 280];
    const pts = [];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const v = j / (N - 1);
        const wave = Math.sin(s * 2 - u * 3.2) * 26 * u;
        const bulge = (i === 1 || i === 2) && (j === 1 || j === 2) ? Math.sin(s * 1.3) * 12 * (j === 1 ? -1 : 1) : 0;
        pts.push([x0 + u * size[0], y0 + v * size[1] + wave + bulge]);
      }
    }
    const map = ([u, v]) => {
      const gx = clamp(u * (N - 1), 0, N - 1.0001);
      const gy = clamp(v * (N - 1), 0, N - 1.0001);
      const i = Math.floor(gx);
      const j = Math.floor(gy);
      const fx = gx - i;
      const fy = gy - j;
      const p = (a, b) => pts[b * N + a];
      const top = [mix(p(i, j)[0], p(i + 1, j)[0], fx), mix(p(i, j)[1], p(i + 1, j)[1], fx)];
      const bot = [mix(p(i, j + 1)[0], p(i + 1, j + 1)[0], fx), mix(p(i, j + 1)[1], p(i + 1, j + 1)[1], fx)];
      return [mix(top[0], bot[0], fy), mix(top[1], bot[1], fy)];
    };
    const path = (list, close = true) => {
      ctx.beginPath();
      list.forEach((q, k) => (k ? ctx.lineTo(...map(q)) : ctx.moveTo(...map(q))));
      if (close) ctx.closePath();
    };
    path(tail);
    ctx.fillStyle = 'hsl(24 80% 48%)';
    ctx.fill();
    path(body);
    ctx.fillStyle = C.orange;
    ctx.fill();
    ctx.strokeStyle = 'hsl(0 0% 100%)';
    ctx.lineWidth = 7;
    for (const sx of [0.38, 0.52]) {
      const stripe = [];
      for (let k = 0; k <= 10; k++) stripe.push([sx + Math.sin(k / 3) * 0.01, 0.3 + k * 0.04]);
      path(stripe, false);
      ctx.stroke();
    }
    const eye = map([0.66, 0.44]);
    ctx.beginPath();
    ctx.arc(eye[0], eye[1], 9, 0, Math.PI * 2);
    ctx.fillStyle = C.bg;
    ctx.fill();
    // The lattice.
    ctx.strokeStyle = C.amber;
    ctx.lineWidth = 1.5;
    for (let j = 0; j < N; j++) {
      ctx.beginPath();
      for (let i = 0; i < N; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, ...pts[j * N + i]);
      ctx.stroke();
    }
    for (let i = 0; i < N; i++) {
      ctx.beginPath();
      for (let j = 0; j < N; j++) (j ? ctx.lineTo : ctx.moveTo).call(ctx, ...pts[j * N + i]);
      ctx.stroke();
    }
    for (const q of pts) {
      ctx.beginPath();
      ctx.arc(q[0], q[1], 5, 0, Math.PI * 2);
      ctx.fillStyle = C.bg;
      ctx.fill();
      ctx.strokeStyle = C.amber;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
}

// ---- Film effects ---------------------------------------------------------------------------------

export function filmArt() {
  const flakes = Array.from({ length: 90 }, (_, i) => [((i * 97) % 720) + 0.5, (i * 53) % 405, 1 + (i % 3), 0.4 + ((i * 7) % 10) / 14]);
  const steps = ['Shadow', 'Light', 'Glow', 'Snow', 'Focus'];
  return stage((ctx, s) => {
    const per = 1.6;
    const cycle = per * (steps.length + 2.5);
    const k = s % cycle;
    const on = (i) => ease((k - per * (i + 1)) / 0.5);
    const [shadow, light, glow, snow, focus] = steps.map((_, i) => on(i));
    // Sky.
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, 'hsl(215 45% 9%)');
    sky.addColorStop(1, 'hsl(212 35% 20%)');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    // Far mountains: blurred by depth of field.
    ctx.save();
    if (focus > 0) ctx.filter = `blur(${focus * 6}px)`;
    ctx.fillStyle = 'hsl(210 30% 32%)';
    ctx.beginPath();
    ctx.moveTo(0, 270);
    [[90, 170], [180, 240], [300, 140], [420, 230], [540, 160], [640, 230], [720, 190]].forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(720, 405);
    ctx.lineTo(0, 405);
    ctx.fill();
    ctx.restore();
    // Ground.
    ctx.fillStyle = 'hsl(208 28% 70%)';
    ctx.fillRect(0, 300, W, 105);
    // The character: a round ice creature with a lantern.
    const cx = 330;
    const cy = 230 + Math.sin(s * 2) * 2;
    if (shadow > 0) {
      ctx.beginPath();
      ctx.ellipse(cx + 26, 304, 70, 12, 0, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(212 40% 20% / ${0.45 * shadow})`;
      ctx.fill();
    }
    const bodyGrad = ctx.createRadialGradient(cx + 40 * light, cy - 30, 10, cx, cy, 90);
    bodyGrad.addColorStop(0, light ? `hsl(200 70% ${mix(78, 92, light)}%)` : 'hsl(200 50% 78%)');
    bodyGrad.addColorStop(1, `hsl(205 45% ${mix(78, 52, light)}%)`);
    ctx.beginPath();
    ctx.ellipse(cx, cy, 64, 74, 0, 0, Math.PI * 2);
    ctx.fillStyle = bodyGrad;
    ctx.fill();
    if (light > 0) {
      ctx.save();
      ctx.clip();
      ctx.beginPath();
      ctx.ellipse(cx + 60, cy - 10, 30, 80, 0, 0, Math.PI * 2);
      ctx.fillStyle = `hsl(40 90% 75% / ${0.55 * light})`;
      ctx.filter = 'blur(10px)';
      ctx.fill();
      ctx.restore();
    }
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + side * 20, cy - 18, 7, 0, Math.PI * 2);
      ctx.fillStyle = 'hsl(214 40% 14%)';
      ctx.fill();
    }
    // Lantern.
    const lx = cx + 96;
    const ly = cy + 6;
    ctx.strokeStyle = 'hsl(214 30% 20%)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx + 56, cy + 10);
    ctx.lineTo(lx, ly - 22);
    ctx.stroke();
    if (glow > 0) {
      const g = ctx.createRadialGradient(lx, ly, 4, lx, ly, 120);
      g.addColorStop(0, `hsl(40 100% 70% / ${0.65 * glow})`);
      g.addColorStop(1, 'hsl(40 100% 60% / 0)');
      ctx.fillStyle = g;
      ctx.fillRect(lx - 120, ly - 120, 240, 240);
    }
    rr(ctx, lx - 11, ly - 16, 22, 30, 5);
    ctx.fillStyle = `hsl(40 95% ${mix(55, 72, glow)}%)`;
    ctx.fill();
    // Snow, two layers.
    if (snow > 0) {
      for (const [fx, fy, r, sp] of flakes) {
        const x = (fx + Math.sin(s * sp + fy) * 14 + s * 12 * sp) % W;
        const y = (fy + s * 40 * sp) % H;
        ctx.beginPath();
        ctx.arc(x, y, r * (focus > 0 && r > 2 ? 1 + focus : 1), 0, Math.PI * 2);
        ctx.fillStyle = `hsl(0 0% 100% / ${snow * (r > 2 && focus > 0 ? 0.45 : 0.85)})`;
        ctx.fill();
      }
    }
    // The effects, ticking on one by one.
    steps.forEach((name, i) => {
      const a = on(i);
      const y = 70 + i * 34;
      rr(ctx, 560, y - 13, 130, 26, 13);
      ctx.fillStyle = a > 0.5 ? 'hsl(214 30% 6% / 0.75)' : 'hsl(214 30% 6% / 0.35)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(576, y, 5, 0, Math.PI * 2);
      ctx.fillStyle = a > 0.5 ? C.amber : 'hsl(0 0% 100% / 0.25)';
      ctx.fill();
      label(ctx, t(name), 590, y, { size: 13, color: a > 0.5 ? C.text : C.dim, weight: 600 });
    });
  });
}

// ---- Aseprite -------------------------------------------------------------------------------------

// A 16×16 pixel critter in two layers (head, body) and two walk frames: . clear, o outline, b body,
// l light, e eye.
const HEAD = ['....oooooo......', '...obbbbbbo.....', '..obllbbbbbo....', '..obbbbebbbo....', '..obbbbbbbbo....', '...obbbbbbo.....', '....oooooo......'];
const BODY = [
  ['.....obbbbo.....', '....obbbbbbo....', '...obbllbbbbo...', '...obbbbbbbbo...', '....obbbbbbo....', '....ob.oo.bo....', '....oo....oo....'],
  ['.....obbbbo.....', '....obbbbbbo....', '...obbllbbbbo...', '...obbbbbbbbo...', '....obbbbbbo....', '.....ob..bo.....', '.....oo..oo.....'],
];
const PIX = { o: 'hsl(214 40% 12%)', b: C.orange, l: 'hsl(36 95% 68%)', e: 'hsl(0 0% 98%)' };

export function asepriteArt() {
  const px = 16;
  const draw = (ctx, rows, x, y) => rows.forEach((row, j) => [...row].forEach((ch, i) => {
    if (ch === '.') return;
    ctx.fillStyle = PIX[ch];
    ctx.fillRect(x + i * px, y + j * px, px, px);
  }));
  return stage((ctx, s) => {
    const k = s % 8;
    const rigged = ease((k - 3) / 0.6);
    const frame = Math.floor(s * 4) % 2;
    const x = 232;
    const y = 70;
    const neckX = x + 7 * px;
    const neckY = y + 7 * px;
    const tilt = rigged * Math.sin(s * 3) * 0.22;
    draw(ctx, BODY[frame], x, y + 7 * px);
    ctx.save();
    ctx.translate(neckX, neckY);
    ctx.rotate(tilt);
    ctx.translate(-neckX, -neckY);
    draw(ctx, HEAD, x, y + (frame ? px : 0) * (1 - rigged));
    ctx.restore();
    if (rigged > 0) {
      ctx.globalAlpha = rigged;
      bone(ctx, neckX, y + 12 * px, neckX, neckY, C.ice, 7);
      bone(ctx, neckX, neckY, neckX + Math.sin(tilt) * 70, neckY - Math.cos(tilt) * 70, C.ice, 7);
      ctx.globalAlpha = 1;
    }
    // The file's tags, as animations.
    const tags = [['walk', k < 3], ['walk + bones', k >= 3]];
    tags.forEach(([name, on], i) => {
      rr(ctx, 230 + i * 140, 352, 120, 30, 15);
      ctx.fillStyle = on ? C.accent : 'hsl(214 22% 16%)';
      ctx.fill();
      label(ctx, name === 'walk' ? t('Tag: walk') : t('Plus bones'), 290 + i * 140, 367, { size: 13, align: 'center', color: on ? C.bg : C.dim, weight: 600 });
    });
  });
}
