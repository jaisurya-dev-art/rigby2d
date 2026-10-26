// SPDX-License-Identifier: MIT OR Apache-2.0
// The Lip-sync dialog (Film workspace, audio section): mouth shapes keyed from speech timing onto a
// mouth slot. Timing comes from a typed transcript (laid over the audio's loudness) or a timing file
// (ElevenLabs timestamps, Whisper or other word-timing JSON, Rhubarb Lip Sync, Papagayo). The work
// itself is in core/lipsync.js; this file is the UI.

import { VISEMES, VISEME_HINTS, keyLipSync, matchMouths, readTiming, timeTextByLoudness, tidy, visemeCues } from '../core/lipsync.js';
import { track as count } from './analytics.js';
import { FPS, Mode } from './app.js';
import { frameLevels, sounds, tracksOf } from './audio.js';
import * as platform from './platform.js';
import { h } from './widgets.js';

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

/** How many mouth shapes a slot's images cover, to pick the mouth slot by itself. */
const coverage = (slot) => Object.values(matchMouths(slot.attachments.map((a) => a.name))).filter(Boolean).length;

/** Opens the dialog for the current animation's audio. */
export function openLipSync(app) {
  const anim = app.currentAnimation();
  const tracks = anim ? tracksOf(app.doc, anim.name) : [];
  if (!tracks.length) return app.setStatus('Lip-sync needs an audio track on this animation (Import audio first).');
  const slots = app.doc.slots.map((s, i) => ({ s, i })).filter(({ s }) => s.attachments.length > 1);
  if (!slots.length) return app.setStatus('Lip-sync needs a mouth slot with mouth shapes (a slot with several images).');

  const best = slots.reduce((a, b) => (coverage(b.s) > coverage(a.s) ? b : a));
  const state = {
    track: 0,
    source: 'text',
    text: '',
    timing: null, // { kind, words } or { kind, cues } from a file
    fileName: '',
    error: '',
    slot: best.i,
    mouths: matchMouths(best.s.attachments.map((a) => a.name)),
    lead: 2,
    minHold: Math.max(2, Math.round(FPS * 0.05)),
  };
  const { body, close } = modal();

  const pickFile = async () => {
    const [file] = (await app.guard(() => platform.pickImportFiles('Timing', ['json', 'tsv', 'txt', 'dat'], false))) ?? [];
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
    const t = tracks[state.track];
    const opts = { fps: FPS, lead: state.lead, minHold: state.minHold };
    if (state.source === 'text') {
      const frames = Math.max(1, Math.round(anim.duration * FPS)) + 1;
      const words = timeTextByLoudness(state.text, frameLevels(t, FPS, frames), FPS);
      return { list: visemeCues(words, opts), offset: 0, words: words.length };
    }
    if (!state.timing) return null;
    if (state.timing.words) return { list: visemeCues(state.timing.words, opts), offset: t.offset, words: state.timing.words.length };
    // Mouth cues from other tools: the same lead and hold rules.
    const lead = state.lead / FPS;
    return { list: tidy(state.timing.cues.map((c) => ({ time: Math.max(0, c.time - lead), viseme: c.viseme })), state.minHold / FPS), offset: t.offset, words: 0 };
  };

  const generate = () => {
    const made = cues();
    if (!made || !made.list.length) {
      state.error = state.source === 'text' ? 'Type the words spoken in the track first.' : 'Choose a timing file first.';
      return draw();
    }
    const t = tracks[state.track];
    const length = sounds.get(t.sound)?.buffer?.duration ?? anim.duration;
    const start = Math.max(0, t.offset);
    const end = Math.min(anim.duration, t.offset + length);
    app.commitHistory(false);
    const keys = keyLipSync(anim, state.slot, made.list, state.mouths, { start, end, offset: made.offset });
    app.mode = Mode.Animate;
    app.changed();
    count('editor-lipsync');
    const slotName = app.doc.slots[state.slot].name;
    app.setStatus(`Lip-sync: ${keys} mouth keys on '${slotName}' from ${made.words ? `${made.words} words` : state.fileName}. Undo reverts it.`);
    close();
  };

  const draw = () => {
    const slot = app.doc.slots[state.slot];
    const images = [['', '(rest mouth)'], ...slot.attachments.map((a) => [a.name, a.name])];
    const timingNote = state.timing
      ? state.timing.words
        ? `${state.fileName}: ${state.timing.words.length} timed words (${state.timing.kind})`
        : `${state.fileName}: ${state.timing.cues.length} mouth cues (${state.timing.kind})`
      : 'ElevenLabs timestamps or Whisper JSON (word timings), Rhubarb Lip Sync (.tsv or .json), Papagayo (.dat).';
    const parts = [
      h('h3', null, 'Lip-sync'),
      h('p', { class: 'small weak' }, 'Keys mouth shapes (visemes) on a mouth slot from speech timing: each sound gets its mouth, a little before it is heard.'),
      h(
        'div',
        { class: 'lipsync-grid' },
        h('label', null, 'Audio'),
        select(tracks.map((t, i) => [String(i), `${t.sound}${t.offset ? ` (at ${t.offset.toFixed(2)} s)` : ''}`]), String(state.track), (v) => ((state.track = Number(v)), draw())),
        h('label', null, 'Timing from'),
        select(
          [
            ['text', 'The words spoken (timed by the audio)'],
            ['file', 'A timing file'],
          ],
          state.source,
          (v) => ((state.source = v), (state.error = ''), draw()),
        ),
      ),
      state.source === 'text'
        ? h('textarea', { class: 'lipsync-text', rows: 3, placeholder: 'Type what is said in the track, e.g. "Hi! I\'m Nila, and I\'m made of layers."', oninput: (e) => (state.text = e.target.value) }, state.text)
        : h('div', { class: 'lipsync-file' }, h('button', { onclick: pickFile }, 'Choose timing file…'), h('span', { class: 'small weak' }, timingNote)),
      state.error ? h('div', { class: 'lipsync-error' }, state.error) : null,
      h(
        'div',
        { class: 'lipsync-grid' },
        h('label', null, 'Mouth slot'),
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
        h('label', { title: 'Mouths land this many frames before their sound, as animators time them' }, 'Lead (frames)'),
        h('input', { type: 'number', min: 0, max: 6, value: state.lead, class: 'frame-input', onchange: (e) => (state.lead = Math.max(0, Math.min(6, Math.round(+e.target.value || 0)))) }),
        h('label', { title: 'A mouth shape is held at least this many frames, so the mouth never flickers' }, 'Hold at least (frames)'),
        h('input', { type: 'number', min: 1, max: 8, value: state.minHold, class: 'frame-input', onchange: (e) => (state.minHold = Math.max(1, Math.min(8, Math.round(+e.target.value || 1)))) }),
      ),
      h('div', { class: 'small weak' }, 'Replaces the mouth keys over the length of the audio track. Undo reverts it.'),
      h('div', { class: 'modal-buttons' }, h('button', { onclick: close }, 'Cancel'), h('button', { class: 'primary', 'data-tut': 'lipsync:generate', onclick: generate }, 'Generate lip-sync')),
    ];
    body.replaceChildren(...parts.filter(Boolean));
  };
  draw();
}
