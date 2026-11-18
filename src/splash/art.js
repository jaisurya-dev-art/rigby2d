// SPDX-License-Identifier: MIT OR Apache-2.0
// Community animations for the splash screen. Each piece is a folder in src/splash/art/ with a
// skeleton (.json), its .atlas and page images, and a piece.json (see art/README.md). They are
// bundled with the app, so nothing is downloaded at start. One is picked at random each launch.

import { parseAtlas } from '../core/atlas.js';
import { readSkeletonJson } from '../core/interop.js';
import { Pose } from '../core/pose.js';
import { AnimationState } from '../core/state.js';
import { WebGLRenderer } from '../webgl/renderer.js';

const manifests = import.meta.glob('./art/*/piece.json', { eager: true, import: 'default' });
const files = import.meta.glob('./art/*/*.{json,atlas,png,webp}', { eager: true, query: '?url', import: 'default' });

/** The bundled pieces: { title, artist, animation, skeleton, atlas, frame, urls: { file: url } }. */
export const PIECES = Object.entries(manifests).map(([path, m]) => {
  const dir = path.slice(0, path.lastIndexOf('/') + 1);
  const urls = {};
  for (const [f, url] of Object.entries(files)) if (f.startsWith(dir)) urls[f.slice(dir.length)] = url;
  return { ...m, urls };
});

/** A random piece, or null when none is bundled. */
export function pickPiece(random = Math.random) {
  return PIECES.length ? PIECES[Math.floor(random() * PIECES.length)] : null;
}

/**
 * Where the piece sits: its setup-pose bounds scaled to `frame.height` of the window (default 0.86)
 * and centred at `frame.x` of its width (default 0.6, the space right of the lockup).
 */
export function framePiece(bounds, width, height, frame = {}) {
  const [x0, y0, x1, y1] = bounds;
  const zoom = ((frame.height ?? 0.86) * height) / Math.max(1e-6, y1 - y0);
  const cx = (x0 + x1) / 2 - ((frame.x ?? 0.6) - 0.5) * (width / zoom);
  const cy = (y0 + y1) / 2 + ((frame.y ?? 0.5) - 0.5) * (height / zoom);
  return { x: cx, y: cy, zoom };
}

/** Loads a piece and plays its animation on `canvas` (WebGL, transparent) in a loop. */
export async function playPiece(piece, canvas, still = false) {
  const get = (name) => {
    const url = piece.urls[name];
    if (!url) throw new Error(`${name} is missing`);
    return fetch(url);
  };
  const gl = canvas.getContext('webgl2', { premultipliedAlpha: true, alpha: true }) ?? canvas.getContext('webgl', { premultipliedAlpha: true, alpha: true });
  if (!gl) return;
  const renderer = new WebGLRenderer(gl);
  const sk = readSkeletonJson(await (await get(piece.skeleton)).json(), piece.skeleton).skeleton;
  const atlas = parseAtlas(await (await get(piece.atlas)).text());
  const pages = new Map();
  for (const p of atlas.pages) pages.set(p.name, await createImageBitmap(await (await get(p.name)).blob(), { premultiplyAlpha: 'none' }));
  const textures = renderer.atlasTextures(atlas, pages);
  if (piece.skin) sk.skin = piece.skin;
  const pose = new Pose(sk);
  pose.setToSetup(sk);
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const q of pose.quads(sk)) {
    for (const [x, y] of q.positions) {
      b[0] = Math.min(b[0], x);
      b[1] = Math.min(b[1], y);
      b[2] = Math.max(b[2], x);
      b[3] = Math.max(b[3], y);
    }
  }
  const state = new AnimationState();
  const anim = piece.animation ?? sk.animations[0]?.name;
  if (anim) state.play(sk, anim, true, 0);
  let last = performance.now();
  const frame = (now) => {
    const dt = still ? 0 : Math.min(0.1, (now - last) / 1000);
    last = now;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) [canvas.width, canvas.height] = [w, h];
    const cam = framePiece(b, canvas.clientWidth, canvas.clientHeight, piece.frame);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    state.update(sk, dt);
    state.apply(sk, pose);
    renderer.begin(w, h, { ...cam, zoom: cam.zoom * dpr });
    renderer.drawSkeleton(sk, pose, textures);
    renderer.end();
    if (!document.body.classList.contains('leaving')) requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
