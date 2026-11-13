// SPDX-License-Identifier: MIT OR Apache-2.0
// Splash screen: the Rigby2D lockup sweeps in, holds a moment, and the editor opens. (The splash
// carries no character artwork, so the signed desktop app contains open-source code only.)

import { listen } from '@tauri-apps/api/event';
import { Window, getCurrentWindow } from '@tauri-apps/api/window';

import lockupUrl from '../../branding/rigby2d-lockup-transparent.svg?url';

const inTauri = '__TAURI_INTERNALS__' in window;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Seconds the lockup stays on screen at least (its sweep plays out), and at most while the editor loads. */
const HOLD = 0.9;
const MAX_WAIT = 8;

const $ = (s) => document.querySelector(s);
$('#lockup').src = lockupUrl;

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

setTimeout(reveal, reducedMotion ? 0 : 150);

// The editor opens once it has drawn its first frame (it sends `editor-ready`), so it never appears
// blank; and not before the lockup has played. If the signal never comes, it opens anyway.
let held = false;
let ready = !inTauri;
const maybeFinish = () => held && ready && finish();
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
setTimeout(finish, MAX_WAIT * 1000);
