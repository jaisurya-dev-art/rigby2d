// SPDX-License-Identifier: MIT OR Apache-2.0
// The dock in the editor window: draws the layout of docklayout.js (regions left, right and bottom,
// each a stack of tab groups), lets a panel be dragged by its tab onto another group's tab strip (to
// share its space) or onto a group's or the viewport's edge (to sit beside it), and resizes the groups
// of a region with splitters. The panel elements (#tree, #properties, #timeline) are moved, never
// rebuilt, so their contents and listeners stay. A panel popped out into its own window (panelsync)
// or the timeline hidden in Setup mode leaves its group until it is back.

import { activatePanel, closePanel, defaultDock, findPanel, loadDock, movePanel, normalizeDock, openPanel, REGIONS, saveDock, setWeights, visibleDock } from './docklayout.js';
import { PANELS } from './dock.js';
import { t } from './i18n.js';
import { iconButton } from './ui.js';
import { h } from './widgets.js';

/** The element of each panel. */
const PANEL_EL = { tree: '#tree', inspector: '#properties', timeline: '#timeline', rig: '#rig' };

/** How close to the viewport's edge (px) a dragged tab docks into that region. */
const EDGE = 72;
/** Smallest size of a group along its region (px). */
const MIN_GROUP = 72;

/**
 * Wires up the dock. `appEl` is #app (its `detached-<id>` and `setup-hides-timeline` classes say which
 * panels are out of the window); `onPopOut(id)` pops a panel out into its own window, or null where
 * panels cannot pop out (the browser). `onChange(layout)` runs whenever the layout changes (and once
 * at the start). Returns { get, set, reset, open, close, has }.
 */
export function installDock({ appEl, onPopOut = null, onChange = null }) {
  const $ = (sel) => document.querySelector(sel);
  const regionEl = { left: $('#dock-left'), right: $('#dock-right'), bottom: $('#dock-bottom') };
  const parking = $('#dock-parking');
  const panelEl = Object.fromEntries(Object.entries(PANEL_EL).map(([id, sel]) => [id, $(sel)]));
  let layout = loadDock();
  let hiddenKey = '';

  const hidden = () => {
    const out = new Set();
    for (const id of Object.keys(PANEL_EL)) if (appEl.classList.contains(`detached-${id}`)) out.add(id);
    if (appEl.classList.contains('setup-hides-timeline')) out.add('timeline');
    return out;
  };

  // Moving an element out of the page and back loses its scroll position: keep it across a render.
  function keepScroll(run) {
    const kept = [];
    for (const el of Object.values(panelEl)) {
      for (const s of [el, ...el.querySelectorAll('*')]) if (s.scrollTop || s.scrollLeft) kept.push([s, s.scrollTop, s.scrollLeft]);
    }
    run();
    for (const [s, top, left] of kept) {
      s.scrollTop = top;
      s.scrollLeft = left;
    }
  }

  function render() {
    const hide = hidden();
    hiddenKey = [...hide].sort().join();
    const view = visibleDock(layout, hide);
    keepScroll(() => {
      for (const el of Object.values(panelEl)) {
        el.classList.add('dock-inactive');
        parking.append(el);
      }
      for (const region of REGIONS) {
        const root = regionEl[region];
        root.replaceChildren();
        view[region].forEach((g, i) => {
          if (i) root.append(groupSplitter(region, view[region][i - 1], g));
          root.append(groupEl(region, g));
        });
        appEl.classList.toggle(`dock-no-${region}`, !view[region].length);
      }
    });
    // Canvases (viewport, dopesheet) size themselves on resize.
    window.dispatchEvent(new Event('resize'));
  }

  function groupEl(region, g) {
    const body = h('div', { class: 'dock-body' });
    for (const id of g.tabs) {
      const el = panelEl[id];
      el.classList.toggle('dock-inactive', id !== g.active);
      body.append(el);
    }
    const tabs = h(
      'div',
      { class: 'dock-tabs', role: 'tablist' },
      ...g.tabs.map((id) =>
        h(
          'button',
          {
            type: 'button',
            class: `dock-tab${id === g.active ? ' active' : ''}`,
            role: 'tab',
            'aria-selected': String(id === g.active),
            'data-panel': id,
            title: t('Drag to move or group with another panel'),
            onpointerdown: (e) => startDrag(e, id),
            onclick: () => show(id),
          },
          t(PANELS[id].label),
        ),
      ),
      h('span', { class: 'dock-tabs-fill' }),
      onPopOut
        ? iconButton('external-link', { size: 'sm', title: t('Pop out {name} into its own window', { name: t(PANELS[g.active].label) }), onclick: () => onPopOut(g.active) })
        : null,
    );
    const el = h('section', { class: 'dock-group', 'data-region': region, 'data-group': String(g.index) }, tabs, body);
    el.style.flexGrow = String(g.weight);
    return el;
  }

  /** Shows a panel in its group (its tab is clicked). */
  function show(id) {
    if (dragged) return;
    const next = activatePanel(layout, id);
    if (next === layout) return;
    set(next);
  }

  // ---- splitters between the groups of a region --------------------------------------------------

  function groupSplitter(region, a, b) {
    const across = region === 'bottom';
    const el = h('div', { class: `${across ? 'split-v' : 'split-h'} dock-split`, title: t('Drag to resize · double-click to reset') });
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      el.classList.add('dragging');
      const prev = el.previousElementSibling;
      const next = el.nextElementSibling;
      const size = (x) => x.getBoundingClientRect()[across ? 'width' : 'height'];
      const start = across ? e.clientX : e.clientY;
      const pa = size(prev);
      const pb = size(next);
      const total = a.weight + b.weight;
      let weights = [a.weight, b.weight];
      const move = (ev) => {
        const d = (across ? ev.clientX : ev.clientY) - start;
        const na = Math.max(MIN_GROUP, Math.min(pa + pb - MIN_GROUP, pa + d));
        weights = [(total * na) / (pa + pb), (total * (pa + pb - na)) / (pa + pb)];
        prev.style.flexGrow = String(weights[0]);
        next.style.flexGrow = String(weights[1]);
      };
      const up = () => {
        el.classList.remove('dragging');
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        const all = layout[region].groups.map((g) => g.weight);
        all[a.index] = weights[0];
        all[b.index] = weights[1];
        layout = setWeights(layout, region, all);
        saveDock(layout);
        window.dispatchEvent(new Event('resize'));
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    // Double-click shares the space evenly between the two.
    el.addEventListener('dblclick', () => {
      const all = layout[region].groups.map((g) => g.weight);
      all[a.index] = all[b.index] = (a.weight + b.weight) / 2;
      set(setWeights(layout, region, all));
    });
    return el;
  }

  // ---- dragging a tab ----------------------------------------------------------------------------

  let dragged = false;

  function startDrag(e, id) {
    if (e.button !== 0) return;
    const sx = e.clientX;
    const sy = e.clientY;
    let ghost = null;
    let marker = null;
    let target = null;
    dragged = false;
    const move = (ev) => {
      if (!ghost) {
        if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
        dragged = true;
        ghost = h('div', { class: 'dock-ghost' }, t(PANELS[id].label));
        marker = h('div', { class: 'dock-marker', hidden: true });
        document.body.append(marker, ghost);
        appEl.classList.add('dock-dragging');
      }
      ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 10}px)`;
      const found = dropAt(ev.clientX, ev.clientY);
      target = found?.target ?? null;
      marker.hidden = !found;
      if (found) {
        const r = found.rect;
        Object.assign(marker.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('keydown', onKey, true);
      ghost?.remove();
      marker?.remove();
      appEl.classList.remove('dock-dragging');
      if (target) set(movePanel(layout, id, target));
      // The click that follows the release must not count as a tab click.
      setTimeout(() => (dragged = false), 0);
    };
    const cancel = () => {
      target = null;
      up();
    };
    const onKey = (ev) => {
      if (ev.key !== 'Escape' || !ghost) return;
      ev.preventDefault();
      ev.stopPropagation();
      cancel();
    };
    // On the window, so a quick drag that leaves the tab before the first move is still followed.
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('keydown', onKey, true);
  }

  /** Where a tab dropped at (x, y) goes: { target (for movePanel), rect (to highlight) }, or null. */
  function dropAt(x, y) {
    const under = document.elementFromPoint(x, y);
    const strip = under?.closest('.dock-tabs');
    const group = under?.closest('.dock-group');
    if (group) {
      const region = group.dataset.region;
      const index = Number(group.dataset.group);
      const r = group.getBoundingClientRect();
      if (strip) {
        // Between which tabs: before the first tab whose middle is right of the pointer.
        const tabs = [...strip.querySelectorAll('.dock-tab')];
        const at = tabs.findIndex((tb) => {
          const b = tb.getBoundingClientRect();
          return x < b.left + b.width / 2;
        });
        const ids = layout[region].groups[index].tabs;
        const shown = tabs.map((tb) => tb.dataset.panel);
        const tabIndex = at < 0 ? ids.length : ids.indexOf(shown[at]);
        return { target: { region, group: index, where: 'tab', index: tabIndex }, rect: r };
      }
      // The outer third of a group along its region puts the panel beside it; the middle joins it.
      const across = region === 'bottom';
      const f = across ? (x - r.left) / r.width : (y - r.top) / r.height;
      if (f < 1 / 3) return { target: { region, group: index, where: 'before' }, rect: half(r, across, 0) };
      if (f > 2 / 3) return { target: { region, group: index, where: 'after' }, rect: half(r, across, 1) };
      return { target: { region, group: index, where: 'tab' }, rect: r };
    }
    // Near an edge of the viewport: a group of its own in that region.
    const c = document.querySelector('#center').getBoundingClientRect();
    if (x < c.left || x > c.right || y < c.top || y > c.bottom) return null;
    const w = Math.min(EDGE * 3, c.width / 3);
    const hgt = Math.min(EDGE * 3, c.height / 3);
    if (x - c.left < EDGE) return { target: { region: 'left', where: 'new' }, rect: { left: c.left, top: c.top, width: w, height: c.height } };
    if (c.right - x < EDGE) return { target: { region: 'right', where: 'new' }, rect: { left: c.right - w, top: c.top, width: w, height: c.height } };
    if (c.bottom - y < EDGE) return { target: { region: 'bottom', where: 'new' }, rect: { left: c.left, top: c.bottom - hgt, width: c.width, height: hgt } };
    return null;
  }

  const half = (r, across, which) =>
    across
      ? { left: r.left + (which ? r.width / 2 : 0), top: r.top, width: r.width / 2, height: r.height }
      : { left: r.left, top: r.top + (which ? r.height / 2 : 0), width: r.width, height: r.height / 2 };

  // ---- api ---------------------------------------------------------------------------------------

  function set(next) {
    layout = normalizeDock(next);
    saveDock(layout);
    render();
    onChange?.(layout);
  }

  // A panel popping out or back in, or the timeline hiding in Setup mode, changes what is drawn.
  new MutationObserver(() => {
    const key = [...hidden()].sort().join();
    if (key !== hiddenKey) render();
  }).observe(appEl, { attributes: true, attributeFilter: ['class'] });

  render();
  onChange?.(layout);

  return {
    /** The current layout (a copy). */
    get: () => JSON.parse(JSON.stringify(layout)),
    /** Arranges the panels as `next` (from a saved window layout). */
    set,
    /** Back to the default arrangement (View ▸ Reset layout). */
    reset: () => {
      set(defaultDock());
      saveDock(null);
    },
    /** Opens or closes an optional panel (the Rig panel). */
    open: (id) => set(openPanel(layout, id)),
    close: (id) => set(closePanel(layout, id)),
    /** True when a panel is in the layout (shown, behind another tab, or popped out). */
    has: (id) => !!findPanel(layout, id),
    /** Where a panel sits ({ region, group, tab }), for tests. */
    where: (id) => findPanel(layout, id),
  };
}
