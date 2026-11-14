// SPDX-License-Identifier: MIT OR Apache-2.0
// View ▸ Themes… and the Themes dialog (themes.js): pick a theme, make your own from a copy, change
// its colours (live), import and export .rigbytheme files. Themes are colour only. The choice and
// people's own themes live in the preferences, so every window (detached panels too) follows.

import { STORAGE_KEY } from './prefs.js';
import { pickImportFiles, pickSaveTarget } from './platform.js';
import { THEME_EXTENSION, THEME_KEYS, allThemes, applyTheme, findTheme, newThemeId, normalizeTheme, parseTheme, serializeTheme } from './themes.js';
import { t } from './i18n.js';
import { button, dialog, hint } from './ui.js';
import { h } from './widgets.js';

const customOf = (app) => app.prefs.get('themes.custom');

/** The theme the preferences name, among the built-ins and the person's own. */
export const savedTheme = (app) => findTheme(app.prefs.get('interface.theme'), customOf(app));

/** The saved theme straight from storage (windows without the app's preferences: detached panels). */
function storedTheme() {
  try {
    const values = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '{}');
    return findTheme(values['interface.theme'], values['themes.custom'] ?? {});
  } catch {
    return findTheme(null);
  }
}

/**
 * Applies the saved theme and keeps it applied: when the preferences change here, and when another
 * window changes them (the storage event). `app` is null in a detached panel window.
 */
export function initThemes(app = null) {
  applyTheme(app ? savedTheme(app) : storedTheme());
  app?.prefs.onChange((key) => {
    if (key === null || key === 'interface.theme' || key === 'themes.custom') applyTheme(savedTheme(app));
  });
  globalThis.addEventListener?.('storage', (e) => {
    if (e.key === STORAGE_KEY) applyTheme(storedTheme());
  });
}

/** Uses theme `id` (saved for every window). */
export function useTheme(app, id) {
  app.prefs.set('interface.theme', id);
  app.changed?.();
}

/** Saves the person's own theme `theme` (by its id). */
function saveCustom(app, theme) {
  const custom = { ...customOf(app) };
  const { id, ...rest } = normalizeTheme(theme);
  custom[id] = rest;
  app.prefs.set('themes.custom', custom);
}

/** A theme card's small picture of the editor in its colours. */
function preview(theme) {
  const c = theme.colors;
  return h(
    'div',
    { class: 'theme-preview', style: `background:${c.app};border-color:${c.line}` },
    h('div', { class: 'theme-preview-bar', style: `background:${c.panel};border-color:${c.line}` }),
    h(
      'div',
      { class: 'theme-preview-body' },
      h('div', { class: 'theme-preview-view', style: `background:${c.viewport}` }),
      h('div', { class: 'theme-preview-side', style: `background:${c.panel}` }, h('div', { class: 'theme-preview-accent', style: `background:${c.accent}` }), h('div', { class: 'theme-preview-text', style: `background:${c.textMuted}` })),
    ),
  );
}

/** The Themes dialog. */
export function openThemes(app, { onClose = null } = {}) {
  const { body, setFooter } = dialog({ title: t('Themes'), subtitle: t('Colours only: layout, type and shortcuts stay the same.'), className: 'themes-dialog', onClose });
  const cards = h('div', { class: 'theme-cards' });
  const editor = h('div', { class: 'theme-editor' });
  const status = h('span', { class: 'theme-status weak' });

  const draw = () => {
    const current = savedTheme(app);
    cards.replaceChildren(
      ...allThemes(customOf(app)).map((theme) =>
        h(
          'button',
          {
            class: `theme-card${theme.id === current.id ? ' selected' : ''}`,
            'aria-pressed': theme.id === current.id ? 'true' : 'false',
            onclick: () => {
              useTheme(app, theme.id);
              draw();
            },
          },
          preview(theme),
          h('b', null, theme.custom ? theme.name : t(theme.name)),
          h('span', { class: 'weak' }, theme.custom ? t('Your theme') : theme.id === 'mammoth' ? t('New in 0.6') : theme.id === 'rigby-light' ? t('For bright rooms') : t('The default')),
        ),
      ),
      h(
        'button',
        {
          class: 'theme-card theme-new',
          title: t('A copy of the current theme, to change its colours'),
          onclick: () => {
            const custom = customOf(app);
            const id = newThemeId(custom);
            saveCustom(app, { ...current, id, name: t('{name} copy', { name: current.custom ? current.name : t(current.name) }) });
            useTheme(app, id);
            draw();
          },
        },
        h('span', { class: 'theme-new-plus' }, '+'),
        t('New theme'),
      ),
    );
    // Built-in themes cannot be deleted. (The button's display style would override `hidden`.)
    remove.style.display = current.custom ? '' : 'none';
    drawEditor(current);
  };

  const drawEditor = (theme) => {
    if (!theme.custom) {
      editor.replaceChildren(
        h('h4', null, t('Colours')),
        hint(t('Built-in themes stay as they are: New theme makes a copy whose colours you can change.')),
        swatches(theme, false),
      );
      return;
    }
    const name = h('input', {
      class: 'theme-name',
      value: theme.name,
      'aria-label': t('Theme name'),
      onchange: (e) => {
        saveCustom(app, { ...theme, name: e.target.value });
        draw();
      },
    });
    const scheme = h(
      'select',
      {
        'aria-label': t('Dark or light'),
        onchange: (e) => {
          saveCustom(app, { ...theme, scheme: e.target.value });
          draw();
        },
      },
      h('option', { value: 'dark', selected: theme.scheme === 'dark' }, t('Dark')),
      h('option', { value: 'light', selected: theme.scheme === 'light' }, t('Light')),
    );
    editor.replaceChildren(h('div', { class: 'theme-editor-head' }, name, scheme), swatches(theme, true));
  };

  /** The theme's colours by group; editable for the person's own themes (changes show at once). */
  const swatches = (theme, editable) => {
    const groups = [...new Set(THEME_KEYS.map((k) => k.group))];
    return h(
      'div',
      { class: 'theme-groups' },
      ...groups.map((group) =>
        h(
          'div',
          { class: 'theme-group' },
          h('h5', null, t(group)),
          ...THEME_KEYS.filter((k) => k.group === group).map(({ key, label }) => {
            const value = theme.colors[key];
            const set = (v) => {
              saveCustom(app, { ...theme, colors: { ...theme.colors, [key]: v } });
              theme = savedTheme(app);
            };
            return h(
              'label',
              { class: 'theme-color' },
              editable ? h('input', { type: 'color', value: value.slice(0, 7), oninput: (e) => set(e.target.value), onchange: () => draw() }) : h('span', { class: 'theme-swatch', style: `background:${value}` }),
              h('span', null, t(label)),
              h('code', null, value.toUpperCase()),
            );
          }),
        ),
      ),
    );
  };

  const importTheme = async () => {
    const [file] = (await pickImportFiles(t('Rigby2D theme'), [THEME_EXTENSION, 'json'], false)) ?? [];
    if (!file) return;
    try {
      const { theme, warnings } = parseTheme(new TextDecoder().decode(file.bytes));
      const id = newThemeId(customOf(app));
      saveCustom(app, { ...theme, id });
      useTheme(app, id);
      status.textContent = warnings.length ? t('Imported, with {count} colour(s) taken from the base theme', { count: warnings.length }) : t('Imported {name}', { name: theme.name });
      draw();
    } catch (e) {
      status.textContent = `${t('Could not import the theme')}: ${e.message}`;
    }
  };

  const exportTheme = async () => {
    const theme = savedTheme(app);
    const name = theme.custom ? theme.name : t(theme.name);
    const target = await pickSaveTarget(`${name.replace(/[\\/:*?"<>|]+/g, '-')}.${THEME_EXTENSION}`, t('Rigby2D theme'), THEME_EXTENSION, { single: true, download: true });
    if (!target) return;
    await target.fs.writeFile(target.path, new TextEncoder().encode(serializeTheme({ ...theme, name })));
    status.textContent = t('Exported {name}', { name });
  };

  const removeTheme = () => {
    const theme = savedTheme(app);
    if (!theme.custom) return;
    const custom = { ...customOf(app) };
    delete custom[theme.id];
    app.prefs.set('themes.custom', custom);
    useTheme(app, 'rigby-dark');
    status.textContent = t('Deleted {name}', { name: theme.name });
    draw();
  };

  const remove = button(t('Delete theme'), { icon: 'trash-2', kind: 'danger', title: t('Deletes your theme (built-in themes stay)'), onclick: removeTheme });
  body.append(
    cards,
    h(
      'div',
      { class: 'theme-actions' },
      button(t('Import theme…'), { icon: 'folder-open', onclick: importTheme }),
      button(t('Export theme…'), { icon: 'download', onclick: exportTheme }),
      remove,
      status,
    ),
    editor,
  );
  setFooter([hint(t('Share themes as .rigbytheme files: anyone can import them.'))]);
  draw();
}
