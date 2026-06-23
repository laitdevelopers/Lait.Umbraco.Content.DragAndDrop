// A single reused fixed-position overlay holding a UUI spinner, pinned over the
// row whose move is in flight. Mirrors indicator.ts. No managed lifecycle beyond
// show/hide — one element appended to <body>, repositioned per call.

import { getRowRect } from './drop-zone';

const spinner: HTMLDivElement = (() => {
  const el = document.createElement('div');
  el.id = 'lait-content-drag-drop-spinner';
  el.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 100000;
    display: none;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    color: var(--uui-color-selected, #3879ff);
  `;
  // uui-loader-circle is registered by the backoffice; safe to use as a tag.
  el.innerHTML = '<uui-loader-circle style="font-size: 1.2em;"></uui-loader-circle>';
  document.body.appendChild(el);
  return el;
})();

export function showSpinner(targetEl: Element): void {
  const rect = getRowRect(targetEl);
  // Pin to the row's left gutter so it sits over the icon area, not the label.
  spinner.style.left = `${rect.left}px`;
  spinner.style.top = `${rect.top}px`;
  spinner.style.width = `${Math.min(rect.height, 28)}px`;
  spinner.style.height = `${rect.height}px`;
  spinner.style.display = 'flex';
}

export function hideSpinner(): void {
  spinner.style.display = 'none';
}
