// The drop indicator — a single fixed-position element reused across drags.

import { getRowRect, type DropZone } from './drop-zone';

const indicator: HTMLDivElement = (() => {
  const el = document.createElement('div');
  el.id = 'lait-content-drag-drop-indicator';
  el.style.cssText = `
    position: fixed;
    pointer-events: none;
    z-index: 99999;
    display: none;
    box-sizing: border-box;
  `;
  document.body.appendChild(el);
  return el;
})();

export function renderIndicator(targetEl: Element, zone: DropZone): void {
  const rect = getRowRect(targetEl);
  const accent = 'var(--uui-color-selected, #3879ff)';
  const tint = 'rgba(56, 121, 255, 0.08)';
  const common = `
    position: fixed;
    pointer-events: none;
    z-index: 99999;
    display: block;
    box-sizing: border-box;
    left: ${rect.left}px;
    width: ${rect.width}px;
  `;
  if (zone === 'before') {
    indicator.style.cssText = `${common}
      top: ${rect.top - 1}px;
      height: 2px;
      background: ${accent};
    `;
  } else if (zone === 'after') {
    indicator.style.cssText = `${common}
      top: ${rect.bottom - 1}px;
      height: 2px;
      background: ${accent};
    `;
  } else {
    indicator.style.cssText = `${common}
      top: ${rect.top}px;
      height: ${rect.height}px;
      border: 2px solid ${accent};
      background: ${tint};
    `;
  }
}

export function hideIndicator(): void {
  indicator.style.display = 'none';
}
