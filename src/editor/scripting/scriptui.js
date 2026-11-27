// SPDX-License-Identifier: MIT OR Apache-2.0
// Scripts in the editor: the script library (kept between sessions), the Scripts menu with the
// tools scripts add, and the script editor window.

import * as log from '../log.js';
import { makeDraggable, openLogWindow } from '../logwindow.js';
import { isDesktop, openExternal, pickImportFiles } from '../platform.js';
import { joinStatus, statusMessage, t } from '../i18n.js';
import { h, submenuItem } from '../widgets.js';
import { button, closeButton } from '../ui.js';
import { ScriptHost } from './host.js';
import { askToolArgs } from './toolform.js';
import { parseApi } from './apidoc.js';
import { createCodeEditor, errorLine, rigbyCompletion } from './codeeditor.js';
import moduleSource from './rigby.py?raw';

const STORAGE = 'rigby.scripts';

/** The Run button: disabled while a script runs (it carries data-run). */
function runButton(label, onclick) {
  const b = button(label, { kind: 'primary', icon: 'play', shortcut: 'Ctrl+Enter', onclick });
  b.dataset.run = '';
  return b;
}

/** What New script starts with. */
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

const GUIDE_URL = 'https://rigby2d.com/docs/scripting.html';

/** The API index for completion, parsed from rigby.py once. */
let apiIndex = null;
const scriptApi = () => (apiIndex ??= parseApi(moduleSource));

/** The scripting API at a glance, shown inside the script editor (the full guide is on rigby2d.com). */
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
  bone.remove()
SLOTS     rigby.slots()  rigby.slot(name)  rigby.add_slot(name, bone='root')   slot.bone  slot.attachments
          slot.attachment = name | None     slot.color = (r, g, b, a)   slot.remove()
          slot.key_attachment(name, time=None)  slot.key_color(rgba, time=None)  slot.keys('attachment'|'color')
DRAW      rigby.draw_order()  rigby.set_draw_order(slots)  anim.key_draw_order(slots | None, time=None)
MESHES    m = slot.mesh(name=None)   m.vertices  m.uvs  m.triangles  m.weights  m.world()
          m.set_vertices([(x, y), ...])   m.key([(dx, dy), ...], time=None)   (unweighted meshes)
ANIMATION rigby.animations()  rigby.animation(name)  rigby.add_animation(name, duration=0)
          rigby.current_animation()   anim.duration   anim.key(bone, channel, time, value)   anim.open()
SKINS     rigby.skins()  rigby.add_skin(name, copy=None)  rigby.set_skin(name)
          skin.add(slot, attachment)  skin.remove_attachment(slot, attachment)  skin.show()
EVENTS    rigby.add_event(name, int=0, float=0, string='')   event.key(time=None, string=None)
          anim.event_keys()   anim.delete_event_key(event, time=None)
CONSTRAINTS rigby.constraints()  rigby.add_ik(name, bones, target)  rigby.add_transform(name, bone, source)
          rigby.add_physics(name, bone)   c.mix  c.set(mix=0.5)  c.key(time=None, mix=1)  c.remove()
OUTPUT    print(...)  rigby.log / warn / error(...)  rigby.status(text)
TOOLS     @rigby.tool("Label", description="...")  def fn(bone: rigby.Bone, amount: float = 10): ...
          adds fn to the Scripts menu; its parameters become a form (params={"amount": {"min": 0}})
ERRORS    rigby.RigbyError: unknown names, invalid values
CONSOLE   the Console button: type Python against the project, Enter runs

One run (or one tool run) is one undo step; if it raises, the project is left as it was.
Full guide: the Guide button, or rigby2d.com/docs/scripting.html`;

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
    log.exception(e, { source: 'scripts', context: t('Could not store the script library') });
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
    /** Lines typed in the console, oldest first (Up and Down walk them). */
    this.consoleHistory = [];
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
    if (!quiet || failed) this.app.setStatus(failed ? statusMessage('{count} script(s) failed to load (details in View ▸ Log)', { count: failed }) : statusMessage('Loaded {count} script(s)', { count: this.library.length }));
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
      this.app.setStatus(statusMessage('Python could not start: {error}', { error: log.errorMessage(e) }));
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
    if (r.ok) this.app.setStatus(r.value.length ? statusMessage('{name}: added {tools} to the Scripts menu', { name, tools: r.value.join(', ') }) : statusMessage('Ran {name}', { name }));
    this.changed();
    return r;
  }

  remove(name) {
    this.library = this.library.filter((s) => s.name !== name);
    saveLibrary(this.library);
    this.host.forget(name);
    this.app.setStatus(statusMessage('Removed script {name}', { name }));
  }

  async addFiles() {
    const files = await this.app.guard(() => pickImportFiles(t('Python scripts'), ['py'], true));
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
    this.app.setStatus(statusMessage('Stopped the script. Python restarts with your library and add-ons.'));
    await this.loadAll({ quiet: true });
    await this.afterStop?.();
  }

  /** Runs a tool, after its form when it has parameters. */
  async runTool(tool) {
    const args = await askToolArgs(this.app, tool);
    if (args === null) return null;
    return this.host.runTool(tool.id, args);
  }

  /** Scripts menu entries. */
  menu() {
    const state = this.host.state;
    // A tool with parameters asks for them first (toolform.js); its label ends in … like any item that opens a form.
    const tool = (x) => ({
      label: x.params?.length ? `${x.label}…` : x.label,
      title: x.description || t('From {script}', { script: x.script }),
      disabled: this.host.running,
      action: () => this.runTool(x),
    });
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

  /** Opens the Script editor (its console as it was left: open or closed). */
  openEditor() {
    if (this.window) return this.window.focus();
    this.window = scriptEditor(this);
  }
}

const CONSOLE_KEY = 'rigby.scriptConsole';

/** Whether the console was open when the Script editor was last used (it opens the same way). */
function consoleWasOpen() {
  try {
    return localStorage.getItem(CONSOLE_KEY) === 'open';
  } catch {
    return false;
  }
}

function rememberConsole(open) {
  try {
    localStorage.setItem(CONSOLE_KEY, open ? 'open' : 'closed');
  } catch {
    // Not remembered: the console starts closed next time.
  }
}

/** The script editor: library on the left, code on the right, the console below, Run and Save. */
function scriptEditor(scripts) {
  const openConsole = consoleWasOpen();
  /** Scripts made with ＋ New that are not saved yet (in memory only, so nothing half-written loads at startup). */
  const unsaved = [];
  /** Edited text not saved yet, by script name: switching scripts keeps it. */
  const drafts = new Map();
  let current = null;
  const api = scriptApi();
  const doc = () => scripts.app.doc;
  const name = h('input', { type: 'text', class: 'script-name', spellcheck: false, placeholder: 'script.py' });
  const codeHost = h('div', { class: 'script-code' });
  const list = h('div', { class: 'script-list' });
  const state = h('span', { class: 'weak' });
  const reference = h('pre', { class: 'script-reference', hidden: true }, REFERENCE);
  const code = createCodeEditor(codeHost, {
    completion: rigbyCompletion(api, doc),
    onRun: () => run(false),
    onChange: (text) => {
      if (current === null) return;
      const before = drafts.has(current);
      drafts.set(current, text);
      if (!before) draw();
    },
  });

  // ---- console ----
  const output = h('div', { class: 'script-console-out', role: 'log', 'aria-live': 'polite' });
  const consoleInputHost = h('div', { class: 'script-console-in' });
  const consoleEl = h('div', { class: 'script-console', hidden: !openConsole }, output, h('div', { class: 'script-console-prompt' }, h('span', { class: 'weak' }, '>>>'), consoleInputHost));
  const echo = (cls, text) => {
    output.append(h('div', { class: `script-console-line ${cls}` }, text));
    output.scrollTop = output.scrollHeight;
  };
  const consoleInput = createCodeEditor(consoleInputHost, {
    console: true,
    history: scripts.consoleHistory,
    placeholder: t('Python: try rigby.bones(). Enter runs, Shift+Enter adds a line'),
    completion: rigbyCompletion(api, doc, (prefix) => scripts.host.consoleNames(prefix), () => scripts.consoleHistory.join('\n')),
    onSubmit: async (source) => {
      scripts.consoleHistory.push(source);
      echo('in', source.replace(/\n/g, '\n... '));
      if (scripts.host.state !== 'ready') echo('weak', t('Starting Python…'));
      let r;
      try {
        r = await scripts.host.runConsole(source);
      } catch (e) {
        echo('err', log.errorMessage(e));
        return;
      }
      for (const o of r.output ?? []) echo(o.level === 'info' ? 'print' : o.level, o.text);
      if (r.ok && r.value !== null) echo('value', r.value);
      if (!r.ok) echo('err', r.error);
      draw();
    },
  });
  const toggleConsole = (show = consoleEl.hidden) => {
    consoleEl.hidden = !show;
    consoleButton.classList.toggle('on', show);
    rememberConsole(show);
    if (show) consoleInput.focus();
  };

  const saved = (n) => scripts.library.find((x) => x.name === n);
  const names = () => [...scripts.library.map((x) => x.name), ...unsaved];
  const load = (n) => {
    current = n;
    name.value = n ?? '';
    code.setValue(drafts.get(n) ?? saved(n)?.source ?? '');
    draw();
  };
  /** New script: a new entry in the list, selected, with its name ready to type over. */
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
    code.clearError();
    state.textContent = scripts.host.state === 'ready' ? t('Running…') : t('Starting Python…');
    try {
      const n = fileName();
      if (save && n !== current && names().includes(n)) {
        state.textContent = `A script named ${n} already exists`;
        return;
      }
      const source = code.value();
      const r = save ? await scripts.save(n, source) : await scripts.run(n, source);
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
      if (r.ok && !save) scripts.app.setStatus(joinStatus(
        statusMessage('Ran {name}', { name: n }),
        r.value.length ? statusMessage('; tools: {tools}', { tools: r.value.join(', ') }) : '',
      ));
      state.textContent = r.ok ? t('Done') : t('Failed: {error}', { error: r.error });
      if (!r.ok) {
        // Point at the line the error comes from; the full traceback is in the log.
        const line = errorLine(r.trace, n);
        if (line) code.showError(line, r.error);
        else openLogWindow();
      }
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
  name.addEventListener('keydown', (e) => e.stopPropagation());

  const draw = () => {
    const item = (n) => {
      const tools = [...scripts.host.tools.values()].filter((x) => x.script === n).length;
      const isNew = unsaved.includes(n);
      return h(
        'div',
        {
          class: `script-item${n === current ? ' selected' : ''}${isNew ? ' unsaved' : ''}`,
          title: isNew ? t('New: not saved yet') : (saved(n)?.path ?? t('Stored in the editor')) + (drafts.has(n) ? t(' (unsaved changes)') : ''),
          onclick: () => n !== current && load(n),
        },
        h('span', null, `${n}${drafts.has(n) ? ' •' : ''}`),
        h('span', { class: 'weak' }, tools ? ` ${tools}` : ''),
      );
    };
    list.replaceChildren(...names().map(item), Object.assign(button(t('New script'), { kind: 'ghost', icon: 'plus', onclick: () => newScript() }), { className: 'ui-btn ui-btn-ghost script-new' }));
    if (!state.textContent) state.textContent = { idle: t('Python starts on first run'), loading: t('Starting Python…'), ready: t('Python ready'), failed: t('Python failed to start (see Log)') }[scripts.host.state];
  };

  const close = () => {
    el.remove();
    scripts.window = null;
  };
  const consoleButton = button(t('Console'), { icon: 'terminal', title: t('Type Python and see the result at once (the open project, one undo step per line that changes it)'), onclick: () => toggleConsole() });
  // Lit while the reference shows, like Console.
  const referenceButton = button(t('API reference'), {
    icon: 'book-open',
    title: t('Show or hide the scripting API'),
    onclick: () => {
      reference.hidden = !reference.hidden;
      referenceButton.classList.toggle('on', !reference.hidden);
    },
  });
  const header = h('div', { class: 'float-header' }, h('b', null, t('Script editor')), h('span', { class: 'float-spacer' }), closeButton(close));
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
        codeHost,
        reference,
        consoleEl,
        h(
          'div',
          { class: 'script-bar' },
          runButton(t('Run'), () => run(false)),
          h('button', { 'data-run': '', title: t('Keep in the library: it loads with the editor and its tools stay in the Scripts menu'), onclick: () => run(true) }, t('Save to library')),
          h(
            'button',
            {
              'data-run': '',
              title: t('Remove from the library'),
              onclick: remove,
            },
            t('Remove'),
          ),
          h('span', { class: 'float-spacer' }),
          consoleButton,
          referenceButton,
          button(t('Guide'), { icon: 'external-link', title: t('The scripting guide on rigby2d.com'), onclick: () => openExternal(GUIDE_URL) }),
        ),
      ),
    ),
  );
  makeDraggable(el, header);
  document.body.append(el);
  // The first script, or the example when the library is empty.
  if (scripts.library.length) load(scripts.library[0].name);
  else newScript(EXAMPLE);
  if (openConsole) consoleButton.classList.add('on');
  code.focus();
  return {
    el,
    focus: () => code.focus(),
    refresh: () => {
      state.textContent = '';
      draw();
    },
  };
}
