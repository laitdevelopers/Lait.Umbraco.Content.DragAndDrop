// Drop-zone geometry: which third of a row the cursor is over.

export type DropZone = 'before' | 'into' | 'after';

export function getRowRect(el: Element): DOMRect {
  // The wrapper's bounding rect includes nested descendants when expanded,
  // skewing the third-of-height calc. Drill in to find the visible row strip.
  //
  // 17.0.0 structure: <umb-tree-item> has <umb-document-tree-item> as a
  // LIGHT-DOM child; that has its own shadow with a <uui-menu-item>;
  // uui-menu-item's shadow contains the row body.
  const inner = el.querySelector(':scope > umb-document-tree-item, :scope > umb-default-tree-item')
    ?? el.shadowRoot?.querySelector('umb-document-tree-item, umb-default-tree-item');
  const menuItem = inner?.shadowRoot?.querySelector('uui-menu-item');
  const rowBody = menuItem?.shadowRoot?.querySelector('#menu-item, [id="menu-item"], button, .menu-item-body');
  if (rowBody) return rowBody.getBoundingClientRect();
  if (menuItem) {
    const r = menuItem.getBoundingClientRect();
    return new DOMRect(r.left, r.top, r.width, Math.min(r.height, 32));
  }
  const r = el.getBoundingClientRect();
  return new DOMRect(r.left, r.top, r.width, Math.min(r.height, 32));
}

// Pure: classify the cursor position within a row into one of the three zones.
// Top third → 'before' (sibling above), bottom third → 'after' (sibling below),
// middle → 'into' (drop as child).
export function computeDropZone(rectTop: number, rectHeight: number, clientY: number): DropZone {
  const offset = clientY - rectTop;
  const third = rectHeight / 3;
  if (offset < third) return 'before';
  if (offset > rectHeight - third) return 'after';
  return 'into';
}

export function getDropZone(targetEl: Element, clientY: number): DropZone {
  const rect = getRowRect(targetEl);
  return computeDropZone(rect.top, rect.height, clientY);
}
