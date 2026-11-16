// Анимация эффектов: удары молнии, свечение проблеска, частицы.
import './sweep-frame.js'; // initialisation order: this module runs after it
import { audioApplyNumeric } from '../audio/audio-routing.js';
import {
  currentSweepConfig,
  ensureLayerEffectState,
  everyLayerMatches,
  getActiveEffectLayer,
  getLayerSweepConfig,
  normalizeParticleConfig,
} from '../core/defaults-layers.js';
import { getActivePlaylistPaletteKeys, getPlaylistPaletteDisplayName } from '../core/palette.js';
import { animationScheduler, requestMainCanvasRender } from '../core/scheduler.js';
import { runtimeState, state } from '../core/state.js';
import { getLayerStrokeWidthMultiplier } from './motion.js';
import { GPUColorCache } from '../gpu/gpu-utils.js';
import { WebGPUParticleRenderer } from '../gpu/particle-renderer.js';
import { SweepGPURenderer } from '../gpu/sweep-renderer.js';
import {
  getGlintVisualSettings,
  getLightningMotionPhase,
  getPreparedLightningFrame,
  getSweepMotionPhase,
  lightningActiveCycleFraction,
  prepareLightningVectorFrame,
} from './lightning.js';
import { getPreparedSweepFrame } from './sweep-frame.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const lightningBrightCoreColorCache = new Map();
const lightningOnePassTintCache = new Map();
function lightningOnePassColor(primary, secondary) {
  // A fixed tint combines both authored lightning colors, so the second
  // color still matters without allocating a new tinted contour for
  // each micro-flash. Only the opacity envelope varies with time.
  const key = String(primary || '#ffffff') + '|' + String(secondary || '#7dd3fc');
  let tint = lightningOnePassTintCache.get(key);
  if (tint) return tint;
  const a = GPUColorCache.rgb(primary || '#ffffff'),
    b = GPUColorCache.rgb(secondary || '#7dd3fc');
  const channel = (i) =>
    Math.round(255 * Math.max(0, Math.min(1, (a[i] * 0.76 + b[i] * 0.24) * 0.66 + 0.34)));
  tint = `rgb(${channel(0)},${channel(1)},${channel(2)})`;
  if (lightningOnePassTintCache.size > 64) lightningOnePassTintCache.clear();
  lightningOnePassTintCache.set(key, tint);
  return tint;
}
function lightningVisualGlowRadius(glow) {
  return Math.max(0, Number(glow) || 0);
}
function queueLightningStrikeWebGL(
  ctx,
  pieces,
  layer,
  alpha,
  frame,
  intensity,
  microIndex = -1,
  suppressBase = false,
) {
  const a = Math.max(0, Math.min(1, (Number(alpha) || 0) * Math.max(0, Number(intensity) || 0)));
  if (a <= 0.001) return true;
  if (!suppressBase && frame.showBase)
    SweepGPURenderer.queueStroke(
      ctx,
      pieces,
      Math.max(0.15, frame.baseW),
      layer?.strokeColor || '#ffffff',
      a * frame.lineOpacity,
      0,
      0,
      0,
    );
  const bright = Math.max(0, frame.brightness || 0);
  const coreA = a * Math.max(0, Math.min(1, frame.glowIntensity));
  const haloA = a * 0.82 * frame.glowIntensity * bright * (frame.smoothLighting ? 0.34 : 0.27);
  // No alternate-colored micro-strokes. A single retained segment has
  // core AND halo; micro-strikes change alpha, never geometry or tint.
  return SweepGPURenderer.queueStroke(
    ctx,
    pieces,
    Math.max(0.2, frame.boltW),
    lightningOnePassColor(frame.primary, frame.secondary),
    coreA,
    lightningVisualGlowRadius(frame.glow),
    haloA,
    frame.softness,
  );
}
function queueMovingSweepGlowWebGL(ctx, paths, layer, alpha = 1, now = performance.now(), frameData = null) {
  if (!SweepGPURenderer.isAvailable()) return false;
  const cfg = frameData?.cfg || currentSweepConfig(layer),
    layerIndex = Number.isInteger(frameData?.layerIndex) ? frameData.layerIndex : -1;
  if (!cfg?.enabled || alpha <= 0.001) return true;
  if (cfg.effectType === 'lightning') {
    const prepared = frameData?.prepared || getPreparedLightningFrame(paths, layer, now, cfg, layerIndex);
    if (!prepared?.visible?.length || !prepared?.pieces?.length) return true;
    const lightningPhase = frameData
        ? frameData.lightningPhase
        : getLightningMotionPhase(now, cfg, layerIndex),
      frame =
        frameData?.lightningVector ||
        prepareLightningVectorFrame(layer, lightningPhase, prepared, layerIndex, cfg);
    if (!frame || frame.stage === 'idle') return true;
    queueLightningStrikeWebGL(
      ctx,
      prepared.pieces,
      layer,
      alpha,
      frame,
      frame.intensity,
      Number.isInteger(frame.microIndex) ? frame.microIndex : -1,
      false,
    );
    return true;
  }
  const phase = frameData ? frameData.phase : getSweepMotionPhase(now, cfg),
    prepared = frameData?.prepared || getPreparedSweepFrame(paths, layer, phase, now, cfg, layerIndex),
    pieces = prepared?.pieces;
  if (!pieces?.length) return true;
  let sweepW = Number(frameData?.sweepW) || 0;
  if (!(sweepW > 0.001)) {
    const baseW = Math.max(
        0.5,
        audioApplyNumeric('layer.strokeWidth', Number(layer?.strokeWidth) || 1.5, layerIndex) *
          getLayerStrokeWidthMultiplier(layer),
      ),
      raw = audioApplyNumeric('sweep.width', Number(cfg.widthPercent), layerIndex),
      widthPct = Number.isFinite(raw) ? Math.max(0, Math.min(200, raw)) : 105;
    sweepW = (baseW * widthPct) / 100;
  }
  if (!(sweepW > 0.001)) return true;
  const vis = frameData?.glintVisual || getGlintVisualSettings(cfg, layerIndex),
    a = Math.max(0, Math.min(1, Number(alpha) || 0)),
    coreA = a * Math.max(0, Math.min(1, Number.isFinite(Number(vis.opacity)) ? Number(vis.opacity) : 1));
  const glowAlpha =
    vis.glowSize > 0.001 && vis.strength > 0.001 ? a * 0.22 * vis.strength * vis.brightness : 0;
  if (glowAlpha > 0.0001)
    SweepGPURenderer.queueStroke(
      ctx,
      pieces,
      Math.max(0.15, sweepW),
      cfg.haloColor || cfg.color || '#ffffff',
      0,
      vis.glowSize,
      glowAlpha,
      vis.softness,
    );
  SweepGPURenderer.queueStroke(ctx, pieces, Math.max(0.15, sweepW), cfg.color || '#ffffff', coreA, 0, 0, 0);
  return true;
}
const lightningScheduledVisibility = new WeakMap();
function sweepAnimationTick(now = performance.now()) {
  let enabled = false,
    needsPaint = false;
  for (let i = 0; i < state.layers.length; i++) {
    const layer = state.layers[i],
      cfg = getLayerSweepConfig(layer);
    if (cfg.enabled !== true || layer.visible === false) continue;
    enabled = true;
    if (cfg.glintEnabled === true) {
      getSweepMotionPhase(now, cfg);
      needsPaint = true;
    }
    if (cfg.lightningEnabled !== true) continue;
    // The strike and afterglow require GPU repaint. Long idle portions do not.
    // Keep the music clock ticking even without rendering, and repaint once when
    // an active strike ends to clear its last visible image.
    const phase = getLightningMotionPhase(now, cfg, i);
    const active = phase < lightningActiveCycleFraction(cfg, i);
    const wasActive = lightningScheduledVisibility.get(cfg) === true;
    if (active || wasActive) needsPaint = true;
    lightningScheduledVisibility.set(cfg, active);
  }
  if (!enabled) return false;
  if (needsPaint) requestMainCanvasRender();
  return true;
}
function gpuPathFxAnimationTick() {
  const motionActive = (state.layers || []).some(
    (l) => l?.visible !== false && l?.lineMotionFx?.enabled === true,
  );
  const spriteActive = (state.layers || []).some((l) => l?.visible !== false && l?.sprite?.enabled === true);
  if (!motionActive && !spriteActive) return false;
  // A running Blue Morph already owns the frame clock. Textured
  // sprites (including Bones) consume that current frame: a second
  // independent repaint request must never compete with Morph/GPU.
  if (
    runtimeState?.morph?.active === true &&
    runtimeState.morph.paused !== true &&
    runtimeState.morph.pausedByOrangeProject !== true &&
    runtimeState.morph.pausedByGreenProject !== true
  )
    return true;
  requestMainCanvasRender();
  return true;
}
function ensureGpuPathFxAnimation() {
  const active = (state.layers || []).some(
    (l) => l?.visible !== false && (l?.lineMotionFx?.enabled === true || l?.sprite?.enabled === true),
  );
  if (active) animationScheduler.add('gpu-path-fx', gpuPathFxAnimationTick);
  else animationScheduler.remove('gpu-path-fx');
}
function ensureSweepAnimation() {
  const anyEnabled = state.layers.some((l) => getLayerSweepConfig(l).enabled === true);
  if (anyEnabled) animationScheduler.add('sweep', sweepAnimationTick);
  else animationScheduler.remove('sweep');
}
function getLayerParticleConfig(layer) {
  const owner = ensureLayerEffectState(layer);
  if (!owner) return normalizeParticleConfig(null);
  owner.particles = normalizeParticleConfig(owner.particles);
  return owner.particles;
}
function particleAnimationTick() {
  const any = (state.layers || []).some(
    (l) => l?.visible !== false && getLayerParticleConfig(l).enabled === true,
  );
  if (!any) return false;
  requestMainCanvasRender();
  return true;
}
function ensureParticleAnimation() {
  const any = (state.layers || []).some(
    (l) => l?.visible !== false && getLayerParticleConfig(l).enabled === true,
  );
  if (any) {
    animationScheduler.add('particles', particleAnimationTick);
    try {
      WebGPUParticleRenderer?.warmup?.();
    } catch (error) {
      noteSuppressedError('effects/effect-animation#ensureParticleAnimation', error);
    }
  } else animationScheduler.remove('particles');
}
function syncParticlePaletteOptions() {
  const sel = document.getElementById('particlePalette');
  if (!sel) return;
  let keys = [];
  try {
    keys = getActivePlaylistPaletteKeys();
  } catch (_) {
    keys = [];
  }
  if (!keys.length) keys = ['standard'];
  const signature = keys.join('|');
  if (sel.dataset.paletteSignature !== signature) {
    const current = sel.value;
    sel.innerHTML = '';
    for (const key of keys) {
      const o = document.createElement('option');
      o.value = key;
      try {
        o.textContent = getPlaylistPaletteDisplayName(key);
      } catch (_) {
        o.textContent = key;
      }
      sel.appendChild(o);
    }
    sel.dataset.paletteSignature = signature;
    if (keys.includes(current)) sel.value = current;
  }
}
function syncParticleUI() {
  const active = getActiveEffectLayer();
  if (!active) return;
  const c = getLayerParticleConfig(active);
  syncParticlePaletteOptions();
  const master = state.masterLayerEdit === true;
  const show = document.getElementById('showParticles');
  if (show)
    show.checked = master
      ? everyLayerMatches((l) => getLayerParticleConfig(l).enabled === true)
      : c.enabled === true;
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = String(v);
  };
  set('particleStyle', c.style);
  set('particleMode', c.mode);
  set('particleColorMode', c.colorMode);
  set('particlePalette', c.paletteKey);
  set('particleDensity', c.density);
  set('particleDensityMultiplier', c.densityMultiplier);
  set('particleSize', c.sizePx);
  set('particleScatter', c.scatter);
  set('particleScatterMultiplier', c.scatterMultiplier);
  set('particleSizeVariation', c.sizeVariation);
  set('particleSizeVariationMultiplier', c.sizeVariationMultiplier);
  set('particleSpeed', c.speedPercent);
  set('particleSpeedMultiplier', c.speedMultiplier);
  set('particleOpacity', c.opacity);
  set('particleTwinkle', c.twinkle);
  set('particleSpiralRadius', c.spiralRadiusPx);
  set('particleSpiralRadiusMultiplier', c.spiralRadiusMultiplier);
  set('particleSpiralTurns', c.spiralTurns);
  const txt = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  txt(
    'particleDensityText',
    `${Math.round(c.density)} × ${
      Number(c.densityMultiplier)
        .toFixed(2)
        .replace(/\.?0+$/, '') || '1'
    }`,
  );
  txt('particleSizeText', `${Number(c.sizePx).toFixed(1).replace('.0', '')} px`);
  txt(
    'particleScatterText',
    `${Math.round(c.scatter)}% × ${
      Number(c.scatterMultiplier)
        .toFixed(2)
        .replace(/\.?0+$/, '') || '1'
    }`,
  );
  txt(
    'particleSizeVariationText',
    `${Math.round(c.sizeVariation)}% × ${
      Number(c.sizeVariationMultiplier)
        .toFixed(2)
        .replace(/\.?0+$/, '') || '1'
    }`,
  );
  txt(
    'particleSpeedText',
    `${Math.round(c.speedPercent)}% × ${
      Number(c.speedMultiplier)
        .toFixed(2)
        .replace(/\.?0+$/, '') || '1'
    }`,
  );
  txt('particleOpacityText', `${Math.round(c.opacity)}%`);
  txt('particleTwinkleText', `${Math.round(c.twinkle)}%`);
  txt(
    'particleSpiralRadiusText',
    `${Number(c.spiralRadiusPx).toFixed(1).replace('.0', '')} px × ${
      Number(c.spiralRadiusMultiplier)
        .toFixed(2)
        .replace(/\.?0+$/, '') || '1'
    }`,
  );
  txt(
    'particleSpiralTurnsText',
    `${Number(c.spiralTurns)
      .toFixed(2)
      .replace(/\.?0+$/, '')} об.`,
  );
  document.getElementById('particlePaletteRow')?.classList.toggle('hidden', c.colorMode !== 'palette');
  document.getElementById('particleSpiralRadiusRow')?.classList.toggle('hidden', c.mode !== 'spiralZ');
  document.getElementById('particleSpiralTurnsRow')?.classList.toggle('hidden', c.mode !== 'spiralZ');
  document.getElementById('btnSidebarParticles')?.classList.toggle('feature-enabled', show?.checked === true);
  ensureParticleAnimation();
}

export {
  ensureGpuPathFxAnimation,
  ensureParticleAnimation,
  ensureSweepAnimation,
  getLayerParticleConfig,
  lightningOnePassColor,
  lightningVisualGlowRadius,
  queueMovingSweepGlowWebGL,
  syncParticleUI,
};
