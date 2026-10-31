// SPDX-License-Identifier: MIT OR Apache-2.0
// Scripts in the editor: the script library (kept between sessions), the Scripts menu with the
// tools scripts add, and the script editor window.

import * as log from '../log.js';
import { makeDraggable, openLogWindow } from '../logwindow.js';
import { isDesktop, pickImportFiles } from '../platform.js';
import { t } from '../i18n.js';
import { h, submenuItem } from '../widgets.js';
import { ScriptHost } from './host.js';

const STORAGE = 'rigby.scripts';

/** What ＋ New script starts with. */
const NEW_SCRIPT = `import rigby

# Run with Ctrl+Enter. Save to library keeps it and loads it with the editor.
# @rigby.tool("Label") turns a function into a Scripts menu item. See API reference.
`;

const EXAMPLE = `import rigby

# Scripts edit the open project. A run is one undo step; errors roll it back (see View > Log).
print("Bones:", ", ".join(b.name for b in rigby.bones()))


@rigby.tool("Mirror selected bones", description="Flip the selected bones across X = 0")
def mirror():
    for bone in rigby.selected_bones():
        bone.set(x=-bone.x, rotation=180 - bone.rotation)
`;

/** The scripting API at a glance, shown inside the script editor (the full guide is docs/scripting.md). */
const REFERENCE = `import rigby

PROJECT   rigby.info()  rigby.fps()  rigby.mode() / set_mode('setup'|'animate')
          rigby.time() / set_time(seconds)
BONES     rigby.bones()  rigby.bone(name)  rigby.selected_bones()  rigby.select(*bones)
          rigby.add_bone(name, parent='root', x=0, y=0, rotation=0, length=0)
  bone.x .y .rotation .scale_x .scale_y .shear_x .shear_y .length .name   (setup pose)
  bone.set(x=.., rotation=..)   bone.parent   bone.children   bone.world
  bone.key(channel, value, time=None, animation=None, curve='linear')
  bone.keys(channel)   bone.delete_key(channel, time=None)
  channels: 'rotate' (degrees added), 'translate' / 'shear' ((x, y) added), 'scale' ((x, y) factors)
  curves: 'linear' 'stepped' 'ease_in' 'ease_out' 'ease_in_out'
SLOTS     rigby.slots()  rigby.slot(name)   slot.bone  slot.attachments
          slot.attachment = name | None     slot.color = (r, g, b, a)
ANIMATION rigby.animations()  rigby.animation(name)  rigby.add_animation(name, duration=0)
          rigby.current_animation()   anim.duration   anim.key(bone, channel, time, value)   anim.open()
OUTPUT    print(...)  rigby.log / warn / error(...)  rigby.status(text)
TOOLS     @rigby.tool("Label", description="...")  def fn(): ...   adds fn to the Scripts menu
ERRORS    rigby.RigbyError: unknown names, invalid values

One run (or one tool run) is one undo step; if it raises, the project is left as it was.
Full guide: docs/scripting.md in the Rigby2D repository.`;

/** Library entries: { name, source, path (desktop file it was added from, or null) }. */
function loadLibrary() {
  try {
    const list = JSON.parse(localStorage.getItem(STORAGE) ?? '[]');
    return Array.isArray(list) ? list.filter((s) => s && typeof s.name === 'string' && typeof s.source === 'string') : [];
  } catch {
    return [];
  }
}

function saveLibrary(list) {
  try {
    localStorage.setItem(STORAGE, JSON.stringify(list));
  } catch (e) {
    log.exception(e, { source: 'scripts', context: 'Could not store the script library' });
  }
}

export class Scripts {
  constructor(app) {
    this.app = app;
    this.library = loadLibrary();
    // Python runs sandboxed in a worker (host.js).
    this.host = new ScriptHost(app, { onChange: () => this.changed() });
    /** Called after Stop restarts Python, to load add-ons again. */
    this.afterStop = null;
    this.window = null;
  }

  changed() {
    this.window?.refresh();
    this.app.changed();
  }

  /** Loads every library script (re-reading desktop files), registering their tools. */
  async loadAll({ quiet = false } = {}) {
    if (!this.library.length) return;
    await this.refreshFiles();
    let failed = 0;
    for (const s of this.library) if (!(await this.run(s.name, s.source)).ok) failed++;
    if (!quiet || failed) this.app.setStatus(failed ? `${failed} script(s) failed to load (details in View ▸ Log)` : `Loaded ${this.library.length} script(s)`);
  }

  /** Desktop: scripts added from files are re-read, so editing them in another editor works. */
  async refreshFiles() {
    if (!isDesktop) return;
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    for (const s of this.library) {
      if (!s.path) continue;
      try {
        s.source = await readTextFile(s.path);
      } catch (e) {
        log.warn(`Could not re-read ${s.path}: ${log.errorMessage(e)}; using the stored copy`, { source: s.name });
      }
    }
    saveLibrary(this.library);
  }

  async run(name, source) {
    try {
      return await this.host.runScript(name, source);
    } catch (e) {
      // Python itself did not start; the host has logged why.
      this.app.setStatus(`Python could not start: ${log.errorMessage(e)}`);
      return { ok: false, error: log.errorMessage(e) };
    }
  }

  /** Adds or replaces a library script, then runs it. */
  async save(name, source, path = null) {
    const existing = this.library.find((s) => s.name === name);
    if (existing) Object.assign(existing, { source, path: path ?? existing.path });
    else this.library.push({ name, source, path });
    saveLibrary(this.library);
    const r = await this.run(name, source);
    if (r.ok) this.app.setStatus(r.value.length ? `${name}: added ${r.value.join(', ')} to the Scripts menu` : `Ran ${name}`);
    this.changed();
    return r;
  }

  remove(name) {
    this.library = this.library.filter((s) => s.name !== name);
    saveLibrary(this.library);
    this.host.forget(name);
    this.app.setStatus(`Removed script ${name}`);
  }

  async addFiles() {
    const files = await this.app.guard(() => pickImportFiles('Python scripts', ['py'], true));
    if (!files?.length) return;
    for (const f of files) {
      const name = f.name.split(/[\\/]/).pop();
      await this.save(name, new TextDecoder().decode(f.bytes), isDesktop ? f.name : null);
    }
  }

  async reload() {
    await this.host.ready().catch(() => null);
    if (this.host.state !== 'ready') return;
    for (const s of this.library) this.host.forget(s.name);
    await this.loadAll();
  }

  /** Stops a script that runs too long; the library's tools load again. */
  async stop() {
    this.host.stop();
    this.app.setStatus('Stopped the script. Python restarts with your library and add-ons.');
    await this.loadAll({ quiet: true });
    await this.afterStop?.();
  }

  /** Scripts menu entries. */
  menu() {
    const state = this.host.state;
    const tool = (x) => ({ label: x.label, title: x.description || t('From {script}', { script: x.script }), disabled: this.host.running, action: () => this.host.runTool(x.id) });
    // Each add-on's tools sit in a submenu named after it (one tool stays a plain item), so the menu
    // stays short however many add-ons are installed; tools from your own scripts follow.
    const byScript = new Map();
    for (const x of this.host.tools.values()) byScript.set(x.script, [...(byScript.get(x.script) ?? []), x]);
    const addons = [...byScript].filter(([s]) => s.startsWith('addon:')).map(([s, list]) => [this.addonName?.(s.slice(6)) ?? s.slice(6), list]);
    addons.sort((a, b) => a[0].localeCompare(b[0]));
    const own = [...byScript].filter(([s]) => !s.startsWith('addon:')).flatMap(([, list]) => list);
    const tools = [
      ...addons.map(([name, list]) => (list.length === 1 ? tool(list[0]) : submenuItem(name, list.map(tool)))),
      ...(addons.length && own.length ? ['separator'] : []),
      ...own.map(tool),
    ];
    return [
      { label: t('Script editor…'), action: () => this.openEditor() },
      { label: t('Add script files (.py)…'), action: () => this.addFiles() },
      { label: t('Reload scripts'), disabled: !this.library.length, action: () => this.reload() },
      { label: t('Log'), action: () => openLogWindow() },
      ...(this.host.running ? [{ label: t('Stop the running script'), action: () => this.stop() }] : []),
      'separator',
      ...(state === 'loading'
        ? [{ label: t('Starting Python…'), disabled: true }]
        : tools.length
          ? tools
          : [{ label: this.library.length ? t('No tools: scripts add them with @rigby.tool') : t('No scripts yet: open the Script editor'), disabled: true }]),
    ];
  }

  openEditor() {
    if (this.window) return this.window.el.querySelector('textarea').focus();
    this.window = scriptEditor(this);
  }
}

/** The script editor: library on the left, code on the right, Run and Save. */
function scriptEditor(scripts) {
  /** Scripts made with ＋ New that are not saved yet (in memory only, so nothing half-written loads at startup). */
  const unsaved = [];
  /** Edited text not saved yet, by script name: switching scripts keeps it. */
  const drafts = new Map();
  let current = null;
  const name = h('input', { type: 'text', class: 'script-name', spellcheck: false, placeholder: 'script.py' });
  const code = h('textarea', { class: 'script-code', spellcheck: false, wrap: 'off' });
  const list = h('div', { class: 'script-list' });
  const state = h('span', { class: 'weak' });
  const reference = h('pre', { class: 'script-reference', hidden: true }, REFERENCE);

  const saved = (n) => scripts.library.find((x) => x.name === n);
  const names = () => [...scripts.library.map((x) => x.name), ...unsaved];
  const load = (n) => {
    current = n;
    name.value = n ?? '';
    code.value = drafts.get(n) ?? saved(n)?.source ?? '';
    draw();
  };
  /** ＋ New script: a new entry in the list, selected, with its name ready to type over. */
  const newScript = (source = NEW_SCRIPT) => {
    let n = 'new_script.py';
    for (let i = 2; names().includes(n); i++) n = `new_script_${i}.py`;
    unsaved.push(n);
    drafts.set(n, source);
    load(n);
    name.focus();
    name.setSelectionRange(0, n.length - 3);
  };
  const fileName = () => {
    const n = name.value.trim() || 'script.py';
    return n.endsWith('.py') ? n : `${n}.py`;
  };
  const busy = (on) => {
    for (const b of el.querySelectorAll('button[data-run]')) b.disabled = on;
  };
  const run = async (save) => {
    busy(true);
    state.textContent = scripts.host.state === 'ready' ? 'Running…' : 'Starting Python…';
    try {
      const n = fileName();
      if (save && n !== current && names().includes(n)) {
        state.textContent = `A script named ${n} already exists`;
        return;
      }
      const r = save ? await scripts.save(n, code.value) : await scripts.run(n, code.value);
      if (save) {
        // Saved under its (possibly new) name: the old entry or draft goes.
        if (current && current !== n) {
          if (saved(current)) scripts.remove(current);
          drafts.delete(current);
        }
        const i = unsaved.indexOf(current);
        if (i >= 0) unsaved.splice(i, 1);
        drafts.delete(n);
        current = n;
      }
      if (r.ok && !save) scripts.app.setStatus(`Ran ${n}${r.value.length ? `; tools: ${r.value.join(', ')}` : ''}`);
      state.textContent = r.ok ? 'Done' : `Failed: ${r.error}`;
      if (!r.ok) openLogWindow();
    } finally {
      busy(false);
      draw();
    }
  };
  const remove = () => {
    if (current === null) return;
    const i = unsaved.indexOf(current);
    if (i >= 0) unsaved.splice(i, 1);
    else if (saved(current)) scripts.remove(current);
    drafts.delete(current);
    const next = names()[0];
    if (next) load(next);
    else newScript();
  };
  code.addEventListener('input', () => {
    if (current === null) return;
    const before = drafts.has(current);
    drafts.set(current, code.value);
    if (!before) draw();
  });
  code.addEventListener('keydown', (e) => {
    // The editor's shortcuts stay out of the code; Tab indents, Ctrl+Enter runs.
    e.stopPropagation();
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      run(false);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      const { selectionStart: a, selectionEnd: b } = code;
      code.setRangeText('    ', a, b, 'end');
      drafts.set(current, code.value);
    }
  });
  name.addEventListener('keydown', (e) => e.stopPropagation());

  const draw = () => {
    const item = (n) => {
      const tools = [...scripts.host.tools.values()].filter((x) => x.script === n).length;
      const isNew = unsaved.includes(n);
      return h(
        'div',
        {
          class: `script-item${n === current ? ' selected' : ''}${isNew ? ' unsaved' : ''}`,
          title: isNew ? 'New: not saved yet' : (saved(n)?.path ?? 'Stored in the editor') + (drafts.has(n) ? ' (unsaved changes)' : ''),
          onclick: () => n !== current && load(n),
        },
        h('span', null, `${n}${drafts.has(n) ? ' •' : ''}`),
        h('span', { class: 'weak' }, tools ? ` ${tools}` : ''),
      );
    };
    list.replaceChildren(...names().map(item), h('button', { class: 'script-new', onclick: () => newScript() }, '＋ New script'));
    if (!state.textContent) state.textContent = { idle: 'Python starts on first run', loading: 'Starting Python…', ready: 'Python ready', failed: 'Python failed to start (see Log)' }[scripts.host.state];
  };

  const close = () => {
    el.remove();
    scripts.window = null;
  };
  const header = h('div', { class: 'float-header' }, h('b', null, 'Script editor'), h('span', { class: 'float-spacer' }), h('button', { title: 'Close', onclick: close }, '✕'));
  const el = h(
    'div',
    { class: 'float-window script-window' },
    header,
    h(
      'div',
      { class: 'script-body' },
      list,
      h(
        'div',
        { class: 'script-main' },
        h('div', { class: 'script-bar' }, name, h('span', { class: 'float-spacer' }), state),
        code,
        reference,
        h(
          'div',
          { class: 'script-bar' },
          h('button', { 'data-run': '', class: 'primary', title: 'Ctrl+Enter', onclick: () => run(false) }, '▶ Run'),
          h('button', { 'data-run': '', title: 'Keep in the library: it loads with the editor and its tools stay in the Scripts menu', onclick: () => run(true) }, 'Save to library'),
          h(
            'button',
            {
              'data-run': '',
              title: 'Remove from the library',
              onclick: remove,
            },
            'Remove',
          ),
          h('span', { class: 'float-spacer' }),
          // Built in rather than a web link: the desktop app has no browser to open links in.
          h('button', { title: 'Show or hide the scripting API', onclick: () => (reference.hidden = !reference.hidden) }, 'API reference'),
        ),
      ),
    ),
  );
  makeDraggable(el, header);
  document.body.append(el);
  // The first script, or the example when the library is empty.
  if (scripts.library.length) load(scripts.library[0].name);
  else newScript(EXAMPLE);
  code.focus();
  return {
    el,
    refresh: () => {
      state.textContent = '';
      draw();
    },
  };
}
