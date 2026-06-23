// Module-level shadow-root observation.
//
// Observation runs at module level so it works even before the Lit host is
// constructed; when the host mounts it registers itself (setHost) and we
// re-sweep already-captured roots to attach handlers retroactively.

import { walkDescendantsComposed } from './dom';
import { isTreeItem, propagateDraggable, findEnclosingTreeItemComposed } from './tree-item';
import { isCollectionEntry, attachCollectionEntry } from './collection';
import { PATCH_FLAG } from './constants';

// The host (the Lit element) implements this; the observer needs attachItem
// for tree items. Collection entries are made draggable directly by the
// observer (no per-entry host state), so they don't need a host hook.
export interface DndHost {
  attachItem(el: Element): void;
}

const observedRoots = new WeakSet<object>();
const knownRoots: Array<Document | ShadowRoot> = []; // includes document; for re-sweep when host mounts

// Singleton host registered by the Lit element on connectedCallback. When
// the observer finds a tree-item before the host is up, it queues; when the
// host registers, it re-sweeps known roots.
let host: DndHost | null = null;

export function setHost(h: DndHost | null): void {
  host = h;
  if (h) {
    // Re-sweep all known roots so already-rendered tree items get bound.
    for (const root of knownRoots) {
      sweepSubtree(root);
    }
  }
}

function sweepSubtree(root: Node | null): void {
  if (!root) return;
  const start: Node = root.nodeType === 9 ? (root as Document).documentElement : root;
  walkDescendantsComposed(start, (el) => {
    if (isTreeItem(el)) {
      host?.attachItem(el);
      // Re-run draggable propagation on every sweep — Lit re-renders the
      // wrapper's shadow tree async, so the inner kind-element / uui-menu-item
      // may not have existed at first attachItem. propagateDraggable is
      // idempotent (setAttribute on already-set attribute is a no-op).
      propagateDraggable(el);
    }
    // Collection (list-view) rows/cards: make them draggable so a move can
    // start from a node that the tree never renders. Idempotent.
    if (isCollectionEntry(el)) {
      attachCollectionEntry(el);
    }
    if (el.shadowRoot && !observedRoots.has(el.shadowRoot)) {
      observeRoot(el.shadowRoot);
    }
  });
}

export function observeRoot(root: Document | ShadowRoot | null): void {
  if (!root || observedRoots.has(root)) return;
  observedRoots.add(root);
  knownRoots.push(root);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      // Watch attribute changes on existing tree-items in case props/entity-type
      // gets bound after initial mount.
      if (m.type === 'attributes' && isTreeItem(m.target)) {
        host?.attachItem(m.target);
        continue;
      }
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (isTreeItem(node)) host?.attachItem(node);
        if (isCollectionEntry(node)) attachCollectionEntry(node);
        sweepSubtree(node);
        // If the added node lives inside an existing attached wrapper's
        // shadow tree, re-propagate draggable on that wrapper. Lit renders
        // the inner kind-element + uui-menu-item async, so elements that
        // need draggable=true frequently appear AFTER the wrapper's initial
        // attachItem.
        const enclosing = findEnclosingTreeItemComposed(node);
        if (enclosing) propagateDraggable(enclosing);
      }
    }
  });
  observer.observe(root, {
    childList: true,
    subtree: true,
    attributes: true,
    // Lit reflects `entityType` to lowercase `entitytype` (no hyphen) in 17.0.0.
    // Watch both forms in case of version drift.
    attributeFilter: ['entitytype', 'entity-type'],
  });

  sweepSubtree(root);
}

// (1) Patch attachShadow at module load. Captures every shadow root from
// here on, open OR closed (returned reference is the same regardless of {mode}).
// (2) Begin observing the document. Existing open shadow roots created before
// this script loaded are unreachable (closed) or already-observed (open,
// attached as descendants), so we walk now to catch them.
const patchFlags = window as unknown as Record<string, boolean>;
if (!patchFlags[PATCH_FLAG]) {
  patchFlags[PATCH_FLAG] = true;

  const origAttachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (this: Element, opts: ShadowRootInit): ShadowRoot {
    const root = origAttachShadow.call(this, opts);
    try { observeRoot(root); }
    catch (err) { console.warn('[lait-content-drag-drop] observeRoot failed:', err); }
    return root;
  };

  observeRoot(document);
}
