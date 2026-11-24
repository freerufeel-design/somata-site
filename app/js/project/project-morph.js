// Green (морф проектов): настройки, геометрия, лампы, кадр перехода.
import { normalizeTunnelDensity } from '../corridor/corridor-density.js';
import './project-data.js'; // initialisation order: this module runs after it
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { WebGPUStrokeRenderer } from '../gpu/stroke-renderer.js';
import {
  buildLampCircumferenceAnchors,
  buildLampRenderedAttachmentPaths,
  getLampMorphRenderInfo,
  lampHash32,
} from '../lamps/lamp-anchors.js';
import { collectSmoothCornerLampPoints } from '../lamps/lamp-points.js';
import { collectMorphLampPoints } from '../lamps/lamp-topology.js';
import { getAuxiliaryLayerPaths } from '../effects/aux-paths.js';
import { somataGpuBackendAllowed } from '../core/backend-policy.js';
import {
  createLayer,
  createLayerId,
  ensureLayerLampState,
  getLampEvaluationConfig,
  getLayerLampsEnabled,
  withLampConfig,
} from '../core/defaults-layers.js';
import { SpiroMorphController } from '../core/morph-controller.js';
import { animationScheduler, requestMainCanvasRender } from '../core/scheduler.js';
import { replaceRuntimeBoundSection, runtimeState, state, somataWithFourierLayer } from '../core/state.js';
import { getCachedLayerDrawData, layerGeometrySignature } from '../effects/motion.js';
import { ensureCanonicalPathTable, getCanonicalLayerGeometry } from '../geometry/canonical.js';
import { collectArbitraryStaticLampPoints, frameGeometryRuntime } from '../geometry/frame-paths.js';
import { prepareFourierPathList } from '../geometry/fourier.js';
import { pairMorphPaths, resampleMorphTopology } from '../geometry/morph.js';
import { WebGPUGreenProjectMorphRenderer } from '../gpu/green-project-morph-renderer.js';
import { LampGPURenderer } from '../gpu/lamp-renderer.js';
import { WebGPUParticleRenderer } from '../gpu/particle-renderer.js';
import {
  normalizeTunnelCenterHiddenCopies,
  normalizeTunnelColorShiftState,
} from '../corridor/corridor-appearance.js';
import { tunnelVignettePixelsFromSettings } from '../corridor/corridor-instances.js';
import { setTunnelMode, syncTunnelSettingsUI } from '../ui/corridor-panel.js';
import { formatDisplayNumber } from '../ui/geometry-n-control.js';
import {
  activeEnsureFullMorphSchedulerOwnership,
  activeResumeFullMorphFromProjectOrange,
  activeStartMinimalMorphing,
  activeStartMorphing,
  activeStopMinimalMorphing,
  activeStopMorphing,
} from '../morph-runtime/morph-hooks.js';
import { syncRandomSettingsUI } from '../ui/orange-morph/routing-ui.js';
import { syncMorphSettingsUI } from '../ui/morph-settings-panel.js';
import {
  clearProjectMorphBackgroundTransition,
  getProjectBackgroundSpec,
  updateProjectMorphBackgroundTransition,
} from '../ui/viewport-background.js';
import { noteMorphGpuPrepareWait } from '../morph-runtime/blue/playback.js';
import {
  applyPlaylistOverrides,
  buildProjectData,
  cloneData,
  cloneProjectDataFast,
  defaultPlaylistProjectName,
  getCurrentPlaylistProjectIndex,
} from './project-data.js';
import { syncAfterProjectLoad } from './playlist.js';
import { applyLoadedProject } from './project-loader.js';
import { showShortcutToast } from '../ui/header-and-export.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';
import { MORPH_EASINGS } from '../morph-runtime/easing.js';

function normalizeProjectMorphSettings(raw = null) {
  const pm = state.projectMorph || replaceRuntimeBoundSection('projectMorph', {});
  const pmRt = runtimeState.projectMorph;
  const src = raw && typeof raw === 'object' ? raw : {};
  pm.intervalSec = Math.max(
    0.01,
    Number.isFinite(Number(src.intervalSec)) ? Number(src.intervalSec) : Number(pm.intervalSec) || 16,
  );
  pm.syncTap = typeof src.syncTap === 'boolean' ? src.syncTap : pm.syncTap !== false;
  pm.beatsPerProject = Math.max(
    1,
    Math.min(
      256,
      Math.round(
        Number.isFinite(Number(src.beatsPerProject))
          ? Number(src.beatsPerProject)
          : Number(pm.beatsPerProject) || 32,
      ),
    ),
  );
  pm.transitionBeats = Math.max(
    0,
    Math.min(
      256,
      Math.round(
        src.transitionBeats != null && Number.isFinite(Number(src.transitionBeats))
          ? Number(src.transitionBeats)
          : pm.transitionBeats != null && Number.isFinite(Number(pm.transitionBeats))
            ? Number(pm.transitionBeats)
            : 8,
      ),
    ),
  );
  pm.cameraWander = typeof src.cameraWander === 'boolean' ? src.cameraWander : pm.cameraWander === true;
  const requestedTransitionType =
    typeof src.transitionType === 'string' ? src.transitionType : pm.transitionType;
  pm.transitionType = ['fade', 'linear', 'smooth'].includes(requestedTransitionType)
    ? requestedTransitionType
    : 'smooth';
  pm.advancedLinear =
    typeof src.advancedLinear === 'boolean' ? src.advancedLinear : pm.advancedLinear === true;

  const legacyTransition = Number.isFinite(Number(src.transitionSec))
    ? Number(src.transitionSec)
    : Number.isFinite(Number(src.fadeSec)) && Number(src.fadeSec) > 0
      ? Number(src.fadeSec)
      : NaN;
  pm.transitionSec = Math.max(
    0,
    Number.isFinite(legacyTransition) ? legacyTransition : Number(pm.transitionSec) || 4,
  );
  const requestedImageTransitionType =
    typeof src.imageTransitionType === 'string' ? src.imageTransitionType : pm.imageTransitionType;
  pm.imageTransitionType = ['instant', 'fade', 'slide', 'center', 'sector'].includes(
    requestedImageTransitionType,
  )
    ? requestedImageTransitionType
    : 'fade';
  pm.imageCenterSoftness = Math.max(
    0,
    Math.min(
      100,
      Number.isFinite(Number(src.imageCenterSoftness))
        ? Number(src.imageCenterSoftness)
        : Number(pm.imageCenterSoftness ?? 24),
    ),
  );
  pm.imageSectorSoftness = Math.max(
    0,
    Math.min(
      100,
      Number.isFinite(Number(src.imageSectorSoftness))
        ? Number(src.imageSectorSoftness)
        : Number(pm.imageSectorSoftness ?? 18),
    ),
  );

  pmRt.fadeProgress = Math.max(0, Math.min(1, Number(pmRt.fadeProgress) || 0));
  pmRt.progress = Math.max(0, Math.min(1, Number(pmRt.progress) || 0));
  pmRt.renderProgress = Math.max(0, Math.min(1, Number(pmRt.renderProgress) || 0));
  pmRt.parameterProgress = Math.max(0, Math.min(1, Number(pmRt.parameterProgress) || 0));
  pmRt.transitionProgress = Math.max(0, Math.min(1, Number(pmRt.transitionProgress) || 0));
  pmRt.renderMode = ['morph', 'crossfade'].includes(pmRt.renderMode) ? pmRt.renderMode : 'morph';
  pmRt.frameGeometryProgress = Number.isFinite(Number(pmRt.frameGeometryProgress))
    ? Number(pmRt.frameGeometryProgress)
    : -1;
  pmRt.active = pmRt.active === true;
  pmRt.transitionActive = pmRt.transitionActive === true;
  pmRt.sourceCaptured = pmRt.sourceCaptured === true;
  pmRt.restoreProject = pmRt.restoreProject || null;
  pmRt.geometryPlans = Array.isArray(pmRt.geometryPlans) ? pmRt.geometryPlans : [];
  pmRt.frameGeometry = Array.isArray(pmRt.frameGeometry) ? pmRt.frameGeometry : [];
  pmRt.frameExtents = Array.isArray(pmRt.frameExtents) ? pmRt.frameExtents : [];
  pmRt.sourceGeometry = Array.isArray(pmRt.sourceGeometry) ? pmRt.sourceGeometry : [];
  pmRt.targetGeometry = Array.isArray(pmRt.targetGeometry) ? pmRt.targetGeometry : [];
  pmRt.sourceRenderLayers = Array.isArray(pmRt.sourceRenderLayers) ? pmRt.sourceRenderLayers : [];
  pmRt.targetRenderLayers = Array.isArray(pmRt.targetRenderLayers) ? pmRt.targetRenderLayers : [];
  pmRt.lampPlans = Array.isArray(pmRt.lampPlans) ? pmRt.lampPlans : [];
  pmRt.frameLampPoints = Array.isArray(pmRt.frameLampPoints) ? pmRt.frameLampPoints : [];
  pmRt.endpointPending = pmRt.endpointPending === true;
  pmRt.sourceProject = pmRt.sourceProject || null;
  pmRt.targetProject = pmRt.targetProject || null;
  pmRt.sourceIndex = Number.isFinite(Number(pmRt.sourceIndex)) ? Number(pmRt.sourceIndex) : -1;
  pmRt.targetIndex = Number.isFinite(Number(pmRt.targetIndex)) ? Number(pmRt.targetIndex) : -1;
  pmRt.startAt = Number(pmRt.startAt) || 0;
  pmRt.durationMs = Math.max(10, Number(pmRt.durationMs) || pm.intervalSec * 1000);
  pmRt.lastSettingsUiAt = Number(pmRt.lastSettingsUiAt) || 0;
  pmRt.lockedCamera = pmRt.lockedCamera && typeof pmRt.lockedCamera === 'object' ? pmRt.lockedCamera : null;
  return pm;
}
function getProjectMorphDurationSec() {
  const pm = normalizeProjectMorphSettings();
  const bpm = Math.max(0, Number(state.tapTempo?.bpm) || 0);
  if (pm.syncTap && bpm > 0) return Math.max(0.01, (pm.beatsPerProject * 60) / bpm);
  return Math.max(0.01, Number(pm.intervalSec) || 16);
}
function getProjectMorphTransitionSec() {
  const pm = normalizeProjectMorphSettings();
  const bpm = Math.max(0, Number(state.tapTempo?.bpm) || 0);
  const period = getProjectMorphDurationSec();
  const sec =
    pm.syncTap && pm.transitionBeats === 0
      ? 0 // Explicit instant cut persists even when the next project has no BPM.
      : pm.syncTap && bpm > 0
        ? Math.max(0, (pm.transitionBeats * 60) / bpm)
        : Math.max(0, Number(pm.transitionSec) || 0);
  return Math.max(0, Math.min(period, sec));
}
function projectMorphEaseForSpeedType(t, speedType = 'linear') {
  t = Math.max(0, Math.min(1, Number(t) || 0));
  // Same time curves as Blue Morph (the table used to be unreachable here, so Green was always linear).
  const fn = MORPH_EASINGS[String(speedType || 'linear')];
  if (typeof fn === 'function') return Math.max(0, Math.min(1, Number(fn(t)) || 0));
  return t;
}
function projectMorphTargetSpeedType(targetProject) {
  const v = targetProject?.settings?.morph?.speedType;
  return typeof v === 'string' && v ? v : 'linear';
}
function syncProjectMorphUI() {
  const pm = normalizeProjectMorphSettings(),
    pmRt = runtimeState.projectMorph;
  const btn = document.getElementById('btnProjectMorph');
  if (btn) {
    btn.classList.toggle('active', pmRt.active === true);
    btn.setAttribute('aria-pressed', pmRt.active ? 'true' : 'false');
    btn.textContent = pmRt.active ? '◆' : '◇';
  }
  const interval = document.getElementById('projectMorphIntervalSec');
  if (interval && document.activeElement !== interval)
    interval.value = formatDisplayNumber(pm.intervalSec, 2);
  const syncTap = document.getElementById('projectMorphSyncTap');
  if (syncTap) syncTap.checked = pm.syncTap !== false;
  const beats = document.getElementById('projectMorphBeats');
  if (beats && document.activeElement !== beats) beats.value = String(pm.beatsPerProject);
  const transitionBeats = document.getElementById('projectMorphTransitionBeats');
  if (transitionBeats && document.activeElement !== transitionBeats)
    transitionBeats.value = String(pm.transitionBeats);
  const cameraWander = document.getElementById('projectMorphCameraWander');
  if (cameraWander) cameraWander.checked = pm.cameraWander === true;
  const transitionType = document.getElementById('projectMorphTransitionType');
  if (transitionType) transitionType.value = pm.transitionType;
  const advancedLinear = document.getElementById('projectMorphAdvancedLinear');
  if (advancedLinear) advancedLinear.checked = pm.advancedLinear === true;
  document
    .getElementById('projectMorphAdvancedLinearRow')
    ?.classList.toggle('hidden', pm.transitionType !== 'linear');
  const transitionSec = document.getElementById('projectMorphTransitionSec');
  if (transitionSec && document.activeElement !== transitionSec)
    transitionSec.value = formatDisplayNumber(pm.transitionSec, 2);
  const imageTransition = document.getElementById('projectMorphImageTransitionType');
  if (imageTransition) imageTransition.value = pm.imageTransitionType;
  const centerSoft = document.getElementById('projectMorphCenterSoftness');
  if (centerSoft && document.activeElement !== centerSoft) centerSoft.value = String(pm.imageCenterSoftness);
  const sectorSoft = document.getElementById('projectMorphSectorSoftness');
  if (sectorSoft && document.activeElement !== sectorSoft) sectorSoft.value = String(pm.imageSectorSoftness);
  const centerSoftValue = document.getElementById('projectMorphCenterSoftnessValue');
  if (centerSoftValue) centerSoftValue.textContent = `${Math.round(pm.imageCenterSoftness)}%`;
  const sectorSoftValue = document.getElementById('projectMorphSectorSoftnessValue');
  if (sectorSoftValue) sectorSoftValue.textContent = `${Math.round(pm.imageSectorSoftness)}%`;
  document
    .getElementById('projectMorphCenterSoftnessRow')
    ?.classList.toggle('hidden', pm.imageTransitionType !== 'center');
  document
    .getElementById('projectMorphSectorSoftnessRow')
    ?.classList.toggle('hidden', pm.imageTransitionType !== 'sector');
  const bpm = Math.max(0, Number(state.tapTempo?.bpm) || 0);
  const bpmText = document.getElementById('projectMorphTapBpm');
  if (bpmText)
    bpmText.textContent =
      pm.syncTap && bpm > 0 ? `${Math.round(bpm)} BPM` : pm.syncTap ? 'TAP выкл.' : 'по секундам';
  const status = document.getElementById('projectMorphStatus');
  if (status) {
    const count = state.playlistProjects?.length || 0;
    const modeText =
      pm.transitionType === 'fade'
        ? 'фейд'
        : pm.transitionType === 'linear'
          ? pm.advancedLinear
            ? 'линейный · геометрия'
            : 'линейный · кроссфейд'
          : `плавно · ${projectMorphTargetSpeedType(pmRt.targetProject)}`;
    const periodText =
      pm.syncTap && bpm > 0
        ? `${pm.beatsPerProject} тактов`
        : `${formatDisplayNumber(getProjectMorphDurationSec(), 2)} с`;
    const transitionText =
      pm.syncTap && bpm > 0
        ? `${pm.transitionBeats} тактов`
        : `${formatDisplayNumber(getProjectMorphTransitionSec(), 2)} с`;
    if (count < 2) status.textContent = 'Нужно минимум два проекта в текущем плейлисте.';
    else if (pmRt.active) {
      const target = state.playlistProjects?.[pmRt.targetIndex];
      status.textContent = `Морфинг → ${target?.name || 'следующий проект'} · ${modeText} · период ${periodText} · переход ${transitionText}`;
    } else {
      status.textContent = `${count} проектов · ${modeText} · период ${periodText} · переход ${transitionText}`;
    }
  }
}
function hexToProjectMorphRgb(value) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(value || ''));
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function projectMorphRgbToHex(rgb) {
  return (
    '#' +
    rgb
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v)))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
const projectMorphColorPairCache = new Map();
function projectMorphColorPair(a, b) {
  const key = `${a}|${b}`;
  let hit = projectMorphColorPairCache.get(key);
  if (hit) return hit;
  const ca = hexToProjectMorphRgb(a),
    cb = hexToProjectMorphRgb(b);
  hit = ca && cb ? { a: ca, b: cb } : null;
  if (projectMorphColorPairCache.size > 512) projectMorphColorPairCache.clear();
  projectMorphColorPairCache.set(key, hit);
  return hit;
}
function projectMorphLerpColor(a, b, t) {
  const pair = projectMorphColorPair(a, b);
  if (!pair) return t < 0.5 ? a : b;
  const ca = pair.a,
    cb = pair.b;
  return projectMorphRgbToHex([
    ca[0] + (cb[0] - ca[0]) * t,
    ca[1] + (cb[1] - ca[1]) * t,
    ca[2] + (cb[2] - ca[2]) * t,
  ]);
}
function projectMorphIsPlainObject(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
function projectMorphValuesEqual(a, b) {
  if (a === b) return true;
  if (a === null || b === null || a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!projectMorphValuesEqual(a[i], b[i])) return false;
    return true;
  }
  if (projectMorphIsPlainObject(a)) {
    if (!projectMorphIsPlainObject(b)) return false;
    const ak = Object.keys(a),
      bk = Object.keys(b);
    if (ak.length !== bk.length) return false;
    for (const k of ak)
      if (!Object.prototype.hasOwnProperty.call(b, k) || !projectMorphValuesEqual(a[k], b[k])) return false;
    return true;
  }
  return false;
}
function projectMorphDiscreteNumberKey(key) {
  return (
    key === 'N' ||
    key === 'K' ||
    /(?:Count|EveryN|Samples|Segments|Copies|Layers|Points|Suborbits|MicroStrikes)$/i.test(String(key || ''))
  );
}
function projectMorphDeepValue(a, b, t, key = '') {
  if (a === undefined) return b === undefined ? undefined : cloneData(b);
  if (b === undefined) return cloneData(a);
  if (a === null || b === null) return cloneData(t < 0.5 ? a : b);
  if (
    Number.isFinite(Number(a)) &&
    Number.isFinite(Number(b)) &&
    typeof a !== 'boolean' &&
    typeof b !== 'boolean' &&
    typeof a !== 'string' &&
    typeof b !== 'string'
  ) {
    const value = Number(a) + (Number(b) - Number(a)) * t;
    return projectMorphDiscreteNumberKey(key) ? Math.round(value) : value;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return projectMorphLerpColor(a, b, t);
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') return t < 0.5 ? a : b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (!a.length && !b.length) return [];
    if (key === 'profileNodes' && a.length && b.length) {
      const n = Math.max(a.length, b.length),
        out = [];
      for (let i = 0; i < n; i++) {
        const ai = Math.round((i * (a.length - 1)) / Math.max(1, n - 1));
        const bi = Math.round((i * (b.length - 1)) / Math.max(1, n - 1));
        out.push(projectMorphDeepValue(a[ai], b[bi], t, key));
      }
      return out;
    }
    if (a.length === b.length) return a.map((v, i) => projectMorphDeepValue(v, b[i], t, key));
    return cloneData(t < 0.5 ? a : b);
  }
  if (projectMorphIsPlainObject(a) && projectMorphIsPlainObject(b)) {
    const out = {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) out[k] = projectMorphDeepValue(a[k], b[k], t, k);
    return out;
  }
  return cloneData(t < 0.5 ? a : b);
}
function projectMorphCloneInto(out, value) {
  if (Array.isArray(value)) {
    const arr = Array.isArray(out) ? out : [];
    arr.length = value.length;
    for (let i = 0; i < value.length; i++) arr[i] = projectMorphCloneInto(arr[i], value[i]);
    return arr;
  }
  if (projectMorphIsPlainObject(value)) {
    const obj = projectMorphIsPlainObject(out) ? out : {};
    for (const k of Object.keys(obj)) if (!Object.prototype.hasOwnProperty.call(value, k)) delete obj[k];
    for (const [k, v] of Object.entries(value)) obj[k] = projectMorphCloneInto(obj[k], v);
    return obj;
  }
  return value;
}
function projectMorphDeepValueInto(out, a, b, t, key = '') {
  if (a === undefined) return b === undefined ? undefined : projectMorphCloneInto(out, b);
  if (b === undefined) return projectMorphCloneInto(out, a);
  if (a === null || b === null) return projectMorphCloneInto(out, t < 0.5 ? a : b);
  if (
    Number.isFinite(Number(a)) &&
    Number.isFinite(Number(b)) &&
    typeof a !== 'boolean' &&
    typeof b !== 'boolean' &&
    typeof a !== 'string' &&
    typeof b !== 'string'
  ) {
    const value = Number(a) + (Number(b) - Number(a)) * t;
    return projectMorphDiscreteNumberKey(key) ? Math.round(value) : value;
  }
  if (typeof a === 'string' && typeof b === 'string') {
    return projectMorphLerpColor(a, b, t);
  }
  if (typeof a === 'boolean' && typeof b === 'boolean') return t < 0.5 ? a : b;
  if (Array.isArray(a) && Array.isArray(b)) {
    const arr = Array.isArray(out) ? out : [];
    if (!a.length && !b.length) {
      arr.length = 0;
      return arr;
    }
    if (key === 'profileNodes' && a.length && b.length) {
      const n = Math.max(a.length, b.length);
      arr.length = n;
      let plan = arr._greenProfilePlan;
      if (!plan || plan.a !== a || plan.b !== b || plan.n !== n) {
        plan = { a, b, n, ai: new Int32Array(n), bi: new Int32Array(n), metaSide: -1 };
        for (let i = 0; i < n; i++) {
          plan.ai[i] = Math.round((i * (a.length - 1)) / Math.max(1, n - 1));
          plan.bi[i] = Math.round((i * (b.length - 1)) / Math.max(1, n - 1));
        }
        try {
          Object.defineProperty(arr, '_greenProfilePlan', {
            value: plan,
            writable: true,
            configurable: true,
          });
        } catch (_) {
          arr._greenProfilePlan = plan;
        }
      }
      const metaSide = t < 0.5 ? 0 : 1,
        refreshMeta = plan.metaSide !== metaSide;
      for (let i = 0; i < n; i++) {
        const av = a[plan.ai[i]] || {},
          bv = b[plan.bi[i]] || av,
          pick = metaSide ? bv : av;
        let q = projectMorphIsPlainObject(arr[i]) ? arr[i] : (arr[i] = {});
        if (refreshMeta) {
          for (const k of Object.keys(q))
            if (
              k !== 'x' &&
              k !== 'y' &&
              k !== 'widthScale' &&
              !Object.prototype.hasOwnProperty.call(pick, k)
            )
              delete q[k];
          for (const [k, v] of Object.entries(pick))
            if (k !== 'x' && k !== 'y' && k !== 'widthScale') q[k] = v;
        }
        const ax = Number(av.x) || 0,
          ay = Number(av.y) || 0,
          bx = Number(bv.x) || 0,
          by = Number(bv.y) || 0;
        q.x = ax + (bx - ax) * t;
        q.y = ay + (by - ay) * t;
        const aw = Number(av.widthScale),
          bw = Number(bv.widthScale);
        if (Number.isFinite(aw) || Number.isFinite(bw)) {
          const aa = Number.isFinite(aw) ? aw : 1,
            bb = Number.isFinite(bw) ? bw : aa;
          q.widthScale = aa + (bb - aa) * t;
        } else if (refreshMeta && Object.prototype.hasOwnProperty.call(q, 'widthScale')) delete q.widthScale;
      }
      plan.metaSide = metaSide;
      return arr;
    }
    if (a.length === b.length) {
      arr.length = a.length;
      for (let i = 0; i < a.length; i++) arr[i] = projectMorphDeepValueInto(arr[i], a[i], b[i], t, key);
      return arr;
    }
    const side = t < 0.5 ? 0 : 1,
      pick = side === 0 ? a : b;
    const memo = arr._greenDiscreteArrayPlan;
    if (memo?.a === a && memo?.b === b && memo.side === side) return arr;
    const result = projectMorphCloneInto(arr, pick);
    const rec = { a, b, side };
    try {
      Object.defineProperty(result, '_greenDiscreteArrayPlan', {
        value: rec,
        writable: true,
        configurable: true,
      });
    } catch (_) {
      result._greenDiscreteArrayPlan = rec;
    }
    return result;
  }
  if (projectMorphIsPlainObject(a) && projectMorphIsPlainObject(b)) {
    const obj = projectMorphIsPlainObject(out) ? out : {};

    let plan = obj._greenValuePlan;
    if (!plan || plan.a !== a || plan.b !== b) {
      const keys = Object.keys(a),
        seen = new Set(keys);
      for (const k of Object.keys(b))
        if (!seen.has(k)) {
          keys.push(k);
          seen.add(k);
        }
      for (const k of Object.keys(obj)) if (!seen.has(k)) delete obj[k];
      const dynamicKeys = [],
        staticKeys = [];

      for (const k of keys) (projectMorphValuesEqual(a[k], b[k]) ? staticKeys : dynamicKeys).push(k);
      plan = { a, b, keys, dynamicKeys, staticKeys, staticReady: false };
      try {
        Object.defineProperty(obj, '_greenValuePlan', { value: plan, writable: true, configurable: true });
      } catch (_) {
        obj._greenValuePlan = plan;
      }
    }
    if (!plan.staticReady) {
      for (const k of plan.staticKeys) obj[k] = projectMorphCloneInto(obj[k], a[k]);
      plan.staticReady = true;
    }
    for (const k of plan.dynamicKeys) obj[k] = projectMorphDeepValueInto(obj[k], a[k], b[k], t, k);
    return obj;
  }
  return projectMorphCloneInto(out, t < 0.5 ? a : b);
}
function cloneProjectMorphPathSet(paths) {
  const out = (Array.isArray(paths) ? paths : [])
    .map((path) => ({
      closed: Boolean(path?.closed),
      points: (path?.points || []).map((p) => ({
        x: Number(p?.x) || 0,
        y: Number(p?.y) || 0,
        widthScale: Number.isFinite(Number(p?.widthScale)) ? Number(p.widthScale) : 1,
      })),
      cornerFlags: Array.isArray(path?.cornerFlags) ? path.cornerFlags.slice() : [],
      _greenRenderedRail: path?._greenRenderedRail === true,
    }))
    .filter((path) => path.points.length >= 2);
  if (paths?._greenRenderedRail === true) out._greenRenderedRail = true;
  return out;
}
function projectMorphResamplePath(path, count) {
  const pts = path?.points || [];
  if (pts.length < 2) return [];
  return resampleMorphTopology(
    pts,
    Math.max(48, Math.min(960, Math.round(count) || 240)),
    Boolean(path?.closed),
    null,
  ).map((p) => ({ x: Number(p.x) || 0, y: Number(p.y) || 0, widthScale: Number(p.widthScale) || 1 }));
}
function projectMorphAlignmentCost(src, dst, offset, reverse, closed) {
  const n = Math.min(src.length, dst.length);
  if (!n) return Infinity;
  const probes = Math.min(32, n),
    stride = Math.max(1, Math.floor(n / probes));
  let sum = 0,
    used = 0;
  for (let i = 0; i < n; i += stride) {
    const j = closed ? (((reverse ? offset - i : i + offset) % n) + n) % n : reverse ? n - 1 - i : i;
    const a = src[i],
      b = dst[j];
    if (!a || !b) continue;
    const dx = a.x - b.x,
      dy = a.y - b.y;
    sum += dx * dx + dy * dy;
    used++;
  }
  return used ? sum / used : Infinity;
}
function projectMorphBestAlignment(src, dst, closed) {
  const n = Math.min(src.length, dst.length);
  if (n < 2) return { offset: 0, reverse: false };
  if (!closed) {
    const normal = projectMorphAlignmentCost(src, dst, 0, false, false);
    const reversed = projectMorphAlignmentCost(src, dst, 0, true, false);
    return { offset: 0, reverse: reversed < normal };
  }
  let bestCost = Infinity,
    bestOffset = 0,
    bestReverse = false;

  if (n <= 192) {
    for (let reverseIndex = 0; reverseIndex < 2; reverseIndex++) {
      const reverse = reverseIndex === 1;
      for (let offset = 0; offset < n; offset++) {
        const cost = projectMorphAlignmentCost(src, dst, offset, reverse, true);
        if (cost < bestCost) {
          bestCost = cost;
          bestOffset = offset;
          bestReverse = reverse;
        }
      }
    }
    return { offset: bestOffset, reverse: bestReverse };
  }
  const step = Math.max(2, Math.floor(n / 96));
  for (let reverseIndex = 0; reverseIndex < 2; reverseIndex++) {
    const reverse = reverseIndex === 1,
      candidates = [];
    for (let offset = 0; offset < n; offset += step) {
      const cost = projectMorphAlignmentCost(src, dst, offset, reverse, true);
      candidates.push({ offset, cost });
    }
    candidates.sort((a, b) => a.cost - b.cost);

    const seen = new Set();
    for (const candidate of candidates.slice(0, 4)) {
      for (let delta = -step; delta <= step; delta++) {
        const offset = (((candidate.offset + delta) % n) + n) % n;
        if (seen.has(offset)) continue;
        seen.add(offset);
        const cost = projectMorphAlignmentCost(src, dst, offset, reverse, true);
        if (cost < bestCost) {
          bestCost = cost;
          bestOffset = offset;
          bestReverse = reverse;
        }
      }
    }
  }
  return { offset: bestOffset, reverse: bestReverse };
}
function buildProjectMorphLayerGeometryPlan(sourcePaths, targetPaths) {
  const src = cloneProjectMorphPathSet(sourcePaths),
    dst = cloneProjectMorphPathSet(targetPaths);
  if (!src.length && !dst.length) return { pairs: [] };
  if (!src.length) return { pairs: dst.map((p) => ({ src: p, dst: p, fadeIn: true })) };
  if (!dst.length) return { pairs: src.map((p) => ({ src: p, dst: p, fadeOut: true })) };
  const paired = pairMorphPaths(src, dst),
    pairs = [];

  const srcMultiplicity = new Map(),
    dstMultiplicity = new Map();
  for (const pair of paired) {
    if (pair?.src) srcMultiplicity.set(pair.src, (srcMultiplicity.get(pair.src) || 0) + 1);
    if (pair?.dst) dstMultiplicity.set(pair.dst, (dstMultiplicity.get(pair.dst) || 0) + 1);
  }
  const srcSeen = new Map(),
    dstSeen = new Map();
  for (const pair of paired) {
    const sp = pair?.src || pair?.dst,
      dp = pair?.dst || pair?.src;
    if (!sp || !dp) continue;
    const targetCount = Math.max(
      96,
      Math.min(960, Math.max(sp.points?.length || 0, dp.points?.length || 0, 192)),
    );
    const sPts = projectMorphResamplePath(sp, targetCount),
      dPts = projectMorphResamplePath(dp, targetCount);
    if (sPts.length < 2 || dPts.length < 2) continue;
    const n = Math.min(sPts.length, dPts.length);
    sPts.length = n;
    dPts.length = n;
    const bothClosed = Boolean(sp.closed && dp.closed);
    const alignment = projectMorphBestAlignment(sPts, dPts, bothClosed);
    const sourceOrdinal = pair?.src ? srcSeen.get(pair.src) || 0 : 0;
    const targetOrdinal = pair?.dst ? dstSeen.get(pair.dst) || 0 : 0;
    if (pair?.src) srcSeen.set(pair.src, sourceOrdinal + 1);
    if (pair?.dst) dstSeen.set(pair.dst, targetOrdinal + 1);
    pairs.push({
      src: sPts,
      dst: dPts,
      srcClosed: Boolean(sp.closed),
      dstClosed: Boolean(dp.closed),
      offset: alignment.offset || 0,
      reverse: alignment.reverse === true,
      fadeIn: pair?.src ? false : true,
      fadeOut: pair?.dst ? false : true,
      sourceWeight: pair?.src ? (sourceOrdinal === 0 ? 1 : 0) : 0,
      targetWeight: pair?.dst ? (targetOrdinal === 0 ? 1 : 0) : 0,
      frame: {
        points: Array.from({ length: n }, () => ({ x: 0, y: 0, widthScale: 1 })),
        closed: bothClosed,
        cornerFlags: [],
        _alpha: 1,
      },
    });
  }
  return { pairs };
}
function projectMorphPlanExtent(plan) {
  let maxR2 = 1;
  for (const pair of plan?.pairs || []) {
    for (const list of [pair?.src, pair?.dst])
      for (const p of list || []) {
        const x = Number(p?.x) || 0,
          y = Number(p?.y) || 0,
          r2 = x * x + y * y;
        if (r2 > maxR2) maxR2 = r2;
      }
  }
  return Math.max(1, Math.sqrt(maxR2));
}
function projectMorphRenderedRail(layerIndex, layer, paths, preferActiveMorph = false) {
  const source = Array.isArray(paths) ? paths : [];
  if (!layer || !source.length) return cloneProjectMorphPathSet(source);

  if (layer.roundingCornerType === 'fourier' || isSpiralLayer(layer)) {
    const rendered = layer.roundingCornerType === 'fourier'
      ? somataWithFourierLayer(layer, () => prepareFourierPathList(source)) : source;
    const out = cloneProjectMorphPathSet(rendered);
    out._greenRenderedRail = true;
    for (const p of out) p._greenRenderedRail = true;
    return out;
  }
  let visible = source;
  try {
    let morphInfo = null;
    if (
      preferActiveMorph &&
      runtimeState.morph?.active &&
      state.morph?.mode !== 'light' &&
      state.morph?.mode !== 'fade'
    ) {
      const t = Number.isFinite(Number(runtimeState.morph.geometryT))
        ? Number(runtimeState.morph.geometryT)
        : Number(runtimeState.morph.progress) || 0;
      morphInfo = getLampMorphRenderInfo(layerIndex, t, layer);
    }
    visible = buildLampRenderedAttachmentPaths(source, layer, morphInfo) || source;
  } catch (_) {
    visible = source;
  }
  const out = cloneProjectMorphPathSet(visible);
  out._greenRenderedRail = true;
  for (const p of out) p._greenRenderedRail = true;
  return out;
}
function getProjectMorphVisiblePaths(layerIndex, layer) {
  const pm = runtimeState.projectMorph;
  const prior = pm?.frameGeometry?.[layerIndex];
  if (pm?.active && Array.isArray(prior) && prior.length) return cloneProjectMorphPathSet(prior);
  const staticData = layer ? getCachedLayerDrawData(layer) : null;
  const raw = layer ? somataWithFourierLayer(layer, () => getAuxiliaryLayerPaths(layerIndex, layer, staticData || undefined)) : [];
  return projectMorphRenderedRail(layerIndex, layer, raw, true);
}
function projectMorphCollectLampSnapshot(
  layerIndex,
  layer,
  paths,
  preferActiveMorph = false,
  lampConfig = null,
) {
  if (!layer || !Array.isArray(paths) || !paths.length) return [];
  const cfg =
    lampConfig && typeof lampConfig === 'object'
      ? projectMorphCloneInto({}, lampConfig)
      : ensureLayerLampState(layer);
  return withLampConfig(cfg, () => {
    const mode = getLampEvaluationConfig()?.positionMode || 'key';
    if (preferActiveMorph && runtimeState.morph?.active && state.morph.mode !== 'fade') {
      const t = Number.isFinite(runtimeState.morph.geometryT) ? runtimeState.morph.geometryT : 0;
      try {
        return collectMorphLampPoints(layerIndex, t, 320, paths, paths).map((p) => ({ ...p }));
      } catch (error) {
        noteSuppressedError('project/project-morph#projectMorphCollectLampSnapshot', error);
      }
    }
    if (mode === 'arbitrary')
      return collectArbitraryStaticLampPoints(
        layer,
        { paths, geometryKey: `pm-lamp-${layer.id || layerIndex}` },
        600,
      ).map((p) => ({ ...p }));
    if (mode === 'corners')
      return collectSmoothCornerLampPoints(layerIndex, paths, 320, false).map((p) => ({ ...p }));
    return buildLampCircumferenceAnchors(
      layer,
      { paths, geometryKey: `pm-lamp-${layer.id || layerIndex}` },
      320,
    ).map((p) => ({ ...p }));
  });
}
function buildProjectMorphLampPlan(
  sourcePoints,
  targetPoints,
  layerIndex,
  sourceEnabled = true,
  targetEnabled = true,
  modeChanged = false,
) {
  const src = (sourcePoints || []).map((p, i) => ({ ...p, _i: i }));
  const dst = (targetPoints || []).map((p, i) => ({ ...p, _i: i }));
  const srcLevel = (p) => (sourceEnabled === true ? Math.max(0, Math.min(1, Number(p?.lampLevel ?? 1))) : 0);
  const dstLevel = (p) => (targetEnabled === true ? Math.max(0, Math.min(1, Number(p?.lampLevel ?? 1))) : 0);
  if (!src.length && !dst.length) return { pairs: [], frame: [] };
  if (modeChanged) {
    const pairs = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[i];
      pairs.push({
        a,
        b: a,
        startLevel: srcLevel(a),
        endLevel: 0,
        id: `green:${layerIndex}:old:${a?.lampId || i}`,
        seed: a?.lampSeed,
      });
    }
    for (let i = 0; i < dst.length; i++) {
      const b = dst[i];
      pairs.push({
        a: b,
        b,
        startLevel: 0,
        endLevel: dstLevel(b),
        id: `green:${layerIndex}:new:${b?.lampId || i}`,
        seed: b?.lampSeed,
      });
    }
    return { pairs, frame: [] };
  }

  const order = (p) =>
    Number.isFinite(Number(p?.lampAttachFraction))
      ? Number(p.lampAttachFraction)
      : Number.isFinite(Number(p?.vertexIndex))
        ? Number(p.vertexIndex)
        : Number(p?._i) || 0;
  const group = (list) => {
    const m = new Map();
    for (const p of list) {
      const k = Number.isInteger(p?.pathIndex) ? p.pathIndex : 0;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(p);
    }
    for (const a of m.values()) a.sort((x, y) => order(x) - order(y) || x._i - y._i);
    return m;
  };
  const sg = group(src),
    dg = group(dst),
    pathKeys = [...new Set([...sg.keys(), ...dg.keys()])].sort((a, b) => a - b),
    pairs = [];
  for (const pathIndex of pathKeys) {
    const sa = sg.get(pathIndex) || [],
      da = dg.get(pathIndex) || [],
      m = Math.max(sa.length, da.length);
    if (!m) continue;
    let prevSi = -1,
      prevDi = -1;
    for (let k = 0; k < m; k++) {
      const si = sa.length ? Math.round((k * (sa.length - 1)) / Math.max(1, m - 1)) : -1,
        di = da.length ? Math.round((k * (da.length - 1)) / Math.max(1, m - 1)) : -1;
      const a = si >= 0 ? sa[si] : di >= 0 ? da[di] : { x: 0, y: 0 },
        b = di >= 0 ? da[di] : a;
      const srcDuplicate = si >= 0 && si === prevSi,
        targetDuplicate = di >= 0 && di === prevDi;
      prevSi = si;
      prevDi = di;
      const targetId = di >= 0 ? b?.lampId : null,
        sourceId = si >= 0 ? a?.lampId : null;
      pairs.push({
        a,
        b,
        startLevel: si < 0 || srcDuplicate ? 0 : srcLevel(a),
        endLevel: di < 0 || targetDuplicate ? 0 : dstLevel(b),
        id: targetId || sourceId || `green:${layerIndex}:${pathIndex}:${k}`,
        seed: b?.lampSeed ?? a?.lampSeed,
      });
    }
  }
  return { pairs, frame: [] };
}
function updateProjectMorphLampFrame(pm, positionT, levelT = positionT) {
  const ease = Math.max(0, Math.min(1, Number(positionT) || 0)),
    level = Math.max(0, Math.min(1, Number(levelT) || 0));
  pm.frameLampPoints = Array.isArray(pm.frameLampPoints) ? pm.frameLampPoints : [];
  for (let li = 0; li < (pm.lampPlans || []).length; li++) {
    const plan = pm.lampPlans[li],
      out = pm.frameLampPoints[li] || (pm.frameLampPoints[li] = []),
      pairs = plan?.pairs || [];
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i],
        a = pair.a || {},
        b = pair.b || a;
      let q = out[i];
      if (!q)
        q = out[i] = { x: 0, y: 0, lampLevel: 1, lampId: '', lampSeed: 0, pathIndex: 0, vertexIndex: 0 };
      q.x = (Number(a.x) || 0) + ((Number(b.x) || 0) - (Number(a.x) || 0)) * ease;
      q.y = (Number(a.y) || 0) + ((Number(b.y) || 0) - (Number(a.y) || 0)) * ease;
      q.lampLevel = Math.max(
        0,
        Math.min(
          1,
          (Number(pair.startLevel) || 0) +
            ((Number(pair.endLevel) || 0) - (Number(pair.startLevel) || 0)) * level,
        ),
      );
      q.lampId = pair.id || `green:${li}:${i}`;
      q.lampSeed = Number.isFinite(Number(pair.seed)) ? Number(pair.seed) : lampHash32(`green:${li}:${i}`);
      q.pathIndex = Number.isInteger(b.pathIndex)
        ? b.pathIndex
        : Number.isInteger(a.pathIndex)
          ? a.pathIndex
          : 0;
      q.vertexIndex = Number.isInteger(b.vertexIndex)
        ? b.vertexIndex
        : Number.isInteger(a.vertexIndex)
          ? a.vertexIndex
          : i;
    }
    out.length = pairs.length;
  }
}
function prepareProjectMorphGeometry(pm, targetProject) {
  const targetLayers = Array.isArray(targetProject?.layers) ? targetProject.layers : [];
  const wasActive = pm?.active === true;
  const priorFade = wasActive && pm?.renderMode === 'crossfade';
  const priorFadeT = Math.max(0, Math.min(1, Number(pm?.fadeProgress) || 0));

  const priorGeometry = [];
  const priorCount = Math.max(
    pm?.frameGeometry?.length || 0,
    pm?.sourceGeometry?.length || 0,
    pm?.targetGeometry?.length || 0,
  );
  if (wasActive) {
    for (let i = 0; i < priorCount; i++) {
      const visible = priorFade
        ? (priorFadeT < 0.5 ? pm.sourceGeometry : pm.targetGeometry)?.[i] || null
        : pm.frameGeometry?.[i] || null;
      priorGeometry[i] = Array.isArray(visible) && visible.length ? cloneProjectMorphPathSet(visible) : [];
    }
  }
  const sourceProjectLayers = Array.isArray(pm?.sourceProject?.layers) ? pm.sourceProject.layers : [];
  const n = Math.max(
    state.layers.length,
    sourceProjectLayers.length,
    targetLayers.length,
    priorGeometry.length,
  );
  pm.geometryPlans = [];
  pm.frameGeometry = [];
  pm.frameExtents = [];
  pm.frameGeometryLayerProgress = [];
  pm.lampPlans = [];
  pm.frameLampPoints = [];
  pm.sourceGeometry = [];
  pm.targetGeometry = [];
  pm.sourceRenderLayers = [];
  pm.targetRenderLayers = [];
  if (!Array.isArray(pm.frameRenderLayers)) pm.frameRenderLayers = [];
  for (let i = 0; i < n; i++) {
    const sourceLayer = sourceProjectLayers[i] ? cloneData(sourceProjectLayers[i]) : state.layers[i] || null;
    const geometryProbeLayer = state.layers[i] || sourceLayer;
    const targetLayer = targetLayers[i] ? cloneData(targetLayers[i]) : null;
    const sourcePaths = priorGeometry[i]?.length
      ? priorGeometry[i]
      : geometryProbeLayer
        ? getProjectMorphVisiblePaths(i, geometryProbeLayer)
        : [];
    const warmedCandidate = pm?.targetWarmup?.[i] || null;
    const targetGeometryKey =
      targetLayer && typeof layerGeometrySignature === 'function'
        ? layerGeometrySignature(targetLayer)
        : null;
    const warmedTarget =
      warmedCandidate && (!targetGeometryKey || warmedCandidate.geometryKey === targetGeometryKey)
        ? warmedCandidate
        : null;
    const targetRawPaths =
      targetLayer && !warmedTarget ? getCachedLayerDrawData(targetLayer)?.paths || [] : [];
    const targetPaths = targetLayer
      ? Array.isArray(warmedTarget?.paths)
        ? warmedTarget.paths
        : projectMorphRenderedRail(i, targetLayer, targetRawPaths, false)
      : [];

    const effectiveSource = sourcePaths.length ? sourcePaths : targetPaths;
    const effectiveTarget = targetPaths.length ? targetPaths : sourcePaths;
    pm.geometryPlans[i] = buildProjectMorphLayerGeometryPlan(effectiveSource, effectiveTarget);
    pm.sourceGeometry[i] = cloneProjectMorphPathSet(effectiveSource);
    pm.targetGeometry[i] = cloneProjectMorphPathSet(effectiveTarget);
    pm.sourceRenderLayers[i] = cloneData(sourceLayer || targetLayer || createLayer(`PM source ${i + 1}`));
    pm.targetRenderLayers[i] = cloneData(targetLayer || sourceLayer || createLayer(`PM target ${i + 1}`));
    pm.frameGeometry[i] = [];
    pm.frameExtents[i] = projectMorphPlanExtent(pm.geometryPlans[i]);
    const sourceLampCfg = pm?.sourceProject?.settings?.lamps || state.lamps;
    const targetLampCfg = targetProject?.settings?.lamps || sourceLampCfg;
    const sourceLampPoints = sourceLayer
      ? projectMorphCollectLampSnapshot(i, sourceLayer, effectiveSource, true, sourceLampCfg)
      : [];
    const targetLampPoints = targetLayer
      ? Array.isArray(warmedTarget?.lampPoints)
        ? warmedTarget.lampPoints
        : projectMorphCollectLampSnapshot(i, targetLayer, effectiveTarget, false, targetLampCfg)
      : [];
    const sourceLampsEnabled = sourceLayer ? getLayerLampsEnabled(sourceLayer) : false;
    const targetLampsEnabled = targetLayer ? getLayerLampsEnabled(targetLayer) : false;
    const lampModeChanged =
      pm?.renderMode === 'crossfade' ||
      String(sourceLampCfg?.positionMode || 'key') !== String(targetLampCfg?.positionMode || 'key');
    pm.lampPlans[i] = buildProjectMorphLampPlan(
      sourceLampPoints,
      targetLampPoints,
      i,
      sourceLampsEnabled,
      targetLampsEnabled,
      lampModeChanged,
    );
    pm.frameLampPoints[i] = [];
  }
  pm.frameGeometryProgress = -1;

  updateProjectMorphLampFrame(pm, 0);
}
function updateProjectMorphGeometryFrame(pm, t, onlyLayer = -1, parameterT = null) {
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  const param = Math.max(
    0,
    Math.min(1, Number(parameterT === null ? (pm?.parameterProgress ?? u) : parameterT) || 0),
  );
  const plans = pm?.geometryPlans || [];
  if (!Array.isArray(pm.frameGeometryLayerProgress)) pm.frameGeometryLayerProgress = [];
  if (!Array.isArray(pm.frameGeometryLayerParameterProgress)) pm.frameGeometryLayerParameterProgress = [];
  const from = Number.isInteger(onlyLayer) && onlyLayer >= 0 ? onlyLayer : 0;
  const to =
    Number.isInteger(onlyLayer) && onlyLayer >= 0 ? Math.min(plans.length, onlyLayer + 1) : plans.length;
  for (let li = from; li < to; li++) {
    const sameGeometry = Math.abs((Number(pm.frameGeometryLayerProgress[li]) || 0) - u) < 1e-9;
    const sameParameters = Math.abs((Number(pm.frameGeometryLayerParameterProgress[li]) || 0) - param) < 1e-9;
    if (
      sameGeometry &&
      sameParameters &&
      Array.isArray(pm.frameGeometry?.[li]) &&
      pm.frameGeometry[li].length
    )
      continue;
    const plan = plans[li],
      out = pm.frameGeometry[li] || (pm.frameGeometry[li] = []);
    out.length = 0;
    let maxR2 = 1;
    for (const pair of plan?.pairs || []) {
      const src = pair.src || [],
        dst = pair.dst || [],
        n = Math.min(src.length, dst.length);
      if (n < 2) continue;
      const frame = pair.frame;
      frame.closed =
        pair.srcClosed === pair.dstClosed ? pair.srcClosed : u < 0.5 ? pair.srcClosed : pair.dstClosed;
      frame._greenRenderedRail = true;
      for (let i = 0; i < n; i++) {
        const j =
          frame.closed || (pair.srcClosed && pair.dstClosed)
            ? (((pair.reverse ? pair.offset - i : i + pair.offset) % n) + n) % n
            : pair.reverse
              ? n - 1 - i
              : i;
        const a = src[i],
          b = dst[j],
          q = frame.points[i];
        q.x = a.x + (b.x - a.x) * u;
        q.y = a.y + (b.y - a.y) * u;
        q.widthScale =
          (Number(a.widthScale) || 1) + ((Number(b.widthScale) || 1) - (Number(a.widthScale) || 1)) * u;
        const r2 = q.x * q.x + q.y * q.y;
        if (r2 > maxR2) maxR2 = r2;
      }
      const sw = Number.isFinite(Number(pair.sourceWeight)) ? Number(pair.sourceWeight) : 1;
      const tw = Number.isFinite(Number(pair.targetWeight)) ? Number(pair.targetWeight) : 1;
      frame._alpha = Math.max(0, Math.min(1, sw + (tw - sw) * param));
      frame._frameGeometryId = frameGeometryRuntime.frameId;
      out.push(frame);
    }
    out._frameGeometryId = frameGeometryRuntime.frameId;
    out._greenRenderedRail = true;
    pm.frameExtents[li] = Math.max(Number(pm.frameExtents[li]) || 1, Math.sqrt(maxR2));
    pm.frameGeometryLayerProgress[li] = u;
    pm.frameGeometryLayerParameterProgress[li] = param;
  }
  if (!(Number.isInteger(onlyLayer) && onlyLayer >= 0)) pm.frameGeometryProgress = u;
}
function ensureProjectMorphFrameGeometryLayer(layerIndex, t = null) {
  const pm = runtimeState.projectMorph;
  if (!pm?.active) return null;
  const u =
    t === null
      ? Number.isFinite(Number(pm.renderProgress))
        ? Number(pm.renderProgress)
        : Number(pm.progress) || 0
      : Number(t);
  updateProjectMorphGeometryFrame(
    pm,
    u,
    Math.max(0, Math.round(Number(layerIndex) || 0)),
    pm.parameterProgress,
  );
  return pm.frameGeometry?.[layerIndex] || null;
}
function projectMorphLayerPair(a, b, t, index, strictDiscrete = false, reuse = null) {
  if (!a && !b) return null;
  const source = a || b,
    target = b || a;
  if (strictDiscrete) {
    const chosen = t < 0.5 ? source : target;
    const out = projectMorphCloneInto(reuse, chosen);
    out.id = a?.id || b?.id || createLayerId(`pm${index}`);
    out.name = chosen?.name || a?.name || b?.name || `Слой ${index + 1}`;
    out.visible = chosen?.visible !== false;
    out.opacity = Math.max(0, Number(chosen?.opacity ?? 100));
    return out;
  }
  const out = projectMorphDeepValueInto(reuse, source, target, t, 'layer');
  const aOpacity = a && a.visible !== false ? Math.max(0, Number(a.opacity ?? 100)) : 0;
  const bOpacity = b && b.visible !== false ? Math.max(0, Number(b.opacity ?? 100)) : 0;
  out.opacity = aOpacity + (bOpacity - aOpacity) * t;
  out.visible = out.opacity > 0.01;

  const sourceLampsOn = a?.showLamps === true;
  const targetLampsOn = b?.showLamps === true;
  out.showLamps = sourceLampsOn || targetLampsOn;

  const sourceSweep = a?.sweep && typeof a.sweep === 'object' ? a.sweep : null;
  const targetSweep = b?.sweep && typeof b.sweep === 'object' ? b.sweep : null;
  const sameSweep =
    sourceSweep?.enabled === true &&
    targetSweep?.enabled === true &&
    sourceSweep.effectType === targetSweep.effectType;
  if (!sameSweep && (sourceSweep || targetSweep)) {
    out.sweep = projectMorphCloneInto(
      out.sweep,
      t < 0.5 ? sourceSweep || targetSweep : targetSweep || sourceSweep,
    );
  }
  out.id = a?.id || b?.id || createLayerId(`pm${index}`);
  out.name = t < 0.5 ? a?.name || b?.name || `Слой ${index + 1}` : b?.name || a?.name || `Слой ${index + 1}`;
  return out;
}
function applyProjectMorphConfigFrame(frame) {
  if (!frame || typeof frame !== 'object') return;

  runtimeState.projectMorph.frameMorphSettings = frame;
}
function applyProjectMorphTunnelFrame(frame) {
  if (!frame || typeof frame !== 'object') return;
  const t = state.tunnel;
  t.density = normalizeTunnelDensity(frame.density);
  for (const key of [
    'speedStrength',
    'speedMultiplier',
    'spacingStrength',
    'spacingMultiplier',
    'depthCurve',
    'depthCurveMultiplier',
    'centerHiddenCopies',
    'colorShiftEnabled',
    'colorShiftDegrees',
    'paletteLagEnabled',
    'fadeOversize',
    'fadeOffsetSteps',
    'vignetteAmount',
    'vignetteUnit',
    'fadeDurationSec',
  ]) {
    if (Object.prototype.hasOwnProperty.call(frame, key)) t[key] = cloneData(frame[key]);
  }
  t.speedStrength = Math.max(-1, Math.min(1, Number(t.speedStrength) || 0));
  t.speedMultiplier = Math.max(0, Number(t.speedMultiplier) || 0);
  t.spacingStrength = Math.max(0.01, Number(t.spacingStrength) || 0.01);
  t.spacingMultiplier = Math.max(0, Number(t.spacingMultiplier) || 0);
  t.depthCurve = Math.max(-100, Math.min(100, Number(t.depthCurve) || 0));
  t.depthCurveMultiplier = Math.max(
    0,
    Number.isFinite(Number(t.depthCurveMultiplier)) ? Number(t.depthCurveMultiplier) : 1,
  );
  normalizeTunnelCenterHiddenCopies(t);
  normalizeTunnelColorShiftState(t);
  t.vignetteAmount = Math.max(0, Math.min(1200, Number(t.vignetteAmount) || 0));
  t.vignetteUnit = 'px';
  t.fadeDurationSec = Math.max(0, Number(t.fadeDurationSec) || 0);
}
function applyProjectMorphFrame(sourceProject, targetProject, geometryT, parameterT = geometryT) {
  const pm = normalizeProjectMorphSettings(),
    pmRt = runtimeState.projectMorph;
  const renderT = Math.max(0, Math.min(1, Number(geometryT) || 0));
  const paramT = Math.max(0, Math.min(1, Number(parameterT) || 0));
  const crossfade = pmRt.renderMode === 'crossfade';

  const configT = crossfade ? (renderT < 0.5 ? 0 : 1) : paramT;
  const configChanged = !crossfade || pmRt.crossfadeConfigSide !== configT;
  if (crossfade) pmRt.crossfadeConfigSide = configT;
  pmRt.renderProgress = renderT;
  pmRt.parameterProgress = paramT;
  const aLayers = Array.isArray(sourceProject?.layers) ? sourceProject.layers : [];
  const bLayers = Array.isArray(targetProject?.layers) ? targetProject.layers : [];
  const n = Math.max(aLayers.length, bLayers.length);
  if (configChanged) {
    const layers = Array.isArray(pmRt.frameRenderLayers)
      ? pmRt.frameRenderLayers
      : (pmRt.frameRenderLayers = []);
    let write = 0;
    for (let i = 0; i < n; i++) {
      const layer = projectMorphLayerPair(
        aLayers[i],
        bLayers[i],
        configT,
        i,
        crossfade,
        layers[write] || null,
      );
      if (layer) layers[write++] = layer;
    }
    layers.length = write;
  }
  const a = sourceProject?.settings || {},
    b = targetProject?.settings || {};
  if (configChanged && (typeof a.bgColor === 'string' || typeof b.bgColor === 'string'))
    state.bgColor = projectMorphDeepValue(
      a.bgColor || state.bgColor,
      b.bgColor || a.bgColor || state.bgColor,
      configT,
      'bgColor',
    );
  updateProjectMorphBackgroundTransition(sourceProject, targetProject, renderT);

  pmRt.frameGeometryProgress = -1;
  updateProjectMorphLampFrame(pmRt, renderT, paramT);
  if (pm.cameraWander === true) {
    if (Number.isFinite(Number(a.zoom)) || Number.isFinite(Number(b.zoom)))
      state.zoom = Math.max(
        0.05,
        (Number(a.zoom) || state.zoom) +
          ((Number(b.zoom) || Number(a.zoom) || state.zoom) - (Number(a.zoom) || state.zoom)) * renderT,
      );
    if (Number.isFinite(Number(a.panX)) || Number.isFinite(Number(b.panX)))
      state.panX = (Number(a.panX) || 0) + ((Number(b.panX) || 0) - (Number(a.panX) || 0)) * renderT;
    if (Number.isFinite(Number(a.panY)) || Number.isFinite(Number(b.panY)))
      state.panY = (Number(a.panY) || 0) + ((Number(b.panY) || 0) - (Number(a.panY) || 0)) * renderT;
  }
  if (configChanged && (a.lineOutline || b.lineOutline)) {
    const aa = a.lineOutline || b.lineOutline || {},
      bb = b.lineOutline || a.lineOutline || {};
    // Random outline coverage is an identity choice, never a numeric
    // parameter to interpolate. Interpolating the seed would reshuffle
    // the outlined layers on every Orange project Morph frame.
    const previousOutlineSeed = state.lineOutline?.selectionSeed;
    state.lineOutline = projectMorphDeepValueInto(state.lineOutline, aa, bb, configT, 'lineOutline');
    window.somataOutlineSyncAnimation?.();
    const fixedSeed =
      configT >= 1 ? bb.selectionSeed : (previousOutlineSeed ?? aa.selectionSeed ?? bb.selectionSeed);
    if (fixedSeed != null && Number.isFinite(Number(fixedSeed)))
      state.lineOutline.selectionSeed = Number(fixedSeed) >>> 0;
  }
  if (configChanged && (a.lamps || b.lamps)) {
    const aa = a.lamps || b.lamps || {},
      bb = b.lamps || a.lamps || {};
    pmRt.frameLampConfig = projectMorphDeepValueInto(pmRt.frameLampConfig, aa, bb, configT, 'lamps');
  }
  if (configChanged && (a.morph || b.morph)) {
    const aa = a.morph || b.morph || {},
      bb = b.morph || a.morph || {};
    pmRt.frameMorphSettings = projectMorphDeepValueInto(pmRt.frameMorphSettings, aa, bb, configT, 'morph');
    applyProjectMorphConfigFrame(pmRt.frameMorphSettings);
  }
  if (configChanged && (a.tunnel || b.tunnel)) {
    const aa = a.tunnel || b.tunnel || {},
      bb = b.tunnel || a.tunnel || {};
    pmRt.frameTunnelSettings = projectMorphDeepValueInto(pmRt.frameTunnelSettings, aa, bb, configT, 'tunnel');
    const tunnelFrame = pmRt.frameTunnelSettings;
    const densityA = normalizeTunnelDensity(aa.density);
    const densityB = normalizeTunnelDensity(bb.density);
    tunnelFrame.density = densityA + (densityB - densityA) * configT;
    const av = tunnelVignettePixelsFromSettings(aa, state.tunnel.vignetteAmount),
      bv = tunnelVignettePixelsFromSettings(bb, av);
    tunnelFrame.vignetteAmount = av + (bv - av) * configT;
    tunnelFrame.vignetteUnit = 'px';
    applyProjectMorphTunnelFrame(tunnelFrame);
  }
  const uiNow = performance.now();
  if (uiNow - (pmRt.lastSettingsUiAt || 0) >= 100) {
    const morphPanel = document.getElementById('morphSettingsPanel');
    const tunnelPanel = document.getElementById('tunnelSettingsPanel');
    const morphPanelOpen = Boolean(morphPanel && !morphPanel.classList.contains('hidden'));
    const tunnelPanelOpen = Boolean(tunnelPanel && !tunnelPanel.classList.contains('hidden'));
    if (morphPanelOpen || tunnelPanelOpen) {
      pmRt.lastSettingsUiAt = uiNow;
      if (morphPanelOpen && typeof syncMorphSettingsUI === 'function') syncMorphSettingsUI();
      if (tunnelPanelOpen && typeof syncTunnelSettingsUI === 'function') syncTunnelSettingsUI();
    }
  }
  requestMainCanvasRender();
}
function scheduleProjectMorphTargetGeometryWarmup(pmRt, targetProject) {
  if (!pmRt || !targetProject) return;
  const serial = (Math.max(0, Number(pmRt.targetWarmupSerial) || 0) + 1) >>> 0;
  pmRt.targetWarmupSerial = serial;
  pmRt.targetWarmup = [];
  pmRt.targetWarmupComplete = false;
  pmRt.targetBackgroundPreload = null;
  const layers = Array.isArray(targetProject?.layers) ? targetProject.layers : [];
  const lampCfg = targetProject?.settings?.lamps || state.lamps;
  const bgImage = getProjectBackgroundSpec(targetProject).image;
  if (bgImage && typeof Image !== 'undefined') {
    const loadBackground = () => {
      if (!pmRt.active || pmRt.targetWarmupSerial !== serial || pmRt.targetProject !== targetProject) return;
      try {
        const img = new Image();
        img.decoding = 'async';
        img.src = bgImage;
        pmRt.targetBackgroundPreload = img;
        img.decode?.().catch(() => {});
      } catch (error) {
        noteSuppressedError('project/project-morph#loadBackground', error);
      }
    };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(loadBackground, { timeout: 500 });
    else setTimeout(loadBackground, 32);
  }
  let index = 0;
  const step = (deadline) => {
    if (!pmRt.active || pmRt.targetWarmupSerial !== serial || pmRt.targetProject !== targetProject) return;
    if (index >= layers.length) {
      pmRt.targetWarmupComplete = true;
      return;
    }
    const i = index++;
    try {
      const layer = cloneData(layers[i]);
      const canonical = getCanonicalLayerGeometry(layer);
      if (canonical && typeof ensureCanonicalPathTable === 'function') ensureCanonicalPathTable(canonical);
      const raw = canonical?.drawData?.paths || getCachedLayerDrawData(layer)?.paths || [];
      const paths = projectMorphRenderedRail(i, layer, raw, false);
      const lampPoints = projectMorphCollectLampSnapshot(i, layer, paths, false, lampCfg);
      pmRt.targetWarmup[i] = {
        paths,
        lampPoints,
        layerId: layer?.id || null,
        geometryKey: canonical?.geometryKey || layerGeometrySignature(layer),
      };
    } catch (_) {
      pmRt.targetWarmup[i] = null;
    }
    if (index >= layers.length) {
      pmRt.targetWarmupComplete = true;
      return;
    }
    const queue = () => {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(step, { timeout: 700 });
      else setTimeout(() => step({ timeRemaining: () => 0, didTimeout: true }), 16);
    };

    queue();
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(step, { timeout: 350 });
  else setTimeout(() => step({ timeRemaining: () => 0, didTimeout: true }), 16);
}
function schedulePlaylistGpuWarmup() {
  const run = () => {
    try {
      WebGPUGreenProjectMorphRenderer?.warmup?.();
    } catch (error) {
      noteSuppressedError('project/project-morph#run', error);
    }
    try {
      WebGPUStrokeRenderer?.warmup?.();
    } catch (error) {
      noteSuppressedError('project/project-morph#run', error);
    }
    try {
      LampGPURenderer?.warmup?.();
    } catch (error) {
      noteSuppressedError('project/project-morph#run', error);
    }
    try {
      WebGPUParticleRenderer?.warmup?.();
    } catch (error) {
      noteSuppressedError('project/project-morph#run', error);
    }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run, { timeout: 900 });
  else setTimeout(run, 40);
}
function projectWantsOrangeMorph(projectData) {
  return projectData?.settings?.minimalMorph?.defaultActive === true;
}
function projectWantsBlueMorph(projectData) {
  return projectData?.settings?.morph?.defaultActive === true;
}
function projectWantsTunnel(projectData) {
  return projectData?.settings?.tunnel?.defaultActive === true;
}
function projectDefaultModeIntent(projectData = null) {
  const hasProjectSettings = projectData?.settings && typeof projectData.settings === 'object';
  return {
    orange: hasProjectSettings
      ? projectWantsOrangeMorph(projectData)
      : state.minimalMorph?.defaultActive === true,
    blue: hasProjectSettings ? projectWantsBlueMorph(projectData) : state.morph?.defaultActive === true,
    tunnel: hasProjectSettings ? projectWantsTunnel(projectData) : state.tunnel?.defaultActive === true,
  };
}
function applyProjectDefaultModeIntent(intent, reason = 'project-activate') {
  const wantsOrange = intent?.orange === true,
    wantsBlue = intent?.blue === true,
    wantsTunnel = intent?.tunnel === true;

  setTunnelMode(wantsTunnel);

  if (wantsOrange) {
    if (wantsBlue) {
      if (!runtimeState.morph.active) activeStartMorphing();
      activeResumeFullMorphFromProjectOrange();
      runtimeState.morph.autoStartedByProject = true;
    } else {
      if (runtimeState.morph.active) activeStopMorphing(false);
      runtimeState.morph.pausedByOrangeProject = false;
      runtimeState.morph.autoStartedByProject = false;
    }
    if (!runtimeState.minimalMorph.active) activeStartMinimalMorphing(true);
    runtimeState.minimalMorph.autoStartedByProject = true;
  } else {
    if (runtimeState.minimalMorph.active) activeStopMinimalMorphing(false);
    runtimeState.minimalMorph.autoStartedByProject = false;
    activeResumeFullMorphFromProjectOrange();
    if (wantsBlue) {
      if (!runtimeState.morph.active) activeStartMorphing();
      runtimeState.morph.autoStartedByProject = true;
    } else {
      if (runtimeState.morph.active) activeStopMorphing(false);
      runtimeState.morph.autoStartedByProject = false;
    }
  }
  syncRandomSettingsUI();
  syncMorphSettingsUI();
  syncTunnelSettingsUI();
  return {
    reason,
    wantsOrange,
    wantsBlue,
    wantsTunnel,
    blueActive: runtimeState.morph?.active === true,
    tunnelActive: state.tunnel?.active === true,
  };
}
let projectDefaultActivationSerial = 0;
function activateProjectDefaultModes(projectData = null, reason = 'project-activate') {
  const intent = projectDefaultModeIntent(projectData);
  const serial = ++projectDefaultActivationSerial >>> 0;
  const first = applyProjectDefaultModeIntent(intent, reason);
  requestMainCanvasRender();

  animationScheduler.afterNextPaint('project-default-modes-verify', () => {
    if (serial !== projectDefaultActivationSerial) return;
    if (intent.tunnel === true && !animationScheduler.has('tunnel')) setTunnelMode(true);
    if (intent.tunnel !== true && animationScheduler.has('tunnel')) setTunnelMode(false);
    if (intent.blue === true) {
      if (!runtimeState.morph.active) activeStartMorphing();
      else activeEnsureFullMorphSchedulerOwnership('project-default-modes-verify');
    }
    if (intent.blue !== true && runtimeState.morph.active && runtimeState.morph.autoStartedByProject === true)
      activeStopMorphing(false);
  });
  return first;
}
function ensureGreenProjectDefaultModes(projectData) {
  return applyProjectDefaultModeIntent(projectDefaultModeIntent(projectData), 'green-project');
}
function syncOrangeAndBlueForProject(projectData) {
  return activateProjectDefaultModes(projectData, 'playlist-project');
}
function finalizeProjectMorphTarget() {
  const pm = normalizeProjectMorphSettings(),
    pmRt = runtimeState.projectMorph;
  const entry = state.playlistProjects?.[pmRt.targetIndex];
  if (!entry) return false;
  const lockedCamera =
    pm.cameraWander === true ? null : { zoom: state.zoom, panX: state.panX, panY: state.panY };
  state.playlistOverridesActive = true;
  state.suppressPlaylistOverrideCapture = true;

  try {
    applyLoadedProject(cloneProjectDataFast(entry.project), {
      preserveFullMorph: false,
      preserveMinimalMorph: false,
      suppressMinimalAutoStart: true,
      applyProjectDefaultModes: false,
    });
  } finally {
    state.suppressPlaylistOverrideCapture = false;
  }
  applyPlaylistOverrides();
  if (lockedCamera) {
    state.zoom = lockedCamera.zoom;
    state.panX = lockedCamera.panX;
    state.panY = lockedCamera.panY;
  }
  state.playlistCurrentProjectId = entry.id;
  state.draftProjectName = entry.name || defaultPlaylistProjectName(pmRt.targetIndex);
  state.projectFileHandle = null;
  state.projectFileName = '';
  syncAfterProjectLoad();

  ensureGreenProjectDefaultModes(entry.project);
  clearProjectMorphBackgroundTransition();
  return true;
}
function quiesceProjectLocalMorphForGreen(now = performance.now()) {
  try {
    if (runtimeState.minimalMorph?.active) activeStopMinimalMorphing(false);
  } catch (error) {
    noteSuppressedError('project/project-morph#quiesceProjectLocalMorphForGreen', error);
  }
  try {
    if (runtimeState.morph?.active) {
      const result = SpiroMorphController.pauseBlueForGreen(now);
      const morphBtn = document.getElementById('btnMorph');
      if (result.changed || result.manualPause) {
        morphBtn?.classList.add('paused');
        if (morphBtn)
          morphBtn.title = result.manualPause
            ? 'Морфинг — пауза (зелёный переход использует текущий кадр)'
            : 'Морфинг — зелёный переход использует текущий кадр';
      }
    }
  } catch (error) {
    noteSuppressedError('project/project-morph#quiesceProjectLocalMorphForGreen', error);
  }
}
function snapshotCurrentVisibleProjectForGreen() {
  const snapshot = buildProjectData();
  try {
    const displayLayers = SpiroMorphController?.getDisplayLayers?.();
    if (Array.isArray(displayLayers) && displayLayers.length) {
      snapshot.layers = displayLayers.map((layer) => cloneData(layer));
    }
  } catch (error) {
    noteSuppressedError('project/project-morph#snapshotCurrentVisibleProjectForGreen', error);
  }
  return snapshot;
}
function prewarmActiveGreenTransition(pmRt) {
  const canGateGreen =
    (typeof somataGpuBackendAllowed !== 'function' || somataGpuBackendAllowed()) &&
    typeof WebGPUGreenProjectMorphRenderer !== 'undefined' &&
    typeof WebGPUGreenProjectMorphRenderer.prewarmPlans === 'function';
  if (!canGateGreen) {
    pmRt.gpuPhasePreparing = false;
    pmRt.gpuPhasePreparePromise = null;
    return;
  }
  const prepSerial = (Math.max(0, Number(pmRt.gpuPhasePrepareSerial) || 0) + 1) >>> 0;
  const prepStartedAt = performance.now();
  pmRt.gpuPhasePrepareSerial = prepSerial;
  pmRt.gpuPhasePreparing = true;
  const particleNeeded = [...(pmRt.sourceProject?.layers || []), ...(pmRt.targetProject?.layers || [])].some(
    (layer) => layer?.particles?.enabled === true,
  );
  const task = Promise.all([
    WebGPUGreenProjectMorphRenderer.prewarmPlans(pmRt.geometryPlans || []),
    particleNeeded &&
    typeof WebGPUParticleRenderer !== 'undefined' &&
    typeof WebGPUParticleRenderer.prewarmGreenPlans === 'function'
      ? WebGPUParticleRenderer.prewarmGreenPlans(pmRt.geometryPlans || [])
      : Promise.resolve(true),
  ]);
  pmRt.gpuPhasePreparePromise = task;
  task
    .catch(() => null)
    .finally(() => {
      if (!pmRt.active || pmRt.gpuPhasePrepareSerial !== prepSerial) return;

      const prepPause = Math.max(0, performance.now() - prepStartedAt);
      pmRt.startAt += prepPause;
      pmRt.gpuPhasePreparing = false;
      pmRt.gpuPhasePreparePromise = null;
      requestMainCanvasRender();
    });
}
function activateProjectMorphTransition(now = performance.now()) {
  const pmRt = runtimeState.projectMorph;
  if (!pmRt?.active) return false;
  if (pmRt.transitionActive === true) return true;

  pmRt.sourceProject = snapshotCurrentVisibleProjectForGreen();
  prepareProjectMorphGeometry(pmRt, pmRt.targetProject);
  pmRt.transitionActive = true;
  pmRt.sourceCaptured = true;
  pmRt.frameMorphSettings = null;
  pmRt.frameTunnelSettings = null;
  pmRt.frameLampConfig = null;
  quiesceProjectLocalMorphForGreen(now);
  applyProjectMorphFrame(pmRt.sourceProject, pmRt.targetProject, 0, 0);
  prewarmActiveGreenTransition(pmRt);
  return true;
}
function beginNextProjectMorphTransition(now = performance.now(), sourceProject = null, sourceIndex = null) {
  const pm = normalizeProjectMorphSettings(),
    pmRt = runtimeState.projectMorph;
  const entries = state.playlistProjects || [];
  if (entries.length < 2) return false;
  let fromIndex = Number.isInteger(sourceIndex) ? sourceIndex : getCurrentPlaylistProjectIndex();
  const liveDraft = fromIndex < 0 && sourceProject;
  const targetIndex = liveDraft ? 0 : (Math.max(0, fromIndex) + 1) % entries.length;
  if (fromIndex < 0 && !liveDraft) fromIndex = 0;
  pmRt.sourceIndex = fromIndex;
  pmRt.targetIndex = targetIndex;
  const cycleSource = cloneProjectDataFast(
    sourceProject || entries[Math.max(0, fromIndex)]?.project || buildProjectData(),
  );
  pmRt.restoreProject = cloneData(cycleSource);
  pmRt.sourceProject = cycleSource;
  pmRt.targetProject = cloneProjectDataFast(entries[targetIndex].project);
  pmRt.lockedCamera = { zoom: state.zoom, panX: state.panX, panY: state.panY };
  // A zero-duration cut has no interpolated geometry to prewarm.
  if (getProjectMorphTransitionSec() > 0) scheduleProjectMorphTargetGeometryWarmup(pmRt, pmRt.targetProject);
  pmRt.endpointPending = false;
  pmRt.progress = 0;
  pmRt.renderProgress = 0;
  pmRt.parameterProgress = 0;
  pmRt.transitionProgress = 0;
  pmRt.fadeProgress = 0;
  pmRt.crossfadeConfigSide = null;
  pmRt.transitionActive = false;
  pmRt.sourceCaptured = false;
  pmRt.renderMode =
    pm.transitionType === 'fade' || (pm.transitionType === 'linear' && pm.advancedLinear !== true)
      ? 'crossfade'
      : 'morph';

  pmRt.geometryPlans = [];
  pmRt.frameGeometry = [];
  pmRt.frameExtents = [];
  pmRt.frameGeometryLayerProgress = [];
  pmRt.sourceGeometry = [];
  pmRt.targetGeometry = [];
  pmRt.sourceRenderLayers = [];
  pmRt.targetRenderLayers = [];
  pmRt.lampPlans = [];
  pmRt.frameLampPoints = [];
  pmRt.frameRenderLayers = [];
  pmRt.startAt = now;
  pmRt.durationMs = Math.max(10, getProjectMorphDurationSec() * 1000);
  pmRt.frameMorphSettings = null;
  pmRt.frameTunnelSettings = null;
  pmRt.frameLampConfig = null;
  pmRt.gpuPhasePreparing = false;
  pmRt.gpuPhasePreparePromise = null;

  const transitionStartsImmediately =
    pm.transitionType === 'linear' || getProjectMorphTransitionSec() >= getProjectMorphDurationSec() - 0.001;
  if (getProjectMorphTransitionSec() > 0 && transitionStartsImmediately) activateProjectMorphTransition(now);
  syncProjectMorphUI();
  return true;
}
function projectMorphAnimationTick(now) {
  const pm = normalizeProjectMorphSettings(),
    pmRt = runtimeState.projectMorph;
  if (!pmRt.active) return false;
  if ((state.playlistProjects?.length || 0) < 2) {
    stopProjectMorphing(false);
    return false;
  }
  if (pmRt.endpointPending) return true;
  if (!pmRt.sourceProject || !pmRt.targetProject) {
    if (!beginNextProjectMorphTransition(now, buildProjectData(), getCurrentPlaylistProjectIndex()))
      return false;
  }

  // With a zero-duration transition, run the playlist clock only.
  // No Green geometry preparation, intermediate frame or GPU morph pass.
  // The intentional project cut is distinct from continuity inside Morph.
  if (getProjectMorphTransitionSec() <= 0) {
    const elapsed = Math.max(0, now - pmRt.startAt),
      cycleMs = Math.max(10, pmRt.durationMs);
    pmRt.progress = Math.max(0, Math.min(1, elapsed / cycleMs));
    pmRt.transitionProgress = 0;
    if (elapsed < cycleMs) return true;
    pmRt.endpointPending = true;
    const completedIndex = pmRt.targetIndex;
    requestMainCanvasRender();
    animationScheduler.afterNextPaint('project-morph-commit', (frameNow) => {
      const currentRt = runtimeState.projectMorph;
      if (!currentRt.active || !currentRt.endpointPending) return;
      currentRt.endpointPending = false;
      if (!finalizeProjectMorphTarget()) {
        stopProjectMorphing(false);
        return;
      }
      beginNextProjectMorphTransition(
        frameNow,
        cloneProjectDataFast(state.playlistProjects[completedIndex].project),
        completedIndex,
      );
    });
    return true;
  }
  if (noteMorphGpuPrepareWait(pmRt, 'Project Morph', now)) return true;
  const elapsed = Math.max(0, now - pmRt.startAt),
    cycleMs = Math.max(10, pmRt.durationMs);
  const raw = Math.max(0, Math.min(1, elapsed / cycleMs));
  const transitionMs = Math.max(0, Math.min(cycleMs, getProjectMorphTransitionSec() * 1000));
  const transitionStart = Math.max(0, cycleMs - transitionMs);
  const tail =
    transitionMs <= 0.5
      ? elapsed >= cycleMs
        ? 1
        : 0
      : Math.max(0, Math.min(1, (elapsed - transitionStart) / transitionMs));
  pmRt.progress = raw;
  pmRt.transitionProgress = tail;

  if ((pm.transitionType === 'fade' || pm.transitionType === 'smooth') && tail <= 0 && raw < 1) return true;
  if (pmRt.transitionActive !== true) {
    if (!activateProjectMorphTransition(now)) return false;
    if (noteMorphGpuPrepareWait(pmRt, 'Project Morph', now)) return true;
  }
  if (pm.transitionType === 'fade') {
    pmRt.renderMode = 'crossfade';
    pmRt.fadeProgress = tail;
    applyProjectMorphFrame(pmRt.sourceProject, pmRt.targetProject, tail, tail);
  } else if (pm.transitionType === 'linear' && pm.advancedLinear !== true) {
    pmRt.renderMode = 'crossfade';
    pmRt.fadeProgress = raw;
    applyProjectMorphFrame(pmRt.sourceProject, pmRt.targetProject, raw, raw);
  } else if (pm.transitionType === 'linear') {
    pmRt.renderMode = 'morph';
    pmRt.fadeProgress = 0;
    applyProjectMorphFrame(pmRt.sourceProject, pmRt.targetProject, raw, raw);
  } else {
    pmRt.renderMode = 'morph';
    pmRt.fadeProgress = 0;
    const geometryT = projectMorphEaseForSpeedType(tail, projectMorphTargetSpeedType(pmRt.targetProject));
    applyProjectMorphFrame(pmRt.sourceProject, pmRt.targetProject, geometryT, tail);
  }
  if (raw >= 1) {
    pmRt.endpointPending = true;
    const completedIndex = pmRt.targetIndex;
    requestMainCanvasRender();
    animationScheduler.afterNextPaint('project-morph-commit', (frameNow) => {
      const currentRt = runtimeState.projectMorph;
      if (!currentRt.active || !currentRt.endpointPending) return;
      currentRt.endpointPending = false;
      if (!finalizeProjectMorphTarget()) {
        stopProjectMorphing(false);
        return;
      }
      beginNextProjectMorphTransition(
        frameNow,
        cloneProjectDataFast(state.playlistProjects[completedIndex].project),
        completedIndex,
      );
    });
  }
  return true;
}
function startProjectMorphing() {
  normalizeProjectMorphSettings();
  const pmRt = runtimeState.projectMorph;
  if (getProjectMorphTransitionSec() > 0)
    try {
      WebGPUGreenProjectMorphRenderer?.warmup?.();
    } catch (error) {
      noteSuppressedError('project/project-morph#startProjectMorphing', error);
    }
  if ((state.playlistProjects?.length || 0) < 2) {
    alert('Для проектного морфина нужно минимум два проекта в текущем плейлисте.');
    syncProjectMorphUI();
    return false;
  }
  const currentIndex = getCurrentPlaylistProjectIndex();
  const currentProject =
    currentIndex >= 0 ? state.playlistProjects?.[currentIndex]?.project : buildProjectData();
  ensureGreenProjectDefaultModes(currentProject);
  pmRt.active = true;
  pmRt.sourceProject = null;
  pmRt.targetProject = null;
  pmRt.restoreProject = null;
  pmRt.transitionActive = false;
  pmRt.sourceCaptured = false;
  pmRt.geometryPlans = [];
  pmRt.frameGeometry = [];
  pmRt.frameExtents = [];
  pmRt.lampPlans = [];
  pmRt.frameLampPoints = [];
  pmRt.sourceGeometry = [];
  pmRt.targetGeometry = [];
  pmRt.sourceRenderLayers = [];
  pmRt.targetRenderLayers = [];
  pmRt.frameRenderLayers = [];
  pmRt.fadeProgress = 0;
  pmRt.endpointPending = false;
  beginNextProjectMorphTransition(performance.now(), buildProjectData(), currentIndex);
  animationScheduler.add('project-morph', projectMorphAnimationTick);
  syncProjectMorphUI();
  requestMainCanvasRender();
  return true;
}
function stopProjectMorphing(showToast = false, restoreSource = false) {
  normalizeProjectMorphSettings();
  const pmRt = runtimeState.projectMorph;
  if (!pmRt.active && !animationScheduler.has('project-morph')) return;
  const restoreCandidate = pmRt.restoreProject || pmRt.sourceProject;
  const source = restoreSource && restoreCandidate ? cloneProjectDataFast(restoreCandidate) : null;
  const sourceIndex = pmRt.sourceIndex;
  const lockedCamera = pmRt.lockedCamera ? { ...pmRt.lockedCamera } : null;
  pmRt.active = false;
  pmRt.gpuPhasePrepareSerial = (Math.max(0, Number(pmRt.gpuPhasePrepareSerial) || 0) + 1) >>> 0;
  pmRt.gpuPhasePreparing = false;
  pmRt.gpuPhasePreparePromise = null;
  animationScheduler.remove('project-morph');
  animationScheduler.remove('project-morph-commit');
  clearProjectMorphBackgroundTransition();
  if (source) {
    state.playlistOverridesActive = true;
    state.suppressPlaylistOverrideCapture = true;
    try {
      applyLoadedProject(source, {
        preserveFullMorph: false,
        preserveMinimalMorph: false,
        suppressMinimalAutoStart: true,
        applyProjectDefaultModes: false,
      });
    } finally {
      state.suppressPlaylistOverrideCapture = false;
    }
    applyPlaylistOverrides();
    if (lockedCamera && state.projectMorph?.cameraWander !== true) {
      state.zoom = lockedCamera.zoom;
      state.panX = lockedCamera.panX;
      state.panY = lockedCamera.panY;
    }
    if (Number.isInteger(sourceIndex) && sourceIndex >= 0 && state.playlistProjects?.[sourceIndex]) {
      const entry = state.playlistProjects[sourceIndex];
      state.playlistCurrentProjectId = entry.id;
      state.draftProjectName = entry.name || defaultPlaylistProjectName(sourceIndex);
    }
    state.projectFileHandle = null;
    state.projectFileName = '';
    syncAfterProjectLoad();
    ensureGreenProjectDefaultModes(source);
  }
  pmRt.sourceProject = null;
  pmRt.targetProject = null;
  pmRt.restoreProject = null;
  pmRt.sourceIndex = -1;
  pmRt.targetIndex = -1;
  pmRt.transitionActive = false;
  pmRt.sourceCaptured = false;
  pmRt.geometryPlans = [];
  pmRt.frameGeometry = [];
  pmRt.frameExtents = [];
  pmRt.lampPlans = [];
  pmRt.frameLampPoints = [];
  pmRt.sourceGeometry = [];
  pmRt.targetGeometry = [];
  pmRt.sourceRenderLayers = [];
  pmRt.targetRenderLayers = [];
  pmRt.frameRenderLayers = [];
  pmRt.fadeProgress = 0;
  pmRt.progress = 0;
  pmRt.renderProgress = 0;
  pmRt.parameterProgress = 0;
  pmRt.transitionProgress = 0;
  pmRt.frameMorphSettings = null;
  pmRt.frameTunnelSettings = null;
  pmRt.frameLampConfig = null;
  pmRt.crossfadeConfigSide = null;
  pmRt.endpointPending = false;
  syncProjectMorphUI();
  requestMainCanvasRender();
  if (showToast) showShortcutToast('Проектный морфин остановлен');
}

export {
  activateProjectDefaultModes,
  activateProjectMorphTransition,
  ensureProjectMorphFrameGeometryLayer,
  getProjectMorphDurationSec,
  getProjectMorphTransitionSec,
  normalizeProjectMorphSettings,
  schedulePlaylistGpuWarmup,
  startProjectMorphing,
  stopProjectMorphing,
  syncOrangeAndBlueForProject,
  syncProjectMorphUI,
};
