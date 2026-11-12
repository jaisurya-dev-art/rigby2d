// SPDX-License-Identifier: MIT OR Apache-2.0
// Interface translations (i18n.js): every text the editor passes through t() is translated in
// every language, translations keep their {placeholders}, and the language follows the system.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { LANGUAGES, TABLES, languageFor, setLanguage, t } from '../src/editor/i18n.js';

const root = new URL('../src/editor/', import.meta.url);

/** English texts the editor translates: t('…') and tn('…') calls, Preferences rows and the migration report. */
function sourceTexts() {
  const files = [];
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir)) {
      const p = path.join(dir, f);
      if (fs.statSync(p).isDirectory()) {
        if (f !== 'i18n') walk(p);
      } else if (p.endsWith('.js') && !p.endsWith('i18n.js')) files.push(p);
    }
  };
  walk(fileURLToPath(root)); // decodes the path (spaces) on every platform
  const out = new Set();
  const literal = /\btn?\(\s*(?:'((?:\\.|[^'\\])*)'|"((?:\\.|[^"\\])*)")/g;
  for (const f of files) {
    const s = fs.readFileSync(f, 'utf8');
    for (const m of s.matchAll(literal)) out.add((m[1] ?? m[2]).replace(/\\(['"])/g, '$1'));
    if (f.endsWith('prefsui.js')) {
      for (const m of s.matchAll(/row\(\s*'((?:\\.|[^'\\])*)',\s*(?:'((?:\\.|[^'\\])*)'|"([^"]*)"|null)/g)) {
        out.add(m[1]);
        if (m[2] ?? m[3]) out.add((m[2] ?? m[3]).replace(/\\'/g, "'"));
      }
      for (const m of s.matchAll(/^ {4}label: '([^']*)'/gm)) out.add(m[1]);
    }
    if (f.endsWith('migration.js')) for (const m of s.matchAll(/\['\w+', '([^']*)', '\w+'/g)) out.add(m[1]);
    if (f.endsWith('migrationui.js')) for (const m of s.matchAll(/\w+: '([^']*)'/g)) if (/^[A-Z]/.test(m[1])) out.add(m[1]);
    if (f.endsWith('welcomeui.js')) for (const m of s.matchAll(/(?:name|description): '([^']*)'/g)) out.add(m[1]);
  }
  return [...out].filter(Boolean);
}

// Simplified Chinese is kept complete; the other languages may lag (missing texts show in English).
const COMPLETE = ['zh-CN'];

test('every interface text is translated in the complete languages', () => {
  const texts = sourceTexts();
  assert.ok(texts.length > 200, `found ${texts.length} texts`);
  for (const code of COMPLETE) {
    const missing = texts.filter((k) => !(k in TABLES[code]));
    assert.deepEqual(missing, [], `${code} is missing translations`);
  }
});

test('translations keep their placeholders', () => {
  for (const [code, table] of Object.entries(TABLES)) {
    for (const [en, tr] of Object.entries(table)) {
      const want = (en.match(/\{\w+\}/g) ?? []).sort();
      assert.deepEqual((tr.match(/\{\w+\}/g) ?? []).sort(), want, `${code}: ${en}`);
    }
  }
});

test('the language follows the system and falls back to English', () => {
  assert.equal(languageFor(['ja-JP']), 'ja');
  assert.equal(languageFor(['pt-PT', 'en']), 'pt-BR');
  assert.equal(languageFor(['zh-Hans-CN']), 'zh-CN');
  assert.equal(languageFor(['fr-FR', 'de']), 'en');
  setLanguage('es');
  assert.equal(t('Save'), 'Guardar');
  assert.equal(t('Saved {file}', { file: 'a.rigby' }), 'Guardado: a.rigby');
  assert.equal(t('Not a known text'), 'Not a known text');
  setLanguage('en');
  assert.equal(t('Saved {file}', { file: 'a.rigby' }), 'Saved a.rigby');
});

test('a word written word(s) after a number placeholder takes the number', () => {
  setLanguage('en');
  assert.equal(t('{count} key(s) selected', { count: 1 }), '1 key selected');
  assert.equal(t('{count} key(s) selected', { count: 3 }), '3 keys selected');
  assert.equal(t('{count} key(s) selected', { count: 0 }), '0 keys selected');
  assert.equal(t('{animations} animation(s), {frames} frame(s).', { animations: 1, frames: 61 }), '1 animation, 61 frames.');
  assert.equal(t('Save the pose of the {count} selected bone(s)', { count: 1 }), 'Save the pose of the 1 selected bone');
  // Text without a number before it is left alone.
  assert.equal(t('Show the attachment(s)', {}), 'Show the attachment(s)');
});
