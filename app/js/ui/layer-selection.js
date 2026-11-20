// Выбор слоёв, изоляция и список слоёв.
import './corridor-panel.js'; // initialisation order: this module runs after it
import { renderProfileEditor } from './profile-editor.js';
import { hasActiveAudioRoute } from '../audio/audio-routing.js';
import { syncAudioRoutingLayerTabs } from './audio-routing-panel.js';
import { invalidateLayerStyle } from '../core/render-runtime.js';
import { runtimeState, state } from '../core/state.js';
import { renderMainCanvas } from '../render/main-pipeline.js';
import { syncSidebarInputs } from './sidebar-sync.js';
import { syncMorphAllStrokeWidthUI } from './morph-settings-panel.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

function isAudioRotationOverrideActive() {
  return Boolean(state.audioReactive.active && hasActiveAudioRoute('layer.rotation'));
}
const layerSelectionRuntime = { ids: new Set(), lastActiveId: null };
function syncLayerSelectionWithActive() {
  const layers = state.layers || [];
  const valid = new Set(layers.map((l) => l.id));
  for (const id of [...layerSelectionRuntime.ids]) if (!valid.has(id)) layerSelectionRuntime.ids.delete(id);
  const activeId = state.activeLayerId;
  if (state.masterLayerEdit === true) {
    layerSelectionRuntime.lastActiveId = activeId || null;
    return layerSelectionRuntime.ids;
  }

  if (activeId && valid.has(activeId) && !layerSelectionRuntime.ids.has(activeId)) {
    layerSelectionRuntime.ids.clear();
    layerSelectionRuntime.ids.add(activeId);
  }
  if (!layerSelectionRuntime.ids.size && activeId && valid.has(activeId))
    layerSelectionRuntime.ids.add(activeId);
  layerSelectionRuntime.lastActiveId = activeId || null;
  return layerSelectionRuntime.ids;
}
function getSelectedLayerIds() {
  return syncLayerSelectionWithActive();
}
function getSelectedLayers() {
  const ids = getSelectedLayerIds();
  return (state.layers || []).filter((l) => ids.has(l.id));
}
function hasMultiLayerSelection() {
  return state.masterLayerEdit !== true && getSelectedLayers().length > 1;
}
function getLayerEditTargets() {
  // Master is a write-broadcast mode, not a state-normalisation mode.
  // Restore the physical Master contract from the known-good 7.3.8 behavior:
  // any handler that already knows how to edit a layer receives EVERY physical
  // layer while Master is ON. The post-event exact-path mirror still runs as a
  // safety net for handlers that edit only getActiveLayer(), and rolls back any
  // unrelated block-wide mutations. This makes Master a real live fan-out, not
  // merely a deferred UI snapshot trick.
  if (state.masterLayerEdit === true) return [...(state.layers || [])];
  const selected = getSelectedLayers();
  if (selected.length) return selected;
  const active = (state.layers || []).find((l) => l.id === state.activeLayerId);
  return active ? [active] : [];
}
function getLayerBroadcastTargets() {
  // Destination set for the post-event mirror. In Master this is every layer,
  // while the event handler itself still edits only the active source layer.
  if (state.masterLayerEdit === true) return state.layers || [];
  const selected = getSelectedLayers();
  if (selected.length) return selected;
  const active = (state.layers || []).find((l) => l.id === state.activeLayerId);
  return active ? [active] : [];
}
function setSingleLayerSelection(layer) {
  layerSelectionRuntime.ids.clear();
  if (layer?.id) layerSelectionRuntime.ids.add(layer.id);
  // Master is a persistent editing mode. Selecting the source layer must never
  // turn it off; only the Master button (or loading project state) may do that.
  state.activeLayerId = layer?.id || null;
  layerSelectionRuntime.lastActiveId = state.activeLayerId;
}
function applyLayerListSelectionClick(layer, e) {
  if (!layer) return;
  const layers = state.layers || [],
    clickedIndex = layers.indexOf(layer);
  const ctrl = !!(e?.ctrlKey || e?.metaKey),
    shift = !!e?.shiftKey;
  if (state.masterLayerEdit === true) {
    // In Master, a layer click only chooses which layer is the live source.
    // All layers remain broadcast destinations.
    layerSelectionRuntime.ids.clear();
    if (layer.id) layerSelectionRuntime.ids.add(layer.id);
    state.activeLayerId = layer.id;
    layerSelectionRuntime.lastActiveId = layer.id;
    return;
  }
  syncLayerSelectionWithActive();
  if (shift && clickedIndex >= 0) {
    const anchorIndex = layers.findIndex((l) => l.id === state.activeLayerId);
    const from = anchorIndex >= 0 ? anchorIndex : clickedIndex;
    if (!ctrl) layerSelectionRuntime.ids.clear();
    const lo = Math.min(from, clickedIndex),
      hi = Math.max(from, clickedIndex);
    for (let i = lo; i <= hi; i++) layerSelectionRuntime.ids.add(layers[i].id);
    state.activeLayerId = layer.id;
  } else if (ctrl) {
    if (layerSelectionRuntime.ids.has(layer.id) && layerSelectionRuntime.ids.size > 1) {
      layerSelectionRuntime.ids.delete(layer.id);
      if (state.activeLayerId === layer.id) {
        const replacement = [...layers].reverse().find((l) => layerSelectionRuntime.ids.has(l.id));
        state.activeLayerId = replacement?.id || layer.id;
      }
    } else {
      layerSelectionRuntime.ids.add(layer.id);
      state.activeLayerId = layer.id;
    }
  } else {
    layerSelectionRuntime.ids.clear();
    layerSelectionRuntime.ids.add(layer.id);
    state.activeLayerId = layer.id;
  }
  layerSelectionRuntime.lastActiveId = state.activeLayerId || null;
}
function syncRuntimeLayerVisibility(layer, visible, reason = 'layer-visibility') {
  if (!layer) return false;
  const next = visible !== false;
  const changed = layer.visible !== next;
  layer.visible = next;

  const idx = (state.layers || []).indexOf(layer);
  if (idx >= 0) {
    const rt = runtimeState?.morph;
    for (const list of [
      rt?.frameLayers,
      rt?.lightLayers,
      runtimeState?.projectMorph?.frameRenderLayers,
      runtimeState?.minimalMorph?.sourceLayers,
      runtimeState?.minimalMorph?.targetLayers,
    ]) {
      const frame = Array.isArray(list) ? list[idx] : null;
      if (frame) frame.visible = next;
    }
  }
  try {
    if (changed && typeof invalidateLayerStyle === 'function') invalidateLayerStyle(layer, reason);
  } catch (error) {
    noteSuppressedError('ui/layer-selection#syncRuntimeLayerVisibility', error);
  }
  return changed;
}
function clearLayerIsolation(restorePrevious = false) {
  const iso = state.layerIsolation;
  if (!iso) return false;
  if (restorePrevious && iso.visibility && typeof iso.visibility === 'object') {
    for (const layer of state.layers) {
      if (Object.prototype.hasOwnProperty.call(iso.visibility, layer.id))
        syncRuntimeLayerVisibility(layer, iso.visibility[layer.id] !== false, 'layer-isolation-restore');
    }
  }
  state.layerIsolation = null;
  return true;
}
function toggleLayerIsolation(layer) {
  if (!layer) return;
  const current = state.layerIsolation;
  if (current?.layerId === layer.id) {
    clearLayerIsolation(true);
  } else {
    if (current) clearLayerIsolation(true);
    const visibility = {};
    for (const l of state.layers) visibility[l.id] = l.visible !== false;
    state.layerIsolation = { layerId: layer.id, visibility };
    for (const l of state.layers) syncRuntimeLayerVisibility(l, l.id === layer.id, 'layer-isolation');
    setSingleLayerSelection(layer);
  }
  syncSidebarInputs();
  updateLayerListUI();
  renderProfileEditor();
  renderMainCanvas();
}
function updateLayerListUI() {
  const listEl = document.getElementById('layerList');
  listEl.innerHTML = '';
  const selectedIds = syncLayerSelectionWithActive();
  const multiSelected = state.masterLayerEdit !== true && selectedIds.size > 1;

  state.layers.forEach((layer, idx) => {
    const isActive = layer.id === state.activeLayerId;
    const isSelected = multiSelected && selectedIds.has(layer.id);
    const isolated = state.layerIsolation?.layerId === layer.id;
    const item = document.createElement('div');
    item.className = `layer-item ${isActive ? 'active' : ''} ${isSelected ? 'selected' : ''} ${isolated ? 'isolated' : ''}`;
    item.title = 'ЛКМ — активный слой · Shift+ЛКМ — диапазон · Ctrl+ЛКМ — добавить/убрать слой';
    const visIcon = isolated ? '❗' : layer.visible ? '👁️' : '🙈';
    const visTitle = isolated
      ? 'Изолирован · ЛКМ: скрыть слой · ПКМ: вернуть прежнюю видимость слоёв'
      : 'ЛКМ: видимость · ПКМ: изолировать слой';

    item.innerHTML = `
                    <div style="display:flex; align-items:center; gap:8px; overflow:hidden;">
                        <button class="toggle-vis btn-icon" style="padding:0; width:16px; height:16px; border:none; background:transparent;" title="${visTitle}" aria-label="${visTitle}">
                            ${visIcon}
                        </button>
                        <span class="layer-list-color-dot" style="width:10px; height:10px; border-radius:50%; flex-shrink:0;"></span>
                        <span class="layer-list-name" style="truncate"></span>
                    </div>
                    <div style="display:flex; align-items:center; gap:2px;">
                        <button class="move-up btn-icon" style="padding:0; width:16px; height:16px; border:none; background:transparent;" title="Вверх">▲</button>
                        <button class="move-down btn-icon" style="padding:0; width:16px; height:16px; border:none; background:transparent;" title="Вниз">▼</button>
                    </div>
                `;
    // Project-provided names/colours must never enter innerHTML.
    item.querySelector('.layer-list-name').textContent = String(layer.name ?? '');
    item.querySelector('.layer-list-color-dot').style.backgroundColor = /^#[0-9a-f]{3,8}$/i.test(
      String(layer.strokeColor || ''),
    )
      ? layer.strokeColor
      : '#94a3b8';

    item.addEventListener('contextmenu', (e) => {
      if (!e.target.closest('.toggle-vis')) return;
      e.preventDefault();
      e.stopPropagation();
      toggleLayerIsolation(layer);
    });

    item.addEventListener('click', (e) => {
      if (e.target.closest('.toggle-vis')) {
        if (state.layerIsolation) clearLayerIsolation(false);
        syncRuntimeLayerVisibility(layer, layer.visible === false, 'layer-visibility-toggle');
        updateLayerListUI();
        renderMainCanvas();
        return;
      }
      if (e.target.closest('.move-up') && idx > 0) {
        const temp = state.layers[idx];
        state.layers[idx] = state.layers[idx - 1];
        state.layers[idx - 1] = temp;
        updateLayerListUI();
        renderMainCanvas();
        return;
      }
      if (e.target.closest('.move-down') && idx < state.layers.length - 1) {
        const temp = state.layers[idx];
        state.layers[idx] = state.layers[idx + 1];
        state.layers[idx + 1] = temp;
        updateLayerListUI();
        renderMainCanvas();
        return;
      }

      applyLayerListSelectionClick(layer, e);
      syncSidebarInputs();
      updateLayerListUI();
      renderProfileEditor();
      renderMainCanvas();
    });

    listEl.appendChild(item);
  });

  document.getElementById('layerCountBadge').textContent = state.layers.length;
  const masterBtn = document.getElementById('btnMasterLayer');
  if (masterBtn) {
    masterBtn.classList.toggle('active', state.masterLayerEdit === true);
    masterBtn.setAttribute('aria-pressed', state.masterLayerEdit === true ? 'true' : 'false');
  }
  syncMorphAllStrokeWidthUI();
  syncAudioRoutingLayerTabs();
}

export {
  getLayerBroadcastTargets,
  getLayerEditTargets,
  hasMultiLayerSelection,
  isAudioRotationOverrideActive,
  updateLayerListUI,
};
