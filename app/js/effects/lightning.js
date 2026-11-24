// Молния: выборка, часы и синхронизация частоты, упрощение, подготовка кадра.
import './glint-bezier.js'; // initialisation order: this module runs after it
import { audioApplyNumeric } from '../audio/audio-routing.js';
import { getTapMorphIntervalSec } from '../audio/tap-tempo.js';
import {
  createDefaultSweepConfig,
  currentSweepConfig,
  getLayerLineVisible,
  getLayerSweepConfig,
  normalizeSweepConfig,
} from '../core/defaults-layers.js';
import { runtimeState, state } from '../core/state.js';
import { getLayerStrokeWidthMultiplier } from './motion.js';
import {
  acquireEffectInfo,
  acquireEffectPiece,
  buildPathLengthTable,
  effectPointAt,
  effectXYAt,
  frameGeometryRuntime,
  getLightningDynamicScratch,
  pointAtPathDistance,
  resetEffectPieceScratch,
} from '../geometry/frame-paths.js';
import { getSweepSegmentsForPath, getSweepTargetVelocity, sweepStableUnit } from './sweep-glint.js';
import {
  exactLightningSelection,
  isHighPrecisionLightning,
  normalizeLightningPrecisionValue,
} from './lightning-exact.js';
import { prepareWebVisiblePaths } from './web.js';

function lightningSmooth01(value) {
  const t = Math.max(0, Math.min(1, Number(value) || 0));
  return t * t * t * (t * (t * 6 - 15) + 10);
}
function lightningSamplingProfile(cfg, maxSamples = 90) {
  const precision = normalizeLightningPrecisionValue(cfg?.lightningPrecision);

  if (precision === 'exact')
    return { precision, step: 1.05, cap: Math.max(448, maxSamples * 5), adaptiveSpline: true };
  return { precision, step: 1.35, cap: Math.max(384, maxSamples * 6) };
}
function sampleLightningRange(table, start, length, maxSamples = 90, scratch = null, cfg = null) {
  if (!table || !(table.total > 0) || !(length > 1e-6)) return scratch ? null : [];
  const a = Math.max(0, Math.min(table.total, start)),
    b = Math.max(a, Math.min(table.total, start + length));
  if (b - a <= 1e-6) return scratch ? null : [];
  const sampling = lightningSamplingProfile(cfg, maxSamples);
  const n = Math.max(3, Math.min(sampling.cap, Math.ceil((b - a) / sampling.step)));
  const pts = scratch ? acquireEffectPiece(scratch) : [];
  for (let i = 0; i <= n; i++) {
    const d = a + (b - a) * (i / n);
    if (scratch) effectPointAt(pts, i, table, d);
    else pts.push(pointAtPathDistance(table, d));
  }
  pts.length = n + 1;
  return pts;
}
function getLightningModePieces(
  paths,
  layer,
  scratch = null,
  cfg = currentSweepConfig(layer),
  layerIndex = -1,
) {
  const mode = ['perSegment', 'everyNth', 'across', 'perPath', 'whole'].includes(cfg.lightningMode)
    ? cfg.lightningMode
    : 'perSegment';
  const frac = Math.max(
    0.01,
    Math.min(
      1,
      audioApplyNumeric('lightning.segment', Number(cfg.lightningSegmentPercent) || 100, layerIndex) / 100,
    ),
  );
  const random = cfg.lightningRandomPosition === true,
    cycle = Math.max(0, Math.round(Number(cfg.lightningCycleCount) || 0));
  const pieces = scratch ? resetEffectPieceScratch(scratch).pieces : [];
  if (mode === 'across') {
    let minX = Infinity,
      maxX = -Infinity;
    for (const pth of paths || [])
      for (const p of pth?.points || []) {
        if (Number.isFinite(p.x)) {
          minX = Math.min(minX, p.x);
          maxX = Math.max(maxX, p.x);
        }
      }
    if (!(maxX > minX)) return pieces;
    const span = maxX - minX,
      band = Math.max(1, span * frac),
      half = band * 0.5;
    const cx = random
      ? minX + half + sweepStableUnit(cycle + 917) * Math.max(0, span - band)
      : (minX + maxX) * 0.5;
    for (const pth of paths || []) {
      const pts = pth?.points || [];
      if (pts.length < 2) continue;
      const count = pth.closed ? pts.length : pts.length - 1;
      for (let i = 0; i < count; i++) {
        const a = pts[i],
          b = pts[(i + 1) % pts.length],
          len = Math.hypot(b.x - a.x, b.y - a.y);
        if (len < 1e-6) continue;
        const sampling = lightningSamplingProfile(cfg, 64),
          n = Math.max(2, Math.min(sampling.cap, Math.ceil(len / sampling.step)));
        let run = null,
          write = 0;
        const flush = () => {
          if (run && write > 1) {
            run.length = write;
            pieces.push(run);
          }
          run = null;
          write = 0;
        };
        for (let j = 0; j <= n; j++) {
          const u = j / n,
            x = a.x + (b.x - a.x) * u,
            y = a.y + (b.y - a.y) * u;
          if (Math.abs(x - cx) <= half) {
            if (!run) run = scratch ? acquireEffectPiece(scratch) : [];
            if (scratch) effectXYAt(run, write++, x, y);
            else {
              run.push({ x, y });
              write = run.length;
            }
          } else flush();
        }
        flush();
      }
    }
    return pieces;
  }
  if (mode === 'perSegment' || mode === 'everyNth') {
    const nth = Math.max(2, Math.min(24, Math.round(Number(cfg.lightningEveryN) || 2)));
    let global = 0;
    for (let pi = 0; pi < (paths || []).length; pi++) {
      const { table, segments } = getSweepSegmentsForPath(paths[pi], layer);
      for (const seg of segments) {
        const use = mode === 'perSegment' || global % nth === 0;
        const salt = global++;
        if (!use) continue;
        const len = Math.max(0.5, seg.length * frac),
          room = Math.max(0, seg.length - len),
          off = random ? sweepStableUnit(cycle * 4099 + salt * 131 + 17) * room : 0;
        const pts = sampleLightningRange(table, seg.start + off, len, 64, scratch, cfg);
        if (pts?.length > 1) pieces.push(pts);
      }
    }
    return pieces;
  }
  if (mode === 'perPath') {
    for (let pi = 0; pi < (paths || []).length; pi++) {
      const table = buildPathLengthTable([paths[pi]]);
      if (!(table.total > 0)) continue;
      const len = table.total * frac,
        room = Math.max(0, table.total - len),
        off = random ? sweepStableUnit(cycle * 4099 + pi * 271 + 31) * room : 0;
      const pts = sampleLightningRange(table, off, len, 96, scratch, cfg);
      if (pts?.length > 1) pieces.push(pts);
    }
    return pieces;
  }

  const infos = scratch ? scratch.infos : [];
  let total = 0;
  for (let pi = 0; pi < (paths || []).length; pi++) {
    const table = buildPathLengthTable([paths[pi]]);
    if (table.total > 0) {
      if (scratch) acquireEffectInfo(scratch, table, total, pi);
      else infos.push({ table, start: total, pi });
      total += table.total;
    }
  }
  if (!(total > 0)) return pieces;
  const len = total * frac,
    room = Math.max(0, total - len),
    off = random ? sweepStableUnit(cycle * 4099 + 73) * room : 0,
    end = off + len;
  for (const info of infos) {
    const a = Math.max(off, info.start),
      b = Math.min(end, info.start + info.table.total);
    if (b > a) {
      const pts = sampleLightningRange(info.table, a - info.start, b - a, 112, scratch, cfg);
      if (pts?.length > 1) pieces.push(pts);
    }
  }
  return pieces;
}
function getGlintVisualSettings(cfg = currentSweepConfig(), layerIndex = -1) {
  normalizeSweepConfig(cfg);
  const glowBase = Math.max(
    0,
    audioApplyNumeric('sweep.glow', Number.isFinite(Number(cfg.glow)) ? Number(cfg.glow) : 14.5, layerIndex),
  );
  const glowMultiplier = Math.max(
    0,
    Number.isFinite(Number(cfg.glowMultiplier)) ? Number(cfg.glowMultiplier) : 1,
  );
  const intensityBase = Math.max(
    0,
    Math.min(
      400,
      audioApplyNumeric(
        'sweep.glowIntensity',
        Number.isFinite(Number(cfg.glowIntensity)) ? Number(cfg.glowIntensity) : 100,
        layerIndex,
      ),
    ),
  );
  const intensityMultiplier = Math.max(
    0,
    Number.isFinite(Number(cfg.glowIntensityMultiplier)) ? Number(cfg.glowIntensityMultiplier) : 1,
  );

  const brightness = Math.max(
    0,
    Math.min(
      8,
      audioApplyNumeric(
        'sweep.brightness',
        Number.isFinite(Number(cfg.brightness)) ? Number(cfg.brightness) : 77,
        layerIndex,
      ) / 100,
    ),
  );
  const opacity =
    Math.max(
      0,
      Math.min(
        100,
        audioApplyNumeric(
          'sweep.opacity',
          Number.isFinite(Number(cfg.opacity)) ? Number(cfg.opacity) : 100,
          layerIndex,
        ),
      ),
    ) / 100;
  const softnessBase = Math.max(
    0,
    Math.min(
      150,
      audioApplyNumeric(
        'sweep.softness',
        Number.isFinite(Number(cfg.softness)) ? Number(cfg.softness) : 100,
        layerIndex,
      ),
    ),
  );
  const softnessMultiplier = Math.max(
    0,
    Number.isFinite(Number(cfg.softnessMultiplier)) ? Number(cfg.softnessMultiplier) : 1,
  );
  const softness = Math.max(0, Math.min(1.5, (softnessBase * softnessMultiplier) / 100));
  return {
    glowSize: Math.max(0, glowBase * glowMultiplier),
    strength: Math.max(0, (intensityBase / 100) * intensityMultiplier),
    brightness,
    softness,
    opacity,
  };
}
function getLightningVisualSettings(cfg = currentSweepConfig(), layerIndex = -1) {
  normalizeSweepConfig(cfg);
  const glowBase = Math.max(
    0,
    audioApplyNumeric(
      'lightning.glow',
      Number.isFinite(Number(cfg.lightningGlow)) ? Number(cfg.lightningGlow) : 16,
      layerIndex,
    ),
  );
  const glowMult = Math.max(
    0,
    Number.isFinite(Number(cfg.lightningGlowMultiplier)) ? Number(cfg.lightningGlowMultiplier) : 1,
  );
  const intensityBase = Math.max(
    0,
    audioApplyNumeric(
      'lightning.intensity',
      Number.isFinite(Number(cfg.lightningGlowIntensity)) ? Number(cfg.lightningGlowIntensity) : 100,
      layerIndex,
    ) / 100,
  );
  const intensityMult = Math.max(
    0,
    Number.isFinite(Number(cfg.lightningGlowIntensityMultiplier))
      ? Number(cfg.lightningGlowIntensityMultiplier)
      : 1,
  );
  // The former independent brightness control is retired: only the intensity-based 'Яркость' remains.
  const brightness = 1;
  const softnessBase = Math.max(
    0,
    audioApplyNumeric(
      'lightning.softness',
      Number.isFinite(Number(cfg.lightningSoftness)) ? Number(cfg.lightningSoftness) : 100,
      layerIndex,
    ),
  );
  const softnessMult = Math.max(
    0,
    Number.isFinite(Number(cfg.lightningSoftnessMultiplier)) ? Number(cfg.lightningSoftnessMultiplier) : 1,
  );
  return {
    glowSize: glowBase * glowMult,
    strength: Math.min(32, intensityBase * intensityMult),
    brightness,
    softness: Math.max(0, (softnessBase * softnessMult) / 100),
    linked: false,
    multiplier: 1,
  };
}
function getSweepMotionPhase(now = performance.now(), cfg = currentSweepConfig()) {
  if (!Number.isFinite(cfg.phase)) cfg.phase = 0;
  if (!Number.isFinite(cfg.cycleCount)) cfg.cycleCount = 0;
  const target = getSweepTargetVelocity(cfg);
  if (!(cfg.lastUpdate > 0)) {
    cfg.lastUpdate = now;
    cfg.currentVelocity = target;
    return ((cfg.phase % 1) + 1) % 1;
  }
  const dt = Math.max(0, (now - cfg.lastUpdate) / 1000);
  cfg.lastUpdate = now;

  let v0 = Number.isFinite(cfg.currentVelocity) ? cfg.currentVelocity : target;
  if (dt > 2) {
    cfg.currentVelocity = target;
    return ((cfg.phase % 1) + 1) % 1;
  }
  const tau = 0.32,
    e = Math.exp(-dt / tau),
    v1 = target + (v0 - target) * e,
    advance = target * dt + (v0 - target) * tau * (1 - e);
  cfg.currentVelocity = v1;
  const raw = cfg.phase + advance;
  if (advance >= 0 && raw >= 1) cfg.cycleCount += Math.floor(raw);
  else if (advance < 0 && raw < 0) cfg.cycleCount += Math.ceil(-raw);
  cfg.phase = ((raw % 1) + 1) % 1;
  return cfg.phase;
}
function getLightningRateFactor(cfg = currentSweepConfig(), layerIndex = -1) {
  const rawPct = audioApplyNumeric(
    'lightning.rate',
    Number.isFinite(Number(cfg.lightningRatePercent)) ? Number(cfg.lightningRatePercent) : 100,
    layerIndex,
  );
  const pct = Math.max(0, Math.min(100, Number.isFinite(Number(rawPct)) ? Number(rawPct) : 100));
  const rawMult = Number(cfg.lightningRateMultiplier);
  // UI multiplier controls the strike INTERVAL, not the Hz frequency.
  const intervalMultiplier = Number.isFinite(rawMult) && rawMult > 0 ? rawMult : 1;

  return pct / 100 / intervalMultiplier;
}
const lightningClockRuntimeByLayer = new Map();
const lightningSharedClockRuntime = { phase: 0, lastUpdate: 0, cycleCount: 0, rateConfig: null };
// Legacy fractional multipliers are displayed exactly; a numeric input replaces the binary selector.
function setLightningBinarySelectValue(input, value) {
  const n = Number(value);
  input.value = String(Number.isFinite(n) && n > 0 ? n : 1);
}
function formatLightningMultiplier(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? String(Number(n.toPrecision(8))) : '1';
}
function lightningRateSyncEnabled() {
  return state.lightningRateSync !== false;
}
function normalizeLightningRatePercent(value) {
  const v = Number(value);
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 100;
}
function normalizeLightningRateMultiplier(value) {
  const v = Number(value);
  return Number.isFinite(v) ? Math.max(0, v) : 8;
}
function captureLightningSyncRateConfig(cfg = currentSweepConfig()) {
  const source = cfg && typeof cfg === 'object' ? cfg : state.sweep;
  const snap = {
    speed: Math.max(0.02, Math.min(2, Number(source?.speed) || 0.25)),
    speedMultiplier: Math.max(0.015625, Math.min(64, Number(source?.speedMultiplier) || 1)),
    syncMusic: source?.syncMusic !== false,
    direction: source?.direction === 'backward' ? 'backward' : 'forward',
    lightningRatePercent: normalizeLightningRatePercent(source?.lightningRatePercent),
    lightningRateMultiplier: normalizeLightningRateMultiplier(source?.lightningRateMultiplier),
  };
  lightningSharedClockRuntime.rateConfig = snap;
  return snap;
}
function syncLightningRateValuesFrom(cfg = currentSweepConfig()) {
  const pct = normalizeLightningRatePercent(cfg?.lightningRatePercent),
    mult = normalizeLightningRateMultiplier(cfg?.lightningRateMultiplier);
  if (state.sweep && typeof state.sweep === 'object') {
    state.sweep.lightningRatePercent = pct;
    state.sweep.lightningRateMultiplier = mult;
  }
  for (const layer of state.layers || []) {
    const c = getLayerSweepConfig(layer);
    c.lightningRatePercent = pct;
    c.lightningRateMultiplier = mult;
  }
  const snap = captureLightningSyncRateConfig(cfg);
  snap.lightningRatePercent = pct;
  snap.lightningRateMultiplier = mult;
  return snap;
}
// 7.11.14: slow the *strike clock*, not the authored percent/multiplier.
// Both synchronized and independent clocks call this function; the moving
// Glint/Sweep clock is intentionally unchanged.
const LIGHTNING_STRIKE_CLOCK_FACTOR = 0.25;
function getLightningCycleRateHz(cfg = currentSweepConfig(), layerIndex = -1) {
  const baseHz = Math.abs(getSweepTargetVelocity(cfg));
  return Math.max(0, baseHz * getLightningRateFactor(cfg, layerIndex) * LIGHTNING_STRIKE_CLOCK_FACTOR);
}
function getSynchronizedLightningCycleRateHz(fallbackCfg = currentSweepConfig()) {
  const cfg = lightningSharedClockRuntime.rateConfig || captureLightningSyncRateConfig(fallbackCfg);
  return getLightningCycleRateHz(cfg, -1);
}
function resetLightningSharedClock(phase = 0, cycleCount = 0) {
  lightningSharedClockRuntime.phase = (((Number(phase) || 0) % 1) + 1) % 1;
  lightningSharedClockRuntime.lastUpdate = 0;
  lightningSharedClockRuntime.cycleCount = Math.max(0, Math.round(Number(cycleCount) || 0));
}
function resetLightningClock(layerIndex = -1, cfg = null, phase = 0) {
  const key =
    Number.isInteger(layerIndex) && layerIndex >= 0
      ? layerIndex
      : cfg && typeof cfg === 'object'
        ? cfg
        : 'default';
  const p = (((Number(phase) || 0) % 1) + 1) % 1;
  lightningClockRuntimeByLayer.set(key, { phase: p, lastUpdate: 0, cycleCount: 0 });
  if (cfg && typeof cfg === 'object') {
    cfg.lightningPhase = p;
    cfg.lightningLastUpdate = 0;
    cfg.lightningCycleCount = 0;
  }
}
function setLightningRateSynchronization(enabled, cfg = currentSweepConfig(), layerIndex = -1) {
  const next = enabled === true,
    prev = lightningRateSyncEnabled();
  if (next === prev) {
    state.lightningRateSync = next;
    if (next) syncLightningRateValuesFrom(cfg);
    return next;
  }
  if (next) {
    const key =
      Number.isInteger(layerIndex) && layerIndex >= 0
        ? layerIndex
        : cfg && typeof cfg === 'object'
          ? cfg
          : 'default';
    const rt = lightningClockRuntimeByLayer.get(key);
    const phase = rt ? rt.phase : (((Number(cfg?.lightningPhase) || 0) % 1) + 1) % 1;
    const cycles = rt ? rt.cycleCount : Math.max(0, Math.round(Number(cfg?.lightningCycleCount) || 0));
    state.lightningRateSync = true;
    syncLightningRateValuesFrom(cfg);
    resetLightningSharedClock(phase, cycles);
  } else {
    const phase = lightningSharedClockRuntime.phase,
      cycles = lightningSharedClockRuntime.cycleCount;
    state.lightningRateSync = false;
    lightningClockRuntimeByLayer.clear();
    for (let i = 0; i < (state.layers || []).length; i++) {
      const c = getLayerSweepConfig(state.layers[i]);
      lightningClockRuntimeByLayer.set(i, { phase, lastUpdate: 0, cycleCount: cycles });
      c.lightningPhase = phase;
      c.lightningLastUpdate = 0;
      c.lightningCycleCount = cycles;
    }
  }
  return next;
}
function resetLightningRateRuntimeForProject(syncSource = null) {
  lightningClockRuntimeByLayer.clear();
  lightningSharedClockRuntime.rateConfig = null;
  const source =
    syncSource && typeof syncSource === 'object' ? syncSource : state.sweep || createDefaultSweepConfig();
  const phase = (((Number(source?.lightningPhase) || 0) % 1) + 1) % 1,
    cycles = Math.max(0, Math.round(Number(source?.lightningCycleCount) || 0));
  resetLightningSharedClock(phase, cycles);
  if (lightningRateSyncEnabled()) syncLightningRateValuesFrom(source);
  else captureLightningSyncRateConfig(source);
}
function advanceLightningClock(rt, now, rateHz) {
  if (!(rateHz > 1e-7)) {
    rt.phase = 0;
    rt.lastUpdate = now;
    return rt.phase;
  }
  if (!(rt.lastUpdate > 0)) {
    rt.lastUpdate = now;
    return rt.phase;
  }
  const dt = Math.max(0, (now - rt.lastUpdate) / 1000);
  rt.lastUpdate = now;

  if (dt > 2) return rt.phase;
  const raw = rt.phase + rateHz * dt,
    wraps = Math.floor(raw);
  if (wraps > 0) rt.cycleCount += wraps;
  rt.phase = raw - wraps;
  return rt.phase;
}
// v9.0.6: Lightning follows the authoritative musical/effect cycle.
// "morph" = priority Glint > Blue/Orange Morph > timer. The two explicit
// alternatives are strict: no silent fallback when their source stops.
function getLightningTriggerSource(cfg = currentSweepConfig()) {
  const mode = ['timer', 'morph', 'glint'].includes(cfg?.lightningTriggerMode)
    ? cfg.lightningTriggerMode
    : 'morph';
  if (mode === 'timer') return 'timer';
  if (mode === 'glint') return cfg?.glintEnabled === true ? 'glint' : 'off';
  if (cfg?.glintEnabled === true) return 'glint';
  // Orange owns the visible composition while Blue is paused for its transition.
  if (
    runtimeState?.minimalMorph?.active === true &&
    (runtimeState.minimalMorph.transitioning === true || runtimeState.morph?.pausedByOrangeProject === true)
  )
    return 'orange';
  if (runtimeState?.morph?.active === true) return 'morph';
  if (runtimeState?.minimalMorph?.active === true) return 'orange';
  return 'timer';
}
function getLightningEffectiveCycleRateHz(cfg = currentSweepConfig(), layerIndex = -1) {
  const source = getLightningTriggerSource(cfg);
  if (source === 'glint')
    return Math.abs(getSweepTargetVelocity(cfg)) * getLightningRateFactor(cfg, layerIndex);
  if (source === 'morph')
    return (
      getLightningRateFactor(cfg, layerIndex) /
      Math.max(0.1, getTapMorphIntervalSec(state.morph.intervalSec, 'full'))
    );
  if (source === 'orange')
    return (
      getLightningRateFactor(cfg, layerIndex) /
      Math.max(0.1, getTapMorphIntervalSec(state.minimalMorph.intervalSec, 'minimal'))
    );
  if (source === 'off') return 0;
  return lightningRateSyncEnabled()
    ? getSynchronizedLightningCycleRateHz(cfg)
    : getLightningCycleRateHz(cfg, layerIndex);
}
const lightningSourceCycleTracker = new WeakMap();
function gateLightningGlintCycle(cfg, layerIndex, phase, cycle) {
  const authored = state.layers?.[layerIndex],
    owner = authored ? getLayerSweepConfig(authored) : cfg;
  let rt = lightningSourceCycleTracker.get(owner);
  if (!rt || rt.source !== 'glint' || cycle < rt.firstCycle) {
    rt = { source: 'glint', firstCycle: cycle };
    lightningSourceCycleTracker.set(owner, rt);
  }
  // A Glint strike is caused by the *completed* revolution, not
  // by merely enabling Glint at phase zero or halfway round.
  return cycle > rt.firstCycle ? phase : 1;
}
function getLightningTriggerPhase(now, cfg, layerIndex, source) {
  if (source === 'off') return { phase: 1, cycle: 0 };
  if (source === 'glint') {
    // Glint owns its continuous phase; advancing it here also fixes the
    // previous scheduler early-continue with Glint + Lightning together.
    const phase = getSweepMotionPhase(now, cfg);
    const cycle = Math.max(0, Number(cfg.cycleCount) || 0);
    return { phase: gateLightningGlintCycle(cfg, layerIndex, phase, cycle), cycle };
  }
  if (source === 'morph') {
    const rt = runtimeState.morph;
    if (
      rt?.paused === true ||
      rt?.pausedByOrangeProject === true ||
      rt?.pausedByGreenProject === true ||
      !Number(rt?.cycleStart)
    )
      return { phase: 1, cycle: 0 };
    const cycleMs = Math.max(100, getTapMorphIntervalSec(state.morph.intervalSec, 'full') * 1000);
    return {
      phase: Math.max(0, Math.min(1, (now - rt.cycleStart) / cycleMs)),
      cycle: Math.max(0, Number(rt.lampCycleSerial) || 0),
    };
  }
  if (source === 'orange') {
    const rt = runtimeState.minimalMorph;
    if (rt?.paused === true) return { phase: 1, cycle: 0 };
    const cycleMs = Math.max(100, getTapMorphIntervalSec(state.minimalMorph.intervalSec, 'minimal') * 1000);
    const remaining = Number(rt?.nextSwitchAt) - now;
    if (!Number.isFinite(remaining) || !Number.isFinite(Number(rt?.nextSwitchAt)))
      return { phase: 1, cycle: 0 };
    return {
      phase: Math.max(0, Math.min(1, 1 - remaining / cycleMs)),
      cycle: Math.max(0, Number(rt?.cycleCount) || 0),
    };
  }
  return { phase: 1, cycle: 0 };
}
function getLightningMotionPhase(now = performance.now(), cfg = currentSweepConfig(), layerIndex = -1) {
  const source = getLightningTriggerSource(cfg);
  if (source !== 'timer') {
    const authored = state.layers?.[layerIndex],
      owner = authored ? getLayerSweepConfig(authored) : cfg;
    if (source !== 'glint') lightningSourceCycleTracker.delete(owner);
    const p = getLightningTriggerPhase(now, cfg, layerIndex, source);
    // Keep the source cycle as the phase origin but apply the user's
    // interval multiplier within it. An interval of 0.5 produces two
    // lightning strikes per source cycle rather than silently doing nothing.
    const rate = getLightningRateFactor(cfg, layerIndex);
    const scaled = rate > 0 && p.phase < 1 ? Math.max(0, (p.cycle + p.phase) * rate) : null;
    const phase = scaled === null ? 1 : scaled - Math.floor(scaled);
    if (cfg) {
      cfg.lightningPhase = phase;
      cfg.lightningLastUpdate = now;
      cfg.lightningCycleCount = scaled === null ? p.cycle : Math.floor(scaled);
    }
    return phase;
  }
  {
    const authored = state.layers?.[layerIndex],
      owner = authored ? getLayerSweepConfig(authored) : cfg;
    lightningSourceCycleTracker.delete(owner);
  }
  if (lightningRateSyncEnabled()) {
    const rt = lightningSharedClockRuntime,
      phase = advanceLightningClock(rt, now, getSynchronizedLightningCycleRateHz(cfg));
    if (cfg) {
      cfg.lightningPhase = phase;
      cfg.lightningLastUpdate = now;
      cfg.lightningCycleCount = rt.cycleCount;
    }
    return phase;
  }
  const key =
    Number.isInteger(layerIndex) && layerIndex >= 0
      ? layerIndex
      : cfg && typeof cfg === 'object'
        ? cfg
        : 'default';
  let rt = lightningClockRuntimeByLayer.get(key);
  if (!rt) {
    rt = {
      phase: (((Number(cfg?.lightningPhase) || 0) % 1) + 1) % 1,
      lastUpdate: 0,
      cycleCount: Math.max(0, Math.round(Number(cfg?.lightningCycleCount) || 0)),
    };
    lightningClockRuntimeByLayer.set(key, rt);
  }
  const phase = advanceLightningClock(rt, now, getLightningCycleRateHz(cfg, layerIndex));
  if (cfg) {
    cfg.lightningPhase = phase;
    cfg.lightningLastUpdate = now;
    cfg.lightningCycleCount = rt.cycleCount;
  }
  return phase;
}
function lightningPiecesPath(pieces) {
  const path = new Path2D();
  for (const pts of pieces || []) {
    if (!pts || pts.length < 2) continue;
    path.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
  }
  return path;
}
// Lightning colors an already prepared profile. Its 1px arc-length sampling is
// useful for selecting the strike, but uploading every collinear sample as a
// separate GPU quad wastes both CPU time and GPU bandwidth. Simplify ONLY the
// strike copy, never the authoritative contour or the base stroke. Preserve
// the endpoints and all bends within a sub-pixel error bound.
const lightningSimplifyStack = [];
const lightningSimplifyMarks = [];
const lightningSimplifyOutput = [];
function simplifyLightningStrokePieces(pieces, precision = 'exact') {
  if (!Array.isArray(pieces)) return pieces;
  const tolerance = precision === 'exact' ? 0.075 : 0.18,
    eps2 = tolerance * tolerance;
  for (const pts of pieces) {
    if (!Array.isArray(pts) || pts.length < 3) continue;
    const n = pts.length,
      marks = lightningSimplifyMarks,
      stack = lightningSimplifyStack,
      out = lightningSimplifyOutput;
    marks.length = n;
    marks.fill(false);
    marks[0] = true;
    marks[n - 1] = true;
    stack.length = 0;
    stack.push(0, n - 1);
    while (stack.length) {
      const end = stack.pop(),
        start = stack.pop(),
        a = pts[start],
        b = pts[end];
      const ax = Number(a?.x) || 0,
        ay = Number(a?.y) || 0,
        bx = Number(b?.x) || 0,
        by = Number(b?.y) || 0;
      const dx = bx - ax,
        dy = by - ay,
        len2 = dx * dx + dy * dy;
      let greatest = eps2,
        index = -1;
      for (let i = start + 1; i < end; i++) {
        const p = pts[i],
          px = (Number(p?.x) || 0) - ax,
          py = (Number(p?.y) || 0) - ay;
        const t = len2 > 1e-15 ? Math.max(0, Math.min(1, (px * dx + py * dy) / len2)) : 0;
        const ex = px - t * dx,
          ey = py - t * dy,
          dist2 = ex * ex + ey * ey;
        if (dist2 > greatest) {
          greatest = dist2;
          index = i;
        }
      }
      if (index >= 0) {
        marks[index] = true;
        stack.push(start, index, index, end);
      }
    }
    out.length = 0;
    for (let i = 0; i < n; i++) if (marks[i]) out.push(pts[i]);
    if (out.length < n) {
      pts.length = out.length;
      for (let i = 0; i < out.length; i++) pts[i] = out[i];
    }
  }
  return pieces;
}
const lightningPreparedCache = new WeakMap();
let lightningPreparedFrame = null;
function getPreparedLightningFrame(paths, layer, now, cfg = currentSweepConfig(layer), layerIndex = -1) {
  const cycleKey = cfg.lightningRandomPosition === true ? Number(cfg.lightningCycleCount) || 0 : 0;
  const signature = [
    cfg.lightningMode,
    cfg.lightningEveryN,
    cfg.lightningRandomPosition ? 1 : 0,
    cfg.lightningSegmentPercent,
    normalizeLightningPrecisionValue(cfg.lightningPrecision),
    cycleKey,
    layer?.N,
    layer?.K,
  ].join('|');
  const sameFrame = lightningPreparedFrame;
  if (
    sameFrame &&
    sameFrame.now === now &&
    sameFrame.paths === paths &&
    sameFrame.layer === layer &&
    sameFrame.signature === signature
  )
    return sameFrame;

  const dynamicFramePaths =
    frameGeometryRuntime.active && Number(paths?._frameGeometryId) === frameGeometryRuntime.frameId;
  if (dynamicFramePaths) {
    const scratch = getLightningDynamicScratch(layer);
    const visible =
      paths?.__somataFrameContour === true || paths?._lightningRenderedRail === true
        ? paths
        : prepareWebVisiblePaths(paths, layer);
    const exact =
      paths?._exactLightningSplineRail === true
        ? exactLightningSelection(visible, layer, cfg, layerIndex)
        : null;
    const pieces = simplifyLightningStrokePieces(
      exact?.pieces || getLightningModePieces(visible, layer, scratch, cfg, layerIndex),
      normalizeLightningPrecisionValue(cfg.lightningPrecision),
    );
    const data = scratch.data;
    data.now = now;
    data.paths = paths;
    data.layer = layer;
    data.signature = signature;
    data.visible = visible;
    data.pieces = pieces;
    data.exactRanges = exact?.ranges || null;
    data.strikePath = exact?.strikePath || lightningPiecesPath(pieces);
    data._insideClipPath = undefined;
    data._outsideClipPath = undefined;
    lightningPreparedFrame = data;
    return data;
  }

  let cached = lightningPreparedCache.get(paths);
  if (cached && cached.layer === layer && cached.signature === signature) {
    cached.now = now;
    lightningPreparedFrame = cached;
    return cached;
  }
  const visible =
    paths?.__somataFrameContour === true || paths?._lightningRenderedRail === true
      ? paths
      : prepareWebVisiblePaths(paths, layer);
  const exact =
    paths?._exactLightningSplineRail === true
      ? exactLightningSelection(visible, layer, cfg, layerIndex)
      : null;
  const pieces = simplifyLightningStrokePieces(
    exact?.pieces || getLightningModePieces(visible, layer, null, cfg, layerIndex),
    normalizeLightningPrecisionValue(cfg.lightningPrecision),
  );
  const data = {
    now,
    paths,
    layer,
    signature,
    visible,
    pieces,
    exactRanges: exact?.ranges || null,
    strikePath: exact?.strikePath || lightningPiecesPath(pieces),
  };
  lightningPreparedCache.set(paths, data);
  lightningPreparedFrame = data;
  return data;
}
// The entire strike has ONE geometry. Micro-strikes are brightness samples
// on that same stroke, not independently constructed/rasterized contours.
// Only neighboring pulse centers can contribute to a given time sample;
// this stays O(1) even with extreme automated strike counts.
function collectLightningMicroPulses(t, count, target = []) {
  target.length = 0;
  const raw = Number(count),
    n = Number.isFinite(raw) ? Math.max(0, Math.min(1000000, Math.round(raw))) : 0;
  if (!n) return target;
  const centerIndex = t * (n + 1) - 1;
  const nearest = Math.max(0, Math.min(n - 1, Math.round(centerIndex)));
  let bestIntensity = 0,
    bestIndex = -1;
  for (let i = Math.max(0, nearest - 1); i <= Math.min(n - 1, nearest + 1); i++) {
    const center = (i + 1) / (n + 1);
    const pulse = Math.exp(-Math.pow((t - center) / 0.055, 2)) * Math.pow(1 - center * 0.42, 1.2) * 0.88;
    if (pulse > bestIntensity) {
      bestIntensity = pulse;
      bestIndex = i;
    }
  }
  if (bestIntensity > 0.015) target.push({ index: bestIndex, intensity: bestIntensity });
  return target;
}
// Single strike envelope. The multiplier changes the duration, not the number of GPU passes.
function lightningStrikeDurationMs(cfg, layerIndex = -1) {
  const base = audioApplyNumeric('lightning.duration', Number(cfg.lightningDurationMs) || 480, layerIndex);
  const multiplier = Number(cfg.lightningDurationMultiplier);
  return Math.max(
    1,
    Math.min(
      30000,
      Math.max(0, Number(base) || 0) * (Number.isFinite(multiplier) && multiplier > 0 ? multiplier : 1),
    ),
  );
}
function lightningActiveCycleFraction(cfg, layerIndex = -1) {
  const hz = Math.max(0.000001, getLightningEffectiveCycleRateHz(cfg, layerIndex));
  const cycleMs = 1000 / hz;
  return Math.max(0.002, Math.min(0.94, lightningStrikeDurationMs(cfg, layerIndex) / cycleMs));
}
function prepareLightningVectorFrame(
  layer,
  phase,
  prepared,
  layerIndex = -1,
  cfg = currentSweepConfig(layer),
) {
  const gpuArcResident = prepared?.gpuArcResident === true;
  if (!gpuArcResident && !prepared?.pieces?.length) return null;
  normalizeSweepConfig(cfg);
  const idx = Number.isInteger(layerIndex) ? layerIndex : -1;
  const baseW = Math.max(
    0.5,
    audioApplyNumeric('layer.strokeWidth', Number(layer?.strokeWidth) || 1.5, idx) *
      getLayerStrokeWidthMultiplier(layer),
  );
  const widthPct = Math.max(
    1,
    Math.min(100, audioApplyNumeric('lightning.width', Number(cfg.lightningWidthPercent) || 64, idx)),
  );
  const widthMult = Math.max(
    0,
    Number.isFinite(Number(cfg.lightningWidthMultiplier)) ? Number(cfg.lightningWidthMultiplier) : 1,
  );
  const boltW = Math.max(0.2, ((baseW * widthPct) / 100) * widthMult),
    strikeVis = getLightningVisualSettings(cfg, idx);
  const glow = strikeVis.glowSize,
    glowIntensity = Math.min(32, strikeVis.strength),
    brightness = Math.max(0, strikeVis.brightness),
    softness = strikeVis.softness;
  const lineOpacity = Math.max(
    0,
    Math.min(
      1,
      audioApplyNumeric(
        'lightning.lineOpacity',
        Number.isFinite(Number(cfg.lightningLineOpacity)) ? Number(cfg.lightningLineOpacity) : 100,
        idx,
      ) / 100,
    ),
  );
  const velocity = Math.max(0.000001, getLightningEffectiveCycleRateHz(cfg, idx));
  const cycleMs = 1000 / velocity;
  const strikeFrac = Math.max(0.002, Math.min(0.94, lightningStrikeDurationMs(cfg, idx) / cycleMs));
  // No precharge or trailing afterglow; only the visible strike uses GPU time.
  const strikeEnd = strikeFrac;
  const out = {
    prepared,
    phase,
    cfg,
    baseW,
    boltW,
    glow,
    glowIntensity,
    brightness,
    softness,
    lineOpacity,
    smoothLighting: cfg.lightningSmoothLighting === true,
    precisionHigh: isHighPrecisionLightning(cfg),
    primary: cfg.lightningColor || '#ffffff',
    secondary: cfg.lightningSecondaryColor || '#7dd3fc',
    strikePath: prepared.strikePath || (gpuArcResident ? null : lightningPiecesPath(prepared.pieces)),
    showBase: cfg.lightningShowLines !== false && getLayerLineVisible(layer) === false,
    stage: 'idle',
    intensity: 0,
    microPulses: [],
  };
  if (phase < strikeEnd) {
    const t = Math.max(0, Math.min(1, phase / Math.max(1e-6, strikeFrac)));
    const attack = lightningSmooth01(Math.min(1, t / 0.16)),
      release = lightningSmooth01(Math.min(1, (1 - t) / 0.24));
    const count = Math.max(
      0,
      Math.round(audioApplyNumeric('lightning.microStrikes', Number(cfg.lightningMicroStrikes) || 0, idx)),
    );
    // Microstrikes modulate the same stroke, rather than creating N duplicate GPU strokes.
    collectLightningMicroPulses(t, count, out.microPulses);
    let peak = null;
    for (const pulse of out.microPulses) if (!peak || pulse.intensity > peak.intensity) peak = pulse;
    out.microIndex = peak ? peak.index : -1;
    out.stage = 'strike';
    out.intensity = Math.max(
      0,
      Math.min(1, attack * release * (count > 0 ? 0.32 + 0.82 * Number(peak?.intensity || 0) : 1)),
    );
    return out;
  }
  return out;
}

export {
  formatLightningMultiplier,
  getGlintVisualSettings,
  getLightningEffectiveCycleRateHz,
  getLightningMotionPhase,
  getLightningTriggerSource,
  getLightningVisualSettings,
  getPreparedLightningFrame,
  getSweepMotionPhase,
  lightningActiveCycleFraction,
  lightningRateSyncEnabled,
  prepareLightningVectorFrame,
  resetLightningClock,
  resetLightningRateRuntimeForProject,
  setLightningBinarySelectValue,
  setLightningRateSynchronization,
  syncLightningRateValuesFrom,
};
