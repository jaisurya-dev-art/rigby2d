// SPDX-License-Identifier: MIT OR Apache-2.0
// Scene composition in the editor (Film workspace): new scenes, adding characters as actors, the
// actor inspector with its clips, layer depth for parallax, and the clip lanes at the top of the
// dopesheet (move a clip by dragging it, trim it by its edges, right-click for more).
// The model and evaluation are in core/scene.js; the actor library in actors.js.

import { clipLength, clipSpan, emptyScene, groundOffset, readClip } from '../core/scene.js';
import { transform } from '../core/math.js';
import { Animation } from '../core/animation.js';
import { FPS, Mode, selBone } from './app.js';
import { actorOfBone, actors, addActor, removeActor } from './actors.js';
import { DEMOS } from './demos.js';
import * as platform from './platform.js';
import { dragValue, h, popupMenu, select, submenuItem, textField } from './widgets.js';
import { track as count } from './analytics.js';

const row = (label, ...content) => [h('label', null, label), h('div', { class: 'cell' }, ...content)];
const snap = (t) => Math.round(t * FPS) / FPS;

/** Lane colors, one per actor. */
const COLORS = ['rgb(214,120,190)', 'rgb(110,170,230)', 'rgb(240,170,80)', 'rgb(120,200,140)', 'rgb(190,150,240)', 'rgb(230,110,110)'];
export const actorColor = (doc, actor) => COLORS[Math.max(0, doc.scene.actors.indexOf(actor)) % COLORS.length];

// ---- creating ----------------------------------------------------------------------------------

/**
 * File ▸ New ▸ Scene: a film project set up as a stage: a camera bone the output frame follows, a
 * background layer with depth, and a first shot. Actors are added next.
 */
export async function newScene(app) {
  const before = app.doc;
  await app.newDocument('film');
  if (app.doc === before) return; // cancelled
  const doc = app.doc;
  doc.name = 'scene';
  doc.bones.push({ name: 'camera', parent: 0, length: 120, setup: transform(0, 540, 0), inherit: 'normal', skinRequired: false, color: 'ffd84dff' });
  doc.bones.push({ name: 'background', parent: 0, length: 0, setup: transform(0, 0, 0), inherit: 'normal', skinRequired: false, color: null });
  doc.scene = emptyScene();
  doc.scene.depth.background = 1500;
  doc.settings.frame = { x: 0, y: 540, scale: 1, camera: true };
  doc.settingsInFile = true;
  doc.animations.push(new Animation('shot 1', 5));
  app.anim = 0;
  app.mode = Mode.Animate;
  app.commitHistory(false);
  app.changed();
  count('editor-new-scene');
  app.setStatus('New scene: add characters with ＋ Actor in the Scene section of the tree, and backgrounds with File ▸ Import ▸ PNG images (select the background bone first).');
}

/** Adds an actor from a work file's bytes at the view's center, selects it and keys nothing yet. */
async function addFrom(app, name, bytes) {
  try {
    const actor = await addActor(app, name, bytes, [-app.view.panX / app.view.zoom, 0]);
    const lib = actors.get(actor.id);
    // A first clip of its first animation at the playhead, so it moves right away.
    const anim = app.currentAnimation();
    const first = lib.doc.animations.find((a) => /idle|wave|walk/i.test(a.name)) ?? lib.doc.animations[0];
    if (anim && first) addClip(app, actor, first.name, snap(app.time));
    app.commitHistory(false);
    app.select({ bone: app.doc.boneIndex(actor.bone) });
    count('editor-add-actor');
    app.setStatus(`Added ${actor.name}: move it with the transform tools, and add clips in the inspector or the dopesheet's actor lane.`);
  } catch (e) {
    app.setStatus(`Could not add the actor: ${e.message}`);
  }
}

/** The ＋ Actor menu: from a work file, or one of the bundled demos. */
export function addActorMenu(app, x, y) {
  popupMenu(x, y, [
    {
      label: 'Character from a .rigby file…',
      action: async () => {
        const [file] = (await app.guard(() => platform.pickImportFiles('Rigby2D work file', ['rigby'], false))) ?? [];
        if (file) await addFrom(app, file.name.split(/[\\/]/).pop(), file.bytes);
      },
    },
    'separator',
    ...DEMOS.map((d) => ({
      label: `${d.name} (demo)`,
      action: async () => addFrom(app, d.file, new Uint8Array(await (await fetch(d.url)).arrayBuffer())),
    })),
  ]);
}

// ---- clips --------------------------------------------------------------------------------------

/** Adds a clip of `animation` at `start` to the current shot, after the actor's other clips. */
export function addClip(app, actor, animation, start) {
  const shot = app.currentAnimation();
  if (!shot) return null;
  const list = (actor.clips[shot.name] ??= []);
  const clip = readClip({ animation, start, blend: list.length ? 0.25 : 0 });
  list.push(clip);
  tidy(app, actor);
  return clip;
}

/** Keeps the shot's clips in order and the shot long enough to hold them. */
export function tidy(app, actor) {
  const shot = app.currentAnimation();
  if (!shot) return;
  const list = actor.clips[shot.name] ?? [];
  list.sort((a, b) => a.start - b.start);
  const lib = actors.get(actor.id);
  for (const c of list) {
    const len = clipLength(c, lib?.doc.animations.find((a) => a.name === c.animation));
    if (Number.isFinite(len)) shot.duration = Math.max(shot.duration, snap(c.start + len));
  }
}

const animOf = (actor, clip) => actors.get(actor.id)?.doc.animations.find((a) => a.name === clip.animation);

// ---- inspector ----------------------------------------------------------------------------------

/** The Actor section shown above the bone panel when an actor's anchor bone is selected. */
export function actorUi(app, bone) {
  const doc = app.doc;
  const actor = actorOfBone(doc, bone);
  if (!actor) return null;
  const lib = actors.get(actor.id);
  const changed = () => {
    app.commitHistory(false);
    app.changed();
  };
  const shot = app.currentAnimation();
  const clips = shot ? (actor.clips[shot.name] ?? []) : [];
  const anims = (lib?.doc.animations ?? []).map((a) => [a.name, `${a.name} (${a.duration.toFixed(2)} s)`]);
  const skins = [['', 'default'], ...(lib?.doc.skins ?? []).map((s) => [s.name, s.name])];
  const clipRows = clips.map((c, i) => {
    const set = (k) => (v) => {
      c[k] = v;
      tidy(app, actor);
      changed();
    };
    const [a, b] = clipSpan(c, animOf(actor, c));
    return h(
      'div',
      { class: 'clip-card', style: { borderLeftColor: actorColor(doc, actor) } },
      h('div', { class: 'clip-head' }, select(anims, c.animation, set('animation')), h('button', { class: 'small', title: 'Remove this clip', onclick: () => (clips.splice(i, 1), changed()) }, '✕')),
      h(
        'div',
        { class: 'grid' },
        ...row('Starts at', dragValue(c.start, (v) => set('start')(snap(Math.max(0, v))), { speed: 0.01, min: 0, decimals: 2, suffix: ' s' })),
        ...row('In / out', dragValue(a, (v) => set('in')(Math.max(0, v)), { speed: 0.01, min: 0, decimals: 2, suffix: ' s' }), dragValue(b, (v) => set('out')(Math.max(0, v)), { speed: 0.01, min: 0, decimals: 2, suffix: ' s' })),
        ...row('Speed', dragValue(c.speed, set('speed'), { speed: 0.01, min: 0.05, max: 8, decimals: 2, suffix: '×' })),
        ...row('Plays', select([[1, 'once'], [2, '2 times'], [3, '3 times'], [4, '4 times'], [0, 'loops until the next clip']], c.loops, set('loops'))),
        ...row('Blend in', dragValue(c.blend, set('blend'), { speed: 0.01, min: 0, max: 5, decimals: 2, suffix: ' s' })),
      ),
    );
  });
  return [
    h('h2', null, `🎬 Actor: ${actor.name}`),
    h('div', { class: 'small weak' }, `${lib ? `${lib.doc.bones.length} bones · ${lib.doc.animations.length} animations` : 'character missing'}${actor.source ? ` · from ${actor.source}` : ''}. Move, turn and scale it with the transform tools; key it like any bone.`),
    h(
      'div',
      { class: 'grid' },
      ...row(
        'Name',
        textField(actor.name, (v) => {
          const name = v.trim();
          if (name && !doc.scene.actors.some((a) => a !== actor && a.name === name)) {
            actor.name = name;
            app.changed();
          }
        }),
      ),
      ...row('Skin', select(skins, actor.skin ?? '', (v) => ((actor.skin = v || null), changed()))),
      ...row('', h('label', { class: 'check' }, h('input', { type: 'checkbox', checked: actor.flip, onchange: (e) => ((actor.flip = e.target.checked), changed()) }), ' Face the other way (flip)')),
      ...row(
        'Ground',
        dragValue(actor.ground ?? 0, (v) => {
          actor.ground = v;
          app.changed();
        }, { speed: 1, decimals: 0 }),
        lib ? h('button', { class: 'small', title: "Stand the character's feet (the lowest point of its setup pose) on the anchor bone", onclick: () => ((actor.ground = groundOffset(lib.doc)), changed()) }, 'Feet on anchor') : null,
      ),
    ),
    h('strong', null, shot ? `Clips in “${shot.name}”` : 'Clips'),
    shot ? null : h('div', { class: 'small weak' }, 'Create a shot (an animation of the scene) to place clips on.'),
    ...clipRows,
    shot && anims.length
      ? h('div', { class: 'buttons' }, select(anims, undefined, (name) => (addClip(app, actor, name, snap(app.time)), changed()), { placeholder: '＋ Add clip at the playhead…' }))
      : null,
    h('div', { class: 'buttons' }, h('button', { onclick: () => (removeActor(app, actor), app.deselect(), changed()) }, '🗑 Remove actor')),
    h('hr'),
  ];
}

/** Depth (parallax) of a top-level stage bone, for the bone panel of a scene. */
export function depthUi(app, bone) {
  const doc = app.doc;
  if (!doc.scene || doc.bones[bone]?.parent !== 0 || doc.bones[bone].name === 'camera' || actorOfBone(doc, bone)) return null;
  const name = doc.bones[bone].name;
  return h(
    'div',
    { class: 'grid' },
    ...row(
      'Depth',
      dragValue(doc.scene.depth[name] ?? 0, (v) => {
        if (Math.abs(v) < 1e-6) delete doc.scene.depth[name];
        else doc.scene.depth[name] = v;
        app.changed();
      }, { speed: 5, min: -900, max: 100000, decimals: 0 }),
      h('span', { class: 'small weak', title: 'Far layers (larger depth) drift behind near ones when the camera moves, keeping their size. 0 = moves with the stage.' }, ' parallax'),
    ),
  );
}

// ---- tree ---------------------------------------------------------------------------------------

/** Rows of the tree's Scene section: the actors (click to select). */
export function sceneRows(app, row) {
  const doc = app.doc;
  return (doc.scene?.actors ?? []).map((a) =>
    row(`🎬 ${a.name}`, {
      selected: selBone(app.sel) === doc.boneIndex(a.bone),
      title: `${a.source ?? ''}${actors.get(a.id) ? '' : ' (missing)'}`,
      onclick: () => app.select({ bone: doc.boneIndex(a.bone) }),
    }),
  );
}

// ---- dopesheet lanes ----------------------------------------------------------------------------

/** The actors that get a clip lane in the dopesheet. */
export const laneActors = (app) => (app.doc.scene?.actors ?? []).filter((a) => actors.get(a.id));

/** Draws the clip lanes (one per actor) from y = `top`. Returns the clip rectangles for hit tests. */
export function drawLanes(ctx, app, { top, row: ROW, width, gutter, timeToX }) {
  const shot = app.currentAnimation();
  const rects = [];
  if (!shot) return rects;
  laneActors(app).forEach((actor, r) => {
    const y = top + r * ROW;
    const color = actorColor(app.doc, actor);
    ctx.fillStyle = 'rgb(28,26,32)';
    ctx.fillRect(0, y, width, ROW);
    ctx.font = '12px system-ui, "Segoe UI", sans-serif';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(`🎬 ${actor.name}`, 8, y + ROW / 2, gutter - 14);
    const clips = actor.clips[shot.name] ?? [];
    clips.forEach((c, i) => {
      const anim = animOf(actor, c);
      const len = clipLength(c, anim);
      const next = clips[i + 1]?.start ?? Infinity;
      const end = Math.min(Number.isFinite(len) ? c.start + len : next, Math.max(shot.duration, c.start + 0.1), next === Infinity ? Infinity : next + (clips[i + 1]?.blend ?? 0));
      const x0 = timeToX(c.start);
      const x1 = Math.max(x0 + 6, timeToX(Number.isFinite(end) ? end : shot.duration));
      // Alternate shades, with a hairline gap, so clips that touch read as separate clips.
      ctx.fillStyle = color.replace('rgb', 'rgba').replace(')', i % 2 ? ',0.5)' : ',0.3)');
      ctx.fillRect(x0 + 1, y + 3, x1 - x0 - 2, ROW - 6);
      // The crossfade from the clip before.
      if (c.blend > 0 && i > 0) {
        const g = ctx.createLinearGradient(x0, 0, timeToX(c.start + c.blend), 0);
        g.addColorStop(0, 'rgba(255,255,255,0.35)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(x0, y + 3, timeToX(c.start + c.blend) - x0, ROW - 6);
      }
      // Loop boundaries.
      const [a, b] = clipSpan(c, anim);
      const span = (b - a) / c.speed;
      if (span > 0) {
        ctx.fillStyle = 'rgba(255,255,255,0.35)';
        for (let t = c.start + span; t < (Number.isFinite(end) ? end : shot.duration) - 1e-6; t += span) ctx.fillRect(timeToX(t), y + 5, 1, ROW - 10);
      }
      const selected = app.selectedClip?.clip === c;
      ctx.strokeStyle = selected ? 'rgb(255,190,60)' : color;
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeRect(x0 + 0.5, y + 3.5, x1 - x0 - 1, ROW - 7);
      ctx.fillStyle = 'rgb(235,235,235)';
      ctx.font = '11px system-ui, "Segoe UI", sans-serif';
      const label = `${c.animation}${c.speed !== 1 ? ` ${c.speed}×` : ''}${c.loops === 0 ? ' ∞' : c.loops > 1 ? ` ×${c.loops}` : ''}`;
      ctx.fillText(label, x0 + 6, y + ROW / 2, Math.max(0, x1 - x0 - 10));
      rects.push({ actor, clip: c, x0, x1, y0: y, y1: y + ROW });
    });
  });
  return rects;
}

/**
 * A press in the lanes: returns a drag handler { move(t), end() } for moving or trimming a clip,
 * or null (then the press scrubs time). Right-click opens the clip menu.
 */
export function pressLane(app, rects, p, e, xToTime, laneTop, ROW) {
  const hit = rects.find((r) => p[0] >= r.x0 - 4 && p[0] <= r.x1 + 4 && p[1] >= r.y0 && p[1] < r.y1);
  const laneIndex = Math.floor((p[1] - laneTop) / ROW);
  const actor = laneActors(app)[laneIndex];
  if (e.button === 2) {
    // The menu opens on this press; keep the window's outside-press handler from closing it.
    e.stopPropagation();
    if (hit) clipMenu(app, hit.actor, hit.clip, e.clientX, e.clientY);
    else if (actor) addMenu(app, actor, snap(xToTime(p[0])), e.clientX, e.clientY);
    return 'handled';
  }
  if (!hit) {
    app.selectedClip = null;
    return null;
  }
  const { clip } = hit;
  app.selectedClip = { actor: hit.actor, clip };
  app.select({ bone: app.doc.boneIndex(hit.actor.bone) });
  const anim = animOf(hit.actor, clip);
  const edge = p[0] - hit.x0 < 6 ? 'in' : hit.x1 - p[0] < 6 ? 'out' : 'move';
  const grab = xToTime(p[0]);
  const start = { start: clip.start, in: clip.in, out: clipSpan(clip, anim)[1] };
  return {
    move(x) {
      const dt = snap(xToTime(x)) - snap(grab);
      if (edge === 'move') clip.start = Math.max(0, snap(start.start + dt));
      else if (edge === 'in') {
        // Trim the head: the clip starts later and skips the same part of the animation.
        const d = Math.max(-start.in / clip.speed, Math.min(dt, (start.out - start.in) / clip.speed - 1 / FPS));
        clip.start = Math.max(0, snap(start.start + d));
        clip.in = Math.max(0, start.in + d * clip.speed);
      } else {
        clip.out = Math.min(anim?.duration ?? Infinity, Math.max(clip.in + 1 / FPS, start.out + dt * clip.speed));
        if (clip.loops === 0) clip.loops = 1;
      }
      app.changed();
    },
    end() {
      tidy(app, hit.actor);
      app.commitHistory(false);
      app.setStatus(`${hit.actor.name}: ${clip.animation} ${edge === 'move' ? `at ${clip.start.toFixed(2)} s` : `plays ${clip.in.toFixed(2)}–${clipSpan(clip, anim)[1].toFixed(2)} s`}`);
    },
  };
}

function clipMenu(app, actor, clip, x, y) {
  const shot = app.currentAnimation();
  const list = actor.clips[shot.name];
  const set = (k, v) => () => {
    clip[k] = v;
    tidy(app, actor);
    app.commitHistory(false);
    app.changed();
  };
  popupMenu(x, y, [
    submenuItem('Plays', [[1, 'Once'], [2, '2 times'], [3, '3 times'], [0, 'Loops until the next clip']].map(([v, l]) => ({ label: `${clip.loops === v ? '● ' : ''}${l}`, action: set('loops', v) }))),
    submenuItem('Speed', [0.25, 0.5, 0.75, 1, 1.5, 2].map((v) => ({ label: `${clip.speed === v ? '● ' : ''}${v}×`, action: set('speed', v) }))),
    submenuItem('Blend in', [0, 0.1, 0.25, 0.5, 1].map((v) => ({ label: `${clip.blend === v ? '● ' : ''}${v ? `${v} s` : 'Cut (no blend)'}`, action: set('blend', v) }))),
    {
      label: 'Split at the playhead',
      action: () => {
        const anim = animOf(actor, clip);
        const len = clipLength(clip, anim);
        const t = snap(app.time);
        if (t <= clip.start || (Number.isFinite(len) && t >= clip.start + len) || clip.loops !== 1) return app.setStatus('Split works on a clip that plays once, with the playhead inside it.');
        const at = clip.in + (t - clip.start) * clip.speed;
        const second = { ...clip, start: t, in: at, blend: 0 };
        clip.out = at;
        list.push(second);
        tidy(app, actor);
        app.commitHistory(false);
        app.changed();
      },
    },
    'separator',
    { label: 'Delete clip', action: () => (list.splice(list.indexOf(clip), 1), (app.selectedClip = null), app.commitHistory(false), app.changed()) },
  ]);
}

function addMenu(app, actor, t, x, y) {
  const lib = actors.get(actor.id);
  popupMenu(
    x,
    y,
    (lib?.doc.animations ?? []).map((a) => ({
      label: `＋ ${a.name} at ${t.toFixed(2)} s`,
      action: () => {
        addClip(app, actor, a.name, t);
        app.commitHistory(false);
        app.changed();
      },
    })),
  );
}
