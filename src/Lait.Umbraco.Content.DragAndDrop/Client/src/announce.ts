// Single visually-hidden polite live region for screen-reader announcements
// during keyboard grab & place.

const region: HTMLDivElement = (() => {
  const el = document.createElement('div');
  el.id = 'lait-content-drag-drop-live';
  el.setAttribute('aria-live', 'polite');
  el.setAttribute('aria-atomic', 'true');
  el.style.cssText = `
    position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
    overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); border: 0;
  `;
  document.body.appendChild(el);
  return el;
})();

export function announce(message: string): void {
  // Reset then set so identical consecutive messages are still announced.
  region.textContent = '';
  region.textContent = message;
}
