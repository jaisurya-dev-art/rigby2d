// SPDX-License-Identifier: MIT OR Apache-2.0
// File ▸ Export ▸ Sprite sheet: renders animations into a packed sheet with its data (or loose
// frames) for engines and tools that play frames. The work happens in a worker
// (spritesheetworker.js) with the software renderer, so sheets match the MCP server's.

import { track } from './analytics.js';
import { dirname, joinPath } from './io.js';
import * as platform from './platform.js';
import { FORMATS, estimateSheet, frameCount } from './spritesheet.js';
import { h, select } from './widgets.js';
import { pausePlayback, showResult } from './resultui.js';
import { t, tn } from './i18n.js';

const LAYOUTS = [
  ['packed', tn('Packed (smallest sheet)')],
  ['grid', tn('Grid (equal cells)')],
];
const SCALES = [
  [0.25, '25%'],
  [0.5, '50%'],
  [0.75, '75%'],
  [1, '100%'],
  [2, '200%'],
];
const FPS = [8, 10, 12, 15, 24, 30, 60];
// Each sheet's largest side. 2048 loads on every phone; desktop GPUs take 16384.
const SIZES = [
  [2048, '2048 px (mobile)'],
  [4096, '4096 px'],
  [8192, '8192 px'],
  [16384, '16384 px (desktop)'],
];

/** File-name-safe text. */
const safe = (s) => s.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'sprites';

/** Remembered choices for the next time the dialog opens. */
let last = { format: 'json', layout: 'packed', scale: 0.5, fps: 30, padding: 2, trim: true, dedupe: true, loop: true, maxWidth: 4096, pot: false };

/** Opens the sprite sheet dialog. */
export function openSpriteSheetDialog(app) {
  const doc = app.doc;
  if (doc.scene) return app.setStatus(t('Sprite sheets are made from a character: open the character, not the scene'));
  if (!doc.animations.length) return app.setStatus(t('Nothing to export: create an animation first'));
  const choice = { ...last, animations: new Set(doc.animations.map((a) => a.name)), skin: doc.skin ?? '', name: safe(doc.name || 'sprites') };
  let running = null;

  const overlay = h('div', { class: 'modal-backdrop' });
  const body = h('div', { class: 'modal' });
  overlay.append(body);
  const close = () => {
    running?.worker.terminate();
    running = null;
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);

  const set = (key) => (v) => {
    choice[key] = v;
    draw();
  };
  const check = (key, text) =>
    h(
      'label',
      { class: 'small' },
      h('input', {
        type: 'checkbox',
        checked: choice[key],
        onchange: (e) => set(key)(e.target.checked),
      }),
      ` ${text}`,
    );

  function draw() {
    const names = doc.animations.filter((a) => choice.animations.has(a.name));
    const frames = names.reduce((n, a) => n + frameCount(a.duration, choice.fps, choice.loop), 0);
    const sheet = choice.format === 'json';
    const pixelArt = doc.textureFilter === 'nearest';
    const parts = [
      h('h3', null, t('Export sprite sheet')),
      h('div', { class: 'small weak' }, t('Each animation rendered frame by frame, for engines and tools that play frames instead of bones. Physics settles into loops first, so a loop joins up.')),
      h(
        'div',
        { class: 'modal-columns' },
        h(
          'div',
          null,
          h('strong', null, t('Animations')),
          h(
            'div',
            { class: 'checklist' },
            doc.animations.map((a) =>
              h(
                'label',
                null,
                h('input', {
                  type: 'checkbox',
                  checked: choice.animations.has(a.name),
                  onchange: (e) => {
                    if (e.target.checked) choice.animations.add(a.name);
                    else choice.animations.delete(a.name);
                    draw();
                  },
                }),
                ` ${a.name}`,
              ),
            ),
            doc.animations.length > 1
              ? h(
                  'div',
                  { class: 'small' },
                  h('a', { href: '#', onclick: (e) => (e.preventDefault(), doc.animations.forEach((a) => choice.animations.add(a.name)), draw()) }, t('All animations')),
                  ' · ',
                  h('a', { href: '#', onclick: (e) => (e.preventDefault(), choice.animations.clear(), draw()) }, t('None')),
                )
              : null,
          ),
        ),
        h(
          'div',
          { class: 'grid' },
          h('label', null, t('Format')),
          h('div', { class: 'cell' }, select(FORMATS.map(([id, label]) => [id, t(label)]), choice.format, set('format'))),
          h('label', null, t('Frame rate')),
          h('div', { class: 'cell' }, select(FPS.map((f) => [f, `${f} fps`]), choice.fps, (v) => set('fps')(Number(v)))),
          h('label', null, t('Size')),
          h('div', { class: 'cell' }, select(SCALES, choice.scale, (v) => set('scale')(Number(v)))),
          doc.skins.length ? h('label', null, t('Skin')) : null,
          doc.skins.length ? h('div', { class: 'cell' }, select([['', 'default'], ...doc.skins.map((k) => [k.name, k.name])], choice.skin, set('skin'))) : null,
          sheet ? h('label', null, t('Layout')) : null,
          sheet ? h('div', { class: 'cell' }, select(LAYOUTS.map(([id, label]) => [id, t(label)]), choice.layout, set('layout'))) : null,
          sheet ? h('label', { title: t('The largest side of each sheet. Frames that do not fit go on more sheets.') }, t('Max sheet size')) : null,
          sheet ? h('div', { class: 'cell' }, select(SIZES, choice.maxWidth, (v) => set('maxWidth')(Number(v)))) : null,
          sheet ? h('label', null, t('Padding')) : null,
          sheet
            ? h(
                'div',
                { class: 'cell' },
                h('input', {
                  type: 'number',
                  class: 'frame-input',
                  min: 0,
                  max: 32,
                  value: choice.padding,
                  onkeydown: (e) => e.stopPropagation(),
                  onchange: (e) => set('padding')(Math.max(0, Math.min(32, Math.round(Number(e.target.value) || 0)))),
                }),
                h('span', { class: 'small weak' }, ' px'),
              )
            : null,
        ),
      ),
      h('div', { class: 'checks' }, check('loop', t('Loops (leave out the last frame, which repeats the first)')), sheet ? check('trim', t('Trim empty space around each frame')) : null, sheet ? check('dedupe', t('Store identical frames once')) : null, sheet ? check('pot', t('Power-of-two sheet sizes (for engines and GPUs that need them)')) : null),
      pixelArt ? h('div', { class: 'small weak' }, t('Pixel art: textures are set to Nearest, so frames are sampled crisp, without smoothing.')) : null,
      choice.format === 'defold' ? h('div', { class: 'small weak' }, t('Put the {name} folder and {name}.atlas at the root of your Defold project (the atlas lists the frames as /{name}/…), or edit the paths in the atlas.', { name: choice.name })) : null,
      h('div', { class: 'small' }, names.length ? t('{animations} animation(s), {frames} frame(s).', { animations: names.length, frames }) : t('Pick at least one animation.')),
      names.length ? estimateLine(names) : null,
      running ? h('div', { class: 'progress' }, h('div', { class: 'bar', style: { width: `${Math.round(running.fraction * 100)}%` } })) : null,
      running ? h('div', { class: 'small' }, running.text) : null,
      h('div', { class: 'modal-buttons' }, h('button', { onclick: close }, running ? t('Cancel') : t('Close')), h('button', { class: 'primary', disabled: !names.length || !!running, onclick: () => start().catch(fail) }, t('Export…'))),
    ];
    body.replaceChildren(...parts.filter(Boolean));
  }

  /**
   * What the export will make, worked out from the poses before anything is drawn: frame size, and
   * for a sheet how many sheets at most (trimming and dedupe only shrink it), with a one-click size
   * that fits on one sheet when there is one.
   */
  let estimated = { key: '', value: null };
  function estimateLine(names) {
    const key = JSON.stringify([names.map((a) => a.name), choice.fps, choice.loop, choice.scale, choice.skin, choice.maxWidth, choice.layout, choice.padding, choice.pot, doc.version ?? app.version]);
    if (estimated.key !== key) {
      const previousSkin = doc.skin;
      doc.skin = choice.skin || null;
      try {
        estimated = { key, value: estimateSheet(doc, names.map((a) => a.name), { ...choice }, SCALES.map(([v]) => v)) };
      } catch {
        estimated = { key, value: null };
      } finally {
        doc.skin = previousSkin;
      }
    }
    const e = estimated.value;
    if (!e) return h('div', { class: 'small weak' }, t('Nothing is drawn in these animations.'));
    const px = (w, hh) => `${w}×${hh} px`;
    if (e.tooBig) return h('div', { class: 'small warn' }, t('Each frame would be {size}, larger than one image can be. Lower the size.', { size: px(e.frameWidth, e.frameHeight) }));
    if (choice.format !== 'json') return h('div', { class: 'small weak' }, t('{count} PNG files of {size}.', { count: e.frames, size: px(e.frameWidth, e.frameHeight) }));
    const text =
      e.sheets === 1
        ? t('Frames of {size}: one sheet of at most {max}.', { size: px(e.frameWidth, e.frameHeight), max: px(e.width, e.height) })
        : t("Frames of {size}: up to {count} sheets of at most {max}, fewer after trimming. Phaser loads them with load.multiatlas, PixiJS through the first sheet's JSON.", { size: px(e.frameWidth, e.frameHeight), count: e.sheets, max: px(e.width, e.height) });
    const fit = e.sheets > 1 && e.fitsOne && e.fitsOne !== choice.scale ? e.fitsOne : null;
    return h(
      'div',
      { class: e.sheets > 1 ? 'small warn' : 'small weak' },
      text,
      fit ? h('span', null, ' ', h('a', { href: '#', onclick: (ev) => (ev.preventDefault(), set('scale')(fit)) }, t('Use {scale} for one sheet', { scale: SCALES.find(([v]) => v === fit)[1] }))) : null,
    );
  }

  /** The project's images as RGBA, for the worker. */
  function imageData() {
    const out = [];
    for (const [name, { canvas }] of app.images.map) {
      if (!canvas?.width || !canvas.height) continue;
      const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      out.push({ name, width: canvas.width, height: canvas.height, data: data.buffer });
    }
    return out;
  }

  /** Reports a failed export and lets the dialog be used again. */
  function fail(e) {
    running?.worker?.terminate();
    running = null;
    if (overlay.isConnected) draw();
    showResult(app, { ok: false, title: t('Sprite sheet export failed'), detail: String(e?.message ?? e) });
  }

  async function start() {
    const first = choice.format === 'json' ? `${choice.name}.png` : choice.format === 'defold' ? `${choice.name}.atlas` : `${choice.name}_frames.png`;
    const ext = first.split('.').pop();
    let target;
    try {
      // In the browser a sheet (often hundreds of frames) downloads as one zip.
      target = await platform.pickSaveTarget(first, ext === 'atlas' ? t('Defold atlas') : t('PNG image'), ext, { download: true });
    } catch (e) {
      showResult(app, { ok: false, title: t('Sprite sheet export failed'), detail: String(e?.message ?? e) });
      return;
    }
    if (!target) return;
    pausePlayback(app);
    last = { ...choice, animations: undefined, skin: undefined, name: undefined };
    const dir = dirname(target.path);
    const base = target.path.split(/[\\/]/).pop().replace(/(_frames)?\.[^.]+$/, '') || choice.name;
    const pathFor = (name) => (dir === '.' ? name : joinPath(dir, name));
    const previousSkin = doc.skin;
    doc.skin = choice.skin || null;
    const snapshot = doc.toSnapshot();
    doc.skin = previousSkin;
    const images = imageData();
    const worker = new Worker(new URL('./spritesheetworker.js', import.meta.url), { type: 'module' });
    worker.onerror = (e) => {
      e.preventDefault?.();
      fail(e.message || 'the sprite sheet worker could not start');
    };
    running = { worker, fraction: 0, text: t('Starting…') };
    draw();
    const options = {
      name: base,
      format: choice.format,
      animations: [...choice.animations],
      fps: choice.fps,
      scale: choice.scale,
      layout: choice.layout,
      padding: choice.padding,
      trim: choice.trim,
      dedupe: choice.dedupe,
      loop: choice.loop,
      maxWidth: choice.maxWidth,
      pot: choice.pot,
      defoldFolder: base,
      version: doc.format ? String(doc.format) : '',
    };
    worker.onmessage = async (e) => {
      const m = e.data;
      if (!running) return;
      if (m.error) {
        worker.terminate();
        running = null;
        draw();
        showResult(app, { ok: false, title: t('Sprite sheet export failed'), detail: m.error });
        return;
      }
      if (!m.done) {
        running.fraction = m.progress;
        running.text = t(m.text, m.vars); // worker texts: tn('Frame {done} of {total}'), tn('Encoding PNG {done} of {total}')
        draw();
        return;
      }
      worker.terminate();
      try {
        // Frames go in a folder (`name/frame.png`): on disk it must exist before the first write.
        const folders = new Set(m.files.filter((f) => f.path.includes('/')).map((f) => pathFor(f.path.slice(0, f.path.lastIndexOf('/')))));
        for (const folder of folders) await target.fs.mkdir?.(folder);
        for (const f of m.files) await target.fs.writeFile(pathFor(f.path), f.bytes);
        await target.fs.finish();
        running = null;
        track('editor-export-spritesheet');
        const s = m.summary;
        const what = choice.format !== 'json' ? t('{count} frames of {size}', { count: s.frames, size: `${s.width}×${s.height}` }) : s.sheets > 1 ? t('{sheets} sheets of up to {size} with {count} frames ({unique} unique)', { sheets: s.sheets, size: `${s.width}×${s.height}`, count: s.frames, unique: s.unique }) : t('a {size} sheet of {count} frames ({unique} unique)', { size: `${s.width}×${s.height}`, count: s.frames, unique: s.unique });
        const where = platform.isDesktop ? (dir === '.' ? target.path : dir) : t('{file} (downloaded)', { file: `${base}${choice.format === 'frames' ? '_frames' : ''}.zip` });
        close();
        const how = m.gpu ? t(' Drawn on the GPU.') : m.gpuIssue ? t(' Drawn on the CPU ({reason}).', { reason: m.gpuIssue }) : '';
        showResult(app, { ok: true, title: t('Sprite sheet exported'), detail: `${what[0].toUpperCase()}${what.slice(1)}.${how}`, path: where });
      } catch (err) {
        running = null;
        draw();
        showResult(app, { ok: false, title: t('Sprite sheet export failed'), detail: String(err?.message ?? err) });
      }
    };
    worker.postMessage({ snapshot, images, options }, images.map((i) => i.data));
  }

  draw();
  document.body.append(overlay);
}
