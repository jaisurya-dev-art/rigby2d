// SPDX-License-Identifier: MIT OR Apache-2.0
// Log: every status message, warning and error of the editor and of scripts, with tracebacks.
// Uncaught errors and rejected promises are caught here too, so nothing fails silently. The log
// window (View ▸ Log, logwindow.js) lists the entries; the status bar shows how many errors are unread.

export const LEVELS = ['debug', 'info', 'warn', 'error'];
const MAX_ENTRIES = 2000;

/** Entries: { id, time (Date), level, source, message, trace (string or null) }. */
export const entries = [];
let nextId = 1;
/** True while the log window shows new entries as they arrive (they are read). */
let watched = false;
const listeners = new Set();
/** Errors added since the log window was last looked at. */
export let unreadErrors = 0;

/** Adds an entry. `source` names where it comes from ('editor', 'script: name', ...). */
export function log(level, message, { source = 'editor', trace = null } = {}) {
  const entry = { id: nextId++, time: new Date(), level: LEVELS.includes(level) ? level : 'info', source, message: String(message), trace: trace ? String(trace) : null };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.splice(0, entries.length - MAX_ENTRIES);
  if (entry.level === 'error' && !watched) unreadErrors++;
  for (const fn of listeners) fn(entry);
  return entry;
}

export const debug = (message, opts) => log('debug', message, opts);
export const info = (message, opts) => log('info', message, opts);
export const warn = (message, opts) => log('warn', message, opts);
export const error = (message, opts) => log('error', message, opts);

/** Logs an exception: its message, and its stack (or Python traceback) as the trace. */
export function exception(e, { source = 'editor', context = '' } = {}) {
  const message = errorMessage(e);
  return log('error', context ? `${context}: ${message}` : message, { source, trace: e?.stack ?? null });
}

export function errorMessage(e) {
  if (e === null || e === undefined) return 'Unknown error';
  if (typeof e === 'string') return e;
  return e.message || e.name || String(e);
}

/** The log window opened (entries are read as they come) or closed. */
export function markRead(open) {
  watched = open;
  unreadErrors = 0;
}

export function clear() {
  entries.length = 0;
  unreadErrors = 0;
  for (const fn of listeners) fn(null);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Plain-text form of entries, for copying into bug reports. */
export function formatEntries(list = entries) {
  return list
    .map((e) => {
      const head = `${stamp(e.time)} ${e.level.toUpperCase().padEnd(5)} [${e.source}] ${e.message}`;
      return e.trace ? `${head}\n${e.trace.replace(/^/gm, '    ')}` : head;
    })
    .join('\n');
}

const pad = (n, w = 2) => String(n).padStart(w, '0');
export const stamp = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;

// ---- capture ----------------------------------------------------------------------------------

let installed = false;

/**
 * Starts capturing uncaught errors, unhandled promise rejections and console warnings/errors.
 * Status messages that report a failure are logged as errors; other status messages as info.
 */
export function installCapture(app) {
  if (installed) return;
  installed = true;
  window.addEventListener('error', (e) => {
    // Resource load failures have no error object; their target names what failed.
    if (e.error) exception(e.error, { context: 'Uncaught error' });
    else if (e.message) log('error', `Uncaught error: ${e.message}`, { trace: e.filename ? `at ${e.filename}:${e.lineno}:${e.colno}` : null });
  });
  window.addEventListener('unhandledrejection', (e) => exception(e.reason, { context: 'Unhandled promise rejection' }));
  for (const level of ['warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      original(...args);
      const err = args.find((a) => a instanceof Error);
      log(level, args.map((a) => (a instanceof Error ? errorMessage(a) : typeof a === 'string' ? a : safeJson(a))).join(' '), { source: 'console', trace: err?.stack ?? null });
    };
  }
  if (app) {
    const setStatus = app.setStatus.bind(app);
    // { log: false }: the caller has logged the details itself.
    app.setStatus = (text, { log: logIt = true } = {}) => {
      setStatus(text);
      const message = app.status;
      if (message && logIt) log(/\b(failed|cannot|error|invalid)\b/i.test(message) ? 'error' : /\bwarning/i.test(message) ? 'warn' : 'info', message, { source: 'status' });
    };
  }
}

function safeJson(v) {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

