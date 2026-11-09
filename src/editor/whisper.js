// SPDX-License-Identifier: MIT OR Apache-2.0
// Transcribes a sound with Whisper on this computer (whisper.worker.js), for lip-sync without a
// transcript or timing file. One worker is kept, so the model loads once per session.

import { readTiming } from '../core/lipsync.js';
import { t } from './i18n.js';

const RATE = 16000; // Whisper listens at 16 kHz mono

let worker = null;
let busy = false;

/** `buffer` (an AudioBuffer) as 16 kHz mono samples. */
async function resample(buffer) {
  const ctx = new OfflineAudioContext(1, Math.max(1, Math.ceil(buffer.duration * RATE)), RATE);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return (await ctx.startRendering()).getChannelData(0);
}

/**
 * The words spoken in `buffer`, timed from its start: { text, words: [{ word, start, end }] }.
 * `onProgress(text)` reports the model download and the transcription.
 */
export async function transcribe(buffer, { language = '', onProgress = () => {} } = {}) {
  if (busy) throw new Error('A transcription is already running.');
  busy = true;
  try {
    onProgress(t('Preparing the audio…'));
    const samples = await resample(buffer);
    worker ??= new Worker(new URL('./whisper.worker.js', import.meta.url), { type: 'module' });
    const result = await new Promise((resolve, reject) => {
      worker.onmessage = ({ data }) => {
        if (data.type === 'download') onProgress(t('Downloading the speech model (once): {done} of {total} MB', { done: Math.round(data.loaded / 1e6), total: Math.round(data.total / 1e6) }));
        else if (data.type === 'status') onProgress(data.text);
        else if (data.type === 'done') resolve(data);
        else if (data.type === 'error') reject(new Error(data.text));
      };
      worker.onerror = (e) => reject(new Error(e.message || t('The speech model could not start.')));
      worker.postMessage({ samples, language }, [samples.buffer]);
    });
    if (!result.chunks.some((c) => /[a-z0-9]/i.test(c.text))) return { text: '', words: [] };
    const { words } = readTiming(JSON.stringify({ chunks: result.chunks }));
    return { text: result.text.trim(), words };
  } catch (e) {
    // A worker that failed to start stays broken; the next try starts a fresh one.
    worker?.terminate();
    worker = null;
    throw e;
  } finally {
    busy = false;
  }
}
