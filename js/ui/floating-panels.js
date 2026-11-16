// Плавающие панели, меню проекта, порядок эффектов.
import './toolbar-bindings.js'; // initialisation order: this module runs after it
import { requestMainCanvasRender } from '../core/scheduler.js';
import { state } from '../core/state.js';
import { setOrangeMorphOpenGroup } from './orange-morph/routing-ui.js';
import {
  closeViewportPopupsForPanel,
  isMorphRoutingContextTarget,
  toggleMorphSettingsPanel,
  viewportPopupBelongsToPanel,
} from './morph-settings-panel.js';
import { capturePlaylistOverridesFromCurrent } from '../project/project-data.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

function isDesktopPointerUI() {
  return window.matchMedia?.('(pointer:fine)').matches === true && window.innerWidth > 820;
}
function positionFloatingPanelNearTrigger(panel, trigger, gap = 6) {
  if (!panel || !trigger || !isDesktopPointerUI()) return;
  const margin = 8;
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);

  panel.style.right = 'auto';
  panel.style.bottom = 'auto';
  panel.style.visibility = 'hidden';
  panel.classList.remove('hidden');

  const tr = trigger.getBoundingClientRect();
  const availableBelow = Math.max(96, vh - tr.bottom - gap - margin);
  const availableAbove = Math.max(96, tr.top - gap - margin);
  const preferBelow = availableBelow >= Math.min(280, availableAbove);
  const availableHeight = preferBelow ? availableBelow : availableAbove;

  panel.style.maxHeight = `${Math.max(96, Math.floor(availableHeight))}px`;
  panel.style.overflowY = 'auto';
  panel.style.overflowX = 'hidden';
  panel.style.maxWidth = `${Math.max(160, vw - margin * 2)}px`;

  const pr = panel.getBoundingClientRect();
  let left = tr.left;
  if (left + pr.width > vw - margin) left = tr.right - pr.width;
  left = Math.max(margin, Math.min(vw - pr.width - margin, left));

  let top = preferBelow ? tr.bottom + gap : tr.top - pr.height - gap;
  top = Math.max(margin, Math.min(vh - pr.height - margin, top));
  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  panel.style.visibility = '';
}
function getAudioViewportPopupPortal() {
  let portal = document.getElementById('audioViewportPopupPortal');
  if (portal) return portal;
  portal = document.createElement('div');
  portal.id = 'audioViewportPopupPortal';
  portal.setAttribute('aria-hidden', 'false');
  Object.assign(portal.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '10000',
    pointerEvents: 'none',
    overflow: 'visible',
  });
  document.body.appendChild(portal);
  return portal;
}
function positionViewportPopup(menu, trigger, gap = 5) {
  if (!menu || !trigger) return;
  const margin = 8;
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0);
  const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  menu._viewportTrigger = trigger;
  menu._viewportOwnerPanelId =
    trigger.closest?.('#morphSettingsPanel,#randomSettingsPanel,#audioRoutingPanel')?.id || '';
  const portal = getAudioViewportPopupPortal();
  if (menu.parentElement !== portal) portal.appendChild(menu);
  menu.style.pointerEvents = 'auto';
  menu.style.zIndex = '10001';
  menu.style.position = 'fixed';
  menu.style.right = 'auto';
  menu.style.bottom = 'auto';
  menu.style.maxWidth = `${Math.max(120, vw - margin * 2)}px`;
  menu.style.overflowY = 'auto';
  menu.style.overflowX = 'hidden';
  menu.style.overscrollBehavior = 'contain';
  menu.style.visibility = 'hidden';
  menu.classList.remove('hidden');
  const tr = trigger.getBoundingClientRect();
  const below = Math.max(0, vh - tr.bottom - gap - margin);
  const above = Math.max(0, tr.top - gap - margin);
  const preferBelow = below >= Math.min(220, above);
  const available = Math.max(72, preferBelow ? below : above);
  menu.style.maxHeight = `${Math.floor(available)}px`;
  const mr = menu.getBoundingClientRect();
  let left = tr.left;
  if (left + mr.width > vw - margin) left = tr.right - mr.width;
  left = Math.max(margin, Math.min(Math.max(margin, vw - mr.width - margin), left));
  let top = preferBelow ? tr.bottom + gap : tr.top - mr.height - gap;
  top = Math.max(margin, Math.min(Math.max(margin, vh - mr.height - margin), top));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
  menu.style.visibility = '';
}
function reflowOpenViewportPopups() {
  document
    .querySelectorAll('.audio-param-menu:not(.hidden),.audio-route-group-menu:not(.hidden)')
    .forEach((menu) => {
      const trigger = menu._viewportTrigger;
      if (trigger?.isConnected) positionViewportPopup(menu, trigger);
    });
}
const FLOATING_PANELS = Object.freeze([
  { panel: 'morphSettingsPanel', triggers: ['btnMorphSettings'] },
  { panel: 'randomSettingsPanel', triggers: ['btnRandomSettings'] },
  { panel: 'tunnelSettingsPanel', triggers: ['btnTunnelSettings'] },
  { panel: 'tapSettingsPanel', triggers: ['btnTapSettings'] },
  { panel: 'projectMorphSettingsPanel', triggers: ['btnProjectMorphSettings'] },
  { panel: 'audioReactivePanel', triggers: ['btnAudioReactive', 'btnMobileMic'] },
  { panel: 'audioRoutingPanel', triggers: ['btnAudioRouting', 'btnMobileAudioRouting'] },
]);
function closeFloatingPanel(id) {
  const panel = document.getElementById(id);
  if (!panel) return;
  panel.classList.add('hidden');
  panel.style.visibility = '';
  if (id === 'audioRoutingPanel')
    document
      .querySelectorAll('.audio-param-menu,.audio-route-group-menu')
      .forEach((m) => m.classList.add('hidden'));
  if (id === 'morphSettingsPanel') closeViewportPopupsForPanel('morphSettingsPanel');
  if (id === 'randomSettingsPanel') {
    closeViewportPopupsForPanel('randomSettingsPanel');
    setOrangeMorphOpenGroup('');
  }
  const ids =
    {
      morphSettingsPanel: ['btnMorphSettings'],
      randomSettingsPanel: ['btnRandomSettings'],
      tunnelSettingsPanel: ['btnTunnelSettings'],
      tapSettingsPanel: ['btnTapSettings'],
      projectMorphSettingsPanel: ['btnProjectMorphSettings'],
      audioReactivePanel: ['btnAudioReactive', 'btnMobileMic'],
      audioRoutingPanel: ['btnAudioRouting', 'btnMobileAudioRouting'],
    }[id] || [];
  ids.forEach((btnId) => {
    const b = document.getElementById(btnId);
    b?.setAttribute('aria-expanded', 'false');
    if (id === 'audioRoutingPanel') b?.classList.remove('active');
  });
}
function fitFloatingPanel(panel) {
  if (!panel || panel.classList.contains('hidden')) return;
  const vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0);
  if (panel.id === 'audioRoutingPanel') {
    const rect = panel.getBoundingClientRect();
    const top = Math.max(6, rect.top || 48);
    panel.style.maxHeight = `${Math.max(120, Math.floor(vh - top - 8))}px`;
    const main = panel.querySelector('.audio-routing-main');
    if (main) {
      main.style.overflowY = 'auto';
      main.style.minHeight = '0';
    }
    return;
  }
  const rect = panel.getBoundingClientRect();
  const top = Math.max(6, rect.top || 48);
  panel.style.maxHeight = `${Math.max(96, Math.floor(vh - top - 8))}px`;
  panel.style.overflowY = 'auto';
  panel.style.overflowX = 'hidden';
  panel.style.overscrollBehavior = 'contain';
}
function fitAllFloatingPanels() {
  FLOATING_PANELS.forEach((spec) => fitFloatingPanel(document.getElementById(spec.panel)));
}
function isOutsideFloatingPanelEvent(event) {
  if (
    event.type === 'contextmenu' ||
    (event.type === 'click' && (event.button === 0 || event.button == null))
  ) {
    for (const spec of FLOATING_PANELS) {
      const panel = document.getElementById(spec.panel);
      if (!panel || panel.classList.contains('hidden')) continue;
      if (panel.contains(event.target)) continue;

      if (spec.panel === 'audioRoutingPanel' && event.target?.closest?.('#audioViewportPopupPortal'))
        continue;
      if (
        spec.panel === 'randomSettingsPanel' &&
        viewportPopupBelongsToPanel(event.target, 'randomSettingsPanel')
      )
        continue;
      if (
        spec.panel === 'morphSettingsPanel' &&
        viewportPopupBelongsToPanel(event.target, 'morphSettingsPanel')
      )
        continue;
      if (
        spec.panel === 'morphSettingsPanel' &&
        event.type === 'contextmenu' &&
        isMorphRoutingContextTarget(event.target)
      )
        continue;
      if (spec.triggers.some((id) => document.getElementById(id)?.contains(event.target))) continue;
      closeFloatingPanel(spec.panel);
    }
  }
}
document.addEventListener('click', isOutsideFloatingPanelEvent, true);
document.addEventListener('contextmenu', isOutsideFloatingPanelEvent, true);
window.addEventListener('resize', () => requestAnimationFrame(fitAllFloatingPanels), { passive: true });
window.visualViewport?.addEventListener('resize', () => requestAnimationFrame(fitAllFloatingPanels), {
  passive: true,
});
FLOATING_PANELS.forEach((spec) => {
  const panel = document.getElementById(spec.panel);
  if (panel)
    new MutationObserver(() => {
      if (!panel.classList.contains('hidden')) requestAnimationFrame(() => fitFloatingPanel(panel));
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
});
function reflowProjectMenuAfterSubmenuChange() {
  const menu = document.getElementById('projectMenu');
  const trigger = document.getElementById('btnProjectMenu');
  if (!menu || !trigger || menu.classList.contains('hidden')) return;
  requestAnimationFrame(() => positionFloatingPanelNearTrigger(menu, trigger));
}
function setFileSubmenu(openId, open) {
  const pairs = [
    ['fileShapesBlock', 'btnFileShapesToggle'],
    ['fileSettingsBlock', 'btnFileSettingsToggle'],
  ];
  for (const [blockId, buttonId] of pairs) {
    const shouldOpen = open === true && blockId === openId;
    document.getElementById(blockId)?.classList.toggle('hidden', !shouldOpen);
    document.getElementById(buttonId)?.setAttribute('aria-expanded', shouldOpen ? 'true' : 'false');
  }
  reflowProjectMenuAfterSubmenuChange();
}
function closeDesktopFloatingMenus() {
  if (!isDesktopPointerUI()) return;
  [
    'projectMenu',
    'randomSettingsPanel',
    'tunnelSettingsPanel',
    'tapSettingsPanel',
    'morphSettingsPanel',
    'sceneBlendMenu',
  ].forEach((id) => document.getElementById(id)?.classList.add('hidden'));
  document.getElementById('fileShapesBlock')?.classList.add('hidden');
  document.getElementById('fileSettingsBlock')?.classList.add('hidden');
  ['btnTunnelSettings', 'btnTapSettings', 'btnFileShapesToggle', 'btnFileSettingsToggle'].forEach((id) =>
    document.getElementById(id)?.setAttribute('aria-expanded', 'false'),
  );
}
document.getElementById('btnProjectMenu').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('projectMenu');
  const opening = menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !opening);
  if (opening) {
    toggleMorphSettingsPanel(false);
    positionFloatingPanelNearTrigger(menu, e.currentTarget);
  }
});
document.addEventListener('click', () => {
  document.getElementById('projectMenu')?.classList.add('hidden');
});
document.getElementById('projectMenu')?.addEventListener('click', (e) => e.stopPropagation());
document.getElementById('btnFileShapesToggle')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = document.getElementById('fileShapesBlock')?.classList.contains('hidden') === true;
  setFileSubmenu('fileShapesBlock', open);
});
document.getElementById('fileShapesBlock')?.addEventListener('click', (e) => e.stopPropagation());
document.getElementById('btnFileSettingsToggle')?.addEventListener('click', (e) => {
  e.stopPropagation();
  const open = document.getElementById('fileSettingsBlock')?.classList.contains('hidden') === true;
  if (open) renderEffectOrderSettings();
  setFileSubmenu('fileSettingsBlock', open);
});
document.getElementById('fileSettingsBlock')?.addEventListener('click', (e) => e.stopPropagation());
let effectOrderDragKey = '';
function commitEffectOrder(raw, { capture = true } = {}) {
  const next = window.SomataEffectStackOrder?.set?.(raw) || (Array.isArray(raw) ? raw.slice() : []);
  state.effectOrder = Array.isArray(next) ? next.slice() : [];
  renderEffectOrderSettings();
  if (capture) capturePlaylistOverridesFromCurrent();
  try {
    requestMainCanvasRender?.();
  } catch (error) {
    noteSuppressedError('ui/floating-panels#commitEffectOrder', error);
  }
  return state.effectOrder.slice();
}
function renderEffectOrderSettings() {
  const list = document.getElementById('effectOrderList');
  if (!list) return;
  const service = window.SomataEffectStackOrder,
    rows = service?.entries?.() || [];
  list.textContent = '';
  for (const row of rows) {
    const el = document.createElement('div');
    el.className = 'effect-order-row';
    el.draggable = true;
    el.tabIndex = 0;
    el.dataset.effectKey = row.key;
    el.innerHTML = `<span class="effect-order-handle" aria-hidden="true">↕</span><span class="effect-order-index">${row.index + 1}</span><span class="effect-order-label"></span>`;
    el.querySelector('.effect-order-label').textContent = row.label;
    el.title = `${row.index + 1}. ${row.label}`;
    el.addEventListener('dragstart', (ev) => {
      effectOrderDragKey = row.key;
      el.classList.add('dragging');
      ev.dataTransfer?.setData('text/plain', row.key);
      if (ev.dataTransfer) ev.dataTransfer.effectAllowed = 'move';
    });
    el.addEventListener('dragend', () => {
      effectOrderDragKey = '';
      el.classList.remove('dragging');
      for (const n of list.querySelectorAll('.drag-over')) n.classList.remove('drag-over');
    });
    el.addEventListener('dragover', (ev) => {
      ev.preventDefault();
      el.classList.add('drag-over');
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
    });
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'));
    el.addEventListener('drop', (ev) => {
      ev.preventDefault();
      el.classList.remove('drag-over');
      const from =
        effectOrderDragKey ||
        ev.dataTransfer?.getData('text/plain') ||
        list.querySelector('.dragging')?.dataset.effectKey;
      if (!from || from === row.key) return;
      const order = service?.current?.() || [];
      const fi = order.indexOf(from),
        ti = order.indexOf(row.key);
      if (fi < 0 || ti < 0) return;
      order.splice(fi, 1);
      const target = order.indexOf(row.key);
      order.splice(target, 0, from);
      commitEffectOrder(order);
    });
    el.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
      ev.preventDefault();
      const order = service?.current?.() || [];
      const i = order.indexOf(row.key),
        j = ev.key === 'ArrowUp' ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      commitEffectOrder(order);
      requestAnimationFrame(() =>
        document.querySelector(`.effect-order-row[data-effect-key="${CSS.escape(row.key)}"]`)?.focus(),
      );
    });
    list.appendChild(el);
  }
}
document.getElementById('btnResetEffectOrder')?.addEventListener('click', (e) => {
  e.stopPropagation();
  commitEffectOrder(window.SomataEffectStackOrder?.DEFAULT_ORDER || []);
});
window.__somataSetEffectOrder = (raw) => commitEffectOrder(raw, { capture: false });
window.__somataRenderEffectOrderSettings = renderEffectOrderSettings;
renderEffectOrderSettings();
window.addEventListener(
  'resize',
  () => {
    if (!isDesktopPointerUI()) return;
    const projectMenu = document.getElementById('projectMenu');
    if (projectMenu && !projectMenu.classList.contains('hidden')) reflowProjectMenuAfterSubmenuChange();
    const anchored = [
      ['randomSettingsPanel', 'btnRandomSettings'],
      ['morphSettingsPanel', 'btnMorphSettings'],
      ['tunnelSettingsPanel', 'btnTunnelSettings'],
      ['tapSettingsPanel', 'btnTapSettings'],
    ];
    for (const [panelId, triggerId] of anchored) {
      const panel = document.getElementById(panelId),
        trigger = document.getElementById(triggerId);
      if (panel && trigger && !panel.classList.contains('hidden'))
        positionFloatingPanelNearTrigger(panel, trigger);
    }
    reflowOpenViewportPopups();
  },
  { passive: true },
);

export {
  closeDesktopFloatingMenus,
  positionFloatingPanelNearTrigger,
  positionViewportPopup,
  renderEffectOrderSettings,
};
