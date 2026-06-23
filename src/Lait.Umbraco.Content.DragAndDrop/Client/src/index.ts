// Backoffice.ContentTreeDnd — Content tree drag-and-drop for Umbraco 17.
//
// Adds native HTML5 drag-and-drop to the Umbraco 17 backoffice Content tree.
// Supports reorder (within one parent) and reparent (drop onto a different
// parent), with three-zone drop targets per row: above sibling / into as
// child / below sibling.
//
// Architecture:
//
//   Bellissima nests every UI element in shadow DOM, so plain
//   document.querySelectorAll never sees the tree. `observer.ts` patches
//   Element.prototype.attachShadow at module load time to capture every
//   shadow root created from then on (open OR closed) and observes each
//   for tree-item element insertions.
//
//   A single hidden <lait-content-drag-drop> Lit element (dnd-host.ts)
//   acts as the controller host — it consumes UMB_NOTIFICATION_CONTEXT and
//   UMB_ACTION_EVENT_CONTEXT, owns the drag state, and runs the API calls
//   via DocumentService (which auto-attaches the bearer token).
//
//   Importing observer.ts first installs the attachShadow patch + initial
//   document observe before the host is defined/mounted; when the host
//   mounts it registers itself (setHost) and re-sweeps already-captured
//   roots to attach handlers retroactively.

// Side-effect import order matches the original single file's top-to-bottom
// order: the drop-indicator element is created (appended to body) BEFORE
// observer.ts installs its document MutationObserver + attachShadow patch.
// (If observer ran first, appending the indicator div would fire one harmless
// observer callback — functionally inert, but this keeps the ordering faithful.)
import './indicator'; // side effect: create + append the drop-indicator element
import './observer';  // side effect: install attachShadow patch + observe document
import { LaitContentDragDrop } from './dnd-host';

if (!customElements.get('lait-content-drag-drop')) {
  customElements.define('lait-content-drag-drop', LaitContentDragDrop);
}

// Mount the host INSIDE <umb-app> so Lit contexts (UMB_NOTIFICATION_CONTEXT,
// UMB_ACTION_EVENT_CONTEXT) provided by ancestors of the section roots can
// propagate down to it. Mounting on document.body as a sibling of umb-app
// means consumeContext silently fails — the action-event context (needed to
// trigger tree reloads after move/sort) never resolves.
(() => {
  if (document.querySelector('lait-content-drag-drop')) return;
  const host = document.createElement('lait-content-drag-drop');
  host.style.display = 'none';

  function mountInto(parent: Element) {
    if (host.parentElement !== parent) parent.appendChild(host);
  }

  const umbApp = document.querySelector('umb-app');
  if (umbApp) {
    mountInto(umbApp);
    return;
  }

  // umb-app not yet in the DOM — start mounted on body so the entry-point's
  // sweep/observe machinery is live, and re-parent into umb-app when it shows
  // up. The disconnect/reconnect on re-parent re-runs setHost → re-sweep.
  document.body.appendChild(host);
  const obs = new MutationObserver(() => {
    const ua = document.querySelector('umb-app');
    if (ua) {
      mountInto(ua);
      obs.disconnect();
    }
  });
  obs.observe(document.body, { childList: true });
})();
