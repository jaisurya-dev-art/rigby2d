// SPDX-License-Identifier: MIT OR Apache-2.0
// Bottom panel: animation list, transport controls and the dopesheet (the graph editor is graph.js).

import { has, timecode } from './workspaces.js';
import { Animation } from '../core/animation.js';
import { listConstraints } from '../core/constraintdata.js';
import { keyedChannels, setConstraintCurve } from '../core/constraintkeys.js';
import { EASE_IN, EASE_IN_OUT, EASE_OUT, LINEAR, STEPPED, cloneCurve, isBezier } from '../core/curve.js';
import { uniqueName } from '../core/model.js';
import { FPS, Mode, selBone, selSlot, snap } from './app.js';
import * as edit from './edit.js';
import { clearSpan, findTrack, makeClipboard, pasteClipboard, planPaste, previewKeys, trackRef } from './keyclip.js';
import { dragValue, h, popupMenu, select, textField } from './widgets.js';
import { button, dialog } from './ui.js';
// The dopesheet's row order and key-selection-by-index live in keyorder.js (core-only, so the
// selection round trip can be tested in Node). Re-exported here so the windows import them as before.
import { tracks, trackKeys } from './keyorder.js';
import { drawLanes, laneActors, pressLane } from './sceneui.js';
import { t, tn } from './i18n.js';
import { FPS_PRESETS, formatFps } from './output.js';
import { shortcutLabel, withShortcut } from './keymap.js';
export { orderedKeys, keySelectionIndices, applyKeySelection } from './keyorder.js';

const GUTTER = 170;
const ROW = 20;
const RULER = 22;

/**
 * The time readout: timecode and frame in the Film workspace, frame and seconds in Game. Numbers
 * are padded to the animation's length and the box has one width in both workspaces, so nothing
 * next to it moves while playing or when switching workspaces.
 */
function timeReadout(app, anim) {
  const frames = Math.round(app.time * FPS);
  const width = String(Math.max(1, Math.round((anim?.duration ?? 0) * FPS))).length;
  const frame = t('frame {frame}', { frame: String(frames).padStart(width, ' ') });
  const film = has(app, 'timecode');
  const text = film ? `${timecode(app.time, FPS)}  ${frame}` : `${frame}  ${app.time.toFixed(2).padStart(String(Math.floor(anim?.duration ?? 0)).length + 3, ' ')}s`;
  return h('span', { class: 'mono time-readout', title: film ? t('Timecode (minutes:seconds:frames) and frame') : t('Frame and seconds') }, text);
}

/** The animation frame rate (a project setting, also written to exports), as on most timelines. */
function fpsSelect(app) {
  const s = app.doc.settings;
  const options = FPS_PRESETS.includes(s.fps) ? FPS_PRESETS : [...FPS_PRESETS, s.fps].sort((a, b) => a - b);
  const el = select(
    options.map((f) => [f, `${formatFps(f)} fps`]),
    s.fps,
    (v) => {
      s.fps = v;
      app.changed();
    },
  );
  el.classList.add('fps');
  el.title = t('Frame rate of the project (also written to exports)');
  return el;
}

/** The playback speed menu: as narrow as its longest choice, with a tooltip. */
function speedSelect(...args) {
  const el = select(...args);
  el.classList.add('speed');
  el.title = t('Playback speed');
  return el;
}

/** Transport and animation controls (rebuilt when the app changes). */
export function renderControls(app, el) {
  const anim = app.currentAnimation();
  const names = app.doc.animations.map((a, i) => [i, a.name]);
  const play = h('button', { class: 'transport', 'data-tut': 'timeline:play', disabled: app.anim === null, title: withShortcut(t('Play / pause'), app.keymap, 'play.forward'), onclick: () => app.togglePlay() }, app.playing ? '⏸' : '▶');
  el.replaceChildren(
    ...[
      names.length
        ? select(
            names,
            app.anim ?? 0,
            (i) => {
              app.anim = i;
              app.time = 0;
              app.selectedKeys.clear();
              app.changed();
            },
            { tut: 'timeline:animations' },
          )
        : h('span', { class: 'weak' }, t('(no animation)')),
      h(
        'button',
        {
          'data-tut': 'timeline:new',
          onclick: () => {
            app.doc.animations.push(new Animation(uniqueName('animation', (n) => app.doc.animations.some((a) => a.name === n)), 1));
            app.anim = app.doc.animations.length - 1;
            app.mode = Mode.Animate;
            app.time = 0;
            app.changed();
          },
        },
        t('＋ New'),
      ),
      anim
        ? [
            textField(
              anim.name,
              (v) => {
                anim.name = v;
                app.changed();
              },
              { width: '110px' },
            ),
            h('span', null, t('Length')),
            dragValue(
              anim.duration,
              (v) => {
                anim.duration = v;
                app.changed();
              },
              { speed: 0.01, min: 1 / FPS, max: 600, suffix: ' s', decimals: 2 },
            ),
            h(
              'button',
              {
                title: t('Delete animation'),
                onclick: () => {
                  app.doc.animations.splice(app.anim, 1);
                  app.anim = app.doc.animations.length ? 0 : null;
                  app.selectedKeys.clear();
                  app.changed();
                },
              },
              '🗑',
            ),
          ]
        : null,
      h('span', { class: 'vsep' }),
      h(
        'button',
        {
          title: withShortcut(t('Go to start'), app.keymap, 'time.start'),
          onclick: () => {
            app.time = 0;
            app.playing = false;
            app.changed();
          },
        },
        '⏮',
      ),
      h('button', { class: 'transport', title: withShortcut(t('Previous frame'), app.keymap, 'frame.previous'), onclick: () => app.stepFrame(-1) }, '◀'),
      play,
      h('button', { class: 'transport', 'data-tut': 'timeline:next', title: withShortcut(t('Next frame'), app.keymap, 'frame.next'), onclick: () => app.stepFrame(1) }, '▶|'),
      h(
        'label',
        { title: withShortcut(t('Toggle looping'), app.keymap, 'loop.toggle') },
        h('input', {
          type: 'checkbox',
          checked: app.looping,
          onchange: (e) => {
            app.looping = e.target.checked;
            app.changed();
          },
        }),
        ' ' + t('Loop'),
      ),
      h(
        'label',
        { title: t('Boomerang: with Loop on, plays to the end and back (a preview; exports are unchanged)') },
        h('input', {
          type: 'checkbox',
          checked: app.boomerang,
          disabled: !app.looping,
          onchange: (e) => {
            app.boomerang = e.target.checked;
            app.changed();
          },
        }),
        ' ' + t('Boomerang'),
      ),
      fpsSelect(app),
      h('span', { class: 'vsep' }),
      h('button', { 'data-tut': 'timeline:key', disabled: app.mode !== Mode.Animate, onclick: () => edit.keySelection(app) }, t('◆ Key (K)')),
      h('span', { class: 'vsep' }),
      h('button', { title: t('Copy selected keys (Ctrl+C)'), disabled: !app.selectedKeys.size, onclick: () => copySelectedKeys(app) }, t('⧉ Copy')),
      h('button', { title: t('Paste keys at the playhead (Ctrl+V)'), disabled: !hasClipboard(), onclick: () => pasteKeys(app) }, t('⎘ Paste')),
      h(
        'button',
        {
          class: frameSelectActive() ? 'active' : '',
          title: t('Select whole frame columns: drag to select a range, Alt+drag to add another. Click again for key select.'),
          onclick: () => toggleFrameSelect(app),
        },
        t('▦ Frames'),
      ),
      h(
        'button',
        {
          class: multiAddActive() ? 'active' : '',
          title: t('Multi-select: each drag adds another area (keys or columns) without holding Ctrl/Alt. Copy or Escape ends it.'),
          onclick: () => toggleMultiAdd(app),
        },
        t('＋ Multi'),
      ),
      h(
        'button',
        {
          class: pasteModeActive() ? 'active' : '',
          title: t('How paste treats existing keys. Click to cycle: Merge → Overwrite (copied tracks) → Overwrite all (whole area). Erased keys show a red ✕ in the preview.'),
          onclick: () => cyclePasteMode(app),
        },
        pasteModeLabel(),
      ),
      h(
        'button',
        {
          class: retimeArmedActive() ? 'active' : '',
          title: t('Retime (scale the selected keys’ timing): show the drag handles for one use. Or right-click + drag anytime.'),
          onclick: () => toggleRetime(app),
        },
        t('⇔ Retime'),
      ),
      h('span', { class: 'vsep' }),
      h(
        'span',
        { class: 'segmented', title: t('Timeline view') },
        [
          ['dopesheet', t('Dopesheet')],
          ['graph', t('Graph')],
        ].map(([id, label]) =>
          h(
            'button',
            {
              class: app.timelineView === id ? 'active' : '',
              onclick: () => {
                app.timelineView = id;
                app.changed();
              },
            },
            label,
          ),
        ),
      ),
      // The time readout last, where the eye ends up after the tools, with the playback speed
      // next to it.
      anim && h('span', { class: 'vsep' }),
      anim && timeReadout(app, anim),
      speedSelect(
        [
          [0.1, '0.1×'],
          [0.25, '0.25×'],
          [0.5, '0.5×'],
          [1, '1×'],
          [1.5, '1.5×'],
          [2, '2×'],
        ],
        app.playSpeed ?? 1,
        (v) => {
          app.playSpeed = v;
          app.changed();
        },
        { tut: 'timeline:speed' },
      ),
    ]
      .flat()
      .filter(Boolean),
  );
}

/** Deletes every selected key. */
export function deleteSelectedKeys(app) {
  const anim = app.currentAnimation();
  if (!anim || !app.selectedKeys.size) return;
  const drop = (keys) => {
    for (let i = keys.length - 1; i >= 0; i--) if (app.selectedKeys.has(keys[i])) keys.splice(i, 1);
  };
  for (const tl of [...anim.bones, ...anim.slots]) for (const v of Object.values(tl)) if (Array.isArray(v)) drop(v);
  for (const tl of [...anim.deform, ...anim.ik]) drop(tl.keys);
  drop(anim.drawOrder);
  drop(anim.events);
  for (const t of keyedChannels(anim, listConstraints(app.doc))) drop(t.keys);
  for (const keys of sequenceLists(anim)) drop(keys);
  pruneConstraintKeys(anim);
  const count = app.selectedKeys.size;
  app.selectedKeys.clear();
  anim.prune();
  app.setStatus(count === 1 ? t('Deleted 1 key') : t('Deleted {count} keys', { count }));
}

// ---- copy and paste ---------------------------------------------------------------------------
// The selected keys are copied with their absolute times; on paste the earliest lands on the
// playhead. The clipboard lives for the editor session (not the OS clipboard): keys hold arbitrary
// values (vectors, deform meshes, event fields) that do not round-trip as text. The paste math and
// the overflow decision are in keyclip.js (pure, unit-tested); this file supplies the track lookup.

// `clipboard` holds the copied keys; while it is set the copy is "armed": the source keys and their
// frame span are drawn green and a pulsing purple preview of the paste follows the playhead. Pasting
// or Escape disarms it (the green and the preview disappear); so does starting a fresh selection.
let clipboard = null;
let copiedSource = null; // the original key objects a copy marks green while armed
let frameSelect = false; // true while the dopesheet is armed to select whole frame columns
let multiAdd = false; // true makes every selection gesture add to the selection (multi-region)
// How paste treats existing keys in the pasted area: 'none' merges, 'overwrite' clears the span in
// the copied tracks, 'full' clears it in every track the selection spanned (even empty ones).
let pasteMode = 'none';
const PASTE_MODES = ['none', 'overwrite', 'full'];
const PASTE_LABELS = { none: tn('⊟ Merge'), overwrite: tn('⊟ Overwrite'), full: tn('⊟ Overwrite all') };
let selectionIsColumns = false; // the current selection came from the ruler (whole columns), not a box
let retimeArmed = false; // true shows the retiming handles for one use (otherwise hidden)
// The areas the current selection was built from, each { f0, f1, r0, r1, full } in frames/rows, so the
// copy preview can draw one coloured band per section instead of one band across the gaps.
let selectionRegions = [];
// The app.docEpoch this window last reconciled to. When a project is opened/created the epoch bumps
// (it rides the state snapshot, so a detached window sees it too) and reconcileToDocument disarms the
// copy: its clipboard holds keys from the old project, so pasting them — or showing their preview
// over the new one — would be wrong.
let docEpochSeen = 0;

/** Drops the armed copy and select modes when the open document was replaced (open/new/sample). */
function reconcileToDocument(app) {
  if (app.docEpoch === docEpochSeen) return;
  docEpochSeen = app.docEpoch;
  exitSelectModes();
}

// The app.timelineClipStamp this window last reconciled. The clipboard is module-local for fast draws,
// but it is mirrored on `app` (serializable) so it crosses windows in the state snapshot.
let clipStampSeen = 0;

/** Keeps the module clipboard in step with the shared app.timelineClip, both ways: adopt a copy that
 *  arrived from the other window (stamp moved), else publish a copy made here (the vars diverged). So
 *  detaching/docking the timeline carries the armed copy and its preview to the window that now shows
 *  the dopesheet. The per-diamond green source tint (copiedSource) stays window-local — the green band
 *  from clipboard.regions still marks the source area. */
function syncClipboard(app) {
  if (app.timelineClipStamp !== clipStampSeen) {
    clipStampSeen = app.timelineClipStamp;
    clipboard = app.timelineClip;
    copiedSource = null;
  } else if (clipboard !== app.timelineClip) {
    app.timelineClip = clipboard;
    app.timelineClipStamp++;
    clipStampSeen = app.timelineClipStamp;
  }
}

/** Whether there is something to paste (drives the Paste button and menu item). */
export function hasClipboard() {
  return clipboard !== null;
}

/** Disarms the copy without a message (a fresh selection replaces it). */
function endCopyArming() {
  clipboard = null;
  copiedSource = null;
}

/** Copies the selected keys to the dopesheet clipboard, grouped by their track, and arms the copy. */
/** Copies the selected keys, then deletes them. */
export function cutSelectedKeys(app) {
  if (!app.currentAnimation() || !app.selectedKeys.size) {
    app.setStatus(t('Select keys to cut'));
    return;
  }
  copySelectedKeys(app);
  deleteSelectedKeys(app);
  app.changed();
}

export function copySelectedKeys(app) {
  const anim = app.currentAnimation();
  if (!anim || !app.selectedKeys.size) {
    app.setStatus(t('Select keys to copy'));
    return;
  }
  const groups = [];
  const source = new Set();
  for (const { track } of tracks(app, anim)) {
    const picked = (trackKeys(anim, track) ?? []).filter((k) => app.selectedKeys.has(k));
    if (picked.length) groups.push({ track, keys: picked });
    for (const k of picked) source.add(k);
  }
  // The clipboard names its tracks (trackRef), so a paste after bones were added or deleted, or into
  // another animation, still lands on the same bone, slot, deform or IK track.
  clipboard = makeClipboard(groups.map((g) => ({ track: trackRef(app.doc, anim, g.track), keys: g.keys })).filter((g) => g.track));
  if (clipboard) {
    clipboard.rowRange = rowSpanOf(app, anim, groups); // copied rows, for the fallback region below
    // One coloured band per copied section (fall back to a single band over the whole copy).
    clipboard.regions = selectionRegions.length
      ? selectionRegions.map((r) => ({ ...r }))
      : [{ f0: Math.round(clipboard.origin * FPS), f1: Math.round((clipboard.origin + clipboard.span) * FPS), r0: clipboard.rowRange.min, r1: clipboard.rowRange.max, full: selectionIsColumns }];
    // The copied AREA's frame span (the green band, blank columns the box swept included), stored as
    // times relative to the paste origin, so overwrite clears/marks the whole band — not just the keys.
    const originFrame = Math.round(clipboard.origin * FPS);
    let minF = Infinity;
    let maxF = -Infinity;
    for (const r of clipboard.regions) {
      minF = Math.min(minF, r.f0);
      maxF = Math.max(maxF, r.f1);
    }
    if (!Number.isFinite(minF)) {
      minF = originFrame;
      maxF = originFrame + Math.round(clipboard.span * FPS);
    }
    clipboard.cover = { start: (minF - originFrame) / FPS, end: (maxF - originFrame) / FPS };
    // The tracks the area spans, by name, for 'full' overwrite: rows sit in a different order in
    // another animation, so clearing by row number would hit unrelated tracks. null: every track
    // (a column selection from the ruler).
    const rowsNow = tracks(app, anim);
    const { lo, hi } = coverRowBounds(clipboard, rowsNow.length);
    clipboard.area = clipboard.regions.some((r) => r.full)
      ? null
      : rowsNow.slice(lo, hi + 1).map(({ track }) => trackRef(app.doc, anim, track)).filter(Boolean);
  }
  copiedSource = clipboard ? source : null;
  // Copying ends the selection gestures (Frames and Multi): the mouse is now free to pick a paste
  // spot without the next click being read as a new selection that would cancel the copy.
  frameSelect = false;
  multiAdd = false;
  clearRegions(); // the copy snapshotted them; the next selection gesture starts fresh
  const n = clipboard?.count ?? 0;
  app.setStatus(n === 1 ? t('Copied 1 key — move the playhead and paste (Ctrl+V), Escape to cancel') : t('Copied {count} keys — move the playhead and paste (Ctrl+V), Escape to cancel', { count: n }));
}

/** The dopesheet track id a copied track has in `anim` now (its row, if it has one). */
function copiedId(app, anim, ref) {
  return trackId(findTrack(app.doc, anim, ref) ?? ref);
}

/** The rows of `rows` (this animation's dopesheet) that 'full' overwrite clears: the tracks the
 *  copied area spanned, found by name. */
function areaRows(app, anim, rows) {
  if (!clipboard.area) return rows.map((_, r) => r);
  const ids = new Set(clipboard.area.map((ref) => copiedId(app, anim, ref)));
  return rows.flatMap(({ track }, r) => (ids.has(trackId(track)) ? [r] : []));
}

/** The min/max dopesheet row the copied tracks occupy (so 'full' overwrite can clear between them). */
function rowSpanOf(app, anim, groups) {
  const rows = tracks(app, anim);
  const idx = new Map(rows.map(({ track }, r) => [trackId(track), r]));
  let min = Infinity;
  let max = -Infinity;
  for (const g of groups) {
    const r = idx.get(trackId(g.track));
    if (r === undefined) continue;
    min = Math.min(min, r);
    max = Math.max(max, r);
  }
  return max >= min ? { min, max } : { min: 0, max: 0 };
}

/** The row range the copied AREA covers (its selection regions), so 'full' overwrite clears/marks the
 *  whole area's height — every row the selection spanned, not only the ones with a copied key. */
function coverRowBounds(clipboard, rowCount) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const r of clipboard.regions ?? []) {
    if (r.full) return { lo: 0, hi: rowCount - 1 };
    lo = Math.min(lo, r.r0);
    hi = Math.max(hi, r.r1);
  }
  if (!Number.isFinite(lo)) return { lo: 0, hi: rowCount - 1 };
  return { lo: Math.max(0, lo), hi: Math.min(rowCount - 1, hi) };
}

/** Escape's reset for the timeline: cancels any armed copy and leaves the Frames/Multi/Retime modes. */
export function exitSelectModes() {
  endCopyArming();
  clearRegions();
  frameSelect = false;
  multiAdd = false;
  retimeArmed = false;
}

/** Whether the retiming handles are shown (drives the ⇔ Retime button). */
export function retimeArmedActive() {
  return retimeArmed;
}

/** Arms (or disarms) the retiming handles. They scale the selected keys' timing, then disarm. */
export function toggleRetime(app) {
  retimeArmed = !retimeArmed;
  app.setStatus(retimeArmed ? t('Retime: drag an end of the selected range to scale its timing (one use). Right-drag works anytime.') : t('Retime off.'));
}

/** Records a selection area so the copy preview can colour each copied section on its own. */
function setRegion(region, add) {
  if (add) selectionRegions.push(region);
  else selectionRegions = [region];
}

function clearRegions() {
  selectionRegions = [];
}

/** The dopesheet row a pixel y falls on. */
function rowAt(y) {
  return Math.max(0, Math.floor((y - RULER) / ROW));
}

/** Whether frame-column selection is armed (drives the ▦ Frames button). */
export function frameSelectActive() {
  return frameSelect;
}

/** Toggles frame-column selection: drag selects whole columns instead of key boxes. */
export function toggleFrameSelect(app) {
  frameSelect = !frameSelect;
  if (frameSelect) endCopyArming(); // re-arming a column selection drops any pending copy
  app.setStatus(frameSelect ? t('Frame columns: drag (or Alt+drag) to select; Alt or Multi add more.') : t('Key select: drag a box over the keys.'));
}

/** Whether multi-region add is on (drives the Multi button). */
export function multiAddActive() {
  return multiAdd;
}

/** Toggles multi-region select: every box or column adds to the selection, no Ctrl/Alt needed. */
export function toggleMultiAdd(app) {
  multiAdd = !multiAdd;
  if (multiAdd) endCopyArming();
  app.setStatus(multiAdd ? t('Multi-select: each drag adds another area. Copy or Escape to finish.') : t('Single select.'));
}

/** The paste mode's button label (changes as it cycles). */
export function pasteModeLabel() {
  return t(PASTE_LABELS[pasteMode]);
}

/** Whether paste is in an overwriting mode (drives the button's active state). */
export function pasteModeActive() {
  return pasteMode !== 'none';
}

/** Cycles paste between Merge, Overwrite (copied tracks) and Overwrite all (whole area). */
export function cyclePasteMode(app) {
  pasteMode = PASTE_MODES[(PASTE_MODES.indexOf(pasteMode) + 1) % PASTE_MODES.length];
  const msg = {
    none: t('Paste merges: existing keys between the pasted ones are kept.'),
    overwrite: t('Paste overwrites: clears existing keys in the pasted area, in the copied tracks.'),
    full: t('Paste overwrites all: clears the whole pasted area, even tracks with no copied key.'),
  };
  app.setStatus(msg[pasteMode]);
}

/** The key list a copied track pastes into, creating bone/slot timelines as needed. Other track
 *  kinds (deform, IK, constraints, sequences, draw order, events) paste only where they exist. */
function resolveTrackKeys(anim, track) {
  if (track.bone !== undefined && track.channel) return anim.boneTimelineMut(track.bone)[track.channel];
  if (track.slot !== undefined) return anim.slotTimelineMut(track.slot)[track.channel ?? 'attachment'];
  return trackKeys(anim, track) ?? null;
}

/** Pastes the clipboard at the playhead. Prompts when the keys would run past the animation's end. */
export function pasteKeys(app) {
  reconcileToDocument(app); // never paste the old project's keys if a new one was opened (e.g. in graph view)
  const anim = app.currentAnimation();
  if (!anim) {
    app.setStatus(t('Select an animation to paste into'));
    return;
  }
  if (!clipboard) {
    app.setStatus(t('Clipboard is empty — copy keys first (Ctrl+C)'));
    return;
  }
  const pasteTime = snap(app.time);
  const plan = planPaste(clipboard, pasteTime, anim.duration, FPS);
  if (plan.fits) {
    applyPaste(app, anim, pasteTime, { mode: 'all' });
    return;
  }
  overflowDialog(plan.extraFrames, {
    expand: () => {
      anim.duration = plan.lastTime;
      applyPaste(app, anim, pasteTime, { mode: 'all' });
    },
    clip: () => applyPaste(app, anim, pasteTime, { mode: 'clip', limit: anim.duration }),
    cancel: () => app.setStatus(t('Paste cancelled')),
  });
}

function applyPaste(app, anim, pasteTime, opts) {
  app.playing = false;
  app.mode = Mode.Animate;
  // 'full' clears the whole pasted area first, including tracks the copy did not touch. The span is
  // the copied AREA (blank columns included), matching the preview, not just the keys' extent.
  if (pasteMode === 'full') {
    const from = pasteTime + (clipboard.cover?.start ?? 0);
    const end0 = pasteTime + (clipboard.cover?.end ?? clipboard.span);
    const end = opts.mode === 'clip' ? Math.min(end0, opts.limit) : end0;
    const rows = tracks(app, anim);
    const copied = new Set(clipboard.groups.map((g) => copiedId(app, anim, g.track)));
    for (const r of areaRows(app, anim, rows)) {
      const track = rows[r].track;
      if (!track || copied.has(trackId(track))) continue; // copied tracks are cleared by pasteClipboard
      const keys = resolveTrackKeys(anim, track);
      if (keys) clearSpan(keys, from, end);
    }
  }
  const pasted = pasteClipboard(clipboard, pasteTime, { ...opts, snap, replace: pasteMode !== 'none' }, (ref) => {
    const track = findTrack(app.doc, anim, ref, true);
    return track ? resolveTrackKeys(anim, track) : null;
  });
  resortAnimation(anim);
  endCopyArming(); // paste disarms the copy: the green source and the preview go away
  clearRegions(); // and the next selection gesture starts fresh, not adding to the pasted area
  app.selectedKeys = new Set(pasted); // select what was pasted, ready to nudge
  const n = pasted.length;
  app.setStatus(n ? t('Pasted {count} key(s) at frame {frame}', { count: n, frame: Math.round(pasteTime * FPS) }) : t('Nothing pasted (no keys fit)'));
  app.changed();
}

/** Asks how to handle a paste that overflows the animation: extend, paste what fits, or cancel. */
function overflowDialog(extraFrames, actions) {
  let chosen = actions.cancel;
  const choose = (fn) => () => {
    chosen = fn;
    close();
  };
  const { body, close } = dialog({
    title: t('Paste runs past the end'),
    className: 'choice-dialog',
    onClose: () => chosen(),
    footer: [
      button(t('Cancel'), { onclick: choose(actions.cancel) }),
      button(t('Paste what fits'), { onclick: choose(actions.clip) }),
      button(t('Extend by {count} frame(s)', { count: extraFrames }), { kind: 'primary', onclick: choose(actions.expand) }),
    ],
  });
  body.append(h('p', null, t("The pasted keys extend {count} frame(s) beyond the animation's length.", { count: extraFrames })));
}

function keyFill(selected, curve) {
  if (selected) return 'rgb(255,190,60)';
  // Stepped ("stopped") keys are marine cyan. They used to be purple, but copy/paste now owns purple
  // for the paste preview, so the two no longer clash.
  if (curve === STEPPED) return 'rgb(60,170,205)';
  if (isBezier(curve)) return 'rgb(120,220,140)';
  return 'rgb(230,230,230)';
}

export class Dopesheet {
  constructor(app, scroller, canvas) {
    this.app = app;
    this.scroller = scroller;
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.keyRects = [];
    this.layout = null;
    this.press = null;
    /** Zoomed time window { t0, t1 } (Ctrl+wheel zooms, Alt+wheel pans), or null for the whole animation. */
    this.view = null;
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', () => (this.press = null));
    canvas.addEventListener('pointerleave', () => app.setHover(null));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  draw() {
    const app = this.app;
    reconcileToDocument(app); // a project just opened? drop the armed copy before anything draws it
    syncClipboard(app); // adopt a copy from the other window, or publish one made here (detach/dock)
    const anim = app.currentAnimation();
    const empty = this.scroller.parentElement.querySelector('.empty');
    empty.hidden = !!anim;
    this.scroller.hidden = !anim;
    if (!anim) {
      this.rows = null;
      return;
    }

    // The selection's coloured areas live only as long as there are selected keys.
    if (!app.selectedKeys.size) selectionRegions = [];
    const wantCursor = frameSelect ? 'crosshair' : 'default';
    if (this.canvas.style.cursor !== wantCursor) this.canvas.style.cursor = wantCursor;

    const rows = tracks(app, anim);
    this.rows = rows; // kept so pointer hover can map a y position to a track's bone
    // Scenes: a clip lane per actor sits between the ruler and the key rows.
    const lanes = has(app, 'scene') ? laneActors(app).length : 0;
    const top = RULER + lanes * ROW;
    this.top = top;
    const duration = Math.max(anim.duration, 1 / FPS);
    const width = Math.max(1, this.scroller.clientWidth);
    const height = Math.max(top + Math.max(rows.length, 1) * ROW + 6, this.scroller.clientHeight);
    const dpr = window.devicePixelRatio || 1;
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    if (this.canvas.width !== Math.round(width * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(width * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    const ctx = this.ctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgb(30,30,30)';
    ctx.fillRect(0, 0, width, height);

    const trackLeft = GUTTER;
    const trackW = Math.max(10, width - 12 - trackLeft);
    // The time window shown: the whole animation, or the zoomed part of it.
    const view = this.clampView(this.view, duration);
    const t0 = view ? view.t0 : 0;
    const viewSpan = view ? view.t1 - view.t0 : duration;
    const timeToX = (t) => trackLeft + ((t - t0) / viewSpan) * trackW;
    this.layout = { trackLeft, trackW, duration, t0, span: viewSpan };

    // Ruler with frame ticks. Zoomed, everything right of the labels is clipped to the track area.
    ctx.fillStyle = 'rgb(45,45,45)';
    ctx.fillRect(0, 0, width, RULER);
    ctx.save();
    if (view) {
      ctx.beginPath();
      ctx.rect(trackLeft - 7, 0, width - trackLeft + 7, height);
      ctx.clip();
    }
    const frames = Math.round(duration * FPS);
    const pxPerFrame = trackW / (viewSpan * FPS);
    const labelEvery = [1, 2, 5, 10, 15, 30, 60].find((n) => n * pxPerFrame >= 34) ?? 120;
    ctx.strokeStyle = 'rgb(120,120,120)';
    ctx.lineWidth = 1;
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgb(170,170,170)';
    ctx.beginPath();
    for (let f = Math.max(0, Math.floor(t0 * FPS)); f <= Math.min(frames, Math.ceil((t0 + viewSpan) * FPS)); f++) {
      const x = Math.round(timeToX(f / FPS)) + 0.5;
      const major = f % labelEvery === 0;
      if (major || pxPerFrame >= 5) {
        ctx.moveTo(x, RULER - (major ? 10 : 5));
        ctx.lineTo(x, RULER);
      }
      if (major) ctx.fillText(String(f), x + 2, 2);
    }
    ctx.stroke();
    ctx.restore();

    // Rows.
    const selectedBone = selBone(app.sel);
    const selectedSlot = selSlot(app.sel);
    // Tracks a live copy took from get a purple label, to match the purple paste preview.
    const copiedTrackIds = clipboard ? new Set(clipboard.groups.map((g) => copiedId(app, anim, g.track))) : null;
    this.keyRects = [];
    this.laneRects = lanes ? drawLanes(ctx, app, { top: RULER, row: ROW, width, gutter: GUTTER, timeToX }) : [];
    rows.forEach(({ track, label }, r) => {
      const y = top + r * ROW;
      const highlight = (track.bone !== undefined && track.bone === selectedBone) || (track.slot !== undefined && track.slot === selectedSlot);
      if (r % 2 === 1 || highlight) {
        ctx.fillStyle = highlight ? 'rgb(55,50,40)' : 'rgb(34,34,34)';
        ctx.fillRect(0, y, width, ROW);
      }
      // Shared bone hover: tint the whole row background (magenta, matching the viewport glow and the
      // tree) rather than outlining it, so it reads clearly at a glance.
      if (track.bone !== undefined && track.bone === app.hoverBone) {
        ctx.fillStyle = 'rgba(255,70,205,0.22)';
        ctx.fillRect(0, y, width, ROW);
      }
      ctx.font = '12px system-ui, "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = copiedTrackIds?.has(trackId(track)) ? 'rgb(185,135,255)' : 'rgb(200,200,200)';
      ctx.fillText(label, 8, y + ROW / 2, GUTTER - 14);
    });
    // Keys and everything over them stay right of the labels when zoomed.
    ctx.save();
    if (view) {
      ctx.beginPath();
      ctx.rect(trackLeft - 7, RULER, width - trackLeft + 7, height);
      ctx.clip();
    }
    rows.forEach(({ track }, r) => {
      const y = top + r * ROW;
      (trackKeys(anim, track) ?? []).forEach((k, index) => {
        const c = [timeToX(k.time), y + ROW / 2];
        const fill = copiedSource?.has(k) ? 'rgb(60,220,110)' : keyFill(app.selectedKeys.has(k), k.curve);
        diamond(ctx, c, 5.5, fill);
        this.keyRects.push({ x0: c[0] - 6, x1: c[0] + 6, y0: c[1] - 7, y1: c[1] + 7, key: k, keys: trackKeys(anim, track), index, time: k.time });
      });
    });
    ctx.strokeStyle = 'rgb(60,60,60)';
    ctx.beginPath();
    ctx.moveTo(trackLeft + 0.5, 0);
    ctx.lineTo(trackLeft + 0.5, height);
    ctx.stroke();

    // Selection box and retiming handles.
    if (this.press?.box) {
      const { from, to } = this.press.box;
      ctx.fillStyle = 'rgba(255,170,40,0.1)';
      ctx.strokeStyle = 'rgb(255,170,40)';
      ctx.lineWidth = 1;
      ctx.fillRect(Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
      ctx.strokeRect(Math.min(from[0], to[0]) + 0.5, Math.min(from[1], to[1]) + 0.5, Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
    }
    this.handles = null;
    // The retiming handles are hidden by default (they used to get in the way). They show when armed
    // with the ⇔ Retime button (one use), or while a right-drag retime is underway — so the right-drag
    // scales with visible feedback (the band and the two handles) instead of silently.
    const span = retimeArmed || (this.press?.right && this.press?.retime) ? this.selectionSpan() : null;
    if (span && span.max - span.min > 1e-6) {
      const x0 = timeToX(span.min);
      const x1 = timeToX(span.max);
      ctx.fillStyle = 'rgba(255,190,60,0.18)';
      ctx.fillRect(x0, RULER - 8, x1 - x0, 8);
      ctx.fillStyle = 'rgb(255,190,60)';
      for (const x of [x0, x1]) ctx.fillRect(x - 3, RULER - 12, 6, 12);
      this.handles = { x0, x1, min: span.min, max: span.max };
    }

    const half = pxPerFrame / 2;
    // A shared per-frame budget so even large bands keep drawing hollow diamonds (they only stop once
    // this many have been drawn, instead of the whole band blanking out past a size threshold).
    let emptyBudget = 1600;
    const hollowAt = (x, y, stroke) => {
      if (emptyBudget <= 0) return;
      hollowDiamond(ctx, [x, y], 4.5, stroke);
      emptyBudget--;
    };
    // Hollow diamonds for the blank cells of a region (the frames with no key). `occFor(track)` gives
    // the frames that DO hold a key on that track (or null to skip the row — e.g. a non-copied row in
    // the paste preview); `offset` shifts the drawn column (the paste preview is offset by `delta`).
    const emptyCells = (reg, offset, stroke, occFor) => {
      const lo = reg.full ? 0 : Math.max(0, Math.min(reg.r0, reg.r1));
      const hi = reg.full ? rows.length - 1 : Math.min(rows.length - 1, Math.max(reg.r0, reg.r1));
      const a = Math.max(0, Math.min(reg.f0, reg.f1));
      const b = Math.min(frames, Math.max(reg.f0, reg.f1));
      if (hi < lo || b < a) return;
      for (let r = lo; r <= hi; r++) {
        const track = rows[r]?.track;
        if (!track) continue;
        const occ = occFor(track);
        if (!occ) continue;
        const cy = RULER + r * ROW + ROW / 2;
        for (let f = a; f <= b; f++) {
          if (occ.has(f)) continue;
          const tf = f + offset;
          if (tf < 0 || tf > frames) continue;
          hollowAt(timeToX(tf / FPS), cy, stroke);
        }
      }
    };
    const occCurrent = (track) => new Set((trackKeys(anim, track) ?? []).map((k) => Math.round(k.time * FPS)));
    const EMPTY_SEL = 'rgba(230,205,130,0.35)';

    const columnBand = (fromF, toF, top, fill, stroke) => {
      const bx0 = timeToX(Math.min(fromF, toF) / FPS) - half;
      const bx1 = timeToX(Math.max(fromF, toF) / FPS) + half;
      ctx.fillStyle = fill;
      ctx.fillRect(bx0, top, bx1 - bx0, height - top);
      if (stroke) {
        ctx.strokeStyle = stroke;
        ctx.lineWidth = 1;
        ctx.strokeRect(bx0 + 0.5, top + 0.5, bx1 - bx0, height - top - 1);
      }
    };

    // Committed selected areas (yellow), shown whenever no copy is armed. They stay visible while a
    // new Alt+drag adds another area; only a *replacing* drag (no Ctrl/Alt/Multi) hides them, since it
    // is about to replace them. One band per area, so several areas all show (not just the last).
    const dragging = this.press?.started && (this.press?.frameBox || this.press?.box);
    if (!clipboard && !(dragging && !this.press?.add)) {
      for (const reg of selectionRegions) {
        const rTop = reg.full ? RULER : RULER + Math.max(0, reg.r0) * ROW;
        const rBot = reg.full ? height : RULER + (Math.min(rows.length - 1, reg.r1) + 1) * ROW;
        const bx0 = timeToX(reg.f0 / FPS) - half;
        const bx1 = timeToX(reg.f1 / FPS) + half;
        ctx.fillStyle = 'rgba(255,170,40,0.10)';
        ctx.fillRect(bx0, rTop, Math.max(2, bx1 - bx0), rBot - rTop);
        ctx.fillStyle = 'rgba(255,170,40,0.85)';
        ctx.fillRect(bx0, RULER - 4, Math.max(2, bx1 - bx0), 4);
        emptyCells(reg, 0, EMPTY_SEL, occCurrent);
      }
    }
    // Live frame-column drag on top (also a right-drag selecting columns to retime).
    if (this.press?.frameBox) {
      columnBand(this.press.frameBox.from, this.press.frameBox.to, 0, 'rgba(255,170,40,0.14)', 'rgb(255,170,40)');
      emptyCells({ f0: this.press.frameBox.from, f1: this.press.frameBox.to, r0: 0, r1: 0, full: true }, 0, EMPTY_SEL, occCurrent);
    }
    // Live key-box drag: hollow the empty cells the box currently sweeps (a box can include blanks).
    if (this.press?.box) {
      const { from, to } = this.press.box;
      const reg = this.boxRegion(Math.min(from[0], to[0]), Math.min(from[1], to[1]), Math.max(from[0], to[0]), Math.max(from[1], to[1]));
      if (reg) emptyCells(reg, 0, EMPTY_SEL, occCurrent);
    }

    // Armed copy: the source span in green, and a pulsing purple preview of the paste at the playhead.
    if (clipboard) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
      const rowOf = new Map(rows.map(({ track }, r) => [trackId(track), r]));
      // The bands cover only the copied rows (a box selection is bounded to its pistas); a column
      // selection from the ruler spans every row.
      const copiedRows = clipboard.groups.map((g) => rowOf.get(copiedId(app, anim, g.track))).filter((r) => r !== undefined);
      // One band per copied section: green at the source, purple at the paste offset. Each section
      // keeps its own rectangle so disjoint copies don't share one band across the gap.
      const pasteTime = snap(app.time);
      const originFrame = Math.round(clipboard.origin * FPS);
      const delta = Math.round(pasteTime * FPS) - originFrame;
      const half = pxPerFrame / 2;
      const maxRow = rows.length - 1;
      const regionBand = (f0, f1, r0, r1, full, fill, barFill) => {
        const rTop = full ? RULER : RULER + Math.max(0, r0) * ROW;
        const rBot = full ? height : RULER + (Math.min(maxRow, r1) + 1) * ROW;
        const x0 = timeToX(f0 / FPS) - half;
        const x1 = timeToX(f1 / FPS) + half;
        ctx.fillStyle = fill;
        ctx.fillRect(x0, rTop, Math.max(2, x1 - x0), rBot - rTop);
        ctx.fillStyle = barFill;
        ctx.fillRect(x0, RULER - 4, Math.max(2, x1 - x0), 4);
      };
      for (const reg of clipboard.regions) {
        regionBand(reg.f0, reg.f1, reg.r0, reg.r1, reg.full, 'rgba(60,220,110,0.10)', 'rgba(60,220,110,0.9)');
        regionBand(reg.f0 + delta, reg.f1 + delta, reg.r0, reg.r1, reg.full, `rgba(180,120,255,${0.08 + 0.08 * pulse})`, `rgba(180,120,255,${0.6 + 0.3 * pulse})`);
      }
      const alpha = 0.3 + 0.5 * pulse;
      const preview = previewKeys(clipboard, pasteTime);
      // Purple ghosts of the pasted keys (red when they would land past the end).
      for (const g of preview) {
        const r = rowOf.get(copiedId(app, anim, g.track));
        if (r === undefined) continue;
        const cy = RULER + r * ROW + ROW / 2;
        for (const t of g.times) {
          const over = t > duration + 1e-6;
          ghostDiamond(ctx, [timeToX(t), cy], 5.5, over ? `rgba(255,90,120,${alpha})` : `rgba(180,120,255,${alpha})`);
        }
      }
      // Overwrite preview, over the copied AREA (the green band's frame span, blank columns included —
      // not just the keys' extent). On each affected row, a cell a pasted key lands on keeps its ghost,
      // an existing key a blank would erase gets a red ✕, and a doubly-blank cell gets a hollow purple
      // diamond. Merge erases nothing, so it shows neither. 'overwrite' marks the copied tracks; 'full'
      // marks every row of the area (the empty intermediate tracks too).
      if (pasteMode !== 'none') {
        const ghostBy = new Map(preview.map((g) => [copiedId(app, anim, g.track), new Set(g.times.map((t) => Math.round(snap(t) * FPS)))]));
        let markRows;
        if (pasteMode === 'full') markRows = areaRows(app, anim, rows);
        else markRows = copiedRows;
        const cf0 = Math.max(0, Math.round((pasteTime + (clipboard.cover?.start ?? 0)) * FPS));
        const cf1 = Math.min(frames, Math.round((pasteTime + (clipboard.cover?.end ?? clipboard.span)) * FPS));
        for (const r of markRows) {
          const track = rows[r]?.track;
          if (!track) continue;
          const ghosts = ghostBy.get(trackId(track)) ?? new Set();
          const existing = occCurrent(track);
          const cy = RULER + r * ROW + ROW / 2;
          for (let f = cf0; f <= cf1; f++) {
            if (ghosts.has(f)) continue; // a pasted key will sit here (its ghost already shows)
            const x = timeToX(f / FPS);
            if (existing.has(f)) redCross(ctx, [x, cy], 4);
            else hollowAt(x, cy, 'rgba(180,120,255,0.38)');
          }
        }
      }
    }

    // Time cursor.
    const cx = timeToX(Math.min(app.time, duration));
    ctx.strokeStyle = 'rgb(255,90,70)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, height);
    ctx.stroke();
    ctx.restore();
  }

  /** `view` kept inside the animation and at least 4 frames wide; null when it shows all of it. */
  clampView(view, duration) {
    if (!view) return null;
    const span = Math.max(4 / FPS, view.t1 - view.t0);
    if (span >= duration - 1e-9) return null;
    const t0 = Math.min(Math.max(0, view.t0), duration - span);
    return { t0, t1: t0 + span };
  }

  /** Ctrl+wheel zooms time around the cursor, Alt+wheel pans it (as in the graph editor). */
  onWheel(e) {
    if (!this.layout || !(e.ctrlKey || e.metaKey || e.altKey)) return; // plain wheel scrolls the rows
    e.preventDefault();
    const { t0, span, duration, trackLeft, trackW } = this.layout;
    let a = t0;
    let b = t0 + span;
    if (e.ctrlKey || e.metaKey) {
      const at = t0 + ((this.pos(e)[0] - trackLeft) / trackW) * span;
      const f = Math.exp(Math.sign(e.deltaY) * 0.15);
      a = at + (a - at) * f;
      b = at + (b - at) * f;
    } else {
      const shift = (Math.sign(e.deltaY || e.deltaX) * span) / 10;
      a += shift;
      b += shift;
    }
    this.view = this.clampView({ t0: a, t1: b }, duration);
    this.app.changed();
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  hit(p) {
    return this.keyRects.find((k) => p[0] >= k.x0 && p[0] <= k.x1 && p[1] >= k.y0 && p[1] <= k.y1) ?? null;
  }

  xToTime(x) {
    const { trackLeft, trackW, duration, t0, span } = this.layout;
    return Math.min(duration, Math.max(0, t0 + ((x - trackLeft) / trackW) * span));
  }

  /** The frame number under x, clamped to the animation. */
  xToFrame(x) {
    const frames = Math.round(this.layout.duration * FPS);
    return Math.max(0, Math.min(frames, Math.round(this.xToTime(x) * FPS)));
  }

  /** The band (frames × rows) a drag box covers, by midpoint inclusion: a column or row joins the
   *  band only once the box reaches past its centre. So the yellow band matches the keys the box
   *  actually selects, yet can still span the blank columns between them (overwrite-all needs those).
   *  Returns null when the box is too thin to cover any cell centre. */
  boxRegion(x0, y0, x1, y1) {
    const frames = Math.round(this.layout.duration * FPS);
    const f0 = Math.max(0, Math.ceil(this.xToTime(x0) * FPS - 1e-6));
    const f1 = Math.min(frames, Math.floor(this.xToTime(x1) * FPS + 1e-6));
    const r0 = Math.ceil((y0 - RULER - ROW / 2) / ROW - 1e-6);
    const r1 = Math.floor((y1 - RULER - ROW / 2) / ROW + 1e-6);
    if (f1 < f0 || r1 < r0) return null;
    return { f0, f1, r0: Math.max(0, r0), r1: Math.max(0, r1), full: false };
  }

  /** Selects every key sitting on frames [from, to] (across all tracks). `add` keeps the current selection. */
  selectFrames(from, to, add = false) {
    const app = this.app;
    const anim = app.currentAnimation();
    if (!anim) return;
    const next = new Set(add ? app.selectedKeys : []);
    for (const { track } of tracks(app, anim)) {
      for (const k of trackKeys(anim, track) ?? []) {
        const f = Math.round(k.time * FPS);
        if (f >= from && f <= to) next.add(k);
      }
    }
    app.selectedKeys = next;
    const span = from === to ? t('frame {frame}', { frame: from }) : t('frames {from}–{to}', { from, to });
    app.setStatus(t('Selected {span}: {count} key(s)', { span, count: next.size }));
  }

  /** Time range covered by the selected keys, or null. */
  selectionSpan() {
    if (this.app.selectedKeys.size < 2) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const k of this.app.selectedKeys) {
      min = Math.min(min, k.time);
      max = Math.max(max, k.time);
    }
    return { min, max };
  }

  onPointerDown(e) {
    if (!this.layout) return;
    const app = this.app;
    const p = this.pos(e);
    const add = e.ctrlKey || e.metaKey;
    // Actor clip lanes (scenes): move or trim a clip, or right-click for its menu.
    if (p[1] > RULER && p[1] < (this.top ?? RULER) && (e.button === 0 || e.button === 2)) {
      const lane = pressLane(app, this.laneRects ?? [], p, e, (x) => this.xToTime(x), RULER, ROW);
      if (lane === 'handled') return;
      if (lane) {
        this.canvas.setPointerCapture(e.pointerId);
        this.press = { lane, pos: p, started: false };
        app.changed();
        return;
      }
      if (e.button === 2) return;
    }
    if (e.button === 2) {
      // Right button: a plain click opens the curve menu; a drag retimes the selection (handled in
      // onPointerMove/Up). Captured so the drag keeps coming even past the canvas edge.
      this.canvas.setPointerCapture(e.pointerId);
      this.press = { right: true, pos: p, started: false, clientX: e.clientX, clientY: e.clientY };
      return;
    }
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    // Frame-column selection: the Frames mode, or a one-off Alt+drag in key mode (a quick way to
    // grab a range of columns across every track so the retiming handles can then spread them).
    // Either way the whole drag picks columns, so key boxes and retiming are off for this gesture.
    if (frameSelect || e.altKey) {
      // Columns add when Multi/Ctrl is held, or when Alt continues an already-started selection
      // (so chained Alt+drags accumulate, but the first one after a copy/paste/cancel starts fresh).
      const addColumns = add || multiAdd || (e.altKey && selectionRegions.length > 0);
      this.press = { frameMode: true, pos: p, started: false, add: addColumns, startFrame: this.xToFrame(p[0]) };
      return;
    }
    const hit = this.hit(p);
    const handle = this.handles && p[1] <= RULER && [this.handles.x0, this.handles.x1].findIndex((x) => Math.abs(p[0] - x) <= 5);
    this.press = { pos: p, started: false, add: add || multiAdd, hit, handle: handle >= 0 ? handle : null, inRuler: p[1] <= RULER };
  }

  /** Lights up the bone of the row under the cursor, synced with the viewport and tree. */
  hoverAt(p) {
    const app = this.app;
    const top = this.top ?? RULER;
    if (!this.rows || p[1] < top) {
      app.setHover(null);
      return;
    }
    const track = this.rows[Math.floor((p[1] - top) / ROW)]?.track;
    app.setHover(track && track.bone !== undefined ? track.bone : null);
  }

  onPointerMove(e) {
    const app = this.app;
    const p = this.pos(e);
    if (this.press?.lane && e.buttons & 1) {
      this.press.started = true;
      this.press.lane.move(p[0]);
      return;
    }
    const press = this.press;
    if (!press || !(e.buttons & (press.right ? 2 : 1))) {
      this.hoverAt(p);
      return;
    }
    if (press.right) {
      // A right-drag retimes the current selection by scaling from its nearer edge. With nothing to
      // scale yet, it instead sweeps a column range (shown as an orange band), and on release selects
      // those columns and arms the handles — so a right-drag always "opens an area to retime".
      if (!press.started) {
        if (Math.hypot(p[0] - press.pos[0], p[1] - press.pos[1]) <= 3) return;
        press.started = true;
        app.playing = false;
        app.mode = Mode.Animate;
        const r = this.beginRetime(press.pos[0]);
        if (r) Object.assign(press, r);
        else {
          press.selectColumns = true;
          press.startFrame = this.xToFrame(press.pos[0]);
        }
      }
      if (press.retime) {
        this.applyRetime(press, snap(this.xToTime(p[0])));
        app.changed();
      } else if (press.selectColumns) {
        const f = this.xToFrame(p[0]);
        press.frameBox = { from: press.startFrame, to: f };
        app.time = f / FPS;
        app.changed();
      }
      return;
    }
    if (press.frameMode) {
      if (!press.started) {
        if (Math.abs(p[0] - press.pos[0]) <= 3 && Math.abs(p[1] - press.pos[1]) <= 3) return;
        press.started = true;
        app.playing = false;
      }
      const f = this.xToFrame(p[0]);
      press.frameBox = { from: press.startFrame, to: f };
      app.time = f / FPS; // scrub to the dragging edge for feedback
      app.changed();
      return;
    }
    if (!press.started) {
      if (Math.hypot(p[0] - press.pos[0], p[1] - press.pos[1]) <= 3) return;
      press.started = true;
      app.playing = false;
      app.mode = Mode.Animate;
      if (press.handle !== null && press.handle !== undefined) {
        press.retime = this.beginEdit();
        press.span = { ...this.handles };
      } else if (press.hit) {
        if (!app.selectedKeys.has(press.hit.key)) app.selectedKeys = press.add ? new Set([...app.selectedKeys, press.hit.key]) : new Set([press.hit.key]);
        press.move = this.beginEdit();
        press.grabTime = press.hit.time;
      } else if (!press.inRuler) {
        press.box = { from: press.pos, to: p };
      }
    }
    const t = snap(this.xToTime(p[0]));
    if (press.move) {
      const dt = t - press.grabTime;
      for (const m of press.move) m.key.time = Math.max(0, snap(m.time + dt));
      app.time = Math.max(0, snap(press.grabTime + dt));
    } else if (press.retime) {
      this.applyRetime(press, t);
    } else if (press.box) {
      press.box.to = p;
    } else {
      app.time = t; // scrubbing the ruler or empty space
    }
    app.changed();
  }

  /** Remembers the selected keys' times before a move or retime. */
  beginEdit() {
    return [...this.app.selectedKeys].map((key) => ({ key, time: key.time }));
  }

  /** Sets up a retime grabbing the selection edge nearer to pixel x, or null if there's no span. */
  beginRetime(px) {
    const span = this.selectionSpan();
    if (!span || span.max - span.min <= 1e-6) return null;
    const { trackLeft, trackW, t0, span: viewSpan } = this.layout;
    const timeToX = (time) => trackLeft + ((time - t0) / viewSpan) * trackW;
    const handle = Math.abs(px - timeToX(span.min)) <= Math.abs(px - timeToX(span.max)) ? 0 : 1;
    return { retime: this.beginEdit(), span, handle };
  }

  /** Scales the retimed keys so the grabbed edge follows time t (the opposite edge stays fixed). */
  applyRetime(press, t) {
    const { min, max } = press.span;
    const fixed = press.handle === 0 ? max : min;
    const moving = press.handle === 0 ? min : max;
    const factor = Math.abs(moving - fixed) > 1e-6 ? (t - fixed) / (moving - fixed) : 1;
    for (const m of press.retime) m.key.time = Math.max(0, snap(fixed + (m.time - fixed) * factor));
    this.app.time = t;
  }

  onPointerUp(e) {
    if (!this.press) return;
    const app = this.app;
    const press = this.press;
    if (press.right) {
      this.press = null;
      if (!press.started) {
        // A plain right-click: select the key under it if needed, then open the curve menu.
        const hit = this.hit(press.pos);
        if (hit && !app.selectedKeys.has(hit.key)) app.selectedKeys = new Set([hit.key]);
        // On empty space too when keys are copied: Paste here.
        if (app.selectedKeys.size || hasClipboard()) curveMenu(app, press.clientX, press.clientY, { pasteAt: snap(this.xToTime(press.pos[0])) });
      } else if (press.retime) {
        resortAnimation(app.currentAnimation());
        clearRegions();
        app.setStatus(t('Retimed {count} key(s)', { count: app.selectedKeys.size }));
      } else if (press.selectColumns) {
        // Right-drag over nothing to retime: select the swept columns and arm the handles so the very
        // next drag of an end scales them.
        const endF = press.frameBox ? press.frameBox.to : press.startFrame;
        const from = Math.min(press.startFrame, endF);
        const to = Math.max(press.startFrame, endF);
        app.time = endF / FPS;
        endCopyArming();
        selectionIsColumns = true;
        this.selectFrames(from, to, false);
        setRegion({ f0: from, f1: to, r0: 0, r1: 0, full: true }, false);
        retimeArmed = true;
        app.setStatus(t('Retime: drag an end of the marked range to scale it.'));
      }
      app.changed();
      return;
    }
    if (e.button !== 0) return;
    this.press = null;
    if (press.lane) {
      if (press.started) press.lane.end();
      app.changed();
      return;
    }
    if (press.frameMode) {
      app.playing = false;
      app.mode = Mode.Animate;
      // A drag selects the columns it swept; a plain click picks one column.
      const endF = press.started ? press.frameBox.to : press.startFrame;
      const from = Math.min(press.startFrame, endF);
      const to = Math.max(press.startFrame, endF);
      app.time = endF / FPS;
      endCopyArming();
      selectionIsColumns = true;
      this.selectFrames(from, to, press.add);
      setRegion({ f0: from, f1: to, r0: 0, r1: 0, full: true }, press.add);
      app.changed();
      return;
    }
    if (!press.started) {
      if (press.hit) {
        endCopyArming();
        selectionIsColumns = false;
        const k = press.hit.key;
        const reg = { f0: Math.round(press.hit.time * FPS), f1: Math.round(press.hit.time * FPS), r0: rowAt(press.pos[1]), r1: rowAt(press.pos[1]), full: false };
        if (press.add) {
          const next = new Set(app.selectedKeys);
          if (next.has(k)) next.delete(k);
          else next.add(k);
          app.selectedKeys = next;
          setRegion(reg, true);
        } else {
          app.selectedKeys = new Set([k]);
          app.time = press.hit.time;
          setRegion(reg, false);
        }
      } else {
        if (!press.add) {
          app.selectedKeys = new Set();
          clearRegions();
        }
        app.time = snap(this.xToTime(press.pos[0]));
      }
      app.playing = false;
      app.mode = Mode.Animate;
    } else if (press.move || press.retime) {
      resortAnimation(app.currentAnimation());
      clearRegions(); // the keys moved; a copy would re-derive its band from the new positions
      if (press.retime) retimeArmed = false; // one-shot: the armed handles switch off after a retime
      const n = app.selectedKeys.size;
      app.setStatus(press.move ? t('Moved {count} key(s)', { count: n }) : t('Retimed {count} key(s)', { count: n }));
    } else if (press.box) {
      const { from, to } = press.box;
      const [x0, x1] = [Math.min(from[0], to[0]), Math.max(from[0], to[0])];
      const [y0, y1] = [Math.min(from[1], to[1]), Math.max(from[1], to[1])];
      const inside = this.keyRects.filter((r) => (r.x0 + r.x1) / 2 >= x0 && (r.x0 + r.x1) / 2 <= x1 && (r.y0 + r.y1) / 2 >= y0 && (r.y0 + r.y1) / 2 <= y1);
      const next = new Set(press.add ? app.selectedKeys : []);
      for (const r of inside) next.add(r.key);
      endCopyArming();
      selectionIsColumns = false;
      app.selectedKeys = next;
      // The band follows the box by midpoint inclusion, so it hugs the selected keys (and the blank
      // columns the box truly swept) instead of the raw drag corners.
      const reg = this.boxRegion(x0, y0, x1, y1);
      if (inside.length && reg) setRegion(reg, press.add);
      else if (!press.add) clearRegions();
      app.setStatus(t('{count} key(s) selected', { count: next.size }));
    }
    app.changed();
  }
}

/** Removes constraint channels whose keys were all deleted. */
function pruneConstraintKeys(anim) {
  for (const type of ['transform', 'path', 'physics', 'slider']) {
    const byName = anim.extra?.[type];
    if (!byName) continue;
    for (const [name, v] of Object.entries(byName)) {
      if (Array.isArray(v)) {
        if (!v.length) delete byName[name];
        continue;
      }
      for (const [ch, keys] of Object.entries(v)) if (Array.isArray(keys) && !keys.length) delete v[ch];
      if (!Object.keys(v).length) delete byName[name];
    }
    if (!Object.keys(byName).length) delete anim.extra[type];
  }
}

/** Keeps every key list sorted by time after keys moved. */
export function resortAnimation(anim) {
  if (!anim) return;
  const sort = (keys) => keys.sort((a, b) => a.time - b.time);
  for (const tl of [...anim.bones, ...anim.slots]) for (const v of Object.values(tl)) if (Array.isArray(v)) sort(v);
  for (const tl of [...anim.deform, ...anim.ik]) sort(tl.keys);
  sort(anim.drawOrder);
  sort(anim.events);
  for (const tl of anim.extra ? keyedChannels(anim, listConstraintsOf(anim)) : []) sort(tl.keys);
  for (const keys of sequenceLists(anim)) sort(keys);
  const last = anim.lastKeyTime();
  if (last > anim.duration) anim.duration = last;
}

/** Every sequence key list of an animation. */
function sequenceLists(anim) {
  const out = [];
  for (const slots of Object.values(anim.extra?.attachments ?? {})) {
    for (const atts of Object.values(slots)) for (const t of Object.values(atts)) if (Array.isArray(t.sequence)) out.push(t.sequence);
  }
  return out;
}

/** Constraint names keyed in an animation (for sorting without the document). */
function listConstraintsOf(anim) {
  const out = [];
  for (const type of ['transform', 'path', 'physics', 'slider']) for (const name of Object.keys(anim.extra?.[type] ?? {})) out.push({ type, name });
  return out;
}

/** Curve presets and delete for the selected keys. */
export function curveMenu(app, x, y, { pasteAt = null } = {}) {
  const setCurve = (curve) => () => {
    const anim = app.currentAnimation();
    if (!anim) return;
    // Constraint keys store absolute curves per value.
    const raw = new Set();
    for (const t of keyedChannels(anim, listConstraints(app.doc))) {
      t.keys.forEach((k, i) => {
        if (!app.selectedKeys.has(k)) return;
        raw.add(k);
        setConstraintCurve(t.keys, i, t.fields, t.defaults, curve);
      });
    }
    // Attachment, draw order and event keys have no curve.
    const skip = new Set([...raw, ...anim.events, ...anim.drawOrder, ...anim.slots.flatMap((s) => s.attachment ?? []), ...sequenceLists(anim).flat()]);
    for (const k of app.selectedKeys) if (!skip.has(k)) k.curve = cloneCurve(curve);
    app.changed();
  };
  const sc = (action) => shortcutLabel(app.keymap, action) || undefined;
  const selected = app.selectedKeys.size > 0;
  // Copy and paste, as on the buttons (Paste here: at the frame right-clicked in the dopesheet).
  const clipboard = [
    selected && { label: t('Cut'), shortcut: sc('edit.cutKeys'), action: () => cutSelectedKeys(app) },
    selected && { label: t('Copy'), shortcut: sc('edit.copyKeys'), action: () => copySelectedKeys(app) },
    hasClipboard() && {
      label: pasteAt !== null ? t('Paste here') : t('Paste'),
      shortcut: sc('edit.pasteKeys'),
      action: () => {
        if (pasteAt !== null) {
          app.time = pasteAt;
          app.changed();
        }
        pasteKeys(app);
      },
    },
  ].filter(Boolean);
  if (!selected) return popupMenu(x, y, clipboard);
  popupMenu(x, y, [
    ...clipboard,
    clipboard.length && 'separator',
    { label: t('Linear'), action: setCurve(LINEAR) },
    { label: t('Ease in-out'), action: setCurve(EASE_IN_OUT) },
    { label: t('Ease in'), action: setCurve(EASE_IN) },
    { label: t('Ease out'), action: setCurve(EASE_OUT) },
    { label: t('Stepped'), action: setCurve(STEPPED) },
    'separator',
    { label: app.selectedKeys.size > 1 ? t('Delete {count} keys', { count: app.selectedKeys.size }) : t('Delete key'), action: () => deleteSelectedKeys(app) },
  ].filter(Boolean));
}

function diamond(ctx, c, r, fill) {
  ctx.beginPath();
  ctx.moveTo(c[0], c[1] - r);
  ctx.lineTo(c[0] + r, c[1]);
  ctx.lineTo(c[0], c[1] + r);
  ctx.lineTo(c[0] - r, c[1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** A translucent diamond with a soft outline of the same colour, for the ghostly paste preview. */
function ghostDiamond(ctx, c, r, fill) {
  ctx.beginPath();
  ctx.moveTo(c[0], c[1] - r);
  ctx.lineTo(c[0] + r, c[1]);
  ctx.lineTo(c[0], c[1] + r);
  ctx.lineTo(c[0] - r, c[1]);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = fill;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** An outline-only diamond marking an empty cell inside a selection or the paste preview, so the
 *  blanks (the frames overwrite-all would use) are visible without crowding the view. */
function hollowDiamond(ctx, c, r, stroke) {
  ctx.beginPath();
  ctx.moveTo(c[0], c[1] - r);
  ctx.lineTo(c[0] + r, c[1]);
  ctx.lineTo(c[0], c[1] + r);
  ctx.lineTo(c[0] - r, c[1]);
  ctx.closePath();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** A small, discreet red cross marking an existing key an overwrite paste would erase. */
function redCross(ctx, c, r) {
  ctx.strokeStyle = 'rgba(255,70,70,0.85)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(c[0] - r, c[1] - r);
  ctx.lineTo(c[0] + r, c[1] + r);
  ctx.moveTo(c[0] + r, c[1] - r);
  ctx.lineTo(c[0] - r, c[1] + r);
  ctx.stroke();
}

/** A stable string id for a dopesheet track descriptor, to match preview keys to their row. */
function trackId(track) {
  return JSON.stringify(track);
}

