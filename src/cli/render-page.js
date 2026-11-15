// SPDX-License-Identifier: MIT OR Apache-2.0
// Browser side of `rigby render`: runs in Chromium (launched on the GPU by src/cli/render.js),
// opens the project as the editor does and renders with the editor's own frame renderer and
// encoders. Files and raw frames go back to the CLI's local server by POST.

import { loadActors, clipTracks } from '../editor/actors.js';
import { addSound, mixWav, sounds } from '../editor/audio.js';
import { Images } from '../editor/images.js';
import { openProject } from '../editor/io.js';
import { FrameRenderer, frameRange, renderGif, renderJob } from '../editor/render/offline.js';

const images = new Images();
let doc = null;

/** The CLI server's file system: read-only, confined to the project's folder. */
const fs = {
  async readFile(path) {
    const r = await fetch(`/fs?path=${encodeURIComponent(path)}`);
    if (!r.ok) throw new Error(await r.text());
    return new Uint8Array(await r.arrayBuffer());
  },
  async readText(path) {
    return new TextDecoder().decode(await fs.readFile(path));
  },
  async list(dir) {
    const r = await fetch(`/ls?path=${encodeURIComponent(dir)}`);
    return r.ok ? r.json() : [];
  },
};

async function post(url, bytes) {
  // A Blob body uploads about ten times faster than a typed array (measured in Chromium 1080p frames).
  const r = await fetch(url, { method: 'POST', body: new Blob([bytes]) });
  if (!r.ok) throw new Error(await r.text());
}

const sendFile = (name, bytes) => post(`/file?name=${encodeURIComponent(name)}`, bytes);
const progress = (n, total) => (window.rigbyProgress?.(n, total), true);

/** The GPU WebGL draws on, as the driver reports it. */
function gpu() {
  const gl = document.createElement('canvas').getContext('webgl2') ?? document.createElement('canvas').getContext('webgl');
  if (!gl) return null;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
}

window.rigbyRender = {
  gpu,

  /** Opens the project (with its sounds and a scene's actors). Returns what the CLI needs to plan jobs. */
  async open(path) {
    const opened = await openProject(path, fs, images);
    const warnings = [...opened.warnings];
    sounds.clear();
    for (const [name, bytes] of opened.audio ?? []) await addSound(name, bytes).catch(() => warnings.push(`sound '${name}' cannot be decoded`));
    warnings.push(...(await loadActors(opened.actorFiles ?? new Map(), images)));
    doc = opened.doc;
    return {
      name: doc.name,
      animations: doc.animations.map((a) => ({ name: a.name, duration: a.duration })),
      skins: doc.skins.map((s) => s.name),
      settings: doc.settings,
      warnings,
    };
  },

  /** Frame range of a job: { start, end, count, last }. */
  range(job) {
    return frameRange(doc, job.animation, job.settings.fps, job.start, job.end);
  },

  /** Sends the animation's mixed audio as `name` (WAV). Returns whether there is any. */
  async audio(job, name) {
    const anim = doc.animations[job.animation].name;
    const range = frameRange(doc, job.animation, job.settings.fps, job.start, job.end);
    const wav = await mixWav(doc, anim, (range.last + 1) / job.settings.fps, clipTracks(doc, anim)).catch(() => null);
    if (!wav) return false;
    await sendFile(name, wav);
    return true;
  },

  /** PNG sequence, WebM or GIF with the editor's encoders; files are sent as they are made. Returns their names. */
  async encode(job) {
    const files = job.format === 'gif' ? [await renderGif(doc, images, job, progress)] : await renderJob(doc, images, job, progress);
    for (const f of files) await sendFile(f.name, f.bytes);
    return files.map((f) => f.name);
  },

  /**
   * Raw frames for an external encoder: each frame is read back from the GPU bottom row first
   * (RGBA, premultiplied over the opaque background) and POSTed to /frame in order.
   */
  async frames(job) {
    const r = new FrameRenderer(doc, images, job);
    try {
      const range = frameRange(doc, job.animation, job.settings.fps, job.start, job.end);
      const px = new Uint8Array(r.width * r.height * 4);
      // The upload of a frame (its Blob holds a copy) overlaps drawing the next one; frames arrive in order.
      let pending = null;
      for (let f = range.start, k = 0; f <= range.end; f++, k++) {
        r.render(f);
        r.gl.readPixels(0, 0, r.width, r.height, r.gl.RGBA, r.gl.UNSIGNED_BYTE, px);
        const body = new Blob([px]);
        await pending;
        pending = fetch('/frame', { method: 'POST', body }).then(async (res) => {
          if (!res.ok) throw new Error(await res.text());
        });
        progress(k + 1, range.count);
      }
      await pending;
      return { width: r.width, height: r.height, count: range.count };
    } finally {
      r.dispose();
    }
  },
};
