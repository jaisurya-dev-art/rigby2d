// SPDX-License-Identifier: MIT OR Apache-2.0
// Viseme lip-sync (core/lipsync.js): words to mouth shapes, timing rules, the timing-file importers,
// matching mouth images by name, and keying image swaps on a mouth slot.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Animation } from '../src/core/animation.js';
import { keyLipSync, matchMouths, readTiming, tidy, timeTextByLoudness, visemeCues, wordVisemes } from '../src/core/lipsync.js';

test('words become mouth shapes', () => {
  assert.deepEqual(wordVisemes('made'), ['MBP', 'E', 'I']); // a + consonant + silent e
  assert.deepEqual(wordVisemes('like'), ['L', 'A', 'I']);
  assert.deepEqual(wordVisemes('very'), ['FV', 'E', 'I']);
  assert.deepEqual(wordVisemes('Bézier'), wordVisemes('bezier'), 'accents are ignored');
  assert.deepEqual(wordVisemes('Hi!'), ['I', 'A', 'I'], 'punctuation is ignored');
  assert.deepEqual(wordVisemes('4'), wordVisemes('four'), 'digits are spelled out');
  assert.deepEqual(wordVisemes('lip-synced'), [...wordVisemes('lip'), ...wordVisemes('synced')].filter((v, i, a) => i === 0 || v !== a[i - 1]));
  assert.deepEqual(wordVisemes('...'), []);
  for (const w of ['perfectly', 'playful', 'smooth', 'thinking', 'nation', 'night']) {
    const v = wordVisemes(w);
    assert.ok(v.length > 0 && v.every((x, i) => i === 0 || x !== v[i - 1]), `${w}: no repeated shapes`);
  }
});

test('timing: mouths lead the sound, hold long enough and rest in pauses', () => {
  const fps = 60;
  const words = [
    { word: 'Hi', start: 1.0, end: 1.3 },
    { word: 'there', start: 1.32, end: 1.7 },
    { word: 'friend', start: 2.5, end: 3.0 },
  ];
  const cues = visemeCues(words, { fps, lead: 2, minHold: 3 });
  assert.ok(Math.abs(cues[0].time - (1.0 - 2 / fps)) < 1e-9, 'first mouth lands 2 frames early');
  for (let i = 1; i < cues.length; i++) {
    assert.ok(cues[i].time - cues[i - 1].time >= 3 / fps - 1e-9, 'every mouth holds at least 3 frames');
    assert.notEqual(cues[i].viseme, cues[i - 1].viseme, 'no repeated mouths');
  }
  const pause = cues.find((c) => c.time > 1.6 && c.time < 2.4);
  assert.equal(pause?.viseme, 'rest', 'the mouth rests in the 0.8 s pause');
  assert.equal(cues.at(-1).viseme, 'rest', 'and after the last word');
  // No rest between words that run together.
  assert.equal(cues.filter((c) => c.time > 1.2 && c.time < 1.4 && c.viseme === 'rest').length, 0);
});

test('tidy folds too-short cues, keeping the vowel', () => {
  const t = tidy([{ time: 0, viseme: 'rest' }, { time: 1, viseme: 'MBP' }, { time: 1.01, viseme: 'A' }, { time: 1.2, viseme: 'A' }, { time: 1.4, viseme: 'FV' }], 0.05);
  assert.deepEqual(t.map((c) => c.viseme), ['rest', 'A', 'FV']);
});

test('a transcript is timed against loudness', () => {
  const fps = 30;
  // Silence, 1 s of speech, silence, 1 s of speech.
  const levels = [...Array(15).fill(0), ...Array(30).fill(0.8), ...Array(15).fill(0), ...Array(30).fill(0.7)];
  const words = timeTextByLoudness('hello there, my friend', levels, fps);
  assert.equal(words.length, 4);
  assert.ok(words[0].start >= 0.5 - 1e-9, 'speech starts after the first silence');
  assert.ok(words.every((w, i) => w.end > w.start && (i === 0 || w.start >= words[i - 1].start)));
  assert.ok(words.at(-1).end <= levels.length / fps + 1e-9);
  assert.ok(words.every((w) => levels[Math.floor(w.start * fps)] > 0), 'every word starts on sound');
  assert.deepEqual(timeTextByLoudness('words', new Array(10).fill(0), fps), [], 'no speech, no words');
});

test('importers: ElevenLabs, word JSON, Whisper, Rhubarb and Papagayo', () => {
  const el = readTiming(JSON.stringify({
    audio_base64: '',
    alignment: {
      characters: [...'Hi there'],
      character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
    },
  }));
  assert.equal(el.kind, 'elevenlabs');
  assert.deepEqual(el.words, [{ word: 'Hi', start: 0, end: 0.2 }, { word: 'there', start: 0.3, end: 0.8 }]);

  const plain = readTiming(JSON.stringify([{ word: 'one', start: 0, end: 0.4 }, { text: 'two', start: 0.5, end: 0.9 }]));
  assert.deepEqual(plain.words.map((w) => w.word), ['one', 'two']);
  const whisper = readTiming(JSON.stringify({ segments: [{ words: [{ word: ' Hello', start: 0.2, end: 0.6 }] }] }));
  assert.deepEqual(whisper.words, [{ word: 'Hello', start: 0.2, end: 0.6 }]);

  const tsv = readTiming('0.00\tX\n0.10\tA\n0.25\tD\n0.40\tG\n0.60\tX\n');
  assert.equal(tsv.kind, 'rhubarb');
  assert.deepEqual(tsv.cues.map((c) => c.viseme), ['rest', 'MBP', 'A', 'FV', 'rest']);
  const rjson = readTiming(JSON.stringify({ mouthCues: [{ start: 0, end: 0.2, value: 'X' }, { start: 0.2, end: 0.5, value: 'H' }] }));
  assert.deepEqual(rjson.cues.map((c) => c.viseme), ['rest', 'L']);

  const dat = readTiming('MohoSwitch1\n1 rest\n13 MBP\n25 AI\n37 rest\n', { papagayoFps: 24 });
  assert.equal(dat.kind, 'papagayo');
  assert.deepEqual(dat.cues, [{ time: 0, viseme: 'rest' }, { time: 0.5, viseme: 'MBP' }, { time: 1, viseme: 'A' }, { time: 1.5, viseme: 'rest' }]);

  assert.throws(() => readTiming('hello world', { name: 'notes.txt' }), /notes\.txt is not a timing file/);
  assert.throws(() => readTiming('{"foo": 1}'), /No word timings/);
});

test('mouth images are matched by name', () => {
  const nila = ['mouth_smile', 'mouth_closed', 'mouth_open', 'mouth_o', 'mouth_viseme_A', 'mouth_viseme_E', 'mouth_viseme_I', 'mouth_viseme_O', 'mouth_viseme_U', 'mouth_viseme_MBP', 'mouth_viseme_FV', 'mouth_viseme_L'];
  assert.deepEqual(matchMouths(nila), {
    A: 'mouth_viseme_A', E: 'mouth_viseme_E', I: 'mouth_viseme_I', O: 'mouth_viseme_O', U: 'mouth_viseme_U',
    MBP: 'mouth_viseme_MBP', FV: 'mouth_viseme_FV', L: 'mouth_viseme_L', rest: 'mouth_smile',
  });
  assert.deepEqual(matchMouths(['ah', 'eh', 'ee', 'oh', 'oo', 'm', 'f', 'th', 'neutral']), { A: 'ah', E: 'eh', I: 'ee', O: 'oh', U: 'oo', MBP: 'm', FV: 'f', L: 'th', rest: 'neutral' });
  assert.equal(matchMouths(['body', 'arm']).A, null);
});

test('keying replaces the span with stepped image swaps', () => {
  const anim = new Animation('talk', 4);
  const keys = anim.slotTimelineMut(0).attachment;
  keys.push({ time: 0.5, value: 'old', curve: 'stepped' }, { time: 3.5, value: 'kept', curve: 'stepped' });
  const mouths = { A: 'ah', E: 'eh', I: 'ee', O: 'oh', U: 'oo', MBP: 'm', FV: null, L: 'th', rest: 'neutral' };
  const cues = [{ time: 0, viseme: 'MBP' }, { time: 0.2, viseme: 'A' }, { time: 0.4, viseme: 'FV' }, { time: 0.6, viseme: 'rest' }];
  const n = keyLipSync(anim, 0, cues, mouths, { start: 1, end: 3, offset: 1 });
  assert.equal(n, 3, 'FV falls back to rest and merges with the rest after it');
  assert.deepEqual(keys.map((k) => [k.time, k.value]), [[0.5, 'old'], [1, 'm'], [1.2, 'ah'], [1.4, 'neutral'], [3.5, 'kept']], 'a missing shape (FV) falls back to rest; keys outside the span stay');
  assert.ok(keys.every((k) => k.curve === 'stepped'));
  // Running again replaces, not duplicates.
  keyLipSync(anim, 0, cues, mouths, { start: 1, end: 3, offset: 1 });
  assert.equal(keys.length, 5);
});
