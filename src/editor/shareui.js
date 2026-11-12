// SPDX-License-Identifier: MIT OR Apache-2.0
// Share to Discord: renders the current animation as a GIF or MP4, saves it, and opens the
// community's #showcase forum, ready for the file.

import { track } from './analytics.js';
import { t } from './i18n.js';
import { COMMUNITY_URL } from './news.js';
import { hexToRgba } from './output.js';
import * as platform from './platform.js';
import { canEncodeVideo, frameRange, renderGif, renderJob } from './render/offline.js';
import { RATES, SHARE_BACKGROUND, SIZES, shareSettings, shareTitle, submitUrl } from './share.js';
import { h, select } from './widgets.js';
import { button, checkbox, dialog, fieldRow, fields, hint } from './ui.js';

const safe = (s) => s.replace(/[\\/:*?"<>|\s]+/g, '_').replace(/^_+|_+$/g, '') || 'rigby2d';
const toHex = (c) => `#${c.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`;
// Longer videos work too, but a short loop is what people watch.
const MAX_SECONDS = 20;

/** Remembered choices for the next share. */
let last = { format: 'gif', size: 480, fps: 25 };

export function openShareDialog(app) {
  const doc = app.doc;
  if (!doc.animations.length) {
    app.setStatus(t('Nothing to share yet: make an animation first'));
    return;
  }
  const s = doc.settings;
  const choice = {
    animation: app.anim ?? 0,
    format: last.format === 'mp4' && !canEncodeVideo() ? 'gif' : last.format,
    size: last.size,
    fps: Math.min(last.fps, s.fps),
    background: toHex(s.background ?? SHARE_BACKGROUND),
    transparent: false,
    fit: true,
    title: '',
  };
  let running = null;
  let done = null;

  // Closing while rendering cancels the render.
  const { body, close, setFooter } = dialog({
    title: t('Share to Discord'),
    subtitle: t('Render a clip, then post it to the community.'),
    className: 'share-dialog',
    closeOnBackdrop: false,
    onClose: () => {
      if (running) running.cancelled = true;
    },
  });

  const anim = () => doc.animations[choice.animation];
  const title = () => choice.title || shareTitle(doc.name, anim().name);
  const settings = () => shareSettings(s, { size: choice.size, fps: choice.fps, fit: choice.fit, background: choice.format === 'gif' && choice.transparent ? null : hexToRgba(choice.background) });
  const range = () => {
    const r = frameRange(doc, choice.animation, choice.fps);
    return { ...r, end: Math.min(r.end, Math.round(MAX_SECONDS * choice.fps)) };
  };

  function draw() {
    const out = settings();
    const r = range();
    const seconds = (r.end - r.start + 1) / choice.fps;
    const row = fieldRow;
    const parts = [];
    if (done) {
      parts.push(
        h(
          'ol',
          { class: 'share-steps' },
          h('li', null, t('Saved {file}', { file: done.path })),
          h('li', null, t('#showcase is open in Discord: start a post and drop the file in.')),
          h('li', null, t('Pick the Showcase flair, then post.')),
        ),
      );
      body.replaceChildren(...parts);
      setFooter([
        button(t('Open the Discord'), { kind: 'ghost', icon: 'external-link', onclick: () => platform.openExternal(COMMUNITY_URL) }),
        button(t('Open #showcase again'), { icon: 'external-link', onclick: () => platform.openExternal(submitUrl(title())) }),
        button(t('Close'), { kind: 'primary', onclick: () => close() }),
      ]);
      return;
    }
    parts.push(
      fields(
        ...row(
          t('Animation'),
          select(
            doc.animations.map((a, i) => [String(i), a.name]),
            String(choice.animation),
            (v) => ((choice.animation = Number(v)), draw()),
          ),
        ),
        ...row(
          t('Format'),
          select(
            [
              ['gif', t('GIF (plays everywhere)')],
              ['mp4', canEncodeVideo() ? t('MP4 video (sharper, smaller)') : t('MP4 video (not available here)')],
            ],
            choice.format,
            (v) => ((choice.format = v === 'mp4' && !canEncodeVideo() ? 'gif' : v), draw()),
          ),
        ),
        ...row(
          t('Size'),
          select(
            SIZES.map((n) => [String(n), `${n} px`]),
            String(choice.size),
            (v) => ((choice.size = Number(v)), draw()),
          ),
          h('span', { class: 'ui-field-label' }, `${out.width}×${out.height}`),
        ),
        ...(s.frame
          ? row(
              t('Framing'),
              select(
                [
                  ['fit', t('Fit the animation')],
                  ['project', t("The project's framing")],
                ],
                choice.fit ? 'fit' : 'project',
                (v) => ((choice.fit = v === 'fit'), draw()),
              ),
            )
          : []),
        ...row(
          t('Frame rate'),
          select(
            RATES.filter((n) => n <= s.fps).map((n) => [String(n), `${n} fps`]),
            String(choice.fps),
            (v) => ((choice.fps = Number(v)), draw()),
          ),
        ),
        ...row(
          t('Background'),
          h('input', { type: 'color', value: choice.background, disabled: choice.format === 'gif' && choice.transparent, oninput: (e) => (choice.background = e.target.value) }),
          choice.format === 'gif' ? checkbox(t('Transparent'), choice.transparent, (on) => ((choice.transparent = on), draw())) : null,
        ),
        ...row(t('Post title'), h('input', { type: 'text', class: 'share-title', value: title(), maxlength: 300, oninput: (e) => (choice.title = e.target.value) })),
      ),
      hint(t('{seconds} s, {frames} frames.', { seconds: seconds.toFixed(1), frames: r.end - r.start + 1 }) + (r.end < r.last ? ` ${t('Longer animations are cut at {max} seconds.', { max: MAX_SECONDS })}` : '')),
      running ? h('div', { class: 'progress' }, h('div', { class: 'bar', style: { width: `${Math.round(running.fraction * 100)}%` } })) : null,
      running ? hint(running.text) : null,
    );
    body.replaceChildren(...parts.filter(Boolean));
    setFooter([
      button(running ? t('Cancel') : t('Close'), { onclick: () => (running ? (running.cancelled = true) : close()) }),
      button(t('Render and share…'), { kind: 'primary', disabled: !!running, onclick: start }),
    ]);
  }

  async function start() {
    const ext = choice.format;
    const name = safe(`${doc.name || 'rigby2d'}_${anim().name}`);
    let target;
    try {
      target = await platform.pickSaveTarget(`${name}.${ext}`, ext === 'gif' ? 'GIF image' : 'MP4 video', ext, { single: true });
    } catch (e) {
      app.setStatus(t('Could not share: {error}', { error: e.message ?? e }));
      return;
    }
    if (!target) return;
    last = { format: choice.format, size: choice.size, fps: choice.fps };
    const r = range();
    const job = { animation: choice.animation, skin: doc.skin ?? null, settings: settings(), format: ext, quality: 'high', name, start: r.start, end: r.end };
    running = { cancelled: false, fraction: 0, text: t('Starting…') };
    draw();
    try {
      const progress = (n, count) => {
        running.fraction = n / count;
        running.text = t('Frame {n} of {count}', { n, count });
        draw();
        return !running.cancelled;
      };
      const file = ext === 'gif' ? await renderGif(doc, app.images, job, progress) : (await renderJob(doc, app.images, job, progress))?.[0];
      if (!file) {
        running = null;
        draw();
        return;
      }
      await target.fs.writeFile(target.path, file.bytes);
      await target.fs.finish();
      running = null;
      done = { path: target.path };
      track('editor-share-reddit');
      await platform.openExternal(submitUrl(title()));
      app.setStatus(t('Saved {file}: drop it into #showcase on Discord', { file: target.path }));
    } catch (e) {
      running = null;
      app.setStatus(t('Could not share: {error}', { error: e.message ?? e }));
    }
    draw();
  }

  draw();
}
