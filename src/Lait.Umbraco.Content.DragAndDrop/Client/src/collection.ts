// Collection (list-view) drag SOURCE support.
//
// The original package only let you drag tree-items. But a document whose
// document-type uses a *collection* (list view) does NOT render its children
// in the content tree — the children only appear in the collection table/grid
// inside the workspace. That makes those children impossible to reorganise by
// dragging in the tree (you can't drag what isn't there).
//
// This module recognises a collection entry as a drag SOURCE. The existing
// tree drop pipeline (dnd-host) is unchanged on the target side: it already
// keys every move off a single source GUID, so once we can start a drag from
// a collection row/card and hand it that GUID, dropping onto any tree node
// "just works" (move + sort + reload).
//
// How a collection entry exposes its identity (verified against Umbraco 17):
//   - Table view  → <umb-document-table-column-name> renders
//                    <uui-button href=".../document/edit/<guid>">.
//   - Card/grid   → <umb-document-collection-item-card> renders
//                    <uui-card-content-node href=".../document/edit/<guid>">.
// In BOTH cases the workspace edit href ends in `document/edit/<unique>`, so we
// read the unique straight out of that href — robust against internal markup
// churn. As a fallback we read the `.item`/`.value.item` property the elements
// expose.

import { walkDescendantsComposed } from './dom';
import { composedParent } from './dom';
import { COLLECTION_ATTACHED_FLAG } from './constants';

// Tag names of the "one entry" container in each collection view. We mark
// these draggable and treat them as the drag source.
const COLLECTION_ENTRY_TAGS = new Set([
  'UUI-TABLE-ROW', // table view: one row per item
  'UMB-DOCUMENT-COLLECTION-ITEM-CARD', // card/grid view: one card per item
  'UUI-CARD-CONTENT-NODE', // the card's inner link host (also a useful entry)
]);

// `document/edit/<guid>` — capture the unique that follows. Permissive on the
// guid shape; stops at the next path/query/hash separator.
const EDIT_HREF_RE = /document\/edit\/([^/?#]+)/i;

// Pure: pull the document unique out of a workspace edit href/URL, or null.
// Handles relative (`section/content/workspace/document/edit/<g>`) and absolute
// URLs, and ignores trailing path segments / query / hash. Kept separate so the
// parsing — the bit most likely to drift with Umbraco's router — is unit-tested.
export function parseEditHrefUnique(href: string | null | undefined): string | null {
  if (!href) return null;
  const m = EDIT_HREF_RE.exec(href);
  return m ? m[1] : null;
}

export function isCollectionEntry(el: unknown): el is HTMLElement {
  const node = el as Element | null;
  if (!node || node.nodeType !== 1) return false;
  return COLLECTION_ENTRY_TAGS.has(node.tagName);
}

// True if `node` sits inside a collection view (used to avoid mistaking an
// unrelated edit-link — e.g. a breadcrumb — for a collection entry).
export function isInsideCollection(node: Element | null): boolean {
  let cur: Element | null = node;
  while (cur) {
    const t = cur.tagName;
    if (t === 'UMB-COLLECTION' || (t.startsWith('UMB-') && t.includes('COLLECTION'))) {
      return true;
    }
    cur = composedParent(cur);
  }
  return false;
}

// Read the document unique for a collection entry, best-effort.
export function resolveCollectionUnique(entryEl: Element): string | null {
  // 1) Primary: an edit-link href anywhere inside the entry's composed subtree.
  let unique: string | null = null;
  walkDescendantsComposed(entryEl, (el) => {
    if (unique) return;
    const parsed = parseEditHrefUnique(el.getAttribute?.('href'));
    if (parsed) unique = parsed;
  });
  if (unique) return unique;

  // 2) Fallback: the element's bound data. Card exposes `.item`, the table's
  //    name column exposes `.value.item`. Read both shapes defensively.
  const anyEl = entryEl as Element & {
    item?: { unique?: string | null };
    value?: { item?: { unique?: string | null } };
  };
  return anyEl.item?.unique ?? anyEl.value?.item?.unique ?? null;
}

// Mark a collection entry draggable so a drag can initiate from anywhere on the
// row/card (not only the name link, which is a draggable <a> by default).
// Idempotent.
export function attachCollectionEntry(entryEl: Element): void {
  const html = entryEl as HTMLElement;
  if (html.dataset[COLLECTION_ATTACHED_FLAG]) return;
  // Only bother if we can actually resolve a unique — otherwise it's not a
  // document entry we can move (e.g. a header row).
  if (!resolveCollectionUnique(entryEl)) return;
  html.dataset[COLLECTION_ATTACHED_FLAG] = '1';
  try { entryEl.setAttribute('draggable', 'true'); } catch { /* ignore readonly */ }
}

// Read the display name of a collection entry, best-effort, for the move toast.
// The name link carries it as a `label`/`name` property (table button / card
// content node); fall back to its attribute or text content.
export function resolveCollectionName(entryEl: Element): string | null {
  let name: string | null = null;
  walkDescendantsComposed(entryEl, (el) => {
    if (name) return;
    const href = el.getAttribute?.('href');
    if (!href || !parseEditHrefUnique(href)) return;
    const anyEl = el as Element & { label?: string; name?: string };
    const candidate =
      anyEl.label ?? anyEl.name ?? el.getAttribute?.('label') ?? el.getAttribute?.('title') ?? el.textContent ?? '';
    const trimmed = candidate.trim();
    if (trimmed) name = trimmed;
  });
  return name;
}

export interface CollectionDragSource {
  el: HTMLElement; // the entry container (for visual feedback)
  unique: string;
  name: string | null; // display name, for the "moved" feedback toast
}

// Given a drag event, find the collection entry it started from (if any).
// Walks the composed path so it works through shadow boundaries.
export function findCollectionDragSource(event: Event): CollectionDragSource | null {
  const path = event.composedPath?.() ?? [];
  let entry: HTMLElement | null = null;
  let inCollection = false;
  for (const node of path) {
    if (!(node instanceof Element)) continue;
    if (!entry && isCollectionEntry(node)) entry = node as HTMLElement;
    const t = node.tagName;
    if (t === 'UMB-COLLECTION' || (t.startsWith('UMB-') && t.includes('COLLECTION'))) {
      inCollection = true;
    }
  }
  if (!entry || !inCollection) return null;
  const unique = resolveCollectionUnique(entry);
  if (!unique) return null;
  return { el: entry, unique, name: resolveCollectionName(entry) };
}

// Parse the unique of the document whose workspace is currently open from the
// URL. When you're viewing a node's collection, the location is that parent
// node's workspace edit URL (`.../document/edit/<parentUnique>`), so this is
// the collection's parent — exactly the branch we must reload afterwards so
// the moved item disappears from the list.
export function readOpenDocumentUnique(): string | null {
  return parseEditHrefUnique(window.location.href);
}
