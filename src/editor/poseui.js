// SPDX-License-Identifier: MIT OR Apache-2.0
// Pose library and facial controllers in the inspector: save poses of the selected bones (with
// the images their slots show), apply them at any amount, and drive faces with sliders that blend
// between two poses. In Animate mode applying sets keys at the current frame.

import { applyAmount, blendPoses, capturePose } from '../core/poses.js';
import { Mode } from './app.js';
import * as edit from './edit.js';
import { h, select, textField } from './widgets.js';
import { has } from './workspaces.js';
import { frameLevels, tracksOf } from './audio.js';
import { FPS } from './app.js';
import { t } from './i18n.js';

/** Section state that survives panel rebuilds. */
const ui = { open: false, name: '', amount: 1, controllerName: '', controllerTo: '' };

/** Writes blend targets: setup pose in Setup mode, keys at the current frame in Animate mode. */
function write(app, targets) {
  for (const [bone, t] of targets.bones) {
    if (app.mode === Mode.Setup) app.doc.bones[bone].setup = { ...app.doc.bones[bone].setup, ...t };
    else edit.keyBoneTransform(app, bone, t);
  }
  for (const [slot, name] of targets.slots) {
    if (app.mode === Mode.Setup) app.doc.slots[slot].attachment = name;
    else edit.setSlotAttachment(app, slot, name);
  }
  app.changed();
}

function uniquePoseName(app, base) {
  let name = base.trim() || 'pose';
  for (let i = 2; app.doc.poses.some((p) => p.name === name); i++) name = `${base.trim() || 'pose'} ${i}`;
  return name;
}

function savePose(app, name) {
  const selected = app.selectedBones();
  const bones = selected.length ? selected : app.doc.bones.map((_, i) => i);
  const set = new Set(bones);
  const slots = app.doc.slots.map((s, i) => (set.has(s.bone) ? i : -1)).filter((i) => i >= 0);
  const pose = capturePose(app.doc, app.pose(), uniquePoseName(app, name), bones, slots);
  app.doc.poses.push(pose);
  app.setStatus(t("Saved pose '{name}': {bones} bone(s), {slots} slot(s)", { name: pose.name, bones: bones.length, slots: slots.length }));
}

function poseRow(app, pose, index) {
  return h(
    'div',
    { class: 'pose-row' },
    h('span', { class: 'pose-name', title: `${Object.keys(pose.bones).length} bones, ${Object.keys(pose.slots).length} slots` }, pose.name),
    h(
      'button',
      {
        class: 'small',
        title: app.mode === Mode.Animate ? t('Key this pose at the current frame') : t('Set the setup pose to this pose'),
        onclick: () => {
          write(app, applyAmount(app.doc, app.pose(), pose, ui.amount));
          app.setStatus(t("Applied pose '{name}'", { name: pose.name }) + (ui.amount < 1 ? t(' at {percent}%', { percent: Math.round(ui.amount * 100) }) : '') + (app.mode === Mode.Animate ? t(' as keys') : ''));
        },
      },
      t('Apply'),
    ),
    h(
      'button',
      {
        class: 'small',
        title: t('Replace with the current pose of the same bones'),
        onclick: () => {
          const bones = Object.keys(pose.bones).map((n) => app.doc.bones.findIndex((b) => b.name === n)).filter((i) => i >= 0);
          const slots = Object.keys(pose.slots).map((n) => app.doc.slots.findIndex((s) => s.name === n)).filter((i) => i >= 0);
          app.doc.poses[index] = capturePose(app.doc, app.pose(), pose.name, bones, slots);
          app.setStatus(t("Updated pose '{name}'", { name: pose.name }));
        },
      },
      t('Update'),
    ),
    h(
      'button',
      {
        class: 'small',
        title: t('Delete this pose'),
        onclick: () => {
          app.doc.poses.splice(index, 1);
          app.doc.controllers = app.doc.controllers.filter((c) => c.to !== pose.name && c.from !== pose.name);
          app.changed();
        },
      },
      '✕',
    ),
  );
}

/** Setup values when a Setup mode drag started (the drag edits them). */
let dragStart = null;

function snapshotSetup(app) {
  return {
    bones: new Map(app.doc.bones.map((b, i) => [i, { ...b.setup }])),
    slots: new Map(app.doc.slots.map((s, i) => [i, s.attachment])),
  };
}

function controllerRow(app, c, index) {
  const poses = app.doc.poses;
  const find = (name) => poses.find((p) => p.name === name) ?? null;
  const begin = () => (dragStart = app.mode === Mode.Setup ? snapshotSetup(app) : null);
  const slider = h('input', {
    type: 'range',
    min: 0,
    max: 1,
    step: 0.01,
    value: c.value,
    title: app.mode === Mode.Animate ? t('Drag to key the blend at the current frame') : t('Drag to blend the setup pose'),
    onpointerdown: begin,
    onkeydown: (e) => {
      e.stopPropagation();
      if (!dragStart) begin();
    },
    onchange: () => (dragStart = null),
    oninput: (e) => {
      if (app.mode === Mode.Setup && !dragStart) begin();
      c.value = Number(e.target.value);
      const to = find(c.to);
      if (to) write(app, blendPoses(app.doc, app.pose(), c.from ? find(c.from) : null, to, c.value, app.mode === Mode.Setup ? dragStart : null));
    },
  });
  const options = [['', 'setup pose'], ...poses.map((p) => [p.name, p.name])];
  return h(
    'div',
    { class: 'controller' },
    h('div', { class: 'controller-head' }, h('strong', null, c.name), h('span', { class: 'small weak' }, ` ${Math.round(c.value * 100)}%`), h('button', { class: 'small', title: t('Key this control from the loudness of the animation\'s audio (mouth open on speech)'), onclick: () => lipSync(app, c) }, t('Lip-sync')), h('button', { class: 'small', title: t('Delete this controller'), onclick: () => (app.doc.controllers.splice(index, 1), app.changed()) }, '✕')),
    slider,
    h(
      'div',
      { class: 'controller-poses small' },
      select(options, c.from ?? '', (v) => ((c.from = v || null), app.changed())),
      ' → ',
      select(options.slice(1), c.to, (v) => ((c.to = v), app.changed())),
    ),
  );
}

/** Keys control `c` on every frame of the current animation from its audio's loudness. */
function lipSync(app, c) {
  const anim = app.currentAnimation();
  const track = anim && tracksOf(app.doc, anim.name)[0];
  if (app.mode !== Mode.Animate || !track) return app.setStatus(t('Lip-sync needs Animate mode and an audio track on this animation (Import audio)'));
  const to = app.doc.poses.find((p) => p.name === c.to);
  const from = c.from ? app.doc.poses.find((p) => p.name === c.from) : null;
  if (!to) return app.setStatus(t("Pose '{name}' not found", { name: c.to }));
  const frames = Math.max(1, Math.round(anim.duration * FPS)) + 1;
  const levels = frameLevels(track, FPS, frames);
  const time = app.time;
  for (let f = 0; f < frames; f++) {
    app.time = f / FPS;
    write(app, blendPoses(app.doc, app.pose(), from, to, levels[f]));
  }
  app.time = time;
  app.setStatus(t("Lip-sync: keyed '{name}' on {frames} frames from {sound}", { name: c.name, frames, sound: track.sound }));
}

/** The inspector section. */
export function posesUi(app) {
  const doc = app.doc;
  const selected = app.selectedBones().length;
  const faces = has(app, 'faceControls');
  const details = h(
    'details',
    { class: 'poses', open: ui.open, ontoggle: (e) => (ui.open = e.target.open) },
    h('summary', null, h('strong', null, faces ? t('Poses & face controls') : t('Poses')), h('span', { class: 'small weak' }, ' ' + t('{count} pose(s)', { count: doc.poses.length }) + (faces ? ', ' + t('{count} control(s)', { count: doc.controllers.length }) : ''))),
    h(
      'div',
      { class: 'pose-save' },
      textField(ui.name, (v) => (ui.name = v), { width: '100%' }),
      h('button', { title: selected ? t('Save the pose of the {count} selected bone(s) and the images of their slots', { count: selected }) : t('Save the pose of every bone'), onclick: () => savePose(app, ui.name || (selected ? 'pose' : 'full pose')) }, selected ? t('Save pose ({count})', { count: selected }) : t('Save pose (all)')),
    ),
    doc.poses.length
      ? [
          h(
            'div',
            { class: 'pose-amount small' },
            t('Apply at '),
            h('input', { type: 'range', min: 0.05, max: 1, step: 0.05, value: ui.amount, oninput: (e) => (ui.amount = Number(e.target.value)) }),
            ` ${Math.round(ui.amount * 100)}%`,
          ),
          doc.poses.map((p, i) => poseRow(app, p, i)),
        ]
      : h('div', { class: 'small weak' }, t('Pose bones (select some to save only those), name the pose and save it. Mouth shapes and other image swaps are saved with it.')),
    faces && h('div', { class: 'section-title' }, t('Face controls')),
    faces && doc.controllers.map((c, i) => controllerRow(app, c, i)),
    !faces
      ? null
      : doc.poses.length
      ? h(
          'div',
          { class: 'pose-save' },
          textField(ui.controllerName, (v) => (ui.controllerName = v), { width: '100%' }),
          select(
            doc.poses.map((p) => [p.name, p.name]),
            doc.poses.some((p) => p.name === ui.controllerTo) ? ui.controllerTo : doc.poses[0].name,
            (v) => (ui.controllerTo = v),
          ),
          h(
            'button',
            {
              title: 'A slider from the setup pose to this pose',
              onclick: () => {
                const to = doc.poses.some((p) => p.name === ui.controllerTo) ? ui.controllerTo : doc.poses[0].name;
                doc.controllers.push({ name: ui.controllerName.trim() || to, from: null, to, value: 0 });
                ui.controllerName = '';
                app.changed();
              },
            },
            t('Add control'),
          ),
        )
      : h('div', { class: 'small weak' }, t('Save poses first, then add sliders that blend to them (for example brows up, eyes closed, mouth open).')),
  );
  return [h('hr'), details];
}
