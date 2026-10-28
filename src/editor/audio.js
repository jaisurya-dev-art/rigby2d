// SPDX-License-Identifier: MIT OR Apache-2.0
// Audio tracks (Film workspace): sounds stored in the work file and placed on an animation at an
// offset. They play with the timeline, drive lip-sync and are mixed into a WAV for renders.

/** Sound name -> { bytes (file data), buffer (decoded AudioBuffer) }. */
export const sounds = new Map();
let context = null;
let playing = [];

export function audioContext() {
  return (context ??= new AudioContext());
}

/** Stores and decodes a sound file. */
export async function addSound(name, bytes) {
  const buffer = await audioContext().decodeAudioData(bytes.slice().buffer);
  sounds.set(name, { bytes, buffer });
  return buffer;
}

/** Validated tracks: { sound, animation, offset (s), volume }. */
export function readAudioTracks(list) {
  if (!Array.isArray(list)) return [];
  return list
    .filter((t) => t && typeof t.sound === 'string' && typeof t.animation === 'string')
    .map((t) => ({ sound: t.sound, animation: t.animation, offset: Number.isFinite(t.offset) ? t.offset : 0, volume: Number.isFinite(t.volume) ? Math.max(0, t.volume) : 1 }));
}

export const tracksOf = (doc, animation) => (doc.audio ?? []).filter((t) => t.animation === animation && sounds.get(t.sound)?.buffer);

export function stopAudio() {
  for (const s of playing) {
    try {
      s.stop();
    } catch {
      // already stopped
    }
  }
  playing = [];
}

/**
 * Plays the tracks of `animation` from `time` seconds. `extra` adds tracks that start `from`
 * seconds into their sound and may stop after `duration` seconds (scene clips' audio).
 */
export function startAudio(doc, animation, time, extra = []) {
  stopAudio();
  const ctx = audioContext();
  if (ctx.state === 'suspended') ctx.resume();
  for (const t of [...tracksOf(doc, animation), ...extra]) {
    const buffer = sounds.get(t.sound)?.buffer;
    if (!buffer) continue;
    const from = t.from ?? 0;
    const length = Math.min(buffer.duration - from, t.duration ?? Infinity);
    const at = time - t.offset;
    if (at >= length) continue;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = t.volume;
    src.connect(gain).connect(ctx.destination);
    if (at >= 0) src.start(0, from + at, length - at);
    else src.start(ctx.currentTime - at, from, length);
    playing.push(src);
  }
}

/**
 * Loudness per frame (0..1) of a track over `frames` frames at `fps`: RMS of each frame's samples,
 * scaled so the loudest frame is 1, lightly smoothed. Drives mouth-open lip-sync.
 */
export function frameLevels(track, fps, frames) {
  const buffer = sounds.get(track.sound)?.buffer;
  const out = new Float32Array(frames);
  if (!buffer) return out;
  const data = buffer.getChannelData(0);
  const rate = buffer.sampleRate;
  for (let f = 0; f < frames; f++) {
    const start = Math.floor((f / fps - track.offset) * rate);
    const end = Math.floor(((f + 1) / fps - track.offset) * rate);
    let sum = 0;
    let n = 0;
    for (let i = Math.max(0, start); i < Math.min(data.length, end); i++, n++) sum += data[i] * data[i];
    out[f] = n ? Math.sqrt(sum / n) * track.volume : 0;
  }
  const max = Math.max(1e-6, ...out);
  for (let f = 0; f < frames; f++) out[f] /= max;
  // Smooth over neighbours so the mouth does not flicker.
  const smooth = out.map((v, f) => (out[Math.max(0, f - 1)] + 2 * v + out[Math.min(frames - 1, f + 1)]) / 4);
  return smooth.map((v) => (v < 0.08 ? 0 : Math.min(1, v * 1.2)));
}

/** The tracks of `animation` mixed over `duration` seconds (48 kHz stereo AudioBuffer), or null. */
export async function mixBuffer(doc, animation, duration, extra = []) {
  const tracks = [...tracksOf(doc, animation), ...extra].filter((t) => sounds.get(t.sound)?.buffer);
  if (!tracks.length || duration <= 0) return null;
  const rate = 48000;
  const ctx = new OfflineAudioContext(2, Math.ceil(duration * rate), rate);
  for (const t of tracks) {
    const src = ctx.createBufferSource();
    src.buffer = sounds.get(t.sound).buffer;
    const gain = ctx.createGain();
    gain.gain.value = t.volume;
    src.connect(gain).connect(ctx.destination);
    const from = t.from ?? 0;
    const length = Math.min(src.buffer.duration - from, t.duration ?? Infinity);
    if (length <= 0) continue;
    if (t.offset >= 0) src.start(t.offset, from, length);
    else if (-t.offset < length) src.start(0, from - t.offset, length + t.offset);
  }
  return ctx.startRendering();
}

/** The tracks of `animation` mixed over `duration` seconds as a 16-bit stereo WAV, or null. */
export async function mixWav(doc, animation, duration, extra = []) {
  return wavOf(await mixBuffer(doc, animation, duration, extra));
}

/**
 * Joins audio end to end: `parts` are [{ buffer (or null for silence), seconds }]. Returns a
 * 48 kHz stereo AudioBuffer, or null when every part is silent.
 */
export function joinBuffers(parts) {
  if (!parts.some((p) => p.buffer)) return null;
  const rate = 48000;
  const total = Math.ceil(parts.reduce((s, p) => s + p.seconds, 0) * rate);
  const out = new AudioBuffer({ length: Math.max(1, total), sampleRate: rate, numberOfChannels: 2 });
  let at = 0;
  for (const p of parts) {
    const start = Math.round(at * rate);
    const room = Math.min(Math.round(p.seconds * rate), total - start);
    if (p.buffer && room > 0) {
      for (let c = 0; c < 2; c++) out.getChannelData(c).set(p.buffer.getChannelData(Math.min(c, p.buffer.numberOfChannels - 1)).subarray(0, room), start);
    }
    at += p.seconds;
  }
  return out;
}

/** A 16-bit stereo WAV of an AudioBuffer, or null. */
export function wavOf(out) {
  if (!out) return null;
  const rate = out.sampleRate;
  const n = out.length;
  const bytes = new Uint8Array(44 + n * 4);
  const v = new DataView(bytes.buffer);
  const text = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  text(0, 'RIFF');
  v.setUint32(4, 36 + n * 4, true);
  text(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 2, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 4, true);
  v.setUint16(32, 4, true);
  v.setUint16(34, 16, true);
  text(36, 'data');
  v.setUint32(40, n * 4, true);
  const l = out.getChannelData(0);
  const r = out.getChannelData(1);
  for (let i = 0; i < n; i++) {
    v.setInt16(44 + i * 4, Math.max(-1, Math.min(1, l[i])) * 32767, true);
    v.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r[i])) * 32767, true);
  }
  return bytes;
}

/** Encodes an AudioBuffer as AAC-LC (for MP4), or null when the system has no AAC encoder. */
export const encodeAac = (buffer) => encodeAudio(buffer, 'aac');

/** Encodes an AudioBuffer as Opus (for WebM), or null when Opus encoding is not available. */
export const encodeOpus = (buffer) => encodeAudio(buffer, 'opus');

/**
 * Encodes an AudioBuffer (48 kHz stereo) with WebCodecs. Returns { codec ('aac' or 'opus'), rate,
 * channels, preSkip, head (Opus: OpusHead), config (AAC: AudioSpecificConfig),
 * frames: [{ data, time (ms), samples }] }, or null when the codec is not available.
 */
async function encodeAudio(buffer, codec) {
  if (typeof AudioEncoder !== 'function' || !buffer) return null;
  const aac = codec === 'aac';
  const config = aac ? { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 192000, aac: { format: 'aac' } } : { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 };
  if (!(await AudioEncoder.isConfigSupported(config).catch(() => ({ supported: false }))).supported) return null;
  const frames = [];
  let head = null;
  let failure = null;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const d = meta?.decoderConfig?.description;
      if (d && !head) head = new Uint8Array(d instanceof ArrayBuffer ? d : d.buffer.slice(d.byteOffset, d.byteOffset + d.byteLength));
      frames.push({ data, time: chunk.timestamp / 1000, samples: aac ? 1024 : Math.round(((chunk.duration ?? 20000) * 48000) / 1e6) });
    },
    error: (e) => (failure = e),
  });
  encoder.configure(config);
  const block = 4800;
  const planes = new Float32Array(block * 2);
  for (let i = 0; i < buffer.length; i += block) {
    const n = Math.min(block, buffer.length - i);
    planes.set(buffer.getChannelData(0).subarray(i, i + n), 0);
    planes.set(buffer.getChannelData(1).subarray(i, i + n), n);
    const data = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round((i / 48000) * 1e6), data: planes.subarray(0, n * 2) });
    encoder.encode(data);
    data.close();
  }
  await encoder.flush();
  encoder.close();
  if (failure) throw failure;
  if (aac) {
    // AudioSpecificConfig: AAC-LC (2), 48 kHz (index 3), 2 channels, when the encoder gives none.
    return { codec: 'aac', rate: 48000, channels: 2, preSkip: 0, config: head ?? Uint8Array.of(0x11, 0x90), frames };
  }
  const preSkip = 312;
  if (!head) {
    head = new Uint8Array(19);
    head.set(new TextEncoder().encode('OpusHead'));
    const v = new DataView(head.buffer);
    v.setUint8(8, 1);
    v.setUint8(9, 2);
    v.setUint16(10, preSkip, true);
    v.setUint32(12, 48000, true);
  }
  return { codec: 'opus', rate: 48000, channels: 2, preSkip: new DataView(head.buffer, head.byteOffset).getUint16(10, true), head, frames };
}
