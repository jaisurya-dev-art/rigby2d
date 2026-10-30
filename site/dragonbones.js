// SPDX-License-Identifier: MIT OR Apache-2.0
// The "Coming from DragonBones" stage on the landing page: DragonBones' own demo characters, read
// from their DragonBones export files by Rigby2D's importer (src/editor/dragonbones.js, nested
// weapons and effects included) and played with the Rigby2D runtime. The art is CC BY-NC-SA 4.0 (site/showcase/dragonbones/README.md); it
// loads only when the section comes near the screen.

import { parseAtlas } from '../src/core/atlas.js';
import { readSkeletonJson } from '../src/core/interop.js';
import { Pose } from '../src/core/pose.js';
import { AnimationState } from '../src/core/state.js';
import { WebGLRenderer } from '../src/webgl/renderer.js';
import { dragonBonesToSkeleton } from '../src/editor/dragonbones.js';
import { animationBounds } from '../src/editor/output.js';

const FILES = import.meta.glob('./showcase/dragonbones/*/*', { query: '?url', import: 'default', eager: true });
const file = (id, suffix) => FILES[`./showcase/dragonbones/${id}/${id}${suffix}`];

/** The characters: their armature and the moves offered (DragonBones names). */
const CHARACTERS = [
  { id: 'mecha_2903', armature: 'mecha_2903d', label: 'Scorpion', moves: ['walk', 'attack_01', 'skill_01', 'skill_04', 'skill_05', 'hit', 'victory', 'death'] },
  { id: 'mecha_1406', armature: 'mecha_1406', label: 'Walker', moves: ['walk', 'attack_01', 'jump', 'aim', 'skill_01', 'hit', 'death'] },
  { id: 'mecha_1004d', armature: 'mecha_1004d', label: 'Blade', moves: ['walk', 'attack_01', 'skill_01', 'skill_03', 'skill_04', 'skill_05', 'hit', 'victory', 'death'] },
  { id: 'mecha_1502b', armature: 'mecha_1502b', label: 'Raptor', moves: ['walk', 'attack_01', 'attack_02', 'aim', 'squat', 'hit', 'death'] },
  { id: 'mecha_1002_101d_show', armature: 'mecha_1002_101d', label: 'Titan', moves: [] },
];

const moveLabel = (name) =>
  name
    .replace(/_0?(\d+)$/, ' $1')
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());

/** Loads one character: { sk, textures, bounds }. */
async function load(renderer, c) {
  const [ske, tex, page] = await Promise.all([
    fetch(file(c.id, '_ske.json')).then((r) => r.json()),
    fetch(file(c.id, '_tex.json')).then((r) => r.json()),
    fetch(file(c.id, '_tex.png'))
      .then((r) => r.blob())
      .then((b) => createImageBitmap(b, { premultiplyAlpha: 'none' })),
  ]);
  const { json, atlas: atlasText } = dragonBonesToSkeleton(ske, tex, { armatureName: c.armature });
  const sk = readSkeletonJson(json, c.id).skeleton;
  const atlas = parseAtlas(atlasText);
  const textures = renderer.atlasTextures(atlas, new Map([[atlas.pages[0].name, page]]));
  // One frame for every move, so the camera never jumps between them.
  let b = animationBounds(sk, null, 30);
  sk.animations.forEach((a, i) => {
    if (a.name !== 'idle' && !c.moves.includes(a.name)) return;
    const ab = animationBounds(sk, i, 30);
    if (ab) b = b ? [Math.min(b[0], ab[0]), Math.min(b[1], ab[1]), Math.max(b[2], ab[2]), Math.max(b[3], ab[3])] : ab;
  });
  return { sk, textures, bounds: b };
}

export async function startDragonBonesStage(root) {
  const canvas = root.querySelector('canvas');
  const picker = root.querySelector('[data-db-characters]');
  const movesEl = root.querySelector('[data-db-moves]');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true }) ?? canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true });
  if (!gl) throw new Error('WebGL unavailable');
  const renderer = new WebGLRenderer(gl);
  const loaded = new Map();
  let current = null;
  let pose = null;
  let state = null;
  let chosenAt = -Infinity;
  let idleFor = 0;
  let reel = 0;

  const play = (name, byVisitor = false) => {
    if (!current) return;
    if (byVisitor) chosenAt = performance.now();
    const c = current.c;
    const looping = name === 'walk' || name === 'aim';
    state.setAnimation(current.sk, 0, name, looping, 0.15);
    if (!looping) state.addAnimation(current.sk, 0, 'idle', true, 0.2);
    for (const b of movesEl.children) b.setAttribute('aria-pressed', String(b.dataset.move === name));
    idleFor = 0;
    // A walk loops for a while, then the character rests again.
    if (looping) setTimeout(() => state && current?.c === c && state.setAnimation(current.sk, 0, 'idle', true, 0.25), 3600);
  };

  const choose = async (c, byVisitor = false) => {
    if (byVisitor) chosenAt = performance.now();
    for (const b of picker.children) b.setAttribute('aria-pressed', String(b.dataset.character === c.id));
    root.classList.add('loading');
    if (!loaded.has(c.id)) loaded.set(c.id, load(renderer, c));
    const ch = { ...(await loaded.get(c.id)), c };
    root.classList.remove('loading');
    current = ch;
    pose = new Pose(ch.sk);
    state = new AnimationState();
    state.setAnimation(ch.sk, 0, 'idle', true, 0);
    state.addListener({ start: (e) => e.name === 'idle' && [...movesEl.children].forEach((b) => b.setAttribute('aria-pressed', 'false')) });
    movesEl.replaceChildren(
      ...c.moves.map((m) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.dataset.move = m;
        b.textContent = moveLabel(m);
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => play(m, true));
        return b;
      }),
    );
    movesEl.hidden = !c.moves.length;
    idleFor = 0;
    if (reducedMotion) render(0.6);
  };

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
    if (!current) return;
    // A move now and then while nobody is choosing: the stage shows what the characters can do.
    idleFor += dt;
    if (!reducedMotion && current.c.moves.length && idleFor > 2.6 && performance.now() - chosenAt > 15000) play(current.c.moves[reel++ % current.c.moves.length]);
    const [x0, y0, x1, y1] = current.bounds;
    const zoom = Math.min((0.9 * cw) / (x1 - x0), (0.86 * ch) / (y1 - y0));
    state.update(current.sk, dt);
    state.apply(current.sk, pose);
    renderer.begin(w, h, { x: (x0 + x1) / 2, y: (y0 + y1) / 2, zoom: zoom * dpr });
    renderer.drawSkeleton(current.sk, pose, current.textures);
    renderer.end();
  };

  picker.replaceChildren(
    ...CHARACTERS.map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.character = c.id;
      b.textContent = c.label;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => choose(c, true));
      return b;
    }),
  );
  await choose(CHARACTERS[0]);
  if (reducedMotion) return;

  let visible = true;
  new IntersectionObserver(([e]) => (visible = e.isIntersecting)).observe(canvas);
  let last = performance.now();
  const loop = (now) => {
    const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (visible && !document.hidden) render(dt);
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
