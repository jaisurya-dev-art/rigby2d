// SPDX-License-Identifier: MIT OR Apache-2.0
// The Lip-sync dialog (Film workspace, audio section): mouth shapes keyed from speech timing onto a
// mouth slot. Timing comes from Whisper listening to the track on this computer (whisper.js), a typed
// transcript (laid over the audio's loudness) or a timing file (ElevenLabs timestamps, Whisper or
// other word-timing JSON, Rhubarb Lip Sync, Papagayo). The work itself is in core/lipsync.js; this
// file is the UI.

import { VISEMES, VISEME_HINTS, keyLipSync, matchMouths, readTiming, timeTextByLoudness, tidy, visemeCues } from '../core/lipsync.js';
import { track as count } from './analytics.js';
import { FPS, Mode } from './app.js';
import { frameLevels, sounds, tracksOf } from './audio.js';
import * as platform from './platform.js';
import { transcribe } from './whisper.js';
import { h } from './widgets.js';
import { t, tn } from './i18n.js';

/** A modal dialog; returns { body, close }. Escape closes it. */
function modal() {
  const overlay = h('div', { class: 'modal-backdrop' });
  const body = h('div', { class: 'modal modal-wide lipsync' });
  overlay.append(body);
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  return { body, close };
}

const select = (options, value, onchange) =>
  h(
    'select',
    { onchange: (e) => onchange(e.target.value) },
    options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)),
  );

/** Languages Whisper is asked to hear (it understands about a hundred; these are the common ones). */
const LANGUAGES = [
  ['en', tn('English')],
  ['ta', tn('Tamil')],
  ['hi', tn('Hindi')],
  ['te', tn('Telugu')],
  ['ml', tn('Malayalam')],
  ['kn', tn('Kannada')],
  ['es', tn('Spanish')],
  ['fr', tn('French')],
  ['de', tn('German')],
  ['it', tn('Italian')],
  ['pt', tn('Portuguese')],
  ['ru', tn('Russian')],
  ['ja', tn('Japanese')],
  ['ko', tn('Korean')],
  ['zh', tn('Chinese')],
  ['ar', tn('Arabic')],
];

/** How many mouth shapes a slot's images cover, to pick the mouth slot by itself. */
const coverage = (slot) => Object.values(matchMouths(slot.attachments.map((a) => a.name))).filter(Boolean).length;

/** Opens the dialog for the current animation's audio. */
export function openLipSync(app) {
  const anim = app.currentAnimation();
  const tracks = anim ? tracksOf(app.doc, anim.name) : [];
  if (!tracks.length) return app.setStatus(t('Lip-sync needs an audio track on this animation (Import audio first).'));
  const slots = app.doc.slots.map((s, i) => ({ s, i })).filter(({ s }) => s.attachments.length > 1);
  if (!slots.length) return app.setStatus(t('Lip-sync needs a mouth slot with mouth shapes (a slot with several images).'));

  const best = slots.reduce((a, b) => (coverage(b.s) > coverage(a.s) ? b : a));
  const state = {
    track: 0,
    source: 'auto',
    text: '',
    language: 'en',
    heard: null, // { kind, text, words } from transcribing the track
    busy: '', // transcription progress
    timing: null, // { kind, words } or { kind, cues } from a file
    fileName: '',
    error: '',
    slot: best.i,
    mouths: matchMouths(best.s.attachments.map((a) => a.name)),
    lead: 2,
    minHold: Math.max(2, Math.round(FPS * 0.05)),
  };
  const { body, close } = modal();
  let note = null; // the line that shows transcription progress

  /** Whisper listens to the chosen track and times its words. */
  const listen = async () => {
    const track = tracks[state.track];
    const buffer = sounds.get(track.sound)?.buffer;
    if (!buffer) {
      state.error = t("'{name}' could not be decoded.", { name: track.sound });
      return draw();
    }
    state.error = '';
    state.busy = t('Starting…');
    draw();
    const onProgress = (text) => {
      state.busy = t(text); // worker texts: tn('Loading the speech model…'), tn('Listening to the audio…')
      if (note) note.textContent = text;
    };
    try {
      state.heard = { kind: 'whisper', ...(await transcribe(buffer, { language: state.language, onProgress })) };
      if (!state.heard.words.length) state.error = t('No speech was heard in this track.');
      count('editor-transcribe');
    } catch (e) {
      state.error = t('Transcription failed: {error}', { error: e.message });
    }
    state.busy = '';
    draw();
  };

  const pickFile = async () => {
    const [file] = (await app.guard(() => platform.pickImportFiles(t('Timing'), ['json', 'tsv', 'txt', 'dat'], false))) ?? [];
    if (!file) return;
    state.fileName = file.name.split(/[\\/]/).pop();
    try {
      state.timing = readTiming(new TextDecoder().decode(file.bytes), { name: state.fileName });
      state.error = '';
    } catch (e) {
      state.timing = null;
      state.error = e.message;
    }
    draw();
  };

  /** The mouth cues for the chosen source, in animation time. */
  const cues = () => {
    const track = tracks[state.track];
    const opts = { fps: FPS, lead: state.lead, minHold: state.minHold };
    if (state.source === 'text') {
      const frames = Math.max(1, Math.round(anim.duration * FPS)) + 1;
      const words = timeTextByLoudness(state.text, frameLevels(track, FPS, frames), FPS);
      return { list: visemeCues(words, opts), offset: 0, words: words.length };
    }
    const timing = state.source === 'auto' ? state.heard : state.timing;
    if (!timing) return null;
    if (timing.words) return { list: visemeCues(timing.words, opts), offset: track.offset, words: timing.words.length };
    // Mouth cues from other tools: the same lead and hold rules.
    const lead = state.lead / FPS;
    return { list: tidy(timing.cues.map((c) => ({ time: Math.max(0, c.time - lead), viseme: c.viseme })), state.minHold / FPS), offset: track.offset, words: 0 };
  };

  const generate = async () => {
    if (state.busy) return;
    // Automatic timing transcribes first, so one click is enough.
    if (state.source === 'auto' && !state.heard) {
      await listen();
      if (!state.heard?.words.length) return;
    }
    const made = cues();
    if (!made || !made.list.length) {
      state.error = { text: t('Type the words spoken in the track first.'), file: t('Choose a timing file first.'), auto: t('No speech was heard in this track.') }[state.source];
      return draw();
    }
    const track = tracks[state.track];
    const length = sounds.get(track.sound)?.buffer?.duration ?? anim.duration;
    const start = Math.max(0, track.offset);
    const end = Math.min(anim.duration, track.offset + length);
    app.commitHistory(false);
    const keys = keyLipSync(anim, state.slot, made.list, state.mouths, { start, end, offset: made.offset });
    app.mode = Mode.Animate;
    app.changed();
    count('editor-lipsync');
    const slotName = app.doc.slots[state.slot].name;
    app.setStatus(t("Lip-sync: {keys} mouth keys on '{slot}' from {source}. Undo reverts it.", { keys, slot: slotName, source: made.words ? t('{count} words', { count: made.words }) : state.fileName }));
    close();
  };

  const draw = () => {
    const slot = app.doc.slots[state.slot];
    const images = [['', '(rest mouth)'], ...slot.attachments.map((a) => [a.name, a.name])];
    const timingNote = state.timing
      ? state.timing.words
        ? `${state.fileName}: ${state.timing.words.length} timed words (${state.timing.kind})`
        : `${state.fileName}: ${state.timing.cues.length} mouth cues (${state.timing.kind})`
      : t('ElevenLabs timestamps or Whisper JSON (word timings), Rhubarb Lip Sync (.tsv or .json), Papagayo (.dat).');
    const parts = [
      h('h3', null, t('Lip-sync')),
      h('p', { class: 'small weak' }, t('Keys mouth shapes (visemes) on a mouth slot from speech timing: each sound gets its mouth, a little before it is heard.')),
      h(
        'div',
        { class: 'lipsync-grid' },
        h('label', null, t('Audio')),
        select(tracks.map((t, i) => [String(i), `${t.sound}${t.offset ? ` (at ${t.offset.toFixed(2)} s)` : ''}`]), String(state.track), (v) => ((state.track = Number(v)), (state.heard = null), draw())),
        h('label', null, t('Timing from')),
        select(
          [
            ['auto', t('Transcribe the audio automatically (Whisper)')],
            ['text', t('The words spoken (timed by the audio)')],
            ['file', 'A timing file'],
          ],
          state.source,
          (v) => ((state.source = v), (state.error = ''), draw()),
        ),
        state.source === 'auto' ? h('label', null, t('Language')) : null,
        state.source === 'auto' ? select(LANGUAGES.map(([id, name]) => [id, t(name)]), state.language, (v) => ((state.language = v), (state.heard = null), draw())) : null,
      ),
      state.source === 'auto'
        ? h(
            'div',
            { class: 'lipsync-file' },
            h('button', { onclick: listen, disabled: !!state.busy }, state.heard ? t('Transcribe again') : t('Transcribe')),
            (note = h(
              'span',
              { class: 'small weak' },
              state.busy ||
                (state.heard
                  ? t('{count} timed words: “{text}”', { count: state.heard.words.length, text: state.heard.text.length > 160 ? `${state.heard.text.slice(0, 160)}…` : state.heard.text })
                  : t('Whisper listens to the track on this computer and times every word. The speech model (about 77 MB) downloads the first time and is kept for later.')),
            )),
          )
        : state.source === 'text'
        ? h('textarea', { class: 'lipsync-text', rows: 3, placeholder: t('Type what is said in the track, e.g. "Hi! I\'m Nila, and I\'m made of layers."'), oninput: (e) => (state.text = e.target.value) }, state.text)
        : h('div', { class: 'lipsync-file' }, h('button', { onclick: pickFile }, t('Choose timing file…')), h('span', { class: 'small weak' }, timingNote)),
      state.error ? h('div', { class: 'lipsync-error' }, state.error) : null,
      h(
        'div',
        { class: 'lipsync-grid' },
        h('label', null, t('Mouth slot')),
        select(
          slots.map(({ s, i }) => [String(i), `${s.name} (${s.attachments.length} images)`]),
          String(state.slot),
          (v) => {
            state.slot = Number(v);
            state.mouths = matchMouths(app.doc.slots[state.slot].attachments.map((a) => a.name));
            draw();
          },
        ),
      ),
      h(
        'div',
        { class: 'lipsync-map' },
        VISEMES.map((v) =>
          h(
            'div',
            { class: 'lipsync-row' },
            h('strong', null, v),
            select(images, state.mouths[v] ?? '', (name) => ((state.mouths[v] = name || null), draw())),
            h('span', { class: 'small weak' }, VISEME_HINTS[v]),
          ),
        ),
      ),
      h(
        'div',
        { class: 'lipsync-grid' },
        h('label', { title: t('Mouths land this many frames before their sound, as animators time them') }, t('Lead (frames)')),
        h('input', { type: 'number', min: 0, max: 6, value: state.lead, class: 'frame-input', onchange: (e) => (state.lead = Math.max(0, Math.min(6, Math.round(+e.target.value || 0)))) }),
        h('label', { title: 'A mouth shape is held at least this many frames, so the mouth never flickers' }, t('Hold at least (frames)')),
        h('input', { type: 'number', min: 1, max: 8, value: state.minHold, class: 'frame-input', onchange: (e) => (state.minHold = Math.max(1, Math.min(8, Math.round(+e.target.value || 1)))) }),
      ),
      h('div', { class: 'small weak' }, t('Replaces the mouth keys over the length of the audio track. Undo reverts it.')),
      h('div', { class: 'modal-buttons' }, h('button', { onclick: close }, t('Cancel')), h('button', { class: 'primary', 'data-tut': 'lipsync:generate', disabled: !!state.busy, onclick: generate }, t('Generate lip-sync'))),
    ];
    body.replaceChildren(...parts.filter(Boolean));
  };
  draw();
}
