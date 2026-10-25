// SPDX-License-Identifier: MIT OR Apache-2.0
// Dialogs for Rigby AutoRig (rig imported artwork in one step) and animation retargeting (bring
// animations over from another character).

import { PART_ROLES, autoRig, findParts } from '../core/autorig.js';
import { mapBones, retarget, skeletonHeight } from '../core/retarget.js';
import { track } from './analytics.js';
import { Mode } from './app.js';
import { Images } from './images.js';
import * as io from './io.js';
import * as log from './log.js';
import * as platform from './platform.js';
import { h } from './widgets.js';

/** A modal dialog; returns { body, close }. Escape closes it. */
function modal(title, wide = false) {
  const overlay = h('div', { class: 'modal-backdrop' });
  const body = h('div', { class: `modal${wide ? ' modal-wide' : ''}` });
  overlay.append(body);
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  };
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey, true);
  };
  document.addEventListener('keydown', onKey, true);
  document.body.append(overlay);
  body.dataset.title = title;
  return { body, close };
}

/** Replaces the dialog's content; empty parts (null) are left out. */
const fillWith = (body) => (...children) => body.replaceChildren(...children.filter(Boolean));

const select = (options, value, onchange) =>
  h(
    'select',
    { onchange: (e) => onchange(e.target.value) },
    options.map(([v, label]) => h('option', { value: v, selected: v === value }, label)),
  );

/** Alpha of the editor's images, for AutoRig. */
function alphaOf(app) {
  return (name) => {
    if (app.images.alphaAt(name, 0, 0) === null) return null;
    const s = app.images.map.get(name);
    return { width: s.canvas.width, height: s.canvas.height, data: s.alpha };
  };
}

const ROLE_LABELS = { upperarm: 'upper arm', forearm: 'forearm', arm: 'arm (whole)', thigh: 'thigh', shin: 'shin', leg: 'leg (whole)', extra: 'other (nearest bone)' };

// ---- AutoRig ----------------------------------------------------------------------------------

/** File ▸ AutoRig: identify the layers of imported artwork and build the rig. */
export function openAutoRig(app) {
  const { body, close } = modal('AutoRig', true);
  const fill = fillWith(body);
  const choice = { roles: {}, sides: {}, meshes: 'deforming', ik: true };

  const importPsd = async () => {
    const before = app.doc;
    if (app.doc.bones.length > 1 || app.doc.slots.length) await app.newDocument(app.workspace);
    if (app.doc === before && (app.doc.bones.length > 1 || app.doc.slots.length)) return;
    await app.importPsd();
    choice.roles = {};
    choice.sides = {};
    draw();
  };

  const generate = () => {
    app.commitHistory(false);
    const before = app.doc.toSnapshot();
    try {
      const report = autoRig(app.doc, alphaOf(app), choice);
      app.sel = null;
      app.multi.clear();
      app.mode = Mode.Setup;
      app.frameRequest = true;
      app.changed();
      for (const w of report.warnings) log.warn(w, { source: 'autorig' });
      track('editor-autorig');
      app.setStatus(`AutoRig: ${report.bones.length} bones, ${report.parts.filter((p) => p.mesh).length} meshes, ${report.ik.length} IK${report.warnings.length ? ` (${report.warnings.length} note${report.warnings.length === 1 ? '' : 's'} in View ▸ Log)` : ''}. Undo reverts it.`);
      close();
    } catch (e) {
      if (app.doc.toSnapshot() !== before) app.restore(before);
      log.exception(e, { source: 'autorig' });
      app.setStatus(`AutoRig failed: ${log.errorMessage(e)}`);
    }
  };

  const draw = () => {
    let parts = null;
    let problem = null;
    try {
      parts = app.doc.slots.length ? findParts(app.doc, alphaOf(app), choice) : null;
    } catch (e) {
      problem = log.errorMessage(e);
    }
    const intro = h(
      'p',
      { class: 'weak' },
      'AutoRig identifies each layer from its name (head, torso, arm_l, upperarm_r, hand, leg, eye, tail…) or its position, places joints where the parts meet, and builds bones, meshes and IK. Check the roles below, then generate. Everything it makes stays editable, and Undo reverts it.',
    );
    const rows = parts?.map((p) =>
      h(
        'tr',
        null,
        h('td', null, p.name),
        h(
          'td',
          null,
          select(
            [...PART_ROLES.map((r) => [r, ROLE_LABELS[r] ?? r]), ['none', '— leave unrigged —']],
            choice.roles[p.name] ?? p.role,
            (v) => {
              choice.roles[p.name] = v;
              draw();
            },
          ),
        ),
        h(
          'td',
          null,
          select(
            [
              ['', '—'],
              ['l', 'left'],
              ['r', 'right'],
            ],
            (p.name in choice.sides ? choice.sides[p.name] : p.side) ?? '',
            (v) => {
              choice.sides[p.name] = v || null;
              draw();
            },
          ),
        ),
        h('td', { class: 'weak' }, { name: 'name', position: 'position', manual: 'you' }[p.from] ?? '?'),
      ),
    );
    fill(
      h('h3', null, 'AutoRig'),
      intro,
      problem
        ? h('p', null, problem)
        : !parts?.length
          ? h('p', null, 'Import layered artwork first: a PSD with one layer per body part.')
          : h('div', { class: 'autorig-table', 'data-tut': 'autorig:parts' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Layer'), h('th', null, 'Part'), h('th', null, 'Side'), h('th', null, 'Found by'))), h('tbody', null, rows))),
      parts?.length
        ? h(
            'div',
            { class: 'modal-columns' },
            h(
              'label',
              null,
              'Meshes ',
              select(
                [
                  ['deforming', 'for bending parts'],
                  ['all', 'for every part'],
                  ['none', 'none'],
                ],
                choice.meshes,
                (v) => (choice.meshes = v),
              ),
            ),
            h('label', null, h('input', { type: 'checkbox', checked: choice.ik, onchange: (e) => (choice.ik = e.target.checked) }), ' IK for arms and legs'),
          )
        : null,
      h(
        'div',
        { class: 'modal-buttons' },
        h('button', { onclick: importPsd }, parts?.length || problem ? 'Start over from a PSD…' : 'Import PSD…'),
        h('span', { class: 'float-spacer' }),
        h('button', { onclick: close }, 'Cancel'),
        h('button', { class: 'primary', 'data-tut': 'autorig:generate', disabled: !parts?.length, onclick: generate }, 'Generate rig'),
      ),
    );
  };
  draw();
}

// ---- retargeting ------------------------------------------------------------------------------

/** File ▸ Retarget animations: pick another character's project and bring its animations over. */
export async function openRetarget(app) {
  const picked = await app.guard(() => platform.pickProject());
  if (!picked) return;
  let source;
  try {
    ({ doc: source } = await io.openProject(picked.path, picked.fs, new Images()));
  } catch (e) {
    app.setStatus(`Could not open ${picked.path}: ${log.errorMessage(e)}`);
    return;
  }
  if (!source.animations.length) {
    app.setStatus(`${picked.path} has no animations to retarget`);
    return;
  }
  const { body, close } = modal('Retarget', true);
  const fill = fillWith(body);
  const choice = { animations: new Set([source.animations[0].name]), mode: 'relative', scale: null, mapping: {}, replace: false };
  const target = app.doc;

  const run = () => {
    app.commitHistory(false);
    const before = target.toSnapshot();
    try {
      const reports = [...choice.animations].map((n) => retarget(source, n, target, { mode: choice.mode, scale: choice.scale ?? undefined, mapping: choice.mapping, replace: choice.replace }).report);
      for (const r of reports) for (const s of r.skipped) log.info(`${r.animation}: skipped ${s}`, { source: 'retarget' });
      app.anim = target.animations.findIndex((a) => a.name === reports.at(-1).animation);
      app.mode = Mode.Animate;
      app.time = 0;
      app.changed();
      track('editor-retarget');
      app.setStatus(`Retargeted ${reports.map((r) => r.animation).join(', ')} (scale ${reports[0].scale.toFixed(2)}). Undo reverts it.`);
      close();
    } catch (e) {
      if (target.toSnapshot() !== before) app.restore(before);
      log.exception(e, { source: 'retarget' });
      app.setStatus(`Retarget failed: ${log.errorMessage(e)}`);
      draw();
    }
  };

  const draw = () => {
    const { pairs, unmapped } = mapBones(source, target, choice.mapping);
    const byS = new Map(pairs.map((p) => [p.source, p]));
    const keyed = new Set(source.animations.filter((a) => choice.animations.has(a.name)).flatMap((a) => a.bones.map((t) => t.bone)));
    const targetOptions = [['', '— none —'], ...target.bones.map((b) => [b.name, b.name])];
    const sh = skeletonHeight(source);
    const auto = sh > 1e-6 ? skeletonHeight(target) / sh : 1;
    const rows = source.bones
      .map((b, i) => ({ b, i }))
      .filter(({ i }) => keyed.has(i))
      .map(({ b, i }) => {
        const p = byS.get(i);
        return h(
          'tr',
          null,
          h('td', null, b.name),
          h(
            'td',
            null,
            select(targetOptions, p ? target.bones[p.target].name : '', (v) => {
              choice.mapping[b.name] = v || null;
              draw();
            }),
          ),
          h('td', { class: 'weak' }, p ? p.how : 'not matched'),
        );
      });
    const clash = [...choice.animations].filter((n) => target.animations.some((a) => a.name === n));
    fill(
      h('h3', null, `Retarget from ${picked.path.split(/[\\/]/).pop()}`),
      h('p', { class: 'weak' }, 'Bones are matched by name, then by body part. Movement is scaled to this character\'s size. Check the matches of the animated bones below.'),
      h(
        'div',
        { class: 'modal-columns' },
        h(
          'div',
          null,
          h('strong', null, 'Animations'),
          h(
            'div',
            { class: 'checklist' },
            source.animations.map((a) =>
              h(
                'label',
                null,
                h('input', {
                  type: 'checkbox',
                  checked: choice.animations.has(a.name),
                  onchange: (e) => {
                    if (e.target.checked) choice.animations.add(a.name);
                    else choice.animations.delete(a.name);
                    draw();
                  },
                }),
                ` ${a.name}`,
              ),
            ),
          ),
        ),
        h(
          'div',
          null,
          h('strong', null, 'Options'),
          h(
            'p',
            null,
            'Rotations ',
            select(
              [
                ['relative', 'relative to each rest pose'],
                ['world', 'match world directions'],
              ],
              choice.mode,
              (v) => (choice.mode = v),
            ),
          ),
          h(
            'p',
            null,
            'Movement scale ',
            h('input', {
              type: 'number',
              step: '0.05',
              min: '0.01',
              class: 'frame-input',
              value: (choice.scale ?? auto).toFixed(2),
              onchange: (e) => (choice.scale = Number(e.target.value) > 0 ? Number(e.target.value) : null),
            }),
            h('span', { class: 'weak' }, ` (auto ${auto.toFixed(2)})`),
          ),
          clash.length ? h('label', null, h('input', { type: 'checkbox', checked: choice.replace, onchange: (e) => (choice.replace = e.target.checked) }), ` Replace ${clash.join(', ')}`) : null,
        ),
      ),
      h('div', { class: 'autorig-table' }, h('table', null, h('thead', null, h('tr', null, h('th', null, 'Source bone'), h('th', null, 'This character'), h('th', null, 'Matched by'))), h('tbody', null, rows))),
      unmapped.some((i) => keyed.has(i)) ? h('p', { class: 'weak' }, 'Keys of unmatched bones are left out.') : null,
      h(
        'div',
        { class: 'modal-buttons' },
        h('button', { onclick: close }, 'Cancel'),
        h('button', { class: 'primary', disabled: !choice.animations.size || (clash.length > 0 && !choice.replace), onclick: run }, 'Retarget'),
      ),
    );
  };
  draw();
}

