// The controller host: a single hidden Lit element that owns the drag state,
// installs document-level (capture-phase) drag listeners, and runs the API
// calls via DocumentService. Mounted inside <umb-app> so it can consume
// UMB_NOTIFICATION_CONTEXT / UMB_ACTION_EVENT_CONTEXT.

import { LitElement } from '@umbraco-cms/backoffice/external/lit';
import { UmbElementMixin } from '@umbraco-cms/backoffice/element-api';
import { UMB_NOTIFICATION_CONTEXT } from '@umbraco-cms/backoffice/notification';
import { UMB_ACTION_EVENT_CONTEXT } from '@umbraco-cms/backoffice/action';
import { UmbRequestReloadChildrenOfEntityEvent } from '@umbraco-cms/backoffice/entity-action';
import { DocumentService } from '@umbraco-cms/backoffice/external/backend-api';
import { tryExecute } from '@umbraco-cms/backoffice/resources';

import { ATTACHED_FLAG, HOVER_EXPAND_MS, ENTITY_TYPE_DOCUMENT, DRAG_MIME } from './constants';
import { setHost } from './observer';
import {
  isTreeItem,
  readUnique,
  readParentUnique,
  propagateDraggable,
  findVisualParentTreeItem,
  findTreeItemByUnique,
  listTreeItemsInOrder,
  type AnyTreeItem,
} from './tree-item';
import { getDropZone, type DropZone } from './drop-zone';
import { collectDescendantUniques, isBlockedTarget } from './cycle-guard';
import { listSiblingsInOrder, computeReorder, optimisticReorder } from './siblings';
import { renderIndicator, hideIndicator } from './indicator';
import { showSpinner, hideSpinner } from './spinner';
import { reduceKey, type KbState, type KbCandidate } from './keyboard';
import { announce } from './announce';
import { findCollectionDragSource, readOpenDocumentUnique, type CollectionDragSource } from './collection';

interface DragState {
  sourceUnique: string;
  sourceParentUnique: string | null;
  descendantUniques: Set<string>;
  // When the drag started from a collection (list-view) row/card rather than a
  // tree item: the entry element (for visual feedback) and a flag so the move
  // pipeline skips tree-only optimistic DOM reordering.
  fromCollection?: boolean;
  sourceEl?: HTMLElement | null;
  // Display name of the dragged node, captured at drag start for the "moved" toast.
  sourceName?: string | null;
}

export class LaitContentDragDrop extends UmbElementMixin(LitElement) {
  #notifications?: typeof UMB_NOTIFICATION_CONTEXT.TYPE;
  #actionEvents?: typeof UMB_ACTION_EVENT_CONTEXT.TYPE;
  #dragState: DragState | null = null;
  #kbState: KbState | null = null;
  #movePending = false;
  #hoverTimer: ReturnType<typeof setTimeout> | null = null;
  #lastHoverTarget: AnyTreeItem | null = null;
  #globalListenersInstalled = false;

  constructor() {
    super();
    this.consumeContext(UMB_NOTIFICATION_CONTEXT, (ctx) => { this.#notifications = ctx; });
    this.consumeContext(UMB_ACTION_EVENT_CONTEXT, (ctx) => { this.#actionEvents = ctx; });
  }

  connectedCallback(): void {
    super.connectedCallback();
    setHost(this);
    this.#installGlobalListeners();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    setHost(null);
    if (this.#hoverTimer) clearTimeout(this.#hoverTimer);
  }

  attachItem(el: Element): void {
    // Listeners are installed at document level (see #installGlobalListeners),
    // capture phase, so we can't be defeated by stopPropagation upstream.
    // attachItem now only manages the visual state of the wrapper and its
    // shadow descendants — sets draggable=true so drag can initiate.
    const html = el as HTMLElement;
    if (html.dataset[ATTACHED_FLAG]) return;
    html.dataset[ATTACHED_FLAG] = '1';
    el.setAttribute('draggable', 'true');
    propagateDraggable(el);

    // Lit renders the inner <umb-document-tree-item> + uui-menu-item async,
    // so propagateDraggable above may run before the row markup exists. Watch
    // the wrapper's subtree and re-propagate on any change. Idempotent —
    // setAttribute on already-set attribute is a no-op.
    const obs = new MutationObserver(() => propagateDraggable(el));
    obs.observe(el, { childList: true, subtree: true });
  }

  #installGlobalListeners(): void {
    if (this.#globalListenersInstalled) return;
    this.#globalListenersInstalled = true;
    // Capture phase (third arg = true) ensures we run before any descendant
    // listener can stopPropagation. Bellissima / UUI dispatches its own drag
    // logic in some places (block lists, sorter) that swallows bubble-phase
    // events; capture is the only reliable surface for tree DnD.
    document.addEventListener('dragstart', (e) => {
      const el = this.#findTreeItemInPath(e);
      if (el) {
        this.#onDragStart(e, el);
        return;
      }
      // Not a tree item — maybe the drag started from a collection (list-view)
      // row/card. That's the extra capability over a plain tree-reorder package.
      const coll = findCollectionDragSource(e);
      if (coll) this.#onCollectionDragStart(e, coll);
    }, true);
    document.addEventListener('dragenter', (e) => {
      const el = this.#findTreeItemInPath(e);
      if (!el || !this.#dragState) return;
      // preventDefault on dragenter to mark the element as a valid drop target.
      e.preventDefault();
    }, true);
    document.addEventListener('dragover', (e) => {
      const el = this.#findTreeItemInPath(e);
      if (!el) {
        hideIndicator();
        return;
      }
      this.#onDragOver(e, el);
    }, true);
    document.addEventListener('dragleave', (e) => {
      const el = this.#findTreeItemInPath(e);
      if (!el) return;
      this.#onDragLeave(e, el);
    }, true);
    document.addEventListener('drop', (e) => {
      const el = this.#findTreeItemInPath(e);
      if (!el) return;
      void this.#onDrop(e, el);
    }, true);
    document.addEventListener('dragend', () => this.#onDragEnd(), true);
    // Keyboard "grab & place" reordering (ARIA APG). Capture phase so the
    // tree's own key handling (open node, expand/collapse, roving tabindex)
    // doesn't fire for the keys we own while grabbed.
    document.addEventListener('keydown', (e) => this.#onKeyDown(e), true);
  }

  #findTreeItemInPath(event: Event): AnyTreeItem | null {
    // Walk the composed path looking for the closest tree-item wrapper. The
    // browser may retarget event.target to the shadow host (umb-app); the
    // composedPath gives us the full path through shadow boundaries.
    const path = event.composedPath?.() ?? [];
    for (const node of path) {
      if (isTreeItem(node)) return node;
    }
    return null;
  }

  #onDragStart(event: DragEvent, el: AnyTreeItem): void {
    if (this.#movePending) { event.preventDefault(); return; }
    const sourceUnique = readUnique(el);
    if (!sourceUnique) {
      event.preventDefault();
      return;
    }
    const sourceParentUnique = readParentUnique(el);
    const descendantUniques = collectDescendantUniques(el);

    event.dataTransfer!.effectAllowed = 'move';
    event.dataTransfer!.setData(DRAG_MIME, sourceUnique);

    this.#dragState = { sourceUnique, sourceParentUnique, descendantUniques, sourceName: this.#targetName(el) };
  }

  // Start a drag from a collection (list-view) entry. The source document isn't
  // in the tree, so the parent is read from the open document's URL (the page
  // hosting the collection) and the descendant set is collected only if that
  // node happens to be rendered in the tree elsewhere — the server is the
  // authoritative cycle check either way. From here the existing drop pipeline
  // takes over unchanged: dropping onto a tree node moves + sorts + reloads.
  #onCollectionDragStart(event: DragEvent, source: CollectionDragSource): void {
    if (this.#movePending) { event.preventDefault(); return; }
    const sourceUnique = source.unique;
    const sourceParentUnique = readOpenDocumentUnique();
    // If the dragged document is also rendered somewhere in the tree, reuse its
    // rendered descendants for the local cycle guard; otherwise empty.
    const treeEl = findTreeItemByUnique(sourceUnique);
    const descendantUniques = treeEl ? collectDescendantUniques(treeEl) : new Set<string>();

    event.dataTransfer!.effectAllowed = 'move';
    event.dataTransfer!.setData(DRAG_MIME, sourceUnique);
    // Use the row/card as the drag image so the ghost reads as "this item"
    // rather than the default link-URL ghost the browser would show.
    try { event.dataTransfer!.setDragImage(source.el, 0, 0); } catch { /* not critical */ }

    this.#dragState = {
      sourceUnique,
      sourceParentUnique,
      descendantUniques,
      fromCollection: true,
      sourceEl: source.el,
      sourceName: source.name,
    };
  }

  #onDragOver(event: DragEvent, el: AnyTreeItem): void {
    if (!this.#dragState) return;
    const targetUnique = readUnique(el);
    if (!targetUnique) return;

    if (isBlockedTarget(targetUnique, this.#dragState.sourceUnique, this.#dragState.descendantUniques)) {
      hideIndicator();
      return;
    }

    const zone = getDropZone(el, event.clientY);
    event.preventDefault();
    event.dataTransfer!.dropEffect = 'move';
    renderIndicator(el, zone);

    if (this.#lastHoverTarget !== el) {
      if (this.#hoverTimer) clearTimeout(this.#hoverTimer);
      this.#lastHoverTarget = el;
      this.#hoverTimer = setTimeout(() => {
        if (!el.hasAttribute('show-children')
            && !el.hasAttribute('is-expanded')
            && !el.hasAttribute('open')) {
          if (typeof el.toggleChildren === 'function') {
            el.toggleChildren();
          } else {
            const chevron = el.shadowRoot?.querySelector('[name="caret"], [data-mark="chevron"]');
            (chevron as HTMLElement | null | undefined)?.click?.();
          }
        }
      }, HOVER_EXPAND_MS);
    }
  }

  #onDragLeave(event: DragEvent, el: AnyTreeItem): void {
    if (event.relatedTarget && el.contains(event.relatedTarget as Node)) return;
    hideIndicator();
    if (this.#lastHoverTarget === el && this.#hoverTimer) {
      clearTimeout(this.#hoverTimer);
      this.#hoverTimer = null;
      this.#lastHoverTarget = null;
    }
  }

  async #onDrop(event: DragEvent, el: AnyTreeItem): Promise<void> {
    if (!this.#dragState) return;
    const targetUnique = readUnique(el);
    if (!targetUnique) return;
    if (isBlockedTarget(targetUnique, this.#dragState.sourceUnique, this.#dragState.descendantUniques)) return;
    const zone = getDropZone(el, event.clientY);
    event.preventDefault();
    hideIndicator();
    await this.#performMove(el, zone);
  }

  // Shared move/sort/reload/optimistic/rollback/spinner logic, driven by a
  // resolved (targetEl, zone). Used by pointer-drop (#onDrop) and reusable by a
  // future keyboard-commit path. Reads source info from #dragState.
  async #performMove(el: AnyTreeItem, zone: DropZone): Promise<void> {
    if (!this.#dragState) return;
    const targetUnique = readUnique(el);
    if (!targetUnique) return;
    if (isBlockedTarget(targetUnique, this.#dragState.sourceUnique, this.#dragState.descendantUniques)) return;

    // In-flight move lock: any second call (stray Space/Enter, double pointer
    // drop, grab-during-flight) returns immediately. Set before the first
    // await; released unconditionally in the finally block below.
    if (this.#movePending) return;
    this.#movePending = true;

    const sourceUnique = this.#dragState.sourceUnique;
    const sourceParentUnique = this.#dragState.sourceParentUnique;
    const targetParentUnique = readParentUnique(el);
    const fromCollection = this.#dragState.fromCollection === true;
    // Names for the "moved" feedback toast, captured before any await/reload
    // can detach the elements.
    const sourceName = this.#dragState.sourceName ?? 'item';
    const targetName = this.#targetName(el);

    // Find the source DOM element so we can do an optimistic move on success.
    // For a collection drag the source isn't a tree item, so fall back to the
    // collection row/card we captured at drag start (used only for dim/spinner
    // feedback — never for optimistic tree reordering, see below).
    const sourceEl = findTreeItemByUnique(sourceUnique) ?? this.#dragState.sourceEl ?? null;

    // Visual feedback: dim the source AND show a spinner while the API is in flight.
    if (sourceEl) {
      (sourceEl as HTMLElement).style.opacity = '0.4';
      showSpinner(sourceEl);
    }

    try {
      if (zone === 'into') {
        if (sourceParentUnique === targetUnique) return;
        await this.#move(sourceUnique, targetUnique);
        // Cross-parent reparent into a target: optimistic DOM doesn't work
        // here because Bellissima's expand-chevron and indentation are
        // driven by the target's `props.item.hasChildren` in its data store
        // — DOM mutation alone doesn't change that. Fall back to reload
        // events so the data store updates and the chevron appears.
        await this.#reload(sourceParentUnique);
        await this.#reload(targetUnique);
        this.#showMoved(sourceName, targetName, zone);
        return;
      }

      if (sourceParentUnique === targetParentUnique) {
        const parentEl = findVisualParentTreeItem(el);
        const siblings = listSiblingsInOrder(parentEl);
        const newOrder = computeReorder(siblings, sourceUnique, targetUnique, zone);
        if (!newOrder) {
          throw new Error('Target sibling not found in parent\'s rendered children');
        }

        // Collection source, same parent: the item is already under this parent
        // (it's a sibling shown in the list view, not the tree), so there's
        // nothing to optimistically move in the tree DOM. Just sort, then
        // reload so the list view reflects the new order.
        if (fromCollection) {
          await this.#sort(targetParentUnique, newOrder);
          await this.#reload(targetParentUnique);
          this.#showMoved(sourceName, targetName, zone);
          return;
        }

        // Optimistic-first: move the DOM element BEFORE awaiting the API.
        // The sort API is slow (~8s for ~26 children locally) — awaiting
        // first means the user sees a dimmed row for 8s before the move
        // visually completes. Moving first gives instant feedback; if the
        // API later fails, we restore the original position.
        const rollbackBefore = sourceEl?.nextSibling ?? null;
        const rollbackParent = sourceEl?.parentNode ?? null;
        optimisticReorder(sourceEl, el, zone);
        // Re-pin the spinner over the row's NEW position — the fixed overlay was
        // placed at the pre-move coordinates; the optimistic reorder moved the row.
        if (sourceEl) showSpinner(sourceEl);

        try {
          await this.#sort(targetParentUnique, newOrder);
        } catch (err) {
          // Roll back the optimistic move so the visible tree matches server.
          if (sourceEl && rollbackParent) {
            rollbackParent.insertBefore(sourceEl, rollbackBefore);
          }
          throw err; // outer catch shows toast
        }
        this.#showMoved(sourceName, targetName, zone);
        return;
      }

      // Cross-parent slot: move + sort.
      // Accepted fallback (do NOT "fix" into a hard failure): if the slot can't be
      // computed or the sort fails, we reload both branches and leave the node at
      // the bottom of the new parent with a warning. A successful move with an
      // imperfect position beats blocking the move or rolling back a completed move.
      await this.#move(sourceUnique, targetParentUnique);
      const parentEl = findVisualParentTreeItem(el);
      const siblings = listSiblingsInOrder(parentEl);
      const newOrder = computeReorder(siblings, sourceUnique, targetUnique, zone);
      if (!newOrder) {
        // Move succeeded but we can't compute the slot; reload for accuracy
        // (this is a rare edge case).
        await this.#reload(sourceParentUnique);
        await this.#reload(targetParentUnique);
        this.#showWarn(`Moved, but couldn't set the position — it's at the bottom of the new parent.`);
        return;
      }

      try {
        await this.#sort(targetParentUnique, newOrder);
        // Cross-parent slot: same data-store issue as `into` (target needs
        // its hasChildren updated). Reload both branches.
        await this.#reload(sourceParentUnique);
        await this.#reload(targetParentUnique);
        this.#showMoved(sourceName, targetName, zone);
      } catch (sortErr) {
        await this.#reload(sourceParentUnique);
        await this.#reload(targetParentUnique);
        this.#showWarn(`Moved, but couldn't set the position — it's at the bottom of the new parent. (${(sortErr as Error)?.message ?? sortErr})`);
      }
    } catch (err) {
      console.error('[lait-content-drag-drop] drop failed', err);
      this.#showError((err as Error)?.message ?? String(err));
      // On error: reload to re-sync visual state with server reality.
      await this.#reload(sourceParentUnique).catch(() => {});
      await this.#reload(targetParentUnique).catch(() => {});
    } finally {
      hideSpinner();
      if (sourceEl) (sourceEl as HTMLElement).style.opacity = '';
      this.#movePending = false;
    }
  }

  #onDragEnd(): void {
    this.#dragState = null;
    hideIndicator();
    if (this.#hoverTimer) clearTimeout(this.#hoverTimer);
    this.#hoverTimer = null;
    this.#lastHoverTarget = null;
  }

  // --- Keyboard "grab & place" reordering -----------------------------------

  // Enumerate all visible document tree-items in visual order as KbCandidates,
  // keeping a parallel element array so a resolved targetIndex maps back to a
  // DOM element. Elements without a readable unique are skipped. Requires a
  // grab in progress (uses #dragState for the source/descendant blocked check).
  #buildCandidates(): { candidates: KbCandidate[]; els: AnyTreeItem[] } {
    const candidates: KbCandidate[] = [];
    const els: AnyTreeItem[] = [];
    const sourceUnique = this.#dragState?.sourceUnique ?? null;
    const descendantUniques = this.#dragState?.descendantUniques ?? new Set<string>();
    for (const el of listTreeItemsInOrder()) {
      const unique = readUnique(el);
      if (!unique) continue;
      candidates.push({
        unique,
        parentUnique: readParentUnique(el),
        blocked: unique === sourceUnique || descendantUniques.has(unique),
      });
      els.push(el);
    }
    return { candidates, els };
  }

  #targetName(el: AnyTreeItem | undefined): string {
    return (el as any)?.props?.item?.name ?? 'item';
  }

  #onKeyDown(e: KeyboardEvent): void {
    if (this.#kbState === null) {
      // Not grabbed: only Space initiates a grab. Enter keeps its normal
      // "open node" behavior; all other keys pass through untouched.
      if (e.key !== ' ') return;
      const el = this.#findTreeItemInPath(e);
      if (!el) return;
      const sourceUnique = readUnique(el);
      if (!sourceUnique) return;
      // Don't start a new grab while a move is in flight.
      if (this.#movePending) return;

      e.preventDefault();
      e.stopPropagation();

      // Build source state exactly like #onDragStart so #performMove and the
      // cycle guard work identically to the pointer-drag path.
      const sourceParentUnique = readParentUnique(el);
      const descendantUniques = collectDescendantUniques(el);
      this.#dragState = { sourceUnique, sourceParentUnique, descendantUniques, sourceName: this.#targetName(el) };

      const { candidates, els } = this.#buildCandidates();
      const sourceIndex = candidates.findIndex((c) => c.unique === sourceUnique);
      const targetIndex = sourceIndex >= 0 ? sourceIndex : 0;
      this.#kbState = { sourceUnique, targetIndex, zone: 'before' };

      const indicatorEl = els[targetIndex] ?? el;
      renderIndicator(indicatorEl, 'before');
      announce(
        `Grabbed ${this.#targetName(el)}. Use arrow keys to choose a position, space to drop, escape to cancel.`,
      );
      return;
    }

    // Grabbed: rebuild candidates fresh (the tree may have expanded), then run
    // the pure reducer. Clamp the (possibly stale) target index defensively.
    const { candidates, els } = this.#buildCandidates();
    if (candidates.length === 0) {
      // Nothing to target anymore — cancel cleanly.
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); }
      hideIndicator();
      this.#kbState = null;
      this.#dragState = null;
      return;
    }
    const clampedIndex = Math.min(Math.max(this.#kbState.targetIndex, 0), candidates.length - 1);
    const state: KbState = { ...this.#kbState, targetIndex: clampedIndex };

    const handledKeys = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter', 'Escape'];
    if (!handledKeys.includes(e.key)) return; // pass through unhandled keys
    e.preventDefault();
    e.stopPropagation();

    const r = reduceKey(state, e.key, candidates);

    if (r.type === 'none') {
      this.#kbState = r.state;
      const el = els[r.state.targetIndex];
      if (!el) {
        hideIndicator();
        return;
      }
      renderIndicator(el, r.state.zone);
      announce(`${r.state.zone} ${this.#targetName(el)}`);
      return;
    }

    if (r.type === 'commit') {
      const targetEl = els[r.state.targetIndex];
      const zone = r.state.zone;
      const sourceUnique = r.state.sourceUnique;
      const sourceName = this.#targetName(findTreeItemByUnique(sourceUnique) ?? undefined);
      hideIndicator();
      if (!targetEl) {
        // Stale index with no element — bail without moving.
        this.#kbState = null;
        this.#dragState = null;
        return;
      }
      // Clear #kbState synchronously so the grabbed branch can't re-enter
      // mid-flight. #dragState stays set until after the move resolves
      // (#performMove reads it); the #movePending lock blocks any second
      // #performMove during the in-flight window.
      this.#kbState = null;
      void (async () => {
        await this.#performMove(targetEl, zone);
        announce(`Moved ${sourceName}.`);
        // Best-effort refocus the moved node so keyboard users keep their place.
        const found = findTreeItemByUnique(sourceUnique);
        const inner = found?.querySelector('[tabindex],a,button') as HTMLElement | null;
        if (inner?.focus) {
          inner.focus();
        } else {
          (found as HTMLElement | null)?.focus?.();
        }
        this.#dragState = null;
      })();
      return;
    }

    // r.type === 'cancel'
    hideIndicator();
    announce('Move cancelled.');
    this.#kbState = null;
    this.#dragState = null;
  }

  async #move(unique: string, targetParentUnique: string | null): Promise<void> {
    const { error } = await tryExecute(
      this,
      DocumentService.putDocumentByIdMove({
        path: { id: unique },
        body: { target: targetParentUnique ? { id: targetParentUnique } : null },
      }),
      { disableNotifications: true },
    );
    if (error) throw error;
  }

  async #sort(parentUnique: string | null, orderedChildUniques: string[]): Promise<void> {
    const { error } = await tryExecute(
      this,
      DocumentService.putDocumentSort({
        body: {
          parent: parentUnique ? { id: parentUnique } : null,
          sorting: orderedChildUniques.map((id, sortOrder) => ({ id, sortOrder })),
        },
      }),
      { disableNotifications: true },
    );
    if (error) throw error;
  }

  async #reload(parentUnique: string | null): Promise<void> {
    if (!this.#actionEvents) {
      console.warn('[lait-content-drag-drop] reload: action-event context not available — tree won\'t auto-refresh');
      return;
    }
    // The conceptual document-root has entityType 'document-root' (per the
    // tree-item probe: top-level docs report `parent: { unique: null,
    // entityType: 'document-root' }`). For child reloads dispatch with the
    // parent's actual entity type.
    const entityType = parentUnique ? ENTITY_TYPE_DOCUMENT : 'document-root';
    this.#actionEvents.dispatchEvent(
      new UmbRequestReloadChildrenOfEntityEvent({
        unique: parentUnique ?? null,
        entityType,
      }),
    );
  }

  #showError(message: string): void {
    console.error('[lait-content-drag-drop]', message);
    this.#notifications?.peek('danger', { data: { message } });
  }

  #showWarn(message: string): void {
    console.warn('[lait-content-drag-drop]', message);
    this.#notifications?.peek('warning', { data: { message } });
  }

  // Build the human-readable "what moved where" line for the success toast.
  #movedMessage(sourceName: string, targetName: string, zone: DropZone): string {
    const where = zone === 'into' ? `into “${targetName}”`
      : zone === 'before' ? `above “${targetName}”`
      : `below “${targetName}”`;
    return `Moved “${sourceName}” ${where}.`;
  }

  // Transient success toast in the backoffice's bottom-right notification stack
  // (same UMB_NOTIFICATION_CONTEXT used for the error/warning peeks).
  #showMoved(sourceName: string, targetName: string, zone: DropZone): void {
    this.#notifications?.peek('positive', {
      data: { headline: 'Moved', message: this.#movedMessage(sourceName, targetName, zone) },
    });
  }

  render() { return null; }
}
