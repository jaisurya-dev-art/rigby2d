// SPDX-License-Identifier: MIT OR Apache-2.0
// Viseme lip-sync: speech timing (words, or mouth cues from other tools) turned into mouth shapes,
// then into image-swap keys on a mouth slot. Pure: no DOM, no audio decoding, so the editor, the MCP
// server and tests share it.
//
// The mouth shapes (visemes) follow the 9-shape set animators use:
//   A (ah), E (eh), I (ee, and most consonants: C D G K N R S T Y Z), O (oh), U (oo, w),
//   MBP (lips closed), FV (lip on teeth), L (tongue up: L, TH), rest (silence).
// Mouths land a little before their sound (`lead`), are held at least `minHold` frames so they never
// flicker, and close to `rest` in pauses.

import { setKey } from './animation.js';
import { STEPPED } from './curve.js';

export const VISEMES = ['A', 'E', 'I', 'O', 'U', 'MBP', 'FV', 'L', 'rest'];

/** What each mouth shape is for (shown next to the mapping in the editor). */
export const VISEME_HINTS = {
  A: 'ah, as in "father"',
  E: 'eh, as in "bed"',
  I: 'ee, and most consonants (C D G K N R S T Y Z)',
  O: 'oh, as in "go"',
  U: 'oo and w, as in "you"',
  MBP: 'lips closed: M, B, P',
  FV: 'lower lip on teeth: F, V',
  L: 'tongue up: L, TH',
  rest: 'silence between words',
};

const VOWELS = new Set(['A', 'E', 'I', 'O', 'U']);

// ---- words to mouth shapes ---------------------------------------------------------------------

/** Common words whose spelling misleads, as mouth shapes. */
const SAY = {
  a: ['A'],
  i: ['A', 'I'],
  "i'm": ['A', 'I', 'MBP'],
  "i've": ['A', 'I', 'FV'],
  "i'll": ['A', 'I', 'L'],
  hi: ['I', 'A', 'I'],
  my: ['MBP', 'A', 'I'],
  by: ['MBP', 'A', 'I'],
  eye: ['A', 'I'],
  the: ['L', 'A'],
  are: ['A', 'I'],
  one: ['U', 'A', 'I'],
  once: ['U', 'A', 'I', 'I'],
  two: ['I', 'U'],
  to: ['I', 'U'],
  too: ['I', 'U'],
  do: ['I', 'U'],
  who: ['U'],
  you: ['I', 'U'],
  your: ['I', 'O', 'I'],
  "you're": ['I', 'O', 'I'],
  what: ['U', 'A', 'I'],
  where: ['U', 'E', 'I'],
  was: ['U', 'A', 'I'],
  said: ['I', 'E', 'I'],
  says: ['I', 'E', 'I'],
  have: ['A', 'A', 'FV'],
  give: ['I', 'I', 'FV'],
  live: ['L', 'I', 'FV'],
  love: ['L', 'A', 'FV'],
  come: ['I', 'A', 'MBP'],
  some: ['I', 'A', 'MBP'],
  done: ['I', 'A', 'I'],
  gone: ['I', 'O', 'I'],
  none: ['I', 'A', 'I'],
  move: ['MBP', 'U', 'FV'],
  lovely: ['L', 'A', 'FV', 'L', 'I'],
  four: ['FV', 'O', 'I'],
  bezier: ['MBP', 'E', 'I', 'E', 'I'],
  through: ['L', 'I', 'U'],
  though: ['L', 'O'],
  thought: ['L', 'O', 'I'],
  laugh: ['L', 'A', 'FV'],
  people: ['MBP', 'I', 'MBP', 'L'],
  again: ['A', 'I', 'E', 'I'],
  any: ['E', 'I', 'I'],
  many: ['MBP', 'E', 'I', 'I'],
  been: ['MBP', 'I', 'I'],
  could: ['I', 'U', 'I'],
  would: ['U', 'U', 'I'],
  should: ['I', 'U', 'I'],
  of: ['A', 'FV'],
  now: ['I', 'A', 'U'],
  how: ['A', 'U'],
  out: ['A', 'U', 'I'],
  our: ['A', 'U', 'I'],
  be: ['MBP', 'I'],
  he: ['I'],
  she: ['I', 'I'],
  we: ['U', 'I'],
  me: ['MBP', 'I'],
  so: ['I', 'O'],
  no: ['I', 'O'],
  go: ['I', 'O'],
  ok: ['O', 'I', 'E', 'I'],
  okay: ['O', 'I', 'E', 'I'],
  oh: ['O'],
  hmm: ['MBP'],
  mm: ['MBP'],
  uh: ['A'],
  um: ['A', 'MBP'],
  yes: ['I', 'E', 'I'],
  very: ['FV', 'E', 'I', 'I'],
  every: ['E', 'FV', 'I', 'I'],
  video: ['FV', 'I', 'I', 'I', 'O'],
  audio: ['O', 'I', 'I', 'O'],
  idea: ['A', 'I', 'I', 'I', 'A'],
  ready: ['I', 'E', 'I', 'I'],
  friend: ['FV', 'I', 'E', 'I', 'I'],
};

const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

/** Spelling rules, most specific first: [pattern at the start of the rest of the word, shapes]. */
const RULES = [
  [/^tion/, ['I', 'U', 'I']],
  [/^sion/, ['I', 'U', 'I']],
  [/^igh/, ['A', 'I']],
  [/^ough/, ['O']],
  [/^augh/, ['O']],
  [/^eigh/, ['E', 'I']],
  [/^th/, ['L']],
  [/^(sh|ch|tch|dg)/, ['I']],
  [/^(ph|gh$)/, ['FV']],
  [/^ck/, ['I']],
  [/^qu/, ['I', 'U']],
  [/^wh/, ['U']],
  [/^(oo|ew|ue)/, ['U']],
  [/^(ou|ow)(?=[nd])/, ['A', 'U']],
  [/^(ow|oa|oe)/, ['O']],
  [/^(ou)/, ['A', 'U']],
  [/^(au|aw)/, ['O']],
  [/^(oi|oy)/, ['O', 'I']],
  [/^(ai|ay|ey)/, ['E', 'I']],
  [/^(ee|ea|ie|ei)/, ['I']],
  // A vowel, one consonant and a silent e: "made", "like", "home", "cute".
  [/^a(?=[bcdfgklmnpstvz]e(?![a-z]))/, ['E', 'I']],
  [/^i(?=[bcdfgklmnpstvz]e(?![a-z]))/, ['A', 'I']],
  [/^o(?=[bcdfgklmnpstvz]e(?![a-z]))/, ['O']],
  [/^u(?=[bcdfgklmnpstvz]e(?![a-z]))/, ['I', 'U']],
  [/^e$/, []], // a silent final e
  [/^a/, ['A']],
  [/^e/, ['E']],
  [/^(i|y)/, ['I']],
  [/^o/, ['O']],
  [/^u/, ['A']],
  [/^w/, ['U']],
  [/^[mbp]/, ['MBP']],
  [/^[fv]/, ['FV']],
  [/^l/, ['L']],
  [/^[cdgknrstxzqhj]/, ['I']],
];

/** Mouth shapes for one word (letters, apostrophes and digits; anything else is ignored). */
export function wordVisemes(raw) {
  const key = String(raw)
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // accents off: "Bézier" reads as "bezier"
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9'\-]/g, '');
  if (!key) return [];
  if (SAY[key]) return merge(SAY[key]);
  // Hyphenated words and digits are spelled part by part ("lip-synced", "4k").
  if (/[-0-9]/.test(key)) {
    const parts = key
      .replace(/(\d)/g, ' $1 ')
      .split(/[\s-]+/)
      .filter(Boolean)
      .map((p) => (/^\d$/.test(p) ? NUMBERS[Number(p)] : p));
    return merge(parts.flatMap((p) => wordVisemes(p)));
  }
  const out = [];
  let w = key.replace(/'/g, '');
  // Doubled consonants sound once.
  w = w.replace(/([bcdfgklmnprstvz])\1/g, '$1');
  while (w.length) {
    const rule = RULES.find(([re]) => re.test(w));
    if (!rule) {
      w = w.slice(1);
      continue;
    }
    out.push(...rule[1]);
    w = w.slice(w.match(rule[0])[0].length || 1);
  }
  return merge(out);
}

/** Repeated shapes merge: the mouth holds rather than flickering. */
const merge = (list) => list.filter((v, i) => i === 0 || v !== list[i - 1]);

// ---- timing --------------------------------------------------------------------------------------

/**
 * Mouth cues from timed words: [{ word, start, end }] (seconds) -> [{ time, viseme }] sorted by time.
 * Options: fps, lead (frames the mouth lands before the sound), minHold (frames a mouth is held at
 * least), restGap (seconds of silence before the mouth rests).
 */
export function visemeCues(words, { fps = 30, lead = 2, minHold = 2, restGap = 0.14 } = {}) {
  const leadT = lead / fps;
  const holdT = minHold / fps;
  const out = [];
  const timed = words.filter((w) => Number.isFinite(w.start) && Number.isFinite(w.end)).sort((a, b) => a.start - b.start);
  timed.forEach((w, i) => {
    const shapes = wordVisemes(w.word);
    if (!shapes.length) return;
    // Vowels hold longer than consonants.
    const weights = shapes.map((v) => (VOWELS.has(v) ? 1.6 : 1));
    const total = weights.reduce((a, b) => a + b, 0);
    const span = Math.max(holdT * shapes.length, w.end - w.start);
    let t = w.start;
    shapes.forEach((v, k) => {
      out.push({ time: t - leadT, viseme: v });
      t += (span * weights[k]) / total;
    });
    const next = timed[i + 1];
    if (!next || next.start - w.end > restGap) out.push({ time: w.end - leadT + 1 / fps, viseme: 'rest' });
  });
  return tidy(out, holdT);
}

/** Sorts cues, drops repeats and folds cues shorter than `holdT` into their neighbour. */
export function tidy(cues, holdT = 0) {
  const sorted = [...cues].sort((a, b) => a.time - b.time);
  const out = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && c.viseme === last.viseme) continue;
    if (last && c.time - last.time < holdT - 1e-9 && out.length > 1) {
      // Keep the vowel when a short consonant and a vowel compete for the same frames.
      if (VOWELS.has(c.viseme) && !VOWELS.has(last.viseme)) last.viseme = c.viseme;
      continue;
    }
    out.push({ time: c.time, viseme: c.viseme });
  }
  // Folding can leave neighbours equal: merge them.
  return out.filter((c, i) => i === 0 || c.viseme !== out[i - 1].viseme);
}

/**
 * Times a typed transcript against the loudness of its audio: the words are laid over the spoken
 * stretches (frames where `levels` > 0), in order, each taking time in proportion to its mouth shapes.
 * `levels` is loudness per frame (0 = silence). Returns [{ word, start, end }].
 */
export function timeTextByLoudness(text, levels, fps) {
  const words = String(text).split(/\s+/).filter((w) => wordVisemes(w).length);
  const voiced = [];
  for (let f = 0; f < levels.length; f++) if (levels[f] > 0) voiced.push(f);
  if (!words.length || !voiced.length) return [];
  const weight = words.map((w) => wordVisemes(w).length + 1);
  const total = weight.reduce((a, b) => a + b, 0);
  const out = [];
  let used = 0;
  words.forEach((word, i) => {
    const a = Math.floor((used / total) * voiced.length);
    used += weight[i];
    const b = Math.max(a, Math.ceil((used / total) * voiced.length) - 1);
    out.push({ word, start: voiced[a] / fps, end: (voiced[Math.min(b, voiced.length - 1)] + 1) / fps });
  });
  return out;
}

// ---- importers -----------------------------------------------------------------------------------

/** Rhubarb Lip Sync's mouth shapes as visemes. */
const RHUBARB = { A: 'MBP', B: 'I', C: 'E', D: 'A', E: 'O', F: 'U', G: 'FV', H: 'L', X: 'rest' };
/** Papagayo / Moho phonemes as visemes. */
const PAPAGAYO = { AI: 'A', E: 'E', O: 'O', U: 'U', etc: 'I', L: 'L', WQ: 'U', MBP: 'MBP', FV: 'FV', rest: 'rest' };

/** Words from character timings ({ characters, character_start_times_seconds, ... }). */
function wordsFromCharacters(a) {
  const chars = a.characters ?? [];
  const starts = a.character_start_times_seconds ?? [];
  const ends = a.character_end_times_seconds ?? [];
  const words = [];
  let cur = null;
  chars.forEach((ch, i) => {
    if (/\s/.test(ch)) {
      if (cur) words.push(cur);
      cur = null;
      return;
    }
    if (!cur) cur = { word: '', start: starts[i], end: ends[i] };
    cur.word += ch;
    cur.end = ends[i];
  });
  if (cur) words.push(cur);
  return words.filter((w) => /[a-z0-9]/i.test(w.word));
}

/** Timed words in any of the JSON layouts tools produce, or null. */
function wordsFromJson(o) {
  // ElevenLabs text-to-speech with timestamps.
  const al = o.normalized_alignment ?? o.alignment ?? (Array.isArray(o.characters) ? o : null);
  if (al?.characters) return wordsFromCharacters(al);
  // [{ word, start, end }], { words: [...] }, or Whisper's { segments: [{ words }] }.
  const list = Array.isArray(o) ? o : o.words ?? o.segments?.flatMap((s) => s.words ?? []);
  if (Array.isArray(list)) {
    return list
      .map((w) => ({ word: String(w.word ?? w.text ?? '').trim(), start: Number(w.start ?? w.start_time), end: Number(w.end ?? w.end_time) }))
      .filter((w) => w.word && Number.isFinite(w.start) && Number.isFinite(w.end));
  }
  return null;
}

/**
 * Reads a timing file. Recognises ElevenLabs timestamps JSON, word-timing JSON (including Whisper
 * output), Rhubarb Lip Sync (TSV or JSON) and Papagayo/Moho switch files (.dat, frames at
 * `papagayoFps`). Returns { kind, words } for word timings or { kind, cues } for mouth cues.
 * Throws an Error with a readable message when the file is not understood.
 */
export function readTiming(text, { name = '', papagayoFps = 24 } = {}) {
  const src = String(text).replace(/^﻿/, '').trim();
  if (/^MohoSwitch1/i.test(src)) {
    const cues = [];
    for (const line of src.split(/\r?\n/).slice(1)) {
      const [frame, ph] = line.trim().split(/\s+/);
      if (!frame || !ph) continue;
      cues.push({ time: Math.max(0, (Number(frame) - 1) / papagayoFps), viseme: PAPAGAYO[ph] ?? PAPAGAYO[ph.toUpperCase()] ?? 'I' });
    }
    if (!cues.length) throw new Error('The Papagayo file has no mouth keys.');
    return { kind: 'papagayo', cues: tidy(cues) };
  }
  if (/^[[{]/.test(src)) {
    let o;
    try {
      o = JSON.parse(src);
    } catch (e) {
      throw new Error(`Not valid JSON: ${e.message}`);
    }
    if (Array.isArray(o?.mouthCues)) {
      return { kind: 'rhubarb', cues: tidy(o.mouthCues.map((c) => ({ time: Number(c.start), viseme: RHUBARB[c.value] ?? 'I' }))) };
    }
    const words = wordsFromJson(o);
    if (words?.length) return { kind: o.alignment || o.normalized_alignment || o.characters ? 'elevenlabs' : 'words', words };
    throw new Error('No word timings found in this JSON (expected ElevenLabs timestamps, Whisper output or [{ word, start, end }]).');
  }
  // Rhubarb TSV: "0.00\tX" per line.
  const rows = src.split(/\r?\n/).map((l) => l.trim().split(/\s+/)).filter((r) => r.length >= 2 && Number.isFinite(Number(r[0])));
  if (rows.length && rows.every((r) => RHUBARB[r[1]])) {
    return { kind: 'rhubarb', cues: tidy(rows.map((r) => ({ time: Number(r[0]), viseme: RHUBARB[r[1]] }))) };
  }
  throw new Error(`${name || 'This file'} is not a timing file Rigby2D reads (ElevenLabs or word-timing JSON, Rhubarb, Papagayo).`);
}

// ---- mouths and keys -----------------------------------------------------------------------------

/** Name tokens that mean each mouth shape, best first. */
const MOUTH_WORDS = {
  A: ['a', 'ai', 'ah', 'aa', 'open'],
  E: ['e', 'eh'],
  I: ['i', 'ee', 'etc', 'cdgknrstxyz', 'consonant', 'consonants', 'teeth', 'half'],
  O: ['o', 'oh'],
  U: ['u', 'oo', 'w', 'wq', 'ou'],
  MBP: ['mbp', 'm', 'b', 'p', 'closed'],
  FV: ['fv', 'f', 'v'],
  L: ['l', 'th', 'tongue'],
  rest: ['rest', 'neutral', 'smile', 'idle', 'x', 'closed'],
};

/**
 * Picks an image for each mouth shape from a mouth slot's attachment names, by name
 * ("mouth_viseme_A", "A", "ah", "MBP", "mouth_closed"...). Returns { viseme: name or null }.
 */
export function matchMouths(names) {
  const tokens = names.map((n) => ({ n, t: String(n).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean) }));
  const used = new Set();
  const out = {};
  // Viseme-labelled images first, so "mouth_viseme_A" wins over "mouth_open" for A.
  for (const v of VISEMES) {
    let best = null;
    for (const [rank, word] of MOUTH_WORDS[v].entries()) {
      const hit = tokens.find(({ n, t }) => !used.has(n) && t.at(-1) === word && t.includes('viseme')) ?? tokens.find(({ n, t }) => !used.has(n) && t.at(-1) === word);
      if (hit && (!best || rank < best.rank)) best = { rank, n: hit.n };
      if (best?.rank === 0) break;
    }
    out[v] = best?.n ?? null;
    if (best && v !== 'rest') used.add(best.n);
  }
  return out;
}

/**
 * Keys mouth `cues` as image swaps on slot `slot` of animation `anim` between `start` and `end`
 * (seconds), replacing the slot's attachment keys there. `mouths` maps visemes to attachment names
 * (a missing shape falls back to the rest mouth); cue times are shifted by `offset`.
 * Returns the number of keys written.
 */
export function keyLipSync(anim, slot, cues, mouths, { start = 0, end = anim.duration, offset = 0 } = {}) {
  const keys = anim.slotTimelineMut(slot).attachment;
  for (let i = keys.length - 1; i >= 0; i--) if (keys[i].time >= start - 1e-6 && keys[i].time <= end + 1e-6) keys.splice(i, 1);
  const rest = mouths.rest ?? null;
  let last;
  let n = 0;
  for (const c of cues) {
    let t = Math.round((c.time + offset) * 1e4) / 1e4;
    // A mouth leading the first sound may fall just before the span: it opens at the span start.
    if (t < start - 1e-6 && t > start - 0.25) t = start;
    if (t < start - 1e-6 || t > end + 1e-6) continue;
    const name = mouths[c.viseme] ?? rest;
    if (name === last) continue;
    setKey(keys, t, name, STEPPED);
    last = name;
    n++;
  }
  // The span ends on the rest mouth.
  if (rest !== null && last !== rest && end > start) {
    setKey(keys, end, rest, STEPPED);
    n++;
  }
  return n;
}
