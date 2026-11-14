// SPDX-License-Identifier: MIT OR Apache-2.0
// Interface themes (View ▸ Themes): a theme is a few base colours; every interface colour token
// (style.css) is derived from them. Rigby Dark is the stylesheet itself (applying it clears the
// overrides), Mammoth and Rigby Light are built in, and people make their own: a copy of a theme
// with changed colours, saved in the preferences and shared as a .rigbytheme file.
// No DOM at import: the model and the file format run under Node (tests); applyTheme needs a document.

/** The theme file format's marker and version. */
export const THEME_FORMAT = 'rigby2d-theme';
export const THEME_VERSION = 1;
export const THEME_EXTENSION = 'rigbytheme';

/**
 * The base colours a theme sets, in the order and groups the Themes dialog shows them. `key` is
 * the theme file's field; labels are translated where they are shown.
 */
export const THEME_KEYS = [
  { group: 'Surfaces', key: 'app0', label: 'Deepest (lists, wells)' },
  { group: 'Surfaces', key: 'app', label: 'App' },
  { group: 'Surfaces', key: 'panel', label: 'Panels' },
  { group: 'Surfaces', key: 'control', label: 'Controls' },
  { group: 'Surfaces', key: 'hover', label: 'Hover' },
  { group: 'Surfaces', key: 'popover', label: 'Menus and popups' },
  { group: 'Surfaces', key: 'line', label: 'Lines' },
  { group: 'Surfaces', key: 'lineStrong', label: 'Strong lines' },
  { group: 'Text', key: 'text', label: 'Text' },
  { group: 'Text', key: 'textStrong', label: 'Headings and active' },
  { group: 'Text', key: 'textMuted', label: 'Secondary' },
  { group: 'Text', key: 'textFaint', label: 'Faint' },
  { group: 'Accent', key: 'accent', label: 'Accent' },
  { group: 'Accent', key: 'accentText', label: 'Accent text' },
  { group: 'Accent', key: 'onAccent', label: 'Text on accent' },
  { group: 'Accent', key: 'selected', label: 'Selection' },
  { group: 'Accent', key: 'focus', label: 'Focus and info' },
  { group: 'State', key: 'success', label: 'Success' },
  { group: 'State', key: 'warning', label: 'Warning' },
  { group: 'State', key: 'danger', label: 'Danger' },
  { group: 'State', key: 'modeSetup', label: 'Setup mode' },
  { group: 'State', key: 'modeAnimate', label: 'Animate mode' },
  { group: 'Viewport', key: 'viewport', label: 'Canvas' },
  { group: 'Viewport', key: 'viewportGrid', label: 'Grid' },
];

/** Built-in themes. Rigby Dark's colours are the stylesheet's own (a base for copies). */
export const BUILT_IN_THEMES = [
  {
    id: 'rigby-dark',
    name: 'Rigby Dark',
    scheme: 'dark',
    colors: {
      app0: '#141516', app: '#1b1c1e', panel: '#232427', control: '#2c2d31', hover: '#35373b', popover: '#2b2d31',
      line: '#36383c', lineStrong: '#45474e', text: '#e4e4e4', textStrong: '#ffffff', textMuted: '#9a9ea5', textFaint: '#6d7178',
      accent: '#5a8fd6', accentText: '#9cc1f5', onAccent: '#ffffff', selected: '#2d4f7c', focus: '#7ba7c7',
      success: '#5fbf86', warning: '#d9a03f', danger: '#d9655c', modeSetup: '#78aaff', modeAnimate: '#ff825f',
      viewport: '#262626', viewportGrid: '#303030',
    },
  },
  {
    id: 'mammoth',
    name: 'Mammoth',
    scheme: 'dark',
    colors: {
      app0: '#0a161c', app: '#0e1c23', panel: '#13242c', control: '#1a2f38', hover: '#223a44', popover: '#182c35',
      line: '#24404b', lineStrong: '#36545f', text: '#f1ece4', textStrong: '#ffffff', textMuted: '#9fb3bd', textFaint: '#7a909a',
      accent: '#f08a3a', accentText: '#f5a263', onAccent: '#1c0f05', selected: '#5a3216', focus: '#9cc3de',
      success: '#6fcf97', warning: '#e9c46a', danger: '#e76f51', modeSetup: '#9cc3de', modeAnimate: '#f08a3a',
      viewport: '#0b1a21', viewportGrid: '#15303a',
    },
  },
  {
    id: 'rigby-light',
    name: 'Rigby Light',
    scheme: 'light',
    colors: {
      app0: '#e9e9e6', app: '#f3f3f1', panel: '#ffffff', control: '#ececea', hover: '#e2e2df', popover: '#ffffff',
      line: '#d9d9d6', lineStrong: '#c4c4c0', text: '#1b1c1e', textStrong: '#000000', textMuted: '#5a5f66', textFaint: '#81868d',
      accent: '#2f6fc4', accentText: '#245aa3', onAccent: '#ffffff', selected: '#cfe0f6', focus: '#2f78a8',
      success: '#23864f', warning: '#a86b12', danger: '#c53d32', modeSetup: '#2f6fc4', modeAnimate: '#d1492e',
      viewport: '#e4e4e1', viewportGrid: '#d2d2ce',
    },
  },
];
export const DEFAULT_THEME = 'rigby-dark';

// ---- Colours ------------------------------------------------------------------------------------

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb()/rgba() and hsl()/hsla() into [r, g, b, a] (0-255, a 0-1), or null. */
export function parseColor(value) {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = [...h].map((c) => c + c).join('');
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  m = /^(rgba?|hsla?)\(\s*([^)]*)\)$/.exec(v);
  if (!m) return null;
  const parts = m[2].split(/[\s,/]+/).filter(Boolean);
  if (parts.length < 3 || parts.length > 4) return null;
  const num = (s, scale) => (s.endsWith('%') ? (parseFloat(s) / 100) * scale : parseFloat(s));
  const alpha = parts[3] === undefined ? 1 : num(parts[3], 1);
  if (m[1].startsWith('rgb')) {
    const rgb = parts.slice(0, 3).map((s) => num(s, 255));
    if ([...rgb, alpha].some((x) => !Number.isFinite(x))) return null;
    return [...rgb.map((x) => Math.round(Math.min(255, Math.max(0, x)))), Math.min(1, Math.max(0, alpha))];
  }
  const hue = parseFloat(parts[0]);
  const s = num(parts[1], 1);
  const l = num(parts[2], 1);
  if (![hue, s, l, alpha].every(Number.isFinite)) return null;
  const k = (n) => (n + hue / 30) % 12;
  const a2 = s * Math.min(l, 1 - l);
  const f = (n) => l - a2 * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)].map((x) => Math.round(Math.min(1, Math.max(0, x)) * 255)).concat(Math.min(1, Math.max(0, alpha)));
}

/** A colour as #rrggbb (or #rrggbbaa when translucent). */
export function toHex([r, g, b, a = 1]) {
  const h = (x) => Math.round(x).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}${a < 1 ? h(a * 255) : ''}`;
}

/** `a` mixed toward `b` by `t` (0 = a, 1 = b), as #rrggbb. */
export function mix(a, b, t) {
  const x = parseColor(a);
  const y = parseColor(b);
  return toHex([0, 1, 2].map((i) => x[i] + (y[i] - x[i]) * t));
}

/** `color` at `alpha` as rgba(). */
export function alpha(color, a) {
  const [r, g, b] = parseColor(color);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ---- Themes -------------------------------------------------------------------------------------

/** The built-in theme `id`, or null. */
export const builtInTheme = (id) => BUILT_IN_THEMES.find((t) => t.id === id) ?? null;

/**
 * A theme checked and completed: unknown fields dropped, colours that do not parse replaced by
 * its base's (Rigby Dark, or Rigby Light for a light theme), a scheme of 'dark' or 'light'.
 */
export function normalizeTheme(theme) {
  const scheme = theme?.scheme === 'light' ? 'light' : 'dark';
  const base = builtInTheme(scheme === 'light' ? 'rigby-light' : 'rigby-dark');
  const colors = {};
  for (const { key } of THEME_KEYS) {
    const v = theme?.colors?.[key];
    colors[key] = parseColor(v) ? toHex(parseColor(v)) : base.colors[key];
  }
  const name = String(theme?.name ?? '').trim().slice(0, 60) || 'Untitled theme';
  return { id: String(theme?.id ?? ''), name, scheme, colors };
}

/**
 * The CSS custom properties a theme sets: the stylesheet's tokens (style.css :root) and the
 * themable colours it routes through var() (each falls back to Rigby Dark's when unset).
 */
export function themeTokens(theme) {
  const t = normalizeTheme(theme).colors;
  const light = normalizeTheme(theme).scheme === 'light';
  const overlay = light ? '#000000' : '#ffffff';
  const tokens = {
    // Surfaces and lines.
    '--surface-0': t.app0, '--surface-1': t.app, '--surface-2': t.panel, '--surface-3': t.control, '--surface-hover': t.hover,
    '--line': t.line, '--line-soft': alpha(overlay, light ? 0.08 : 0.07), '--line-strong': t.lineStrong,
    '--popup': t.popover, '--popup-bg': t.popover, '--popup-border': alpha(overlay, light ? 0.12 : 0.08),
    '--hover': alpha(overlay, light ? 0.05 : 0.06), '--overlay': overlay,
    '--well': t.app0, '--kbd-bg': t.control, '--scroll-thumb': t.lineStrong, '--scroll-thumb-hover': t.textFaint,
    // Text.
    '--fg': t.text, '--fg-strong': t.textStrong, '--fg-muted': t.textMuted, '--fg-muted-2': t.textMuted, '--fg-faint': t.textFaint,
    // Accent and state.
    '--ui-accent': t.accent, '--ui-accent-hover': mix(t.accent, light ? '#000000' : '#ffffff', 0.12), '--ui-accent-soft': alpha(t.accent, 0.2),
    '--ui-selected': t.selected, '--accent-soft': alpha(t.accent, 0.22), '--accent-tint': t.accent, '--accent-line': t.accent,
    '--accent-fg': t.accentText, '--on-accent': t.onAccent, '--info': t.focus,
    '--success': t.success, '--success-fg': t.success, '--success-tint': t.success,
    '--warning': t.warning, '--warning-fg': t.warning, '--warning-tint': t.warning,
    '--danger': t.danger, '--danger-fg': t.danger, '--danger-tint': t.danger,
    '--danger-line': mix(t.danger, t.panel, 0.45), '--danger-bg': mix(t.danger, t.panel, 0.82),
    '--slot-fg': mix(t.success, t.text, 0.45), '--mode-setup': t.modeSetup, '--mode-animate': t.modeAnimate,
    // The older names the stylesheet still uses.
    '--bg': t.app, '--panel': t.panel, '--widget': t.control, '--widget-hover': t.hover, '--border': t.line,
    '--text': t.text, '--weak': t.textMuted, '--accent': t.accent, '--selected': t.selected,
    // The viewport, timeline and graph canvases (canvascolors.js).
    '--canvas-bg': t.viewport, '--canvas-grid': t.viewportGrid,
    '--checker-a': mix(t.viewport, overlay, 0.04), '--checker-b': t.viewport,
    '--tl-bg': t.app0, '--tl-ruler': t.panel, '--tl-row': t.app, '--tl-row-hi': mix(t.app, t.accent, 0.16),
    '--tl-line': t.line, '--tl-tick': t.textFaint, '--tl-label': t.textMuted, '--tl-text': t.text, '--tl-dim': t.textFaint,
    '--tl-key': t.text,
    '--mark-bowl': light ? t.text : '#f4f4f5',
    '--ruler-bg': t.app0, '--ruler-corner': t.control, '--ruler-tick': t.lineStrong, '--ruler-text': t.textMuted, '--graph-grid': mix(t.app0, overlay, light ? 0.06 : 0.05), '--graph-axis': mix(t.app0, overlay, light ? 0.22 : 0.18),
  };
  return tokens;
}

// ---- Theme files --------------------------------------------------------------------------------

/** A theme as a .rigbytheme file's JSON text. */
export function serializeTheme(theme) {
  const t = normalizeTheme(theme);
  return `${JSON.stringify({ [THEME_FORMAT]: THEME_VERSION, name: t.name, scheme: t.scheme, colors: t.colors }, null, 2)}\n`;
}

/**
 * Reads a .rigbytheme file's text: { theme, warnings } (theme without an id), or throws with a
 * message for the person when it is not a theme. Missing or unreadable colours come from the base.
 */
export function parseTheme(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('not a theme file (it is not JSON)');
  }
  if (!data || typeof data !== 'object' || data[THEME_FORMAT] === undefined) throw new Error('not a Rigby2D theme file');
  if (Number(data[THEME_FORMAT]) > THEME_VERSION) throw new Error('this theme was made by a newer Rigby2D: update to use it');
  const warnings = [];
  for (const { key } of THEME_KEYS) {
    const v = data.colors?.[key];
    if (v === undefined) warnings.push(`${key}: missing, the base colour is used`);
    else if (!parseColor(v)) warnings.push(`${key}: '${String(v).slice(0, 40)}' is not a colour, the base colour is used`);
  }
  const theme = normalizeTheme({ name: data.name, scheme: data.scheme, colors: data.colors });
  delete theme.id;
  return { theme, warnings };
}

// ---- Applying a theme (needs a document) --------------------------------------------------------

/** The CSS properties applyTheme last set on each document, to clear them on the next. */
const applied = new WeakMap();

/**
 * Applies `theme` (a theme object, or null for the stylesheet's own Rigby Dark) to `doc`'s root:
 * sets or clears the tokens and the color scheme, then tells the canvases (`themechange` event).
 */
export function applyTheme(theme, doc = globalThis.document) {
  if (!doc?.documentElement) return;
  const root = doc.documentElement;
  for (const name of applied.get(doc) ?? []) root.style.removeProperty(name);
  const plain = !theme || theme.id === DEFAULT_THEME;
  const tokens = plain ? {} : themeTokens(theme);
  for (const [name, value] of Object.entries(tokens)) root.style.setProperty(name, value);
  applied.set(doc, Object.keys(tokens));
  root.style.colorScheme = plain ? '' : normalizeTheme(theme).scheme;
  root.dataset.theme = plain ? DEFAULT_THEME : theme.id || 'custom';
  doc.defaultView?.dispatchEvent(new Event('themechange'));
}

/** Every theme a person can pick: the built-ins, then their own (`custom`: { id: theme }). */
export function allThemes(custom = {}) {
  const own = Object.entries(custom ?? {})
    .filter(([, t]) => t && typeof t === 'object')
    .map(([id, t]) => ({ ...normalizeTheme(t), id, custom: true }));
  return [...BUILT_IN_THEMES.map((t) => ({ ...t, custom: false })), ...own];
}

/** The theme `id` among the built-ins and `custom`, or Rigby Dark. */
export function findTheme(id, custom = {}) {
  return allThemes(custom).find((t) => t.id === id) ?? { ...BUILT_IN_THEMES[0], custom: false };
}

/** A fresh id for a person's own theme. */
export function newThemeId(custom = {}) {
  for (let i = 1; ; i++) if (!custom[`custom-${i}`]) return `custom-${i}`;
}
