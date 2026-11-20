import './glow-plan.js'; // initialisation order: this module runs after it
import { SomataGeometryPolicy } from './geometry-policy.js';
import { state } from '../core/state.js';
import { SomataParameterRegistry } from '../core/parameter-routing.js';
import { somataGpuBackendAllowed } from '../core/backend-policy.js';
import { animationScheduler, requestMainCanvasRender } from '../core/scheduler.js';
import { getLayerGlowMultiplier } from '../effects/motion.js';
import { getLayerLineVisible } from '../core/defaults-layers.js';
import { audioApplyNumeric, audioShiftHexHue } from '../audio/audio-routing.js';
import { getLayerFrameAuxiliaryPaths } from '../geometry/frame-paths.js';
import { prepareLayerFrameProfileData } from '../effects/graffiti-ribbon.js';
import { prepareGpuMorphGraffitiFrame } from './graffiti-pass.js';
import { SomataFeatureHost } from './feature-host.js';
import { somataGpuDiagnosticError } from './render-diagnostics.js';
import { SPIRO_PATH_CAPS } from './render-graph.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

SomataFeatureHost.register('outline', {
  domain: 'appearance',
  plans: ['outline', 'motion', 'sprite'],
  reads: ['_baseStrokeCommitted', '_webgpuStrokeBatch', '_geometryContract'],
  outputs: [],
});

function resetOutlineEffectPlan(plan) {
  const p = plan && typeof plan === 'object' ? plan : {};
  p.enabled = false;
  p.graffiti = false;
  p.gpuMorphNative = false;
  p.paths = null;
  p.profilePrepared = null;
  p.outlineLayer = null;
  p.coreLayer = null;
  p.baseLineWidth = 0;
  p.extra = 0;
  p.width = 0;
  p.color = '#ffffff';
  p.join = 'round';
  p.footprint = 0;
  p.tunnelActive = false;
  p.mode = 'outer';
  p.outerAdd = 0;
  p.coreInset = 0;
  p.style = 'classic';
  p.auraRadius = 0;
  p.auraPhase = 0;
  p.auraPacked = 96;
  p.auraSpan = 1;
  return p;
}

function somataOutlineSelectionSeed() {
  const cfg = state.lineOutline || (state.lineOutline = { enabled: false });
  if (!Number.isFinite(Number(cfg.selectionSeed)) || cfg.selectionSeed == null) {
    cfg.selectionSeed = Math.floor(Math.random() * 0x100000000) >>> 0;
  }
  return Number(cfg.selectionSeed) >>> 0;
}
function somataOutlineRandomRank(id, seed) {
  const text = String(id || '');
  let hash = (2166136261 ^ (seed >>> 0)) >>> 0;
  for (let i = 0; i < text.length; i++) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d) >>> 0;
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 0x846ca68b) >>> 0;
  return (hash ^ (hash >>> 16)) >>> 0;
}
let somataOutlineSelectionCache = { key: null, ids: null };
function somataOutlineRandomLayerIds() {
  const seed = somataOutlineSelectionSeed();
  const layers = state.layers || [];
  const key = `${seed}|${layers.map((layer, index) => String(layer?.id ?? `layer-index-${index}`)).join('\u001f')}`;
  if (somataOutlineSelectionCache.key === key) return somataOutlineSelectionCache.ids;
  const ids = layers
    .map((layer, index) => ({
      id: String(layer?.id ?? `layer-index-${index}`),
      rank: somataOutlineRandomRank(layer?.id ?? `layer-index-${index}`, seed),
    }))
    .sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id))
    .map((row) => row.id);
  somataOutlineSelectionCache = { key, ids };
  return ids;
}
function somataOutlineEffectiveLayerCount() {
  const total = (state.layers || []).length;
  const authored =
    state.lineOutline?.layerCount != null && Number.isFinite(Number(state.lineOutline.layerCount))
      ? Number(state.lineOutline.layerCount)
      : total;
  const morphed =
    window.SomataMorphParameterRouting?.resolveGlobalValue?.('outline.layerCount', authored) ?? authored;
  // This parameter is global: calculate one N, not one independent N per layer.
  const modulated = audioApplyNumeric('outline.layerCount', morphed, -1);
  return Math.max(
    0,
    Math.min(total, Math.round(Number.isFinite(Number(modulated)) ? Number(modulated) : authored)),
  );
}
window.somataOutlineLayerEnabled = function (layerIndex) {
  if (state.lineOutline?.enabled !== true) return false;
  const idx = Math.floor(Number(layerIndex));
  const layers = state.layers || [];
  if (!Number.isInteger(idx) || idx < 0 || idx >= layers.length) return false;
  const count = somataOutlineEffectiveLayerCount();
  if (count === 0) return false;
  if (count >= layers.length) return true;
  const id = String(layers[idx]?.id ?? `layer-index-${idx}`);
  return somataOutlineRandomLayerIds().slice(0, count).includes(id);
};
window.__somataOutlineRandomSelection = () => ({
  seed: somataOutlineSelectionSeed(),
  count: somataOutlineEffectiveLayerCount(),
  selected: somataOutlineRandomLayerIds().slice(0, somataOutlineEffectiveLayerCount()),
});
// One shared phase clock for all outline styles and layers. Incremental time
// integration avoids discontinuities when the speed or its multiplier changes.
let somataOutlinePhase = 0;
let somataOutlineLastPhaseTime = null;
function somataOutlineContinuousPhase(speed) {
  const now = performance.now();
  if (somataOutlineLastPhaseTime !== null) {
    const elapsed = Math.max(0, Math.min(50, now - somataOutlineLastPhaseTime));
    somataOutlinePhase = (somataOutlinePhase + elapsed * Math.max(0, speed) * 0.0000025) % 1;
  }
  somataOutlineLastPhaseTime = now;
  return somataOutlinePhase;
}
function resolveLayerOutlineEffectProvider(frameCtx, plan) {
  const layer = frameCtx.layer;
  // Outline count, width, color and placement share canonical routing IDs.
  const blue = window.SomataMorphParameterRouting;
  const morphValue = (id, authored) => blue?.resolveGlobalValue?.(id, authored) ?? authored;
  plan.enabled =
    window.somataOutlineLayerEnabled?.(frameCtx.layerIndex) === true &&
    getLayerLineVisible(frameCtx.effectLayer || liveEffectOwnerForFrameLayer(layer)) &&
    frameCtx.geometryPlan?.kind !== 'lightning';
  plan.tunnelActive = state.tunnel.active === true;
  if (!plan.enabled) return plan;
  plan.baseLineWidth = Math.max(0.001, frameCtx.strokeWidth);
  const styles = ['saiyan', 'drip', 'mountain'];
  plan.style = styles.includes(state.lineOutline?.style) ? state.lineOutline.style : 'classic';
  const animated = plan.style !== 'classic';
  const mult = (v, min, max) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : 1;
  };
  const widthMult = mult(state.lineOutline?.widthMultiplier, 0.015625, 64);
  plan.extra = Math.max(
    0.1,
    Math.min(
      animated ? 300 : 96,
      audioApplyNumeric(
        'outline.width',
        morphValue('outline.width', Number(state.lineOutline.width) || 1.5),
        frameCtx.layerIndex,
      ) * widthMult,
    ),
  );
  // One shared carrier, one GPU outline pass. Pack the span exponent into the
  // unused integer part of the phase; no extra uniform or per-frame geometry.
  if (animated) {
    const speed =
      mult(state.lineOutline?.auraSpeed, 0, 200) * mult(state.lineOutline?.auraSpeedMultiplier, 0, 64);
    const span =
      mult(state.lineOutline?.auraSpan ?? 100, 0, 200) *
      0.01 *
      mult(state.lineOutline?.auraSpanMultiplier, 0.015625, 64);
    plan.auraSpan = Math.max(0.015625, Math.min(64, span));
    // The raster envelope follows the user-selected span. Cap it to avoid
    // unbounded fill-rate at extreme multipliers, independently of geometry.
    plan.auraRadius = Math.max(
      2,
      Math.min(320, Math.max(16, plan.extra * 3) * Math.max(0.125, Math.min(4, plan.auraSpan))),
    );
    plan.auraPhase = somataOutlineContinuousPhase(speed);
    plan.auraPacked = Math.round((Math.log2(plan.auraSpan) + 6) * 16) + 0.01 + 0.98 * plan.auraPhase;
  }
  plan.color = audioShiftHexHue(
    'outline.color',
    SomataParameterRegistry.shiftHexHue(state.lineOutline.color || '#ffffff', morphValue('outline.color', 0)),
    frameCtx.layerIndex,
  );
  const outlineModes = ['outer', 'inner', 'median'];
  const baseMode = Math.max(0, outlineModes.indexOf(state.lineOutline?.mode));
  plan.mode =
    outlineModes[
      Math.max(
        0,
        Math.min(
          2,
          Math.round(
            audioApplyNumeric('outline.mode', morphValue('outline.mode', baseMode), frameCtx.layerIndex),
          ),
        ),
      )
    ];
  if (animated) plan.mode = 'outer';
  plan.outerAdd = animated
    ? plan.auraRadius
    : plan.mode === 'outer'
      ? plan.extra
      : plan.mode === 'median'
        ? plan.extra * 0.5
        : 0;
  plan.coreInset = animated
    ? 0
    : plan.mode === 'inner'
      ? plan.extra
      : plan.mode === 'median'
        ? plan.extra * 0.5
        : 0;
  plan.join = (layer.lineJoinType || 'rounded') === 'straight' ? 'miter' : 'round';
  plan.graffiti = frameCtx.lineProfileApplication === 'graffiti';
  if (plan.graffiti) {
    const gpuBackendAllowed = typeof somataGpuBackendAllowed !== 'function' || somataGpuBackendAllowed();
    const nativePrepared =
      gpuBackendAllowed && typeof prepareGpuMorphGraffitiFrame === 'function'
        ? prepareGpuMorphGraffitiFrame(frameCtx)
        : null;
    if (nativePrepared) {
      plan.gpuMorphNative = true;
      plan.paths = null;
      plan.profilePrepared = nativePrepared;
    } else if (SomataGeometryPolicy.isStrict(frameCtx)) {
      plan.enabled = false;
      const reason = SomataGeometryPolicy.ineligibleReason(
        frameCtx,
        'outline',
        'exact geometry Web rail unavailable',
      );
      if (!/warming/i.test(String(reason || '')))
        somataGpuDiagnosticError(
          'web',
          'strict-spiral-authority',
          String(reason || 'exact geometry Web rail unavailable'),
          frameCtx,
          {
            fallback: 'wait-for-exact-spiral-rail',
            recovered: false,
            authority: window.__spiroGpuMorphArcStatus?.()?.lastDecision || null,
          },
        );
      try {
        requestMainCanvasRender?.();
      } catch (error) {
        noteSuppressedError('render/outline-plan#resolveLayerOutlineEffectProvider', error);
      }
      return plan;
    } else {
      plan.paths = getLayerFrameAuxiliaryPaths(frameCtx);
      if (plan.paths?.length) plan.profilePrepared = prepareLayerFrameProfileData(frameCtx);
    }
    if (plan.profilePrepared) {
      plan.width = plan.baseLineWidth + plan.outerAdd * 2;
      const graffitiStyle = liveGraffitiStyleLayerForFrame(frameCtx) || layer;
      plan.outlineLayer = {
        ...graffitiStyle,
        strokeColor: plan.color,
        strokeWidth: plan.width,
        strokeWidthMultiplier: 1,
        glow: 0,
        glowMultiplier: 1,
        glowIntensity: 0,
        glowIntensityMultiplier: 1,
      };
      const coreWidth = Math.max(0.001, plan.baseLineWidth - plan.coreInset * 2);
      plan.coreLayer =
        plan.coreInset > 0
          ? {
              ...graffitiStyle,
              strokeWidth: coreWidth,
              strokeWidthMultiplier: 1,
              glow: 0,
              glowMultiplier: 1,
              glowIntensity: 0,
              glowIntensityMultiplier: 1,
            }
          : null;
      plan.footprint = Math.max(
        plan.width,
        Math.max(0, Number(layer.glow) || 0) * getLayerGlowMultiplier(layer) * 0.55,
      );
    }
  }
  return plan;
}

SomataFeatureHost?.provide?.('outline', 'effectPlan', (frameCtx, previousPlans) =>
  resolveLayerOutlineEffectProvider(frameCtx, resetOutlineEffectPlan(previousPlans?.outline)),
);
SomataFeatureHost?.provide?.('outline', 'graphPass', (frameCtx, plans) => {
  const plan = plans?.outline;
  return { name: 'outline', caps: SPIRO_PATH_CAPS.POSITIONS, active: plan?.enabled === true, backend: 'gpu' };
});
SomataFeatureHost?.provide?.('outline', 'resetEffectPlan', (plans) => resetOutlineEffectPlan(plans?.outline));

SomataFeatureHost?.provide?.('outline', 'strokeBatchSpec', (frameCtx, plans) => {
  const outline = plans?.outline,
    markerProfile = frameCtx?.lineProfileStrokeOnly === true && frameCtx?.lineProfileApplication === 'stroke';
  if (outline?.enabled !== true || outline.graffiti === true || markerProfile) return [];
  const mode = ['outer', 'inner', 'median'].includes(outline.mode) ? outline.mode : 'outer',
    outerAdd = Math.max(0, Number(outline.outerAdd) || 0),
    coreInset = Math.max(0, Number(outline.coreInset) || 0),
    out = [];
  out.push(
    outline.style !== 'classic'
      ? {
          role: 'outline',
          mode: outline.style,
          radiusPx: outline.auraRadius,
          auraPhase: outline.auraPhase,
          auraPacked: outline.auraPacked,
          baseLineWidth: outline.baseLineWidth,
          colorOverride: outline.color,
          alphaScale: 1,
          composite: 'destination-over',
        }
      : {
          role: 'outline',
          mode: 'outline',
          extraLocal: outerAdd,
          baseLineWidth: outline.baseLineWidth,
          colorOverride: outline.color,
          alphaScale: 1,
          composite: mode === 'outer' ? 'destination-over' : 'source-over',
        },
  );
  if (coreInset > 0)
    out.push({
      role: 'core',
      mode: 'coreInset',
      extraLocal: coreInset,
      baseLineWidth: outline.baseLineWidth,
      alphaScale: 1,
      composite: 'source-over',
    });
  return out;
});
SomataFeatureHost?.provide?.('outline', 'strokeBatchScene', (frameCtx, plans) => {
  const outline = plans?.outline,
    markerProfile = frameCtx?.lineProfileStrokeOnly === true && frameCtx?.lineProfileApplication === 'stroke';
  if (outline?.enabled !== true || outline.graffiti === true || markerProfile) return null;
  const mode = ['outer', 'inner', 'median'].includes(outline.mode) ? outline.mode : 'outer',
    single = frameCtx?.layerIndex === 0 && frameCtx?.frame?.renderLayerCount === 1;
  return {
    includeOutline: mode !== 'outer' || single,
    includeCore: Math.max(0, Number(outline.coreInset) || 0) > 0,
    outlineBehind: mode === 'outer',
  };
});

// An animation task exists only while the new aura style is visible and moving.
// It uses the shared scheduler; there is no independent requestAnimationFrame.
function somataOutlineAuraTick() {
  if (
    state.lineOutline?.enabled !== true ||
    state.lineOutline?.style === 'classic' ||
    Number(state.lineOutline?.auraSpeed ?? 100) * Number(state.lineOutline?.auraSpeedMultiplier ?? 1) <= 0
  ) {
    animationScheduler.remove('saiyan-outline');
    return;
  }
  animationScheduler.invalidate();
}
window.somataOutlineSyncAnimation = function () {
  if (typeof animationScheduler === 'undefined') return;
  if (
    state.lineOutline?.enabled === true &&
    state.lineOutline?.style !== 'classic' &&
    Number(state.lineOutline?.auraSpeed ?? 100) * Number(state.lineOutline?.auraSpeedMultiplier ?? 1) > 0
  ) {
    if (!animationScheduler.has('saiyan-outline'))
      animationScheduler.add('saiyan-outline', somataOutlineAuraTick);
  } else animationScheduler.remove('saiyan-outline');
};
