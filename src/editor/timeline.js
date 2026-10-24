// SPDX-License-Identifier: MIT OR Apache-2.0
// Bottom panel: animation list, transport controls and the dopesheet (the graph editor is graph.js).

import { has, timecode } from './workspaces.js';
import { Animation, BONE_CHANNELS, SLOT_CHANNELS } from '../core/animation.js';
import { listConstraints } from '../core/constraintdata.js';
import { channelKeys, keyedChannels, setConstraintCurve } from '../core/constraintkeys.js';
import { EASE_IN, EASE_IN_OUT, EASE_OUT, LINEAR, STEPPED, cloneCurve, isBezier } from '../core/curve.js';
import { uniqueName } from '../core/model.js';
import { FPS, Mode, selBone, selSlot, snap } from './app.js';
import * as edit from './edit.js';
import { clearSpan, makeClipboard, pasteClipboard, planPaste, previewKeys } from './keyclip.js';
import { dragValue, h, popupMenu, select, textField } from './widgets.js';

const GUTTER = 170;
const ROW = 20;
const RULER = 22;

/** Transport and animation controls (rebuilt when the app changes). */
export function renderControls(app, el) {
  const anim = app.currentAnimation();
  const names = app.doc.animations.map((a, i) => [i, a.name]);
  const play = h('button', { 'data-tut': 'timeline:play', disabled: app.anim === null, title: 'Play / pause (Space)', onclick: () => app.togglePlay() }, app.playing ? '⏸' : '▶');
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
        : h('span', { class: 'weak' }, '(no animation)'),
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
        '＋ New',
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
            h('span', null, 'Length'),
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
                title: 'Delete animation',
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
          title: 'Go to start',
          onclick: () => {
            app.time = 0;
            app.playing = false;
            app.changed();
          },
        },
        '⏮',
      ),
      h('button', { title: 'Previous frame (←)', onclick: () => app.stepFrame(-1) }, '◀'),
      play,
      h('button', { 'data-tut': 'timeline:next', title: 'Next frame (→)', onclick: () => app.stepFrame(1) }, '▶|'),
      h(
        'label',
        null,
        h('input', {
          type: 'checkbox',
          checked: app.looping,
          onchange: (e) => {
            app.looping = e.target.checked;
            app.changed();
          },
        }),
        ' Loop',
      ),
      h(
        'span',
        { class: 'mono', title: has(app, 'timecode') ? 'Timecode (hours:minutes:seconds:frames) and frame' : 'Frame and seconds' },
        has(app, 'timecode') ? `${timecode(app.time, FPS)}  frame ${Math.round(app.time * FPS)}` : `frame ${String(Math.round(app.time * FPS)).padStart(3, ' ')}  ${app.time.toFixed(2)}s`,
      ),
      h('span', { class: 'vsep' }),
      h('button', { 'data-tut': 'timeline:key', disabled: app.mode !== Mode.Animate, onclick: () => edit.keySelection(app) }, '◆ Key (K)'),
      h('span', { class: 'vsep' }),
      h('button', { title: 'Copy selected keys (Ctrl+C)', disabled: !app.selectedKeys.size, onclick: () => copySelectedKeys(app) }, '⧉ Copy'),
      h('button', { title: 'Paste keys at the playhead (Ctrl+V)', disabled: !hasClipboard(), onclick: () => pasteKeys(app) }, '⎘ Paste'),
      h(
        'button',
        {
          class: frameSelectActive() ? 'active' : '',
          title: 'Select whole frame columns: drag to select a range, Shift+click to extend. Click again for key select.',
          onclick: () => toggleFrameSelect(app),
        },
        '▦ Frames',
      ),
      h(
        'button',
        {
          class: multiAddActive() ? 'active' : '',
          title: 'Multi-select: each drag adds another area (keys or columns) without holding Ctrl/Alt. Copy or Escape ends it.',
          onclick: () => toggleMultiAdd(app),
        },
        '＋ Multi',
      ),
      h(
        'button',
        {
          class: pasteModeActive() ? 'active' : '',
          title: 'How paste treats existing keys. Click to cycle: Merge → Overwrite (copied tracks) → Overwrite all (whole area). Erased keys show a red ✕ in the preview.',
          onclick: () => cyclePasteMode(app),
        },
        pasteModeLabel(),
      ),
      h(
        'button',
        {
          class: retimeArmedActive() ? 'active' : '',
          title: 'Retime (scale the selected keys’ timing): show the drag handles for one use. Or right-click + drag anytime.',
          onclick: () => toggleRetime(app),
        },
        '⇔ Retime',
      ),
      h('span', { class: 'vsep' }),
      h(
        'span',
        { class: 'segmented', title: 'Timeline view' },
        [
          ['dopesheet', 'Dopesheet'],
          ['graph', 'Graph'],
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
    ]
      .flat()
      .filter(Boolean),
  );
}

/** Rows of the dopesheet for the current animation: [{ track, label }]. */
function tracks(app, anim) {
  const out = [];
  const label = (ch) => ch.replace(/([A-Z])/g, ' $1').toLowerCase();
  for (const tl of anim.bones) {
    const name = app.doc.bones[tl.bone]?.name ?? `#${tl.bone}`;
    for (const channel of BONE_CHANNELS) {
      if (tl[channel].length) out.push({ track: { bone: tl.bone, channel }, label: `${name} · ${label(channel)}` });
    }
  }
  for (const tl of anim.slots) {
    const name = app.doc.slots[tl.slot]?.name ?? `#${tl.slot}`;
    for (const channel of SLOT_CHANNELS) {
      if (tl[channel].length) out.push({ track: { slot: tl.slot, channel }, label: `${name} · ${channel === 'attachment' ? 'image' : channel}` });
    }
  }
  anim.deform.forEach((d, i) => {
    out.push({ track: { deform: i, slot: d.slot }, label: `${app.doc.slots[d.slot]?.name ?? '?'} · deform ${d.attachment}` });
  });
  anim.ik.forEach((k, i) => out.push({ track: { ik: i }, label: `IK ${app.doc.ik[k.constraint]?.name ?? '?'}` }));
  for (const [skin, slots] of Object.entries(anim.extra?.attachments ?? {})) {
    for (const [slot, atts] of Object.entries(slots)) {
      for (const [attachment, timelines] of Object.entries(atts)) {
        if (Array.isArray(timelines.sequence) && timelines.sequence.length) {
          out.push({ track: { sequence: { skin, slot, attachment } }, label: `${slot} · sequence${skin === 'default' ? '' : ` [${skin}]`}` });
        }
      }
    }
  }
  for (const t of keyedChannels(anim, listConstraints(app.doc))) {
    out.push({ track: { raw: { type: t.type, name: t.name, channel: t.channel } }, label: `${t.name} · ${t.channel ?? 'mix'}` });
  }
  if (anim.drawOrder.length) out.push({ track: { drawOrder: true }, label: 'draw order' });
  if (anim.events.length) out.push({ track: { events: true }, label: 'events' });
  return out;
}

function trackKeys(anim, track) {
  if (track.raw) return channelKeys(anim, track.raw.type, track.raw.name, track.raw.channel);
  if (track.sequence) {
    const keys = anim.extra?.attachments?.[track.sequence.skin]?.[track.sequence.slot]?.[track.sequence.attachment]?.sequence;
    for (const k of keys ?? []) k.time ??= 0;
    return keys;
  }
  if (track.deform !== undefined) return anim.deform[track.deform]?.keys;
  if (track.ik !== undefined) return anim.ik[track.ik]?.keys;
  if (track.drawOrder) return anim.drawOrder;
  if (track.events) return anim.events;
  if (track.slot !== undefined) return anim.slotTimeline(track.slot)?.[track.channel ?? 'attachment'];
  return anim.boneTimeline(track.bone)?.[track.channel];
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
  app.setStatus(`Deleted ${count} key${count === 1 ? '' : 's'}`);
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
const PASTE_LABELS = { none: '⊟ Merge', overwrite: '⊟ Overwrite', full: '⊟ Overwrite all' };
let selectionIsColumns = false; // the current selection came from the ruler (whole columns), not a box
let retimeArmed = false; // true shows the retiming handles for one use (otherwise hidden)
// The areas the current selection was built from, each { f0, f1, r0, r1, full } in frames/rows, so the
// copy preview can draw one coloured band per section instead of one band across the gaps.
let selectionRegions = [];

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
export function copySelectedKeys(app) {
  const anim = app.currentAnimation();
  if (!anim || !app.selectedKeys.size) {
    app.setStatus('Select keys to copy');
    return;
  }
  const groups = [];
  const source = new Set();
  for (const { track } of tracks(app, anim)) {
    const picked = (trackKeys(anim, track) ?? []).filter((k) => app.selectedKeys.has(k));
    if (picked.length) groups.push({ track, keys: picked });
    for (const k of picked) source.add(k);
  }
  clipboard = makeClipboard(groups);
  if (clipboard) {
    clipboard.fullHeight = selectionIsColumns; // ruler selections span every row; a box is bounded
    clipboard.rowRange = rowSpanOf(app, anim, groups); // rows the paste area covers, for 'full' overwrite
    // One coloured band per copied section (fall back to a single band over the whole copy).
    clipboard.regions = selectionRegions.length
      ? selectionRegions.map((r) => ({ ...r }))
      : [{ f0: Math.round(clipboard.origin * FPS), f1: Math.round((clipboard.origin + clipboard.span) * FPS), r0: clipboard.rowRange.min, r1: clipboard.rowRange.max, full: selectionIsColumns }];
  }
  copiedSource = clipboard ? source : null;
  // Copying ends the selection gestures (Frames and Multi): the mouse is now free to pick a paste
  // spot without the next click being read as a new selection that would cancel the copy.
  frameSelect = false;
  multiAdd = false;
  clearRegions(); // the copy snapshotted them; the next selection gesture starts fresh
  const n = clipboard?.count ?? 0;
  app.setStatus(`Copied ${n} key${n === 1 ? '' : 's'} — move the playhead and paste (Ctrl+V), Escape to cancel`);
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
  app.setStatus(retimeArmed ? 'Retime: drag an end of the selected range to scale its timing (one use). Right-drag works anytime.' : 'Retime off.');
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
  app.setStatus(frameSelect ? 'Frame columns: drag (or Alt+drag) to select; Alt or Multi add more.' : 'Key select: drag a box over the keys.');
}

/** Whether multi-region add is on (drives the Multi button). */
export function multiAddActive() {
  return multiAdd;
}

/** Toggles multi-region select: every box or column adds to the selection, no Ctrl/Alt needed. */
export function toggleMultiAdd(app) {
  multiAdd = !multiAdd;
  if (multiAdd) endCopyArming();
  app.setStatus(multiAdd ? 'Multi-select: each drag adds another area. Copy or Escape to finish.' : 'Single select.');
}

/** The paste mode's button label (changes as it cycles). */
export function pasteModeLabel() {
  return PASTE_LABELS[pasteMode];
}

/** Whether paste is in an overwriting mode (drives the button's active state). */
export function pasteModeActive() {
  return pasteMode !== 'none';
}

/** Cycles paste between Merge, Overwrite (copied tracks) and Overwrite all (whole area). */
export function cyclePasteMode(app) {
  pasteMode = PASTE_MODES[(PASTE_MODES.indexOf(pasteMode) + 1) % PASTE_MODES.length];
  const msg = {
    none: 'Paste merges: existing keys between the pasted ones are kept.',
    overwrite: 'Paste overwrites: clears existing keys in the pasted area, in the copied tracks.',
    full: 'Paste overwrites all: clears the whole pasted area, even tracks with no copied key.',
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
  const anim = app.currentAnimation();
  if (!anim) {
    app.setStatus('Select an animation to paste into');
    return;
  }
  if (!clipboard) {
    app.setStatus('Clipboard is empty — copy keys first (Ctrl+C)');
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
    cancel: () => app.setStatus('Paste cancelled'),
  });
}

function applyPaste(app, anim, pasteTime, opts) {
  app.playing = false;
  app.mode = Mode.Animate;
  // 'full' clears the whole pasted area first, including tracks the copy did not touch.
  if (pasteMode === 'full') {
    const end = opts.mode === 'clip' ? Math.min(pasteTime + clipboard.span, opts.limit) : pasteTime + clipboard.span;
    const rows = tracks(app, anim);
    const copied = new Set(clipboard.groups.map((g) => trackId(g.track)));
    const lo = clipboard.fullHeight ? 0 : clipboard.rowRange.min;
    const hi = clipboard.fullHeight ? rows.length - 1 : clipboard.rowRange.max;
    for (let r = lo; r <= hi; r++) {
      const track = rows[r]?.track;
      if (!track || copied.has(trackId(track))) continue; // copied tracks are cleared by pasteClipboard
      const keys = resolveTrackKeys(anim, track);
      if (keys) clearSpan(keys, pasteTime, end);
    }
  }
  const pasted = pasteClipboard(clipboard, pasteTime, { ...opts, snap, replace: pasteMode !== 'none' }, (track) => resolveTrackKeys(anim, track));
  resortAnimation(anim);
  endCopyArming(); // paste disarms the copy: the green source and the preview go away
  clearRegions(); // and the next selection gesture starts fresh, not adding to the pasted area
  app.selectedKeys = new Set(pasted); // select what was pasted, ready to nudge
  const n = pasted.length;
  app.setStatus(n ? `Pasted ${n} key${n === 1 ? '' : 's'} at frame ${Math.round(pasteTime * FPS)}` : 'Nothing pasted (no keys fit)');
  app.changed();
}

/** Asks how to handle a paste that overflows the animation: extend, paste what fits, or cancel. */
function overflowDialog(extraFrames, actions) {
  const plural = extraFrames === 1 ? '' : 's';
  const overlay = h('div', { class: 'modal-backdrop' });
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
      actions.cancel();
    }
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  const choose = (fn) => () => {
    close();
    fn();
  };
  overlay.append(
    h(
      'div',
      { class: 'modal' },
      h('h3', null, 'Paste runs past the end'),
      h('p', null, `The pasted keys extend ${extraFrames} frame${plural} beyond the animation's length.`),
      h(
        'div',
        { class: 'modal-buttons' },
        h('button', { onclick: choose(actions.cancel) }, 'Cancel'),
        h('button', { onclick: choose(actions.clip) }, 'Paste what fits'),
        h('button', { class: 'primary', onclick: choose(actions.expand) }, `Extend by ${extraFrames} frame${plural}`),
      ),
    ),
  );
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
}

function keyFill(selected, curve) {
  if (selected) return 'rgb(255,190,60)';
  if (curve === STEPPED) return 'rgb(200,120,255)';
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
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerup', (e) => this.onPointerUp(e));
    canvas.addEventListener('pointercancel', () => (this.press = null));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  draw() {
    const app = this.app;
    const anim = app.currentAnimation();
    const empty = this.scroller.parentElement.querySelector('.empty');
    empty.hidden = !!anim;
    this.scroller.hidden = !anim;
    if (!anim) return;

    // The selection's coloured areas live only as long as there are selected keys.
    if (!app.selectedKeys.size) selectionRegions = [];
    const wantCursor = frameSelect ? 'crosshair' : 'default';
    if (this.canvas.style.cursor !== wantCursor) this.canvas.style.cursor = wantCursor;

    const rows = tracks(app, anim);
    const duration = Math.max(anim.duration, 1 / FPS);
    const width = Math.max(1, this.scroller.clientWidth);
    const height = Math.max(RULER + Math.max(rows.length, 1) * ROW + 6, this.scroller.clientHeight);
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
    const timeToX = (t) => trackLeft + (t / duration) * trackW;
    this.layout = { trackLeft, trackW, duration };

    // Ruler with frame ticks.
    ctx.fillStyle = 'rgb(45,45,45)';
    ctx.fillRect(0, 0, width, RULER);
    const frames = Math.round(duration * FPS);
    const pxPerFrame = trackW / (duration * FPS);
    const labelEvery = [1, 2, 5, 10, 15, 30, 60].find((n) => n * pxPerFrame >= 34) ?? 120;
    ctx.strokeStyle = 'rgb(120,120,120)';
    ctx.lineWidth = 1;
    ctx.font = '10px ui-monospace, Consolas, monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgb(170,170,170)';
    ctx.beginPath();
    for (let f = 0; f <= frames; f++) {
      const x = Math.round(timeToX(f / FPS)) + 0.5;
      const major = f % labelEvery === 0;
      if (major || pxPerFrame >= 5) {
        ctx.moveTo(x, RULER - (major ? 10 : 5));
        ctx.lineTo(x, RULER);
      }
      if (major) ctx.fillText(String(f), x + 2, 2);
    }
    ctx.stroke();

    // Rows.
    const selectedBone = selBone(app.sel);
    const selectedSlot = selSlot(app.sel);
    this.keyRects = [];
    rows.forEach(({ track, label }, r) => {
      const y = RULER + r * ROW;
      const highlight = (track.bone !== undefined && track.bone === selectedBone) || (track.slot !== undefined && track.slot === selectedSlot);
      if (r % 2 === 1 || highlight) {
        ctx.fillStyle = highlight ? 'rgb(55,50,40)' : 'rgb(34,34,34)';
        ctx.fillRect(0, y, width, ROW);
      }
      ctx.font = '12px system-ui, "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = 'rgb(200,200,200)';
      ctx.fillText(label, 8, y + ROW / 2, GUTTER - 14);
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
    // The retiming handles are hidden by default (they used to get in the way). They show only when
    // armed with the ⇔ Retime button (one use); a right-drag retimes without them (see onPointerMove).
    const span = retimeArmed ? this.selectionSpan() : null;
    if (span && span.max - span.min > 1e-6) {
      const x0 = timeToX(span.min);
      const x1 = timeToX(span.max);
      ctx.fillStyle = 'rgba(255,190,60,0.18)';
      ctx.fillRect(x0, RULER - 8, x1 - x0, 8);
      ctx.fillStyle = 'rgb(255,190,60)';
      for (const x of [x0, x1]) ctx.fillRect(x - 3, RULER - 12, 6, 12);
      this.handles = { x0, x1, min: span.min, max: span.max };
    }

    // Frame-column selection: a committed range, and the live band while dragging (full height,
    // so it reads as a column marked from the ruler down over the key tracks).
    const half = pxPerFrame / 2;
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
    if (this.press?.frameBox) {
      columnBand(this.press.frameBox.from, this.press.frameBox.to, 0, 'rgba(255,170,40,0.14)', 'rgb(255,170,40)');
    } else if (!clipboard) {
      // One yellow band per selected area (so several Alt+drag column groups all show, not just one).
      for (const reg of selectionRegions) {
        const rTop = reg.full ? RULER : RULER + Math.max(0, reg.r0) * ROW;
        const rBot = reg.full ? height : RULER + (Math.min(rows.length - 1, reg.r1) + 1) * ROW;
        const bx0 = timeToX(reg.f0 / FPS) - half;
        const bx1 = timeToX(reg.f1 / FPS) + half;
        ctx.fillStyle = 'rgba(255,170,40,0.10)';
        ctx.fillRect(bx0, rTop, Math.max(2, bx1 - bx0), rBot - rTop);
        ctx.fillStyle = 'rgba(255,170,40,0.85)';
        ctx.fillRect(bx0, RULER - 4, Math.max(2, bx1 - bx0), 4);
      }
    }

    // Armed copy: the source span in green, and a pulsing purple preview of the paste at the playhead.
    if (clipboard) {
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 300);
      const rowOf = new Map(rows.map(({ track }, r) => [trackId(track), r]));
      // The bands cover only the copied rows (a box selection is bounded to its pistas); a column
      // selection from the ruler spans every row.
      const copiedRows = clipboard.groups.map((g) => rowOf.get(trackId(g.track))).filter((r) => r !== undefined);
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
      const spanEnd = pasteTime + clipboard.span;
      const preview = previewKeys(clipboard, pasteTime);
      // Purple ghosts of the pasted keys (red when they would land past the end).
      for (const g of preview) {
        const r = rowOf.get(trackId(g.track));
        if (r === undefined) continue;
        const cy = RULER + r * ROW + ROW / 2;
        for (const t of g.times) {
          const over = t > duration + 1e-6;
          ghostDiamond(ctx, [timeToX(t), cy], 5.5, over ? `rgba(255,90,120,${alpha})` : `rgba(180,120,255,${alpha})`);
        }
      }
      // Overwrite preview: mark with a red ✕ the existing keys the paste would erase. 'overwrite'
      // only touches the copied tracks; 'full' touches every track the selection spanned.
      if (pasteMode !== 'none') {
        const occBy = new Map(preview.map((g) => [trackId(g.track), new Set(g.times.map((t) => Math.round(snap(t) * FPS)))]));
        let markRows;
        if (pasteMode === 'full') {
          const lo = clipboard.fullHeight ? 0 : clipboard.rowRange.min;
          const hi = clipboard.fullHeight ? rows.length - 1 : clipboard.rowRange.max;
          markRows = [];
          for (let r = lo; r <= hi; r++) markRows.push(r);
        } else {
          markRows = copiedRows;
        }
        for (const r of markRows) {
          const track = rows[r]?.track;
          if (!track) continue;
          const occ = occBy.get(trackId(track)) ?? new Set();
          const cy = RULER + r * ROW + ROW / 2;
          for (const k of resolveTrackKeys(anim, track) ?? []) {
            if (k.time < pasteTime - 1e-6 || k.time > spanEnd + 1e-6) continue;
            if (occ.has(Math.round(k.time * FPS))) continue;
            redCross(ctx, [timeToX(k.time), cy], 4);
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
  }

  pos(e) {
    const r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }

  hit(p) {
    return this.keyRects.find((k) => p[0] >= k.x0 && p[0] <= k.x1 && p[1] >= k.y0 && p[1] <= k.y1) ?? null;
  }

  xToTime(x) {
    const { trackLeft, trackW, duration } = this.layout;
    return Math.min(duration, Math.max(0, ((x - trackLeft) / trackW) * duration));
  }

  /** The frame number under x, clamped to the animation. */
  xToFrame(x) {
    const frames = Math.round(this.layout.duration * FPS);
    return Math.max(0, Math.min(frames, Math.round(this.xToTime(x) * FPS)));
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
    const span = from === to ? `frame ${from}` : `frames ${from}–${to}`;
    app.setStatus(`Selected ${span}: ${next.size} key${next.size === 1 ? '' : 's'}`);
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

  onPointerMove(e) {
    if (!this.press) return;
    const press = this.press;
    if (!(e.buttons & (press.right ? 2 : 1))) return;
    const app = this.app;
    const p = this.pos(e);
    if (press.right) {
      // A right-drag retimes the selection by scaling from its nearer edge (no handles needed).
      if (!press.started) {
        if (Math.hypot(p[0] - press.pos[0], p[1] - press.pos[1]) <= 3) return;
        press.started = true;
        app.playing = false;
        app.mode = Mode.Animate;
        const r = this.beginRetime(press.pos[0]);
        if (r) Object.assign(press, r);
      }
      if (press.retime) {
        this.applyRetime(press, snap(this.xToTime(p[0])));
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
    const timeToX = (time) => this.layout.trackLeft + (time / this.layout.duration) * this.layout.trackW;
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
        if (app.selectedKeys.size) curveMenu(app, press.clientX, press.clientY);
      } else if (press.retime) {
        resortAnimation(app.currentAnimation());
        clearRegions();
        app.setStatus(`Retimed ${app.selectedKeys.size} key${app.selectedKeys.size === 1 ? '' : 's'}`);
      }
      app.changed();
      return;
    }
    if (e.button !== 0) return;
    this.press = null;
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
      app.setStatus(`${press.move ? 'Moved' : 'Retimed'} ${n} key${n === 1 ? '' : 's'}`);
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
      if (inside.length) setRegion({ f0: this.xToFrame(x0), f1: this.xToFrame(x1), r0: rowAt(y0), r1: rowAt(y1), full: false }, press.add);
      else if (!press.add) clearRegions();
      app.setStatus(`${next.size} key${next.size === 1 ? '' : 's'} selected`);
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
export function curveMenu(app, x, y) {
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
  popupMenu(x, y, [
    { label: 'Linear', action: setCurve(LINEAR) },
    { label: 'Ease in-out', action: setCurve(EASE_IN_OUT) },
    { label: 'Ease in', action: setCurve(EASE_IN) },
    { label: 'Ease out', action: setCurve(EASE_OUT) },
    { label: 'Stepped', action: setCurve(STEPPED) },
    'separator',
    { label: app.selectedKeys.size > 1 ? `Delete ${app.selectedKeys.size} keys` : 'Delete key', action: () => deleteSelectedKeys(app) },
  ]);
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

