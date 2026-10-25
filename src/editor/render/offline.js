// SPDX-License-Identifier: MIT OR Apache-2.0
// Offline rendering: draws an animation frame by frame at the project's output size, frame rate,
// background and framing, and writes a transparent PNG sequence, a WebM (VP9 with alpha) or an
// MP4 (H.264). Physics and other time-dependent state are simulated frame by frame, so renders are
// deterministic.

import { Pose } from '../../core/pose.js';
import { AnimationState } from '../../core/state.js';
import { WebGLRenderer } from '../../webgl/renderer.js';
import { animationBounds, outputFrame } from '../output.js';
import { writeMp4 } from './mp4.js';
import { writeWebm } from './webm.js';
import { encodeAac, encodeOpus, joinBuffers, mixBuffer, wavOf } from '../audio.js';

export const FORMATS = [
  ['png', 'PNG sequence (transparent)'],
  ['webm', 'WebM video, VP9 (transparent)'],
  ['mp4', 'MP4 video, H.264'],
];

/** Bits per pixel and frame for each quality. */
export const QUALITY = { high: 0.25, medium: 0.12, low: 0.06 };

const identity = (u, v, out) => ((out[0] = u), (out[1] = v), out);

/** Draws frames of one animation at the output settings. */
export class FrameRenderer {
  /**
   * `doc`, `images`: the project and its image store. `job`: { animation (index), skin (name or
   * null), settings, start, end (frame numbers, inclusive), width/height (override, e.g. even sizes
   * for H.264) }.
   */
  constructor(doc, images, job) {
    this.doc = doc;
    this.job = job;
    const s = job.settings;
    this.width = job.width ?? s.width;
    this.height = job.height ?? s.height;
    this.canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(this.width, this.height) : Object.assign(document.createElement('canvas'), { width: this.width, height: this.height });
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true }) ?? this.canvas.getContext('webgl', { alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is not available for rendering');
    this.gl = gl;
    this.renderer = new WebGLRenderer(gl);
    this.textures = new Map();
    this.images = images;
    const bounds = s.frame ? null : animationBounds(doc, job.animation, s.fps);
    const f = outputFrame({ ...s, width: this.width, height: this.height }, bounds);
    this.camera = { x: f.cx, y: f.cy, zoom: 1 / f.scale };
    this.previousSkin = doc.skin;
    doc.skin = job.skin ?? null;
    this.pose = new Pose(doc);
    this.state = new AnimationState();
    this.frame = -1;
    if (job.animation !== null && job.animation !== undefined) this.state.setAnimation(doc, 0, doc.animations[job.animation].name, false, 0);
  }

  lookup(name) {
    const canvas = this.images.get(name);
    if (!canvas || !canvas.width) return null;
    let entry = this.textures.get(name);
    if (!entry) {
      entry = { tex: this.renderer.createTexture(canvas, { linear: this.doc.textureFilter !== 'nearest' }), trim: [0, 0, 1, 1], map: identity };
      this.textures.set(name, entry);
    }
    return entry;
  }

  /** Renders frame `n` (frames must be requested in increasing order). */
  render(n) {
    const { doc, gl, job } = this;
    const dt = 1 / job.settings.fps;
    // Step through skipped frames so physics behaves as in continuous playback.
    while (this.frame < n) {
      if (this.frame >= 0) this.state.update(doc, dt);
      this.frame++;
    }
    this.state.apply(doc, this.pose);
    gl.viewport(0, 0, this.width, this.height);
    const bg = job.settings.background;
    if (bg) gl.clearColor(bg[0] * bg[3], bg[1] * bg[3], bg[2] * bg[3], bg[3]);
    else gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    this.renderer.begin(this.width, this.height, cameraFor(job.settings, doc, this.pose, this.camera));
    this.renderer.drawSkeleton(doc, this.pose, (name) => this.lookup(name));
    this.renderer.end();
    gl.finish();
    return this.canvas;
  }

  dispose() {
    for (const e of this.textures.values()) this.renderer.deleteTexture(e.tex);
    this.textures.clear();
    this.doc.skin = this.previousSkin;
  }
}

/**
 * Camera for a frame: when the framing follows the camera bone, that bone's world position is the
 * frame center and its scale zooms in (scale 2 shows half as much); otherwise `base`.
 */
export function cameraFor(settings, doc, pose, base) {
  if (!settings.frame?.camera) return base;
  const i = doc.bones.findIndex((b) => b.name === 'camera');
  if (i < 0) return base;
  const m = pose.world[i];
  const zoom = Math.hypot(m.a, m.b) || 1;
  return { x: m.tx, y: m.ty, zoom: base.zoom * zoom };
}

/** Frame numbers of a job: start..end inclusive, defaulting to the whole animation. */
export function frameRange(doc, animation, fps, start, end) {
  const duration = animation === null || animation === undefined ? 0 : doc.animations[animation].duration;
  const last = Math.max(0, Math.round(duration * fps));
  const s = Math.max(0, Math.min(start ?? 0, last));
  const e = Math.max(s, Math.min(end ?? last, last));
  return { start: s, end: e, count: e - s + 1, last };
}

/**
 * The current frame as straight-alpha RGBA rows, top row first (WebGL reads bottom-up and
 * premultiplied).
 */
function readFrame(gl, width, height, out) {
  const px = out.raw ?? (out.raw = new Uint8Array(width * height * 4));
  gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, px);
  const rgba = out.rgba ?? (out.rgba = new Uint8ClampedArray(width * height * 4));
  const row = width * 4;
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * row;
    const dst = y * row;
    for (let x = 0; x < row; x += 4) {
      const a = px[src + x + 3];
      if (a === 0) {
        rgba[dst + x] = rgba[dst + x + 1] = rgba[dst + x + 2] = rgba[dst + x + 3] = 0;
      } else if (a === 255) {
        rgba[dst + x] = px[src + x];
        rgba[dst + x + 1] = px[src + x + 1];
        rgba[dst + x + 2] = px[src + x + 2];
        rgba[dst + x + 3] = 255;
      } else {
        const k = 255 / a;
        rgba[dst + x] = px[src + x] * k;
        rgba[dst + x + 1] = px[src + x + 1] * k;
        rgba[dst + x + 2] = px[src + x + 2] * k;
        rgba[dst + x + 3] = a;
      }
    }
  }
  return rgba;
}

/**
 * PNG of the current frame. Encoding goes through a 2D canvas: encoding a WebGL canvas directly
 * can stall for a second per frame.
 */
async function framePng(r, scratch) {
  const rgba = readFrame(r.gl, r.width, r.height, scratch);
  const c = scratch.canvas ?? (scratch.canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(r.width, r.height) : Object.assign(document.createElement('canvas'), { width: r.width, height: r.height }));
  c.getContext('2d').putImageData(new ImageData(rgba, r.width, r.height), 0, 0);
  if (c.convertToBlob) return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? b.arrayBuffer().then((a) => resolve(new Uint8Array(a))) : reject(new Error('PNG encoding failed'))), 'image/png'));
}

/**
 * Workers that encode PNGs in parallel (see pngworker.js), or null where workers or
 * OffscreenCanvas are not available (then frames are encoded one by one on this thread).
 */
function pngPool() {
  if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function') return null;
  // More than four workers did not help in measurements: the main thread becomes the limit.
  const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  let workers;
  try {
    workers = Array.from({ length: size }, () => new Worker(new URL('./pngworker.js', import.meta.url), { type: 'module' }));
  } catch {
    return null;
  }
  const pending = new Map();
  let next = 0;
  for (const w of workers) {
    w.onmessage = (e) => {
      const { id, bytes, error } = e.data;
      const job = pending.get(id);
      pending.delete(id);
      if (error) job.reject(new Error(`PNG encoding failed: ${error}`));
      else job.resolve(bytes);
    };
    w.onerror = (e) => {
      for (const job of pending.values()) job.reject(new Error(`PNG encoding failed: ${e.message}`));
      pending.clear();
    };
  }
  return {
    size,
    encode(width, height, pixels) {
      const id = next++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        workers[id % size].postMessage({ id, width, height, pixels: pixels.buffer }, [pixels.buffer]);
      });
    },
    close() {
      for (const w of workers) w.terminate();
    },
  };
}

/**
 * Waits until an encoder has taken a frame from its queue: its dequeue event, or a short timeout
 * (browsers without the event, or an encoder that failed and will not dequeue again).
 */
function drained(encoder) {
  return new Promise((resolve) => {
    encoder.addEventListener('dequeue', resolve, { once: true });
    setTimeout(resolve, 20);
  });
}

/** The first supported encoder configuration, or null. */
async function supportedConfig(candidates) {
  if (typeof VideoEncoder !== 'function') return null;
  for (const config of candidates) {
    try {
      const r = await VideoEncoder.isConfigSupported(config);
      if (r.supported) return r.config;
    } catch {
      // try the next one
    }
  }
  return null;
}

/** Whether video formats can be encoded here (WebCodecs). */
export function canEncodeVideo() {
  return typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';
}

/**
 * Renders a job and returns the files to write: [{ name, bytes }]. `job` adds { format, quality,
 * name (base file name) } to the FrameRenderer job. `progress(done, total)` may return false to
 * cancel (then null is returned).
 */
export async function renderJob(doc, images, job, progress = () => true) {
  const s = job.settings;
  const range = frameRange(doc, job.animation, s.fps, job.start, job.end);
  if (job.format === 'png') {
    const r = new FrameRenderer(doc, images, job);
    const pool = pngPool();
    try {
      const digits = Math.max(4, String(range.end).length);
      const files = [];
      const scratch = {};
      const inflight = [];
      for (let f = range.start; f <= range.end; f++) {
        r.render(f);
        const file = { name: `${job.name}_${String(f).padStart(digits, '0')}.png`, bytes: null };
        files.push(file);
        if (pool) {
          // Raw pixels go to a worker; the next frame renders while earlier ones encode.
          const pixels = new Uint8Array(r.width * r.height * 4);
          r.gl.readPixels(0, 0, r.width, r.height, r.gl.RGBA, r.gl.UNSIGNED_BYTE, pixels);
          inflight.push(pool.encode(r.width, r.height, pixels).then((bytes) => (file.bytes = bytes)));
          while (inflight.length >= pool.size * 2) await inflight.shift();
        } else {
          file.bytes = await framePng(r, scratch);
        }
        if (progress(f - range.start + 1, range.count) === false) return null;
      }
      await Promise.all(inflight);
      return files;
    } finally {
      r.dispose();
      pool?.close();
    }
  }
  const files = await encodeVideo(doc, images, [job], job, progress);
  return files && files.filter((f) => !f.name.endsWith('.wav'));
}

/**
 * Renders several jobs (animations and skins) one after another into a single video named
 * `name` (format, quality and settings from the first job), with their audio joined in the same
 * order. Returns [{ name, bytes }]: the video, and a WAV of the joined audio when there is any.
 * `progress(frame, frames, jobIndex)` returning false cancels (then null is returned).
 */
export function renderMerged(doc, images, jobs, name, progress = () => true) {
  return encodeVideo(doc, images, jobs, { ...jobs[0], name }, progress);
}

/** The video encoder behind renderJob and renderMerged. */
async function encodeVideo(doc, images, jobs, job, progress) {
  const s = job.settings;
  if (!canEncodeVideo()) throw new Error('video encoding (WebCodecs) is not available here; render a PNG sequence instead');
  const mp4 = job.format === 'mp4';
  const segments = jobs.map((j) => ({ job: j, range: frameRange(doc, j.animation, s.fps, j.start, j.end) }));
  const total = segments.reduce((n, g) => n + g.range.count, 0);
  // H.264 needs even dimensions.
  const width = mp4 ? s.width + (s.width % 2) : s.width;
  const height = mp4 ? s.height + (s.height % 2) : s.height;
  const bitrate = Math.round(width * height * s.fps * (QUALITY[job.quality] ?? QUALITY.high));
  const base = { width, height, bitrate, framerate: s.fps };
  const transparent = !mp4 && !s.background;
  const config = mp4
    ? await supportedConfig(['avc1.640033', 'avc1.640028', 'avc1.4d0033', 'avc1.42e033', 'avc1.42e01f'].map((codec) => ({ ...base, codec, avc: { format: 'avc' } })))
    : await supportedConfig(['vp09.00.51.08', 'vp09.00.41.08', 'vp8'].map((codec) => ({ ...base, codec })));
  if (!config) throw new Error(`${mp4 ? 'H.264' : 'VP9/VP8'} encoding at ${width}×${height} is not supported here`);

  // Transparency: WebM stores alpha as a second VP8/VP9 stream whose luma is the alpha channel
  // (block additions). Browsers' encoders do not produce it, so a second encoder encodes the alpha
  // plane as the Y plane of an I420 frame (chroma neutral), with key frames on the same frames.
  let failure = null;
  const onError = (e) => (failure = e);
  const color = [];
  const alpha = new Map();
  let description = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      if (meta?.decoderConfig?.description) {
        const d = meta.decoderConfig.description;
        description = new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
      }
      color.push({ data, alpha: null, key: chunk.type === 'key', time: chunk.timestamp / 1000 });
    },
    error: onError,
  });
  encoder.configure(config);
  const alphaEncoder = transparent
    ? new VideoEncoder({
        output: (chunk) => {
          const data = new Uint8Array(chunk.byteLength);
          chunk.copyTo(data);
          alpha.set(chunk.timestamp, data);
        },
        error: onError,
      })
    : null;
  alphaEncoder?.configure(config);
  const keyEvery = Math.max(1, Math.round(s.fps * 2));
  const scratch = {};
  const cw = Math.ceil(width / 2);
  const ch = Math.ceil(height / 2);
  const planes = transparent ? new Uint8Array(width * height + 2 * cw * ch).fill(128) : null;
  const encoders = [encoder, alphaEncoder].filter(Boolean);
  let i = 0;
  let r = null;
  try {
    for (const [k, { job: segment, range }] of segments.entries()) {
      // Each animation (and skin) gets its own renderer: framing and physics start fresh.
      r = new FrameRenderer(doc, images, { ...segment, settings: s, width, height });
      for (let f = range.start; f <= range.end; f++, i++) {
        if (failure) throw failure;
        r.render(f);
        const timestamp = Math.round((i * 1e6) / s.fps);
        const timing = { timestamp, duration: Math.round(1e6 / s.fps) };
        // A key frame starts every animation, so players can seek to each one.
        const key = { keyFrame: f === range.start || (f - range.start) % keyEvery === 0 };
        // Opaque video takes the frame straight from the WebGL canvas: no copy to the CPU, and soft
        // edges blend over the background (black for MP4 without one) exactly as drawn.
        // Transparent WebM needs straight color and a separate alpha plane, read back here.
        const rgba = transparent ? readFrame(r.gl, width, height, scratch) : null;
        const frame = transparent ? new VideoFrame(rgba, { format: 'RGBA', codedWidth: width, codedHeight: height, ...timing }) : new VideoFrame(r.canvas, { ...timing, alpha: 'discard' });
        encoder.encode(frame, key);
        frame.close();
        if (alphaEncoder) {
          for (let p = 0, n = width * height; p < n; p++) planes[p] = rgba[4 * p + 3];
          const a = new VideoFrame(planes, { format: 'I420', codedWidth: width, codedHeight: height, ...timing });
          alphaEncoder.encode(a, key);
          a.close();
        }
        for (const e of encoders) while (e.encodeQueueSize > 8 && !failure) await drained(e);
        if (progress(i + 1, total, k) === false) return null;
      }
      r.dispose();
      r = null;
    }
    await Promise.all(encoders.map((e) => e.flush()));
    if (failure) throw failure;
  } finally {
    r?.dispose();
    for (const e of encoders) if (e.state !== 'closed') e.close();
  }
  color.sort((x, y) => x.time - y.time);
  // The animation's audio tracks, mixed: AAC in MP4 for the widest player support (Opus where the
  // system has no AAC encoder), Opus in WebM. Left out when neither encoder is available.
  // Several animations: their mixes are joined in render order.
  const parts = [];
  for (const { job: segment, range } of segments) {
    const name = doc.animations[segment.animation]?.name;
    parts.push({ buffer: name ? await mixBuffer(doc, name, range.count / s.fps).catch(() => null) : null, seconds: range.count / s.fps });
  }
  const mixed = segments.length === 1 ? parts[0].buffer : joinBuffers(parts);
  let audio = null;
  if (mixed) {
    if (mp4) audio = await encodeAac(mixed).catch(() => null);
    audio ??= await encodeOpus(mixed).catch(() => null);
  }
  const wav = mixed ? [{ name: `${job.name}.wav`, bytes: wavOf(mixed) }] : [];
  if (mp4) {
    if (!description) throw new Error('the H.264 encoder gave no decoder configuration');
    return [{ name: `${job.name}.mp4`, bytes: writeMp4({ width, height, fps: s.fps, avcC: description, frames: color, audio }) }, ...wav];
  }
  if (transparent) for (const c of color) c.alpha = alpha.get(Math.round(c.time * 1000)) ?? null;
  const codec = config.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8';
  return [{ name: `${job.name}.webm`, bytes: writeWebm({ width, height, fps: s.fps, codec, alpha: transparent, frames: color, audio }) }, ...wav];
}
