// Контролы: геометрия и стиль слоя.
import { recentManualGeometryIntent } from '../../app/geometry-monitor-origin.js';
import './master-display.js'; // initialisation order: this module runs after it
import { syncRoundingModeHelp } from '../effects-sidebar.js';
import {
  contourModeIsSpiral,
  getEffectiveSpiralOrder,
  normalizeSpiralStep,
  setContourMode,
  setUnifiedContourClosed,
  setUnifiedSpiralOrder,
} from '../../geometry/spiral/order-params.js';
import { normalizeSpiralSquashY } from '../../geometry/orbit-builder.js';
import { WebGPUDeviceHub } from '../../gpu/device-hub.js';
import { WebGPUFinalCompositeRenderer } from '../../gpu/final-composite-renderer.js';
import { WebGPUStrokeRenderer } from '../../gpu/stroke-renderer.js';
import {
  DEFAULT_FILL_OPACITY_PERCENT,
  colorBaseHex6,
  gcd,
  getFillOpacityPercent,
  getLayerFillMatchStroke,
  getLayerFillModeChoice,
  normalizeLayerFillFadeDirection,
  setFillOpacityPercent,
  setLayerFillModeChoice,
  setLayerStrokeColor,
  syncLayerFillColorToStroke,
} from '../../core/defaults-layers.js';
import { clampRoundingPercent } from '../../core/palette.js';
import {
  invalidateLayerEffect,
  invalidateLayerGeometry,
  invalidateLayerProperties,
} from '../../core/render-runtime.js';
import { requestMainCanvasRender } from '../../core/scheduler.js';
import { runtimeState, state } from '../../core/state.js';
import { getLayerGlowIntensityMultiplier, getLayerRadiusMultiplier } from '../../effects/motion.js';
import { warmupGpuMorphArcResource } from '../../gpu/morph-arc-resource.js';
import { WebGPUProfileArcMarkerRenderer } from '../../gpu/profile-arc-marker-renderer.js';
import { WebGPUSpiralBezierMorphRenderer } from '../../gpu/spiral-bezier-morph-renderer.js';
import { FillMeshPreparer } from '../../render/fill-plan.js';
import { renderMainCanvas } from '../../render/main-pipeline.js';
import { setSidebarValueText } from '../../app/app-paths.js';
import { getLayerEditTargets, hasMultiLayerSelection, updateLayerListUI } from '../layer-selection.js';
import {
  formatDisplayNumber,
  geometryNEffectiveFromBase,
  linkNMultiplierToMorph,
} from '../geometry-n-control.js';
import { syncSidebarInputs } from '../sidebar-sync.js';
import { renderParameterRoutingPopup } from '../parameter-routing-popup.js';
import {
  mirrorMasterLayerProps,
  setLayerK,
  setLayerN,
  setLayerSuborbits,
  syncMasterPathsIntoBlueRuntime,
} from '../master-layer.js';
import { activeRebaseMorphing, morphSidebarRebaseRuntime } from '../../morph-runtime/morph-hooks.js';
import { syncMorphAllStrokeWidthUI } from '../morph-settings-panel.js';
import { logarithmicStep } from '../number-steppers.js';
import { noteSuppressedError } from '../../core/suppressed-errors.js';

function bindLayerGeometryAndStyleControls(bindingContext) {
  const getActiveLayer = bindingContext.getActiveLayer;
  const applyCompactN = (baseValue) => setLayerN(geometryNEffectiveFromBase(baseValue));
  document.getElementById('paramN').addEventListener('input', (e) => {
    const num = document.getElementById('numN');
    if (num) num.value = e.target.value;
    applyCompactN(e.target.value);
  });
  document.getElementById('numN').addEventListener('change', (e) => {
    const range = document.getElementById('paramN');
    if (range) range.value = e.target.value;
    applyCompactN(e.target.value);
  });
  document.getElementById('paramNMultiplier')?.addEventListener('input', () => {
    applyCompactN(document.getElementById('paramN')?.value);
  });
  document.getElementById('paramNMultiplier')?.addEventListener('change', () => {
    applyCompactN(document.getElementById('paramN')?.value);
    linkNMultiplierToMorph(); // одна величина с множителем вершин в синем Morph
  });
  // The numeric order field remains editable WHILE Blue Morph runs.
  // Rebase from the visible frame while preserving the user's value;
  // otherwise the Blue frame commit would overwrite this edit.
  document.getElementById('paramSpiralSquashY')?.addEventListener('input', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const value = normalizeSpiralSquashY(e.target.value);
    document.getElementById('spiralSquashYValue').textContent = `${value}%`;
    if (value === normalizeSpiralSquashY(layer.spiralSquashY)) return;
    layer.spiralSquashY = value;
    invalidateLayerGeometry(layer, 'spiral-squash-y');
    syncMasterPathsIntoBlueRuntime(layer, ['spiralSquashY'], layer);
    mirrorMasterLayerProps(['spiralSquashY']);
    requestMainCanvasRender();
  });
  const spiralOrderControl = document.getElementById('paramSpiralOrder');
  const applyManualSpiralOrder = (e) => {
    let needsRebase = false;
    const layer = state.layers.find((l) => l.id === state.activeLayerId);
    const raw = String(e.target.value).trim().replace(',', '.');
    if (!layer) return;
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) {
      e.target.value = String(getEffectiveSpiralOrder(layer));
      return;
    }
    const previousOrder = getEffectiveSpiralOrder(layer);
    setUnifiedSpiralOrder(layer, raw);
    // Start the finite edit from the previous *displayed* geometry,
    // not from the newly assigned authored order. The duration is
    // Geometry > Animation > Длительность, and the speed curve is
    // shared with the Blue Morph speed selector.
    if (Math.abs(previousOrder - getEffectiveSpiralOrder(layer)) > 1e-9) {
      const calibration = SomataSpiralZeroTransition.isCalibrationEdit(
        previousOrder,
        getEffectiveSpiralOrder(layer),
      );
      if (calibration && !runtimeState.morph.active) {
        window.SomataTestMorph?.settleManualOrder?.(layer);
      } else if (
        runtimeState.morph.active ||
        layer.testMorph?.syncWithMorph === true ||
        window.SomataTestMorph?.independentOrderTarget?.(layer.id) != null
      ) {
        const handled = window.SomataTestMorph?.beginIndependentOrderEdit?.(
          layer,
          previousOrder,
          getEffectiveSpiralOrder(layer),
        );
        needsRebase =
          !handled &&
          runtimeState.morph.active &&
          window.SomataTestMorph?.independentOrderTarget?.(layer.id) == null
            ? layer.id
            : null;
      } else if (window.SomataSpiralZeroTransition.staticOrder(getEffectiveSpiralOrder(layer)))
        window.SomataTestMorph?.settleManualOrder?.(layer);
      else window.SomataTestMorph?.prepareManualOrderEdit?.(layer, previousOrder);
    }
    const tangentControl = document.getElementById('paramSpiralTangential');
    if (tangentControl) {
      tangentControl.disabled = false;
      tangentControl.checked = layer.spiralTangential === true;
    }
    document
      .getElementById('spiralTangentialRow')
      ?.classList.toggle('spiral-setting-inactive', Math.abs(layer.spiralOrder) <= 1e-8);
    invalidateLayerGeometry(layer, 'manual-spiral-order-blue-preview');
    // Fractional calibration is already committed through the
    // order channel. Only the legacy fallback rebases Blue.
    if (needsRebase && runtimeState.morph.active)
      activeRebaseMorphing({ preservePaths: ['spiralOrder', 'spiralEnabled', 'closedLoop'] });
    e.target.value = String(layer.spiralOrder);
    syncSidebarInputs();
    requestMainCanvasRender();
  };
  document.getElementById('spiralOrderControl')?.addEventListener(
    'contextmenu',
    (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      renderParameterRoutingPopup('spiral.order', e.clientX, e.clientY);
    },
    true,
  );
  const stepSpiralOrder = (direction) => {
    const layer = getActiveLayer();
    if (!layer || !spiralOrderControl) return;
    spiralOrderControl.value = String(
      SomataSpiralZeroTransition.stepOrder(getEffectiveSpiralOrder(layer), direction),
    );
    applyManualSpiralOrder({ target: spiralOrderControl });
  };
  spiralOrderControl?.addEventListener('change', applyManualSpiralOrder);
  spiralOrderControl?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      e.target.blur();
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      stepSpiralOrder(e.key === 'ArrowUp' ? 1 : -1);
    }
  });
  document.getElementById('spiralOrderUp')?.addEventListener('click', () => stepSpiralOrder(1));
  document.getElementById('spiralOrderDown')?.addEventListener('click', () => stepSpiralOrder(-1));
  // Presentation-only Focus: an absolute figure index, not a percent.
  // Changing it must neither rebase morph anchors nor build GPU geometry.
  const syncFocusFigure = (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const v = Number(e.target.value);
    const max = Math.max(1, Math.round(Number(e.target.max) || 1));
    layer.spiralRotationFocusFigure = Math.max(1, Math.min(max, Math.round(Number.isFinite(v) ? v : 7)));
    mirrorMasterLayerProps(['spiralRotationFocusFigure']);
    for (const id of ['paramSpiralRotationFocus', 'tunnelFocusNumber']) {
      const el = document.getElementById(id);
      if (el && el !== e.target) el.value = String(layer.spiralRotationFocusFigure);
    }
    for (const id of ['spiralFocusPercentText', 'tunnelFocusPercentText']) {
      const el = document.getElementById(id);
      if (el) el.textContent = `№${layer.spiralRotationFocusFigure}`;
    }
    requestMainCanvasRender();
  };
  for (const id of ['paramSpiralRotationFocus', 'tunnelFocusNumber']) {
    const el = document.getElementById(id);
    el?.addEventListener('input', syncFocusFigure);
    el?.addEventListener(
      'contextmenu',
      (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        renderParameterRoutingPopup('spiral.focusFigure', e.clientX, e.clientY);
      },
      true,
    );
  }
  for (const id of ['paramSpiralManualFocus', 'tunnelManualFocus'])
    document.getElementById(id)?.addEventListener('change', (e) => {
      const layer = getActiveLayer();
      if (!layer) return;
      layer.spiralManualFocus = e.target.checked === true;
      mirrorMasterLayerProps(['spiralManualFocus']);
      for (const other of ['paramSpiralManualFocus', 'tunnelManualFocus']) {
        const el = document.getElementById(other);
        if (el) el.checked = layer.spiralManualFocus;
      }
      for (const other of ['spiralManualFocusControls', 'tunnelManualFocusControls'])
        document.getElementById(other)?.classList.toggle('hidden', !layer.spiralManualFocus);
      requestMainCanvasRender();
    });
  for (const id of ['paramSpiralFocusHighlight', 'tunnelFocusHighlight'])
    document.getElementById(id)?.addEventListener('change', (e) => {
      const layer = getActiveLayer();
      if (!layer) return;
      layer.corridorFocusHighlight = e.target.checked === true;
      mirrorMasterLayerProps(['corridorFocusHighlight']);
      for (const other of ['paramSpiralFocusHighlight', 'tunnelFocusHighlight']) {
        const el = document.getElementById(other);
        if (el) el.checked = layer.corridorFocusHighlight;
      }
      requestMainCanvasRender();
    });
  // Geometry-only limiter: K remains authored and morphable; only the
  // Spiral angular step is folded into [1..L]. No extra branches.
  const applySpiralStepLimit = (source) => {
    const layer = getActiveLayer();
    if (!layer) return;
    if (source.id === 'paramSpiralStepLimiterEnabled') {
      layer.spiralStepLimiterEnabled = source.checked === true;
    } else {
      const v = Number(source.value);
      if (!Number.isFinite(v)) return;
      layer.spiralStepLimiter = Math.max(1, Math.min(120, Math.round(v)));
    }
    mirrorMasterLayerProps(['spiralStepLimiterEnabled', 'spiralStepLimiter']);
    invalidateLayerGeometry(layer, 'spiral-step-limiter');
    syncSidebarInputs();
    if (runtimeState.morph.active)
      activeRebaseMorphing({ preservePaths: ['spiralStepLimiterEnabled', 'spiralStepLimiter'] });
    requestMainCanvasRender();
  };
  document
    .getElementById('paramSpiralStepLimiterEnabled')
    ?.addEventListener('change', (e) => applySpiralStepLimit(e.target));
  document
    .getElementById('paramSpiralStepLimiter')
    ?.addEventListener('change', (e) => applySpiralStepLimit(e.target));
  document.getElementById('paramSpiralStep')?.addEventListener('change', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.spiralStepLinked = false;
    layer.spiralStep = normalizeSpiralStep(e.target.value, layer);
    e.target.value = layer.spiralStep;
    invalidateLayerGeometry(layer, 'legacy-geometry-control');
    syncSidebarInputs();
    if (runtimeState.morph.active) activeRebaseMorphing();
    requestMainCanvasRender();
  });
  document.getElementById('paramSpiralStepLinked')?.addEventListener('change', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.spiralStepLinked = e.target.checked === true;
    if (layer.spiralStepLinked) layer.spiralStep = normalizeSpiralStep(layer.K, layer);
    invalidateLayerGeometry(layer, 'legacy-geometry-control');
    // Unlinking changes only the ownership flag; each target must retain its own
    // explicit step. Linking also recomputes the source step, so that value is
    // part of the real UI mutation and may be broadcast with the flag.
    syncSidebarInputs();
    if (runtimeState.morph.active) activeRebaseMorphing();
    requestMainCanvasRender();
  });
  for (const [field, prefix, prop] of [
    ['paramSpiralConstruction', 'spiralConstruction', 'spiralConstructionMode'],
    ['paramSpiralZeroTransition', 'spiralZero', 'spiralZeroTransitionMode'],
  ]) {
    const select = document.getElementById(field);
    select?.addEventListener('change', (e) => {
      const layer = getActiveLayer();
      if (!layer) return;
      layer[prop] = e.target.value;
      invalidateLayerGeometry(layer, 'spiral-construction-transition');
      syncMasterPathsIntoBlueRuntime(layer, [prop], layer);
      mirrorMasterLayerProps([prop]);
      syncSidebarInputs();
      if (runtimeState.morph.active) activeRebaseMorphing({ preservePaths: [prop] });
      requestMainCanvasRender();
    });
    for (const [suffix, direction] of [
      ['Prev', -1],
      ['Next', 1],
    ]) {
      document.getElementById(prefix + suffix)?.addEventListener('click', () => {
        if (!select?.options.length) return;
        const count = select.options.length;
        select.selectedIndex = (select.selectedIndex + direction + count) % count;
        select.dispatchEvent(new Event('change', { bubbles: true }));
      });
    }
  }
  document.getElementById('paramSpiralTwist')?.addEventListener('change', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.spiralTwist = e.target.checked;
    invalidateLayerGeometry(layer, 'spiral-twist');
    syncMasterPathsIntoBlueRuntime(layer, ['spiralTwist'], layer);
    mirrorMasterLayerProps(['spiralTwist']);
    if (runtimeState.morph.active) activeRebaseMorphing({ preservePaths: ['spiralTwist'] });
    requestMainCanvasRender();
  });
  document.getElementById('paramSpiralTangential')?.addEventListener('change', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.spiralTangential = e.target.checked === true;

    invalidateLayerGeometry(layer, 'legacy-geometry-control');
    if (runtimeState.morph.active) activeRebaseMorphing();
    requestMainCanvasRender();
  });
  document.getElementById('paramSpiralRoundSeams')?.addEventListener('change', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const enabled = e.target.checked === true;
    // One authoring control for both order-zero and wound contours.
    // Keep the two serialized fields for compatibility with old projects.
    layer.spiralRoundSeams = enabled;
    layer.lineJoinType = enabled ? 'rounded' : 'straight';
    const paths = ['spiralRoundSeams', 'lineJoinType'];
    invalidateLayerGeometry(layer, 'profile-closure-rounding');
    syncMasterPathsIntoBlueRuntime(layer, paths, layer);
    mirrorMasterLayerProps(paths);
    if (runtimeState.morph.active) activeRebaseMorphing({ preservePaths: paths });
    syncSidebarInputs();
    requestMainCanvasRender();
  });
  document.getElementById('paramSpiralFillEnabled')?.addEventListener('change', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.spiralFillEnabled = e.target.checked === true;
    if (!['chopped', 'mathematical', 'bandXor'].includes(layer.spiralFillType))
      layer.spiralFillType = 'chopped';
    try {
      FillMeshPreparer.reset?.();
    } catch (error) {
      noteSuppressedError('ui/controls/layer-geometry-style#bindLayerGeometryAndStyleControls', error);
    }
    syncSidebarInputs();
    requestMainCanvasRender();
  });
  document.getElementById('paramSpiralFillType')?.addEventListener('change', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.spiralFillType = ['chopped', 'mathematical', 'bandXor'].includes(e.target.value)
      ? e.target.value
      : 'chopped';
    try {
      FillMeshPreparer.reset?.();
    } catch (error) {
      noteSuppressedError('ui/controls/layer-geometry-style#bindLayerGeometryAndStyleControls', error);
    }
    requestMainCanvasRender();
  });
  document.getElementById('btnDecN').addEventListener('click', () => {
    const r = document.getElementById('paramN');
    if (r) applyCompactN((Number(r.value) || 2) - 1);
  });
  document.getElementById('btnIncN').addEventListener('click', () => {
    const r = document.getElementById('paramN');
    if (r) applyCompactN((Number(r.value) || 2) + 1);
  });
  // Visible buttons use the same logarithmic increments as multiplier
  // keyboard arrows and mouse-wheel support (including fractions).
  const stepGeometryNMultiplier = (direction) => {
    const input = document.getElementById('paramNMultiplier');
    if (!input || input.disabled) return;
    input.value = String(Math.max(0.01, logarithmicStep(input.value, direction)));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  document.getElementById('btnIncNMultiplier')?.addEventListener('click', () => stepGeometryNMultiplier(1));
  document.getElementById('btnDecNMultiplier')?.addEventListener('click', () => stepGeometryNMultiplier(-1));

  document.getElementById('paramK').addEventListener('input', (e) => setLayerK(e.target.value));
  document.getElementById('numK').addEventListener('change', (e) => setLayerK(e.target.value));
  document.getElementById('btnDecK').addEventListener('click', () => {
    const layer = getActiveLayer();
    if (layer) setLayerK(layer.K - 1);
  });
  document.getElementById('btnIncK').addEventListener('click', () => {
    const layer = getActiveLayer();
    if (layer) setLayerK(layer.K + 1);
  });

  const updateChaosNumber = (prop, id, min, max) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const el = document.getElementById(id);
    let v = Math.round(Number(el?.value));
    if (!Number.isFinite(v)) v = min;
    v = Math.max(min, Math.min(max(layer), v));
    layer[prop] = v;
    if (el) el.value = String(v);
    invalidateLayerGeometry(layer, 'legacy-geometry-control');
    requestMainCanvasRender();
  };
  document.getElementById('paramChaosStar')?.addEventListener('change', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.chaosStar = e.target.checked === true;
    if (layer.chaosStar) setContourMode(layer, 'closed');
    if (!Number.isFinite(Number(layer.chaosStepMinus))) layer.chaosStepMinus = 1;
    if (!Number.isFinite(Number(layer.chaosStepPlus))) layer.chaosStepPlus = 1;
    if (!Number.isFinite(Number(layer.chaosClosures))) layer.chaosClosures = 1;
    if (!Number.isFinite(Number(layer.chaosSeed))) layer.chaosSeed = (Math.random() * 0xffffffff) >>> 0;
    invalidateLayerGeometry(layer, 'legacy-geometry-control');
    syncSidebarInputs();
    requestMainCanvasRender();
  });
  document
    .getElementById('chaosStepMinus')
    ?.addEventListener('change', () => updateChaosNumber('chaosStepMinus', 'chaosStepMinus', 0, () => 120));
  document
    .getElementById('chaosStepPlus')
    ?.addEventListener('change', () => updateChaosNumber('chaosStepPlus', 'chaosStepPlus', 0, () => 120));
  document
    .getElementById('chaosClosures')
    ?.addEventListener('change', () =>
      updateChaosNumber('chaosClosures', 'chaosClosures', 1, (l) =>
        Math.max(1, Math.round(Number(l.N) || 4)),
      ),
    );
  document.getElementById('btnRegenerateChaosStar')?.addEventListener('click', () => {
    const layer = getActiveLayer();
    if (!layer || layer.chaosStar !== true) return;
    layer.chaosSeed = (Math.random() * 0xffffffff) >>> 0;
    invalidateLayerGeometry(layer, 'legacy-geometry-control');
    requestMainCanvasRender();
  });

  const ensureCircleCfg = (layer) => {
    if (!layer.geometryCircles || typeof layer.geometryCircles !== 'object')
      layer.geometryCircles = {
        enabled: false,
        circumscribed: false,
        inscribed: false,
        median: false,
        keyPoints: false,
      };
    return layer.geometryCircles;
  };
  const invalidateGeometryCircles = (layer, reason) => {
    if (typeof invalidateLayerProperties === 'function')
      invalidateLayerProperties(layer, ['geometryCircles'], reason);
    else invalidateLayerEffect(layer, reason);
  };
  document.getElementById('paramGeometryCircles')?.addEventListener('change', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const cfg = ensureCircleCfg(layer);
    cfg.enabled = e.target.checked === true;
    if (cfg.enabled && !cfg.circumscribed && !cfg.inscribed && !cfg.median && !cfg.keyPoints)
      cfg.keyPoints = true;
    invalidateGeometryCircles(layer, 'geometry-circles-enabled');
    // Master propagation is handled by the changed-path transaction installed
    // on the sidebar. Do not copy the entire geometryCircles object here: enabling
    // may touch enabled/keyPoints, while untouched sibling modes remain per-layer.
    syncSidebarInputs();
    requestMainCanvasRender();
  });
  const bindCircleMode = (id, key) =>
    document.getElementById(id)?.addEventListener('change', (e) => {
      const layer = getActiveLayer();
      if (!layer) return;
      const cfg = ensureCircleCfg(layer);
      cfg[key] = e.target.checked === true;
      invalidateGeometryCircles(layer, 'geometry-circles-mode');
      // The capture-phase Master transaction will broadcast exactly
      // geometryCircles.<key>, not the whole sibling mode object.
      requestMainCanvasRender();
    });
  bindCircleMode('circleModeCircumscribed', 'circumscribed');
  bindCircleMode('circleModeInscribed', 'inscribed');
  bindCircleMode('circleModeMedian', 'median');
  bindCircleMode('circleModeKeyPoints', 'keyPoints');

  document
    .getElementById('paramSuborbits')
    .addEventListener('input', (e) => setLayerSuborbits(e.target.value));
  document
    .getElementById('numSuborbits')
    .addEventListener('change', (e) => setLayerSuborbits(e.target.value));
  document.getElementById('btnDecS').addEventListener('click', () => {
    const layer = getActiveLayer();
    if (layer) {
      const maxS = gcd(layer.N, layer.K);
      const curS = layer.customSuborbits !== null ? layer.customSuborbits : maxS;
      setLayerSuborbits(curS - 1);
    }
  });
  document.getElementById('btnIncS').addEventListener('click', () => {
    const layer = getActiveLayer();
    if (layer) {
      const maxS = gcd(layer.N, layer.K);
      const curS = layer.customSuborbits !== null ? layer.customSuborbits : maxS;
      setLayerSuborbits(curS + 1);
    }
  });

  const applyContourModeFromUI = (mode) => {
    const layer = getActiveLayer();
    if (!layer) return false;
    const next = [
      'closed',
      'open',
      'spiral-closed',
      'spiral-open',
      'extended-linear',
      'extended-profile',
    ].includes(mode)
      ? mode
      : 'closed';
    if (next !== 'closed' && layer.chaosStar === true) layer.chaosStar = false;
    setContourMode(layer, next);
    if (contourModeIsSpiral(next)) {
      // Topology switches must never reset a healthy GPU device. Specialized Spiral rails warm
      // asynchronously; until ready, the general GPU geometry path remains authoritative.
      try {
        WebGPUDeviceHub?.warmup?.();
      } catch (error) {
        noteSuppressedError('ui/controls/layer-geometry-style#applyContourModeFromUI', error);
      }
      try {
        WebGPUStrokeRenderer?.warmup?.();
      } catch (error) {
        noteSuppressedError('ui/controls/layer-geometry-style#applyContourModeFromUI', error);
      }
      try {
        WebGPUFinalCompositeRenderer?.warmup?.();
      } catch (error) {
        noteSuppressedError('ui/controls/layer-geometry-style#applyContourModeFromUI', error);
      }
      try {
        WebGPUSpiralBezierMorphRenderer?.warmup?.();
      } catch (error) {
        noteSuppressedError('ui/controls/layer-geometry-style#applyContourModeFromUI', error);
      }
      try {
        warmupGpuMorphArcResource?.();
      } catch (error) {
        noteSuppressedError('ui/controls/layer-geometry-style#applyContourModeFromUI', error);
      }
      try {
        WebGPUProfileArcMarkerRenderer?.warmup?.();
      } catch (error) {
        noteSuppressedError('ui/controls/layer-geometry-style#applyContourModeFromUI', error);
      }
    }
    invalidateLayerGeometry(layer, 'contour-mode-ui');
    // setContourMode can change a different subset of topology fields depending
    // on the selected mode. Let the changed-path Master transaction mirror only
    // the fields that actually changed on the active layer.
    syncSidebarInputs();
    if (runtimeState.morph.active)
      activeRebaseMorphing({
        preservePaths: [
          'closedLoop',
          'spiralEnabled',
          'spiralOrder',
          'spiralRememberedOrder',
          'spiralStep',
          'spiralStepLinked',
          'spiralClosed',
          'spiralTangential',
          'spiralRoundSeams',
        ],
      });
    requestMainCanvasRender();
    return true;
  };
  const applyUnifiedClosedFromUI = (closed) => {
    const layer = getActiveLayer();
    if (!layer) return false;
    setUnifiedContourClosed(layer, closed);
    invalidateLayerGeometry(layer, 'unified-contour-closure');
    syncSidebarInputs();
    if (runtimeState.morph.active)
      activeRebaseMorphing({
        preservePaths: [
          'closedLoop',
          'spiralEnabled',
          'spiralOrder',
          'spiralClosed',
          'extendedProfileEnabled',
        ],
      });
    requestMainCanvasRender();
    return true;
  };
  document.getElementById('paramClosedLoop').addEventListener('change', (e) =>
    applyUnifiedClosedFromUI(e.target.checked === true),
  );
  document.getElementById('btnExtendedContour')?.addEventListener('click', () => {
    const layer = getActiveLayer();
    if (!layer) return;
    if (layer.extendedProfileEnabled === true) {
      const oldOrder = Number.isFinite(Number(layer.__unifiedPreviousOrder))
        ? layer.__unifiedPreviousOrder
        : 0;
      const oldClosed =
        layer.__unifiedPreviousClosed !== undefined
          ? layer.__unifiedPreviousClosed
          : layer.spiralClosed !== false;
      setUnifiedSpiralOrder(layer, oldOrder);
      setUnifiedContourClosed(layer, oldClosed);
      invalidateLayerGeometry(layer, 'exit-extended-contour');
      syncSidebarInputs();
      if (runtimeState.morph.active)
        activeRebaseMorphing({
          preservePaths: ['closedLoop', 'spiralEnabled', 'spiralOrder', 'extendedProfileEnabled'],
        });
      requestMainCanvasRender();
    } else {
      layer.__unifiedPreviousOrder = getEffectiveSpiralOrder(layer);
      layer.__unifiedPreviousClosed =
        layer.spiralEnabled === true ? layer.spiralClosed !== false : layer.closedLoop !== false;
      layer.spiralRememberedOrder = layer.__unifiedPreviousOrder;
      applyContourModeFromUI('extended-linear');
    }
  });
  document
    .querySelectorAll('[data-extended-variant]')
    .forEach((btn) =>
      btn.addEventListener('click', () =>
        applyContourModeFromUI(
          btn.dataset.extendedVariant === 'second' ? 'extended-profile' : 'extended-linear',
        ),
      ),
    );

  document
    .querySelectorAll('.color-swatch[data-color]:not([data-graffiti-palette-swatch])')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        const layer = getActiveLayer();
        if (layer) {
          const newColor = setLayerStrokeColor(layer, btn.dataset.color);
          document.getElementById('paramStrokeColor').value = newColor;
          document.getElementById('hexStroke').textContent = newColor;
          const fillInput = document.getElementById('paramFillColor');
          if (fillInput && getLayerFillMatchStroke(layer))
            fillInput.value = colorBaseHex6(layer.fillColor, newColor);
          updateLayerListUI();
          renderMainCanvas();
        }
      });
    });

  let monoradiusRebaseTimer = 0;
  let monoradiusDiagnosticEdit = null;
  const flushMonoradiusRebase = () => {
    if (monoradiusRebaseTimer) clearTimeout(monoradiusRebaseTimer);
    monoradiusRebaseTimer = 0;
    const diagnosticManualEdit = recentManualGeometryIntent() ?? monoradiusDiagnosticEdit;
    monoradiusDiagnosticEdit = null;
    if (runtimeState.morph.active) activeRebaseMorphing({ preservePaths: ['rounding', 'roundingMode'], diagnosticManualEdit });
    requestMainCanvasRender();
  };
  const scheduleMonoradiusRebase = () => {
    if (monoradiusRebaseTimer) clearTimeout(monoradiusRebaseTimer);
    monoradiusDiagnosticEdit = recentManualGeometryIntent();
    monoradiusRebaseTimer = setTimeout(flushMonoradiusRebase, 100);
  };
  // The live Morph displays geometry snapshots, not the authored
  // layer.  Update the prepared frame parameters in place and keep
  // the existing phase clock and point transport.  Rebase is still
  // necessary for Mono Radius because its fitted points differ.
  const previewLiveRoundingSetting = (layer, property) => {
    const rt = runtimeState.morph;
    if (!rt?.active || (layer?.roundingCornerType !== 'fourier' && layer?.roundingMode === 'monoradius' && property !== 'roundingCornerType'))
      return false;
    const idx = (state.layers || []).findIndex((item) => item?.id === layer.id);
    if (idx < 0) return false;
    for (const name of [
      'renderSourceLayers',
      'renderTargetLayers',
      'sourceLayers',
      'targetLayers',
      'frameLayers',
      'lightLayers',
    ]) {
      const item = rt[name]?.[idx];
      if (item && typeof item === 'object') {
        item[property] = layer[property];
        if (property === 'roundingShape') item.rounding = layer.rounding;
        invalidateLayerGeometry(item, 'live-rounding-' + property);
      }
    }
    for (const name of ['sourceVisuals', 'targetVisuals']) {
      const item = rt[name]?.[idx];
      if (item && typeof item === 'object') {
        item[property] = layer[property];
        if (property === 'roundingShape') item.rounding = layer.rounding;
      }
    }
    return true;
  };
  const roundingField = document.getElementById('numRounding');
  roundingField.addEventListener('change', () => {
    const slider = document.getElementById('paramRounding');
    if (Number.isFinite(roundingField.valueAsNumber)) {
      slider.value = Math.round(roundingField.valueAsNumber);
      slider.dispatchEvent(new Event('input', { bubbles: true }));
      slider.dispatchEvent(new Event('change', { bubbles: true }));
    }
    roundingField.value = slider.value;
  });
  document.getElementById('paramRounding').addEventListener('input', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const amount = clampRoundingPercent(e.target.value);
    // Master edits have to update the ACTUAL render targets now,
    // not just the active layer and a later asynchronous UI mirror.
    // Otherwise the visible Morph snapshots of other layers retain
    // the old rounding until the user restarts the animation.
    const targets =
      state.masterLayerEdit === true || hasMultiLayerSelection() ? getLayerEditTargets() : [layer];
    let needsMonoradiusRebase = false;
    for (const target of targets) {
      target.rounding = amount;
      invalidateLayerGeometry(target, 'rounding-input');
      if (
        runtimeState.morph.active &&
        !previewLiveRoundingSetting(target, 'rounding') &&
        target.roundingMode === 'monoradius'
      )
        needsMonoradiusRebase = true;
    }
    if (needsMonoradiusRebase) scheduleMonoradiusRebase();
    roundingField.value = Math.round(amount);
    document.getElementById('valRounding').textContent = formatDisplayNumber(amount, 1) + '%';
    requestMainCanvasRender();
  });

  // Input may be debounced while dragging; a committed value must
  // never leave the Blue frame on an obsolete Mono Radius rail.
  document.getElementById('paramRounding')?.addEventListener('change', () => {
    if (runtimeState.morph.active && getLayerEditTargets().some((l) => l.roundingMode === 'monoradius'))
      flushMonoradiusRebase();
  });
  document.getElementById('paramRoundingCornerType')?.addEventListener('change', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const next = ['local', 'classic', 'fourier', 'simple'].includes(e.target.value) ? e.target.value : 'classic';
    const targets =
      state.masterLayerEdit === true || hasMultiLayerSelection() ? getLayerEditTargets() : [layer];
    // Only the renderer changes when an already-standard polygon switches
    // between the local fillet and classic Spline+. The transported Blue
    // knots, phase target and clock do not: rebuilding the entire Morph
    // cycle here needlessly resamples every layer and can move the phase.
    // Keep the original full rebase for Fourier, Mono Radius, Spiral and
    // partially prepared snapshots (their carrier contract may differ).
    const liveCornerOnly =
      runtimeState.morph.active &&
      (next === 'local' || next === 'classic') &&
      targets.length > 0 &&
      runtimeState.morph.gpuPhasePreparing !== true &&
      runtimeState.morph.gpuPhaseWarming !== true &&
      targets.every((target) => {
        if (
          !target ||
          (target.roundingCornerType !== 'local' && target.roundingCornerType !== 'classic') ||
          target.roundingMode === 'monoradius' ||
          target.spiralEnabled === true
        )
          return false;
        const idx = (state.layers || []).findIndex((item) => item?.id === target.id);
        if (idx < 0) return false;
        const src = runtimeState.morph.renderSourceLayers?.[idx];
        const dst = runtimeState.morph.renderTargetLayers?.[idx];
        return (
          src &&
          dst &&
          src.spiralEnabled !== true &&
          dst.spiralEnabled !== true &&
          (src.roundingCornerType === 'local' || src.roundingCornerType === 'classic') &&
          (dst.roundingCornerType === 'local' || dst.roundingCornerType === 'classic') &&
          src.roundingMode !== 'monoradius' &&
          dst.roundingMode !== 'monoradius'
        );
      });
    for (const target of targets) {
      if (next === 'fourier' && target.roundingCornerType !== 'fourier')
        target.roundingPreviousCornerType = ['local', 'simple'].includes(target.roundingCornerType) ? target.roundingCornerType : 'classic';
      target.roundingCornerType = next;
      invalidateLayerGeometry(target, 'rounding-corner-type');
    }
    syncRoundingModeHelp(next === 'fourier');
    document.querySelectorAll('.rounding-corner-type-btn').forEach((btn) => {
      const active = btn.dataset.roundingCornerType === next;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    if (runtimeState.morph.active) {
      if (liveCornerOnly && morphSidebarRebaseRuntime.active)
        morphSidebarRebaseRuntime.cornerPreviewOnly = true;
      if (!liveCornerOnly) activeRebaseMorphing({ preservePaths: ['roundingCornerType', 'rounding'] });
      // Apply to live phase snapshots immediately. Even after a fallback
      // rebase, its newly generated render carriers need the UI choice.
      for (const target of targets) previewLiveRoundingSetting(target, 'roundingCornerType');
    }
    requestMainCanvasRender();
  });
  for (const [id, step] of [['roundingPrevMethod', -1], ['roundingNextMethod', 1]]) {
    document.getElementById(id)?.addEventListener('click', () => {
      const input = document.getElementById('paramRoundingCornerType');
      if (!input?.options?.length) return;
      input.selectedIndex = (input.selectedIndex + step + input.options.length) % input.options.length;
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }
  document.getElementById('paramRoundingMode')?.addEventListener('change', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    if (monoradiusRebaseTimer) {
      clearTimeout(monoradiusRebaseTimer);
      monoradiusRebaseTimer = 0;
    }
    const next = e.target.value === 'monoradius' ? 'monoradius' : 'standard';
    const checkbox = document.getElementById('paramMonoradiusCheck');
    if (checkbox) checkbox.checked = next === 'monoradius';
    const targets =
      state.masterLayerEdit === true || hasMultiLayerSelection() ? getLayerEditTargets() : [layer];
    for (const target of targets) {
      target.roundingMode = next;
      invalidateLayerGeometry(target, 'rounding-mode');
    }
    document.querySelectorAll('.rounding-mode-btn[data-rounding-mode]').forEach((btn) => {
      const active = btn.dataset.roundingMode === next;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-pressed', String(active));
    });
    // A Blue frame keeps its own geometry snapshots. Rebase those
    // snapshots when switching the radius policy, or the UI updates
    // while the actual visible rail still uses the old policy.
    if (runtimeState.morph.active) activeRebaseMorphing({ preservePaths: ['roundingMode', 'rounding'] });
    requestMainCanvasRender();
  });
  document.getElementById('paramMonoradiusCheck')?.addEventListener('change', (e) => {
    const input = document.getElementById('paramRoundingMode');
    if (!input) return;
    input.value = e.target.checked ? 'monoradius' : 'standard';
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  document.getElementById('paramRadius').addEventListener('input', (e) => {
    const layer = getActiveLayer();
    if (layer) {
      layer.radius = parseFloat(e.target.value);
      invalidateLayerGeometry(layer, 'legacy-geometry-control');
      document.getElementById('valRadius').textContent =
        `${formatDisplayNumber(layer.radius, 1)} × ${formatDisplayNumber(getLayerRadiusMultiplier(layer), 2)}`;
      requestMainCanvasRender();
    }
  });
  document.getElementById('paramRadiusMultiplier')?.addEventListener('input', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const v = Number(e.target.value);
    layer.radiusMultiplier = Number.isFinite(v) ? Math.max(0, v) : 1;
    invalidateLayerGeometry(layer, 'legacy-geometry-control');
    document.getElementById('valRadius').textContent =
      `${formatDisplayNumber(layer.radius, 1)} × ${formatDisplayNumber(getLayerRadiusMultiplier(layer), 2)}`;
    renderMainCanvas();
  });

  document.getElementById('paramRotation').addEventListener('input', (e) => {
    const layer = getActiveLayer();
    if (layer) {
      layer.rotation = parseFloat(e.target.value);
      document.getElementById('valRotation').textContent = formatDisplayNumber(layer.rotation, 1) + '°';
      renderMainCanvas();
    }
  });

  document.getElementById('paramLineOpacity')?.addEventListener('input', (e) => {
    const active = getActiveLayer();
    if (!active) return;
    const value = Math.max(0, Math.min(100, Number(e.target.value) || 0));
    for (const layer of getLayerEditTargets()) layer.lineOpacity = value;
    setSidebarValueText('valLineOpacity', formatDisplayNumber(value, 1) + '%');
    requestMainCanvasRender();
  });
  document.getElementById('paramOpacity').addEventListener('input', (e) => {
    const layer = getActiveLayer();
    if (layer) {
      layer.opacity = parseFloat(e.target.value);
      document.getElementById('valOpacity').textContent = formatDisplayNumber(layer.opacity, 1) + '%';
      requestMainCanvasRender();
    }
  });

  document.getElementById('paramStrokeColor').addEventListener('input', (e) => {
    const layer = getActiveLayer();
    if (layer) {
      const newColor = setLayerStrokeColor(layer, e.target.value);
      e.target.value = newColor;
      document.getElementById('hexStroke').textContent = newColor;
      const fillInput = document.getElementById('paramFillColor');
      if (fillInput && getLayerFillMatchStroke(layer))
        fillInput.value = colorBaseHex6(layer.fillColor, newColor);
      updateLayerListUI();
      requestMainCanvasRender();
    }
  });

  const setStrokeWidth = (value) => {
    const layer = getActiveLayer();
    const range = document.getElementById('paramStrokeWidth');
    const number = document.getElementById('numStrokeWidth');
    if (!layer || !range) return;
    const min = Number(range.min) || 0.5,
      max = Number(range.max) || 20;
    const parsed = Number(value);
    const v = Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : min));
    layer.strokeWidth = v;
    range.value = String(v);
    if (number) number.value = formatDisplayNumber(v, 1);
    document.getElementById('valStrokeWidth').textContent = formatDisplayNumber(v, 1) + 'px';
    syncMorphAllStrokeWidthUI();
    requestMainCanvasRender();
  };
  document
    .getElementById('paramStrokeWidth')
    .addEventListener('input', (e) => setStrokeWidth(e.target.value));
  document
    .getElementById('numStrokeWidth')
    ?.addEventListener('change', (e) => setStrokeWidth(e.target.value));
  const setStrokeWidthMultiplier = (value) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const v = Number(value);
    layer.strokeWidthMultiplier = Number.isFinite(v) ? Math.max(0, v) : 1;
    const el = document.getElementById('paramStrokeWidthMultiplier');
    if (el && document.activeElement !== el) el.value = layer.strokeWidthMultiplier;
    requestMainCanvasRender();
  };
  document
    .getElementById('paramStrokeWidthMultiplier')
    ?.addEventListener('input', (e) => setStrokeWidthMultiplier(e.target.value));
  document
    .getElementById('paramStrokeWidthMultiplier')
    ?.addEventListener('change', (e) => setStrokeWidthMultiplier(e.target.value));
  document.getElementById('btnDecStrokeWidth')?.addEventListener('click', () => {
    const r = document.getElementById('paramStrokeWidth');
    setStrokeWidth((Number(r.value) || 0) - (Number(r.step) || 0.5));
  });
  document.getElementById('btnIncStrokeWidth')?.addEventListener('click', () => {
    const r = document.getElementById('paramStrokeWidth');
    setStrokeWidth((Number(r.value) || 0) + (Number(r.step) || 0.5));
  });

  const setGlow = (value) => {
    const layer = getActiveLayer();
    const range = document.getElementById('paramGlow');
    const number = document.getElementById('numGlow');
    if (!layer || !range) return;
    const min = Number(range.min) || 0,
      max = Number(range.max) || 40;
    const parsed = Number(value);
    const v = Math.max(min, Math.min(max, Number.isFinite(parsed) ? parsed : 0));
    layer.glow = v;
    invalidateLayerProperties(layer, ['glow'], 'ui-glow');
    range.value = String(v);
    if (number) number.value = formatDisplayNumber(v, 1);
    document.getElementById('valGlow').textContent = formatDisplayNumber(v, 1) + 'px';
    requestMainCanvasRender();
  };
  document.getElementById('paramGlow').addEventListener('input', (e) => setGlow(e.target.value));
  const setGlowMultiplier = (value) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const v = Number(value);
    layer.glowMultiplier = Number.isFinite(v) ? Math.max(0, v) : 1;
    invalidateLayerProperties(layer, ['glowMultiplier'], 'ui-glow-multiplier');
    const el = document.getElementById('paramGlowMultiplier');
    if (el && document.activeElement !== el) el.value = layer.glowMultiplier;
    requestMainCanvasRender();
  };
  document
    .getElementById('paramGlowMultiplier')
    ?.addEventListener('input', (e) => setGlowMultiplier(e.target.value));
  document
    .getElementById('paramGlowMultiplier')
    ?.addEventListener('change', (e) => setGlowMultiplier(e.target.value));
  const syncGlowIntensityUI = () => {
    const layer = getActiveLayer();
    if (!layer) return;
    const t = document.getElementById('valGlowIntensity');
    if (t)
      t.textContent = `${Math.round(Number(layer.glowIntensity) || 0)}% × ${formatDisplayNumber(getLayerGlowIntensityMultiplier(layer), 2)}`;
    requestMainCanvasRender();
  };
  document.getElementById('paramGlowIntensity')?.addEventListener('input', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.glowIntensity = Math.max(0, Math.min(200, Number(e.target.value) || 0));
    invalidateLayerProperties(layer, ['glowIntensity'], 'ui-glow-intensity');
    syncGlowIntensityUI();
  });
  const setGlowIntensityMultiplier = (value) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const v = Number(value);
    layer.glowIntensityMultiplier = Number.isFinite(v) ? Math.max(0, v) : 1;
    invalidateLayerProperties(layer, ['glowIntensityMultiplier'], 'ui-glow-intensity-multiplier');
    const el = document.getElementById('paramGlowIntensityMultiplier');
    if (el && document.activeElement !== el) el.value = layer.glowIntensityMultiplier;
    syncGlowIntensityUI();
  };
  document
    .getElementById('paramGlowIntensityMultiplier')
    ?.addEventListener('input', (e) => setGlowIntensityMultiplier(e.target.value));
  document
    .getElementById('paramGlowIntensityMultiplier')
    ?.addEventListener('change', (e) => setGlowIntensityMultiplier(e.target.value));
  document.getElementById('numGlow')?.addEventListener('change', (e) => setGlow(e.target.value));
  document.getElementById('btnDecGlow')?.addEventListener('click', () => {
    const r = document.getElementById('paramGlow');
    setGlow((Number(r.value) || 0) - (Number(r.step) || 1));
  });
  document.getElementById('btnIncGlow')?.addEventListener('click', () => {
    const r = document.getElementById('paramGlow');
    setGlow((Number(r.value) || 0) + (Number(r.step) || 1));
  });

  document.getElementById('paramEnableFill').addEventListener('change', (e) => {
    const layer = getActiveLayer();
    if (layer) {
      layer.fill = e.target.checked;
      if (layer.fill && getFillOpacityPercent(layer.fillColor, 0) <= 0.001) {
        layer.fillColor = setFillOpacityPercent(
          layer.fillColor || layer.strokeColor,
          DEFAULT_FILL_OPACITY_PERCENT,
          layer.strokeColor || '#4f46e5',
        );
      }
      if (layer.fill && getLayerFillMatchStroke(layer)) syncLayerFillColorToStroke(layer);
      invalidateLayerProperties(layer, ['fill', 'fillColor'], 'ui-fill-enabled');
      const fillOpacity = getFillOpacityPercent(layer.fillColor);
      document.getElementById('fillOpacityControl')?.classList.toggle('hidden', !layer.fill);
      document.getElementById('fillMatchStrokeControl')?.classList.toggle('hidden', !layer.fill);
      document.getElementById('fillModeControl')?.classList.toggle('hidden', !layer.fill);
      const fillChoice = getLayerFillModeChoice(layer);
      document
        .getElementById('fillAccumulationControl')
        ?.classList.toggle('hidden', !layer.fill || fillChoice !== 'accumulation');
      document
        .getElementById('fillFadeDirectionControl')
        ?.classList.toggle('hidden', !layer.fill || !(fillChoice === 'fade' || fillChoice === 'fadeSmooth'));
      document
        .getElementById('fillFadeHardnessControl')
        ?.classList.toggle('hidden', !layer.fill || !(fillChoice === 'fade' || fillChoice === 'fadeSmooth'));
      document
        .getElementById('fillFadePixelizationControl')
        ?.classList.toggle('hidden', !layer.fill || fillChoice !== 'fade');
      document.getElementById('fillSettingsBody')?.classList.toggle('fill-disabled', !layer.fill);
      const fillColorInput = document.getElementById('paramFillColor');
      if (fillColorInput) {
        fillColorInput.disabled = getLayerFillMatchStroke(layer);
        fillColorInput.value = colorBaseHex6(layer.fillColor, layer.strokeColor || '#4f46e5');
      }
      const opacityInput = document.getElementById('paramFillOpacity');
      const opacityValue = document.getElementById('valFillOpacity');
      if (opacityInput) opacityInput.value = String(Math.round(fillOpacity * 10) / 10);
      if (opacityValue) opacityValue.textContent = formatDisplayNumber(fillOpacity, 1) + '%';
      renderMainCanvas();
    }
  });

  document.getElementById('paramFillMatchStroke')?.addEventListener('change', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.fillMatchStroke = e.target.checked === true;
    if (layer.fillMatchStroke) syncLayerFillColorToStroke(layer, true);
    invalidateLayerProperties(layer, ['fillMatchStroke', 'fillColor'], 'ui-fill-match-stroke');
    const fillColorInput = document.getElementById('paramFillColor');
    if (fillColorInput) {
      fillColorInput.disabled = layer.fillMatchStroke;
      fillColorInput.value = colorBaseHex6(layer.fillColor, layer.strokeColor || '#4f46e5');
    }
    requestMainCanvasRender();
  });

  document.getElementById('paramFillMode')?.addEventListener('change', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const choice = setLayerFillModeChoice(layer, e.target.value);
    const accumulation = document.getElementById('fillAccumulationControl');
    const fadeDir = document.getElementById('fillFadeDirectionControl');
    const fadeHard = document.getElementById('fillFadeHardnessControl');
    const fadePix = document.getElementById('fillFadePixelizationControl');
    accumulation?.classList.toggle('hidden', choice !== 'accumulation');
    fadeDir?.classList.toggle('hidden', !(choice === 'fade' || choice === 'fadeSmooth'));
    fadeHard?.classList.toggle('hidden', !(choice === 'fade' || choice === 'fadeSmooth'));
    fadePix?.classList.toggle('hidden', choice !== 'fade');
    const hint = document.getElementById('fillModeHint');
    if (hint) {
      if (choice === 'accumulation')
        hint.textContent = 'Накапливает состояния заливки и очищает историю по таймеру.';
      else if (choice === 'fade')
        hint.textContent = 'Резкое контурное затухание с выраженными слоями — сохранённый исходный эффект.';
      else if (choice === 'fadeSmooth')
        hint.textContent =
          'Плавное контурное затухание без выраженных ступеней; форма следует контуру фигуры.';
      else if (choice === 'mathematical')
        hint.textContent = 'Самопересечения инвертируют заливку (even-odd).';
      else hint.textContent = 'Плотная заливка по направлению контура (non-zero winding).';
    }
    invalidateLayerProperties(layer, ['fillType', 'fillRule'], 'ui-fill-mode');
    requestMainCanvasRender();
  });
  document.getElementById('paramFillAccumulationSeconds')?.addEventListener('change', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const v = Math.max(0.1, Math.min(120, Number(e.target.value) || 5));
    layer.fillAccumulationSeconds = v;
    e.target.value = String(v);
    invalidateLayerProperties(layer, ['fillAccumulationSeconds'], 'ui-fill-accumulation-timer');
    requestMainCanvasRender();
  });
  document.getElementById('paramFillFadeDirection')?.addEventListener('change', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    layer.fillFadeDirection = normalizeLayerFillFadeDirection(e.target.value);
    invalidateLayerProperties(layer, ['fillFadeDirection'], 'ui-fill-fade-direction');
    requestMainCanvasRender();
  });
  document.getElementById('paramFillFadeHardness')?.addEventListener('input', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
    layer.fillFadeHardness = v;
    const text = document.getElementById('valFillFadeHardness');
    if (text) text.textContent = `${Math.round(v)}%`;
    invalidateLayerProperties(layer, ['fillFadeHardness'], 'ui-fill-fade-hardness');
    requestMainCanvasRender();
  });
  document.getElementById('paramFillFadePixelization')?.addEventListener('input', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
    layer.fillFadePixelization = v;
    const text = document.getElementById('valFillFadePixelization');
    if (text) text.textContent = `${Math.round(v)}%`;
    invalidateLayerProperties(layer, ['fillFadePixelization'], 'ui-fill-fade-pixelization');
    requestMainCanvasRender();
  });

  document.getElementById('paramFillColor').addEventListener('input', (e) => {
    const layer = getActiveLayer();
    if (layer) {
      if (getLayerFillMatchStroke(layer)) {
        syncLayerFillColorToStroke(layer, true);
        e.target.value = colorBaseHex6(layer.fillColor, layer.strokeColor || '#4f46e5');
      } else {
        const currentOpacity = getFillOpacityPercent(layer.fillColor);
        layer.fillColor = setFillOpacityPercent(e.target.value, currentOpacity, e.target.value);
      }
      invalidateLayerProperties(layer, ['fillColor'], 'ui-fill-color');
      requestMainCanvasRender();
    }
  });

  document.getElementById('paramFillOpacity')?.addEventListener('input', (e) => {
    const layer = getActiveLayer();
    if (!layer) return;
    const opacity = Math.round(Math.max(0, Math.min(100, Number(e.target.value) || 0)));
    e.target.value = opacity;
    layer.fillColor = setFillOpacityPercent(
      getLayerFillMatchStroke(layer) ? layer.strokeColor : layer.fillColor || layer.strokeColor,
      opacity,
      layer.strokeColor || '#4f46e5',
    );
    invalidateLayerProperties(layer, ['fillColor'], 'ui-fill-opacity');
    const value = document.getElementById('valFillOpacity');
    if (value) value.textContent = formatDisplayNumber(opacity, 0) + '%';
    requestMainCanvasRender();
  });
  document.getElementById('btnResetFillOpacity')?.addEventListener('click', () => {
    const input = document.getElementById('paramFillOpacity');
    if (!input) return;
    input.value = String(DEFAULT_FILL_OPACITY_PERCENT);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

export { bindLayerGeometryAndStyleControls };
