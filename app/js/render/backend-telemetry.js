// Телеметрия бэкенда рендера.
import '../gpu/fill-renderer.js'; // initialisation order: this module runs after it
import {
  DEFAULT_FILL_OPACITY_PERCENT,
  getFillOpacityUnit,
  getLayerWebEnabled,
} from '../core/defaults-layers.js';
import { renderRuntime } from '../core/render-runtime.js';
import { somataFourierActive, state } from '../core/state.js';
import { WebGPUWebThreadSceneRenderer } from '../gpu/web-thread-scene-renderer.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';

const frameGraphPerformanceRuntime = {
  penaltyUntilFrame: 0,
  materializations: 0,
  lastMaterializedFrame: 0,
  lastRiskReason: '',
  preflightRejects: 0,
};
const renderBackendTelemetry = (() => {
  const current = new Map(),
    last = new Map();
  let frameId = 0,
    mixedMaterialization = false,
    sceneCanvasTouched = false,
    lastUiKey = '';
  const roots = {
    geometry: ['#geometrySettingsGroup', '.line-display-group'],
    geometryCircles: ['.geometry-circles-row'],
    glow: ['#paramGlow', '#paramGlowIntensity'],
    outline: ['.line-outline-row'],
    fill: ['#fillSettingsBlock'],
    profile: [
      '#lineRenderModeControl',
      '#lineProfileRenderControl',
      '#graffitiProfileRow',
      '#graffitiNibRow',
    ],
    motion: ['#lineMotionFxBlock'],
    sprite: ['#lineSpriteBlock'],
    particles: ['.particle-settings-group'],
    sweep: ['.sweep-settings-group'],
    web: ['.web-settings-group'],
    lamps: ['.lamp-settings-group'],
    final: ['#sceneBlendMenu', '#tunnelFadePerformanceBlock'],
  };
  function begin(id) {
    frameId = Math.max(0, Number(id) || 0);
    current.clear();
    mixedMaterialization = false;
    sceneCanvasTouched = false;
  }
  function mark(feature, backend, reason = '', sceneHot = false) {
    if (!feature || !backend) return;
    const b = backend === 'canvas' || backend === 'legacy' ? 'canvas' : 'gpu',
      why = String(reason || '');
    if (b === 'canvas' && sceneHot === true) sceneCanvasTouched = true;
    /* Expected Canvas/legacy selection is backend telemetry, not an application error or startup warning. Keep it in the telemetry snapshot/UI only. */ const prev =
      current.get(feature);
    if (!prev) current.set(feature, { backend: b, reason: why });
    else if (prev.backend !== b)
      current.set(feature, { backend: 'mixed', reason: [prev.reason, why].filter(Boolean).join(' + ') });
    else if (why && !prev.reason) prev.reason = why;
  }
  function materialized(reason = 'GPU → Canvas materialize') {
    mixedMaterialization = true;
    sceneCanvasTouched = true;
    mark('final', 'canvas', reason, true);
  }
  function rootElements(sel) {
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      if (el.matches?.('#paramGlow,#paramGlowIntensity')) {
        const row = el.closest('.control-row');
        if (row && !out.includes(row)) out.push(row);
      } else out.push(el);
    }
    return out;
  }
  function paintRoot(el, rec) {
    if (!el) return;
    if (!Object.prototype.hasOwnProperty.call(el.dataset, 'perfBaseTitle'))
      el.dataset.perfBaseTitle = el.getAttribute('title') || '';
    el.classList.remove('perf-backend-canvas', 'perf-backend-gpu', 'perf-backend-mixed');
    if (!rec) {
      delete el.dataset.renderBackend;
      const base = el.dataset.perfBaseTitle || '';
      if (base) el.setAttribute('title', base);
      else el.removeAttribute('title');
      return;
    }
    const cls =
      rec.backend === 'canvas'
        ? 'perf-backend-canvas'
        : rec.backend === 'mixed'
          ? 'perf-backend-mixed'
          : 'perf-backend-gpu';
    el.classList.add(cls);
    el.dataset.renderBackend = rec.backend;
    const suffix =
        rec.backend === 'gpu'
          ? 'GPU path'
          : rec.backend === 'mixed'
            ? 'Mixed GPU/Canvas path'
            : 'Canvas2D / Legacy path',
      base = el.dataset.perfBaseTitle || '';
    el.title = `${base}${base ? ' · ' : ''}${suffix}${rec.reason ? ': ' + rec.reason : ''}`;
  }
  function commit() {
    last.clear();
    for (const [k, v] of current) last.set(k, { ...v });
    const key =
      [...last.entries()].map(([k, v]) => `${k}:${v.backend}:${v.reason}`).join('|') +
      `|m:${mixedMaterialization ? 1 : 0}`;
    if (key === lastUiKey) return;
    lastUiKey = key;
    for (const [feature, sels] of Object.entries(roots)) {
      const rec = last.get(feature) || null;
      for (const sel of sels) for (const el of rootElements(sel)) paintRoot(el, rec);
    }

    document.querySelectorAll('.perf-forced-canvas').forEach((el) => {
      el.classList.add('perf-backend-canvas');
      if (!el.dataset.perfForcedTitle) {
        el.dataset.perfForcedTitle = '1';
        el.title = (el.title ? el.title + ' · ' : '') + 'Canvas/legacy path: может снизить FPS';
      }
    });
  }
  function hasCanvas() {
    if (mixedMaterialization) return true;
    for (const v of current.values()) if (v?.backend === 'canvas' || v?.backend === 'mixed') return true;
    return false;
  }
  function hasMaterialization() {
    return mixedMaterialization;
  }
  function canvasTouched() {
    return sceneCanvasTouched;
  }
  function blocksGpuScene() {
    return mixedMaterialization || sceneCanvasTouched;
  }
  function snapshot() {
    const features = {};
    for (const [k, v] of last) features[k] = { ...v };
    return { frameId, mixedMaterialization, sceneCanvasTouched, features };
  }
  return {
    begin,
    mark,
    materialized,
    commit,
    snapshot,
    hasCanvas,
    hasMaterialization,
    canvasTouched,
    blocksGpuScene,
  };
})();
window.__spiroRenderBackendStatus = () => renderBackendTelemetry.snapshot();
function noteFrameGraphMaterialization(
  frameId = renderRuntime?.frameId || 0,
  reason = 'mixed GPU/Canvas frame',
) {
  const id = Math.max(0, Number(frameId) || 0);
  frameGraphPerformanceRuntime.materializations++;
  frameGraphPerformanceRuntime.lastMaterializedFrame = id;
  frameGraphPerformanceRuntime.penaltyUntilFrame = Math.max(
    frameGraphPerformanceRuntime.penaltyUntilFrame,
    id + 600,
  );
  renderBackendTelemetry.materialized(reason);
}
function knownFrameGraphCanvasRisk() {
  const layers = Array.isArray(state?.layers) ? state.layers : [];
  const visible = layers.filter(
    (l) => l?.visible !== false && (Number.isFinite(Number(l?.opacity)) ? Number(l.opacity) : 100) > 0,
  );
  const anyFill = visible.some(
    (l) => l?.fill === true && getFillOpacityUnit(l?.fillColor, DEFAULT_FILL_OPACITY_PERCENT) > 0.00001,
  );

  if (visible.some((l) => l?.fill === true && somataFourierActive(l))) return 'Fourier exact fill';
  if (
    anyFill &&
    visible.some((l) => {
      try {
        return isSpiralLayer(l);
      } catch (_) {
        return false;
      }
    })
  )
    return 'spiral exact fill';
  for (const l of visible) {
    const graffiti = l?.lineProfileApplication === 'graffiti';
    if (graffiti) {
      const o = l?.lineOutline;
      if (o?.enabled === true && o?.mode !== 'outer') return 'Graffiti inner/median outline';
    }
    if (
      getLayerWebEnabled?.(l) === true &&
      typeof WebGPUWebThreadSceneRenderer !== 'undefined' &&
      !WebGPUWebThreadSceneRenderer.isReady?.()
    )
      return 'Web GPU bridge not ready';
  }
  return '';
}

export {
  frameGraphPerformanceRuntime,
  knownFrameGraphCanvasRisk,
  noteFrameGraphMaterialization,
  renderBackendTelemetry,
};
