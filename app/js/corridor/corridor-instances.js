// Коридор: список копий, временное затухание, экземпляры линий и ламп, виньетка, кадр анимации.
import { normalizeTunnelDensity, tunnelDensityAlpha } from './corridor-density.js';
import './corridor-transitions.js'; // initialisation order: this module runs after it
import { getTunnelStepRatio, getTunnelVirtualCopyCount } from '../geometry/spiral/order-params.js';
import { renderBackendTelemetry } from '../render/backend-telemetry.js';
import { audioApplyNumeric } from '../audio/audio-routing.js';
import {
  lampRenderScratch,
  renderScratch,
  tunnelCopyScratch,
  tunnelFadeRuntime,
  tunnelVignetteMaskCache,
  tunnelVignetteMaskCanvas,
  tunnelVignetteMaskCtx,
} from '../core/render-runtime.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { state } from '../core/state.js';
import { getMotionViewportTransform } from '../effects/motion.js';
import { SomataCorridorDepthCurve } from '../render/corridor-depth-curve.js';
import {
  getTunnelCenterRevealAlpha,
  getTunnelCenterRevealRange,
  getTunnelDepthCurvePercent,
  getTunnelDistanceFactor,
  getTunnelSpeedPercent,
  getTunnelVignetteAmount,
  routedGlobalMorphValue,
  spiralCorridorOuterFade,
} from './corridor-appearance.js';
import {
  corridorEase,
  corridorEntrance,
  corridorEntranceFrame,
  corridorOrderChangeFrame,
  corridorOrderChanges,
  honestZeroCorridorIntroFrame,
  honestZeroCorridorIntros,
  honestZeroCorridorOutroFrame,
  honestZeroCorridorOutros,
} from './corridor-transitions.js';
import { setTunnelMode } from '../ui/corridor-panel.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

function getTunnelCopies() {
  const tunnel = state.tunnel;
  const result = tunnelCopyScratch;
  if (!tunnel?.active) {
    let item = result[0];
    if (!item) item = result[0] = {};
    item.scale = 1;
    item.alpha = 1;
    item.position = 0;
    item.stepRatio = 1;
    result.length = 1;
    result._corridorOriginPosition = 0;
    result._phaseSpeedMagnitude = 0;
    result._stepRatio = 1;
    result._logStepRatio = 0;
    result._fadeOffset = 0;
    result._fadeDurationSec = 0;
    result._direction = getTunnelSpeedPercent() < 0 ? 'away' : 'toward';
    result._centerHiddenCopies = 0;
    result._centerRevealStartScale = 0;
    result._centerRevealEndScale = 0;
    result._centerRevealSpacingScale = 0;
    return result;
  }

  const distanceFactor = getTunnelDistanceFactor();
  const virtualCount = getTunnelVirtualCopyCount(distanceFactor);

  const count = Math.max(2, Math.min(256, Math.ceil(virtualCount)));
  const density = normalizeTunnelDensity(tunnel.density);
  // v6.7 capped the depth-fade denominator at 160, even at very small spacing.
  const classicCount = Math.min(160, count);
  const minScale = Math.max(0.01, Number(tunnel.minScale) || 0.055);
  const maxScale = Math.max(minScale * 1.1, Number(tunnel.maxScale) || 3.8);
  const travelPhase = Number.isFinite(Number(tunnel.travelPhase))
    ? Number(tunnel.travelPhase)
    : Number(tunnel.phase) || 0;
  const phaseCycle = Math.floor(travelPhase);
  const phase = ((travelPhase % 1) + 1) % 1;
  tunnel.phase = phase;
  const ratio = getTunnelStepRatio(distanceFactor);
  const centerRange = getTunnelCenterRevealRange(tunnel, ratio);
  const centerHiddenCopies = centerRange.hidden;
  const depthPercent = getTunnelDepthCurvePercent();
  const depthBase = Math.max(
    0,
    Number.isFinite(Number(tunnel.depthCurveMultiplier)) ? Number(tunnel.depthCurveMultiplier) : 1,
  );
  const depthMorphed = routedGlobalMorphValue('tunnel.depthCurveMultiplier', depthBase);
  const depthMultiplier = Math.max(
    0,
    Math.min(10, audioApplyNumeric('tunnel.depthCurveMultiplier', depthMorphed, -1)),
  );

  const fadeOffsetExtra = tunnel.fadeOversize
    ? Math.max(0, Math.min(50, Math.ceil(Number(tunnel.fadeOffsetSteps) || 0)))
    : 0;
  const phaseSpeedMagnitude = tunnel.fadeOversize ? getTunnelPhaseSpeedMagnitude() : 0;
  const fadeTravelExtra = tunnel.fadeOversize
    ? Math.min(64, Math.ceil(phaseSpeedMagnitude * Math.max(0, Number(tunnel.fadeDurationSec) || 0)))
    : 0;
  const outerExtra = Math.max(2, Math.min(68, fadeOffsetExtra + fadeTravelExtra + 4));

  // This logarithmic basis is constant across all Corridor copies in the frame.
  const logMinScale = Math.log(minScale),
    logRatio = Math.log(Math.max(1.000000001, ratio));
  let write = 0;
  for (let i = -2; i <= count - 1 + outerExtra; i++) {
    const position = i + phase;
    const logScale = logMinScale + logRatio * position;
    const scale =
      depthPercent === 0
        ? Math.exp(Math.max(-30, Math.min(30, logScale)))
        : SomataCorridorDepthCurve.scale(
            position,
            count,
            logMinScale,
            logRatio,
            depthPercent,
            depthMultiplier,
          );
    let item = result[write];
    if (!item) item = result[write] = {};
    item.scale = scale;
    item.alpha = tunnelDensityAlpha(position, classicCount, density);
    item._corridorEntryAnchor = false;
    item.position = position;
    item.copyId = i - phaseCycle;
    item.colorIndex = i;
    item.stepRatio = ratio;
    item.centerRevealAlpha = getTunnelCenterRevealAlpha(item, tunnel, centerRange);
    item.centerReveal = item.centerRevealAlpha > 0.0001 && item.centerRevealAlpha < 0.9999;
    write++;
  }
  result.length = write;
  const origin = SomataSpiralZeroTransition.corridorOrigin(result);
  result._corridorOriginPosition = origin?.position;
  // Animate the copies *from* the figure instead of turning on the
  // entire Corridor at once. A single copy stays fully visible at
  // scale 1. All others grow/shrink outwards with staggered opacity.
  const entrance = corridorEntranceFrame();
  if (entrance.population < 1) {
    const anchorIndex = Math.max(0, result.indexOf(origin));
    let maxDistance = 0;
    for (let j = 0; j < write; j++) {
      const d = Math.abs(Math.log(Math.max(1e-12, result[j].scale)));
      maxDistance = Math.max(maxDistance, d);
    }
    for (let j = 0; j < write; j++) {
      const copy = result[j];
      const targetLog = Math.log(Math.max(1e-12, copy.scale));
      const relative = maxDistance > 0 ? Math.abs(targetLog) / maxDistance : 0;
      const local = corridorEase(
        (entrance.population - relative * 0.24) / Math.max(0.01, 1 - relative * 0.24),
      );
      copy.scale = Math.exp(targetLog * local);
      copy.alpha = j === anchorIndex ? tunnelDensityAlpha(classicCount - 1, classicCount, density) : copy.alpha * local;
      copy._corridorEntryAnchor = j === anchorIndex;
      copy.centerRevealAlpha = j === anchorIndex ? 1 : copy.centerRevealAlpha;
    }
  }

  result._phaseSpeedMagnitude = phaseSpeedMagnitude;
  result._depthCurvePercent = depthPercent;
  result._depthCurveMultiplier = depthMultiplier;
  result._depthCurveCount = count;
  result._stepRatio = ratio;
  result._logStepRatio = Math.log(Math.max(1.000001, ratio));
  result._fadeOffset = Math.max(-50, Math.min(50, Math.round(Number(tunnel.fadeOffsetSteps) || 0)));
  result._fadeDurationSec = Math.max(0, Number(tunnel.fadeDurationSec) || 0);
  result._direction = getTunnelSpeedPercent() < 0 ? 'away' : 'toward';
  result._centerHiddenCopies = centerHiddenCopies;
  result._centerRevealStartScale = centerRange.startScale;
  result._centerRevealEndScale = centerRange.endScale;
  result._centerRevealSpacingScale = centerRange.spacingScale;
  return result;
}
function getTunnelPhaseSpeedMagnitude() {
  const tunnel = state.tunnel;
  const musicLevel = state.audioReactive.active
    ? Math.max(
        0,
        Math.min(
          1,
          (state.audioReactive.levels[0] + state.audioReactive.levels[1] + state.audioReactive.levels[2]) / 3,
        ),
      )
    : 0;
  const speedMultiplier = Math.max(0, Number(tunnel.speedMultiplier) || 0);
  const baseSpeed =
    Math.max(0, Number(tunnel.speed) || 0.42) * (Math.abs(getTunnelSpeedPercent()) / 100) * speedMultiplier;
  const visualSpeed = baseSpeed * (1 + musicLevel * 0.28);
  return visualSpeed / getTunnelDistanceFactor(); // copy-steps per second
}
function getTunnelTemporalFadeAlpha(
  copy,
  layerKey,
  extent,
  viewportOuterRadius,
  now = performance.now(),
  tunnelFrame = null,
) {
  const tunnel = state.tunnel;
  if (!tunnel?.active || !tunnel.fadeOversize) return 1;
  const ratio = Math.max(
    1.000001,
    Number(tunnelFrame?._stepRatio) || Number(copy?.stepRatio) || getTunnelStepRatio(),
  );
  const logRatio =
    Number(tunnelFrame?._logStepRatio) > 0 ? Number(tunnelFrame._logStepRatio) : Math.log(ratio);
  const screenLimitScale = Math.max(0.0001, viewportOuterRadius / Math.max(1e-6, extent));
  const relativeFigureSteps =
    Math.log(Math.max(1e-9, Number(copy?.scale) || 1) / screenLimitScale) / logRatio;
  const offset = Number.isFinite(Number(tunnelFrame?._fadeOffset))
    ? Number(tunnelFrame._fadeOffset)
    : Math.max(-50, Math.min(50, Math.round(Number(tunnel.fadeOffsetSteps) || 0)));
  const durationSec = Number.isFinite(Number(tunnelFrame?._fadeDurationSec))
    ? Number(tunnelFrame._fadeDurationSec)
    : Math.max(0, Number(tunnel.fadeDurationSec) || 0);
  const direction = tunnelFrame?._direction || (getTunnelSpeedPercent() < 0 ? 'away' : 'toward');
  const cachedPhaseSpeed = Number(tunnelFrame?._phaseSpeedMagnitude);
  const phaseSpeedMagnitude = Math.max(
    0.0001,
    Number.isFinite(cachedPhaseSpeed) ? cachedPhaseSpeed : getTunnelPhaseSpeedMagnitude(),
  );
  const copyId = Number.isFinite(Number(copy?.copyId))
    ? Number(copy.copyId)
    : Math.round(Number(copy?.position) || 0);
  const key = `${String(layerKey ?? 'layer')}|${copyId}`;

  if (direction !== 'away') {
    if (relativeFigureSteps < offset) {
      tunnelFadeRuntime.exits.delete(key);
      return 1;
    }
    let rt = tunnelFadeRuntime.exits.get(key);
    if (durationSec <= 0.0001) return 0;
    if (!rt) {
      const beyondSteps = Math.max(0, relativeFigureSteps - offset);
      const inferredElapsedMs = Math.min(durationSec * 1000, (beyondSteps / phaseSpeedMagnitude) * 1000);
      if (inferredElapsedMs >= durationSec * 1000 - 0.01) return 0;
      rt = { startedAt: now - inferredElapsedMs, lastSeen: now };
      tunnelFadeRuntime.exits.set(key, rt);
    }
    rt.lastSeen = now;
    const t = Math.max(0, Math.min(1, (now - rt.startedAt) / (durationSec * 1000)));
    if (t >= 1) return 0;
    return 1 - smoothFeatherAlpha(t);
  }

  tunnelFadeRuntime.exits.delete(key);
  if (relativeFigureSteps < offset) return 1;
  if (durationSec <= 0.0001) return 0;
  const secondsFromThreshold = Math.max(0, relativeFigureSteps - offset) / phaseSpeedMagnitude;
  const t = Math.max(0, Math.min(1, secondsFromThreshold / durationSec));
  return 1 - smoothFeatherAlpha(t);
}
function cleanupTunnelFadeRuntime(now = performance.now()) {
  if (now - tunnelFadeRuntime.lastCleanup < 1000) return;
  tunnelFadeRuntime.lastCleanup = now;
  for (const [key, rt] of tunnelFadeRuntime.exits) {
    if (!rt || now - (Number(rt.lastSeen) || 0) > 2500) tunnelFadeRuntime.exits.delete(key);
  }
}
function prepareTunnelVisibleInstances(
  copies,
  layerExtent,
  audioScale,
  viewportOuterRadius,
  zoom,
  layerKey = 'layer',
  now = performance.now(),
  layer = null,
) {
  const outCopies = renderScratch.copies;
  const outAlphas = renderScratch.alphas;
  const outFillAlphas = renderScratch.fillAlphas;
  const outParticleAlphas = renderScratch.particleAlphas;
  // Keep the logical focus population independent of the render-only
  // Spiral outer budget.  A recycled/faded outer copy must not
  // renumber the selected physical focus or change its rotation.
  const focusCopies = renderScratch.focusCopies || (renderScratch.focusCopies = []);
  focusCopies.length = 0;
  outCopies.length = 0;
  outAlphas.length = 0;
  outFillAlphas.length = 0;
  outParticleAlphas.length = 0;
  if (!state.tunnel.active) {
    outCopies.push(copies[0]);
    focusCopies.push(copies[0]);
    const a = copies[0]?.alpha ?? 1;
    outAlphas.push(a);
    outFillAlphas.push(a);
    outParticleAlphas.push(a);
    renderScratch.maxScale = 1;
    return renderScratch;
  }

  cleanupTunnelFadeRuntime(now);
  const extent = Math.max(1, Number(layerExtent) || 1) * Math.max(0.01, Number(audioScale) || 1);
  const zoomSafe = Math.max(0.001, Number(zoom) || 1);
  const projectedFactor = extent * zoomSafe;

  let previousProjectedRadiusPx = NaN;
  let maxScale = 1;
  const centerCullAlpha = 0.0025;
  for (let i = 0; i < copies.length; i++) {
    const copy = copies[i];
    // Invisible not-yet-emerged copies must not occlude the one
    // visible source figure in the density filter.
    if (Number(copy.alpha) <= 0.00001) continue;
    const projectedRadiusPx = projectedFactor * copy.scale;
    if (projectedRadiusPx < 0.18) {
      previousProjectedRadiusPx = projectedRadiusPx;
      continue;
    }

    let sizeFade;
    if (projectedRadiusPx >= 2.4) sizeFade = 1;
    else {
      const q = Math.max(0, Math.min(1, (projectedRadiusPx - 0.18) / 2.22));
      sizeFade = q * q * (3 - 2 * q);
    }

    let densityFade = 1;
    if (Number.isFinite(previousProjectedRadiusPx)) {
      const spacingPx = Math.max(0, projectedRadiusPx - previousProjectedRadiusPx);
      const q = Math.max(0, Math.min(1, spacingPx / 0.9));

      densityFade = q * q * (3 - 2 * q);
    }
    previousProjectedRadiusPx = projectedRadiusPx;
    if (copy._corridorEntryAnchor) densityFade = 1;
    const unfoldAnchor = Number(copy._spiralUnfoldAnchorWeight) || 0;
    densityFade += (1 - densityFade) * unfoldAnchor;

    const travelFade = copy._corridorEntryAnchor
      ? 1
      : getTunnelTemporalFadeAlpha(copy, layerKey, extent, viewportOuterRadius, now, copies);
    const temporalFade = travelFade + (1 - travelFade) * unfoldAnchor;
    const centerRevealAlpha = Number.isFinite(Number(copy?.centerRevealAlpha))
      ? Math.max(0, Math.min(1, Number(copy.centerRevealAlpha)))
      : getTunnelCenterRevealAlpha(
          copy,
          state.tunnel,
          getTunnelCenterRevealRange(state.tunnel, copies?._stepRatio || copy?.stepRatio),
        );

    const outerFade = spiralCorridorOuterFade(copy, extent, viewportOuterRadius, zoomSafe, layer);
    const logicalAlpha =
      Math.max(0, Math.min(1, Number(copy.alpha) || 0)) *
      temporalFade *
      sizeFade *
      (centerRevealAlpha + (1 - centerRevealAlpha) * unfoldAnchor);
    if (logicalAlpha > centerCullAlpha) focusCopies.push(copy);
    const baseVisibleAlpha = logicalAlpha * outerFade;

    const alpha = baseVisibleAlpha * densityFade;
    const fillAlpha = baseVisibleAlpha;
    const particleAlpha = baseVisibleAlpha;

    if (alpha <= centerCullAlpha && fillAlpha <= centerCullAlpha && particleAlpha <= centerCullAlpha)
      continue;
    outCopies.push(copy);
    outAlphas.push(alpha);
    outFillAlphas.push(fillAlpha);
    outParticleAlphas.push(particleAlpha);
    if (copy.scale > maxScale) maxScale = copy.scale;
  }
  renderScratch.maxScale = maxScale;
  return renderScratch;
}
function smoothFeatherAlpha(t) {
  const x = Math.max(0, Math.min(1, Number(t) || 0));

  return x * x * x * (x * (x * 6 - 15) + 10);
}
function prepareTunnelLampInstances(
  copies,
  layerExtent,
  scaleMultiplier,
  viewportOuterRadius,
  zoom,
  layerKey = 'layer',
  now = performance.now(),
  lampConfig = null,
  layer = null,
) {
  const outCopies = lampRenderScratch.copies;
  const outAlphas = lampRenderScratch.alphas;
  outCopies.length = 0;
  outAlphas.length = 0;
  if (!state.tunnel.active) {
    outCopies.push(copies[0]);
    outAlphas.push(copies[0]?.alpha ?? 1);
    lampRenderScratch.maxScale = 1;
    return lampRenderScratch;
  }

  const cfg = lampConfig || state.lamps || {};
  const lampRadius = Math.max(1, (Number(cfg.radius) || 21) * Math.max(0, Number(cfg.radiusMultiplier) || 0));
  const effectiveScale = Math.max(0.001, Number(scaleMultiplier) || 1);
  const zoomSafe = Math.max(0.001, Number(zoom) || 1);
  const extent = Math.max(1, Number(layerExtent) || 1) * effectiveScale;
  const centerCullAlpha = 0.002;
  let maxScale = 1;
  for (let i = 0; i < copies.length; i++) {
    const copy = copies[i];
    const screenLampRadius = lampRadius * Math.max(0.0001, copy.scale) * effectiveScale * zoomSafe;
    let sizeFade;
    if (screenLampRadius <= 0.18) sizeFade = 0;
    else if (screenLampRadius >= 1.15) sizeFade = 1;
    else {
      const q = (screenLampRadius - 0.18) / 0.97;
      sizeFade = q * q * (3 - 2 * q);
    }
    if (sizeFade <= 0.001) continue;

    const unfoldAnchor = Number(copy._spiralUnfoldAnchorWeight) || 0;
    const travelFade = getTunnelTemporalFadeAlpha(copy, layerKey, extent, viewportOuterRadius, now, copies);
    const temporalFade = travelFade + (1 - travelFade) * unfoldAnchor;
    const centerRevealAlpha = Number.isFinite(Number(copy?.centerRevealAlpha))
      ? Math.max(0, Math.min(1, Number(copy.centerRevealAlpha)))
      : getTunnelCenterRevealAlpha(
          copy,
          state.tunnel,
          getTunnelCenterRevealRange(state.tunnel, copies?._stepRatio || copy?.stepRatio),
        );
    const alpha =
      Math.max(0, Math.min(1, Number(copy.alpha) || 0)) *
      sizeFade *
      temporalFade *
      (centerRevealAlpha + (1 - centerRevealAlpha) * unfoldAnchor) *
      spiralCorridorOuterFade(copy, extent, viewportOuterRadius, zoomSafe, layer);
    if (alpha <= centerCullAlpha) continue;
    outCopies.push(copy);
    outAlphas.push(alpha);
    if (copy.scale > maxScale) maxScale = copy.scale;
  }
  lampRenderScratch.maxScale = maxScale;
  return lampRenderScratch;
}
const TUNNEL_VIGNETTE_DEFAULT_PX = 54;
function legacyTunnelVignetteToPixels(value) {
  const old = Math.max(0, Math.min(10, Number(value) || 0));

  return Math.round((old > 0 ? 243 * Math.sqrt(old / 10) : 0) * 10) / 10;
}
function tunnelVignettePixelsFromSettings(settings, fallback = TUNNEL_VIGNETTE_DEFAULT_PX) {
  const src = settings && typeof settings === 'object' ? settings : {};
  const raw = Number(src.vignetteAmount);
  if (!Number.isFinite(raw)) return Math.max(0, Math.min(1200, Number(fallback) || 0));
  if (src.vignetteUnit === 'px' || src.vignettePixels === true) return Math.max(0, Math.min(1200, raw));
  return Math.max(0, Math.min(1200, legacyTunnelVignetteToPixels(raw)));
}
function applyTunnelScreenEdgeFeather(ctx, cssWidth, cssHeight, dpr) {
  if (!state.showVignette || !state.tunnel?.active || !state.tunnel.fadeOversize) return;
  const amountPx = getTunnelVignetteAmount();
  if (amountPx <= 0.0001) return;
  try {
    renderBackendTelemetry.mark('final', 'canvas', 'Canvas tunnel vignette', true);
  } catch (error) {
    noteSuppressedError('corridor/corridor-instances#applyTunnelScreenEdgeFeather', error);
  }

  const w = Math.max(1, ctx.canvas.width);
  const h = Math.max(1, ctx.canvas.height);
  const cssW = Math.max(1, Number(cssWidth) || 1);
  const cssH = Math.max(1, Number(cssHeight) || 1);
  const motionView = getMotionViewportTransform(cssW, cssH);
  const originX = cssW * 0.5 + (Number(state.panX) || 0) + (Number(motionView.panX) || 0);
  const originY = cssH * 0.5 + (Number(state.panY) || 0) + (Number(motionView.panY) || 0);
  const edgeXCss = Math.max(1, Math.min(originX, cssW - originX));
  const edgeYCss = Math.max(1, Math.min(originY, cssH - originY));
  const featherXCss = Math.max(0.25, Math.min(amountPx, cssW * 0.49, edgeXCss * 0.98));
  const featherYCss = Math.max(0.25, Math.min(amountPx, cssH * 0.49, edgeYCss * 0.98));
  const featherX = Math.max(1, featherXCss * dpr);
  const featherY = Math.max(1, featherYCss * dpr);
  const fx = Math.max(0.0001, Math.min(0.49, featherX / w));
  const fy = Math.max(0.0001, Math.min(0.49, featherY / h));
  const stopCount = amountPx >= 180 ? 40 : 28;
  const key = `${w}|${h}|${fx.toFixed(6)}|${fy.toFixed(6)}|${stopCount}`;

  if (
    tunnelVignetteMaskCache.key !== key ||
    tunnelVignetteMaskCanvas.width !== w ||
    tunnelVignetteMaskCanvas.height !== h
  ) {
    tunnelVignetteMaskCanvas.width = w;
    tunnelVignetteMaskCanvas.height = h;
    const m = tunnelVignetteMaskCtx;
    m.setTransform(1, 0, 0, 1, 0, 0);
    m.globalAlpha = 1;
    m.filter = 'none';
    m.globalCompositeOperation = 'source-over';
    m.clearRect(0, 0, w, h);
    const gx = m.createLinearGradient(0, 0, w, 0);
    for (let i = 0; i <= stopCount; i++) {
      const p = i / stopCount,
        a = smoothFeatherAlpha(p);
      gx.addColorStop(Math.min(0.499999, p * fx), `rgba(255,255,255,${a})`);
      gx.addColorStop(Math.max(0.500001, 1 - p * fx), `rgba(255,255,255,${a})`);
    }
    gx.addColorStop(fx, 'rgba(255,255,255,1)');
    gx.addColorStop(1 - fx, 'rgba(255,255,255,1)');
    m.fillStyle = gx;
    m.fillRect(0, 0, w, h);
    const gy = m.createLinearGradient(0, 0, 0, h);
    for (let i = 0; i <= stopCount; i++) {
      const p = i / stopCount,
        a = smoothFeatherAlpha(p);
      gy.addColorStop(Math.min(0.499999, p * fy), `rgba(255,255,255,${a})`);
      gy.addColorStop(Math.max(0.500001, 1 - p * fy), `rgba(255,255,255,${a})`);
    }
    gy.addColorStop(fy, 'rgba(255,255,255,1)');
    gy.addColorStop(1 - fy, 'rgba(255,255,255,1)');
    m.globalCompositeOperation = 'destination-in';
    m.fillStyle = gy;
    m.fillRect(0, 0, w, h);
    m.globalCompositeOperation = 'source-over';
    tunnelVignetteMaskCache.key = key;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(tunnelVignetteMaskCanvas, 0, 0);
  ctx.restore();
}
// Lightweight counters for diagnosing Corridor-only invalidation load.
let corridorIdleSkips = 0,
  corridorMotionInvalidations = 0;
function tunnelAnimationFrame(now) {
  const tunnel = state.tunnel;
  if (!tunnel?.active) {
    tunnel.raf = 0;
    tunnel.lastTime = 0;
    return false;
  }

  if (!tunnel.lastTime) tunnel.lastTime = now;

  const dt = Math.max(0, Math.min(0.05, (now - tunnel.lastTime) / 1000));
  tunnel.lastTime = now;

  const musicLevel = state.audioReactive.active
    ? Math.max(
        0,
        Math.min(
          1,
          (state.audioReactive.levels[0] + state.audioReactive.levels[1] + state.audioReactive.levels[2]) / 3,
        ),
      )
    : 0;
  const speedPercent = getTunnelSpeedPercent();
  const speedMultiplier = Math.max(0, Number(tunnel.speedMultiplier) || 0);
  const baseSpeed =
    Math.max(0, Number(tunnel.speed) || 0.42) * (Math.abs(speedPercent) / 100) * speedMultiplier;
  const visualSpeed = baseSpeed * (1 + musicLevel * 0.28);
  const distanceFactor = getTunnelDistanceFactor();
  const phaseSpeed = visualSpeed / distanceFactor;
  const directionSign = speedPercent < 0 ? -1 : 1;
  if (!Number.isFinite(Number(tunnel.travelPhase))) tunnel.travelPhase = Number(tunnel.phase) || 0;
  const previousPhase = tunnel.phase;
  tunnel.travelPhase += dt * phaseSpeed * directionSign;
  tunnel.phase = ((tunnel.travelPhase % 1) + 1) % 1;

  // The entrance must advance even with Corridor speed set to zero.
  if (corridorOrderChanges.size) {
    for (const id of corridorOrderChanges.keys()) corridorOrderChangeFrame(id, now);
    if (corridorOrderChanges.size) {
      corridorMotionInvalidations++;
      requestMainCanvasRender();
      return true;
    }
  }
  // A zero-order Corridor expansion is a real animation even when
  // travel speed is 0. Completed records remain as the static expanded
  // Corridor endpoint and do not cause redraws forever.
  if (honestZeroCorridorOutros.size) {
    let running = false;
    for (const id of honestZeroCorridorOutros.keys()) {
      if (honestZeroCorridorOutroFrame(id, now)?.active === true) running = true;
    }
    if (running) {
      corridorMotionInvalidations++;
      requestMainCanvasRender();
      return true;
    }
  }
  // Keep the independent Honest 0 -> 1 corridor gathering alive even
  // with zero Corridor travel speed; the Spiral is still stationary.
  if (honestZeroCorridorIntros.size) {
    let running = false;
    for (const id of honestZeroCorridorIntros.keys()) {
      if (honestZeroCorridorIntroFrame(id, now)?.active === true) running = true;
    }
    if (running) {
      corridorMotionInvalidations++;
      requestMainCanvasRender();
      return true;
    }
  }
  if (!corridorEntrance.completed) {
    const animation = corridorEntranceFrame(now);
    if (!animation.active) {
      corridorEntrance.completed = true;
      if (corridorEntrance.direction === 'out') {
        // Only after the last collapsed frame can Tunnel state be
        // released: otherwise every Corridor GPU pass disappears early.
        setTunnelMode(false, { silent: true });
        requestMainCanvasRender();
        return false;
      }
    }
    corridorMotionInvalidations++;
    requestMainCanvasRender();
    return true;
  }

  // Keep the scheduler alive but avoid a full multi-copy Corridor
  // redraw if the travel phase did not move (speed=0, paused audio,
  // or a clamped dt). Other effects still invalidate independently.
  if (Math.abs(tunnel.phase - (Number(previousPhase) || 0)) > 1e-10) {
    corridorMotionInvalidations++;
    requestMainCanvasRender();
  } else corridorIdleSkips++;
  return true;
}

export {
  TUNNEL_VIGNETTE_DEFAULT_PX,
  applyTunnelScreenEdgeFeather,
  getTunnelCopies,
  legacyTunnelVignetteToPixels,
  prepareTunnelLampInstances,
  prepareTunnelVisibleInstances,
  smoothFeatherAlpha,
  tunnelAnimationFrame,
  tunnelVignettePixelsFromSettings,
};
