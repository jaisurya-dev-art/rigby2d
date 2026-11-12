// SPDX-License-Identifier: MIT OR Apache-2.0
// Interface consistency (Rigby2D Interface 1): a ratchet on the old ways of building the editor's
// interface. Each count may only go down: emoji and symbols used as icons in interface text,
// hand-built modal dialogs (use ui.js dialog()), color literals in interface code and in the
// stylesheet outside the design tokens, and font sizes outside the type scale. When a migration
// lowers a count, record it: UPDATE_UI_BASELINE=1 node --test test/ui-lint.test.js

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const editor = path.join(root, 'src/editor');
const baselineFile = path.join(root, 'test/fixtures/ui-baseline.json');

function editorFiles(dir = editor, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) {
      if (name !== 'i18n') editorFiles(p, out);
    } else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}
const rel = (p) => path.relative(editor, p).split(path.sep).join('/');

/**
 * Emoji and symbol characters used as icons inside interface text (t() and tn() strings). The ▸ of
 * menu paths ("File ▸ Save") is punctuation, as in the docs, so it is allowed.
 */
const SYMBOL = /\p{Extended_Pictographic}|[＋✓✕✦◉◍▾⧉↻⟲⟳⏵⏸⏹⏮⏭↗]/gu;

function measure() {
  const m = { symbols: {}, handBuiltDialogs: {}, colorsInCode: {}, css: {} };
  for (const file of editorFiles()) {
    const name = rel(file);
    const src = fs.readFileSync(file, 'utf8');
    let symbols = 0;
    for (const s of src.matchAll(/\b(?:t|tn)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)) symbols += (s[2].match(SYMBOL) ?? []).length;
    if (symbols) m.symbols[name] = symbols;
    if (name !== 'ui.js') {
      const dialogs = (src.match(/class: ['"`]modal-backdrop/g) ?? []).length;
      if (dialogs) m.handBuiltDialogs[name] = dialogs;
    }
    const colors = (src.match(/['"`]#[0-9a-fA-F]{3,8}['"`]|rgba?\(\s*\d/g) ?? []).length;
    if (colors) m.colorsInCode[name] = colors;
  }
  // The stylesheet: color literals and font sizes outside the token block.
  const css = fs.readFileSync(path.join(editor, 'style.css'), 'utf8').replace(/\r\n/g, '\n');
  const tokens = css.match(/\/\*\s*\n \* Design tokens[\s\S]*?\n}\n/);
  const rest = tokens ? css.replace(tokens[0], '') : css;
  m.css.colorLiterals = (rest.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? []).length;
  const scale = new Set(['11px', '12px', '13px', '15px', '20px']);
  m.css.fontSizesOutsideScale = new Set((rest.match(/font-size:\s*[0-9.]+px/g) ?? []).map((s) => s.replace(/font-size:\s*/, '')).filter((s) => !scale.has(s))).size;
  return m;
}

test('interface consistency only improves (ratchet)', () => {
  const now = measure();
  if (process.env.UPDATE_UI_BASELINE) {
    fs.writeFileSync(baselineFile, JSON.stringify(now, null, 2) + '\n');
    return;
  }
  const base = JSON.parse(fs.readFileSync(baselineFile, 'utf8'));
  const worse = [];
  for (const group of ['symbols', 'handBuiltDialogs', 'colorsInCode']) {
    for (const [file, n] of Object.entries(now[group])) {
      const allowed = base[group][file] ?? 0;
      if (n > allowed) worse.push(`${group}: ${file} has ${n} (baseline ${allowed})`);
    }
  }
  for (const [key, n] of Object.entries(now.css)) if (n > base.css[key]) worse.push(`style.css ${key}: ${n} (baseline ${base.css[key]})`);
  assert.deepEqual(
    worse,
    [],
    'Use the design tokens (style.css), ui.js components and uiIcon() instead: ' +
      'no emoji or symbols in interface text, no hand-built modal-backdrop, no color literals outside the tokens.',
  );
});
