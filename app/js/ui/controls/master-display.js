// Контролы: мастер и отображение.
import '../viewport-background.js'; // initialisation order: this module runs after it
import { renderProfileEditor } from '../profile-editor.js';
import { syncSidebarToolStates, syncSweepUI, syncWebOutlineUI } from '../effects-sidebar.js';
import { requestMainCanvasRender } from '../../core/scheduler.js';
import { state } from '../../core/state.js';
import { renderMainCanvas } from '../../render/main-pipeline.js';
import { getLayerBroadcastTargets, hasMultiLayerSelection, updateLayerListUI } from '../layer-selection.js';
import { syncSidebarInputs } from '../sidebar-sync.js';
import { masterLayerSnapshot, mirrorMasterLayerDiff, mirrorMasterLayerProps } from '../master-layer.js';
import {
  applyTransparentDesktopMode,
  bindSceneBlendControls,
  clearViewportBackgroundImage,
  openViewportBackgroundImagePicker,
  setViewportBackgroundImageFile,
} from '../viewport-background.js';

function bindMasterAndDisplayControls(bindingContext) {
  const getActiveLayer = bindingContext.getActiveLayer;
  document.getElementById('btnMasterLayer')?.addEventListener('click', () => {
    state.masterLayerEdit = state.masterLayerEdit !== true;
    if (!state.activeLayerId && state.layers[0]) state.activeLayerId = state.layers[0].id;
    // Do not synchronise layers when Master is merely enabled. Master only
    // broadcasts the one setting/path that the user changes after activation.
    updateLayerListUI();
    syncSidebarInputs();
    syncWebOutlineUI();
    syncSweepUI();
    syncSidebarToolStates();
    renderProfileEditor();
    requestMainCanvasRender();
  });

  // One Master transaction per user event. Capture the source and every
  // destination BEFORE the control handler, then commit AFTER all of its
  // handlers, while the event is still dispatching. Previously the
  // double-microtask mirror meant sliders (notably Line > Glow) changed
  // only the active layer synchronously; the other layers were updated
  // at a later checkpoint, after some render consumers had read them.
  const masterMirrorTransactions = new WeakMap();
  const masterDataSelector =
    '[data-rounding-mode],[data-spline-render-mode],[data-spiral-layerwise-rotation],[data-join],[data-line-main-mode],[data-line-marker-type],[data-graffiti-nib],[data-line-sprite-type],[data-lamp-position],[data-lamp-motion],[data-lamp-color-mode],[data-lamp-color]';
  // These controls already perform an explicit per-target multi-field edit.
  // Retain those intentional dependent edits rather than rolling them back.
  const masterDirectFanoutSelector =
    '[data-line-main-mode],[data-line-marker-type],[data-graffiti-nib],[data-line-sprite-type],[data-lamp-position],[data-lamp-motion],[data-lamp-color-mode],[data-lamp-color]';
  const masterMirrorHandler = (e) => {
    if (state.masterLayerEdit !== true && !hasMultiLayerSelection()) return;
    if (masterMirrorTransactions.has(e)) return;
    const source = state.layers.find((l) => l.id === state.activeLayerId);
    if (!source) return;
    const before = masterLayerSnapshot(source),
      beforeTargets = new Map();
    for (const layer of getLayerBroadcastTargets()) {
      if (layer && layer !== source) beforeTargets.set(layer.id, masterLayerSnapshot(layer));
    }
    const dataControl = e.target?.closest?.(masterDataSelector);
    const tx = {
      sourceId: source.id,
      beforeTargets,
      controlId: e?.target?.id || e?.target?.closest?.('[id]')?.id || '',
      eventType: e.type || '',
      controlValue: e?.target?.value,
      controlChecked: e?.target?.checked,
      controlDataset: dataControl ? { ...dataControl.dataset } : null,
      directFanout: !!e.target?.closest?.(masterDirectFanoutSelector),
      before,
      committed: false,
    };
    masterMirrorTransactions.set(e, tx);
    // stopPropagation() is used by a few custom controls. They cannot
    // reach the window bubble listener, so preserve a fallback commit.
    // A macrotask, not a microtask: for real (trusted) user events the browser runs a
    // microtask checkpoint after EACH listener, so a microtask fallback committed right after
    // this capture listener, before the control's own handler had changed the layer. Master
    // then copied the old value to the other layers (it worked only for scripted events).
    setTimeout(() => {
      if (!tx.committed) commitMasterMirror(e);
    }, 0);
  };
  const commitMasterMirror = (e) => {
    const tx = masterMirrorTransactions.get(e);
    if (!tx || tx.committed) return;
    tx.committed = true;
    mirrorMasterLayerDiff(tx.before, tx);
  };
  // Capture runs before field listeners. Window bubble runs AFTER target
  // and document listeners, so the changed-path fan-out finishes before
  // dispatchEvent() returns and before the next render frame is built.
  // This central route covers sliders, numbers, selects, checkboxes,
  // buttons, palette controls and synthetic input/change events.
  for (const type of ['input', 'change', 'click']) {
    document.addEventListener(type, masterMirrorHandler, true);
    window.addEventListener(type, commitMasterMirror, false);
  }
  // Direct pointer editors may commit values on release without firing
  // an input/change event (the regular fields still use the routes above).
  document.addEventListener('pointerup', masterMirrorHandler, true);
  window.addEventListener('pointerup', commitMasterMirror, false);
  const masterProfileCanvas = document.getElementById('profileCanvas');
  const mirrorProfileCanvas = () => {
    if (state.masterLayerEdit === true || hasMultiLayerSelection())
      queueMicrotask(() => mirrorMasterLayerProps(['profileMode', 'profileNodes']));
  };
  masterProfileCanvas?.addEventListener('pointerup', mirrorProfileCanvas);
  masterProfileCanvas?.addEventListener('mouseup', mirrorProfileCanvas);

  document.getElementById('paramBgColor').addEventListener('input', (e) => {
    state.bgColor = e.target.value;
    const bgDot = document.getElementById('bgColorDot');
    if (bgDot) bgDot.style.background = state.bgColor;
    requestMainCanvasRender();
  });

  document.getElementById('btnBackgroundImage')?.addEventListener('click', openViewportBackgroundImagePicker);
  document.getElementById('backgroundImageInput')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) {
      if (state.transparentDesktop === true) applyTransparentDesktopMode(false, true);
      setViewportBackgroundImageFile(file);
    }
  });
  document.getElementById('btnClearBackgroundImage')?.addEventListener('click', clearViewportBackgroundImage);

  bindSceneBlendControls();

  document.getElementById('paramBoundingCircleColor').addEventListener('input', (e) => {
    state.boundingCircleColor = e.target.value;
    const circleDot = document.getElementById('boundingCircleColorDot');
    if (circleDot) circleDot.style.background = state.boundingCircleColor;
    requestMainCanvasRender();
  });

  document.getElementById('paramShowGrid').addEventListener('change', (e) => {
    state.showGrid = e.target.checked;
    renderMainCanvas();
  });

  document.getElementById('paramShowRoundingGuides').addEventListener('change', (e) => {
    state.roundingGuidesOverlayEnabled = e.target.checked;
    state.showRoundingGuides = false; // strict GPU path must not change for construction guides
    document
      .getElementById('roundingGuideControls')
      ?.classList.toggle('hidden', !state.roundingGuidesOverlayEnabled);
    renderMainCanvas();
  });

  document.getElementById('paramRoundingGuidesDashed').addEventListener('change', (e) => {
    state.roundingGuidesDashed = e.target.checked;
    renderMainCanvas();
  });

  document.getElementById('paramRoundingGuideColor').addEventListener('input', (e) => {
    state.roundingGuideColor = e.target.value;
    requestMainCanvasRender();
  });
  document.getElementById('paramRoundingGuideOpacity').addEventListener('input', (e) => {
    state.roundingGuideOpacity = Number(e.target.value) || 0;
    document.getElementById('valRoundingGuideOpacity').textContent =
      `${Math.round(state.roundingGuideOpacity)}%`;
    requestMainCanvasRender();
  });

  document.getElementById('paramShowBoundingCircle').addEventListener('change', (e) => {
    state.showBoundingCircle = e.target.checked;
    renderMainCanvas();
  });
}

export { bindMasterAndDisplayControls };
