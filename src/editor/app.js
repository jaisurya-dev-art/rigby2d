// SPDX-License-Identifier: MIT OR Apache-2.0
// Editor state, history and document commands.

import { Pose } from '../core/pose.js';
import { invalidateConstraints } from '../core/constraints.js';
import { loadPreset, savePreset } from './keymap.js';
import { Skeleton } from '../core/model.js';
import { remEuclid } from '../core/state.js';
import * as edit from './edit.js';
import { Images } from './images.js';
import * as io from './io.js';
import * as platform from './platform.js';
import * as sample from './sample.js';
import { addSound, sounds, stopAudio } from './audio.js';
import { WORKSPACES, workspace as workspaceDef } from './workspaces.js';
import * as onion from './onion.js';
import { track } from './analytics.js';
import demoUrl from '../../branding/rigbytron/rigbytron.rigby?url&no-inline';

/** The bundled demo project: Rigbytron, the Rigby2D mascot. */
const DEMO_FILE = 'rigbytron.rigby';

/** Default onion-skin tint colors (future = cool, past = warm), shared with the UI. */
export const ONION_DEFAULTS = { futureColor: [0.55, 0.75, 1], pastColor: [1, 0.55, 0.55] };

/**
 * Frame rate of the open project (its output settings). A live binding: modules importing it see
 * the current project's value.
 */
export let FPS = 30;

/** Setup: edits change the setup (rest) pose. Animate: edits create keyframes at the current time. */
export const Mode = Object.freeze({ Setup: 'setup', Animate: 'animate' });

export const TOOLS = [
  { id: 'pose', label: '✋ Pose' },
  { id: 'create', label: '🦴 Create' },
  { id: 'rotate', label: '⟳ Rotate' },
  { id: 'translate', label: '✥ Translate' },
  { id: 'scale', label: '⤢ Scale' },
  { id: 'shear', label: '⧄ Shear' },
];


/** Snaps a time to the frame grid. */
export function snap(t) {
  return Math.round(t * FPS) / FPS;
}

// Selection is null, { bone: index } or { slot: index }.
export const selBone = (sel) => (sel && sel.bone !== undefined ? sel.bone : null);
export const selSlot = (sel) => (sel && sel.slot !== undefined ? sel.slot : null);

// Dopesheet tracks: { bone, channel }, { slot, channel }, { deform }, { ik }, { drawOrder } or { events }.

const errorText = (e) => (e && e.message) || String(e);

function loadSetting(key, fallback) {
  try {
    return globalThis.localStorage?.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function saveSetting(key, value) {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    // Settings are a convenience; ignore storage errors.
  }
}

export class App {
  constructor() {
    this.doc = new Skeleton();
    this.path = null;
    /** Where Ctrl+S writes without asking: { path, fs }, or null. */
    this.saveTarget = null;
    this.images = new Images();
    this.sel = null;
    /** Mesh being edited: { slot, name, mode: 'vertices' | 'weights', bone, radius, strength, subtract, selected }. */
    this.meshEdit = null;
    /** Shape being edited (bounding box, clipping or path): { slot, name, selected }. */
    this.shapeEdit = null;
    /** Physics simulation state kept between frames while playing, and the time to simulate. */
    this.physics = new Map();
    this.physicsDelta = 0;
    /** Events recently crossed during playback: [{ name, at }] (performance.now() times). */
    this.firedEvents = [];
    /** Bottom panel view: 'dopesheet' or 'graph'. */
    this.timelineView = 'dopesheet';
    /** Selected dopesheet keys (the key objects themselves). */
    this.selectedKeys = new Set();
    /** Additionally selected bones (the primary selection is `sel`). */
    this.multi = new Set();
    this.mode = Mode.Setup;
    this.tool = 'rotate';
    /** Keyboard shortcut preset id. */
    this.keymap = loadPreset();
    /** Animate mode: key every edit immediately (on), or keep edits as unkeyed changes (off). */
    this.autoKey = false;
    /** Unkeyed changes in animate mode: bone index -> { channel -> partial local transform }. */
    this.pending = new Map();
    /** Axes for numeric transform values: 'local', 'parent' or 'world'. */
    this.axis = 'parent';
    /** Playback direction: 1 forward, -1 backward. */
    this.playDirection = 1;
    /** Screen offset of the world origin from the viewport center, and zoom. */
    this.view = { panX: 0, panY: 200, zoom: 1 };
    this.anim = null;
    this.time = 0;
    this.playing = false;
    this.looping = true;
    this.selectedKeys.clear();
    this.status = 'Welcome to Rigby2D. Open the Rigbytron demo or a sample from the File menu, or import a PSD / PNGs.';
    this.showBones = true;
    /** Shows the output frame (resolution and framing) in the viewport. */
    this.showFrame = false;
    /**
     * Onion skinning: ghost poses of nearby frames drawn behind the current one. `future` / `past`
     * are the default frame counts and the colors tint them. `perBone` (bone name -> partial
     * override) limits the ghosts to those bones and their descendants; empty = the whole skeleton.
     * It is keyed by name, not index: indices shift when bones are deleted or reparented and when
     * undo rebuilds the document, names do not. Read and write it through onionOverride /
     * setOnionOverride / onionOverrideCount. Disabled costs one `if` per frame.
     */
    this.onion = {
      enabled: false,
      showFuture: true,
      showPast: true,
      future: 3,
      past: 3,
      loop: true,
      pastColor: [...ONION_DEFAULTS.pastColor],
      futureColor: [...ONION_DEFAULTS.futureColor],
      /** bone name -> { future?, past?, showFuture?, showPast?, futureColor?, pastColor? }. */
      perBone: new Map(),
    };
    /** Playback speed multiplier (1 = real time). */
    this.playSpeed = 1;
    /** Viewport drawing: 'webgl' (default when available) or 'canvas'. */
    this.renderer = loadSetting('rigby.renderer', 'webgl');
    this.frameRequest = false;
    /** Bumped on every state change so panels know to refresh. */
    this.version = 0;
    /** Bumped when playback moves the time: only time-dependent views need to follow it. */
    this.timeVersion = 0;
    this.history = { undo: [], redo: [] };
    /** JSON of the last committed document state, used to coalesce edits into undo steps. */
    this.baseline = this.doc.toSnapshot();
    this.saved = this.baseline;
    this.docJson = this.baseline;
    this.committedVersion = 0;
  }

  changed() {
    invalidateConstraints(this.doc);
    FPS = this.doc.settings?.fps ?? 30;
    this.version++;
  }

  setStatus(text) {
    this.status = text;
    this.changed();
  }

  /** Workspace of the open project: its own, or the user's default for projects without one. */
  get workspace() {
    return this.doc.workspace ?? workspaceDef(loadSetting('rigby.workspace', 'game')).id;
  }

  /** Switches the project's workspace (which tools are shown; the animation data is untouched). */
  setWorkspace(id) {
    const ws = workspaceDef(id);
    this.doc.workspace = ws.id;
    saveSetting('rigby.workspace', ws.id);
    this.showFrame = ws.features.has('outputFrame');
    this.setStatus(`${ws.label} workspace: ${ws.description}`);
  }

  /** Replaces the document (new/open/sample) and resets editor state. */
  loadDocument(doc, path) {
    this.meshEdit = null;
    this.shapeEdit = null;
    this.anim = doc.animations.length ? 0 : null;
    this.doc = doc;
    FPS = doc.settings?.fps ?? 30;
    this.showFrame = workspaceDef(this.workspace).features.has('outputFrame');
    this.path = path;
    this.sel = null;
    this.multi.clear();
    this.pending.clear();
    this.selectedKeys.clear();
    // Per-bone onion settings belong to the document they were made for.
    this.onion.perBone.clear();
    this._onionCache = null;
    this.time = 0;
    this.playing = false;
    this.history = { undo: [], redo: [] };
    this.docJson = this.baseline = this.saved = doc.toSnapshot();
    this.frameRequest = true;
    this.changed();
  }

  dirty() {
    return this.docJson !== this.saved;
  }

  currentAnimation() {
    return this.anim === null ? undefined : this.doc.animations[this.anim];
  }

  /** Pose shown in the viewport: setup pose, or the current animation frame in animate mode. */
  pose() {
    const pose = new Pose(this.doc);
    const anim = this.currentAnimation();
    if (this.mode === Mode.Animate && anim) {
      // Physics simulates while playing (state kept across frames) and rests otherwise.
      if (this.playing) {
        pose.physics = this.physics;
        pose.physicsDelta = this.physicsDelta;
        this.physicsDelta = 0;
      } else if (this.physics.size) {
        this.physics.clear();
      }
      pose.apply(this.doc, anim, this.time, 1);
      // Unkeyed changes override the animated values until they are keyed or discarded.
      for (const [bone, channels] of this.pending) {
        if (!pose.local[bone]) continue;
        for (const values of Object.values(channels)) Object.assign(pose.local[bone], values);
      }
      pose.updateWorld(this.doc);
    }
    return pose;
  }

  /** A bone's own onion override (by bone index), or undefined. */
  onionOverride(bone) {
    return onion.onionOverride(this.doc, this.onion, bone);
  }

  /** Sets a bone's own onion override (by bone index), or removes it when `entry` is null. */
  setOnionOverride(bone, entry) {
    onion.setOnionOverride(this.doc, this.onion, bone, entry);
  }

  /** How many bones of this document have their own onion settings (see onion.js). */
  onionOverrideCount() {
    return onion.onionOverrideCount(this.doc, this.onion);
  }

  /** The onion settings in effect for a bone, or null when it is not ghosted (see onion.js). */
  onionFor(bone, overrides) {
    return onion.onionFor(this.doc, this.onion, bone, overrides);
  }

  /** True when any bone is currently showing onion ghosts (for the "predictions active" notice). */
  onionActive() {
    const o = this.onion;
    if (!o.enabled || this.mode !== Mode.Animate || !this.currentAnimation()) return false;
    if (this.onionOverrideCount() === 0) return (o.showFuture && o.future > 0) || (o.showPast && o.past > 0);
    return true;
  }

  /**
   * Draw instructions for onion skinning: an array of { pose, tint, skip } to draw behind the
   * current pose, nearest frames brightest, grouped so each bone gets its own frame count and
   * color. Returns [] when disabled or not animating. Cached while the time and config hold.
   */
  onionDraws() {
    const o = this.onion;
    if (!o.enabled || this.mode !== Mode.Animate) return [];
    const anim = this.currentAnimation();
    if (!anim) return [];
    const bones = this.doc.bones;
    // Resolve each bone's effective settings once.
    const overrides = this.onionOverrideCount();
    const cfg = bones.map((_, b) => this.onionFor(b, overrides));
    let maxPast = 0;
    let maxFuture = 0;
    for (const c of cfg) {
      if (!c) continue;
      maxPast = Math.max(maxPast, c.past);
      maxFuture = Math.max(maxFuture, c.future);
    }
    if (maxPast === 0 && maxFuture === 0) return [];
    const key = [this.version, this.timeVersion, this.time, overrides, maxPast, maxFuture, JSON.stringify([...o.perBone]), o.pastColor.join(','), o.futureColor.join(',')].join('|');
    if (this._onionCache?.key === key) return this._onionCache.draws;

    const draws = [];
    const dur = anim.duration;
    const dt = 1 / FPS;
    // One distance in one direction: the ghosted bones at that distance, grouped by color, each
    // group drawn as one skeleton masked to its bones. Nearer frames are brighter.
    const addDistance = (dir, d) => {
      const maxN = dir > 0 ? maxFuture : maxPast;
      const groups = new Map();
      bones.forEach((_, b) => {
        const c = cfg[b];
        if (!c || (dir > 0 ? c.future : c.past) < d) return;
        const color = dir > 0 ? c.futureColor : c.pastColor;
        const ckey = color.join(',');
        if (!groups.has(ckey)) groups.set(ckey, { color, bones: new Set() });
        groups.get(ckey).bones.add(b);
      });
      if (!groups.size) return;
      const pose = this.ghostPose(anim, this.time + dir * d * dt, dur, o.loop);
      if (!pose) return;
      const alpha = 0.5 * (1 - (d - 1) / Math.max(1, maxN));
      for (const g of groups.values()) {
        const skip = overrides === 0 ? null : (slot) => !g.bones.has(this.doc.slots[slot]?.bone);
        draws.push({ pose, tint: [g.color[0], g.color[1], g.color[2], alpha], skip });
      }
    };
    // Farthest first so nearer (brighter) ghosts land on top; past then future at each distance.
    for (let d = Math.max(maxPast, maxFuture); d >= 1; d--) {
      if (d <= maxPast) addDistance(-1, d);
      if (d <= maxFuture) addDistance(1, d);
    }
    this._onionCache = { key, draws };
    return draws;
  }

  /** A posed skeleton at time `t` (looping or clamped), or null when outside a non-looping clip. */
  ghostPose(anim, t, dur, loop) {
    let tt = t;
    if (dur > 0 && loop) tt = remEuclid(t, dur);
    else if (t < 0 || (dur > 0 && t > dur)) return null;
    const pose = new Pose(this.doc);
    pose.apply(this.doc, anim, tt, 1);
    pose.updateWorld(this.doc);
    return pose;
  }

  /** Bones that tools and keying act on: the primary selection plus any additional ones. */
  selectedBones() {
    const out = [...this.multi].filter((b) => b < this.doc.bones.length);
    const primary = selBone(this.sel);
    if (primary !== null && !out.includes(primary)) out.unshift(primary);
    return out;
  }

  /** Selects one item (bone or slot), or toggles a bone in the selection when `add` is true. */
  select(item, add = false) {
    const bone = selBone(item);
    if (add && bone !== null) {
      const bones = new Set(this.selectedBones());
      if (bones.has(bone)) bones.delete(bone);
      else bones.add(bone);
      this.multi = bones;
      this.sel = bones.size ? { bone: bones.has(bone) ? bone : [...bones][0] } : null;
    } else {
      this.sel = item;
      this.multi.clear();
    }
    this.changed();
  }

  deselect() {
    this.sel = null;
    this.multi.clear();
    this.selectedKeys.clear();
    this.changed();
  }

  /** Drops unkeyed changes (they only live until the time, animation or mode changes). */
  discardPending(reason = '') {
    if (!this.pending.size) return;
    this.pending.clear();
    if (reason) this.status = `Unkeyed changes discarded (${reason}). Key them with K or turn on Auto key.`;
    this.changed();
  }

  setKeymap(id) {
    this.keymap = id;
    savePreset(id);
    this.changed();
  }

  undo() {
    this.syncJson();
    const prev = this.history.undo.pop();
    if (prev === undefined) return;
    this.history.redo.push(this.docJson);
    this.restore(prev);
  }

  redo() {
    this.syncJson();
    const next = this.history.redo.pop();
    if (next === undefined) return;
    this.history.undo.push(this.docJson);
    this.restore(next);
  }

  restore(json) {
    const before = this.doc;
    this.doc = Skeleton.fromObject(JSON.parse(json));
    onion.followBoneRenames(this.onion, before, this.doc);
    FPS = this.doc.settings?.fps ?? 30;
    this.docJson = this.baseline = json;
    this.selectedKeys.clear();
    this.sanitize();
    this.committedVersion = ++this.version;
  }

  syncJson() {
    this.docJson = this.doc.toSnapshot();
  }

  /** Clamps selections that may point past the end of the document after structural edits. */
  sanitize() {
    const b = selBone(this.sel);
    const s = selSlot(this.sel);
    if ((b !== null && b >= this.doc.bones.length) || (s !== null && s >= this.doc.slots.length)) this.sel = null;
    if (this.anim !== null && this.anim >= this.doc.animations.length) {
      this.anim = this.doc.animations.length ? this.doc.animations.length - 1 : null;
    }
  }

  /** Records an undo step once an edit gesture has finished (`busy` while dragging or typing). */
  commitHistory(busy) {
    // Commit only when the document changed since the last commit and no gesture is in flight. We do
    // NOT skip this while playing: playback alone never bumps `version` (advancePlayback calls
    // changed() only when stopped), but an edit made while the timeline runs does — and it must still
    // settle into docJson so dirty() shows the `*` and undo records it. (A former `this.playing`
    // guard here dropped edits made during playback until you stopped.)
    if (busy || this.committedVersion === this.version) return;
    this.committedVersion = this.version;
    this.syncJson();
    if (this.docJson !== this.baseline) {
      this.history.undo.push(this.baseline);
      this.baseline = this.docJson;
      this.history.redo = [];
      if (this.history.undo.length > 200) this.history.undo.shift();
    }
  }

  /** Opens a .rigby work file, or imports skeleton JSON, from `path` on the file system `fs`. */
  async openFrom(path, fs) {
    try {
      const { doc, warnings, imported, audio } = await io.openProject(path, fs, this.images);
      stopAudio();
      sounds.clear();
      for (const [name, bytes] of audio ?? []) await addSound(name, bytes).catch(() => warnings.push(`sound '${name}' cannot be decoded`));
      // Skeleton exports come from game workflows: open them in the game workspace.
      if (imported) doc.workspace = WORKSPACES.game.id;
      // Imported files are not work files: the first Save asks where to put the .rigby file.
      this.loadDocument(doc, imported ? null : path);
      this.saveTarget = !imported && fs.reusable ? { path, fs } : null;
      const what = imported ? 'Imported' : 'Opened';
      track(imported ? 'editor-import-skeleton' : 'editor-open');
      this.setStatus(warnings.length ? `${what} with warnings: ${warnings.join('; ')}` : `${what} ${path}`);
    } catch (e) {
      this.setStatus(`Could not open ${path}: ${errorText(e)}`);
    }
  }

  async confirmDiscard() {
    this.syncJson();
    if (!this.dirty()) return true;
    return platform.confirmDialog('Discard unsaved changes?', 'Unsaved changes');
  }

  /** Starts an empty project in workspace `id` (default: the last one used). */
  async newDocument(id) {
    if (!(await this.confirmDiscard())) return;
    const ws = workspaceDef(id ?? this.workspace);
    const doc = new Skeleton();
    doc.workspace = ws.id;
    doc.settings.fps = ws.fps;
    saveSetting('rigby.workspace', ws.id);
    this.images.clear();
    this.loadDocument(doc, null);
    this.saveTarget = null;
    this.setStatus(`New ${ws.label.toLowerCase()} project`);
  }

  /**
   * Opens Rigbytron, the demo project bundled with the editor, playing its animation. It is not
   * tied to a file: Save asks where to keep a copy. `ask` confirms discarding unsaved changes.
   */
  /** The demo project (Rigbytron) with its images loaded; the open document is not replaced. */
  async demoDocument() {
    const blob = await (await fetch(demoUrl)).blob();
    return io.openProject(DEMO_FILE, platform.memoryFs([new File([blob], DEMO_FILE)]), this.images);
  }

  async openDemo(ask = true) {
    if (ask && !(await this.confirmDiscard())) return;
    try {
      const { doc, warnings } = await this.demoDocument();
      this.loadDocument(doc, DEMO_FILE);
      this.saveTarget = null;
      this.anim = Math.max(0, doc.animations.findIndex((a) => a.name === 'release'));
      this.mode = Mode.Animate;
      this.playing = true;
      this.frameRequest = true;
      this.setStatus(warnings.length ? `Demo opened with warnings: ${warnings.join('; ')}` : 'Rigbytron demo: explore the rig and its hold and release animations. Save keeps a copy.');
    } catch (e) {
      this.setStatus(`Could not open the demo: ${errorText(e)}`);
    }
  }

  async newSample() {
    if (!(await this.confirmDiscard())) return;
    this.images.clear();
    this.loadDocument(sample.robot(this.images), null);
    this.saveTarget = null;
    this.mode = Mode.Animate;
    this.playing = true;
    this.setStatus('Sample robot loaded. The Help menu lists the shortcuts.');
  }

  async openDialog() {
    if (!(await this.confirmDiscard())) return;
    const picked = await this.guard(() => platform.pickProject());
    if (picked) await this.openFrom(picked.path, picked.fs);
  }

  /** Export format version: the imported file's version, or 4.3 for new work. */
  saveVersion() {
    const v = String(this.doc.header?.version ?? '');
    if (v.startsWith('3.')) return '3.8';
    if (/^4.[0-2](.|$)/.test(v)) return '4.2';
    return '4.3';
  }

  /** Saves the `.rigby` work file (the complete document and its images in one file). */
  async save(saveAs) {
    let target = saveAs ? null : this.saveTarget;
    if (!target) {
      const name = `${this.doc.name || 'untitled'}.${io.WORKFILE_EXT}`;
      target = await this.guard(() => platform.pickSaveTarget(name, 'Rigby2D work file', io.WORKFILE_EXT, { single: true }));
      if (!target) return;
    }
    try {
      const used = new Set(this.doc.audio.map((t) => t.sound));
      const audioFiles = [...sounds].filter(([name]) => used.has(name)).map(([name, s]) => ({ path: `audio/${name}`, bytes: s.bytes }));
      const { warnings } = await io.saveWorkfile(target.path, target.fs, this.doc, this.images, audioFiles);
      await target.fs.finish();
      this.path = target.path;
      this.saveTarget = target.fs.reusable ? target : null;
      this.syncJson();
      this.baseline = this.saved = this.docJson;
      const note = warnings.length ? ` (warnings: ${warnings.join('; ')})` : '';
      track('editor-save');
      this.setStatus(`Saved ${target.path}${note}`);
    } catch (e) {
      this.setStatus(`Save failed: ${errorText(e)}`);
    }
  }

  /** Writes skeleton JSON (.json + .atlas + .png). `version` is "3.8" or "4.2". */
  async exportSkeletonJson(version) {
    const target = await this.guard(() => platform.pickSaveTarget(`${this.doc.name || 'skeleton'}.json`, 'Skeleton JSON', 'json'));
    if (!target) return;
    try {
      const { atlasPath, warnings } = await io.exportSkeletonJson(target.path, target.fs, this.doc, this.images, version);
      await target.fs.finish();
      const note = warnings.length ? ` (warnings: ${warnings.join('; ')})` : '';
      track('editor-export-json');
      this.setStatus(`Exported skeleton JSON ${version}: ${target.path} and ${atlasPath}${note}`);
    } catch (e) {
      this.setStatus(`Skeleton JSON export failed: ${errorText(e)}`);
    }
  }

  /** Writes a binary skeleton (.skel format 4.3 + .atlas + .png). */
  async exportSkeletonBinary() {
    const target = await this.guard(() => platform.pickSaveTarget(`${this.doc.name || 'skeleton'}.skel`, 'Binary skeleton', 'skel'));
    if (!target) return;
    try {
      const { atlasPath, warnings } = await io.exportSkeletonBinary(target.path, target.fs, this.doc, this.images);
      await target.fs.finish();
      const note = warnings.length ? ` (warnings: ${warnings.join('; ')})` : '';
      track('editor-export-skel');
      this.setStatus(`Exported ${target.path} and ${atlasPath}${note}`);
    } catch (e) {
      this.setStatus(`Binary export failed: ${errorText(e)}`);
    }
  }

  async importPsd() {
    const [file] = (await this.guard(() => platform.pickImportFiles('Photoshop', ['psd'], false))) ?? [];
    if (!file) return;
    try {
      const n = await io.importPsd(file, this.doc, this.images);
      this.frameRequest = true;
      track('editor-import-psd');
      this.setStatus(`Imported ${n} layers from ${file.name}`);
    } catch (e) {
      this.setStatus(`PSD import failed: ${errorText(e)}`);
    }
  }

  /** Film: adds sound files as audio tracks of the current animation, starting at frame 0. */
  async importAudio() {
    const anim = this.currentAnimation();
    if (!anim) return this.setStatus('Select an animation first: audio tracks belong to an animation');
    const files = await this.guard(() => platform.pickImportFiles('Audio', ['wav', 'mp3', 'ogg', 'm4a', 'aac', 'flac'], true));
    if (!files?.length) return;
    for (const f of files) {
      const name = io.basename(f.name);
      try {
        await addSound(name, f.bytes);
        this.doc.audio.push({ sound: name, animation: anim.name, offset: 0, volume: 1 });
      } catch (e) {
        this.setStatus(`Cannot decode ${name}: ${errorText(e)}`);
        return;
      }
    }
    this.setStatus(`Added ${files.length} audio track(s) to '${anim.name}'`);
  }

  async importImages() {
    const files = (await this.guard(() => platform.pickImportFiles('Images', ['png'], true))) ?? [];
    if (!files.length) return;
    try {
      const n = await io.importPngs(files, selBone(this.sel) ?? 0, this.doc, this.images);
      this.frameRequest = true;
      this.setStatus(`Imported ${n} images`);
    } catch (e) {
      this.setStatus(`Image import failed: ${errorText(e)}`);
    }
  }

  /** Runs a dialog/picker, reporting failures in the status bar. */
  async guard(fn) {
    try {
      return await fn();
    } catch (e) {
      this.setStatus(`Dialog failed: ${errorText(e)}`);
      return null;
    }
  }

  toggleMode() {
    this.discardPending('mode changed');
    if (this.mode === Mode.Setup) {
      edit.ensureAnimation(this);
      this.mode = Mode.Animate;
    } else {
      this.playing = false;
      this.mode = Mode.Setup;
    }
    this.changed();
  }

  /** Starts playing in `direction` (1 forward, -1 backward), or stops if already playing that way. */
  togglePlay(direction = 1) {
    const stop = this.playing && this.playDirection === direction;
    this.playing = !stop && this.anim !== null;
    this.playDirection = direction;
    if (this.playing) {
      this.discardPending('playback started');
      this.mode = Mode.Animate;
    }
    this.changed();
  }

  stepFrame(dir) {
    this.playing = false;
    this.discardPending('time changed');
    const dur = this.currentAnimation()?.duration ?? 0;
    this.time = Math.max(0, Math.round(this.time * FPS) + dir) / FPS;
    if (dur > 0) this.time = Math.min(this.time, dur);
    this.changed();
  }

  setTime(t) {
    this.playing = false;
    if (Math.abs(t - this.time) > 1e-9) this.discardPending('time changed');
    this.time = Math.max(0, t);
    this.changed();
  }

  /** Key times of the selected bones' timelines (all timelines when nothing is selected). */
  keyTimes() {
    const anim = this.currentAnimation();
    if (!anim) return [];
    const bones = new Set(this.selectedBones());
    const times = new Set();
    for (const tl of anim.bones) {
      if (bones.size && !bones.has(tl.bone)) continue;
      for (const [k, keys] of Object.entries(tl)) if (Array.isArray(keys)) for (const key of keys) times.add(snap(key.time));
    }
    if (!bones.size) {
      for (const tl of anim.slots) for (const keys of Object.values(tl)) if (Array.isArray(keys)) for (const key of keys) times.add(snap(key.time));
      for (const t of anim.deform) for (const key of t.keys) times.add(snap(key.time));
      for (const t of anim.ik) for (const key of t.keys) times.add(snap(key.time));
      for (const key of [...anim.drawOrder, ...anim.events]) times.add(snap(key.time));
    }
    return [...times].sort((a, b) => a - b);
  }

  /** Moves to the next (dir 1) or previous (dir -1) key. */
  stepKey(dir) {
    const now = snap(this.time);
    const times = this.keyTimes();
    const target = dir > 0 ? times.find((t) => t > now + 1e-6) : [...times].reverse().find((t) => t < now - 1e-6);
    if (target !== undefined) this.setTime(target);
  }

  jumpToEnd() {
    const anim = this.currentAnimation();
    if (anim) this.setTime(anim.lastKeyTime());
  }

  advancePlayback(dt) {
    if (!this.playing) return;
    const anim = this.currentAnimation();
    if (!anim) {
      this.playing = false;
      return;
    }
    const before = this.time;
    const step = Math.min(dt, 0.1) * (this.playSpeed || 1);
    this.physicsDelta += step;
    this.time += step * this.playDirection;
    let wrapped = false;
    if (this.time > anim.duration || this.time < 0) {
      if (this.looping && anim.duration > 0) {
        this.time = remEuclid(this.time, anim.duration);
        wrapped = true;
      } else {
        this.time = Math.min(Math.max(this.time, 0), anim.duration);
        this.playing = false;
      }
    }
    // Events crossed while playing forward are shown briefly in the viewport.
    if (this.playDirection > 0) {
      const crossed = (e) => (wrapped ? e.time > before || e.time <= this.time : e.time > before && e.time <= this.time);
      const now = performance.now();
      for (const e of anim.events) if (crossed(e)) this.firedEvents.push({ name: e.name, at: now });
      this.firedEvents = this.firedEvents.filter((f) => now - f.at < 1200).slice(-6);
    }
    // Only the time moved: the document is unchanged, so panels that do not show the time are
    // not rebuilt (rebuilding them every frame made the editor lag while playing).
    this.timeVersion++;
    if (!this.playing) this.changed();
  }

  /**
   * The editor state shared with the detached panel windows: the document plus what every window
   * must agree on. This is the single source of what crosses windows — the sync layer derives the
   * change signature and the message payload from it, so adding a field here (and reading it back in
   * applyStateSnapshot) shares it everywhere, with nothing else to wire. Status and viewport stay
   * local to each window; viewport-coupled modes (meshEdit/shapeEdit) are shared so a panel can enter
   * them on the authority, whose viewport then responds.
   */
  snapshotState() {
    return {
      docJson: this.docJson,
      anim: this.anim,
      time: this.time,
      mode: this.mode,
      timelineView: this.timelineView,
      autoKey: this.autoKey,
      playing: this.playing,
      fps: FPS,
      sel: this.sel,
      multi: [...this.multi],
      meshEdit: this.meshEdit,
      shapeEdit: this.shapeEdit,
    };
  }

  /**
   * Adopts a snapshot from the other window. `opts.undo` records one undo step for an adopted
   * document edit (the editor window, which owns the single history, passes it). The dopesheet key
   * selection is not here (it is addressed by index at the sync boundary); bone selection is.
   */
  applyStateSnapshot(s, opts = {}) {
    // What forces a full panel rebuild (vs. just a time-dependent redraw during playback).
    const struct = () => `${this.anim}|${this.mode}|${this.timelineView}|${this.autoKey}|${this.playing}|${JSON.stringify(this.sel)}|${[...this.multi]}|${JSON.stringify(this.meshEdit)}|${JSON.stringify(this.shapeEdit)}`;
    const before = struct();
    let docChanged = false;
    if (s.docJson && s.docJson !== this.docJson) {
      docChanged = true;
      if (opts.undo) {
        this.syncJson();
        this.history.undo.push(this.docJson);
        if (this.history.undo.length > 200) this.history.undo.shift();
        this.history.redo = [];
      }
      const prev = this.doc;
      this.doc = Skeleton.fromObject(JSON.parse(s.docJson));
      onion.followBoneRenames(this.onion, prev, this.doc);
      // Keep our own canonical snapshot so the sync below is not mistaken for a fresh edit.
      // Like restore() (undo/redo), this does NOT touch `saved`: adopting an edit from another
      // window is a real change, so the editor (the authority) stays dirty until the user saves —
      // the title keeps its * and New/Open still warn. `saved` means "what is on disk", and only
      // new/open/save write it. Mirror windows never read dirty()/save, so their stale `saved` is
      // harmless.
      const canon = this.doc.toSnapshot();
      this.docJson = this.baseline = canon;
      this.selectedKeys.clear();
    }
    // Match the other window's frame rate so the ruler and the keys line up (changed() reads this).
    if (typeof s.fps === 'number' && this.doc.settings) this.doc.settings.fps = s.fps;
    if (s.anim !== undefined) this.anim = s.anim;
    if (typeof s.time === 'number') this.time = s.time;
    if (s.mode) this.mode = s.mode;
    if (s.timelineView) this.timelineView = s.timelineView;
    if (typeof s.autoKey === 'boolean') this.autoKey = s.autoKey;
    if (typeof s.playing === 'boolean') this.playing = s.playing;
    if ('sel' in s) this.sel = s.sel;
    if (s.multi) this.multi = new Set(s.multi);
    if ('meshEdit' in s) this.meshEdit = s.meshEdit;
    if ('shapeEdit' in s) this.shapeEdit = s.shapeEdit;
    this.sanitize();
    // Only the time moved (playback): bump timeVersion so heavy panels are not rebuilt every frame.
    if (docChanged || before !== struct()) this.changed();
    else this.timeVersion++;
    // This state came from the other window: mark it committed so it is not pushed straight back.
    this.committedVersion = this.version;
  }

  title() {
    const name = this.path ? io.basename(this.path) : 'untitled';
    return `Rigby2D - ${name}${this.dirty() ? ' *' : ''}`;
  }
}
