// Sibling listing, reorder math, and optimistic DOM reordering.

import { walkDescendantsComposed } from './dom';
import { isTreeItem, readUnique, readParentUnique, type AnyTreeItem } from './tree-item';
import type { DropZone } from './drop-zone';

export function listSiblingsInOrder(parentTreeItem: AnyTreeItem | null): string[] {
  // Returns the tree-children of parentTreeItem (or the tree root, if
  // parentTreeItem is null) in their current visual order.
  // Children may live anywhere inside the parent's composed tree (shadow
  // roots etc.), filtered by parent-unique match.
  const parentUnique = parentTreeItem ? readUnique(parentTreeItem) : null;
  const out: string[] = [];
  // NOTE: at tree root parentTreeItem is null, so we walk `document` (nodeType
  // 9); walkDescendantsComposed short-circuits on it and yields no siblings.
  // Preserved as-is from the original — root-level reorder relies on the
  // server/reload path rather than the rendered-sibling list.
  const rootToWalk: Node = parentTreeItem ?? document;
  walkDescendantsComposed(rootToWalk, (el) => {
    if (el !== parentTreeItem && isTreeItem(el)) {
      const itemParent = readParentUnique(el);
      if (itemParent === parentUnique) {
        const u = readUnique(el);
        if (u) out.push(u);
      }
    }
  });
  return out;
}

// Pure: compute the new ordered list of child uniques after moving
// `sourceUnique` adjacent to `targetUnique`. `siblings` is the current order
// (may include the source). Returns null if `targetUnique` is not among the
// source-excluded siblings (target missing, or target === source).
export function computeReorder(
  siblings: string[],
  sourceUnique: string,
  targetUnique: string,
  zone: DropZone,
): string[] | null {
  const without = siblings.filter((u) => u !== sourceUnique);
  const targetIdx = without.indexOf(targetUnique);
  if (targetIdx === -1) return null;
  const insertAt = zone === 'before' ? targetIdx : targetIdx + 1;
  return [...without.slice(0, insertAt), sourceUnique, ...without.slice(insertAt)];
}

// For SAME-PARENT REORDER we move the source wrapper directly in the DOM
// rather than dispatching a Bellissima reload event. Reload rebuilds the
// entire affected branch (slow, flashes the whole tree). Direct DOM
// re-ordering is instant and visually identical.
//
// Cross-parent moves (into / cross-parent slot) cannot use optimistic DOM
// because Bellissima's expand-chevron and child indentation are driven by
// `props.item.hasChildren` in its data store — DOM mutation alone doesn't
// change that. Those cases dispatch reload events instead.
export function optimisticReorder(
  sourceEl: Element | null,
  targetEl: Element | null,
  zone: DropZone,
): void {
  if (!sourceEl || !targetEl) return;
  if (sourceEl === targetEl) return;
  const parent = targetEl.parentNode;
  if (!parent) return;
  if (zone === 'before') {
    parent.insertBefore(sourceEl, targetEl);
  } else {
    parent.insertBefore(sourceEl, targetEl.nextSibling);
  }
}
