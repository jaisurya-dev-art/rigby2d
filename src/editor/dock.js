// SPDX-License-Identifier: MIT OR Apache-2.0
// Shared names and config for detachable panels. A panel (the timeline, the bone tree, …) can pop
// out into its own OS window (e.g. on a second monitor). The editor window stays the single
// authority (document, undo, selection); the windows mirror its state over these events. Adding a
// panel is: one entry in PANELS here, one builder in panel.js, and a detach button + CSS in the host.

/** Detachable panels, by id. width/height size the pop-out window; label titles it. */
export const PANELS = {
  timeline: { label: 'Timeline', width: 940, height: 340 },
  tree: { label: 'Tree', width: 340, height: 640 },
  inspector: { label: 'Inspector', width: 340, height: 560 },
};

/** The OS window label for a panel (a glob the capability `panel` grants: "panel-*"). */
export const panelLabel = (id) => `panel-${id}`;

/** Editor → windows: the shared editor-state snapshot (broadcast to every detached window). */
export const EV_SYNC = 'rigby:panel-sync';

/** Window → editor: { ready } on startup, { action } to forward a shortcut, else a state snapshot. */
export const EV_CONTROL = 'rigby:panel-control';

/** Window → editor: { panel } is closing, so that panel docks back into the editor. */
export const EV_CLOSED = 'rigby:panel-closed';

/** Editor → a window: { panel, x, y, w, h } (logical px): reposition/resize yourself. Used when a
 *  saved window layout is loaded and an already-open panel has to move (see panelsync / layouts). */
export const EV_PLACE = 'rigby:panel-place';
