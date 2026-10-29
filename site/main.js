// SPDX-License-Identifier: MIT OR Apache-2.0
// Rigby2D website: the hero plays NILA, the Rigby2D mascot, with the same runtime and WebGL renderer
// that games use (src/core, src/webgl), and shows what a frame costs. Each expression button plays a
// clip from her promo with its line (subtitled, and voiced when sound is on). NILA and the logos are
// Rigby2D trademarks (TRADEMARKS.md).

import { parseAtlas } from '../src/core/atlas.js';
import { readSkeletonBinary } from '../src/core/binary.js';
import { readSkeletonJson } from '../src/core/interop.js';
import { Pose } from '../src/core/pose.js';
import { AnimationState } from '../src/core/state.js';
import { WebGLRenderer } from '../src/webgl/renderer.js';
import { animationBounds } from '../src/editor/output.js';
import { startAnalytics } from '../src/editor/analytics.js';
import { installMobileNav } from './nav.js';
import skelUrl from '../branding/nila/export/nila.skel?url&no-inline';
import atlasText from '../branding/nila/export/nila.atlas?raw';
import pageUrl from '../branding/nila/export/nila.png?url';
import LINES from '../branding/nila/export/voice/lines.json';

/** Her voice for each clip, cut to the same span as the animation. */
const VOICE = Object.fromEntries(
  Object.entries(import.meta.glob('../branding/nila/export/voice/*.mp3', { query: '?url', import: 'default', eager: true })).map(([p, url]) => [p.split('/').pop().replace('.mp3', ''), url]),
);

// Anonymous visit counts; links marked data-goatcounter-click count their clicks (analytics.js).
startAnalytics();
installMobileNav();

const $ = (s) => document.querySelector(s);
const canvas = $('#hero');
const costEl = $('[data-cost]');
const buttons = [...document.querySelectorAll('[data-anim]')];
const soundButton = $('[data-sound]');
const subtitle = $('[data-line]');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Space left around NILA, as a fraction of the stage. */
const MARGIN = 0.04;

/** The expressions played in turn while nobody is choosing (muted, with subtitles). */
const SHOWREEL = ['hello', 'happy', 'surprised', 'thinking', 'wink', 'physics', 'smooth', 'wave'];

/** World bounds [x0, y0, x1, y1] covering every frame of the setup pose and the idle and wave loops. */
function figureBounds(sk) {
  let b = animationBounds(sk, null, 30);
  sk.animations.forEach((anim, i) => {
    if (!['idle', 'wave'].includes(anim.name)) return;
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
  const sk = readSkeletonJson(readSkeletonBinary(bytes), 'nila').skeleton;
  const atlas = parseAtlas(atlasText);
  const page = await createImageBitmap(await (await fetch(pageUrl)).blob(), { premultiplyAlpha: 'none' });
  const renderer = new WebGLRenderer(gl);
  const textures = renderer.atlasTextures(atlas, new Map([[atlas.pages[0].name, page]]));
  const pose = new Pose(sk);
  const state = new AnimationState();
  const [bx0, by0, bx1, by1] = figureBounds(sk);
  // A little headroom: some expressions lean, hop and throw her arms up.
  const pad = (bx1 - bx0) * 0.12;
  const bounds = [bx0 - pad, by0, bx1 + pad, by1 + pad * 0.6];

  let sound = false;
  let voice = null;
  let current = 'idle';
  let chosenAt = -Infinity; // when a visitor last picked an expression; the showreel waits after that
  let reel = 0;
  let idleFor = 0;

  const stopVoice = () => {
    voice?.pause();
    voice = null;
  };

  /** Plays expression `name` once, then settles back into the idle loop. */
  const play = (name, { byVisitor = false } = {}) => {
    if (byVisitor) chosenAt = performance.now();
    current = name;
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.anim === name));
    stopVoice();
    state.setAnimation(sk, 0, name, false, 0.25);
    state.addAnimation(sk, 0, 'idle', true, 0.35);
    idleFor = 0;
    if (subtitle) subtitle.textContent = LINES[name] ? `\u201c${LINES[name]}\u201d` : '';
    if (sound && VOICE[name]) {
      voice = new Audio(VOICE[name]);
      voice.play().catch(() => {});
    }
    if (reducedMotion) {
      // A single still frame, part-way into the chosen expression.
      state.update(sk, 0.8);
      render(0);
    }
  };

  state.addListener({
    start: (entry) => {
      if (entry.name !== 'idle') return;
      current = 'idle';
      for (const b of buttons) b.setAttribute('aria-pressed', 'false');
      if (subtitle) subtitle.textContent = '';
    },
  });

  soundButton?.addEventListener('click', () => {
    sound = !sound;
    soundButton.setAttribute('aria-pressed', String(sound));
    soundButton.textContent = sound ? 'Sound on' : 'Sound off';
    if (!sound) stopVoice();
  });

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
    const [x0, y0, x1, y1] = bounds;
    const zoom = Math.min(((1 - 2 * MARGIN) * cw) / (x1 - x0), ((1 - 2 * MARGIN) * ch) / (y1 - y0));
    const camera = { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: zoom * dpr };
    const t0 = performance.now();
    // While she idles and nobody has chosen for a while, the next expression of the showreel plays.
    idleFor = current === 'idle' ? idleFor + dt : 0;
    if (!reducedMotion && idleFor > 2.2 && t0 - chosenAt > 12000) play(SHOWREEL[reel++ % SHOWREEL.length]);
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

  for (const b of buttons) b.addEventListener('click', () => play(b.dataset.anim, { byVisitor: true }));
  state.setAnimation(sk, 0, 'idle', true, 0);
  if (reducedMotion) {
    state.update(sk, 0.5);
    render(0);
    return;
  }

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
  console.warn('NILA could not play here:', e);
  fallback();
});

// The latest release, shown in the hero and the downloads section (the page works without it).
fetch('https://api.github.com/repos/jaisurya-dev-art/rigby2d/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
  .then((r) => (r.ok ? r.json() : null))
  .then((rel) => {
    if (!rel?.tag_name) return;
    const version = rel.tag_name.replace(/^v/, '');
    for (const el of document.querySelectorAll('[data-version]')) el.textContent = `version ${version}, public beta`;
    const link = $('[data-release]');
    if (link) {
      link.textContent = `Rigby2D ${version}`;
      link.href = rel.html_url;
    }
  })
  .catch(() => {});
