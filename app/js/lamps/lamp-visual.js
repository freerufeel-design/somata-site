// Лампы: адаптивная экспозиция, боке, цвет, стиль и план отрисовки.
import './lamp-topology.js'; // initialisation order: this module runs after it
import { audioApplyNumeric } from '../audio/audio-routing.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { canvasViewport } from '../core/render-runtime.js';
import { runtimeState, state } from '../core/state.js';
import { isGeometryMorphActive } from '../effects/motion.js';
import { lampHash32 } from './lamp-anchors.js';
import { wrapLampColorPhase } from '../render/lamp-color.js';
import { lampContourAttachmentEnabledForFrame } from '../render/lamp-morph-bridge.js';
import { mainCanvas } from '../ui/profile-presets.js';
import { lampPhasePresence, lampVisualNow } from './lamp-motion.js';
import { lampMorphWave, lampSeedUnit } from './lamp-topology.js';
import {
  createLampAutoExponentState,
  lampAdaptiveExponentShape,
  stepLampAutoExponent,
} from './adaptive-exponent.js';

const lampAdaptiveFrame = {
  previousArea: 0,
  currentArea: 0,
  seen: new Set(),
  activeLayers: 0,
  lastViewportArea: 0,
  viewportArea: 0,
  needsSettle: false,
  instantStatic: true,
};
const lampAdaptiveSmoothing = new WeakMap();
const lampAdaptiveAutoExponent = new WeakMap();
function beginLampAdaptiveFrame() {
  lampAdaptiveFrame.currentArea = 0;
  lampAdaptiveFrame.activeLayers = 0;
  lampAdaptiveFrame.seen.clear();
  lampAdaptiveFrame.needsSettle = false;
  // Размер холста читается из разметки (clientWidth/Height — принудительный layout), поэтому один раз
  // за кадр, лениво, а не при каждом вызове расчёта экспозиции (их десятки на кадр).
  lampAdaptiveFrame.viewportArea = 0;

  lampAdaptiveFrame.instantStatic = !isGeometryMorphActive();
}
function finishLampAdaptiveFrame() {
  const prev = Math.max(0, Number(lampAdaptiveFrame.previousArea) || 0);
  const cur = Math.max(0, Number(lampAdaptiveFrame.currentArea) || 0);
  lampAdaptiveFrame.previousArea = cur;

  const denom = Math.max(1, prev, cur);
  const areaChanged = Math.abs(cur - prev) / denom > 0.015;

  if (lampAdaptiveFrame.instantStatic && areaChanged) requestMainCanvasRender();
}
function lampEffectiveBokeh(cfg) {
  const scatterBase = Math.max(0, Math.min(100, Number(cfg?.scatter) || 0)) / 100;
  const scatterMult = Math.max(
    0,
    Number.isFinite(Number(cfg?.scatterMultiplier)) ? Number(cfg.scatterMultiplier) : 1,
  );
  const sizeBase = Math.max(0, Math.min(100, Number(cfg?.sizeVariation) || 0)) / 100;
  const sizeMult = Math.max(0, Number(cfg?.sizeVariationMultiplier ?? 1));
  const brightBase = Math.max(0, Math.min(100, Number(cfg?.brightnessVariation) || 0)) / 100;
  const brightMult = Math.max(0, Number(cfg?.brightnessVariationMultiplier ?? 1));
  return {
    scatter: Math.max(0, scatterBase * scatterMult),
    sizeVar: Math.max(0, Math.min(3, sizeBase * sizeMult)),
    brightVar: Math.max(0, Math.min(3, brightBase * brightMult)),
  };
}
function smoothLampAdaptiveFactors(cfg, targetRadiusFactor, targetBrightnessFactor) {
  const targetR = Math.max(0.001, Math.min(1, Number(targetRadiusFactor) || 1));
  const targetB = Math.max(0.001, Math.min(1, Number(targetBrightnessFactor) || 1));
  const exposureSec = lampAdaptiveFrame.instantStatic
    ? 0
    : Math.max(0, Number(cfg?.adaptiveFadeSec ?? 1) || 0);
  const now = lampVisualNow();
  if (exposureSec <= 0) {
    lampAdaptiveSmoothing.set(cfg, {
      radiusFactor: targetR,
      brightnessFactor: targetB,
      targetR,
      targetB,
      lastTime: now,
      exposureSec: 0,
    });
    return { radiusFactor: targetR, brightnessFactor: targetB };
  }
  let rt = lampAdaptiveSmoothing.get(cfg);
  if (!rt) {
    rt = { radiusFactor: 1, brightnessFactor: 1, targetR, targetB, lastTime: now, exposureSec };
    lampAdaptiveSmoothing.set(cfg, rt);
    lampAdaptiveFrame.needsSettle = true;
    return { radiusFactor: rt.radiusFactor, brightnessFactor: rt.brightnessFactor };
  }
  const last = Number(rt.lastTime) || now,
    dt = Math.max(0, Math.min(250, now - last));
  rt.lastTime = now;
  rt.targetR = targetR;
  rt.targetB = targetB;
  rt.exposureSec = exposureSec;
  // Exposure is a continuous time response, not a restarted tween. A moving Morph
  // target may change every frame; restarting startTime on every target change made
  // the adaptive value stay at 1 forever. The coefficient below reaches ~99% of a
  // fixed target during the configured exposure time while following moving targets.
  const k = dt <= 0 ? 0 : 1 - Math.exp((-4.605170186 * dt) / Math.max(1, exposureSec * 1000));
  rt.radiusFactor += (targetR - rt.radiusFactor) * k;
  rt.brightnessFactor += (targetB - rt.brightnessFactor) * k;
  if (Math.abs(targetR - rt.radiusFactor) < 0.0005) rt.radiusFactor = targetR;
  if (Math.abs(targetB - rt.brightnessFactor) < 0.0005) rt.brightnessFactor = targetB;
  if (Math.abs(targetR - rt.radiusFactor) > 0.0005 || Math.abs(targetB - rt.brightnessFactor) > 0.0005)
    lampAdaptiveFrame.needsSettle = true;
  return { radiusFactor: rt.radiusFactor, brightnessFactor: rt.brightnessFactor };
}
function lampAdaptiveExposureFactors(
  cfg,
  pointsCount,
  instanceCount,
  baseR,
  baseBrightness,
  viewZoom = state.zoom,
) {
  if (cfg?.adaptiveBrightness === false) {
    lampAdaptiveSmoothing.delete(cfg);
    lampAdaptiveAutoExponent.delete(cfg);
    return { radiusFactor: 1, brightnessFactor: 1 };
  }
  const adaptivePower =
    (Math.max(0, Math.min(100, Number(cfg?.adaptiveStrength ?? 100))) / 100) *
    Math.max(0, Number(cfg?.adaptiveStrengthMultiplier ?? 1));
  const count = Math.max(1, (Number(pointsCount) || 1) * (Number(instanceCount) || 1)),
    zoom = Math.max(0.05, Number(viewZoom) || 1),
    rScreen = Math.max(0.5, (Number(baseR) || 1) * zoom);
  let viewportArea = lampAdaptiveFrame.viewportArea;
  if (!(viewportArea > 0)) {
    // Размер берём из кэша области просмотра (его обновляет ensureMainCanvasSize) — без чтения
    // разметки; clientWidth/Height принудительно пересчитывал layout на каждом кадре.
    const w = canvasViewport.w > 0 ? canvasViewport.w : mainCanvas?.clientWidth || innerWidth || 1,
      h = canvasViewport.h > 0 ? canvasViewport.h : mainCanvas?.clientHeight || innerHeight || 1;
    viewportArea = Math.max(1, w * h);
    lampAdaptiveFrame.viewportArea = viewportArea;
  }
  const targetArea = viewportArea / 3,
    estimatedArea = count * Math.PI * rScreen * rScreen;
  if (!lampAdaptiveFrame.seen.has(cfg)) {
    lampAdaptiveFrame.seen.add(cfg);
    lampAdaptiveFrame.currentArea += estimatedArea;
    lampAdaptiveFrame.activeLayers++;
  }
  const sharedArea = Math.max(estimatedArea, Number(lampAdaptiveFrame.previousArea) || 0),
    adjustBrightness = cfg?.adaptiveAdjustBrightness === true,
    headroom = adjustBrightness ? 1 + 2.25 * Math.exp(-Math.max(0, count - 1) / 5.5) : 1,
    effectiveTargetArea = targetArea * headroom;
  let radiusFactor = 1,
    brightnessFactor = 1;
  const overloaded = sharedArea > effectiveTargetArea;
  // Экспоненциальность кривой: 0 — линейно (прежнее поведение), ±100 % — десятичная ± экспонента.
  // Авто-экспонента при вспышке (резком росте площади) ненадолго поднимает степень.
  let exponent = Math.max(-100, Math.min(100, Number(cfg?.adaptiveExponent) || 0)) / 100;
  if (cfg?.adaptiveAutoExponent === true) {
    let auto = lampAdaptiveAutoExponent.get(cfg);
    if (!auto) lampAdaptiveAutoExponent.set(cfg, (auto = createLampAutoExponentState()));
    const boost = stepLampAutoExponent(
      auto,
      sharedArea,
      lampVisualNow(),
      Number(cfg?.adaptiveFadeSec ?? 1) || 0,
      overloaded,
    );
    if (boost > 0) exponent = Math.min(1, exponent + boost);
    // Пока добавка растёт или спадает, кадры нужно продолжать, иначе статичная сцена замрёт на полпути.
    if (boost > 0 || auto.peak > 0) lampAdaptiveFrame.needsSettle = true;
  } else lampAdaptiveAutoExponent.delete(cfg);
  if (overloaded && adaptivePower > 0) {
    const load = lampAdaptiveExponentShape(
      Math.max(0.001, Math.min(1, effectiveTargetArea / sharedArea)),
      exponent,
    );
    if (adjustBrightness) brightnessFactor = Math.max(0.001, Math.min(1, Math.pow(load, adaptivePower)));
    else radiusFactor = Math.max(0.001, Math.min(1, Math.pow(Math.sqrt(load), adaptivePower)));
  }
  return smoothLampAdaptiveFactors(cfg, radiusFactor, brightnessFactor);
}
function rainbowLampColorPhase(phase) {
  const h = (wrapLampColorPhase(phase) * 360 + 12) % 360,
    s = 0.92,
    v = 1,
    c = v * s,
    x = c * (1 - Math.abs(((h / 60) % 2) - 1)),
    m = v - c;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return (
    '#' +
    [r, g, b]
      .map((n) =>
        Math.round((n + m) * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}
function getLampAudioMod(index, layerIndex = -1) {
  if (!state.audioReactive?.active) return { brightness: 1, size: 1 };
  const idx = Number.isInteger(layerIndex) ? layerIndex : -1;
  return {
    brightness: audioApplyNumeric('lamps.brightness', 1, idx),
    size: audioApplyNumeric('lamps.radius', 1, idx),
  };
}
function prepareLampDrawStyle(
  cfg,
  audioLayerIndex,
  pointsLength,
  adaptiveInstanceCount,
  viewZoom,
  out = null,
) {
  const style = out || {},
    radiusMult = Math.max(0, Number(cfg.radiusMultiplier ?? 1) || 0);
  style.baseR = Math.max(1, (Number(cfg.radius) || 50) * radiusMult);
  style.baseBrightnessPercent = Math.max(
    0,
    Math.min(200, Number.isFinite(Number(cfg.brightness)) ? Number(cfg.brightness) : 100),
  );
  const softnessMult = Math.max(
    0,
    Number.isFinite(Number(cfg.softnessMultiplier)) ? Number(cfg.softnessMultiplier) : 1,
  );
  style.effectiveSoftness = Math.max(
    0,
    Math.min(
      150,
      audioApplyNumeric(
        'lamps.softness',
        (Number.isFinite(Number(cfg.softness)) ? Number(cfg.softness) : 100) * softnessMult,
        audioLayerIndex,
      ),
    ),
  );
  const bokeh = lampEffectiveBokeh(cfg);
  style.scatter = Math.max(0, audioApplyNumeric('lamps.scatter', bokeh.scatter, audioLayerIndex));
  style.sizeVar = Math.max(0, audioApplyNumeric('lamps.sizeVariation', bokeh.sizeVar, audioLayerIndex));
  style.brightVar = Math.max(
    0,
    audioApplyNumeric('lamps.brightnessVariation', bokeh.brightVar, audioLayerIndex),
  );
  style.morphSize = 0;
  style.morphBright = 0; // 7.10.5: no second lamp Morph layer on top of routed parameters.
  style.adaptive = lampAdaptiveExposureFactors(
    cfg,
    pointsLength,
    adaptiveInstanceCount,
    style.baseR,
    style.baseBrightnessPercent / 100,
    viewZoom,
  );
  style.blendMode = cfg.blendMode || 'lighter';
  style.colorMode = cfg.colorMode || (cfg.rainbow ? 'rainbow' : cfg.matchLineColor ? 'line' : 'selected');
  style.appearance = cfg.appearance === 'modern' ? 'modern' : 'classic';
  style.type = cfg.type || 'whiteCore';
  return style;
}
function prepareLampVisualPlan(points, layer, cfg, style, audioLayerIndex, out = null, timing = null) {
  const plan = out || {},
    items = Array.isArray(plan.items) ? plan.items : (plan.items = []);
  let write = 0,
    total = points?.length || 0;
  // Snap-to-contour is a CENTER constraint, not just a rule for initial
  // path anchors. Bokeh scatter previously displaced the final visible
  // lamp even after that anchor was projected onto the frame rail.
  // Keep artistic scatter available when the user explicitly disables
  // contour snapping, for both GPU Arc and Canvas/CPU lamp paths.
  const snapped = lampContourAttachmentEnabledForFrame({ layerLampConfig: cfg }) === true;
  const baseR = style.baseR,
    baseBrightnessPercent = style.baseBrightnessPercent,
    scatter = snapped ? 0 : style.scatter,
    sizeVar = style.sizeVar,
    brightVar = style.brightVar,
    morphSize = style.morphSize,
    morphBright = style.morphBright,
    adaptive = style.adaptive;
  const layerSeed = lampHash32(String(layer?.id || layer?.name || 'layer')),
    audio = getLampAudioMod(0, audioLayerIndex),
    audioSize = Math.max(0, Number(audio?.size) || 0),
    audioBrightness = Math.max(0, Number(audio?.brightness) || 0),
    mode = style.colorMode;
  for (let i = 0; i < total; i++) {
    const p = points[i],
      level = Math.max(0, Math.min(1, p?.lampLevel === undefined ? 1 : Number(p.lampLevel) || 0)),
      presence = lampPhasePresence(p, cfg, timing);
    // Keep dark phase births available for the clearance measurement on
    // the first frame, before their brightness envelope starts.
    const awaitingClearance = timing && typeof p?.lampSourcePresent === 'boolean' &&
      typeof p?.lampTargetPresent === 'boolean' && p.lampSourcePresent !== p.lampTargetPresent;
    if (level <= 0.002 || (presence <= 0.002 && !awaitingClearance)) continue;
    const seed = Number.isFinite(Number(p?.lampSeed))
        ? Number(p.lampSeed) >>> 0
        : (layerSeed ^ Math.imul(i + 1, 2654435761)) >>> 0,
      sizeRandom = sizeVar ? Math.max(0.12, 1 + (lampSeedUnit(seed, 3) * 2 - 1) * sizeVar * 0.78) : 1;
    let px = Number(p?.x) || 0;
    let py = Number(p?.y) || 0;
    if (scatter) {
      const angle = lampSeedUnit(seed, 1) * Math.PI * 2;
      const dist = scatter * baseR * 2.4 * Math.sqrt(lampSeedUnit(seed, 2));
      px += Math.cos(angle) * dist;
      py += Math.sin(angle) * dist;
    }
    const brightUnit = !brightVar ? 0.5 : Number.isFinite(Number(p?.lampBrightnessUnit))
        ? Math.max(0, Math.min(1, Number(p.lampBrightnessUnit)))
        : lampSeedUnit(seed, 4),
      brightRandom = Math.max(0.08, 1 + (brightUnit * 2 - 1) * brightVar * 0.9),
      sizeMorph = Math.max(0.12, 1 + lampMorphWave(seed, 5) * morphSize),
      brightMorph = Math.max(0.08, 1 + lampMorphWave(seed, 9) * morphBright);
    let color = mode === 'line' ? layer.strokeColor || '#ffffff' : cfg.color || '#ffe600';
    if (mode === 'rainbow') {
      const rainbowIndex = Number.isFinite(Number(p?.lampStableIndex))
        ? Math.abs(Math.round(Number(p.lampStableIndex)))
        : i;
      const rainbowPhase = Number.isFinite(Number(p?.lampColorPhase))
        ? wrapLampColorPhase(p.lampColorPhase)
        : wrapLampColorPhase(rainbowIndex / Math.max(1, total));
      color = rainbowLampColorPhase(rainbowPhase);
    }
    const visualRadiusBase = baseR * sizeRandom * sizeMorph * Math.max(0.06, Math.sqrt(level)),
      rad = Math.max(0, visualRadiusBase * adaptive.radiusFactor + visualRadiusBase * (audioSize - 1)),
      visualBrightnessBase = baseBrightnessPercent * brightRandom * brightMorph * level,
      effectiveBrightness = Math.max(
        0,
        Math.min(
          200,
          visualBrightnessBase * adaptive.brightnessFactor + visualBrightnessBase * (audioBrightness - 1),
        ),
      );
    let item = items[write];
    if (!item)
      item = items[write] = { px: 0, py: 0, rad: 0, color: '#ffffff', brightness: 0, intensityAlpha: 0 };
    item.lampSpiralEndpoint = p?.lampSpiralEndpoint === true;
    item.lampTraceId = p?.lampId ?? `slot:${p?.pathIndex ?? 0}:${p?.vertexIndex ?? i}`;
    item.lampSourcePresent = p?.lampSourcePresent;
    item.lampTargetPresent = p?.lampTargetPresent;
    item.lampKeyAnchor = cfg.morphMotionMode === 'key' && p.lampRank !== 1;
    item.lampContourBound = snapped;
    item.lampPresence = presence;
    item.lampPhaseTimed = timing !== null && typeof p?.lampSourcePresent === 'boolean' &&
      typeof p?.lampTargetPresent === 'boolean';
    item.lampRank = p?.lampRank === 1 ? 1 : 0;
    item.px = px;
    item.py = py;
    item.rad = rad;
    item.color = color;
    item.brightness = effectiveBrightness;
    item.intensityAlpha = Math.max(0, Math.min(1, effectiveBrightness / 100)) * presence;
    item.pathIndex = Number.isFinite(Number(p?.pathIndex)) ? Math.max(0, Math.floor(Number(p.pathIndex))) : 0;
    item.lampHasAttachFraction = Number.isFinite(p?.lampAttachFraction);
    item.lampAttachFraction = Number.isFinite(Number(p?.lampAttachFraction))
      ? Math.max(0, Math.min(1, Number(p.lampAttachFraction)))
      : 0;
    item.lampIdentityIndex = Number.isFinite(Number(p?.lampIdentityIndex))
      ? Math.max(0, Math.floor(Number(p.lampIdentityIndex)))
      : 0;
    const gpuBaseX = Number.isFinite(Number(p?.gpuLampBaseX)) ? Number(p.gpuLampBaseX) : Number(p?.x) || 0,
      gpuBaseY = Number.isFinite(Number(p?.gpuLampBaseY)) ? Number(p.gpuLampBaseY) : Number(p?.y) || 0;
    item.gpuLampOffsetX = px - gpuBaseX;
    item.gpuLampOffsetY = py - gpuBaseY;
    write++;
  }
  items.length = write;
  plan.items = items;
  plan.cfg = cfg;
  plan.style = style;
  return plan;
}

export {
  beginLampAdaptiveFrame,
  finishLampAdaptiveFrame,
  lampAdaptiveFrame,
  lampEffectiveBokeh,
  prepareLampDrawStyle,
  prepareLampVisualPlan,
};
