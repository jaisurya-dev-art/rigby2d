// SPDX-License-Identifier: MIT OR Apache-2.0
// The desktop app's windowless render mode: `Rigby2D --render <project> --out <file> [options]`
// (the options of `rigby render`, see render/plan.js). The app starts with one hidden window that
// loads render.html and runs this: it opens the project as the editor does, renders every job
// exactly as File > Render animation does (render/offline.js) and writes the files. It reports as
// JSON lines on standard output (the `rigby render` command reads them) and exits with 0, or 1 on
// failure. No editor window opens, and a running editor is not touched.
//
// Lines: { type: 'gpu', gpu, encoder } · { type: 'start', job, animation, skin, frames, width,
// height, fps, format } · { type: 'progress', done, total } · { type: 'file', path } ·
// { type: 'done', result } · { type: 'error', message }.

import { invoke } from '@tauri-apps/api/core';
import * as tfs from '@tauri-apps/plugin-fs';

import { UsageError, parseArgs } from '../cli/args.js';
import { clipTracks, loadActors } from './actors.js';
import { addSound, mixWav, sounds } from './audio.js';
import { Images } from './images.js';
import { openProject } from './io.js';
import { desktopFile } from './platform.js';
import { RENDER_OPTIONS, RenderError, jobTarget, joinPath, planJobs, renderFormat } from './render/plan.js';
import { frameRange, renderGif, renderJob } from './render/offline.js';

/** The options `--render` takes: those of `rigby render`, and --allow-software. */
export const APP_RENDER_SPEC = {
  positionals: ['project'],
  options: { ...RENDER_OPTIONS, 'allow-software': { type: 'boolean' } },
};

const report = (line) => invoke('render_report', { line: JSON.stringify(line) });
const isAbsolute = (p) => /^([a-zA-Z]:)?[\\/]/.test(p);

/** The GPU WebGL draws on, as the driver reports it. */
function gpuName() {
  const gl = document.createElement('canvas').getContext('webgl2');
  if (!gl) return null;
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
}

async function run() {
  const { cwd, args } = await invoke('render_args');
  let opts;
  try {
    const parsed = parseArgs(args, APP_RENDER_SPEC);
    opts = { ...parsed.positionals, ...parsed.options };
  } catch (e) {
    throw e instanceof UsageError ? new RenderError(`${e.message} (Rigby2D --render <project> --out <file> [options], as rigby render)`) : e;
  }
  if (!opts.out) throw new RenderError('give --out');
  const resolve = (p) => (isAbsolute(p) ? p : joinPath(cwd, p));
  const project = resolve(opts.project);
  const out = resolve(opts.out);
  const outIsDir = /[\\/]$/.test(opts.out) || (await tfs.stat(out).then((s) => s.isDirectory, () => false));
  const format = renderFormat(out, outIsDir, opts.format);

  const gpu = gpuName();
  if (!gpu) throw new RenderError('WebGL is not available: rendering needs a GPU.');
  if (/swiftshader|llvmpipe|software|microsoft basic/i.test(gpu) && !opts.allowSoftware) {
    throw new RenderError(`The app fell back to software rendering (${gpu}). Rendering needs the GPU: update the graphics driver, or pass --allow-software to render slowly on the CPU.`);
  }

  // Open the project as the editor does: images, sounds and a scene's actors.
  const images = new Images();
  const { fs } = desktopFile(project);
  const opened = await openProject(project, fs, images).catch((e) => {
    throw new RenderError(`Cannot open ${project}: ${e.message ?? e}`);
  });
  const warnings = [...opened.warnings];
  sounds.clear();
  for (const [name, bytes] of opened.audio ?? []) await addSound(name, bytes).catch(() => warnings.push(`sound '${name}' cannot be decoded`));
  warnings.push(...(await loadActors(opened.actorFiles ?? new Map(), images)));
  const doc = opened.doc;
  const info = { name: doc.name, animations: doc.animations, skins: doc.skins.map((s) => s.name), settings: doc.settings };
  const jobs = planJobs(info, { ...opts, out, outIsDir, format });

  // Frames are drawn by the GPU. Video is encoded by WebCodecs as in the Render dialog: the
  // WebView picks the encoder (WebView2 encoded H.264 in software in tests on a GTX 1650; there is
  // no VP9 encoder on most GPUs).
  const s = jobs[0].settings;
  await report({ type: 'gpu', gpu, encoder: format === 'mp4' ? 'H.264 (WebCodecs)' : format === 'webm' ? 'VP9 (WebCodecs)' : format });

  // Check every target before rendering anything.
  const ranges = jobs.map((j) => frameRange(doc, j.animation, j.settings.fps, j.start, j.end));
  await tfs.mkdir(jobs[0].dir, { recursive: true });
  if (!opts.force) {
    for (const [k, j] of jobs.entries()) {
      const target = jobTarget(j, ranges[k]);
      if (await tfs.exists(target)) throw new RenderError(`${target} already exists. Pass --force to replace it.`);
    }
  }

  const renders = [];
  for (const [k, job] of jobs.entries()) {
    const range = ranges[k];
    const width = job.format === 'mp4' ? s.width + (s.width % 2) : job.settings.width;
    const height = job.format === 'mp4' ? s.height + (s.height % 2) : job.settings.height;
    await report({ type: 'start', job: k + 1, jobs: jobs.length, animation: job.animationName, skin: job.skin ?? 'default', frames: range.count, width, height, fps: job.settings.fps, format: job.format });
    let last = 0;
    const progress = (done, total) => {
      const now = performance.now();
      if (done === total || now - last > 250) {
        last = now;
        report({ type: 'progress', done, total });
      }
      return true;
    };
    // The Render dialog's job, as it builds it (renderui.js).
    const dialogJob = { animation: job.animation, skin: job.skin, settings: job.settings, format: job.format, quality: job.quality, name: job.name, start: job.start, end: job.end };
    const files = job.format === 'gif' ? [await renderGif(doc, images, dialogJob, progress)] : await renderJob(doc, images, dialogJob, progress);
    const written = [];
    for (const f of files) {
      const path = joinPath(job.dir, f.name);
      await tfs.writeFile(path, f.bytes);
      written.push(path);
    }
    // The animation's audio, mixed, next to the render for the editing software (as the dialog does).
    const anim = doc.animations[job.animation].name;
    const wav = await mixWav(doc, anim, (range.last + 1) / job.settings.fps, clipTracks(doc, anim)).catch(() => null);
    if (wav) {
      const path = joinPath(job.dir, `${job.name}.wav`);
      await tfs.writeFile(path, wav);
      written.push(path);
    }
    for (const path of written) await report({ type: 'file', path });
    renders.push({ animation: job.animationName, skin: job.skin ?? 'default', frames: range.count, files: written.length, first: written[0] ?? null });
  }
  return { engine: 'app', gpu, format, width: jobs[0].format === 'mp4' ? s.width + (s.width % 2) : s.width, height: jobs[0].format === 'mp4' ? s.height + (s.height % 2) : s.height, fps: s.fps, renders, warnings };
}

run().then(
  async (result) => {
    await report({ type: 'done', result });
    await invoke('render_exit', { code: 0 });
  },
  async (e) => {
    await report({ type: 'error', message: e instanceof RenderError ? e.message : String(e?.stack ?? e) }).catch(() => {});
    await invoke('render_exit', { code: 1 });
  },
);
