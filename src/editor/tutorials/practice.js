// SPDX-License-Identifier: MIT OR Apache-2.0
// Practice material for the tutorials: Rigbytron taken apart into loose layers, exactly what
// importing a layered PSD gives (one image per body part, nothing connected yet), and the same
// character rigged by AutoRig. Built from the bundled demo, so lessons never need a file dialog.

import { autoRig } from '../../core/autorig.js';
import { toAffine } from '../../core/math.js';
import { Skeleton } from '../../core/model.js';
import { Pose } from '../../core/pose.js';
import { t } from '../i18n.js';

export const PRACTICE_NAME = 'practice-character';
/** Effects and extras that are not body parts. */
const LEAVE_OUT = new Set(['slash_fx']);

/** A skeleton's visible images as loose layers on the root bone, where the setup pose shows them. */
export function looseLayers(doc) {
  const pose = new Pose(doc);
  const out = new Skeleton();
  out.name = PRACTICE_NAME;
  out.images = JSON.parse(JSON.stringify(doc.images));
  for (const slot of doc.slots) {
    if (LEAVE_OUT.has(slot.name)) continue;
    const shown = slot.attachments.find((a) => a.name === slot.attachment) ?? slot.attachments[0];
    if (!shown || shown.type !== 'region') continue;
    // Every image of the slot (an open and a closed hand) keeps its place.
    const attachments = slot.attachments
      .filter((a) => a.type === 'region')
      .map((a) => {
        const w = pose.world[slot.bone].mul(toAffine(a.offset)).decompose();
        return { ...JSON.parse(JSON.stringify(a)), offset: { x: w.x, y: w.y, rotation: w.rotation, scale_x: w.scale_x, scale_y: w.scale_y, shear_x: 0, shear_y: w.shear_y ?? 0 } };
      });
    out.slots.push({ ...JSON.parse(JSON.stringify(slot)), bone: 0, attachments, attachment: shown.name });
  }
  return out;
}

/** The editor's image alpha, for AutoRig. */
function alphaOf(app) {
  return (name) => {
    if (app.images.alphaAt(name, 0, 0) === null) return null;
    const s = app.images.map.get(name);
    return { width: s.canvas.width, height: s.canvas.height, data: s.alpha };
  };
}

/**
 * Opens the practice character as loose layers (`rigged`: already rigged by AutoRig). Asks before
 * discarding unsaved work. Returns false when the user keeps their project.
 */
export async function openPractice(app, { rigged = false } = {}) {
  if (!(await app.confirmDiscard())) return false;
  const { doc } = await app.demoDocument();
  const layers = looseLayers(doc);
  if (rigged) autoRig(layers, alphaOf(app));
  layers.workspace = 'game';
  app.loadDocument(layers, null);
  app.saveTarget = null;
  app.mode = 'setup';
  app.tool = 'rotate';
  app.frameRequest = true;
  app.setStatus(rigged ? t('Practice character, rigged: ready to animate') : t('Practice character: loose layers, like a freshly imported PSD'));
  return true;
}

/** Whether the open project is the practice character (unrigged when `rigged` is false). */
export const isPractice = (app, rigged) => app.doc.name === PRACTICE_NAME && (rigged ? app.doc.bones.length > 1 : app.doc.bones.length === 1);
