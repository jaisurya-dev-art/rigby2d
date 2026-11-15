// SPDX-License-Identifier: MIT OR Apache-2.0
// Render plans for command-line renders: the options of `rigby render` (and of the desktop app's
// windowless `--render` mode, which takes the same options), and the jobs they make, one per
// animation and skin, named as the Render dialog names them. Pure: runs in Node and in the app.

/** A render request that cannot be done (exit code 1). */
export class RenderError extends Error {}

export const RENDER_FORMATS = ['mp4', 'webm', 'png', 'gif'];
export const QUALITIES = ['high', 'medium', 'low'];

/** The options of `rigby render` and `Rigby2D --render <project>` (see src/cli/args.js). */
export const RENDER_OPTIONS = {
  out: { type: 'string', short: 'o', help: 'Output file (its extension picks the format), or a folder ending in /.' },
  format: { type: 'string', short: 'F', choices: RENDER_FORMATS, help: 'Format when --out is a folder (default mp4).' },
  animation: { type: 'list', short: 'a', help: 'Animations to render (comma list). Needed when there are several.' },
  all: { type: 'boolean', help: 'Render every animation.' },
  skin: { type: 'list', help: 'Skins to render (comma list; default: the default skin).' },
  fps: { type: 'number', help: 'Frame rate (default: the project output settings).' },
  width: { type: 'integer', short: 'W', help: 'Frame width in pixels (default: output settings).' },
  height: { type: 'integer', short: 'H', help: 'Frame height in pixels (default: output settings).' },
  background: { type: 'string', help: 'Background colour #rrggbb[aa], or none for transparent (default: output settings).' },
  quality: { type: 'string', choices: QUALITIES, help: 'Video quality (default high).' },
  start: { type: 'integer', help: 'First frame (single render).' },
  end: { type: 'integer', help: 'Last frame (single render).' },
  force: { type: 'boolean', short: 'f', help: 'Replace existing output files.' },
};

/** File-name-safe text (as the Render dialog names files). */
export const safeName = (s) => s.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'render';

const lastSep = (p) => Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
/** Folder of a path ('.' when it has none), keeping its own separator style. */
export const dirOf = (p) => (lastSep(p) < 0 ? '.' : lastSep(p) === 0 ? p[0] : p.slice(0, lastSep(p)));
const baseOf = (p) => p.slice(lastSep(p) + 1);
const extOf = (p) => {
  const b = baseOf(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
};
/** `name` in folder `dir`, with the folder's separator style. */
export const joinPath = (dir, name) => (dir === '.' ? name : `${dir}${/[\\/]$/.test(dir) ? '' : dir.includes('\\') ? '\\' : '/'}${name}`);

/** The format a render writes: --format, else --out's extension (mp4 for a folder). */
export function renderFormat(out, outIsDir, format) {
  const f = format ?? (outIsDir ? 'mp4' : extOf(out));
  if (!RENDER_FORMATS.includes(f)) throw new RenderError(`Render to ${RENDER_FORMATS.map((x) => `.${x}`).join(', ')} (from --out's extension or --format), not '${f || out}'.`);
  return f;
}

/** '#rrggbb' or '#rrggbbaa' as [r, g, b, a] in 0..1, or null for 'none' / 'transparent'. */
export function parseColor(text) {
  if (/^(none|transparent)$/i.test(text)) return null;
  const m = /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(text);
  if (!m) throw new RenderError(`--background is a colour like #202020 (or #20202080, or none), not '${text}'`);
  const n = (i, s) => parseInt(s.slice(i, i + 2), 16) / 255;
  return [n(0, m[1]), n(2, m[1]), n(4, m[1]), m[2] ? n(0, m[2]) : 1];
}

/**
 * Plans the renders. `info`: { name, animations: [{ name }], skins: [names], settings } of the
 * project. `opts`: the parsed render options plus `outIsDir`. Returns jobs as the Render dialog
 * makes them ({ animation (index), skin, settings, format, quality, name, start, end }) with the
 * animation's name and the output folder (`dir`) added.
 */
export function planJobs(info, opts) {
  const anims = info.animations.map((a) => a.name);
  if (!anims.length) throw new RenderError('Nothing to render: the project has no animations.');
  let picked;
  if (opts.all) picked = anims;
  else if (opts.animation?.length) {
    const missing = opts.animation.filter((a) => !anims.includes(a));
    if (missing.length) throw new RenderError(`No animation ${missing.map((m) => `'${m}'`).join(', ')}. Animations: ${anims.join(', ')}.`);
    picked = opts.animation;
  } else if (anims.length === 1) picked = anims;
  else throw new RenderError(`Pick what to render with --animation <name> or --all. Animations: ${anims.join(', ')}.`);
  const skins = (opts.skin?.length ? opts.skin : [null]).map((s) => (s === 'default' ? null : s));
  for (const s of skins) if (s && !info.skins.includes(s)) throw new RenderError(`No skin '${s}'. Skins: default${info.skins.length ? `, ${info.skins.join(', ')}` : ''}.`);

  const settings = { ...info.settings };
  if (opts.fps !== undefined) settings.fps = opts.fps;
  if (opts.width !== undefined) settings.width = opts.width;
  if (opts.height !== undefined) settings.height = opts.height;
  if (opts.background !== undefined) settings.background = parseColor(opts.background);
  if (!(settings.fps > 0 && settings.fps <= 240)) throw new RenderError('--fps is between 0 and 240.');
  if (!(settings.width >= 1 && settings.height >= 1 && settings.width <= 16384 && settings.height <= 16384)) throw new RenderError('--width and --height are 1 to 16384 pixels.');

  const out = opts.out;
  const isDir = !!opts.outIsDir;
  const format = renderFormat(out, isDir, opts.format);
  const single = picked.length * skins.length === 1;
  const dir = isDir ? out.replace(/[\\/]+$/, '') || out : dirOf(out);
  const stem = isDir ? null : baseOf(out).replace(/\.[^.]*$/, '');
  const docBase = safeName(info.name || 'render');
  const jobs = [];
  for (const anim of picked) {
    for (const skin of skins) {
      const skinPart = skins.length > 1 || skin ? [safeName(skin || 'default')] : [];
      let name;
      if (stem === null) name = [docBase, safeName(anim), ...skinPart].join('_');
      else if (/\{(animation|skin)\}/.test(stem)) name = stem.replace(/\{animation\}/g, safeName(anim)).replace(/\{skin\}/g, safeName(skin || 'default'));
      else name = single ? stem : [stem, safeName(anim), ...skinPart].join('_');
      jobs.push({
        animation: anims.indexOf(anim),
        animationName: anim,
        skin,
        settings: { ...settings },
        format,
        quality: opts.quality ?? 'high',
        name,
        dir,
        start: single ? (opts.start ?? null) : null,
        end: single ? (opts.end ?? null) : null,
      });
    }
  }
  const names = new Set(jobs.map((j) => j.name));
  if (names.size < jobs.length) throw new RenderError('Several renders would get the same file name: use {animation} and {skin} in --out, or a folder.');
  return jobs;
}

/** The file that stands for a job's output (the first frame of a PNG sequence), from its frame range. */
export function jobTarget(job, range) {
  if (job.format === 'png') return joinPath(job.dir, `${job.name}_${String(range.start).padStart(Math.max(4, String(range.end).length), '0')}.png`);
  return joinPath(job.dir, `${job.name}.${job.format}`);
}
