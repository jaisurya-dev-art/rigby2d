// SPDX-License-Identifier: MIT OR Apache-2.0
// Command search's list and matching (commandsearch.js is the window): no DOM imports, tested under
// Node.

/**
 * The commands of a menu tree: [{ label, path, shortcut, run, disabled }]. `items` is a menu's list
 * (objects, 'separator', DOM nodes: a submenu, or a tick-box item).
 */
export function menuCommands(items, path = []) {
  const out = [];
  for (const it of typeof items === 'function' ? items() : items ?? []) {
    if (!it || it === 'separator') continue;
    if (typeof Node !== 'undefined' && it instanceof Node) {
      if (it.submenuItems) {
        out.push(...menuCommands(it.submenuItems, [...path, it.submenuLabel]));
      } else if (it.querySelector?.('input[type=checkbox]')) {
        const box = it.querySelector('input[type=checkbox]');
        const label = (it.querySelector('.item-label')?.textContent ?? it.textContent).trim();
        if (label) out.push({ label, path, shortcut: it.querySelector('.shortcut')?.textContent ?? '', checked: box.checked, run: () => {
            // The menu's own elements are not on the page here, so a click would not reach their handler.
            box.checked = !box.checked;
            box.dispatchEvent(new Event('change'));
          } });
      }
      continue;
    }
    if (it.label && it.action) out.push({ label: it.label, path, shortcut: it.shortcut ?? '', disabled: !!it.disabled, run: it.action, checked: it.checked });
  }
  return out;
}

/** The words of a query, lowercase. */
const words = (q) => q.toLowerCase().split(/\s+/).filter(Boolean);

/**
 * The commands matching `query`, best first: every word must appear in the name or its path; names
 * that start with the query, then words that start a word of the name, rank higher. Disabled ones
 * go last.
 */
export function commandMatches(commands, query) {
  const ws = words(query);
  if (!ws.length) return commands.filter((c) => !c.disabled).slice(0, 60);
  const scored = [];
  for (const c of commands) {
    const name = c.label.toLowerCase();
    const hay = `${name} ${c.path.join(' ').toLowerCase()}`;
    if (!ws.every((w) => hay.includes(w))) continue;
    let score = 0;
    if (name.startsWith(query.trim().toLowerCase())) score += 100;
    for (const w of ws) {
      if (name.includes(w)) score += 10;
      if (new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(name)) score += 5;
    }
    if (c.disabled) score -= 1000;
    score -= c.path.length; // top-level items before deep ones
    scored.push([score, c]);
  }
  return scored.sort((a, b) => b[0] - a[0]).map(([, c]) => c);
}
