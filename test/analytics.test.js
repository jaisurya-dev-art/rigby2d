// SPDX-License-Identifier: MIT OR Apache-2.0
// Usage counting (analytics.js) stays off outside the public website: in Node, the desktop app,
// local development and other hosts, and while no GoatCounter code is set.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { GOATCOUNTER_CODE, analyticsEnabled, startAnalytics, track } from '../src/editor/analytics.js';

function withWindow(win, fn) {
  const saved = { window: globalThis.window, document: globalThis.document };
  globalThis.window = win;
  globalThis.document = { head: { append: () => assert.fail('no script may load here') }, createElement: () => ({ dataset: {}, addEventListener() {} }) };
  try {
    fn();
  } finally {
    globalThis.window = saved.window;
    globalThis.document = saved.document;
  }
}

test('off in Node and harmless to call', () => {
  assert.equal(analyticsEnabled(), false);
  startAnalytics();
  track('editor-export-json');
});

test('off on localhost and in the desktop app, even with a code', () => {
  withWindow({ location: { hostname: 'localhost' } }, () => {
    assert.equal(analyticsEnabled(), false);
    startAnalytics();
  });
  withWindow({ location: { hostname: 'jaisurya-dev-art.github.io' }, __TAURI_INTERNALS__: {} }, () => {
    assert.equal(analyticsEnabled(), false);
    startAnalytics();
  });
});

test('on the website only once a code is set', () => {
  withWindow({ location: { hostname: 'jaisurya-dev-art.github.io' } }, () => {
    assert.equal(analyticsEnabled(), GOATCOUNTER_CODE !== '');
  });
});
