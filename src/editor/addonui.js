// SPDX-License-Identifier: MIT OR Apache-2.0
// Add-ons (the package format is in addons.js): installing from a .zip or .py file, enabling,
// disabling and removing, and the Add-ons page of Edit ▸ Preferences. Installed add-ons are kept in
// the user data store under addons/<id>/; enabled ones load into Python (scripting/host.js) when
// the editor starts, and the tools they register appear in the Scripts menu.

import * as log from './log.js';
import * as platform from './platform.js';
import { VERSION, askChoice } from './helpui.js';
import { h } from './widgets.js';
import { ADDON_EXTENSIONS, MANIFEST_FILE, READ_INFO_PY, addonManifest, disableAddonPy, enableAddonPy, readAddonPackage } from './addons.js';

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

  /** Copies an add-on's files into Python (/addons/<id>/) and runs its register(). */
  async load(id) {
    try {
      const py = await this.host.ready();
      const root = `/addons/${id}`;
      removeTree(py.FS, root);
      for (const f of await platform.userStore.list(`${DIR}/${id}`)) {
        const rel = f.path.slice(`${DIR}/${id}/`.length);
        if (rel === MANIFEST_FILE) continue;
        const target = `${root}/${rel}`;
        py.FS.mkdirTree(target.slice(0, target.lastIndexOf('/')));
        py.FS.writeFile(target, await platform.userStore.get(f.path));
      }
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
    const py = await this.host.ready();
    const init = new TextDecoder().decode(pkg.files.get('__init__.py'));
    py.globals.set('_addon_source', init);
    let info;
    try {
      info = JSON.parse(py.runPython(READ_INFO_PY));
    } catch (e) {
      throw new Error(`could not read addon_info: ${String(e?.message ?? e).split('\n').filter(Boolean).pop()}`);
    } finally {
      py.globals.delete('_addon_source');
    }
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
    if (this.host.py) removeTree(this.host.py.FS, `/addons/${id}`);
    this.installed.delete(id);
    this.changed();
  }
}

/** Removes a folder and everything in it from Pyodide's file system (if it exists). */
function removeTree(FS, path) {
  let stat;
  try {
    stat = FS.stat(path);
  } catch {
    return;
  }
  if (!FS.isDir(stat.mode)) return FS.unlink(path);
  for (const name of FS.readdir(path)) if (name !== '.' && name !== '..') removeTree(FS, `${path}/${name}`);
  FS.rmdir(path);
}

/** The Add-ons page of the Preferences dialog. */
export function renderAddonsPage(manager, el) {
  const app = manager.app;
  let query = '';
  const list = h('div', { class: 'addon-list' });
  const draw = () => {
    const items = [...manager.installed.values()]
      .filter((m) => !query || `${m.name} ${m.description} ${m.author}`.toLowerCase().includes(query))
      .sort((a, b) => a.name.localeCompare(b.name));
    list.replaceChildren(
      ...(items.length
        ? items.map((m) => {
            const error = manager.errors.get(m.id);
            return h(
              'div',
              { class: `addon${error ? ' failed' : ''}` },
              h('input', { type: 'checkbox', checked: manager.enabled(m.id), title: 'Enabled', 'aria-label': `Enable ${m.name}`, onchange: (e) => manager.enable(m.id, e.target.checked) }),
              h(
                'div',
                { class: 'addon-text' },
                h('div', { class: 'addon-name' }, m.name, h('span', { class: 'weak' }, ` ${m.version}`)),
                m.description ? h('div', null, m.description) : null,
                h('div', { class: 'weak' }, [m.author && `by ${m.author}`, `id ${m.id}`].filter(Boolean).join(' · ')),
                error ? h('div', { class: 'addon-error' }, `Failed to load: ${error} (View ▸ Log)`) : null,
              ),
              m.url ? h('button', { title: m.url, onclick: () => platform.openExternal(m.url) }, 'Docs ↗') : null,
              h(
                'button',
                {
                  onclick: async () => {
                    const ok = await askChoice('Remove add-on?', `Remove ${m.name}? Its tools leave the Scripts menu.`, [
                      { id: 'cancel', label: 'Cancel' },
                      { id: 'remove', label: 'Remove', primary: true },
                    ]);
                    if (ok === 'remove') await manager.remove(m.id);
                  },
                },
                'Remove',
              ),
            );
          })
        : [h('p', { class: 'dialog-empty' }, manager.installed.size ? 'No add-on matches.' : 'No add-ons installed yet.')]),
    );
  };
  const install = async () => {
    const [file] = await platform.pickImportFiles('Rigby2D add-on (.zip, .py)', ADDON_EXTENSIONS, false);
    if (!file) return;
    try {
      const m = await manager.install(file);
      if (m) app.setStatus(`Installed the add-on ${m.name} ${m.version}`);
    } catch (e) {
      app.setStatus(`Could not install the add-on: ${e?.message ?? e}`);
    }
  };
  const where = h('code', { class: 'addon-folder' }, '…');
  platform.userStore.location(DIR).then((path) => (where.textContent = path));
  el.append(
    h(
      'div',
      { class: 'dialog-toolbar' },
      h('input', { type: 'search', class: 'dialog-search', placeholder: 'Search add-ons', 'aria-label': 'Search add-ons', oninput: (e) => ((query = e.target.value.trim().toLowerCase()), draw()) }),
      h('button', { class: 'primary', onclick: install }, 'Install from file…'),
    ),
    list,
    h(
      'p',
      { class: 'pref-note' },
      'Add-ons are Python packages (.zip) or modules (.py) that add tools to the Scripts menu. They run with the same access as the editor, so install add-ons only from people you trust. Installed in ',
      where,
      '.',
    ),
  );
  const off = (() => {
    manager.listeners.add(draw);
    return () => manager.listeners.delete(draw);
  })();
  draw();
  manager.refresh();
  return off;
}
