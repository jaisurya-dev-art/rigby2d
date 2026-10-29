// SPDX-License-Identifier: MIT OR Apache-2.0
// Add-ons (the package format is in addons.js): installing from a .zip or .py file, enabling,
// disabling and removing, and the Add-ons page of Edit ▸ Preferences. Installed add-ons are kept in
// the user data store under addons/<id>/; enabled ones load into Python (scripting/host.js) when
// the editor starts, and the tools they register appear in the Scripts menu.

import * as log from './log.js';
import * as platform from './platform.js';
import { VERSION, askChoice } from './helpui.js';
import { t } from './i18n.js';
import { icon } from './icons.js';
import { h } from './widgets.js';
import { ADDON_EXTENSIONS, MANIFEST_FILE, addonManifest, disableAddonPy, enableAddonPy, readAddonPackage } from './addons.js';

const DIR = 'addons';
const scriptName = (id) => `addon:${id}`;

export class AddonManager {
  constructor(app, scripts) {
    this.app = app;
    this.scripts = scripts;
    /** Installed add-ons by id: their manifests (rigby-addon.json). */
    this.installed = new Map();
    /** Load errors by id, shown on the Add-ons page. */
    this.errors = new Map();
    this.listeners = new Set();
  }

  get host() {
    return this.scripts.host;
  }

  enabled(id) {
    return !!this.app.prefs.get('addons.enabled')[id];
  }

  setEnabled(id, on) {
    const map = { ...this.app.prefs.get('addons.enabled') };
    if (on) map[id] = true;
    else delete map[id];
    this.app.prefs.set('addons.enabled', map);
  }

  changed() {
    for (const fn of this.listeners) fn();
  }

  /** Reads the installed add-ons' manifests. */
  async refresh() {
    this.installed.clear();
    for (const f of await platform.userStore.list(DIR)) {
      const m = new RegExp(`^${DIR}/([^/]+)/${MANIFEST_FILE.replace('.', '\\.')}$`).exec(f.path);
      if (!m) continue;
      try {
        this.installed.set(m[1], JSON.parse(await platform.userStore.getText(f.path)));
      } catch (e) {
        log.warn(`Add-on ${m[1]}: unreadable ${MANIFEST_FILE} (${e.message})`, { source: 'add-ons' });
      }
    }
    this.changed();
    return this.installed;
  }

  /** Loads every enabled add-on (at startup). */
  async loadEnabled() {
    await this.refresh();
    const ids = [...this.installed.keys()].filter((id) => this.enabled(id));
    for (const id of ids) await this.load(id);
    if (ids.length) log.info(`Loaded ${ids.length} add-on(s)`, { source: 'add-ons' });
  }

  /** Copies an add-on's files into the sandboxed Python (/addons/<id>/) and runs its register(). */
  async load(id) {
    try {
      const files = [];
      for (const f of await platform.userStore.list(`${DIR}/${id}`)) {
        const rel = f.path.slice(`${DIR}/${id}/`.length);
        if (rel !== MANIFEST_FILE) files.push({ path: rel, bytes: await platform.userStore.get(f.path) });
      }
      const copied = await this.host.request({ type: 'files', root: `/addons/${id}`, files });
      if (!copied.ok) throw new Error(copied.error);
      const result = await this.host.runScript(scriptName(id), enableAddonPy(id));
      if (!result.ok) throw new Error(result.error);
      this.errors.delete(id);
      return true;
    } catch (e) {
      this.errors.set(id, String(e?.message ?? e));
      log.error(`Add-on ${this.installed.get(id)?.name ?? id} could not load: ${e?.message ?? e}`, { source: 'add-ons' });
      return false;
    } finally {
      this.changed();
    }
  }

  /** Runs an add-on's unregister() and removes its tools. */
  async unload(id) {
    if (this.host.state === 'ready') await this.host.runScript(scriptName(id), disableAddonPy(id));
    this.host.forget(scriptName(id));
    this.errors.delete(id);
    this.changed();
  }

  async enable(id, on) {
    this.setEnabled(id, on);
    if (on) await this.load(id);
    else await this.unload(id);
  }

  /** Installs (or updates) an add-on from a picked .zip or .py file, then enables it. */
  async install(file) {
    const name = String(file.name).split(/[\\/]/).pop();
    const pkg = readAddonPackage(name, file.bytes);
    const init = new TextDecoder().decode(pkg.files.get('__init__.py'));
    const read = await this.host.request({ type: 'readInfo', source: init });
    if (!read.ok) throw new Error(`could not read addon_info: ${String(read.error).split('\n').filter(Boolean).pop()}`);
    const info = read.info;
    const manifest = addonManifest(pkg.id, info, { editorVersion: VERSION, file: name });
    const existing = this.installed.get(pkg.id);
    if (existing) {
      const ok = await askChoice('Replace add-on?', `${existing.name} ${existing.version} is installed. Replace it with ${manifest.version || 'this version'}?`, [
        { id: 'cancel', label: 'Cancel' },
        { id: 'replace', label: 'Replace', primary: true },
      ]);
      if (ok !== 'replace') return null;
      if (this.enabled(pkg.id)) await this.unload(pkg.id);
      await platform.userStore.remove(`${DIR}/${pkg.id}`);
    }
    for (const [rel, bytes] of pkg.files) await platform.userStore.put(`${DIR}/${pkg.id}/${rel}`, bytes);
    await platform.userStore.putText(`${DIR}/${pkg.id}/${MANIFEST_FILE}`, JSON.stringify(manifest, null, 2));
    this.installed.set(pkg.id, manifest);
    this.setEnabled(pkg.id, true);
    await this.load(pkg.id);
    return manifest;
  }

  async remove(id) {
    if (this.enabled(id)) await this.unload(id);
    this.setEnabled(id, false);
    await platform.userStore.remove(`${DIR}/${id}`);
    if (this.host.engine) await this.host.request({ type: 'removeFiles', root: `/addons/${id}` });
    this.installed.delete(id);
    this.changed();
  }
}

/** The add-on gallery's index on the website (addons/gallery.json in the repository). */
export const GALLERY_URL = 'https://rigby2d.com/addons/index.json';

/** The Add-ons page of the Preferences dialog: installed add-ons, and the gallery. */
export function renderAddonsPage(manager, el) {
  const app = manager.app;
  let query = '';
  let tab = 'installed';
  let gallery = null;
  let galleryError = null;
  const list = h('div', { class: 'addon-list' });
  const matches = (m) => !query || `${m.name} ${m.description} ${m.author}`.toLowerCase().includes(query);

  const installedRow = (m) => {
    const error = manager.errors.get(m.id);
    return h(
      'div',
      { class: `addon${error ? ' failed' : ''}` },
      h('span', { class: 'addon-icon' }, icon('puzzle', 18)),
      h('input', { type: 'checkbox', checked: manager.enabled(m.id), title: t('Enabled'), 'aria-label': t('Enable {name}', { name: m.name }), onchange: (e) => manager.enable(m.id, e.target.checked) }),
      h(
        'div',
        { class: 'addon-text' },
        h('div', { class: 'addon-name' }, m.name, h('span', { class: 'weak' }, ` ${m.version}`)),
        m.description ? h('div', null, m.description) : null,
        h('div', { class: 'weak' }, [m.author && t('by {author}', { author: m.author }), `id ${m.id}`].filter(Boolean).join(' · ')),
        error ? h('div', { class: 'addon-error' }, t('Failed to load: {error} (View ▸ Log)', { error })) : null,
      ),
      m.url ? h('button', { title: m.url, onclick: () => platform.openExternal(m.url) }, t('Docs ↗')) : null,
      h(
        'button',
        {
          onclick: async () => {
            const ok = await askChoice(t('Remove add-on?'), t('Remove {name}? Its tools leave the Scripts menu.', { name: m.name }), [
              { id: 'cancel', label: t('Cancel') },
              { id: 'remove', label: t('Remove'), primary: true },
            ]);
            if (ok === 'remove') await manager.remove(m.id);
          },
        },
        t('Remove'),
      ),
    );
  };

  const galleryRow = (a) => {
    const have = manager.installed.get(a.id);
    const current = have && have.version === a.version;
    return h(
      'div',
      { class: 'addon' },
      h('span', { class: `addon-icon${a.official ? ' official' : ''}` }, icon('puzzle', 18)),
      h(
        'div',
        { class: 'addon-text' },
        h('div', { class: 'addon-name' }, a.name, h('span', { class: 'weak' }, ` ${a.version}`), a.official ? h('span', { class: 'addon-badge' }, t('Official')) : null),
        h('div', null, a.description),
        h('div', { class: 'weak' }, t('by {author}', { author: a.author })),
      ),
      a.repo ? h('button', { onclick: () => platform.openExternal(a.repo) }, t('Source ↗')) : null,
      h(
        'button',
        {
          class: current ? '' : 'primary',
          disabled: current,
          onclick: async (e) => {
            e.target.disabled = true;
            try {
              app.setStatus(t('Downloading {name}…', { name: a.name }));
              const m = await manager.install({ name: `${a.id}.zip`, bytes: await platform.fetchBytes(a.url) });
              if (m) app.setStatus(t('Installed the add-on {name} {version}', { name: m.name, version: m.version }));
            } catch (err) {
              app.setStatus(t('Could not install the add-on: {error}', { error: err?.message ?? err }));
            }
            draw();
          },
        },
        current ? t('Installed') : have ? t('Update') : t('Install'),
      ),
    );
  };

  const tabs = h('div', { class: 'segmented addon-tabs' });
  const draw = () => {
    for (const b of tabs.children) b.classList.toggle('active', b.dataset.tab === tab);
    if (tab === 'installed') {
      const items = [...manager.installed.values()].filter(matches).sort((a, b) => a.name.localeCompare(b.name));
      list.replaceChildren(...(items.length ? items.map(installedRow) : [h('p', { class: 'dialog-empty' }, manager.installed.size ? t('No add-on matches.') : t('No add-ons installed yet. Get some from the gallery.'))]));
    } else if (galleryError) list.replaceChildren(h('p', { class: 'dialog-empty' }, t('The gallery could not be loaded: {error}', { error: galleryError })));
    else if (!gallery) list.replaceChildren(h('p', { class: 'dialog-empty' }, t('Loading the gallery…')));
    else {
      const items = gallery.filter(matches);
      list.replaceChildren(...(items.length ? items.map(galleryRow) : [h('p', { class: 'dialog-empty' }, t('No add-on matches.'))]));
    }
  };

  const loadGallery = async () => {
    if (gallery) return;
    try {
      gallery = JSON.parse(new TextDecoder().decode(await platform.fetchBytes(GALLERY_URL))).addons ?? [];
    } catch (e) {
      galleryError = e?.message ?? String(e);
    }
    draw();
  };

  tabs.append(
    h('button', { 'data-tab': 'installed', onclick: () => ((tab = 'installed'), draw()) }, t('Installed')),
    h('button', { 'data-tab': 'gallery', onclick: () => ((tab = 'gallery'), draw(), loadGallery()) }, t('Get add-ons')),
  );
  const install = async () => {
    const [file] = await platform.pickImportFiles(t('Rigby2D add-on (.zip, .py)'), ADDON_EXTENSIONS, false);
    if (!file) return;
    try {
      const m = await manager.install(file);
      if (m) app.setStatus(t('Installed the add-on {name} {version}', { name: m.name, version: m.version }));
    } catch (e) {
      app.setStatus(t('Could not install the add-on: {error}', { error: e?.message ?? e }));
    }
  };
  const where = h('code', { class: 'addon-folder' }, '…');
  platform.userStore.location(DIR).then((path) => (where.textContent = path));
  el.append(
    h(
      'div',
      { class: 'dialog-toolbar' },
      tabs,
      h('input', { type: 'search', class: 'dialog-search', placeholder: t('Search add-ons'), 'aria-label': t('Search add-ons'), oninput: (e) => ((query = e.target.value.trim().toLowerCase()), draw()) }),
      h('button', { onclick: install }, t('Install from file…')),
    ),
    list,
    h(
      'p',
      { class: 'pref-note' },
      t('Add-ons are Python packages (.zip) or modules (.py) that add tools to the Scripts menu. They run sandboxed: they can change the open project, but not your files or the network. Installed in'),
      ' ',
      where,
      '.',
    ),
  );
  manager.listeners.add(draw);
  draw();
  manager.refresh();
  return () => manager.listeners.delete(draw);
}
