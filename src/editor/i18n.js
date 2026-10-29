// SPDX-License-Identifier: MIT OR Apache-2.0
// Interface translations. Text is written in English in the code and wrapped in t('…'); each
// language maps the English text to its translation (i18n/<code>.js). Missing entries show the
// English text, so a partly translated language still works. `{name}` placeholders are filled
// from t(text, { name }). No DOM here: tests run it under Node.

import ja from './i18n/ja.js';
import zh from './i18n/zh-CN.js';
import ko from './i18n/ko.js';
import es from './i18n/es.js';
import pt from './i18n/pt-BR.js';

/** [code, name in its own language]. */
export const LANGUAGES = [
  ['en', 'English'],
  ['ja', '日本語'],
  ['zh-CN', '简体中文'],
  ['ko', '한국어'],
  ['es', 'Español'],
  ['pt-BR', 'Português (Brasil)'],
];

export const TABLES = { ja, 'zh-CN': zh, ko, es, 'pt-BR': pt };

let current = 'en';
let table = null;

/** The language matching a browser language list (navigator.languages), or English. */
export function languageFor(preferred = []) {
  for (const tag of preferred) {
    const lower = String(tag).toLowerCase();
    const exact = LANGUAGES.find(([code]) => code.toLowerCase() === lower);
    if (exact) return exact[0];
    const base = LANGUAGES.find(([code]) => code.split('-')[0] === lower.split('-')[0]);
    if (base) return base[0];
  }
  return 'en';
}

export function setLanguage(code) {
  current = TABLES[code] ? code : 'en';
  table = TABLES[current] ?? null;
  if (typeof document !== 'undefined') document.documentElement.lang = current;
}

export function language() {
  return current;
}

/** `text` in the interface language, with `{name}` placeholders filled from `vars`. */
export function t(text, vars) {
  const s = table?.[text] ?? text;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}
