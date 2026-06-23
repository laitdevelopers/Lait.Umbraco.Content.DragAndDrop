// Cycle guard: prevent dropping a node into itself or one of its descendants.

import { walkDescendantsComposed } from './dom';
import { isTreeItem, readUnique } from './tree-item';

export function collectDescendantUniques(rootEl: Element): Set<string> {
  // Walk descendants in BOTH light DOM and shadow DOM. Tree-items in
  // currently-collapsed branches aren't rendered into the DOM, so a cycle
  // through them won't be caught here — that's a known limitation. Server
  // is the authoritative check.
  const out = new Set<string>();
  walkDescendantsComposed(rootEl, (el) => {
    if (el !== rootEl && isTreeItem(el)) {
      const u = readUnique(el);
      if (u) out.add(u);
    }
  });
  return out;
}

// Pure: is `targetUnique` an illegal drop target for the dragged node —
// i.e. the node itself or one of its (rendered) descendants?
export function isBlockedTarget(
  targetUnique: string,
  sourceUnique: string,
  descendantUniques: Set<string>,
): boolean {
  return targetUnique === sourceUnique || descendantUniques.has(targetUnique);
}
