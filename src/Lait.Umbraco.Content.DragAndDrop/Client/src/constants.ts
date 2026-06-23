// Lait.Umbraco.Content.DragAndDrop — shared constants.

export const ATTACHED_FLAG = 'laitContentDndAttached';
// Marks a collection entry (list-view row / card) that we've already made
// draggable, so the observer's repeated sweeps stay idempotent.
export const COLLECTION_ATTACHED_FLAG = 'laitContentDndCollectionAttached';
export const HOVER_EXPAND_MS = 700;
export const ENTITY_TYPE_DOCUMENT = 'document';
export const DRAG_MIME = 'application/x-lait-content-drag-drop';

// Guard against re-evaluation. If anything ever causes a backofficeEntryPoint
// to load twice (Bellissima remount, auth refresh, manifest re-eval), every
// additional load would add another wrapper layer onto attachShadow — every
// shadow root would then get N MutationObservers.
export const PATCH_FLAG = '__laitContentDndPatched';
