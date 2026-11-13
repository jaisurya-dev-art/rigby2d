// SPDX-License-Identifier: MIT OR Apache-2.0
// The bone inspector's 2.5D turn section (turn.js): make the pictures on a bone turnable, preview
// and key the turn, and tune its angle, roundness and each part's depth.

import { Mode } from './app.js';
import * as edit from './edit.js';
import { t } from './i18n.js';
import { SIDES, buildTurn, planTurn, removeTurn, shapeSide, sideShaped, turnOf, turnSlots } from './turn.js';
import { bakeWarps, keyWarp, pointsOf } from './warp.js';
import { button, hint, section } from './ui.js';
import { dragValue, h } from './widgets.js';

/** Rebuilds `turn` with `changes`, keeping its control bone (and any keys on it). */
function rebuild(app, turn, changes) {
  try {
    buildTurn(app.doc, { ...turn, ...changes });
  } catch (e) {
    app.setStatus(`${t('Could not rebuild the turn')}: ${e.message}`);
  }
  app.changed();
}

const SIDE_LABELS = { left: 'Left', right: 'Right', up: 'Up', down: 'Down' };

/** Starts shaping one side: the head shown turned that way, its lattice ready to drag. */
function startShaping(app, turn, side) {
  const doc = app.doc;
  const r = shapeSide(doc, turn, side);
  if (!r) return app.setStatus(t('Nothing to shape: the turned parts are not meshes'));
  const control = doc.boneIndex(turn.control);
  const rest = turn.rest ?? [0, 0];
  const local = { ...doc.bones[control].setup };
  local[r.axis] = rest[r.axis === 'x' ? 0 : 1] + r.sign * turn.reach;
  app.testPose.clear();
  app.testPose.set(control, local);
  app.meshEdit = null;
  app.warpEdit = { name: r.warp.name, anim: r.anim, time: r.time, preview: true, side, turn: turn.name, picked: new Set() };
  bakeWarps(doc);
  app.setStatus(t('Shaping {side}: drag the orange points until it looks right. Shift+click picks several; drag inside the grid to move them all.', { side: t(SIDE_LABELS[side]) }));
  app.changed();
}

/** Ends shaping: the head back to straight ahead. */
function stopShaping(app) {
  app.testPose.clear();
  app.warpEdit = null;
  app.changed();
}

/** The "Shape a side" row, or the bar shown while a side is being shaped. */
function shapeUi(app, turn) {
  const doc = app.doc;
  const shaping = app.warpEdit?.preview && app.warpEdit.turn === turn.name ? app.warpEdit.side : null;
  if (shaping) {
    return h(
      'div',
      { class: 'turn-shaping' },
      h('strong', null, t('Shaping {side}', { side: t(SIDE_LABELS[shaping]) })),
      hint(t('Drag the orange points over the head until this side looks right; every angle in between blends to it.')),
      h(
        'div',
        { class: 'buttons' },
        button(t('Reset this side'), {
          icon: 'rotate-cw',
          onclick: () => {
            const w = doc.warps.find((x) => x.name === app.warpEdit.name);
            if (w) keyWarp(w, app.warpEdit.anim, app.warpEdit.time, new Array(pointsOf(w) * 2).fill(0));
            bakeWarps(doc);
            app.changed();
          },
        }),
        button(t('Done'), { kind: 'primary', icon: 'check', onclick: () => stopShaping(app) }),
      ),
    );
  }
  const setup = app.mode === Mode.Setup;
  return [
    h('div', { class: 'section-title' }, t('Shape a side by hand')),
    hint(t('The turn is a first draft. Pick a side to fix it by hand: the head turns that way and you drag its shape.')),
    h(
      'div',
      { class: 'turn-sides' },
      Object.keys(SIDES).map((side) =>
        button(t(SIDE_LABELS[side]), {
          size: 'sm',
          disabled: !setup,
          title: setup ? (sideShaped(doc, turn, side) ? t('Shaped by hand: click to change it') : t('Shape this side by hand')) : t('In Setup mode'),
          icon: sideShaped(doc, turn, side) ? 'check' : null,
          onclick: () => startShaping(app, turn, side),
        }),
      ),
    ),
  ];
}

const row = (label, ...content) => [h('label', null, label), h('div', { class: 'cell' }, ...content)];

/** The 2.5D turn section for bone `b`, or null when the bone has no pictures to turn. */
export function turnUi(app, b) {
  const doc = app.doc;
  const setup = app.mode === Mode.Setup;
  const turn = turnOf(doc, b);
  if (!turn) {
    const count = turnSlots(doc, b).length;
    if (!count) return null;
    return section(
      t('2.5D turn'),
      [
        hint(t('Turns the {count} picture(s) on this bone and below it in 2.5D, with one control: near parts move more, far parts less.', { count })),
        h(
          'div',
          { class: 'buttons' },
          button(t('Make turnable'), {
            icon: 'rotate-cw',
            disabled: !setup,
            title: setup ? undefined : t('In Setup mode'),
            onclick: () => {
              const built = buildTurn(doc, planTurn(doc, b));
              app.setStatus(t('{bone} turns in 2.5D: drag its control bone ({control}) left and right, or key it in an animation', { bone: doc.bones[b].name, control: built.control }));
              app.changed();
            },
          }),
        ),
      ],
      { id: 'turn', open: false },
    );
  }
  const control = doc.boneIndex(turn.control);
  const local = control !== null && control >= 0 ? app.pose().local[control] : null;
  // Where the control rests is straight ahead; its x turns, its y tilts.
  const [restX, restY] = turn.rest ?? [0, 0];
  const clamp1 = (v) => Math.max(-1, Math.min(1, v));
  const amount = local ? clamp1((local.x - restX) / turn.reach) : 0;
  const tiltAmount = local ? clamp1((local.y - restY) / turn.reach) : 0;
  const turnTo = (v) => local && edit.setBoneLocal(app, control, { ...local, x: restX + v * turn.reach });
  const tiltTo = (v) => local && edit.setBoneLocal(app, control, { ...local, y: restY + v * turn.reach });
  const slider = (value, onSet, title) =>
    h('input', { type: 'range', class: 'turn-amount', min: -1, max: 1, step: 0.01, value, title, oninput: (e) => onSet(Number(e.target.value)), ondblclick: () => onSet(0) });
  const sliderTitle = setup ? t('Turns the setup pose (drag the control bone in the viewport too)') : t('Keys the turn at the current frame');
  const parts = turn.parts.map((p, i) =>
    row(
      p.slot,
      dragValue(p.depth, (v) => rebuild(app, turn, { parts: turn.parts.map((q, k) => (k === i ? { ...q, depth: v } : q)) }), { speed: 0.5, decimals: 1, disabled: !setup }),
    ),
  );
  return section(
    t('2.5D turn'),
    [
      h(
        'div',
        { class: 'grid' },
        row(t('Turn'), slider(amount, turnTo, sliderTitle), h('span', { class: 'small weak' }, `${Math.round(amount * turn.angle)}°`)),
        row(t('Tilt'), slider(tiltAmount, tiltTo, sliderTitle), h('span', { class: 'small weak' }, `${Math.round(tiltAmount * (turn.tilt ?? 15))}°`)),
        row(t('Angle'), dragValue(turn.angle, (v) => rebuild(app, turn, { angle: v }), { min: 5, max: 85, speed: 0.5, decimals: 0, suffix: '°', disabled: !setup })),
        row(t('Tilt angle'), dragValue(turn.tilt ?? 15, (v) => rebuild(app, turn, { tilt: v }), { min: 0, max: 60, speed: 0.5, decimals: 0, suffix: '°', disabled: !setup })),
        row(t('Roundness'), dragValue(turn.bulge, (v) => rebuild(app, turn, { bulge: v }), { min: 0, max: 1.5, speed: 0.01, decimals: 2, disabled: !setup })),
      ),
      shapeUi(app, turn),
      h('div', { class: 'section-title' }, t('Depth of each part')),
      hint(t('Nearer parts (higher) move more when the head turns; parts behind move the other way.')),
      h('div', { class: 'grid' }, parts),
      h(
        'div',
        { class: 'buttons' },
        control !== null && control >= 0 ? button(t('Select control'), { icon: 'crosshair', onclick: () => app.select({ bone: control }) }) : null,
        button(t('Rebuild'), { icon: 'refresh-cw', disabled: !setup, title: t('After changing the pictures or bones: measure the parts again'), onclick: () => rebuild(app, { ...planTurn(doc, b), name: turn.name, angle: turn.angle, tilt: turn.tilt, bulge: turn.bulge, reach: turn.reach }, {}) }),
        button(t('Remove'), {
          kind: 'danger',
          icon: 'trash-2',
          disabled: !setup,
          title: t('Removes the control bone, the turn animation and its slider; the meshes stay'),
          onclick: () => {
            if (app.warpEdit?.turn === turn.name) stopShaping(app);
            removeTurn(doc, turn.name);
            app.changed();
          },
        }),
      ),
    ],
    { id: 'turn', open: true },
  );
}
