// SPDX-License-Identifier: MIT OR Apache-2.0
// Selecting bones by their relation to the selection (Edit ▸ Select all bones / Select related, the
// tree's menu). No DOM and no app.js: tested under Node with a stand-in app.

import { statusMessage } from './i18n.js';
import { branchBones, isBoneHidden, isBoneLocked } from './visibility.js';

/**
 * Selects bones related to the selection: 'all' (every visible, unlocked bone), 'parent', 'children'
 * (the direct ones) or 'branch' (every bone below). Returns how many are selected.
 */
export function selectRelated(app, how) {
  const doc = app.doc;
  const usable = (i) => !isBoneHidden(doc, i) && !isBoneLocked(doc, i);
  const from = app.selectedBones();
  const slot = app.sel?.slot ?? null;
  const base = from.length ? from : slot !== null ? [doc.slots[slot].bone] : [];
  let out = [];
  if (how === 'all') out = doc.bones.map((_, i) => i).filter(usable);
  else if (how === 'parent') out = [...new Set(base.map((b) => doc.bones[b].parent).filter((p) => p !== null))];
  else if (how === 'children') out = doc.bones.flatMap((b, i) => (base.includes(b.parent) ? [i] : []));
  else if (how === 'branch') out = [...new Set(base.flatMap((b) => branchBones(doc, b)))];
  if (!out.length) {
    app.setStatus(how === 'parent' ? statusMessage('The root bone has no parent') : how === 'all' ? statusMessage('Nothing to select') : statusMessage('No bones below the selection'));
    return 0;
  }
  app.selectBones(out, how === 'branch' ? base[0] : out[0]);
  app.setStatus(out.length === 1 ? statusMessage('1 bone selected') : statusMessage('{count} bones selected', { count: out.length }));
  return out.length;
}
