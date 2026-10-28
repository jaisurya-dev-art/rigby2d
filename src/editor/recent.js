// SPDX-License-Identifier: MIT OR Apache-2.0
// Recently opened projects (File ▸ Open recent): work files and imported skeletons on the desktop,
// and demo projects anywhere. Files the browser opened through a picker cannot be reopened by
// path, so on the web only demos are remembered. Newest first; kept in localStorage.

const KEY = 'rigby.recent';
const MAX = 12;

/** Entries: { kind: 'file', path, time } or { kind: 'demo', id, name, time }. */
export function recentProjects() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((e) => (e?.kind === 'file' && typeof e.path === 'string') || (e?.kind === 'demo' && typeof e.id === 'string')) : [];
  } catch {
    return [];
  }
}

const same = (a, b) => a.kind === b.kind && (a.kind === 'file' ? a.path.toLowerCase() === b.path.toLowerCase() : a.id === b.id);

function store(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
  } catch {
    // Storage full or disabled: the list is a convenience.
  }
}

/** Puts a project at the top of the list. */
export function rememberProject(entry) {
  store([{ ...entry, time: Date.now() }, ...recentProjects().filter((e) => !same(e, entry))]);
}

/** Drops a project (e.g. a file that was moved or deleted). */
export function forgetProject(entry) {
  store(recentProjects().filter((e) => !same(e, entry)));
}

export function clearRecentProjects() {
  store([]);
}

/** File name and folder of a path, for display. */
export function splitPath(path) {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return { name: path.slice(i + 1), folder: i > 0 ? path.slice(0, i) : '' };
}

/** "just now", "5 min ago", "yesterday", "3 days ago", or a date. */
export function ago(time, now = Date.now()) {
  const s = Math.max(0, (now - time) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 2 * 86400) return 'yesterday';
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
