// Tree-item identity and best-effort reads of Bellissima's (untyped) internals.

import { composedParent, walkDescendantsComposed } from './dom';
import { ENTITY_TYPE_DOCUMENT } from './constants';

// Bellissima tree-item wrappers expose their data via these properties. The
// shape is NOT part of any public contract — we read it best-effort. Modelled
// as an intersection with Element so the helpers stay DOM-typed.
export type AnyTreeItem = Element & {
  props?: { item?: { unique?: string | null; parent?: { unique?: string | null } } };
  api?: { unique?: string | null };
  _item?: { unique?: string | null };
  toggleChildren?: () => void;
};

export function isTreeItem(el: unknown): el is AnyTreeItem {
  const node = el as Element | null;
  if (!node || node.nodeType !== 1) return false;
  if (node.tagName !== 'UMB-TREE-ITEM') return false;
  // Lit's default @property() reflection lowercases the property name without
  // inserting hyphens, so `entityType` reflects to `entitytype`. Some
  // versions / explicit annotations may use kebab-case `entity-type`. Match
  // both. The kebab variant doesn't exist in 17.0.0 and was the bug that
  // made an early version of this script find zero tree items.
  const et = node.getAttribute('entitytype') ?? node.getAttribute('entity-type');
  return et === ENTITY_TYPE_DOCUMENT;
}

export function readUnique(el: AnyTreeItem): string | null {
  // Primary: el.props.item.unique. The wrapper's `props` is the props
  // object passed to the inner kind-element; `item` is the nested tree-item
  // descriptor that holds .unique, .name, .entityType, .parent.
  const u = el.props?.item?.unique
    ?? el.api?.unique
    ?? el._item?.unique
    ?? el.getAttribute?.('data-unique');
  return u ?? null;
}

export function readParentUnique(el: AnyTreeItem): string | null {
  // Top-level items have parent.unique === null (entityType: 'document-root').
  // Property is `parent.unique`, regardless of whether parent is null or a guid.
  const parent = el.props?.item?.parent;
  if (parent !== undefined) {
    return parent.unique ?? null;
  }
  // Fallback: walk up the composed tree.
  let cur = composedParent(el);
  while (cur) {
    if (isTreeItem(cur)) return readUnique(cur);
    cur = composedParent(cur);
  }
  return null;
}

// Walk the wrapper's nested shadow + light DOM and set draggable=true on
// every element descendant. The visible row is composed from many nested
// elements (kind-element → uui-menu-item → its shadow row markup with
// slots, anchors, buttons, etc.). Without draggable=true ALL the way down,
// pointerdown over the label area lands on a non-draggable inner element
// and the browser's drag heuristic doesn't always ascend cleanly past it —
// resulting in "drag only works from the empty left margin" symptom.
//
// Sledgehammer is the right tool: draggable on a non-row element is
// harmless (events still bubble to the same handlers via composed path);
// draggable missing is the failure mode we want to avoid.
export function propagateDraggable(wrapperEl: Element): void {
  function visit(node: Element): void {
    if (!node || node.nodeType !== 1) return;
    if (node.tagName !== 'SLOT') {
      try { node.setAttribute('draggable', 'true'); } catch { /* readonly host attribute */ }
    }
    for (const c of node.children) visit(c);
    if (node.shadowRoot) {
      for (const c of node.shadowRoot.children) visit(c);
    }
  }
  // <umb-tree-item> in 17.0.0 doesn't use shadow DOM — it renders the inner
  // <umb-document-tree-item> as a LIGHT-DOM child. Start from light children
  // first; fall through to shadow if a future Bellissima version puts it there.
  for (const c of wrapperEl.children) visit(c);
  if (wrapperEl.shadowRoot) {
    for (const c of wrapperEl.shadowRoot.children) visit(c);
  }
}

export function findVisualParentTreeItem(itemEl: Element): AnyTreeItem | null {
  // Returns the enclosing tree-item element (if at depth ≥ 1) or null (if
  // the item is at tree root).
  let cur = composedParent(itemEl);
  while (cur) {
    if (isTreeItem(cur)) return cur;
    cur = composedParent(cur);
  }
  return null;
}

export function findEnclosingTreeItemComposed(itemEl: Element | null): AnyTreeItem | null {
  // Returns the tree-item wrapper that ENCLOSES itemEl, walking up through
  // shadow boundaries. Includes itemEl itself if it is one.
  let cur: Element | null = itemEl;
  while (cur) {
    if (isTreeItem(cur)) return cur;
    cur = composedParent(cur);
  }
  return null;
}

export function findTreeItemByUnique(unique: string): AnyTreeItem | null {
  // Walk the composed tree (across shadow boundaries) looking for the
  // wrapper whose props.item.unique matches.
  let found: AnyTreeItem | null = null;
  walkDescendantsComposed(document.documentElement, (el) => {
    if (found) return;
    if (isTreeItem(el) && readUnique(el) === unique) found = el;
  });
  return found;
}

export function listTreeItemsInOrder(): AnyTreeItem[] {
  // Enumerate all visible document tree-items in composed DOM order, which
  // matches their visual top-to-bottom order in the rendered tree. Used by the
  // keyboard "grab & place" path to build its candidate list.
  const out: AnyTreeItem[] = [];
  walkDescendantsComposed(document.documentElement, (el) => {
    if (isTreeItem(el)) out.push(el);
  });
  return out;
}
