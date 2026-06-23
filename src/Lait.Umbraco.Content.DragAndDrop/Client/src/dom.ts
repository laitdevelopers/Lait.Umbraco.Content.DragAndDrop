// Generic composed-DOM traversal helpers — walk through shadow boundaries.
//
// Bellissima nests every UI element in shadow DOM, so plain
// document.querySelectorAll never sees the tree. These helpers cross shadow
// roots so tree-items can be found wherever they're rendered.

export function composedParent(el: Node | null): Element | null {
  // Walk through shadow boundaries: an element's host's parent is its
  // composed parent.
  if (!el) return null;
  if (el.parentElement) return el.parentElement;
  const root = el.getRootNode?.();
  if (root && (root as ShadowRoot).host) return (root as ShadowRoot).host;
  return null;
}

export function walkDescendantsComposed(root: Node | null, visit: (el: Element) => void): void {
  if (!root || root.nodeType !== 1) return;
  const el = root as Element;
  visit(el);
  for (const child of el.children) {
    walkDescendantsComposed(child, visit);
  }
  if (el.shadowRoot) {
    for (const child of el.shadowRoot.children) {
      walkDescendantsComposed(child, visit);
    }
  }
}
