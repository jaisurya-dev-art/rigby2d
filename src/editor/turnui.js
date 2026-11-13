// SPDX-License-Identifier: MIT OR Apache-2.0
// The bone inspector's 2.5D turn section (turn.js): make the pictures on a bone turnable, preview
// and key the turn, and tune its angle, roundness and each part's depth.

import { Mode } from './app.js';
import * as edit from './edit.js';
import { t } from './i18n.js';
import { buildTurn, planTurn, removeTurn, turnOf, turnSlots } from './turn.js';
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
  const amount = local ? Math.max(-1, Math.min(1, local.x / turn.reach)) : 0;
  const turnTo = (v) => local && edit.setBoneLocal(app, control, { ...local, x: v * turn.reach });
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
        row(
          t('Turn'),
          h('input', {
            type: 'range',
            class: 'turn-amount',
            min: -1,
            max: 1,
            step: 0.01,
            value: amount,
            title: setup ? t('Turns the setup pose (drag the control bone in the viewport too)') : t('Keys the turn at the current frame'),
            oninput: (e) => turnTo(Number(e.target.value)),
            ondblclick: () => turnTo(0),
          }),
          h('span', { class: 'small weak' }, `${Math.round(amount * turn.angle)}°`),
        ),
        row(t('Angle'), dragValue(turn.angle, (v) => rebuild(app, turn, { angle: v }), { min: 5, max: 85, speed: 0.5, decimals: 0, suffix: '°', disabled: !setup })),
        row(t('Roundness'), dragValue(turn.bulge, (v) => rebuild(app, turn, { bulge: v }), { min: 0, max: 1.5, speed: 0.01, decimals: 2, disabled: !setup })),
      ),
      h('div', { class: 'section-title' }, t('Depth of each part')),
      hint(t('Nearer parts (higher) move more when the head turns; parts behind move the other way.')),
      h('div', { class: 'grid' }, parts),
      h(
        'div',
        { class: 'buttons' },
        control !== null && control >= 0 ? button(t('Select control'), { icon: 'crosshair', onclick: () => app.select({ bone: control }) }) : null,
        button(t('Rebuild'), { icon: 'refresh-cw', disabled: !setup, title: t('After changing the pictures or bones: measure the parts again'), onclick: () => rebuild(app, { ...planTurn(doc, b), name: turn.name, angle: turn.angle, bulge: turn.bulge, reach: turn.reach }, {}) }),
        button(t('Remove'), {
          kind: 'danger',
          icon: 'trash-2',
          disabled: !setup,
          title: t('Removes the control bone, the turn animation and its slider; the meshes stay'),
          onclick: () => {
            removeTurn(doc, turn.name);
            app.changed();
          },
        }),
      ),
    ],
    { id: 'turn', open: true },
  );
}
