// SPDX-License-Identifier: MIT OR Apache-2.0
// Tree helpers with no DOM (tested under Node): which bones the Find box keeps, and which bones a
// dragged bone may be dropped on as its new parent.

/**
 * Bones to show for a Find query: those whose names (or whose slots' names) contain `query`
 * (case-insensitive), with every bone above them. Null when the query is empty (show everything).
 */
export function treeMatches(doc, query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const keep = new Set();
  const mark = (b) => {
    for (let x = b; x !== null && x !== undefined && !keep.has(x); x = doc.bones[x].parent) keep.add(x);
  };
  doc.bones.forEach((b, i) => b.name.toLowerCase().includes(q) && mark(i));
  doc.slots.forEach((s) => s.name.toLowerCase().includes(q) && mark(s.bone));
  return keep;
}

/** Whether `parent` can take `bone`: not the root, not itself, not one of its children, not its parent already. */
export function canReparent(doc, bone, parent) {
  return bone !== 0 && parent !== bone && !doc.isDescendant(parent, bone) && doc.bones[bone]?.parent !== parent;
}
