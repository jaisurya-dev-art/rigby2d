// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D website: the hero plays Rigbytron, the mascot, with the same runtime and WebGL renderer
// that games use (src/core, src/webgl), and shows what a frame costs. Rigbytron and the logos are
// Hoverlabs trademarks (TRADEMARKS.md).

import { parseAtlas } from '../src/core/atlas.js';
import { readSkeletonBinary } from '../src/core/binary.js';
import { readSkeletonJson } from '../src/core/interop.js';
import { Pose } from '../src/core/pose.js';
import { AnimationState } from '../src/core/state.js';
import { WebGLRenderer } from '../src/webgl/renderer.js';
import { animationBounds } from '../src/editor/output.js';
import { startAnalytics } from '../src/editor/analytics.js';
import skelUrl from '../branding/rigbytron/export/rigbytron.skel?url&no-inline';
import atlasText from '../branding/rigbytron/export/rigbytron.atlas?raw';
import pageUrl from '../branding/rigbytron/export/rigbytron.png?url';

// Anonymous visit counts; links marked data-goatcounter-click count their clicks (analytics.js).
startAnalytics();

const $ = (s) => document.querySelector(s);
const canvas = $('#hero');
const costEl = $('[data-cost]');
const buttons = [...document.querySelectorAll('[data-anim]')];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Space left around Rigbytron, as a fraction of the stage. */
const MARGIN = 0.04;

/** World bounds [x0, y0, x1, y1] covering every frame of every animation (the slash reaches far left). */
function figureBounds(sk) {
  let b = animationBounds(sk, null, 30);
  sk.animations.forEach((_, i) => {
    const a = animationBounds(sk, i, 30);
    if (!a) return;
    b = b ? [Math.min(b[0], a[0]), Math.min(b[1], a[1]), Math.max(b[2], a[2]), Math.max(b[3], a[3])] : a;
  });
  return b ?? [-500, 0, 500, 1400];
}

function fallback() {
  canvas.hidden = true;
  $('.stage-fallback').hidden = false;
  $('.stage-controls').hidden = true;
  $('.live').hidden = true;
}

async function start() {
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true }) ?? canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true });
  if (!gl) throw new Error('WebGL unavailable');
  const bytes = new Uint8Array(await (await fetch(skelUrl)).arrayBuffer());
  const sk = readSkeletonJson(readSkeletonBinary(bytes), 'rigbytron').skeleton;
  const atlas = parseAtlas(atlasText);
  const page = await createImageBitmap(await (await fetch(pageUrl)).blob(), { premultiplyAlpha: 'none' });
  const renderer = new WebGLRenderer(gl);
  const textures = renderer.atlasTextures(atlas, new Map([[atlas.pages[0].name, page]]));
  const pose = new Pose(sk);
  const state = new AnimationState();
  const [bx0, by0, bx1, by1] = figureBounds(sk);
  let mode = 'both';

  // "both" plays the gesture, hold then release, and starts it again after a short rest.
  state.addListener({
    complete: (entry) => {
      if (mode === 'both' && entry.name === 'release') state.addAnimation(sk, 0, 'hold', false, 0.6);
      if (mode === 'both' && entry.name === 'hold') state.addAnimation(sk, 0, 'release', false, 0);
    },
  });

  const choose = (next) => {
    mode = next;
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.anim === next));
    if (next === 'both') {
      state.setAnimation(sk, 0, 'hold', false, 0.15);
      state.addAnimation(sk, 0, 'release', false, 0.08);
    } else {
      state.setAnimation(sk, 0, next, true, 0.15);
    }
    if (reducedMotion) {
      // A single still frame, part-way into the chosen animation.
      state.update(sk, 0.6);
      render(0);
    }
  };

  let cost = 0;
  let costShownAt = 0;
  const render = (dt) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    const w = Math.round(cw * dpr);
    const h = Math.round(ch * dpr);
    if (!w || !h) return;
    if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // Fit everything any animation draws inside the stage, so the slash is never cut off.
    const zoom = Math.min(((1 - 2 * MARGIN) * cw) / (bx1 - bx0), ((1 - 2 * MARGIN) * ch) / (by1 - by0));
    const camera = { x: (bx0 + bx1) / 2, y: (by0 + by1) / 2, zoom: zoom * dpr };
    const t0 = performance.now();
    state.update(sk, dt);
    state.apply(sk, pose);
    renderer.begin(w, h, camera);
    renderer.drawSkeleton(sk, pose, textures);
    renderer.end();
    // What one frame costs on this device: animation, constraints, transforms and draw calls.
    cost = cost ? cost * 0.95 + (performance.now() - t0) * 0.05 : performance.now() - t0;
    if (costEl && t0 - costShownAt > 500) {
      costEl.textContent = `· ${cost.toFixed(2)} ms per frame`;
      costShownAt = t0;
    }
  };

  for (const b of buttons) b.addEventListener('click', () => choose(b.dataset.anim));
  choose('both');
  if (reducedMotion) return;

  // Animate only while the stage is on screen and the tab is visible.
  let visible = true;
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible) loop.last = performance.now();
  }).observe(canvas);
  const loop = () => {
    const now = performance.now();
    const dt = Math.min(0.05, Math.max(0, (now - (loop.last ?? now)) / 1000));
    loop.last = now;
    if (visible && !document.hidden) render(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

start().catch((e) => {
  console.warn('Rigbytron could not play here:', e);
  fallback();
});

// The latest release, shown in the hero and the downloads section (the page works without it).
fetch('https://api.github.com/repos/jaisurya-dev-art/rigby2d/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
  .then((r) => (r.ok ? r.json() : null))
  .then((rel) => {
    if (!rel?.tag_name) return;
    const version = rel.tag_name.replace(/^v/, '');
    for (const el of document.querySelectorAll('[data-version]')) el.textContent = `version ${version}, early alpha`;
    const link = $('[data-release]');
    if (link) {
      link.textContent = `Rigby2D ${version}`;
      link.href = rel.html_url;
    }
  })
  .catch(() => {});
