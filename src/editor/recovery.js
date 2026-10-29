// SPDX-License-Identifier: MIT OR Apache-2.0
// File safety rules, kept free of the DOM and of Tauri so tests run them under Node:
// - Backups: saving over `walk.rigby` keeps the previous versions as `walk.rigby1` (the newest),
//   `walk.rigby2` and so on, like Blender's .blend1 files.
// - Sessions: each running editor keeps a small session record and refreshes it (the heartbeat)
//   while it runs, and auto-saves unsaved work to the recovery folder. A clean exit deletes both. A
//   record whose heartbeat stopped belongs to an editor that crashed or was killed, and its
//   auto-save is offered back at the next start (recoveryui.js).

/** How long a session may go without a heartbeat before it counts as crashed. */
export const HEARTBEAT_MS = 10_000;
export const STALE_MS = 2.5 * HEARTBEAT_MS;

/** The work file extension and its numbered backups: `.rigby`, `.rigby1` … `.rigby9`. */
export const WORKFILE_PATTERN = /\.rigby\d?$/i;
export const BACKUP_PATTERN = /\.rigby(\d)$/i;

/** Backup number `n` (1 = newest) of `path`: walk.rigby -> walk.rigby1. */
export function backupPath(path, n) {
  return `${path}${n}`;
}

/** Whether `path` is a numbered backup (walk.rigby1), which opens as a copy, not in place. */
export function isBackup(path) {
  return BACKUP_PATTERN.test(path);
}

/**
 * The renames that make room for a new backup when `count` backups are kept: [from, to] pairs,
 * oldest first, so walk.rigby2 -> walk.rigby3 happens before walk.rigby1 -> walk.rigby2. The current
 * file is then copied to backupPath(path, 1) (it stays in place until the new file replaces it).
 */
export function backupShifts(path, count) {
  const out = [];
  for (let n = count - 1; n >= 1; n--) out.push([backupPath(path, n), backupPath(path, n + 1)]);
  return out;
}

/**
 * Replaces `path` without ever leaving it half-written: the bytes go to `<path>.saving` first, the
 * old file is kept as backup 1 (older ones shift up to `backups`), and the new file then takes its
 * place in one rename. A crash at any point leaves a complete file. `ops` is the file system:
 * { writeFile, exists, rename (replaces the target), copyFile }.
 */
export async function replaceWithBackups(ops, path, bytes, backups = 0) {
  const temp = `${path}.saving`;
  await ops.writeFile(temp, bytes);
  if (backups > 0 && (await ops.exists(path))) {
    for (const [from, to] of backupShifts(path, backups)) if (await ops.exists(from)) await ops.rename(from, to);
    await ops.copyFile(path, backupPath(path, 1));
  }
  await ops.rename(temp, path);
}

/** Recovery folder entries for session `id`. */
export const sessionRecord = (id) => `session-${id}.json`;
export const sessionAutosave = (id) => `autosave-${id}.rigby`;
/** The work discarded at the last quit ("Don't save"), kept until the next quit. */
export const QUIT_FILE = 'quit.rigby';

/** A short random session id. */
export function newSessionId(random = Math.random) {
  return Date.now().toString(36) + random().toString(36).slice(2, 8);
}

/**
 * Crashed sessions among `records` (parsed session records), newest first: not this session, not
 * `alive` (editors that answered just now), not closed cleanly, heartbeat older than STALE_MS, and
 * with an auto-save to offer.
 */
export function crashedSessions(records, { now = Date.now(), current = null, alive = new Set(), hasAutosave = () => true } = {}) {
  return records
    .filter((r) => r && r.id && r.id !== current && !alive.has(r.id) && !r.clean && now - (r.beat ?? 0) > STALE_MS && hasAutosave(r))
    .sort((a, b) => (b.beat ?? 0) - (a.beat ?? 0));
}

/** Session records whose editor is gone and that have nothing to recover (to delete). */
export function deadSessions(records, { now = Date.now(), current = null, alive = new Set(), hasAutosave = () => true } = {}) {
  return records.filter((r) => r && r.id && r.id !== current && !alive.has(r.id) && (r.clean || now - (r.beat ?? 0) > STALE_MS) && !hasAutosave(r));
}

/** The text of a crash report: version, platform, the errors with their traces, home folders hidden. */
export function crashReport({ version, platform, errors, when = new Date() }) {
  const hide = (s) => String(s ?? '').replace(/([\\/](?:Users|home)[\\/])[^\\/\s]+/gi, '$1…');
  const lines = [`Rigby2D ${version || 'dev'} on ${platform}`, `Time: ${when.toISOString()}`, ''];
  for (const e of errors) {
    lines.push(`[${e.source ?? 'editor'}] ${hide(e.message)}`);
    if (e.trace) lines.push(...hide(e.trace).split('\n').slice(0, 12).map((l) => `    ${l}`));
  }
  return lines.join('\n');
}
