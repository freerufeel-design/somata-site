// Shared, non-interactive help popups. Only uninterrupted mouse stillness
// opens a tooltip; moving, editing, zooming or scrolling dismisses it.
export const TOOLTIP_DELAY_MS = 1200;
const TARGET_SELECTOR = '[data-ui-tooltip]';

export function installHoverTooltips(doc = document, win = window) {
  let pending = null;
  let hover = null;
  let popup = null;
  const targetFor = (element) => element?.closest?.(TARGET_SELECTOR) || null;

  function hide() {
    if (pending !== null) win.clearTimeout(pending);
    pending = null;
    hover = null;
    if (popup && !popup.hidden) popup.hidden = true;
  }

  function show() {
    pending = null;
    if (!hover || !hover.target.isConnected || doc.hidden ||
        targetFor(doc.elementFromPoint(hover.x, hover.y)) !== hover.target) {
      hide();
      return;
    }
    const text = hover.target.dataset.uiTooltip?.trim();
    if (!text) return;
    if (!popup) {
      popup = doc.createElement('div');
      popup.className = 'ui-hover-tooltip';
      popup.setAttribute('role', 'tooltip');
      popup.hidden = true;
      doc.body.appendChild(popup);
    }
    popup.textContent = text;
    popup.hidden = false;
    const margin = 8;
    const gap = 14;
    const bounds = popup.getBoundingClientRect();
    const x = Math.max(margin, Math.min(hover.x + gap, win.innerWidth - bounds.width - margin));
    const below = hover.y + gap;
    const y = below + bounds.height <= win.innerHeight - margin
      ? below : Math.max(margin, hover.y - bounds.height - gap);
    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;
  }

  function track(event) {
    const target = targetFor(event.target);
    if (event.pointerType !== 'mouse' || event.buttons || !target?.dataset.uiTooltip?.trim()) {
      hide();
      return;
    }
    const x = event.clientX;
    const y = event.clientY;
    // pointerover and pointermove can report the very same location.
    if (hover?.target === target && hover.x === x && hover.y === y) return;
    hide();
    hover = { target, x, y };
    pending = win.setTimeout(show, TOOLTIP_DELAY_MS);
  }

  function leave(event) {
    if (hover && targetFor(event.relatedTarget) !== hover.target) hide();
  }

  const options = { capture: true, passive: true };
  doc.addEventListener('pointerover', track, options);
  doc.addEventListener('pointermove', track, options);
  doc.addEventListener('pointerout', leave, options);
  for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'wheel', 'scroll', 'keydown', 'visibilitychange']) {
    doc.addEventListener(type, hide, options);
  }
  win.addEventListener('blur', hide);
  win.addEventListener('resize', hide);

  return () => {
    hide();
    doc.removeEventListener('pointerover', track, options);
    doc.removeEventListener('pointermove', track, options);
    doc.removeEventListener('pointerout', leave, options);
    for (const type of ['pointerdown', 'pointerup', 'pointercancel', 'wheel', 'scroll', 'keydown', 'visibilitychange']) {
      doc.removeEventListener(type, hide, options);
    }
    win.removeEventListener('blur', hide);
    win.removeEventListener('resize', hide);
    popup?.remove();
  };
}
