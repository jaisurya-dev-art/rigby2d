// SPDX-License-Identifier: MIT OR Apache-2.0
// File ▸ Export ▸ Sprite sheet: renders animations into a packed sheet with its data (or loose
// frames) for engines and tools that play frames. The work happens in a worker
// (spritesheetworker.js) with the software renderer, so sheets match the MCP server's.

import { track } from './analytics.js';
import { dirname, joinPath } from './io.js';
import * as platform from './platform.js';
import { FORMATS, frameCount } from './spritesheet.js';
import { h, select } from './widgets.js';

const LAYOUTS = [
  ['packed', 'Packed (smallest sheet)'],
  ['grid', 'Grid (equal cells)'],
];
const SCALES = [
  [0.25, '25%'],
  [0.5, '50%'],
  [0.75, '75%'],
  [1, '100%'],
  [2, '200%'],
];
const FPS = [8, 10, 12, 15, 24, 30, 60];
const SIZES = [
  [2048, '2048 px'],
  [4096, '4096 px'],
  [8192, '8192 px'],
];

/** File-name-safe text. */
const safe = (s) => s.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'sprites';

/** Remembered choices for the next time the dialog opens. */
let last = { format: 'json', layout: 'packed', scale: 0.5, fps: 30, padding: 2, trim: true, dedupe: true, loop: true, maxWidth: 4096 };

/** Opens the sprite sheet dialog. */
export function openSpriteSheetDialog(app) {
  const doc = app.doc;
  if (doc.scene) return app.setStatus('Sprite sheets are made from a character: open the character, not the scene');
  if (!doc.animations.length) return app.setStatus('Nothing to export: create an animation first');
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
      h('h3', null, 'Export sprite sheet'),
      h('div', { class: 'small weak' }, 'Each animation rendered frame by frame, for engines and tools that play frames instead of bones. Physics settles into loops first, so a loop joins up.'),
      h(
        'div',
        { class: 'modal-columns' },
        h(
          'div',
          null,
          h('strong', null, 'Animations'),
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
                  h('a', { href: '#', onclick: (e) => (e.preventDefault(), doc.animations.forEach((a) => choice.animations.add(a.name)), draw()) }, 'All animations'),
                  ' · ',
                  h('a', { href: '#', onclick: (e) => (e.preventDefault(), choice.animations.clear(), draw()) }, 'None'),
                )
              : null,
          ),
        ),
        h(
          'div',
          { class: 'grid' },
          h('label', null, 'Format'),
          h('div', { class: 'cell' }, select(FORMATS, choice.format, set('format'))),
          h('label', null, 'Frame rate'),
          h('div', { class: 'cell' }, select(FPS.map((f) => [f, `${f} fps`]), choice.fps, (v) => set('fps')(Number(v)))),
          h('label', null, 'Size'),
          h('div', { class: 'cell' }, select(SCALES, choice.scale, (v) => set('scale')(Number(v)))),
          doc.skins.length ? h('label', null, 'Skin') : null,
          doc.skins.length ? h('div', { class: 'cell' }, select([['', 'default'], ...doc.skins.map((k) => [k.name, k.name])], choice.skin, set('skin'))) : null,
          sheet ? h('label', null, 'Layout') : null,
          sheet ? h('div', { class: 'cell' }, select(LAYOUTS, choice.layout, set('layout'))) : null,
          sheet ? h('label', null, 'Max width') : null,
          sheet ? h('div', { class: 'cell' }, select(SIZES, choice.maxWidth, (v) => set('maxWidth')(Number(v)))) : null,
          sheet ? h('label', null, 'Padding') : null,
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
      h('div', { class: 'checks' }, check('loop', 'Loops (leave out the last frame, which repeats the first)'), sheet ? check('trim', 'Trim empty space around each frame') : null, sheet ? check('dedupe', 'Store identical frames once') : null),
      pixelArt ? h('div', { class: 'small weak' }, 'Pixel art: textures are set to Nearest, so frames are sampled crisp, without smoothing.') : null,
      choice.format === 'defold' ? h('div', { class: 'small weak' }, `Put the ${choice.name} folder and ${choice.name}.atlas at the root of your Defold project (the atlas lists the frames as /${choice.name}/…), or edit the paths in the atlas.`) : null,
      h('div', { class: 'small' }, names.length ? `${names.length} animation${names.length === 1 ? '' : 's'}, ${frames} frame${frames === 1 ? '' : 's'}.` : 'Pick at least one animation.'),
      running ? h('div', { class: 'progress' }, h('div', { class: 'bar', style: { width: `${Math.round(running.fraction * 100)}%` } })) : null,
      running ? h('div', { class: 'small' }, running.text) : null,
      h('div', { class: 'modal-buttons' }, h('button', { onclick: close }, running ? 'Cancel' : 'Close'), h('button', { class: 'primary', disabled: !names.length || !!running, onclick: () => start().catch(fail) }, 'Export…')),
    ];
    body.replaceChildren(...parts.filter(Boolean));
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
    app.setStatus(`Sprite sheet export failed: ${e?.message ?? e}`);
  }

  async function start() {
    const first = choice.format === 'json' ? `${choice.name}.png` : choice.format === 'defold' ? `${choice.name}.atlas` : `${choice.name}_frames.png`;
    const ext = first.split('.').pop();
    let target;
    try {
      // In the browser a sheet (often hundreds of frames) downloads as one zip.
      target = await platform.pickSaveTarget(first, ext === 'atlas' ? 'Defold atlas' : 'PNG image', ext, { download: true });
    } catch (e) {
      app.setStatus(`Sprite sheet export failed: ${e.message ?? e}`);
      return;
    }
    if (!target) return;
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
    running = { worker, fraction: 0, text: 'Starting…' };
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
        app.setStatus(`Sprite sheet export failed: ${m.error}`);
        return;
      }
      if (!m.done) {
        running.fraction = m.progress;
        running.text = m.text;
        draw();
        return;
      }
      worker.terminate();
      try {
        for (const f of m.files) await target.fs.writeFile(pathFor(f.path), f.bytes);
        await target.fs.finish();
        running = null;
        track('editor-export-spritesheet');
        const s = m.summary;
        const what = choice.format === 'json' ? `a ${s.width}×${s.height} sheet of ${s.frames} frames (${s.unique} unique)` : `${s.frames} frames of ${s.width}×${s.height}`;
        const tall = choice.format === 'json' && s.height > choice.maxWidth ? ` It is ${s.height} px tall: some GPUs stop at 4096 or 8192, so lower the size or export fewer animations per sheet.` : '';
        const where = platform.isDesktop ? (dir === '.' ? target.path : dir) : `${base}${choice.format === 'frames' ? '_frames' : ''}.zip (downloaded)`;
        app.setStatus(`Exported ${what} to ${where}.${tall}`);
        close();
      } catch (err) {
        running = null;
        draw();
        app.setStatus(`Sprite sheet export failed: ${err.message ?? err}`);
      }
    };
    worker.postMessage({ snapshot, images, options }, images.map((i) => i.data));
  }

  draw();
  document.body.append(overlay);
}
