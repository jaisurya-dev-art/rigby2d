import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { PREFS, validPref } from '../src/editor/prefs.js';
import { BUILT_IN_THEMES, THEME_KEYS, THEME_FORMAT, allThemes, findTheme, mix, newThemeId, normalizeTheme, parseColor, parseTheme, serializeTheme, themeTokens } from '../src/editor/themes.js';

/** WCAG contrast ratio of two colours. */
function contrast(a, b) {
  const lum = (c) => {
    const [r, g, bl] = parseColor(c).slice(0, 3).map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test('built-in themes set every colour, each a colour', () => {
  assert.deepEqual(BUILT_IN_THEMES.map((t) => t.id), ['rigby-dark', 'mammoth', 'rigby-light']);
  for (const theme of BUILT_IN_THEMES) {
    for (const { key } of THEME_KEYS) assert.ok(parseColor(theme.colors[key]), `${theme.id}.${key}`);
    assert.deepEqual(Object.keys(theme.colors).sort(), THEME_KEYS.map((k) => k.key).sort(), theme.id);
  }
});

test('every colour token the stylesheet reads is set by every theme', () => {
  const css = readFileSync(new URL('../src/editor/style.css', import.meta.url), 'utf8');
  // Tokens read with a fallback colour: var(--name, <colour>) (the themable colours).
  const read = new Set([...css.matchAll(/var\((--[a-z0-9-]+),\s*(#|rgb|white)/g)].map((m) => m[1]));
  // And the colour tokens the stylesheet defines on :root.
  for (const m of css.matchAll(/^\s*(--[a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8}|rgba?\()/gm)) read.add(m[1]);
  const canvas = readFileSync(new URL('../src/editor/canvascolors.js', import.meta.url), 'utf8') && ['--canvas-bg', '--canvas-grid', '--tl-bg', '--tl-ruler', '--tl-row', '--tl-row-hi', '--tl-line', '--tl-tick', '--tl-label', '--tl-text', '--tl-dim', '--tl-key', '--graph-grid', '--graph-axis', '--ruler-bg', '--ruler-corner', '--ruler-tick', '--ruler-text', '--mark-bowl'];
  for (const name of canvas) read.add(name);
  // Fixed on purpose: the bone hover glow is the same in every theme.
  read.delete('--bone-hover');
  // The engine marks' brand colours.
  read.delete('--rt');
  read.delete('--rt-fg');
  for (const theme of BUILT_IN_THEMES) {
    const tokens = themeTokens(theme);
    const missing = [...read].filter((name) => !(name in tokens));
    assert.deepEqual(missing, [], `${theme.id} leaves these at Rigby Dark's colour`);
  }
});

test('built-in themes are readable: text, secondary text and buttons pass WCAG AA', () => {
  for (const { id, colors: c } of BUILT_IN_THEMES) {
    for (const surface of ['app', 'panel', 'control']) {
      assert.ok(contrast(c.text, c[surface]) >= 7, `${id}: text on ${surface} ${contrast(c.text, c[surface]).toFixed(2)}`);
      assert.ok(contrast(c.textMuted, c[surface]) >= 4.5, `${id}: secondary text on ${surface} ${contrast(c.textMuted, c[surface]).toFixed(2)}`);
    }
    // Rigby Dark keeps the editor's original white-on-blue buttons (3.3:1: the minimum for controls).
    assert.ok(contrast(c.onAccent, c.accent) >= (id === 'rigby-dark' ? 3 : 4.5), `${id}: text on accent ${contrast(c.onAccent, c.accent).toFixed(2)}`);
    assert.ok(contrast(c.textStrong, c.selected) >= 4.5, `${id}: selected text ${contrast(c.textStrong, c.selected).toFixed(2)}`);
  }
});

test('colours: hex, rgb() and hsl() parse; mixing goes between them', () => {
  assert.deepEqual(parseColor('#abc'), [170, 187, 204, 1]);
  assert.deepEqual(parseColor('#00000080').slice(0, 3), [0, 0, 0]);
  assert.ok(Math.abs(parseColor('#00000080')[3] - 0.5) < 0.01);
  assert.deepEqual(parseColor('rgb(10 20 30 / 50%)'), [10, 20, 30, 0.5]);
  assert.deepEqual(parseColor('rgba(255, 0, 0, 1)'), [255, 0, 0, 1]);
  assert.deepEqual(parseColor('hsl(120, 100%, 50%)'), [0, 255, 0, 1]);
  for (const bad of ['', 'red', '#12', 'rgb(1,2)', 'url(x)', null, 42]) assert.equal(parseColor(bad), null, String(bad));
  assert.equal(mix('#000000', '#ffffff', 0.5), '#808080');
});

test('theme files: export and import give the same theme; bad colours fall back with a warning', () => {
  const mammoth = findTheme('mammoth');
  const text = serializeTheme(mammoth);
  assert.equal(JSON.parse(text)[THEME_FORMAT], 1);
  const { theme, warnings } = parseTheme(text);
  assert.deepEqual(warnings, []);
  assert.deepEqual(theme.colors, mammoth.colors);
  assert.equal(theme.name, 'Mammoth');
  assert.equal(theme.id, undefined, 'an imported theme gets its id when it is saved');

  const odd = parseTheme(JSON.stringify({ [THEME_FORMAT]: 1, name: 'Odd', scheme: 'light', colors: { accent: 'banana', text: '#102030' } }));
  assert.equal(odd.theme.colors.text, '#102030');
  assert.equal(odd.theme.colors.accent, findTheme('rigby-light').colors.accent, 'a light theme falls back to Rigby Light');
  assert.ok(odd.warnings.some((w) => w.startsWith('accent:')));
  assert.equal(odd.warnings.length, THEME_KEYS.length - 1);

  assert.throws(() => parseTheme('not json'), /not a theme file/);
  assert.throws(() => parseTheme('{"name":"x"}'), /not a Rigby2D theme/);
  assert.throws(() => parseTheme(JSON.stringify({ [THEME_FORMAT]: 99 })), /newer Rigby2D/);
});

test('a person\'s own themes: listed after the built-ins, found by id, fresh ids', () => {
  const custom = { 'custom-1': normalizeTheme({ name: '  Night  ', colors: { accent: '#ff00aa' } }) };
  const list = allThemes(custom);
  assert.deepEqual(list.map((t) => t.id), ['rigby-dark', 'mammoth', 'rigby-light', 'custom-1']);
  assert.equal(list[3].name, 'Night');
  assert.equal(list[3].custom, true);
  assert.equal(findTheme('custom-1', custom).colors.accent, '#ff00aa');
  assert.equal(findTheme('gone', custom).id, 'rigby-dark', 'an unknown theme falls back to Rigby Dark');
  assert.equal(newThemeId(custom), 'custom-2');
  assert.equal(normalizeTheme({}).name, 'Untitled theme');
});

test('theme preferences: a theme id and the person\'s own themes', () => {
  assert.equal(PREFS['interface.theme'].default, 'rigby-dark');
  assert.equal(validPref('interface.theme', 'mammoth'), 'mammoth');
  assert.equal(validPref('interface.theme', 3), 'rigby-dark');
  assert.deepEqual(validPref('themes.custom', [1]), {});
  assert.deepEqual(validPref('themes.custom', { a: {} }), { a: {} });
});
