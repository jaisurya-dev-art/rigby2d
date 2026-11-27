// SPDX-License-Identifier: MIT OR Apache-2.0
// Crash manager and file recovery (the rules are in recovery.js):
// - Auto-save: unsaved work is written to the recovery folder every few minutes (Preferences).
// - Sessions: a heartbeat marks this editor as running; at the next start, work from an editor that
//   crashed or was killed is offered back.
// - Errors: an uncaught error auto-saves at once and offers a crash report.
// - Quitting with unsaved changes asks Save / Don't save / Cancel; the discarded work is still
//   kept as the "last session" until the next quit (File ▸ Recover).

import * as log from './log.js';
import * as platform from './platform.js';
import { LINKS, VERSION, askChoice, dialog } from './helpui.js';
import { statusMessage, t } from './i18n.js';
import { h } from './widgets.js';
import { button, uiIcon } from './ui.js';
import { listConstraints } from '../core/constraintdata.js';
import { vertexCount } from '../core/model.js';
import { HEARTBEAT_MS, QUIT_FILE, crashReport, crashedSessions, deadSessions, newSessionId, sessionAutosave } from './recovery.js';

const SESSIONS_KEY = 'rigby.sessions';
const DIR = 'recovery';
const at = (name) => `${DIR}/${name}`;

/** The GPU as WebGL reports it, read once: { gpu, webgl, maxTexture }. */
let gpuInfo = null;
function readGpu() {
  if (gpuInfo) return gpuInfo;
  gpuInfo = { gpu: 'unknown', webgl: 'none', maxTexture: null };
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    if (!gl) return gpuInfo;
    const debug = gl.getExtension('WEBGL_debug_renderer_info');
    const vendor = gl.getParameter(debug ? debug.UNMASKED_VENDOR_WEBGL : gl.VENDOR);
    const renderer = gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER);
    gpuInfo = { gpu: renderer && vendor && !String(renderer).includes(vendor) ? `${vendor} · ${renderer}` : String(renderer || vendor), webgl: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext ? 'WebGL 2' : 'WebGL 1', maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE) };
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    // No GPU details: the report says unknown.
  }
  return gpuInfo;
}

/**
 * What a bug report needs to reproduce rendering and performance problems: the GPU and WebGL, the
 * viewport renderer, the screen, memory, and the size of the open project (no names or paths).
 */
export function systemInfo(app) {
  const g = readGpu();
  const mb = (bytes) => `${Math.round(bytes / 1048576)} MB`;
  const heap = performance.memory ? `${mb(performance.memory.usedJSHeapSize)} used of ${mb(performance.memory.jsHeapSizeLimit)}` : null;
  const doc = app?.doc;
  let project = null;
  if (doc) {
    const atts = doc.slots.flatMap((s) => s.attachments).concat(doc.skins.flatMap((k) => k.slots.flatMap((s) => s.attachments)));
    const meshes = atts.filter((a) => a.type === 'mesh' || a.type === 'linkedmesh');
    const vertices = meshes.reduce((n, a) => n + vertexCount(a), 0);
    const pixels = doc.images.reduce((n, i) => n + (i.width ?? 0) * (i.height ?? 0), 0);
    const largest = doc.images.reduce((m, i) => Math.max(m, i.width ?? 0, i.height ?? 0), 0);
    const n = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
    project = [
      `${n(doc.bones.length, 'bone')}, ${n(doc.slots.length, 'slot')}, ${n(meshes.length, 'mesh', 'meshes')}${meshes.length ? ` (${n(vertices, 'vertex', 'vertices')})` : ''}, ${n(listConstraints(doc).length, 'constraint')}`,
      `${n(doc.images.length, 'image')}${doc.images.length ? ` (${(pixels / 1e6).toFixed(1)} Mpx, largest ${largest}px)` : ''}, ${n(doc.skins.length + 1, 'skin')}, ${n(doc.animations.length, 'animation')}`,
      doc.scene ? `scene with ${doc.scene.actors?.length ?? 0} actors` : null,
      doc.film ? 'film effects' : null,
    ]
      .filter(Boolean)
      .join('; ');
  }
  return {
    GPU: g.gpu,
    WebGL: `${g.webgl}${g.maxTexture ? `, textures up to ${g.maxTexture}px` : ''}`,
    Viewport: app?.viewport ? (app.viewport.glView ? 'WebGL' : 'Canvas 2D (WebGL unavailable)') : null,
    Screen: `${screen.width}x${screen.height} at ${devicePixelRatio}x, window ${innerWidth}x${innerHeight}`,
    Memory: [navigator.deviceMemory ? `${navigator.deviceMemory} GB device` : null, heap ? `JS heap ${heap}` : null].filter(Boolean).join(', ') || null,
    CPU: navigator.hardwareConcurrency ? `${navigator.hardwareConcurrency} threads` : null,
    Language: navigator.language,
    Workspace: app?.workspace ?? null,
    Project: project,
  };
}

/** Session records by id, kept in localStorage: written synchronously, so even a closing page saves them. */
function readSessions() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SESSIONS_KEY) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
function writeSessions(sessions) {
  try {
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
  } catch {
    // Without storage there is no crash recovery; auto-saves still happen.
  }
}

const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const dayOf = (ms) => (new Date(ms).toDateString() === new Date().toDateString() ? `today ${timeOf(ms)}` : new Date(ms).toLocaleString());
const baseName = (path) => (path ? String(path).split(/[\\/]/).pop() : '');

export function installRecovery(app) {
  const id = newSessionId();
  const started = Date.now();
  /** The document JSON last auto-saved, so unchanged work is not written again. */
  let autosavedJson = null;
  let lastAutosave = Date.now();
  let busy = false;
  /** What File ▸ Recover lists: [{ label, file, session }]. */
  let recoverable = [];

  const record = (extra = {}) => {
    const sessions = readSessions();
    // `path`: where Save writes (none for a backup or demo opened as a copy); `name`: what to call the work.
    const path = app.saveTarget?.fs?.reusable ? app.saveTarget.path : null;
    const name = baseName(app.path) || app.doc.name || 'untitled';
    sessions[id] = { id, started, beat: Date.now(), path, name, version: VERSION, clean: false, ...extra };
    writeSessions(sessions);
  };

  async function autosave(reason = 'auto') {
    if (busy) return false;
    busy = true;
    try {
      app.syncJson?.();
      const json = app.docJson;
      await app.writeWorkfile(at(sessionAutosave(id)), platform.userStoreFs);
      autosavedJson = json;
      lastAutosave = Date.now();
      record();
      log.debug(`Auto-saved (${reason})`, { source: 'recovery' });
      return true;
    } catch (e) {
      log.exception(e, { source: 'recovery', context: t('Auto-save failed') });
      return false;
    } finally {
      busy = false;
    }
  }

  // Every few seconds: auto-save unsaved work when it is due; drop the auto-save once the work is saved.
  setInterval(() => {
    if (busy) return;
    if (!app.dirty()) {
      if (autosavedJson !== null) {
        autosavedJson = null;
        platform.userStore.remove(at(sessionAutosave(id)));
      }
      return;
    }
    const due = Date.now() - lastAutosave >= app.prefs.get('files.autosaveMinutes') * 60_000;
    if (app.prefs.get('files.autosave') && due && app.docJson !== autosavedJson) autosave();
  }, 5000);
  record();
  setInterval(() => record(), HEARTBEAT_MS);

  // Other editors in this browser answer "alive?" (a background tab's heartbeat can be throttled).
  const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('rigby2d-sessions') : null;
  if (channel) channel.onmessage = (e) => e.data?.ask && channel.postMessage({ alive: id });
  function aliveSessions() {
    if (!channel) return Promise.resolve(new Set());
    const alive = new Set();
    const listen = (e) => e.data?.alive && alive.add(e.data.alive);
    channel.addEventListener('message', listen);
    channel.postMessage({ ask: true });
    return new Promise((resolve) =>
      setTimeout(() => {
        channel.removeEventListener('message', listen);
        resolve(alive);
      }, 400),
    );
  }

  /** Ends this session: `keepQuit` keeps the unsaved work as the last session (Don't save). */
  async function endSession({ keepQuit = false } = {}) {
    if (keepQuit && app.dirty()) await app.writeWorkfile(at(QUIT_FILE), platform.userStoreFs).catch(() => {});
    const sessions = readSessions();
    delete sessions[id];
    writeSessions(sessions);
    await platform.userStore.remove(at(sessionAutosave(id)));
  }

  /** Asks before closing with unsaved changes. Resolves true when the editor may close. */
  async function confirmQuit() {
    app.syncJson?.();
    if (!app.dirty()) {
      await endSession();
      return true;
    }
    const name = baseName(app.path) || t('this project');
    const choice = await askChoice(t('Unsaved changes'), t('Save the changes to {name} before closing?', { name }), [
      { id: 'cancel', label: t('Cancel') },
      { id: 'discard', label: t("Don't save") },
      { id: 'save', label: t('Save'), primary: true },
    ]);
    if (choice === 'save') {
      await app.save(false);
      if (app.dirty()) return false; // the save was cancelled or failed
      await endSession();
      return true;
    }
    if (choice === 'discard') {
      await endSession({ keepQuit: true });
      return true;
    }
    return false;
  }

  /** Opens auto-saved work as an unsaved project tied to its original file, if it had one. */
  async function recover(file, session) {
    if (!(await app.confirmDiscard())) return;
    await app.openFrom(file, platform.userStoreFs);
    if (app.path !== file) return; // openFrom reported the problem
    const original = session?.path ?? null;
    app.path = original;
    app.saveTarget = original ? platform.desktopFile(original) : null;
    app.saved = ''; // unsaved until saved again
    app.changed();
    app.setStatus((file.endsWith(QUIT_FILE) ? statusMessage('Recovered {name} from the last session. Save to keep it.', { name: session?.name || baseName(original) || statusMessage('the project') }) : statusMessage('Recovered {name} from an auto-save. Save to keep it.', { name: session?.name || baseName(original) || statusMessage('the project') })));
    await autosave('recovered');
    if (session) forget(session);
  }

  /** Deletes a crashed session's record and auto-save. */
  function forget(session) {
    const sessions = readSessions();
    delete sessions[session.id];
    writeSessions(sessions);
    platform.userStore.remove(at(sessionAutosave(session.id)));
    recoverable = recoverable.filter((r) => r.session?.id !== session.id);
  }

  async function scan() {
    const files = await platform.userStore.list(DIR);
    const names = new Map(files.map((f) => [f.path, f.modified]));
    const sessions = Object.values(readSessions());
    const hasAutosave = (r) => names.has(at(sessionAutosave(r.id)));
    const alive = await aliveSessions();
    for (const r of deadSessions(sessions, { current: id, alive, hasAutosave })) {
      const all = readSessions();
      delete all[r.id];
      writeSessions(all);
    }
    // Auto-saves whose session is gone (closed while the page was unloading) are not needed.
    const live = new Set([...sessions.map((r) => r.id), ...alive]);
    for (const f of files) {
      const m = /autosave-(.+)\.rigby$/.exec(f.path);
      if (m && !live.has(m[1])) platform.userStore.remove(f.path);
    }
    const crashed = crashedSessions(sessions, { current: id, alive, hasAutosave });
    recoverable = crashed.map((s) => ({ label: t('{name}, auto-saved {when}', { name: s.name || t('untitled'), when: dayOf(names.get(at(sessionAutosave(s.id))) || s.beat) }), file: at(sessionAutosave(s.id)), session: s }));
    if (names.has(at(QUIT_FILE))) recoverable.push({ label: t('Last session, closed {when}', { when: dayOf(names.get(at(QUIT_FILE))) }), file: at(QUIT_FILE), session: null });
    return crashed;
  }

  /** At startup: offers back the work of an editor that crashed. Resolves true when it shows the offer. */
  async function offerRecovery() {
    const crashed = await scan();
    if (!crashed.length) return false;
    const s = crashed[0];
    const when = dayOf(s.beat);
    const choice = await askChoice(
      t('Recover unsaved work?'),
      [
        h('p', null, t('Rigby2D did not close properly ({when}). Unsaved work on {name} was auto-saved.', { when, name: s.name || 'untitled' })),
        h('p', { class: 'weak' }, crashed.length > 1 ? t('File ▸ Recover has {count} more auto-save(s).', { count: crashed.length - 1 }) : t('Later, it stays in File ▸ Recover until you discard it.')),
      ],
      [
        { id: 'discard', label: t('Discard') },
        { id: 'later', label: t('Later') },
        { id: 'recover', label: t('Recover'), primary: true },
      ],
    );
    if (choice === 'recover') await recover(at(sessionAutosave(s.id)), s);
    else if (choice === 'discard') forget(s);
    return true;
  }

  /** File ▸ Recover entries. */
  function menu() {
    const items = recoverable.map((r) => ({ label: r.label, action: () => recover(r.file, r.session) }));
    return items.length ? items : [{ label: t('Nothing to recover'), disabled: true }];
  }

  // ---- crash manager ----

  let lastCrash = 0;
  let banner = null;
  function onCrash(e) {
    const error = e?.error ?? e?.reason;
    if (!error) return; // resource load failures and benign browser notices
    if (Date.now() - lastCrash < 60_000) return;
    lastCrash = Date.now();
    const saving = app.dirty() ? autosave('error') : Promise.resolve(false);
    saving.then((saved) => {
      const report = makeReport();
      platform.userStore.putText(at(`crash-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`), report).catch(() => {});
      showBanner(saved);
    });
  }
  window.addEventListener('error', onCrash);
  window.addEventListener('unhandledrejection', onCrash);

  function makeReport() {
    const errors = log.entries.filter((x) => x.level === 'error').slice(-8);
    return crashReport({ version: VERSION, platform: `${platform.isDesktop ? 'desktop' : 'browser'}, ${navigator.userAgent}`, system: systemInfo(app), errors });
  }

  function showBanner(saved) {
    banner?.remove();
    banner = h(
      'div',
      { class: 'crash-banner', role: 'alert' },
      h('span', null, saved ? t('Rigby2D ran into an error. Your work was auto-saved. Details are in View ▸ Log.') : t('Rigby2D ran into an error. Details are in View ▸ Log.')),
      h('button', { onclick: () => openCrashReport() }, t('Report…')),
      h('button', { onclick: () => app.save(true) }, t('Save as…')),
      h('button', { class: 'dialog-close', 'aria-label': t('Dismiss'), onclick: () => banner.remove() }, uiIcon('x', 'sm')),
    );
    document.body.append(banner);
  }

  function openCrashReport() {
    banner?.remove();
    const report = makeReport();
    const { body } = dialog('crash-dialog', t('Report a problem'), t('The report has the version, the platform and the errors, with your folder names hidden. Nothing is sent until you choose to.'));
    const text = h('textarea', { class: 'crash-report', readonly: true, rows: 14 }, report);
    const issue = `${LINKS.repo}/issues/new?title=${encodeURIComponent('Crash: ' + (log.entries.filter((x) => x.level === 'error').at(-1)?.message ?? 'error').slice(0, 80))}&body=${encodeURIComponent(('**What were you doing?**\n\n\n**Report**\n```\n' + report).slice(0, 6000) + '\n```')}`;
    body.append(
      text,
      h(
        'div',
        { class: 'dialog-actions' },
        h('button', { onclick: () => navigator.clipboard?.writeText(report).then(() => app.setStatus(statusMessage('Copied the crash report'))) }, t('Copy')),
        button(t('Report on GitHub'), { kind: 'primary', icon: 'external-link', onclick: () => platform.openExternal(issue) }),
      ),
    );
  }

  return { autosave, confirmQuit, endSession, offerRecovery, menu, scan, openCrashReport, sessionId: id };
}
