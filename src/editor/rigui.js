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
import { h, popupMenu } from './widgets.js';
import { button, checkbox, dialog, fieldRow, fields, hint } from './ui.js';
import { t } from './i18n.js';

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
  const { body, close, setFooter } = dialog({
    title: t('AutoRig'),
    subtitle: t('Builds bones, meshes and IK from layers named or placed like body parts. Everything stays editable, and Undo reverts it.'),
    className: 'modal-wide autorig-dialog',
  });
  const fill = fillWith(body);
  const choice = { roles: {}, sides: {}, meshes: 'deforming', ik: true };

  // Fresh artwork from a PSD, an SVG or same-size PNGs (one per part, landing where they were drawn):
  // in a new project when this one already has some.
  const importArt = (kind) => async () => {
    const before = app.doc;
    if (app.doc.bones.length > 1 || app.doc.slots.length) await app.newDocument(app.workspace);
    if (app.doc === before && (app.doc.bones.length > 1 || app.doc.slots.length)) return;
    await (kind === 'svg' ? app.importSvg() : kind === 'png' ? app.importImages() : app.importPsd());
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
      app.setStatus(t('AutoRig: {bones} bones, {meshes} meshes, {ik} IK', { bones: report.bones.length, meshes: report.parts.filter((p) => p.mesh).length, ik: report.ik.length }) + (report.warnings.length ? ' ' + t('({count} note(s) in View ▸ Log)', { count: report.warnings.length }) : '') + '. ' + t('Undo reverts it.'));
      close();
    } catch (e) {
      if (app.doc.toSnapshot() !== before) app.restore(before);
      log.exception(e, { source: 'autorig' });
      app.setStatus(t('AutoRig failed: {error}', { error: log.errorMessage(e) }));
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
    const rows = parts?.map((p) =>
      h(
        'tr',
        null,
        h('td', null, p.name),
        h(
          'td',
          null,
          select(
            [...PART_ROLES.map((r) => [r, ROLE_LABELS[r] ?? r]), ['none', t('(leave unrigged)')]],
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
              ['l', t('left')],
              ['r', t('right')],
            ],
            (p.name in choice.sides ? choice.sides[p.name] : p.side) ?? '',
            (v) => {
              choice.sides[p.name] = v || null;
              draw();
            },
          ),
        ),
        h('td', { class: 'weak' }, { name: t('name'), position: t('position'), manual: t('you') }[p.from] ?? '?'),
      ),
    );
    const imports = (again) => [
      ['psd', again ? t('Start over from a PSD…') : t('Import PSD…')],
      ['svg', again ? t('Start over from an SVG…') : t('Import SVG…')],
      ['png', again ? t('Start over from PNGs…') : t('Import PNGs…')],
    ];
    const ready = !!parts?.length;
    fill(
      problem ? hint(problem, { tone: 'danger' }) : null,
      !problem && !ready ? hint(t('Import layered artwork first: a PSD or SVG with a layer per body part, or same-size PNGs, one per part.'), { docs: 'autorig' }) : null,
      !problem && !ready ? h('div', { class: 'autorig-imports' }, imports(false).map(([kind, label]) => button(label, { onclick: importArt(kind) }))) : null,
      ready
        ? h('div', { class: 'autorig-table', 'data-tut': 'autorig:parts' }, h('table', null, h('thead', null, h('tr', null, h('th', null, t('Layer')), h('th', null, t('Part')), h('th', null, t('Side')), h('th', null, t('Found by')))), h('tbody', null, rows)))
        : null,
      ready
        ? fields(
            ...fieldRow(
              t('Meshes'),
              select(
                [
                  ['deforming', t('For bending parts')],
                  ['all', t('For every part')],
                  ['none', t('None')],
                ],
                choice.meshes,
                (v) => (choice.meshes = v),
              ),
            ),
            ...fieldRow('', checkbox(t('IK for arms and legs'), choice.ik, (on) => (choice.ik = on))),
          )
        : null,
      ready ? hint(t('Check the part and side of each layer, then generate.'), { docs: 'autorig' }) : null,
    );
    const generateButton = button(t('Generate rig'), { kind: 'primary', disabled: !ready, onclick: generate });
    generateButton.dataset.tut = 'autorig:generate';
    setFooter([
      ready || problem
        ? button(t('Start over'), {
            kind: 'ghost',
            icon: 'chevron-down',
            onclick: (e) => {
              const r = e.currentTarget.getBoundingClientRect();
              popupMenu(r.left, r.bottom + 4, imports(true).map(([kind, label]) => ({ label, action: importArt(kind) })));
            },
          })
        : null,
      h('span', { class: 'float-spacer' }),
      button(t('Cancel'), { onclick: () => close() }),
      generateButton,
    ]);
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
    app.setStatus(t('Could not open {path}: {error}', { path: picked.path, error: log.errorMessage(e) }));
    return;
  }
  if (!source.animations.length) {
    app.setStatus(`${picked.path} has no animations to retarget`);
    return;
  }
  const { body, close, setFooter } = dialog({
    title: t('Retarget from {file}', { file: picked.path.split(/[\\/]/).pop() }),
    subtitle: t('Bones are matched by name, then by body part, and movement is scaled to this character.'),
    className: 'modal-wide retarget-dialog',
  });
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
      app.setStatus(t('Retargeted {animations} (scale {scale}). Undo reverts it.', { animations: reports.map((r) => r.animation).join(', '), scale: reports[0].scale.toFixed(2) }));
      close();
    } catch (e) {
      if (target.toSnapshot() !== before) app.restore(before);
      log.exception(e, { source: 'retarget' });
      app.setStatus(t('Retarget failed: {error}', { error: log.errorMessage(e) }));
      draw();
    }
  };

  const draw = () => {
    const { pairs, unmapped } = mapBones(source, target, choice.mapping);
    const byS = new Map(pairs.map((p) => [p.source, p]));
    const keyed = new Set(source.animations.filter((a) => choice.animations.has(a.name)).flatMap((a) => a.bones.map((t) => t.bone)));
    const targetOptions = [['', t('(none)')], ...target.bones.map((b) => [b.name, b.name])];
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
          h('td', { class: 'weak' }, p ? p.how : t('not matched')),
        );
      });
    const clash = [...choice.animations].filter((n) => target.animations.some((a) => a.name === n));
    fill(
      h(
        'div',
        { class: 'modal-columns' },
        h(
          'div',
          null,
          h('div', { class: 'ui-field-label' }, t('Animations')),
          h(
            'div',
            { class: 'checklist' },
            source.animations.map((a) =>
              checkbox(a.name, choice.animations.has(a.name), (on) => {
                if (on) choice.animations.add(a.name);
                else choice.animations.delete(a.name);
                draw();
              }),
            ),
          ),
        ),
        fields(
          ...fieldRow(
            t('Rotations'),
            select(
              [
                ['relative', t('Relative to each rest pose')],
                ['world', t('Match world directions')],
              ],
              choice.mode,
              (v) => (choice.mode = v),
            ),
          ),
          ...fieldRow(
            t('Movement scale'),
            h('input', {
              type: 'number',
              step: '0.05',
              min: '0.01',
              class: 'frame-input',
              value: (choice.scale ?? auto).toFixed(2),
              onchange: (e) => (choice.scale = Number(e.target.value) > 0 ? Number(e.target.value) : null),
            }),
            h('span', { class: 'ui-field-label' }, t('auto {scale}', { scale: auto.toFixed(2) })),
          ),
          ...(clash.length ? fieldRow('', checkbox(t('Replace {names}', { names: clash.join(', ') }), choice.replace, (on) => ((choice.replace = on), draw()))) : []),
        ),
      ),
      h('div', { class: 'autorig-table' }, h('table', null, h('thead', null, h('tr', null, h('th', null, t('Source bone')), h('th', null, t('This character')), h('th', null, t('Matched by')))), h('tbody', null, rows))),
      unmapped.some((i) => keyed.has(i)) ? hint(t('Keys of unmatched bones are left out.')) : null,
    );
    setFooter([
      button(t('Cancel'), { onclick: () => close() }),
      button(t('Retarget'), { kind: 'primary', disabled: !choice.animations.size || (clash.length > 0 && !choice.replace), onclick: run }),
    ]);
  };
  draw();
}

