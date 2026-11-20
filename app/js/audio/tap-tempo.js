// Tap tempo: ручной и автоматический темп, сетка долей, синхронизация морфов.
import '../morph-runtime/morph-hooks.js'; // initialisation order: this module runs after it
import { syncSweepUI } from '../ui/effects-sidebar.js';
import { runtimeState, state } from '../core/state.js';
import { formatDisplayNumber } from '../ui/geometry-n-control.js';
import { activeRebaseMorphing } from '../morph-runtime/morph-hooks.js';
import { capturePlaylistOverridesFromCurrent } from '../project/project-data.js';
import {
  getProjectMorphDurationSec,
  normalizeProjectMorphSettings,
  syncProjectMorphUI,
} from '../project/project-morph.js';
import { positionFloatingPanelNearTrigger } from '../ui/floating-panels.js';
import {
  getActiveAudioBandKeys,
  getAudioBandRangesForAnalysis,
  startAudioReactive,
} from './audio-reactive.js';

function getTapTempoIntervalSec(fallbackSec = 5) {
  const tap = state.tapTempo;
  const bpm = Math.max(0, Number(tap?.bpm) || 0);
  if (bpm <= 0) return Math.max(0.1, Number(fallbackSec) || 5);
  const beats = Math.max(1, Math.min(64, Math.round(Number(tap.beatsPerMorph) || 16)));
  return (beats * 60) / bpm;
}
function isTapMorphSyncActive(kind = 'full') {
  const tap = state.tapTempo;
  if (!(Number(tap?.bpm) > 0)) return false;
  return kind === 'minimal' ? tap.syncMinimalMorph === true : tap.syncFullMorph === true;
}
function getMorphIntervalMultiplier(kind = 'full') {
  const v = Number(
    kind === 'minimal' ? state.minimalMorph?.intervalMultiplier : state.morph?.intervalMultiplier,
  );
  return Number.isFinite(v) ? Math.max(0.015625, Math.min(64, v)) : 1;
}
function getTapMorphIntervalSec(fallbackSec, kind = 'full') {
  const base = isTapMorphSyncActive(kind)
    ? getTapTempoIntervalSec(fallbackSec)
    : Math.max(0.1, Number(fallbackSec) || 5);
  return base * getMorphIntervalMultiplier(kind);
}
// Single source of truth for Geometry-panel edits synchronized to Blue.
// A full cycle includes any TAP timing and the Morph time multiplier.
// The cycleStart changes ONLY when Blue prepares a new phase (or a
// deliberate rebase); a manual edit must not move that boundary.
function blueOrderPhaseDurationMs(baseMs) {
  return Math.max(baseMs, Number(runtimeState.morph?.orderRailMinimumMs) || 0);
}
function sampleBlueSpiralOrder(layer, from, to, progress, withCorridor) {
  const zero = window.SomataSpiralZeroTransition,
    rt = runtimeState.morph;
  const phaseMs = Number(rt.transitionMs) || 1000;
  const duration = rt.orderRailDurations?.get(layer?.id) ?? zero.durationMs(layer, phaseMs);
  return zero.blueOrder(zero.modeFor(layer), from, to, progress, withCorridor, phaseMs, duration);
}
window.__somataSampleBlueSpiralOrder = sampleBlueSpiralOrder;
window.__somataBlueMorphPhaseClock = () => {
  const r = runtimeState.morph;
  return {
    active: r?.active === true,
    paused: r?.paused === true || r?.pausedByOrangeProject === true,
    phaseStart: Number(r?.cycleStart) || 0,
    durationMs: blueOrderPhaseDurationMs(
      Math.max(100, getTapMorphIntervalSec(state.morph.intervalSec, 'full') * 1000),
    ),
    phaseSerial: Number(r?.phaseSerial) || 0,
  };
};
function getNextTapBoundary(now = performance.now(), kind = 'minimal') {
  const tap = state.tapTempo;
  if (!isTapMorphSyncActive(kind) || !(tap.anchorTime > 0)) return now;
  const fallback = kind === 'minimal' ? state.minimalMorph.intervalSec : state.morph.intervalSec;
  const cycleMs = getTapMorphIntervalSec(fallback, kind) * 1000;
  const elapsed = Math.max(0, now - tap.anchorTime);
  const cycles = Math.floor(elapsed / cycleMs) + 1;
  return tap.anchorTime + cycles * cycleMs;
}
function syncTapTimingIndicators() {
  const fullAuto = isTapMorphSyncActive('full');
  const minimalAuto = isTapMorphSyncActive('minimal');
  document.getElementById('morphAutoBadge')?.classList.toggle('hidden', !fullAuto);
  document.getElementById('minimalMorphAutoBadge')?.classList.toggle('hidden', !minimalAuto);
  const fullInput = document.getElementById('morphInterval');
  const minimalInput = document.getElementById('minimalMorphInterval');
  if (fullInput)
    fullInput.value = formatDisplayNumber(
      fullAuto ? getTapTempoIntervalSec(state.morph.intervalSec) : state.morph.intervalSec,
      2,
    );
  const fullMult = document.getElementById('morphIntervalMultiplier');
  if (fullMult && document.activeElement !== fullMult)
    fullMult.value = formatDisplayNumber(getMorphIntervalMultiplier('full'), 6);
  const orangeMult = document.getElementById('minimalMorphIntervalMultiplier');
  if (orangeMult && document.activeElement !== orangeMult)
    orangeMult.value = formatDisplayNumber(getMorphIntervalMultiplier('minimal'), 6);
  if (minimalInput)
    minimalInput.value = formatDisplayNumber(
      minimalAuto ? getTapTempoIntervalSec(state.minimalMorph.intervalSec) : state.minimalMorph.intervalSec,
      2,
    );
  const syncedDuration = document.getElementById('testMorphDuration');
  if (syncedDuration?.disabled && document.getElementById('testMorphSyncWithMorph')?.checked) {
    syncedDuration.value = formatDisplayNumber(getTapMorphIntervalSec(state.morph.intervalSec, 'full'), 2);
  }
}
function restartTapPulseAnimation() {
  const btn = document.getElementById('btnTapTempo');
  if (!btn || !(state.tapTempo.bpm > 0)) return;
  btn.classList.remove('tempo-active');
  void btn.offsetWidth;
  btn.classList.add('tempo-active');
}
function syncTapUI() {
  const tap = state.tapTempo;
  const btn = document.getElementById('btnTapTempo');
  const beats = document.getElementById('tapBeatsPerMorph');
  const auto = document.getElementById('tapAutoEnabled');
  const autoWindow = document.getElementById('tapAutoWindowSec');
  const autoBand = document.getElementById('tapAutoBand');
  const autoStatus = document.getElementById('tapAutoStatus');
  const listenBtn = document.getElementById('btnAutoTapListen');
  const status = document.getElementById('tapSettingsStatus');
  const bpm = Math.max(0, Number(tap.bpm) || 0);
  if (state.playlistOverridesActive && !state.suppressPlaylistOverrideCapture) state.playlistBpm = bpm;
  if (beats) beats.value = String(Math.max(1, Math.min(64, Math.round(Number(tap.beatsPerMorph) || 16))));
  if (auto) auto.checked = !!tap.autoTap;
  if (autoWindow) autoWindow.value = String(Math.max(1, Number(tap.autoWindowSec) || 10));
  if (autoBand) {
    const available = getActiveAudioBandKeys();
    const signature = available.join(',');
    if (autoBand.dataset.activeBands !== signature) {
      const bandLabels = {
        low: 'Низкие',
        lowMid: 'Нижние средние',
        mid: 'Средние',
        midHigh: 'Средне-высокие',
        high: 'Высокие',
      };
      autoBand.replaceChildren(
        ...available.map((key) => {
          const option = document.createElement('option');
          option.value = key;
          option.textContent = bandLabels[key];
          return option;
        }),
      );
      autoBand.dataset.activeBands = signature;
    }
    if (!available.includes(tap.autoBand)) tap.autoBand = available[0];
    autoBand.value = tap.autoBand;
  }
  if (btn) {
    btn.textContent = bpm > 0 ? `${Math.round(bpm)} BPM` : 'TAP';
    btn.style.setProperty('--tap-beat-ms', `${bpm > 0 ? 60000 / bpm : 500}ms`);
    btn.classList.toggle('tempo-active', bpm > 0);
  }
  const bandNames = {
    low: 'НЧ',
    lowMid: 'нижние СЧ',
    mid: 'СЧ',
    midHigh: 'средне-высокие',
    high: 'ВЧ',
    combined: 'весь спектр',
  };
  const autoBandName = bandNames[tap.autoBand] || bandNames.combined;
  const chosenBandName = bandNames[tap.autoChosenBand] || '';
  const autoWindowSec = Math.max(1, Number(tap.autoWindowSec) || 10);
  if (autoStatus) {
    const conf = Math.max(0, Math.min(1, Number(tap.autoConfidence) || 0));
    autoStatus.textContent = tap.autoTap
      ? state.audioReactive.active
        ? `${{ ACQUIRE: 'ПОИСК', LOCKED: 'LOCK', HOLD: 'HOLD', CHANGE_PENDING: 'ПРОВЕРКА' }[tap.autoTempoLock?.mode] || 'ПОИСК'}${chosenBandName ? ` · ${chosenBandName}` : ''}${conf > 0 ? ` · ${Math.round(conf * 100)}%` : ''}`
        : 'ждёт аудио'
      : 'выкл.';
  }
  if (listenBtn) {
    listenBtn.classList.toggle('active', !!tap.autoTap);
    listenBtn.setAttribute('aria-pressed', tap.autoTap ? 'true' : 'false');
    listenBtn.title = tap.autoTap
      ? 'Auto-TAP включён — нажмите, чтобы отключить автоматическое определение BPM'
      : 'Слушать музыку и автоматически определять TAP/BPM';
  }
  if (status) {
    status.textContent =
      bpm > 0
        ? `${Math.round(bpm)} BPM · смена каждые ${tap.beatsPerMorph} долей (${formatDisplayNumber(getTapTempoIntervalSec(5), 2)} с). Auto-TAP: все диапазоны, приоритет ${autoBandName}${chosenBandName ? `, выбран ${chosenBandName}` : ''}, окно ${formatDisplayNumber(autoWindowSec, 1)} с.`
        : `Нажмите TAP несколько раз в ритм. Auto-TAP одновременно анализирует все диапазоны; приоритет ${autoBandName}, окно ${formatDisplayNumber(autoWindowSec, 1)} с.`;
  }
  syncTapTimingIndicators();
  syncProjectMorphUI();
  syncSweepUI();
}
function resyncMorphsToTapTempo() {
  const tap = state.tapTempo;
  if (!(tap.bpm > 0)) return;
  const now = performance.now();

  if (runtimeState.morph.active && isTapMorphSyncActive('full')) {
    const cycleMs = blueOrderPhaseDurationMs(
      Math.max(100, getTapMorphIntervalSec(state.morph.intervalSec, 'full') * 1000),
    );
    const oldCycleMs = Math.max(100, Number(runtimeState.morph.transitionMs) || cycleMs);
    const oldStart = Number(runtimeState.morph.cycleStart) || 0;
    if (oldStart > 0) {
      const rawPhase = (now - oldStart) / oldCycleMs;

      const phase = Math.max(0, Math.min(1, Number.isFinite(rawPhase) ? rawPhase : 0));
      runtimeState.morph.cycleStart = now - phase * cycleMs;
    } else if (tap.anchorTime > 0) {
      const elapsed = Math.max(0, now - tap.anchorTime);
      runtimeState.morph.cycleStart = tap.anchorTime + Math.floor(elapsed / cycleMs) * cycleMs;
    } else {
      runtimeState.morph.cycleStart = now;
    }
    runtimeState.morph.transitionMs = cycleMs;
  }
  if (
    runtimeState.minimalMorph.active &&
    !runtimeState.minimalMorph.transitioning &&
    isTapMorphSyncActive('minimal')
  ) {
    runtimeState.minimalMorph.nextSwitchAt = getNextTapBoundary(now, 'minimal');
  }
  if (runtimeState.projectMorph?.active && state.projectMorph.syncTap !== false) {
    const pm = normalizeProjectMorphSettings(),
      pmRt = runtimeState.projectMorph;
    const progress = Math.max(0, Math.min(1, (now - pmRt.startAt) / Math.max(10, pmRt.durationMs)));
    pmRt.durationMs = getProjectMorphDurationSec() * 1000;
    pmRt.startAt = now - progress * pmRt.durationMs;
    syncProjectMorphUI();
  }
  syncTapTimingIndicators();
}
function computeTapBpmFromTimes(times, auto = false) {
  if (!Array.isArray(times) || times.length < 2) return 0;
  const intervals = [];
  for (let i = 1; i < times.length; i++) {
    const dt = times[i] - times[i - 1];
    if (dt >= 180 && dt <= 2000) intervals.push(dt);
  }
  if (!intervals.length) return 0;
  const sorted = [...intervals].sort((a, b) => a - b),
    mid = (sorted.length - 1) / 2;
  const median = Number.isInteger(mid) ? sorted[mid] : (sorted[Math.floor(mid)] + sorted[Math.ceil(mid)]) / 2;
  const robust = intervals.filter((v) => v >= median * 0.72 && v <= median * 1.38);
  if (!robust.length) return 0;
  const rs = [...robust].sort((a, b) => a - b),
    trim = Math.floor(rs.length * 0.12),
    trimmed = rs.slice(trim, Math.max(trim + 1, rs.length - trim));
  const trimmedMean = trimmed.reduce((a, b) => a + b, 0) / trimmed.length;
  const ms = robust.length >= 6 ? median * 0.55 + trimmedMean * 0.45 : median * 0.7 + trimmedMean * 0.3;
  const bpm = 60000 / ms;
  return Math.max(30, Math.min(300, bpm));
}
function estimateAutoTapBpm(times, currentBpm = 0, windowSec = 10) {
  if (!Array.isArray(times) || times.length < 4) return { bpm: 0, confidence: 0 };
  const safeWindowSec = Math.max(1, Number(windowSec) || 10);
  const now = times[times.length - 1];
  const cutoff = now - safeWindowSec * 1000;
  const recent = times.filter((t) => t >= cutoff).slice(-512);
  if (recent.length < 4) return { bpm: 0, confidence: 0 };

  const pairs = [];
  for (let i = 1; i < recent.length; i++) {
    const age01 = Math.max(0, Math.min(1, (recent[i] - cutoff) / (safeWindowSec * 1000)));
    const recencyWeight = 0.55 + age01 * 0.45;
    for (let back = 1; back <= Math.min(5, i); back++) {
      const dt = recent[i] - recent[i - back];
      if (dt < 180 || dt > 7000) continue;
      pairs.push({ dt, back, weight: recencyWeight / Math.pow(back, 0.72) });
    }
  }
  if (pairs.length < 3) return { bpm: 0, confidence: 0 };

  const minBpm = 45;
  const maxBpm = 220;
  const scores = [];
  const reference = Number(currentBpm) > 0 ? Number(currentBpm) : 0;
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
    const period = 60000 / bpm;
    let score = 0;
    let possible = 0;
    let directScore = 0;
    let directPossible = 0;
    for (const pair of pairs) {
      const beats = Math.round(pair.dt / period);
      if (beats < 1 || beats > 12) continue;
      const error = Math.abs(pair.dt - beats * period) / period;
      const weight = pair.weight / Math.pow(beats, 0.72);
      possible += weight;
      if (pair.back === 1) directPossible += pair.weight;
      if (error <= 0.22) {
        const gaussian = Math.exp(-0.5 * Math.pow(error / 0.075, 2));
        score += weight * gaussian;
        if (pair.back === 1 && beats === 1) directScore += pair.weight * gaussian;
      }
    }
    if (!(possible > 0)) continue;
    let normalized = score / possible;
    const direct = directPossible > 0 ? directScore / directPossible : 0;

    normalized *= 1 + direct * 0.04;

    if (bpm >= 65 && bpm <= 185) normalized *= 1.025;
    else normalized *= 0.97;

    if (reference > 0) {
      const logDistance = Math.abs(Math.log2(bpm / reference));
      normalized *= 1 + 0.02 * Math.exp(-Math.pow(logDistance / 0.2, 2));
    }
    scores.push({ bpm, score: normalized, direct });
  }
  if (!scores.length) return { bpm: 0, confidence: 0 };
  scores.sort((a, b) => b.score - a.score);
  let best = scores[0];

  const nearestScore = (target) => {
    let hit = null;
    let dist = Infinity;
    for (const item of scores) {
      const d = Math.abs(item.bpm - target);
      if (d < dist) {
        dist = d;
        hit = item;
      }
    }
    return hit;
  };

  if (reference > 0) {
    for (const target of [best.bpm / 2, best.bpm * 2]) {
      if (target < minBpm || target > maxBpm) continue;
      const alt = nearestScore(target);
      if (!alt || alt.score < best.score * 0.9) continue;

      if (best.direct > alt.direct + 0.18) continue;
      const bestDistance = Math.abs(Math.log2(best.bpm / reference));
      const altDistance = Math.abs(Math.log2(alt.bpm / reference));
      if (altDistance + 0.035 < bestDistance) best = alt;
    }
  } else if (best.bpm < 65 || best.bpm > 185) {
    const target = best.bpm < 65 ? best.bpm * 2 : best.bpm / 2;
    if (target >= minBpm && target <= maxBpm) {
      const alt = nearestScore(target);
      if (alt && alt.score >= best.score * 0.94) best = alt;
    }
  }

  const runner = scores.find(
    (x) =>
      Math.abs(x.bpm - best.bpm) > 3 &&
      Math.abs(x.bpm - best.bpm * 2) > 3 &&
      Math.abs(x.bpm * 2 - best.bpm) > 3,
  );
  const margin = runner ? Math.max(0, (best.score - runner.score) / Math.max(0.001, best.score)) : 0.25;
  const confidence = Math.max(0, Math.min(1, best.score * 0.72 + margin * 0.28));
  return { bpm: best.bpm, confidence, peakCount: recent.length };
}
function estimateAutoTapFluxTempo(history, currentBpm = 0, windowSec = 10) {
  if (!Array.isArray(history) || history.length < 24) return { bpm: 0, confidence: 0 };
  const safeWindowSec = Math.max(2, Number(windowSec) || 10);
  const now = Number(history[history.length - 1]?.time) || performance.now();
  const cutoff = now - safeWindowSec * 1000;
  const recent = history.filter((x) => Number(x?.time) >= cutoff && Number.isFinite(Number(x?.value)));
  if (recent.length < 24) return { bpm: 0, confidence: 0 };

  const fps = 40,
    frames = Math.max(80, Math.min(1200, Math.ceil(safeWindowSec * fps)));
  const env = new Float32Array(frames),
    counts = new Uint16Array(frames);
  for (const x of recent) {
    const pos = ((Number(x.time) - cutoff) / 1000) * fps,
      i = Math.max(0, Math.min(frames - 1, Math.floor(pos)));
    const v = Math.max(0, Number(x.value) || 0);
    if (v > env[i]) env[i] = v;
    counts[i]++;
  }

  for (let i = 1; i < frames - 1; i++)
    if (!counts[i] && counts[i - 1] && counts[i + 1]) env[i] = (env[i - 1] + env[i + 1]) * 0.5;
  const smooth = new Float32Array(frames),
    novelty = new Float32Array(frames);
  for (let i = 0; i < frames; i++)
    smooth[i] = (env[Math.max(0, i - 1)] + env[i] * 2 + env[Math.min(frames - 1, i + 1)]) / 4;
  const baselineRadius = Math.max(4, Math.round(fps * 0.35));
  let baselineSum = 0,
    left = 0,
    right = -1;
  for (let i = 0; i < frames; i++) {
    const wantL = Math.max(0, i - baselineRadius),
      wantR = Math.min(frames - 1, i + baselineRadius);
    while (right < wantR) baselineSum += smooth[++right];
    while (left < wantL) baselineSum -= smooth[left++];
    const mean = baselineSum / Math.max(1, right - left + 1);
    novelty[i] = Math.max(0, smooth[i] - mean * 0.78);
  }
  let energy = 0;
  for (const v of novelty) energy += v * v;
  if (energy < 1e-7) return { bpm: 0, confidence: 0 };

  const minBpm = 45,
    maxBpm = 220,
    reference = Number(currentBpm) > 0 ? Number(currentBpm) : 0,
    scores = [];
  const corrAtLag = (lag) => {
    const li = Math.floor(lag),
      frac = lag - li;
    let xy = 0,
      xx = 0,
      yy = 0,
      n = 0;
    for (let i = li + 1; i < frames; i++) {
      const j = i - li,
        a = novelty[i],
        b0 = novelty[j],
        b1 = novelty[Math.max(0, j - 1)],
        b = b0 * (1 - frac) + b1 * frac;
      xy += a * b;
      xx += a * a;
      yy += b * b;
      n++;
    }
    return n > 8 && xx > 1e-9 && yy > 1e-9 ? xy / Math.sqrt(xx * yy) : 0;
  };
  for (let bpm = minBpm; bpm <= maxBpm; bpm += 0.5) {
    const lag = (60 * fps) / bpm;
    let score = corrAtLag(lag);

    if (lag * 2 < frames - 2) score = score * 0.86 + corrAtLag(lag * 2) * 0.14;
    if (bpm >= 65 && bpm <= 185) score *= 1.018;
    else score *= 0.985;
    if (reference > 0) {
      const d = Math.abs(Math.log2(bpm / reference));
      score *= 1 + 0.018 * Math.exp(-Math.pow(d / 0.24, 2));
    }
    scores.push({ bpm, score });
  }
  scores.sort((a, b) => b.score - a.score);
  if (!scores.length || !(scores[0].score > 0)) return { bpm: 0, confidence: 0 };
  let best = scores[0];
  const near = (target) =>
    scores.reduce(
      (hit, x) => (!hit || Math.abs(x.bpm - target) < Math.abs(hit.bpm - target) ? x : hit),
      null,
    );
  if (reference > 0) {
    for (const target of [best.bpm * 0.5, best.bpm * 2]) {
      if (target < minBpm || target > maxBpm) continue;
      const alt = near(target);
      if (!alt || alt.score < best.score * 0.91) continue;
      if (Math.abs(Math.log2(alt.bpm / reference)) + 0.03 < Math.abs(Math.log2(best.bpm / reference)))
        best = alt;
    }
  }
  const runner = scores.find(
    (x) =>
      Math.abs(x.bpm - best.bpm) > 4 &&
      Math.abs(x.bpm - best.bpm * 2) > 4 &&
      Math.abs(x.bpm * 2 - best.bpm) > 4,
  );
  const margin = runner ? Math.max(0, (best.score - runner.score) / Math.max(0.001, best.score)) : 0.2;
  const confidence = Math.max(0, Math.min(1, best.score * 0.78 + margin * 0.22));
  return { bpm: best.bpm, confidence, correlation: best.score };
}
function combineAutoTapTempoObservers(eventEstimate, fluxEstimate, referenceBpm = 0) {
  const a = eventEstimate?.bpm > 0 ? eventEstimate : null,
    b = fluxEstimate?.bpm > 0 ? fluxEstimate : null;
  if (!a && !b) return { bpm: 0, confidence: 0 };
  if (!a) return b;
  if (!b) return a;
  let bb = alignTempoOctave(b.bpm, a.bpm),
    delta = Math.abs(bb - a.bpm) / Math.max(1, a.bpm);
  const wa = 0.18 + Math.max(0, Math.min(1, a.confidence || 0)),
    wb = 0.14 + Math.max(0, Math.min(1, b.confidence || 0));
  if (delta <= 0.055) {
    const bpm = (a.bpm * wa + bb * wb) / (wa + wb);
    const agreement = 1 - delta / 0.055;
    return {
      bpm,
      confidence: Math.max(
        0,
        Math.min(1, (a.confidence * 0.54 + b.confidence * 0.46) * (0.78 + 0.22 * agreement)),
      ),
    };
  }

  if ((a.confidence || 0) > (b.confidence || 0) + 0.16)
    return { bpm: a.bpm, confidence: (a.confidence || 0) * 0.78 };
  if ((b.confidence || 0) > (a.confidence || 0) + 0.16)
    return { bpm: bb, confidence: (b.confidence || 0) * 0.74 };
  const ref = Number(referenceBpm) || 0;
  if (ref > 0) {
    const aa = alignTempoOctave(a.bpm, ref),
      bbb = alignTempoOctave(b.bpm, ref);
    return Math.abs(Math.log2(aa / ref)) <= Math.abs(Math.log2(bbb / ref))
      ? { bpm: aa, confidence: (a.confidence || 0) * 0.64 }
      : { bpm: bbb, confidence: (b.confidence || 0) * 0.64 };
  }
  return (a.confidence || 0) >= (b.confidence || 0)
    ? { bpm: a.bpm, confidence: (a.confidence || 0) * 0.62 }
    : { bpm: bb, confidence: (b.confidence || 0) * 0.62 };
}
function refineAutoTapBeatGrid(times, candidateBpm, windowSec = 10) {
  const bpm = Math.max(30, Math.min(300, Number(candidateBpm) || 0));
  if (!(bpm > 0) || !Array.isArray(times) || times.length < 5)
    return { bpm, confidence: 0, rms: Infinity, count: 0 };
  const period = 60000 / bpm,
    anchor = Number(times[times.length - 1]) || 0,
    cutoff = anchor - Math.max(2, Number(windowSec) || 10) * 1000;
  const recent = times.filter((t) => Number(t) >= cutoff).slice(-256);
  if (recent.length < 5) return { bpm, confidence: 0, rms: Infinity, count: recent.length };
  const rows = [];
  const maxResidual = Math.max(28, Math.min(125, period * 0.22));
  for (let i = 0; i < recent.length; i++) {
    const t = Number(recent[i]) || 0,
      k = Math.round((t - anchor) / period),
      pred = anchor + k * period,
      res = t - pred;
    if (Math.abs(res) > maxResidual) continue;
    const age01 = Math.max(0, Math.min(1, (t - cutoff) / Math.max(1, anchor - cutoff)));
    const fit = Math.exp(-0.5 * Math.pow(res / Math.max(12, period * 0.075), 2));
    rows.push({ x: k, y: t, w: (0.48 + 0.52 * age01) * (0.25 + 0.75 * fit) });
  }
  if (rows.length < 4) return { bpm, confidence: 0, rms: Infinity, count: rows.length };
  let sw = 0,
    sx = 0,
    sy = 0;
  for (const r of rows) {
    sw += r.w;
    sx += r.x * r.w;
    sy += r.y * r.w;
  }
  if (!(sw > 0)) return { bpm, confidence: 0, rms: Infinity, count: rows.length };
  const mx = sx / sw,
    my = sy / sw;
  let sxx = 0,
    sxy = 0;
  for (const r of rows) {
    const dx = r.x - mx;
    sxx += r.w * dx * dx;
    sxy += r.w * dx * (r.y - my);
  }
  if (!(sxx > 1e-6)) return { bpm, confidence: 0, rms: Infinity, count: rows.length };
  const slope = sxy / sxx;
  if (!(slope > 0)) return { bpm, confidence: 0, rms: Infinity, count: rows.length };
  let refined = 60000 / slope;

  refined = Math.max(bpm * 0.92, Math.min(bpm * 1.08, refined));
  let err2 = 0;
  const intercept = my - slope * mx;
  for (const r of rows) {
    const e = r.y - (intercept + slope * r.x);
    err2 += r.w * e * e;
  }
  const rms = Math.sqrt(err2 / sw);
  const coverage = Math.max(0, Math.min(1, (rows.length - 3) / 14));
  const precision = Math.max(0, Math.min(1, 1 - rms / Math.max(20, period * 0.11)));
  return { bpm: refined, confidence: precision * (0.55 + 0.45 * coverage), rms, count: rows.length };
}
function interpolateAutoTapPeakTime(a, b, c) {
  if (!a || !b || !c) return Number(b?.time) || 0;
  const ya = Number(a.value) || 0,
    yb = Number(b.value) || 0,
    yc = Number(c.value) || 0,
    den = ya - 2 * yb + yc;
  if (Math.abs(den) < 1e-9) return Number(b.time) || 0;

  const offset = Math.max(-0.75, Math.min(0.75, (0.5 * (ya - yc)) / den));
  const left = Math.max(1, (Number(b.time) || 0) - (Number(a.time) || 0)),
    right = Math.max(1, (Number(c.time) || 0) - (Number(b.time) || 0));
  const step = (left + right) * 0.5;
  return (Number(b.time) || 0) + offset * step;
}
const AUTO_TAP_TRACKED_BANDS = ['low', 'lowMid', 'mid', 'midHigh', 'high', 'combined'];
function resetAutoTapBandTrackers() {
  const tap = state.tapTempo;
  tap.autoBandTrackers = {};
  tap.autoChosenBand = '';
  tap.autoBandLastDecisionAt = 0;
  tap.autoTempoEvidence = [];
  tap.autoTempoLastApplyAt = 0;
}
function ensureAutoTapBandTrackers() {
  const tap = state.tapTempo;
  if (
    !tap.autoBandTrackers ||
    typeof tap.autoBandTrackers !== 'object' ||
    Array.isArray(tap.autoBandTrackers)
  )
    tap.autoBandTrackers = {};
  for (const key of AUTO_TAP_TRACKED_BANDS) {
    let tr = tap.autoBandTrackers[key];
    if (!tr || typeof tr !== 'object') tr = tap.autoBandTrackers[key] = {};
    if (!Array.isArray(tr.history)) tr.history = [];
    if (!Array.isArray(tr.beatTimes)) tr.beatTimes = [];
    if (!Array.isArray(tr.bpmHistory)) tr.bpmHistory = [];
    tr.prevSample = tr.prevSample || null;
    tr.prevPrevSample = tr.prevPrevSample || null;
    tr.lastPeakAt = Number(tr.lastPeakAt) || 0;
    tr.bpm = Number(tr.bpm) || 0;
    tr.confidence = Math.max(0, Math.min(1, Number(tr.confidence) || 0));
    tr.stability = Math.max(0, Math.min(1, Number(tr.stability) || 0));
    tr.score = Math.max(0, Number(tr.score) || 0);
  }
  return tap.autoBandTrackers;
}
function alignTempoOctave(bpm, reference) {
  const b = Number(bpm) || 0,
    ref = Number(reference) || 0;
  if (!(b > 0) || !(ref > 0)) return b;

  const octaveDistance = Math.abs(Math.log2(b / ref));
  if (Math.abs(octaveDistance - 1) > 0.22) return b;
  const choices = [b, b * 0.5, b * 2].filter((v) => v >= 30 && v <= 300);
  return choices.sort((a, c) => Math.abs(Math.log2(a / ref)) - Math.abs(Math.log2(c / ref)))[0] || b;
}
function updateAutoTapTrackerEstimate(key, tracker, windowSec) {
  const tap = state.tapTempo;
  const reference = tracker.bpm || tap.bpm;
  const eventEstimate = estimateAutoTapBpm(tracker.beatTimes, reference, windowSec);
  const fluxEstimate = estimateAutoTapFluxTempo(tracker.history, reference, windowSec);
  const estimate = combineAutoTapTempoObservers(eventEstimate, fluxEstimate, reference);
  if (!(estimate.bpm > 0)) return;
  const refined = refineAutoTapBeatGrid(tracker.beatTimes, estimate.bpm, windowSec);
  const targetBpm = refined.confidence > 0.12 ? refined.bpm : estimate.bpm;
  tracker.confidence = Math.max(
    0,
    Math.min(1, (estimate.confidence || 0) * 0.72 + (refined.confidence || 0) * 0.28),
  );
  if (!(tracker.bpm > 0)) tracker.bpm = targetBpm;
  else {
    const target = targetBpm;
    const delta = Math.abs(target - tracker.bpm) / Math.max(1, tracker.bpm);

    const alpha = delta > 0.08 ? 0.075 : 0.24;
    tracker.bpm += (target - tracker.bpm) * alpha;
  }
  const now = tracker.beatTimes[tracker.beatTimes.length - 1] || performance.now();
  tracker.bpmHistory.push({ time: now, bpm: tracker.bpm });
  const histCutoff = now - Math.min(Math.max(4000, windowSec * 500), 12000);
  while (tracker.bpmHistory.length && tracker.bpmHistory[0].time < histCutoff) tracker.bpmHistory.shift();
  const vals = tracker.bpmHistory.map((x) => x.bpm).filter((v) => v > 0);
  let stability = 0.35;
  if (vals.length >= 3) {
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const sd = Math.sqrt(vals.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / vals.length);
    const cv = mean > 0 ? sd / mean : 1;
    stability = Math.max(0, Math.min(1, 1 - cv / 0.045));
  }
  tracker.stability = stability;
  const density = Math.max(
    0,
    Math.min(1, (tracker.beatTimes.filter((t) => t >= now - windowSec * 1000).length - 3) / 18),
  );
  const preferred = tap.autoBand === key && key !== 'combined' ? 0.035 : 0;
  const combinedPenalty = key === 'combined' ? 0.015 : 0;
  tracker.score = Math.max(
    0,
    tracker.confidence * 0.67 + stability * 0.25 + density * 0.08 + preferred - combinedPenalty,
  );
}
function weightedMedianTempo(items) {
  const a = (items || [])
    .filter((x) => Number(x?.bpm) > 0 && Number(x?.weight) > 0)
    .sort((x, y) => x.bpm - y.bpm);
  if (!a.length) return 0;
  const total = a.reduce((sum, x) => sum + x.weight, 0);
  let acc = 0;
  for (const x of a) {
    acc += x.weight;
    if (acc >= total * 0.5) return x.bpm;
  }
  return a[a.length - 1].bpm;
}
function stableTempoConsensus(target, confidence, now = performance.now()) {
  const tap = state.tapTempo,
    windowSec = Math.max(2, Number(tap.autoWindowSec) || 10),
    windowMs = windowSec * 1000;
  if (!Array.isArray(tap.autoTempoEvidence)) tap.autoTempoEvidence = [];
  const ref = tap.bpm > 0 ? tap.bpm : target;
  const aligned = ref > 0 ? alignTempoOctave(target, ref) : target;
  tap.autoTempoEvidence.push({
    time: now,
    bpm: aligned,
    confidence: Math.max(0.03, Math.min(1, Number(confidence) || 0)),
  });
  const cutoff = now - windowMs;
  while (tap.autoTempoEvidence.length && tap.autoTempoEvidence[0].time < cutoff)
    tap.autoTempoEvidence.shift();
  const ev = tap.autoTempoEvidence;
  if (!ev.length) return { bpm: aligned, confidence: 0, support: 0, span: 0 };
  const weighted = ev.map((x) => {
    const age = (now - x.time) / windowMs;
    const recency = 0.45 + 0.55 * Math.max(0, 1 - age);
    return { bpm: x.bpm, weight: x.confidence * recency };
  });
  let median = weightedMedianTempo(weighted) || aligned;

  const cluster = ev.map((x) => {
    const b = alignTempoOctave(x.bpm, median);
    const d = Math.abs(Math.log2(b / median));
    const kernel = Math.exp(-0.5 * Math.pow(d / 0.045, 2));
    const age = (now - x.time) / windowMs;
    return { bpm: b, weight: x.confidence * (0.45 + 0.55 * Math.max(0, 1 - age)) * kernel, d };
  });
  const sum = cluster.reduce((a, x) => a + x.weight, 0),
    sumAll = weighted.reduce((a, x) => a + x.weight, 0);
  const bpm = sum > 0 ? cluster.reduce((a, x) => a + x.bpm * x.weight, 0) / sum : median;
  const support = sumAll > 0 ? sum / sumAll : 0;
  const span = ev.length > 1 ? Math.max(0, ev[ev.length - 1].time - ev[0].time) : 0;
  const meanConf = ev.reduce((a, x) => a + x.confidence, 0) / ev.length;
  const stability = Math.max(
    0,
    Math.min(1, support * (0.55 + 0.45 * Math.min(1, span / Math.max(1500, windowMs * 0.6)))),
  );
  return { bpm, confidence: Math.max(0, Math.min(1, meanConf * 0.55 + stability * 0.45)), support, span };
}
function ensureTempoLock() {
  const tap = state.tapTempo;
  if (!tap.autoTempoLock || typeof tap.autoTempoLock !== 'object') {
    tap.autoTempoLock = SomataTempoLock.create();
    if (tap.bpm > 0) {
      tap.autoTempoLock.bpm = tap.bpm;
      tap.autoTempoLock.anchorTime = tap.anchorTime || performance.now();
      tap.autoTempoLock.mode = 'LOCKED';
    }
  }
  return tap.autoTempoLock;
}
function resetTempoLock(keepBpm = false) {
  const tap = state.tapTempo;
  tap.autoTempoLock = SomataTempoLock.create();
  tap.autoLastDecisionPeakAt = 0;
  if (keepBpm && tap.bpm > 0) {
    tap.autoTempoLock.bpm = tap.bpm;
    tap.autoTempoLock.anchorTime = tap.anchorTime || performance.now();
    tap.autoTempoLock.mode = 'LOCKED';
  }
}
function syncTapPulsePhase(now = performance.now()) {
  const tap = state.tapTempo,
    btn = document.getElementById('btnTapTempo');
  if (!btn || !(tap.bpm > 0) || !(tap.anchorTime > 0)) return;
  const period = 60000 / tap.bpm;
  const phase = (((now - tap.anchorTime) % period) + period) % period;
  btn.style.animationDelay = `${-phase.toFixed(2)}ms`;
}
function applyStableAutoTapEstimate(
  target,
  confidence,
  bandKey,
  anchorTime = performance.now(),
  now = performance.now(),
  bandCount = 1,
  bassSupport = false,
) {
  const tap = state.tapTempo;
  if (!(target > 0)) return false;
  const consensus = stableTempoConsensus(target, confidence, now);
  const lock = ensureTempoLock(),
    oldBpm = tap.bpm,
    oldMode = lock.mode;
  SomataTempoLock.step(lock, {
    now,
    bpm: consensus.bpm || target,
    confidence: Math.max(0, Math.min(1, consensus.confidence || confidence || 0)),
    bands: bandCount,
    bassSupport,
    peakTime: anchorTime,
    fresh: true,
  });
  tap.autoConfidence = lock.confidence;
  tap.autoChosenBand = bandKey || tap.autoChosenBand || '';
  tap.autoTempoCandidate = lock.pendingBpm || 0;
  tap.autoTempoCandidateCount = lock.pending.length;
  if (!(lock.bpm > 0)) return oldMode !== lock.mode;
  tap.bpm = lock.bpm;
  tap.anchorTime = lock.anchorTime;
  if (!(oldBpm > 0)) normalizeProjectMorphSettings().syncTap = true;
  if (Math.abs((tap.lastAppliedBpm || 0) - tap.bpm) > 0.35) {
    tap.lastAppliedBpm = tap.bpm;
    resyncMorphsToTapTempo();
  }
  if (oldMode !== lock.mode || !(oldBpm > 0) || Math.abs(oldBpm - tap.bpm) > 0.75) {
    syncTapPulsePhase(now); // never restart the CSS animation on each audio tick
  }
  return true;
}
function chooseStableAutoTapBand(now = performance.now()) {
  const tap = state.tapTempo,
    trackers = ensureAutoTapBandTrackers(),
    lock = ensureTempoLock();
  const candidates = getActiveAudioBandKeys()
    .map((key) => ({ key, tr: trackers[key] }))
    .filter((x) => {
      if (!(x.tr.bpm > 0 && x.tr.confidence > 0.08 && x.tr.beatTimes.length >= 4)) return false;
      const beatMs = 60000 / (lock.bpm || x.tr.bpm);
      return x.tr.lastPeakAt > 0 && now - x.tr.lastPeakAt < Math.max(1050, Math.min(2200, beatMs * 1.7));
    });
  const latest = candidates.reduce((v, x) => Math.max(v, x.tr.lastPeakAt), 0);
  // Neither outdated detector estimates nor repeated analysis frames are new evidence.
  if (!candidates.length || latest <= (tap.autoLastDecisionPeakAt || 0)) {
    tap.autoBandLastDecisionAt = now;
    const before = lock.mode;
    SomataTempoLock.step(lock, { now, fresh: false });
    if (lock.mode !== before || lock.confidence !== tap.autoConfidence) {
      tap.autoConfidence = lock.confidence;
      return true;
    }
    return false;
  }
  tap.autoLastDecisionPeakAt = latest;
  for (const c of candidates) {
    let support = 0,
      weight = 0;
    for (const o of candidates) {
      if (o === c) continue;
      const aligned = alignTempoOctave(o.tr.bpm, c.tr.bpm);
      const d = Math.abs(aligned - c.tr.bpm) / Math.max(1, c.tr.bpm);
      const w = Math.max(0.05, o.tr.confidence * o.tr.stability);
      weight += w;
      if (d < 0.035) support += w * (1 - d / 0.035);
    }
    c.consensus = weight > 0 ? support / weight : 0;
    c.total = c.tr.score + c.consensus * 0.22;
  }
  candidates.sort((a, b) => b.total - a.total);
  const best = candidates[0],
    near = [];
  for (const c of candidates) {
    const aligned = alignTempoOctave(c.tr.bpm, best.tr.bpm);
    if (Math.abs(aligned - best.tr.bpm) / Math.max(1, best.tr.bpm) <= 0.04)
      near.push({ bpm: aligned, w: Math.max(0.02, c.tr.confidence * c.tr.stability), key: c.key });
  }
  const sumW = near.reduce((a, x) => a + x.w, 0);
  const target = sumW > 0 ? near.reduce((a, x) => a + x.bpm * x.w, 0) / sumW : best.tr.bpm;
  const confidence = Math.max(
    0,
    Math.min(1, best.tr.confidence * 0.62 + best.tr.stability * 0.2 + (best.consensus || 0) * 0.18),
  );
  const anchor = best.tr.lastPeakAt || latest;
  const meaningfulBands = near.filter((x) => x.key !== 'combined').length;
  const changed = applyStableAutoTapEstimate(
    target,
    confidence,
    best.key,
    anchor,
    now,
    Math.max(1, meaningfulBands),
    near.some((x) => x.key === 'low'),
  );
  tap.autoBandLastDecisionAt = now;
  return changed;
}
function registerTapTempo(now = performance.now(), source = 'manual') {
  if (source === 'manual' && state.tapTempo.autoTap) setAutoTapEnabled(false, false);
  const tap = state.tapTempo;
  const hadBpm = Number(tap.bpm) > 0;
  if (source === 'manual') {
    tap.syncFullMorph = true;
    tap.syncMinimalMorph = true;
  }
  const list = source === 'auto' ? tap.autoBeatTimes : tap.tapTimes;
  const last = list[list.length - 1] || 0;
  if (source === 'manual' && last && now - last > 2200) list.length = 0;
  if (last && now - last < 150) return;
  list.push(now);

  if (source === 'auto') {
    const windowMs = Math.max(1000, (Number(tap.autoWindowSec) || 10) * 1000);

    const retentionMs = Math.max(windowMs, 120000);
    const retentionCutoff = now - retentionMs;
    while (list.length && list[0] < retentionCutoff) list.shift();
    while (list.length > 4096) list.shift();
  } else {
    while (list.length > 12) list.shift();
  }

  if (!tap.anchorTime || (source === 'manual' && list.length === 1)) tap.anchorTime = now;
  tap.lastTapAt = now;

  if (source === 'auto') {
    const estimate = estimateAutoTapBpm(list, tap.bpm, tap.autoWindowSec);
    tap.autoConfidence = estimate.confidence || 0;
    if (estimate.bpm > 0) {
      const target = estimate.bpm;
      if (!(tap.bpm > 0)) {
        tap.bpm = target;
        tap.autoTempoCandidate = 0;
        tap.autoTempoCandidateCount = 0;
      } else {
        const relativeChange = Math.abs(target - tap.bpm) / Math.max(1, tap.bpm);

        if (relativeChange > 0.1) {
          const sameCandidate =
            tap.autoTempoCandidate > 0 &&
            Math.abs(target - tap.autoTempoCandidate) / Math.max(1, tap.autoTempoCandidate) < 0.035;
          tap.autoTempoCandidate = sameCandidate ? tap.autoTempoCandidate * 0.7 + target * 0.3 : target;
          tap.autoTempoCandidateCount = sameCandidate ? (tap.autoTempoCandidateCount || 0) + 1 : 1;
          const confirmationsNeeded = Math.max(
            3,
            Math.min(7, Math.round(Math.max(3, Number(tap.autoWindowSec) || 10) / 4)),
          );
          if (tap.autoTempoCandidateCount >= confirmationsNeeded && tap.autoConfidence >= 0.3) {
            const jumpTarget = tap.autoTempoCandidate;
            tap.bpm += (jumpTarget - tap.bpm) * 0.18;
            tap.autoTempoCandidateCount = Math.max(0, confirmationsNeeded - 2);
          }
        } else {
          tap.autoTempoCandidate = 0;
          tap.autoTempoCandidateCount = 0;

          const effectiveBeats = Math.max(
            4,
            Math.min(64, ((Number(tap.autoWindowSec) || 10) * Math.max(45, target)) / 60),
          );
          let alpha = Math.max(0.04, Math.min(0.2, 2 / (effectiveBeats + 1)));
          alpha *= 0.55 + 0.45 * Math.max(0.2, tap.autoConfidence);
          tap.bpm += (target - tap.bpm) * alpha;
        }
      }
    }
  } else {
    const bpm = computeTapBpmFromTimes(list, false);
    if (bpm > 0) tap.bpm = tap.bpm > 0 ? tap.bpm * 0.25 + bpm * 0.75 : bpm;
  }

  if (!hadBpm && tap.bpm > 0) {
    normalizeProjectMorphSettings().syncTap = true;
    syncProjectMorphUI();
  }
  if (tap.bpm > 0 && Math.abs((tap.lastAppliedBpm || 0) - tap.bpm) > 0.35) {
    tap.lastAppliedBpm = tap.bpm;
    resyncMorphsToTapTempo();
  }
  syncTapUI();
  restartTapPulseAnimation();
  syncTapPulsePhase(now);
}
function resetTapTempo() {
  const tap = state.tapTempo;
  tap.bpm = 0;
  tap.tapTimes = [];
  tap.autoBeatTimes = [];
  tap.anchorTime = 0;
  tap.lastTapAt = 0;
  tap.lastAppliedBpm = 0;
  tap.autoTap = false;
  tap.autoFluxHistory = [];
  tap.autoPrevSpectrum = null;
  tap.autoLastPeakAt = 0;
  tap.autoConfidence = 0;
  tap.autoTempoCandidate = 0;
  tap.autoTempoCandidateCount = 0;
  tap.autoTempoEvidence = [];
  tap.autoTempoLastApplyAt = 0;
  resetTempoLock(false);
  tap.autoFluxPrevSample = null;
  tap.autoFluxPrevPrevSample = null;
  resetAutoTapBandTrackers();
  tap.syncFullMorph = false;
  tap.syncMinimalMorph = false;
  if (runtimeState.morph.active) activeRebaseMorphing();
  if (runtimeState.minimalMorph.active && !runtimeState.minimalMorph.transitioning) {
    runtimeState.minimalMorph.nextSwitchAt =
      performance.now() + getTapMorphIntervalSec(state.minimalMorph.intervalSec, 'minimal') * 1000;
  }
  syncTapUI();
}
function analyzeAutoTap(data, now = performance.now(), sampleRate = 44100, fftSize = 1024, gateGain = 1) {
  const tap = state.tapTempo;
  if (!tap.autoTap || !data?.length) return;
  const appliedGain = Math.max(0, Math.min(1, Number(gateGain) || 0));
  if (!tap.autoPrevSpectrum || tap.autoPrevSpectrum.length !== data.length) {
    tap.autoPrevSpectrum = new Uint8Array(data.length);
    for (let i = 0; i < data.length; i++) tap.autoPrevSpectrum[i] = Math.round(data[i] * appliedGain);
    resetAutoTapBandTrackers();
    return;
  }
  const sr = Math.max(8000, Number(sampleRate) || 44100),
    size = Math.max(32, Number(fftSize) || 1024),
    binHz = sr / size;
  const nyquistMax = Math.min(20000, sr / 2);
  const passMin = Math.max(20, Math.min(nyquistMax, Number(state.audioReactive.highPassHz) || 20));
  const passMax = Math.max(passMin, Math.min(nyquistMax, Number(state.audioReactive.lowPassHz) || 20000));
  const sourceRanges = getAudioBandRangesForAnalysis();
  const ranges = {};
  for (const key of ['low', 'lowMid', 'mid', 'midHigh', 'high']) {
    const src = sourceRanges[key] || [passMin, passMax];
    ranges[key] = [Math.max(passMin, src[0]), Math.min(passMax, src[1])];
  }
  ranges.combined = [passMin, passMax];
  const prev = tap.autoPrevSpectrum,
    trackers = ensureAutoTapBandTrackers();
  const selectedWindowMs = Math.max(1000, (Number(tap.autoWindowSec) || 10) * 1000);
  const retentionMs = Math.max(selectedWindowMs, 120000),
    retentionCutoff = now - retentionMs;
  const detectorWindowMs = Math.min(selectedWindowMs, 3200),
    detectorCutoff = now - detectorWindowMs;
  let detectedAny = false;

  for (const key of getActiveAudioBandKeys()) {
    const [fromHz, toHz] = ranges[key] || [passMin, passMax];
    if (!(toHz > fromHz)) continue;
    const a = Math.max(1, Math.min(data.length, Math.floor(fromHz / binHz)));
    const b = Math.max(a, Math.min(data.length, Math.ceil(toHz / binHz)));
    let flux = 0,
      energy = 0,
      bins = 0;
    for (let i = a; i < b; i++) {
      const v = data[i] * appliedGain,
        diff = v - prev[i];
      if (diff > 0) flux += diff;
      energy += v;
      bins++;
    }
    if (!bins) continue;
    flux /= bins * 255;
    energy /= bins * 255;
    const tr = trackers[key],
      sample = { time: now, value: flux, energy };
    tr.history.push(sample);
    while (tr.history.length && tr.history[0].time < retentionCutoff) tr.history.shift();
    let mean = 0,
      count = 0;
    for (let i = tr.history.length - 2; i >= 0; i--) {
      const x = tr.history[i];
      if (x.time < detectorCutoff) break;
      mean += x.value;
      count++;
    }
    if (count >= 10) {
      mean /= count;
      let variance = 0;
      for (let i = tr.history.length - 2; i >= 0; i--) {
        const x = tr.history[i];
        if (x.time < detectorCutoff) break;
        const d = x.value - mean;
        variance += d * d;
      }
      const sd = Math.sqrt(variance / count);

      const bandFactor = key === 'high' ? 1.44 : key === 'midHigh' ? 1.38 : key === 'combined' ? 1.34 : 1.28;
      const threshold = mean + Math.max(0.0045, sd * bandFactor);
      const prevSample = tr.prevSample,
        prevPrevSample = tr.prevPrevSample;
      if (prevSample && prevPrevSample) {
        const referenceBpm = tr.bpm > 0 ? tr.bpm : tap.bpm > 0 ? tap.bpm : 120;
        const beatMs = 60000 / referenceBpm;
        const refractory = Math.max(150, Math.min(320, beatMs * 0.38));
        const energyFloor = key === 'high' ? 0.01 : key === 'midHigh' ? 0.011 : 0.012;
        const isPeak =
          prevSample.value > threshold &&
          prevSample.value >= prevPrevSample.value &&
          prevSample.value > sample.value &&
          prevSample.energy >= energyFloor;
        if (isPeak) {
          const peakTime = interpolateAutoTapPeakTime(prevPrevSample, prevSample, sample);
          if (peakTime - (tr.lastPeakAt || 0) < refractory) {
            /* keep the stronger local maximum only */
          } else {
            tr.lastPeakAt = peakTime;
            tr.beatTimes.push(peakTime);
            while (tr.beatTimes.length && tr.beatTimes[0] < retentionCutoff) tr.beatTimes.shift();
            while (tr.beatTimes.length > 4096) tr.beatTimes.shift();
            updateAutoTapTrackerEstimate(key, tr, Math.max(1, Number(tap.autoWindowSec) || 10));
            detectedAny = true;
          }
        }
      }
    }
    tr.prevPrevSample = tr.prevSample;
    tr.prevSample = sample;
  }

  for (let i = 0; i < data.length; i++) prev[i] = Math.round(data[i] * appliedGain);
  if (detectedAny || now - (tap.autoBandLastDecisionAt || 0) > 450) {
    if (chooseStableAutoTapBand(now)) syncTapUI();
  }
}
function setAutoTapEnabled(enabled, resetTempo = true) {
  const tap = state.tapTempo;
  tap.autoTap = !!enabled;
  tap.autoFluxHistory = [];
  tap.autoPrevSpectrum = null;
  tap.autoBeatTimes = [];
  tap.autoLastPeakAt = 0;
  tap.autoConfidence = 0;
  tap.autoTempoCandidate = 0;
  tap.autoTempoCandidateCount = 0;
  tap.autoTempoEvidence = [];
  tap.autoTempoLastApplyAt = 0;
  resetTempoLock(!resetTempo);
  tap.autoFluxPrevSample = null;
  tap.autoFluxPrevPrevSample = null;
  resetAutoTapBandTrackers();
  if (tap.autoTap) {
    tap.syncFullMorph = true;
    tap.syncMinimalMorph = true;
  }
  if (tap.autoTap && resetTempo) {
    tap.bpm = 0;
    tap.tapTimes = [];
    tap.anchorTime = 0;
    tap.lastAppliedBpm = 0;
  }
  syncTapUI();
  capturePlaylistOverridesFromCurrent();
}
async function toggleAutoTapListenFromHeader() {
  if (state.tapTempo.autoTap) {
    setAutoTapEnabled(false, false);
    return;
  }

  if (!state.audioReactive.active) {
    await startAudioReactive();
    if (!state.audioReactive.active) {
      setAutoTapEnabled(false, false);
      return;
    }
  }
  setAutoTapEnabled(true, true);
}
// One physical mouse-wheel notch changes the displayed tempo by exactly one BPM.
// This edits the same TAP state used by Blue/Orange/Green sync, not a display-only value.
function stepTapTempoByWheel(deltaY) {
  if (!Number.isFinite(deltaY) || deltaY === 0) return;
  const tap = state.tapTempo;
  const current = Math.max(0, Math.min(300, Math.round(Number(tap.bpm) || 0)));
  const next = Math.max(0, Math.min(300, current + (deltaY < 0 ? 1 : -1)));
  if (next === current) return;
  if (next === 0) {
    resetTapTempo();
    capturePlaylistOverridesFromCurrent();
    return;
  }
  // Explicit wheel input takes control away from Auto-TAP, otherwise its next
  // audio tick would immediately overwrite the user's +/- 1 adjustment.
  if (tap.autoTap) setAutoTapEnabled(false, false);
  tap.bpm = next;
  tap.tapTimes = [];
  tap.autoBeatTimes = [];
  tap.lastTapAt = 0;
  tap.anchorTime = performance.now();
  tap.lastAppliedBpm = next;
  tap.syncFullMorph = true;
  tap.syncMinimalMorph = true;
  if (current === 0) normalizeProjectMorphSettings().syncTap = true;
  resyncMorphsToTapTempo();
  syncTapUI();
  restartTapPulseAnimation();
  syncTapPulsePhase(performance.now());
  capturePlaylistOverridesFromCurrent();
}
function setupTapTempoUI() {
  const panel = document.getElementById('tapSettingsPanel');
  document.getElementById('btnAutoTapListen')?.addEventListener('click', () => {
    void toggleAutoTapListenFromHeader();
  });
  const tapButton = document.getElementById('btnTapTempo');
  tapButton?.addEventListener('click', () => registerTapTempo(performance.now(), 'manual'));
  tapButton?.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey) return; // Preserve browser pinch/zoom gestures.
      if (!Number.isFinite(e.deltaY) || e.deltaY === 0) return;
      e.preventDefault(); // Do not scroll the page/parameter panel instead.
      e.stopPropagation();
      stepTapTempoByWheel(e.deltaY);
    },
    { passive: false },
  );
  document.getElementById('btnTapReset')?.addEventListener('click', resetTapTempo);
  document.getElementById('btnTapSettings')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = panel?.classList.contains('hidden');
    panel?.classList.toggle('hidden', !open);
    document.getElementById('btnTapSettings')?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) positionFloatingPanelNearTrigger?.(panel, e.currentTarget);
  });
  document.getElementById('btnCloseTapSettings')?.addEventListener('click', () => {
    panel?.classList.add('hidden');
    document.getElementById('btnTapSettings')?.setAttribute('aria-expanded', 'false');
  });
  panel?.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', (e) => {
    const nav = document.querySelector('.tap-nav');
    if (nav && !nav.contains(e.target)) {
      panel?.classList.add('hidden');
      document.getElementById('btnTapSettings')?.setAttribute('aria-expanded', 'false');
    }
  });
  document.getElementById('tapBeatsPerMorph')?.addEventListener('change', (e) => {
    state.tapTempo.beatsPerMorph = Math.max(1, Math.min(64, Math.round(Number(e.target.value) || 16)));
    e.target.value = state.tapTempo.beatsPerMorph;
    if (state.tapTempo.bpm > 0) {
      state.tapTempo.syncFullMorph = true;
      state.tapTempo.syncMinimalMorph = true;
      resyncMorphsToTapTempo();
    }
    syncTapUI();
  });
  document.getElementById('tapAutoEnabled')?.addEventListener('change', (e) => {
    setAutoTapEnabled(!!e.target.checked, true);
  });
  document.getElementById('tapAutoWindowSec')?.addEventListener('change', (e) => {
    const value = Math.max(1, Number(e.target.value) || 10);
    state.tapTempo.autoWindowSec = value;
    e.target.value = String(value);
    state.tapTempo.autoTempoCandidate = 0;
    state.tapTempo.autoTempoCandidateCount = 0;
    state.tapTempo.autoConfidence = 0;
    state.tapTempo.autoTempoEvidence = [];
    resetTempoLock(true);
    syncTapUI();
    capturePlaylistOverridesFromCurrent();
  });
  document.getElementById('tapAutoBand')?.addEventListener('change', (e) => {
    const available = getActiveAudioBandKeys();
    const value = available.includes(e.target.value) ? e.target.value : available[0];
    state.tapTempo.autoBand = value;

    state.tapTempo.autoBandLastDecisionAt = 0;
    state.tapTempo.autoLastDecisionPeakAt = performance.now();
    chooseStableAutoTapBand(performance.now());
    syncTapUI();
    capturePlaylistOverridesFromCurrent();
  });
  syncTapUI();
}

export {
  analyzeAutoTap,
  blueOrderPhaseDurationMs,
  chooseStableAutoTapBand,
  getMorphIntervalMultiplier,
  getNextTapBoundary,
  getTapMorphIntervalSec,
  getTapTempoIntervalSec,
  isTapMorphSyncActive,
  resetAutoTapBandTrackers,
  resetTapTempo,
  resetTempoLock,
  sampleBlueSpiralOrder,
  setupTapTempoUI,
  syncTapTimingIndicators,
  syncTapUI,
};
