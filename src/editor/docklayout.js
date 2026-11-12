// SPDX-License-Identifier: MIT OR Apache-2.0
// Where the panels sit inside the editor window (the dock). No DOM, so it is unit-tested in Node:
// the page side is dockui.js. A layout has three regions around the viewport (left, right, bottom);
// each region holds a stack of tab groups (top to bottom at the sides, left to right at the bottom),
// and each group shows one of its panels at a time behind a tab strip. Every panel sits in exactly
// one group. A panel popped out into its own OS window (panelsync.js) keeps its place here, so it
// comes back to the same spot when it docks again.
//
//   { left: { groups: [] }, right: { groups: [{ tabs: ['tree'], active: 'tree', weight: 42 }, …] }, … }
//
// `weight` is a group's share of its region (the groups of a region split its length in proportion).

export const REGIONS = ['left', 'right', 'bottom'];
export const DOCK_PANELS = ['tree', 'inspector', 'timeline'];

const STORE = 'rigby.layout.dock';

/** Today's arrangement: tree over inspector on the right, the timeline along the bottom. */
export function defaultDock() {
  return {
    left: { groups: [] },
    right: {
      groups: [
        { tabs: ['tree'], active: 'tree', weight: 42 },
        { tabs: ['inspector'], active: 'inspector', weight: 58 },
      ],
    },
    bottom: { groups: [{ tabs: ['timeline'], active: 'timeline', weight: 100 }] },
  };
}

/** Where a panel sits by default: [region, group index]. */
const HOME = { tree: ['right', 0], inspector: ['right', 1], timeline: ['bottom', 0] };

const clone = (layout) => JSON.parse(JSON.stringify(layout));

/**
 * A valid layout from anything (stored JSON, an older or hand-edited one): unknown panels and
 * duplicates are dropped, empty groups removed, and a missing panel goes back to its default place.
 */
export function normalizeDock(raw) {
  const out = { left: { groups: [] }, right: { groups: [] }, bottom: { groups: [] } };
  if (!raw || typeof raw !== 'object') return defaultDock();
  const seen = new Set();
  for (const region of REGIONS) {
    const groups = Array.isArray(raw[region]?.groups) ? raw[region].groups : [];
    for (const g of groups) {
      const tabs = [];
      for (const id of Array.isArray(g?.tabs) ? g.tabs : []) {
        if (!DOCK_PANELS.includes(id) || seen.has(id)) continue;
        seen.add(id);
        tabs.push(id);
      }
      if (!tabs.length) continue;
      const weight = Number.isFinite(g.weight) && g.weight > 0 ? g.weight : 50;
      out[region].groups.push({ tabs, active: tabs.includes(g.active) ? g.active : tabs[0], weight });
    }
  }
  for (const id of DOCK_PANELS) {
    if (seen.has(id)) continue;
    const [region, index] = HOME[id];
    const groups = out[region].groups;
    groups.splice(Math.min(index, groups.length), 0, { tabs: [id], active: id, weight: 50 });
  }
  return out;
}

/** Where a panel is: { region, group, tab } (indices), or null. */
export function findPanel(layout, id) {
  for (const region of REGIONS) {
    const groups = layout[region].groups;
    for (let group = 0; group < groups.length; group++) {
      const tab = groups[group].tabs.indexOf(id);
      if (tab >= 0) return { region, group, tab };
    }
  }
  return null;
}

// Takes a panel out of its group (removing the group when it empties). Mutates `layout`.
function detach(layout, id) {
  const at = findPanel(layout, id);
  if (!at) return;
  const groups = layout[at.region].groups;
  const g = groups[at.group];
  g.tabs.splice(at.tab, 1);
  if (!g.tabs.length) groups.splice(at.group, 1);
  else if (g.active === id) g.active = g.tabs[Math.min(at.tab, g.tabs.length - 1)];
}

/**
 * Moves a panel. `target` is one of:
 *   { region, group, where: 'tab', index? }    join that group's tabs (at `index`, default the end)
 *   { region, group, where: 'before' | 'after' }  a new group of its own next to that group
 *   { region, where: 'new' }                      a new group at the end of the region
 * The moved panel becomes its group's shown tab. Returns a new layout (the input is untouched).
 */
export function movePanel(layout, id, target) {
  if (!DOCK_PANELS.includes(id) || !REGIONS.includes(target?.region)) return layout;
  const own = layout[target.region].groups[target.group];
  // Dropping a panel onto (or beside) the group that holds only it changes nothing.
  if (own && own.tabs.length === 1 && own.tabs[0] === id && target.where !== 'new') return layout;
  const next = clone(layout);
  const ref = next[target.region].groups[target.group];
  detach(next, id);
  const groups = next[target.region].groups;
  if (target.where === 'tab' && ref) {
    const index = Number.isInteger(target.index) ? Math.max(0, Math.min(target.index, ref.tabs.length)) : ref.tabs.length;
    ref.tabs.splice(index, 0, id);
    ref.active = id;
    return next;
  }
  if ((target.where === 'before' || target.where === 'after') && ref) {
    // The group may have shifted when the panel left its old one: find it again by identity.
    const at = groups.indexOf(ref) + (target.where === 'after' ? 1 : 0);
    // The new group takes half of the neighbour's share.
    ref.weight /= 2;
    groups.splice(at, 0, { tabs: [id], active: id, weight: ref.weight });
    return next;
  }
  const weight = groups.length ? groups.reduce((s, g) => s + g.weight, 0) / groups.length : 100;
  groups.push({ tabs: [id], active: id, weight });
  return next;
}

/** Shows panel `id` in its group. Returns a new layout. */
export function activatePanel(layout, id) {
  const at = findPanel(layout, id);
  if (!at || layout[at.region].groups[at.group].active === id) return layout;
  const next = clone(layout);
  next[at.region].groups[at.group].active = id;
  return next;
}

/** Sets the weights of a region's groups (from a splitter drag). Returns a new layout. */
export function setWeights(layout, region, weights) {
  const next = clone(layout);
  next[region].groups.forEach((g, i) => {
    if (Number.isFinite(weights[i]) && weights[i] > 0) g.weight = weights[i];
  });
  return next;
}

/**
 * What to draw: per region, the groups that have a panel to show, each with its visible tabs and the
 * tab to show. `hidden` holds the panels that are not in the window right now (popped out, or the
 * timeline in Setup mode). A group whose shown tab is hidden shows its first visible one.
 */
export function visibleDock(layout, hidden = new Set()) {
  const out = {};
  for (const region of REGIONS) {
    out[region] = layout[region].groups
      .map((g, index) => {
        const tabs = g.tabs.filter((id) => !hidden.has(id));
        return { index, tabs, active: tabs.includes(g.active) ? g.active : tabs[0], weight: g.weight };
      })
      .filter((g) => g.tabs.length);
  }
  return out;
}

/** True when the layout is today's default arrangement. */
export function isDefaultDock(layout) {
  const strip = (l) => JSON.stringify(REGIONS.map((r) => l[r].groups.map((g) => g.tabs)));
  return strip(layout) === strip(defaultDock());
}

/** The stored layout (the default when none or unreadable). `storage` is injectable for tests. */
export function loadDock(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORE);
    return raw ? normalizeDock(JSON.parse(raw)) : defaultDock();
  } catch {
    return defaultDock();
  }
}

/** Remembers the layout on this machine (a convenience: failure keeps it for this session). Null
 *  forgets it, so the next start uses the default. */
export function saveDock(layout, storage = globalThis.localStorage) {
  try {
    if (layout) storage?.setItem(STORE, JSON.stringify(layout));
    else storage?.removeItem(STORE);
  } catch {
    // Storage unavailable: the layout lasts until the window closes.
  }
}
