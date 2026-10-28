// SPDX-License-Identifier: MIT OR Apache-2.0
// Splash screen: the Rigby2D lockup sweeps in, holds a moment, and the editor opens. (The splash
// carries no character artwork, so the signed desktop app contains open-source code only.)

import { Window, getCurrentWindow } from '@tauri-apps/api/window';

import lockupUrl from '../../branding/rigby2d-lockup-transparent.svg?url';

const inTauri = '__TAURI_INTERNALS__' in window;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Seconds the lockup stays on screen before the editor opens. */
const HOLD = 1.3;

const $ = (s) => document.querySelector(s);
$('#lockup').src = lockupUrl;

let finished = false;

/** Opens the editor window and closes the splash. Safe to call more than once. */
async function finish() {
  if (finished) return;
  finished = true;
  if (!inTauri) return;
  try {
    const main = await Window.getByLabel('main');
    await main?.show();
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
      await main?.show();
    })
    .catch(() => {});
}

function reveal() {
  $('#lockup').classList.add('reveal');
  $('#note').style.opacity = '0';
}

setTimeout(reveal, reducedMotion ? 0 : 150);
setTimeout(finish, (HOLD + (reducedMotion ? 0 : 0.6)) * 1000);
