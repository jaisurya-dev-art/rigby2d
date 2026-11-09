// SPDX-License-Identifier: MIT OR Apache-2.0
// Render dialog: renders one or many animations (and skins) to PNG sequences, WebM or MP4 at the
// project's output settings, with progress and cancel.

import { track } from './analytics.js';
import { dirname, joinPath } from './io.js';
import { describeOutput } from './output.js';
import * as platform from './platform.js';
import { FORMATS, canEncodeVideo, frameRange, renderJob, renderMerged } from './render/offline.js';
import { h, select } from './widgets.js';
import { pausePlayback, showResult } from './resultui.js';
import { mixWav } from './audio.js';
import { clipTracks } from './actors.js';
import { t, tn } from './i18n.js';

const QUALITIES = [
  ['high', tn('High')],
  ['medium', tn('Medium')],
  ['low', tn('Low')],
];

/** File-name-safe text. */
const safe = (s) => s.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'render';

/** Remembered choices for the next time the dialog opens. */
let last = { format: 'png', quality: 'high', merge: false };

/** Opens the render dialog. */
export function openRenderDialog(app) {
  const doc = app.doc;
  if (!doc.animations.length) {
    app.setStatus(t('Nothing to render: create an animation first'));
    return;
  }
  const s = doc.settings;
  const choice = {
    animations: new Set([app.anim ?? 0]),
    skins: new Set([doc.skin ?? '']),
    format: last.format === 'png' || canEncodeVideo() ? last.format : 'png',
    quality: last.quality,
    merge: last.merge,
    start: null,
    end: null,
  };
  let running = null;

  const overlay = h('div', { class: 'modal-backdrop' });
  const body = h('div', { class: 'modal' });
  overlay.append(body);
  const close = () => {
    if (running) running.cancelled = true;
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const onKey = (e) => {
    if (e.key === 'Escape' && !running) {
      e.stopPropagation();
      close();
    }
  };
  document.addEventListener('keydown', onKey, true);

  const checkList = (items, set, label) =>
    h(
      'div',
      { class: 'checklist' },
      items.map(([value, text]) =>
        h(
          'label',
          null,
          h('input', {
            type: 'checkbox',
            checked: set.has(value),
            onchange: (e) => {
              if (e.target.checked) set.add(value);
              else set.delete(value);
              draw();
            },
          }),
          ` ${text}`,
        ),
      ),
      items.length > 1
        ? h(
            'div',
            { class: 'small' },
            h('a', { href: '#', onclick: (e) => (e.preventDefault(), items.forEach(([v]) => set.add(v)), draw()) }, t('All {items}', { items: label })),
            ' · ',
            h('a', { href: '#', onclick: (e) => (e.preventDefault(), set.clear(), draw()) }, t('None')),
          )
        : null,
    );

  function jobs() {
    const anims = [...choice.animations].sort((a, b) => a - b);
    const skins = [...choice.skins];
    const base = safe(doc.name || 'render');
    const out = [];
    for (const animation of anims) {
      for (const skin of skins) {
        const name = [base, safe(doc.animations[animation].name), ...(skins.length > 1 || skin ? [safe(skin || 'default')] : [])].join('_');
        const single = anims.length === 1 && skins.length === 1;
        out.push({ animation, skin: skin || null, settings: { ...s }, format: choice.format, quality: choice.quality, name, start: single ? choice.start : null, end: single ? choice.end : null });
      }
    }
    return out;
  }

  function draw() {
    const list = jobs();
    const frames = list.reduce((n, j) => n + frameRange(doc, j.animation, s.fps, j.start, j.end).count, 0);
    const single = list.length === 1 ? list[0] : null;
    const range = single ? frameRange(doc, single.animation, s.fps, single.start, single.end) : null;
    const video = choice.format !== 'png';
    const parts = [
      h('h3', null, t('Render animation')),
      h('div', { class: 'small weak' }, `${describeOutput(s)} · ${s.background ? t('background color') : t('transparent background')} · ${s.frame ? t('fixed framing') : t('framing fits each animation')}. ${t("Change these in the project's Output settings.")}`),
      h('div', { class: 'modal-columns' }, h('div', null, h('strong', null, t('Animations')), checkList(doc.animations.map((a, i) => [i, a.name]), choice.animations, 'animations')), doc.skins.length ? h('div', null, h('strong', null, t('Skins')), checkList([['', 'default'], ...doc.skins.map((k) => [k.name, k.name])], choice.skins, 'skins')) : null),
      h(
        'div',
        { class: 'grid' },
        h('label', null, t('Format')),
        h(
          'div',
          { class: 'cell' },
          select(
            FORMATS.map(([v, label]) => [v, v !== 'png' && !canEncodeVideo() ? t('{format} (not available here)', { format: t(label) }) : t(label)]),
            choice.format,
            (v) => {
              choice.format = v;
              draw();
            },
          ),
        ),
        video ? h('label', null, t('Quality')) : null,
        video
          ? h(
              'div',
              { class: 'cell' },
              select(QUALITIES.map(([id, label]) => [id, t(label)]), choice.quality, (v) => {
                choice.quality = v;
                draw();
              }),
            )
          : null,
        single ? h('label', null, t('Frames')) : null,
        single
          ? h(
              'div',
              { class: 'cell' },
              numberInput(range.start, 0, range.last, (v) => ((choice.start = v), draw())),
              ' to ',
              numberInput(range.end, 0, range.last, (v) => ((choice.end = v), draw())),
              h('span', { class: 'small weak' }, ` of 0–${range.last}`),
            )
          : null,
      ),
      video && list.length > 1
        ? h(
            'label',
            { class: 'small' },
            h('input', {
              type: 'checkbox',
              checked: choice.merge,
              onchange: (e) => {
                choice.merge = e.target.checked;
                draw();
              },
            }),
            ' ' + t('Merge into one video (the {count} renders back to back)', { count: list.length }),
          )
        : null,
      choice.format === 'mp4' && !s.background ? h('div', { class: 'small weak' }, t('MP4 has no transparency: the background is black. Pick a background color in Output, or render WebM or PNG for transparency.')) : null,
      h('div', { class: 'small' }, list.length ? (merged(list) ? t('1 video') : t('{count} render(s)', { count: list.length })) + ', ' + t('{count} frame(s) in all.', { count: frames }) : t('Pick at least one animation and skin.')),
      running ? h('div', { class: 'progress' }, h('div', { class: 'bar', style: { width: `${Math.round(running.fraction * 100)}%` } })) : null,
      running ? h('div', { class: 'small' }, running.text) : null,
      h('div', { class: 'modal-buttons' }, h('button', { onclick: close }, running ? t('Cancel') : t('Close')), h('button', { class: 'primary', disabled: !list.length || !!running, onclick: () => start(list) }, t('Render…'))),
    ];
    body.replaceChildren(...parts.filter(Boolean));
  }

  /** Several video renders merged into one file. */
  const merged = (list) => choice.merge && choice.format !== 'png' && list.length > 1;

  async function start(list) {
    if (merged(list)) return startMerged(list);
    const first = list[0];
    const ext = first.format === 'png' ? 'png' : first.format;
    const label = { png: 'PNG image', webm: t('WebM video'), mp4: 'MP4 video' }[first.format];
    let target;
    try {
      target = await platform.pickSaveTarget(`${first.name}${first.format === 'png' ? '_0000' : ''}.${ext}`, label, ext, { single: list.length === 1 && first.format !== 'png' });
    } catch (e) {
      showResult(app, { ok: false, title: t('Render failed'), detail: String(e?.message ?? e) });
      return;
    }
    if (!target) return;
    pausePlayback(app);
    last = { format: first.format, quality: first.quality, merge: choice.merge };
    const dir = dirname(target.path);
    const pathFor = (name) => (dir === '.' ? name : joinPath(dir, name));
    const total = list.reduce((n, j) => n + frameRange(doc, j.animation, s.fps, j.start, j.end).count, 0);
    running = { cancelled: false, fraction: 0, text: t('Starting…') };
    draw();
    let done = 0;
    let written = 0;
    try {
      for (const [k, job] of list.entries()) {
        const base = done;
        const files = await renderJob(doc, app.images, job, (n, count) => {
          running.fraction = (base + n) / total;
          running.text = `${job.name}: frame ${n} of ${count} (render ${k + 1} of ${list.length})`;
          draw();
          return !running.cancelled;
        });
        if (!files) break;
        done += frameRange(doc, job.animation, s.fps, job.start, job.end).count;
        for (const f of files) {
          // A single file goes where it was saved; sequences and batches go next to it.
          const path = list.length === 1 && files.length === 1 ? target.path : pathFor(f.name);
          await target.fs.writeFile(path, f.bytes);
          written++;
        }
        // The animation's audio, mixed, for the editing software.
        const range = frameRange(doc, job.animation, s.fps, job.start, job.end);
        const wav = await mixWav(doc, doc.animations[job.animation].name, (range.last + 1) / s.fps, clipTracks(doc, doc.animations[job.animation].name));
        if (wav) {
          await target.fs.writeFile(pathFor(`${job.name}.wav`), wav);
          written++;
        }
      }
      await target.fs.finish();
      const cancelled = running.cancelled;
      running = null;
      if (!cancelled) track('editor-render');
      if (cancelled) {
        app.setStatus(t('Render cancelled after {count} file(s)', { count: written }));
        draw();
      } else {
        close();
        const where = list.length === 1 && written === 1 ? target.path : dir === '.' ? target.path : dir;
        showResult(app, { ok: true, title: 'Render complete', detail: `${written} file(s) written.`, path: platform.isDesktop || written === 1 ? where : null });
      }
    } catch (e) {
      running = null;
      draw();
      showResult(app, { ok: false, title: t('Render failed'), detail: String(e?.message ?? e) });
    }
  }

  /** One video of every job back to back, with the joined audio as a WAV next to it. */
  async function startMerged(list) {
    const first = list[0];
    const ext = first.format;
    const name = `${safe(doc.name || 'render')}_${list.length === doc.animations.length * Math.max(1, choice.skins.size) ? 'all' : `${list.length}_animations`}`;
    let target;
    try {
      target = await platform.pickSaveTarget(`${name}.${ext}`, { webm: t('WebM video'), mp4: 'MP4 video' }[ext], ext, { single: true });
    } catch (e) {
      showResult(app, { ok: false, title: t('Render failed'), detail: String(e?.message ?? e) });
      return;
    }
    if (!target) return;
    pausePlayback(app);
    last = { format: first.format, quality: first.quality, merge: true };
    const dir = dirname(target.path);
    running = { cancelled: false, fraction: 0, text: t('Starting…') };
    draw();
    try {
      const files = await renderMerged(doc, app.images, list, name, (n, count, k) => {
        running.fraction = n / count;
        running.text = `${doc.animations[list[k].animation].name}: frame ${n} of ${count} (animation ${k + 1} of ${list.length})`;
        draw();
        return !running.cancelled;
      });
      if (files) {
        for (const f of files) await target.fs.writeFile(f.name.endsWith('.wav') ? (dir === '.' ? f.name : joinPath(dir, f.name)) : target.path, f.bytes);
        await target.fs.finish();
      }
      running = null;
      if (files) track('editor-render-batch');
      if (files) {
        close();
        showResult(app, { ok: true, title: t('Render complete'), detail: `${list.length} animations in one video.`, path: target.path });
      } else {
        app.setStatus(t('Render cancelled'));
        draw();
      }
    } catch (e) {
      running = null;
      draw();
      showResult(app, { ok: false, title: t('Render failed'), detail: String(e?.message ?? e) });
    }
  }

  draw();
  document.body.append(overlay);
}

function numberInput(value, min, max, onChange) {
  return h('input', {
    type: 'number',
    class: 'frame-input',
    value,
    min,
    max,
    onkeydown: (e) => e.stopPropagation(),
    onchange: (e) => {
      const v = Math.round(Number(e.target.value));
      if (Number.isFinite(v)) onChange(Math.min(max, Math.max(min, v)));
    },
  });
}
