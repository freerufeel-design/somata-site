// Мастер-слой: зеркалирование свойств на выбранные слои, N/K/суборбиты, пресеты профиля.
import './blue-morph/profiles.js'; // initialisation order: this module runs after it
import { renderProfileEditor } from './profile-editor.js';
import {
  contourModeIsSpiral,
  getContourMode,
  getEffectiveSpiralOrder,
  isSpiralLayer,
  normalizeSpiralStep,
} from '../geometry/spiral/order-params.js';
import { syncParticleUI } from '../effects/effect-animation.js';
import { syncLampSettingsUI, syncSweepUI, syncWebOutlineUI } from './effects-sidebar.js';
import {
  DEFAULT_FILL_OPACITY_PERCENT,
  colorBaseHex6,
  ensureLayerEffectState,
  gcd,
  getFillOpacityPercent,
  getLayerSweepConfig,
  markLayerEffectChanged,
  setFillOpacityPercent,
  syncLayerFillColorToStroke,
} from '../core/defaults-layers.js';
import {
  invalidateLayerGeometry,
  invalidateLayerProperties,
  setPreSampledSplineLayer,
} from '../core/render-runtime.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { runtimeState, state } from '../core/state.js';
import { renderMainCanvas } from '../render/main-pipeline.js';
import { SomataMasterBroadcastCore } from './master-broadcast-core.js';
import {
  PROFILE_PRESETS,
  PROFILE_PRESET_META,
  getProfilePresetGroupForKey,
  renderProfilePresetLibrary,
  setActiveProfilePresetGroup,
} from './profile-presets.js';
import {
  getLayerBroadcastTargets,
  hasMultiLayerSelection,
  isAudioRotationOverrideActive,
  updateLayerListUI,
} from './layer-selection.js';
import { isSpiralLayerMorphEnabled } from '../morph-runtime/morph-mode.js';
import { syncSidebarInputs } from './sidebar-sync.js';
import { activeRebaseMorphing } from '../morph-runtime/morph-hooks.js';

function cloneMasterLayerValue(value) {
  return SomataMasterBroadcastCore.clone(value);
}
const MASTER_GEOMETRY_PROPS = new Set([
  'N',
  'K',
  'customSuborbits',
  'chaosStar',
  'chaosStepMinus',
  'chaosStepPlus',
  'chaosClosures',
  'chaosSeed',
  'closedLoop',
  'lineJoinType',
  'rounding',
  'roundingMode',
  'roundingShape',
  'roundingCornerType',
  'fourierStrength',
  'roundingMaxRadiusDrop',
  'roundingSmoothSplines',
  'radius',
  'radiusMultiplier',
  'rotation',
  'profileMode',
  'profileNodes',
  'splineRenderMode',
  'wholeCurveSpline',
  'spiralEnabled',
  'spiralOrder',
  'spiralSquashY',
  'spiralRememberedOrder',
  'spiralConstructionMode',
  'spiralZeroTransitionMode',
  'spiralRotationFocus',
  'spiralManualFocus',
  'spiralRotationFocusFigure',
  'spiralClosed',
  'spiralStep',
  'spiralStepLinked',
  'spiralStepLimiterEnabled',
  'spiralStepLimiter',
  'spiralTwist',
  'spiralTangential',
  'spiralRoundSeams',
  'spiralFillEnabled',
  'spiralFillType',
  'geometryCircles',
]);
function mirrorMasterLayerProps(props) {
  if (!Array.isArray(props) || !props.length) return;
  if (state.masterLayerEdit !== true && !hasMultiLayerSelection()) return;
  const source = state.layers.find((l) => l.id === state.activeLayerId);
  if (!source) return;
  for (const layer of getLayerBroadcastTargets()) {
    if (layer === source) continue;
    for (const prop of props) {
      if (Object.prototype.hasOwnProperty.call(source, prop))
        layer[prop] = cloneMasterLayerValue(source[prop]);
    }
    if (typeof invalidateLayerProperties === 'function')
      invalidateLayerProperties(layer, props, 'master-mirror');
    else if (props.some((prop) => MASTER_GEOMETRY_PROPS.has(prop)))
      invalidateLayerGeometry(layer, 'master-mirror');
    syncMasterPathsIntoBlueRuntime(layer, props, masterLayerSnapshot(layer));
  }
  syncMasterPathsIntoBlueRuntime(source, props, masterLayerSnapshot(source));
  updateLayerListUI();
  requestMainCanvasRender();
}
const MASTER_LAYER_SNAPSHOT_EXCLUDED = new Set(['id', 'name', 'visible']);
const MASTER_LAYER_RUNTIME_PATHS = new Set([
  'sweep.phase',
  'sweep.currentVelocity',
  'sweep.lastUpdate',
  'sweep.cycleCount',
  'sweep.lightningPhase',
  'sweep.lightningLastUpdate',
  'sweep.lightningCycleCount',
  'sweep.raf',
]);
function masterLayerSnapshot(layer) {
  const out = {};
  if (!layer || typeof layer !== 'object') return out;
  for (const [key, value] of Object.entries(layer)) {
    if (MASTER_LAYER_SNAPSHOT_EXCLUDED.has(key) || key.startsWith('__') || typeof value === 'function')
      continue;
    out[key] = cloneMasterLayerValue(value);
  }
  return out;
}
function collectMasterChangedPaths(before, after, prefix = '', out = []) {
  const paths = SomataMasterBroadcastCore.collectChangedPaths(before, after, {
    prefix,
    runtimePaths: MASTER_LAYER_RUNTIME_PATHS,
  });
  out.push(...paths);
  return out;
}
function masterPathValue(root, path) {
  return SomataMasterBroadcastCore.valueAt(root, path);
}
function applyMasterPath(target, path, value) {
  SomataMasterBroadcastCore.applyPath(target, path, value);
}
function masterPathOwnedByBlueMorph(path) {
  if (runtimeState?.morph?.active !== true) return false;
  const root = String(path || '').split('.')[0];
  const opt = state.morph?.options || {};
  if (
    root === 'profileMode' ||
    root === 'profileNodes' ||
    root === 'closedLoop' ||
    root === 'splineRenderMode' ||
    root === 'wholeCurveSpline'
  )
    return opt.byShape === true;
  if (root === 'N') return opt.byVertices === true;
  if (
    [
      'K',
      'customSuborbits',
      'chaosStar',
      'chaosStepMinus',
      'chaosStepPlus',
      'chaosClosures',
      'chaosSeed',
    ].includes(root)
  )
    return opt.bySteps === true || opt.byVertices === true || state.morph?.chaosMorphEnabled === true;
  if (root === 'radius' || root === 'radiusMultiplier') return opt.bySize === true;
  if (root === 'rotation') return opt.byRotation === true && !isAudioRotationOverrideActive();
  if (root === 'spiralEnabled' || root === 'spiralOrder') return isSpiralLayerMorphEnabled();
  if (root === 'rounding') return opt.byRounding === true;
  if (root === 'strokeColor') return opt.byColor === true || state.morph?.morphGlobalHueOffset === true;
  if (root === 'strokeWidth' || root === 'strokeWidthMultiplier') return opt.byStrokeWidth === true;

  if (
    root === 'glow' ||
    root === 'glowMultiplier' ||
    root === 'glowIntensity' ||
    root === 'glowIntensityMultiplier'
  )
    return false;
  if (root === 'opacity') return opt.byOpacity === true;
  if (root === 'fill' || root === 'fillColor' || root === 'fillMatchStroke' || root === 'fillRule')
    return opt.byFillColor === true;
  return false;
}
function syncMasterPathsIntoBlueRuntime(layer, paths, snapshot) {
  if (runtimeState?.morph?.active !== true || !layer || !Array.isArray(paths) || !paths.length) return;
  const idx = state.layers.findIndex((item) => item?.id === layer.id);
  if (idx < 0) return;
  const livePaths = paths.filter((path) => !masterPathOwnedByBlueMorph(path));
  if (!livePaths.length) return;
  const rt = runtimeState.morph;
  const runtimeCopies = [
    rt.frameLayers?.[idx],
    rt.lightLayers?.[idx],
    rt.renderSourceLayers?.[idx],
    rt.renderTargetLayers?.[idx],
  ];
  for (const copy of runtimeCopies) {
    if (!copy || typeof copy !== 'object') continue;
    for (const path of livePaths) applyMasterPath(copy, path, masterPathValue(snapshot, path));
  }

  for (const visuals of [rt.sourceVisuals?.[idx], rt.targetVisuals?.[idx]]) {
    if (!visuals || typeof visuals !== 'object') continue;
    for (const path of livePaths) {
      const root = path.split('.')[0];
      if (Object.prototype.hasOwnProperty.call(visuals, root))
        applyMasterPath(visuals, path, masterPathValue(snapshot, path));
    }
  }
  if (livePaths.some((path) => MASTER_GEOMETRY_PROPS.has(path.split('.')[0]))) {
    rt.lightGeometryBucket = -1;
    if (Array.isArray(rt.lightDrawData)) rt.lightDrawData[idx] = null;
  }
}
function mirrorMasterLayerDiff(beforeSnapshot, tx = null) {
  if (state.masterLayerEdit !== true && !hasMultiLayerSelection()) return;
  const sourceId = tx?.sourceId || state.activeLayerId;
  const source = state.layers.find((l) => l.id === sourceId);
  if (!source) return;
  let after = masterLayerSnapshot(source);
  const sourcePaths = collectMasterChangedPaths(beforeSnapshot || {}, after);
  const controlId = String(tx?.controlId || '');
  const ownedPaths = SomataMasterBroadcastCore.controlPaths(controlId, after, tx?.controlDataset);
  // These editor panels still hydrate several form fields on each event.
  // An interaction with a single slider/color/selector must never
  // turn those incidental writes into edits to other layer properties.
  const strictFieldEdit =
    /^(?:sweep|particle|lamp|web)[A-Z]/.test(controlId) &&
    (tx?.eventType === 'input' || tx?.eventType === 'change') &&
    tx?.directFanout !== true &&
    ownedPaths.length > 0;
  let sourceRolledBackExtras = 0;
  if (strictFieldEdit) {
    const owned = new Set(ownedPaths);
    for (const path of sourcePaths) {
      if (owned.has(path)) continue;
      applyMasterPath(source, path, masterPathValue(beforeSnapshot, path));
      sourceRolledBackExtras++;
    }
    if (sourceRolledBackExtras) after = masterLayerSnapshot(source);
  }
  // Master mirrors the user-facing field, not an implementation detail that happens
  // to share storage with it. Fill opacity/RGB are packed into fillColor, and
  // fill-match derives RGB from each layer's own stroke color, so these controls need
  // field semantics rather than blind object/string copying.
  let paths = strictFieldEdit ? ownedPaths.slice() : sourcePaths.slice();
  if (controlId === 'showSweep' || controlId === 'showLightning')
    paths = paths.filter((path) => path !== 'sweep.enabled');
  // Also apply the explicitly edited field when it already had this
  // value on the source. A no-op source edit is still an all-layer
  // assignment in Master (e.g. Glow: 9 / 1 / 4 -> 9 / 9 / 9).
  for (const field of SomataMasterBroadcastCore.controlPaths(controlId, after, tx?.controlDataset)) {
    if (!paths.includes(field)) paths.push(field);
  }
  if (controlId === 'paramFillMatchStroke') paths = paths.filter((path) => path === 'fillMatchStroke');
  else if (controlId === 'paramEnableFill') paths = paths.filter((path) => path === 'fill');
  else if (
    (controlId === 'paramStrokeColor' || sourcePaths.includes('strokeColor')) &&
    after.fillMatchStroke === true &&
    sourcePaths.includes('fillColor')
  )
    paths = paths.filter((path) => path !== 'fillColor');
  const pathSet = new Set(paths);
  const roots = [...new Set(paths.map((path) => path.split('.')[0]).filter(Boolean))];

  // Master is a strict field-broadcast transaction. Some legacy UI handlers still
  // touch target layers directly or copy a whole logical block. Roll those target-side
  // mutations back first, then apply only the paths that actually changed on the source.
  // This makes "Master" mean: edit one field on the active layer -> same field/value on
  // every layer; unrelated per-layer state must survive the interaction unchanged.
  const beforeTargets = tx?.beforeTargets instanceof Map ? tx.beforeTargets : null;
  let rolledBackExtras = 0,
    directFanoutChanges = 0;
  for (const layer of getLayerBroadcastTargets()) {
    if (layer === source) continue;
    ensureLayerEffectState(layer);
    const beforeTarget = beforeTargets?.get(layer.id) || null;
    if (beforeTarget) {
      const targetNow = masterLayerSnapshot(layer);
      const targetChanged = collectMasterChangedPaths(beforeTarget, targetNow);
      for (const path of targetChanged) {
        if (pathSet.has(path)) continue;
        // These button handlers explicitly edit ALL target layers.
        // Do not undo their dependent mode fields just because the
        // source was already in that mode (line Point/Sprite was
        // particularly affected by the old rollback).
        if (tx?.directFanout === true) {
          directFanoutChanges++;
          continue;
        }
        applyMasterPath(layer, path, masterPathValue(beforeTarget, path));
        rolledBackExtras++;
      }
      if (tx?.directFanout === true && targetChanged.length) {
        invalidateLayerProperties(
          layer,
          [...new Set(targetChanged.map((path) => path.split('.')[0]))],
          'master-direct-fanout',
        );
        syncMasterPathsIntoBlueRuntime(layer, targetChanged, masterLayerSnapshot(layer));
      }
    }
    for (const path of paths) {
      if (path === 'fillColor' && controlId === 'paramFillOpacity') {
        const pct = getFillOpacityPercent(after.fillColor);
        const base =
          masterPathValue(beforeTarget || masterLayerSnapshot(layer), 'fillColor') ||
          layer.fillColor ||
          layer.strokeColor;
        layer.fillColor = setFillOpacityPercent(base, pct, layer.strokeColor || '#4f46e5');
      } else if (path === 'fillColor' && controlId === 'paramFillColor') {
        const pct = getFillOpacityPercent(
          masterPathValue(beforeTarget || masterLayerSnapshot(layer), 'fillColor') || layer.fillColor,
        );
        const rgb = colorBaseHex6(after.fillColor, after.strokeColor || '#4f46e5');
        layer.fillColor = setFillOpacityPercent(rgb, pct, rgb);
      } else applyMasterPath(layer, path, masterPathValue(after, path));
    }
    // Glint and Lightning share an effective sweep.enabled flag.
    // It is computed per destination from BOTH switches, not copied
    // from the source (the other switch may differ on each layer).
    if (controlId === 'showSweep' || controlId === 'showLightning') {
      const cfg = getLayerSweepConfig(layer);
      cfg.enabled = cfg.glintEnabled === true || cfg.lightningEnabled === true;
      cfg.effectType = controlId === 'showLightning' ? 'lightning' : 'glint';
      markLayerEffectChanged(layer, 'master-sweep-switch');
    }
    if (['webInside', 'webOutsideStraight', 'webOutsideArc'].includes(controlId) && layer.web) {
      layer.web.region = layer.web.inside
        ? layer.web.outsideStraight || layer.web.outsideArc
          ? 'combined'
          : 'inside'
        : layer.web.outsideStraight || layer.web.outsideArc
          ? 'outside'
          : 'inside';
    }
    if (
      controlId === 'paramFillMatchStroke' &&
      paths.includes('fillMatchStroke') &&
      layer.fillMatchStroke === true &&
      typeof syncLayerFillColorToStroke === 'function'
    )
      syncLayerFillColorToStroke(layer, true);
    if (
      (controlId === 'paramStrokeColor' || paths.includes('strokeColor')) &&
      layer.fillMatchStroke === true &&
      typeof syncLayerFillColorToStroke === 'function'
    )
      syncLayerFillColorToStroke(layer, true);
    if (
      controlId === 'paramEnableFill' &&
      paths.includes('fill') &&
      layer.fill === true &&
      getFillOpacityPercent(layer.fillColor, 0) <= 0.001
    )
      layer.fillColor = setFillOpacityPercent(
        layer.fillColor || layer.strokeColor,
        DEFAULT_FILL_OPACITY_PERCENT,
        layer.strokeColor || '#4f46e5',
      );

    if (paths.length) {
      if (typeof invalidateLayerProperties === 'function')
        invalidateLayerProperties(layer, roots, 'master-auto-mirror');
      else if (roots.some((prop) => MASTER_GEOMETRY_PROPS.has(prop)))
        invalidateLayerGeometry(layer, 'master-auto-mirror');
      syncMasterPathsIntoBlueRuntime(layer, paths, masterLayerSnapshot(layer));
    }
  }
  if (paths.length) {
    // A few legacy source controls update their field without a
    // matching dirty-domain notification. Master must invalidate
    // all physical render owners, including the source layer.
    invalidateLayerProperties(source, roots, 'master-source');
    syncMasterPathsIntoBlueRuntime(source, paths, after);
  }
  if (sourceRolledBackExtras) {
    // Re-hydrate stale controls after discarding accidental panel-wide
    // changes. These sync functions only update the DOM, not layer data.
    if (controlId.startsWith('sweep')) syncSweepUI();
    else if (controlId.startsWith('lamp')) syncLampSettingsUI();
    else if (controlId.startsWith('particle')) syncParticleUI();
    else if (controlId.startsWith('web')) syncWebOutlineUI();
  }
  window.__spiroLastMasterBroadcast = {
    sourceId,
    controlId: String(tx?.controlId || ''),
    eventType: String(tx?.eventType || ''),
    paths: paths.slice(),
    sourcePaths: sourcePaths.slice(),
    rolledBackExtras,
    sourceRolledBackExtras,
    directFanoutChanges,
    at: performance.now(),
  };
  if (paths.length || rolledBackExtras || directFanoutChanges) {
    updateLayerListUI();
    requestMainCanvasRender();
  }
}
function setLayerN(val) {
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!layer) return;
  val = Math.max(2, Math.min(120, parseInt(val) || 2));
  layer.N = val;
  if (layer.K > Math.floor(val / 2)) {
    layer.K = Math.max(1, Math.floor(val / 2));
  }
  layer.customSuborbits = null;
  layer.chaosClosures = Math.max(1, Math.min(layer.N, Math.round(Number(layer.chaosClosures) || 1)));
  // N changes do not change the external-layer winding order.
  layer.spiralStepLinked = true;
  layer.spiralStep = normalizeSpiralStep(layer.K, layer);

  invalidateLayerGeometry(layer, 'set-N');
  syncSidebarInputs();
  if (runtimeState.morph.active) activeRebaseMorphing();
  requestMainCanvasRender();
}
function setLayerK(val) {
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!layer) return;
  const maxK = Math.max(1, Math.floor(layer.N / 2));
  val = Math.max(1, Math.min(maxK, parseInt(val) || 1));
  layer.K = val;
  layer.customSuborbits = null;
  // K is the polygon connection step; it does not set winding order.
  layer.spiralStepLinked = true;
  layer.spiralStep = normalizeSpiralStep(layer.K, layer);

  invalidateLayerGeometry(layer, 'set-K');
  syncSidebarInputs();
  if (runtimeState.morph.active) activeRebaseMorphing({ preservePaths: ['K', 'customSuborbits', 'spiralStepLinked', 'spiralStep'] });
  requestMainCanvasRender();
}
function setLayerSuborbits(targetS) {
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!layer) return;

  const maxS = gcd(layer.N, layer.K);
  targetS = Math.max(1, Math.min(maxS, parseInt(targetS) || 1));
  layer.customSuborbits = targetS;

  invalidateLayerGeometry(layer, 'set-suborbits');
  syncSidebarInputs();
  if (runtimeState.morph.active) activeRebaseMorphing();
  requestMainCanvasRender();
}
function applyProfilePresetGeometryToLayer(layer, presetKey) {
  const preset = layer && PROFILE_PRESETS[presetKey];
  if (!layer || !preset) return false;
  const meta = PROFILE_PRESET_META[presetKey] || {};
  const contourModeBefore = getContourMode(layer);
  const keepSpiralMode = contourModeIsSpiral(contourModeBefore);
  const spiralClosedBefore = layer.spiralClosed !== false;
  const spiralEnabledBefore = isSpiralLayer(layer);
  const spiralOrderBefore = getEffectiveSpiralOrder(layer);
  layer.profileMode = preset.mode;
  if (preset.mode === 'spline') layer.splineRenderMode = 'smooth';
  layer.profileNodes = JSON.parse(JSON.stringify(preset.nodes));
  if (!keepSpiralMode && typeof meta.closed === 'boolean') layer.closedLoop = meta.closed;
  if (keepSpiralMode) {
    layer.spiralEnabled = spiralEnabledBefore;
    layer.spiralClosed = spiralClosedBefore;
    layer.spiralOrder = spiralOrderBefore;
    layer.closedLoop = false;
  }
  setPreSampledSplineLayer(layer, false);
  return true;
}
function applyProfilePresetByKey(presetKey) {
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (applyProfilePresetGeometryToLayer(layer, presetKey)) {
    invalidateLayerGeometry(layer, 'profile-preset');
    setActiveProfilePresetGroup(getProfilePresetGroupForKey(presetKey));
    syncSidebarInputs();
    renderProfilePresetLibrary(presetKey);
    renderProfileEditor();
    renderMainCanvas();
    activeRebaseMorphing();
  }
}

export {
  applyMasterPath,
  applyProfilePresetByKey,
  cloneMasterLayerValue,
  collectMasterChangedPaths,
  masterLayerSnapshot,
  masterPathValue,
  mirrorMasterLayerDiff,
  mirrorMasterLayerProps,
  setLayerK,
  setLayerN,
  setLayerSuborbits,
  syncMasterPathsIntoBlueRuntime,
};
