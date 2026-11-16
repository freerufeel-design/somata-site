import '../geometry/kernel.js'; // initialisation order: this module runs after it
import { state } from './state.js';
import { expandLayerDirtyDomains, layerPropertyDomain, markLayerDirty } from './layer-versions.js';
import { mainCanvas } from '../ui/profile-presets.js';
import { renderPerf, requestMainCanvasRender } from './scheduler.js';
import { lampAnchorCache } from '../lamps/lamp-anchors.js';
import { closeDesktopFloatingMenus } from '../ui/floating-panels.js';
import { noteSuppressedError } from './suppressed-errors.js';

const normalizedFillGlCanvas = document.createElement('canvas');
mainCanvas?.addEventListener('pointerdown', () => {
  closeDesktopFloatingMenus();
});
const mainCtx = mainCanvas.getContext('2d', { alpha: true });
const profileCanvas = document.getElementById('profileCanvas');
const profileCtx = profileCanvas.getContext('2d');
const mainContainerEl = document.getElementById('mainContainer');
const gridPatternEl = document.getElementById('gridPattern');
const infoSuborbitsEl = document.getElementById('infoSuborbits');
const fpsCounterEl = document.getElementById('fpsCounter');
const showFpsSettingEl = document.getElementById('showFpsSetting');
const showVignetteSettingEl = document.getElementById('showVignetteSetting');
const FPS_VISIBILITY_STORAGE_KEY = 'spirostar.showFps';
const VIGNETTE_VISIBILITY_STORAGE_KEY = 'spirostar.showVignette.v2';
let showFpsCounter = true;
let showVignette = false;
try {
  showFpsCounter = localStorage.getItem(FPS_VISIBILITY_STORAGE_KEY) !== '0';

  showVignette = localStorage.getItem(VIGNETTE_VISIBILITY_STORAGE_KEY) === '1';
} catch (error) {
  noteSuppressedError('core/render-runtime', error);
}
state.showVignette = showVignette;

function applyFpsVisibility(visible, persist = true) {
  showFpsCounter = visible !== false;
  fpsCounterEl?.classList.toggle('hidden', !showFpsCounter);
  if (showFpsSettingEl) showFpsSettingEl.checked = showFpsCounter;
  renderPerf.fpsWindowStart = 0;
  renderPerf.fpsLastFrameAt = 0;
  renderPerf.fpsFrames = 0;
  renderPerf.lastFpsText = '';
  if (persist) {
    try {
      localStorage.setItem(FPS_VISIBILITY_STORAGE_KEY, showFpsCounter ? '1' : '0');
    } catch (error) {
      noteSuppressedError('core/render-runtime#applyFpsVisibility', error);
    }
  }
}

function applyVignetteVisibility(visible, persist = true) {
  showVignette = visible !== false;
  state.showVignette = showVignette;
  if (showVignetteSettingEl) showVignetteSettingEl.checked = showVignette;
  if (persist) {
    try {
      localStorage.setItem(VIGNETTE_VISIBILITY_STORAGE_KEY, showVignette ? '1' : '0');
    } catch (error) {
      noteSuppressedError('core/render-runtime#applyVignetteVisibility', error);
    }
  }
  requestMainCanvasRender();
}
const canvasViewport = {
  w: Math.max(1, Math.round(mainContainerEl?.clientWidth || 1)),
  h: Math.max(1, Math.round(mainContainerEl?.clientHeight || 1)),
  dpr: 1,
};

const renderRuntime = {
  active: false,
  frameId: 0,
  now: 0,
  frame: {
    id: 0,
    now: 0,
    w: 0,
    h: 0,
    dpr: 1,
    canvasTransformSaved: false,
    tunnelCopies: null,
    viewportOuterRadius: 0,
    minimalTransition: false,
    renderLayerCount: 0,
    audioActive: false,
    audioRotationOverride: false,
    gpuLayerSceneDeferred: false,
    gpuMainSceneEmpty: false,
    gpuMainCanvasHasContent: false,
    gpuFrameSceneLayers: 0,
    strictSpiralLateCanvasOverlay: false,
    strictSpiralLateCanvasOverlayLayerIndex: -1,
  },
  begin(now) {
    this.active = true;
    this.frameId++;
    this.now = Number(now) || performance.now();
    const f = this.frame;
    f.id = this.frameId;
    f.now = this.now;
    f.canvasTransformSaved = false;
    f.tunnelCopies = null;
    f.viewportOuterRadius = 0;
    f.minimalTransition = false;
    f.renderLayerCount = 0;
    f.audioActive = false;
    f.audioRotationOverride = false;
    f.gpuLayerSceneDeferred = false;
    f.gpuMainSceneEmpty = false;
    f.gpuMainCanvasHasContent = false;
    f.gpuFrameSceneLayers = 0;
    f.strictSpiralLateCanvasOverlay = false;
    f.strictSpiralLateCanvasOverlayLayerIndex = -1;

    f._strictSpiralGpuFrameIncomplete = false;

    if (Array.isArray(f._fullGpuFaults)) f._fullGpuFaults.length = 0;
    else f._fullGpuFaults = [];
    f._fullGpuFaultCount = 0;
    return f;
  },
  end() {
    this.active = false;
  },
};

function getMainCanvasRenderDpr() {
  const opera = /OPR\//.test(navigator.userAgent || '');
  return Math.max(1, Math.min(opera ? 1.5 : 2, Number(window.devicePixelRatio) || 1));
}

const tunnelVignetteMaskCanvas = document.createElement('canvas');
const tunnelVignetteMaskCtx = tunnelVignetteMaskCanvas.getContext('2d', { alpha: true });
const tunnelVignetteMaskCache = { key: '' };
const layerDrawCache = new WeakMap();
const layerGeometrySignatureCache = new WeakMap();

function clearLayerGeometryCompatibilityCaches(layer) {
  try {
    layerDrawCache.delete(layer);
  } catch (error) {
    noteSuppressedError('core/render-runtime#clearLayerGeometryCompatibilityCaches', error);
  }
  try {
    layerGeometrySignatureCache.delete(layer);
  } catch (error) {
    noteSuppressedError('core/render-runtime#clearLayerGeometryCompatibilityCaches', error);
  }
  try {
    if (typeof lampAnchorCache !== 'undefined') lampAnchorCache.delete(layer);
  } catch (error) {
    noteSuppressedError('core/render-runtime#clearLayerGeometryCompatibilityCaches', error);
  }
}
function invalidateLayerDomains(layer, domains, reason = 'layer-change', property = '') {
  if (!layer || (typeof layer !== 'object' && typeof layer !== 'function')) return false;
  const list = Array.isArray(domains) ? domains : [domains];
  const expanded = expandLayerDirtyDomains(list);
  if (expanded.includes('geometry')) clearLayerGeometryCompatibilityCaches(layer);
  markLayerDirty(layer, list, reason, property);
  return true;
}
function invalidateLayerGeometry(layer, reason = 'geometry-change') {
  return invalidateLayerDomains(layer, 'geometry', reason);
}
function invalidateLayerStyle(layer, reason = 'style-change') {
  return invalidateLayerDomains(layer, 'style', reason);
}
function invalidateLayerTransform(layer, reason = 'transform-change') {
  return invalidateLayerDomains(layer, 'transform', reason);
}
function invalidateLayerEffect(layer, reason = 'effect-change') {
  return invalidateLayerDomains(layer, 'effect', reason);
}
function invalidateLayerProperties(layer, properties, reason = 'property-change') {
  if (!layer || (typeof layer !== 'object' && typeof layer !== 'function')) return false;
  const props = Array.isArray(properties) ? properties : [properties];
  const domains = [];
  for (const prop of props) {
    const domain = layerPropertyDomain(prop);
    domains.push(domain || 'effect');
  }
  return invalidateLayerDomains(layer, domains, reason, props.join(','));
}
window.__spiroInvalidateLayerGeometry = invalidateLayerGeometry;
window.__spiroInvalidateLayerProperties = invalidateLayerProperties;

const preSampledSplineLayers = new WeakSet();
const setPreSampledSplineLayer = (layer, enabled) => {
  if (!layer || (typeof layer !== 'object' && typeof layer !== 'function')) return;
  if (enabled) preSampledSplineLayers.add(layer);
  else preSampledSplineLayers.delete(layer);
};
const isPreSampledSplineLayer = (layer) => Boolean(layer && preSampledSplineLayers.has(layer));
const morphPathPairCache = new WeakMap();
const circleMorphPlanCache = new Map();
const chaosCircleMorphPlanCache = new Map();
const renderScratch = { copies: [], alphas: [], fillAlphas: [], particleAlphas: [], maxScale: 1 };

const tunnelFadeRuntime = { exits: new Map(), lastCleanup: 0 };

function clearTunnelFadeRuntime() {
  tunnelFadeRuntime.exits.clear();
  tunnelFadeRuntime.lastCleanup = 0;
}

const lampRenderScratch = { copies: [], alphas: [], maxScale: 1 };
const tunnelCopyScratch = [];
const morphRoundWorkspace = {
  grid: [],
  rounded: [],
  segments: new Float64Array(1024),
  cumulative: new Float64Array(1025),
  px: new Float64Array(2048),
  py: new Float64Array(2048),
  pix: new Float64Array(2048),
  piy: new Float64Array(2048),
};

export {
  applyFpsVisibility,
  applyVignetteVisibility,
  canvasViewport,
  chaosCircleMorphPlanCache,
  circleMorphPlanCache,
  clearTunnelFadeRuntime,
  fpsCounterEl,
  getMainCanvasRenderDpr,
  gridPatternEl,
  infoSuborbitsEl,
  invalidateLayerEffect,
  invalidateLayerGeometry,
  invalidateLayerProperties,
  invalidateLayerStyle,
  invalidateLayerTransform,
  isPreSampledSplineLayer,
  lampRenderScratch,
  layerDrawCache,
  layerGeometrySignatureCache,
  mainContainerEl,
  mainCtx,
  morphPathPairCache,
  morphRoundWorkspace,
  normalizedFillGlCanvas,
  profileCanvas,
  profileCtx,
  renderRuntime,
  renderScratch,
  setPreSampledSplineLayer,
  showFpsCounter,
  showFpsSettingEl,
  showVignette,
  showVignetteSettingEl,
  tunnelCopyScratch,
  tunnelFadeRuntime,
  tunnelVignetteMaskCache,
  tunnelVignetteMaskCanvas,
  tunnelVignetteMaskCtx,
};
