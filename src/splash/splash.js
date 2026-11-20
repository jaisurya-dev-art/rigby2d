// SPDX-License-Identifier: MIT OR Apache-2.0
// Splash screen. By default the Rigby2D lockup sweeps in, holds a moment, and the editor opens.
// When community animations are bundled (src/splash/art/) and Preferences ▸ General ▸ Splash
// animation is on, one of them plays instead, credited, and a Start button opens the editor once it
// is ready. A piece can also be a still picture brought to life (snow and a slow push) with a headline,
// as the release splash is.

import { listen } from '@tauri-apps/api/event';
import { Window, getCurrentWindow } from '@tauri-apps/api/window';

import lockupUrl from '../../branding/rigby2d-lockup-transparent.svg?url';
import markUrl from '../../branding/rigby2d-mark.svg?url';
import { version } from '../../package.json';
import { createPrefs } from '../editor/prefs.js';
import { pickPiece, playPiece } from './art.js';

const inTauri = '__TAURI_INTERNALS__' in window;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Seconds the lockup stays on screen at least (its sweep plays out), and at most while the editor loads. */
const HOLD = 0.9;
const MAX_WAIT = 8;

const $ = (s) => document.querySelector(s);
$('#lockup').src = lockupUrl;

const piece = createPrefs().get('general.splashArt') ? pickPiece() : null;
let finished = false;

/**
 * Shows the editor window maximized. The window is made maximized but hidden (tauri.conf.json);
 * some platforms drop that when a hidden window is first shown, so it is maximized again here.
 */
async function showMaximized(main) {
  if (!main) return;
  await main.maximize().catch(() => {});
  await main.show();
  await main.maximize().catch(() => {});
}

/** Opens the editor window and closes the splash. Safe to call more than once. */
async function finish() {
  if (finished) return;
  finished = true;
  if (!inTauri) return;
  try {
    const main = await Window.getByLabel('main');
    await showMaximized(main);
    await main?.setFocus();
  } finally {
    document.body.classList.add('leaving');
    setTimeout(() => getCurrentWindow().destroy().catch(() => getCurrentWindow().close()), 260);
  }
}

// Closing the splash early still opens the editor.
if (inTauri) {
  getCurrentWindow()
    .onCloseRequested(async () => {
      if (finished) return;
      finished = true;
      const main = await Window.getByLabel('main');
      await showMaximized(main);
    })
    .catch(() => {});
}

function reveal() {
  $('#lockup').classList.add('reveal');
  $('#note').style.opacity = '0';
}

if (piece) {
  document.body.classList.add('art');
  // With art the mark alone sits top left: the name is in the headline or the credit.
  $('#lockup').src = markUrl;
  $('#version').textContent = version;
  playPiece(piece, $('#art'), reducedMotion).catch((err) => console.error('splash animation', err));
  const credit = $('#credit');
  if (piece.headline) {
    // A release splash: its name, large, in place of a credit.
    const [name, version, title] = piece.headline;
    credit.classList.add('headline');
    credit.append(Object.assign(document.createElement('span'), { textContent: `${name} ` }), Object.assign(document.createElement('em'), { textContent: version }), Object.assign(document.createElement('b'), { textContent: title }));
  } else {
    credit.append(Object.assign(document.createElement('b'), { textContent: `${piece.title} by ${piece.artist}` }), 'Community animation · Made with Rigby2D');
  }
  $('#bar').style.width = '35%';
  $('#start').addEventListener('click', () => finish());
  addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') && $('#start').classList.contains('ready')) finish();
  });
} else {
  setTimeout(reveal, reducedMotion ? 0 : 150);
}

// The editor opens once it has drawn its first frame (it sends `editor-ready`), so it never appears
// blank; and not before the lockup has played. If the signal never comes, it opens anyway.
// With an animation it waits for Start instead: the button turns from grey to white when ready.
let held = false;
let ready = !inTauri;
function maybeFinish() {
  if (!held || !ready) return;
  if (!piece) return finish();
  const start = $('#start');
  if (start.classList.contains('ready')) return;
  start.classList.add('ready');
  start.focus({ focusVisible: false });
  $('#bar').style.width = '100%';
  setTimeout(() => ($('#bar').style.opacity = '0'), 400);
}
setTimeout(() => {
  held = true;
  maybeFinish();
}, (reducedMotion ? 0 : HOLD + 0.6) * 1000);
if (inTauri) {
  listen('editor-ready', () => {
    ready = true;
    maybeFinish();
  }).catch(() => (ready = true));
}
setTimeout(() => {
  ready = held = true;
  maybeFinish();
}, MAX_WAIT * 1000);
