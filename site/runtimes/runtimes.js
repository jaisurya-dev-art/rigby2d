// SPDX-License-Identifier: MIT OR Apache-2.0
// The website's Runtimes page: a crowd of NILAs played by the JavaScript runtime and WebGL renderer
// (src/core, src/webgl), each with her own animation and time, and what posing and drawing them
// costs on this device. NILA is a Rigby2D trademark (TRADEMARKS.md).

import { parseAtlas } from '../../src/core/atlas.js';
import { readSkeletonBinary } from '../../src/core/binary.js';
import { readSkeletonJson } from '../../src/core/interop.js';
import { Affine } from '../../src/core/math.js';
import { Pose } from '../../src/core/pose.js';
import { AnimationState } from '../../src/core/state.js';
import { WebGLRenderer } from '../../src/webgl/renderer.js';
import { startAnalytics } from '../../src/editor/analytics.js';
import { installMobileNav } from '../nav.js';
import skelUrl from '../../branding/nila/export/nila.skel?url&no-inline';
import atlasText from '../../branding/nila/export/nila.atlas?raw';
import pageUrl from '../../branding/nila/export/nila.png?url';

startAnalytics();
installMobileNav();

const canvas = document.getElementById('crowd');
const buttons = [...document.querySelectorAll('[data-count]')];
const stat = (name) => document.querySelector(`[data-stat="${name}"]`);
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Her height in skeleton units, with room for raised arms and her braid swinging. */
const HEIGHT = 2900;
/** Loops the crowd plays, so everyone keeps moving. */
const LOOPS = ['idle', 'wave', 'physics', 'smooth', 'happy', 'hello', 'curious', 'thinking'];

const fmt = (ms) => (ms < 1 ? `${(ms * 1000).toFixed(0)} µs` : `${ms.toFixed(2)} ms`);

async function start() {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true }) ?? canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true });
  if (!gl) throw new Error('WebGL unavailable');
  const bytes = new Uint8Array(await (await fetch(skelUrl)).arrayBuffer());
  const sk = readSkeletonJson(readSkeletonBinary(bytes), 'nila').skeleton;
  const atlas = parseAtlas(atlasText);
  const page = await createImageBitmap(await (await fetch(pageUrl)).blob(), { premultiplyAlpha: 'none' });
  const renderer = new WebGLRenderer(gl);
  const textures = renderer.atlasTextures(atlas, new Map([[atlas.pages[0].name, page]]));
  const loops = LOOPS.filter((name) => sk.animations.some((a) => a.name === name));

  /** Characters: a pose and playback each, placed on a grid by layout(). */
  const crowd = [];
  const add = (i) => {
    const pose = new Pose(sk);
    const state = new AnimationState();
    state.setAnimation(sk, 0, loops[i % loops.length], true, 0);
    // A different moment of the loop for each, so the crowd doesn't move in step.
    state.update(sk, (i * 0.37) % 3);
    crowd.push({ pose, state });
  };

  let count = 0;
  let columns = 1;
  let rows = 1;
  const setCount = (n) => {
    count = n;
    while (crowd.length < n) add(crowd.length);
    columns = Math.ceil(Math.sqrt(n * 2.2));
    rows = Math.ceil(n / columns);
    stat('count').textContent = String(n);
    for (const b of buttons) b.setAttribute('aria-pressed', String(Number(b.dataset.count) === n));
  };

  let pose = 0;
  let draw = 0;
  let shownAt = 0;
  const frame = (dt) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
    // Rows of characters, each cell a little narrower than she is tall; back rows overlap the front.
    const cellW = HEIGHT * 0.44;
    const cellH = HEIGHT * 0.55;
    const worldW = (columns + (rows > 1 ? 0.5 : 0)) * cellW;
    const worldH = (rows - 1) * cellH + HEIGHT;
    const zoom = Math.min(w / worldW, h / worldH);
    const t0 = performance.now();
    for (let i = 0; i < count; i++) {
      const c = crowd[i];
      const row = Math.floor(i / columns);
      const col = i % columns;
      const stagger = row % 2 ? cellW / 2 : 0;
      c.pose.placement = new Affine(1, 0, 0, 1, (col + 0.5) * cellW + stagger - worldW / 2, (rows - 1 - row) * cellH);
      c.state.update(sk, dt);
      c.state.apply(sk, c.pose);
    }
    const t1 = performance.now();
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    renderer.begin(w, h, { x: 0, y: worldH / 2, zoom });
    // Back rows first, so the front row stands in front.
    for (let i = 0; i < count; i++) renderer.drawSkeleton(sk, crowd[i].pose, textures);
    renderer.end();
    const t2 = performance.now();
    pose = pose ? pose * 0.9 + (t1 - t0) * 0.1 : t1 - t0;
    draw = draw ? draw * 0.9 + (t2 - t1) * 0.1 : t2 - t1;
    if (t0 - shownAt > 400) {
      stat('pose').textContent = fmt(pose);
      stat('each').textContent = fmt(pose / count);
      stat('draw').textContent = fmt(draw);
      shownAt = t0;
    }
  };

  for (const b of buttons) b.addEventListener('click', () => setCount(Number(b.dataset.count)));
  setCount(10);
  if (reducedMotion) {
    frame(0);
    return;
  }
  let visible = true;
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) loop.last = performance.now();
  }).observe(canvas);
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - (loop.last ?? now)) / 1000));
    loop.last = now;
    if (visible && !document.hidden) frame(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

start().catch((e) => {
  console.warn('The crowd could not play here:', e);
  canvas.hidden = true;
  document.querySelector('.rt-stage-fallback').hidden = false;
});
