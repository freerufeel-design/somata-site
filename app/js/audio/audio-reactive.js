// Аудиореактивность: полосы, микрофон, шумовой порог, панель.
import '../ui/header-and-export.js'; // initialisation order: this module runs after it
import { AUDIO_BAND_COLORS, AUDIO_BAND_INDEX, getDefaultAudioCustomBandRange } from './audio-params.js';
import { synchronizeAutomaticLayerAudioBands } from './audio-routing.js';
import { paintAudioRoutingMeters, renderAudioRoutingPanel } from '../ui/audio-routing-panel.js';
import { animationScheduler, requestMainCanvasRender } from '../core/scheduler.js';
import { runtimeState, state } from '../core/state.js';
import { getEffectiveLayerRadius } from '../effects/motion.js';
import { renderMainCanvas } from '../render/main-pipeline.js';
import { formatDisplayNumber } from '../ui/geometry-n-control.js';
import { activeRebaseMorphing } from '../morph-runtime/morph-hooks.js';
import {
  analyzeAutoTap,
  chooseStableAutoTapBand,
  resetAutoTapBandTrackers,
  resetTempoLock,
  syncTapUI,
} from './tap-tempo.js';
import { positionFloatingPanelNearTrigger } from '../ui/floating-panels.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

function ensureAudioLayers() {
  const radii = state.layers
    .slice(0, 3)
    .map((l) => getEffectiveLayerRadius(l, 0))
    .filter((r) => r > 0);
  state.audioReactive.referenceRadius = radii.length ? Math.max(120, ...radii) : 220;
}
function rangeToFrequency(v) {
  const min = Math.log10(20),
    max = Math.log10(20000);
  return Math.round(Math.pow(10, min + (max - min) * (Number(v) / 1000)));
}
function formatAudioHz(hz) {
  return `${Math.round(hz).toLocaleString('ru-RU')} Hz`;
}
function frequencyToRange(hz) {
  const f = Math.max(20, Math.min(20000, Number(hz) || 20));

  return Math.max(
    0,
    Math.min(1000, ((Math.log10(f) - Math.log10(20)) / (Math.log10(20000) - Math.log10(20))) * 1000),
  );
}
function getActiveAudioBandKeys(count = state.audioReactive?.bandCount) {
  const n = Math.max(1, Math.min(5, Math.round(Number(count) || 3)));
  return n === 1
    ? ['low']
    : n === 2
      ? ['low', 'high']
      : n === 3
        ? ['low', 'mid', 'high']
        : n === 4
          ? ['low', 'mid', 'midHigh', 'high']
          : ['low', 'lowMid', 'mid', 'midHigh', 'high'];
}
function getDefaultMasterBandEdges(count) {
  const n = Math.max(1, Math.min(5, Math.round(Number(count) || 3)));
  if (n === 1) return [];
  if (n === 2) return [775];
  if (n === 3) return [120, 5000];
  if (n === 4) return [120, 900, 5000];
  return [120, 500, 2000, 5000];
}
function getAudioBandRangesForAnalysis() {
  const ar = state.audioReactive,
    keys = getActiveAudioBandKeys();
  const hp = Math.max(20, Math.min(20000, Number(ar.highPassHz) || 20));
  const lp = Math.max(hp, Math.min(20000, Number(ar.lowPassHz) || 20000));
  const out = { low: [0, 0], lowMid: [0, 0], mid: [0, 0], midHigh: [0, 0], high: [0, 0] };
  if (ar.customBandsEnabled === true) {
    const ranges = ar.customBandRanges || {};
    for (const k of keys) {
      const r = Array.isArray(ranges[k]) ? ranges[k] : [hp, lp];
      out[k] = [
        Math.max(hp, Math.min(lp, Number(r[0]) || hp)),
        Math.max(hp, Math.min(lp, Number(r[1]) || lp)),
      ];
      if (out[k][1] < out[k][0]) out[k].reverse();
    }
    return out;
  }
  const edges = (Array.isArray(ar.masterBandEdges) ? ar.masterBandEdges : [])
    .slice(0, keys.length - 1)
    .map(Number)
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  while (edges.length < keys.length - 1)
    edges.push(getDefaultMasterBandEdges(keys.length)[edges.length] || lp);
  const pts = [hp, ...edges.map((v) => Math.max(hp, Math.min(lp, v))), lp];
  for (let i = 1; i < pts.length; i++) if (pts[i] < pts[i - 1]) pts[i] = pts[i - 1];
  keys.forEach((k, i) => (out[k] = [pts[i], pts[i + 1]]));
  return out;
}
function renderAudioMeters() {
  const host = document.getElementById('audioMeters');
  if (!host) return;
  const ar = state.audioReactive || {};
  const labels = { low: 'НЧ', lowMid: 'Ниж.СЧ', mid: 'СЧ', midHigh: 'Ср.ВЧ', high: 'ВЧ' };
  host.innerHTML = '';
  if (!ar.bandGains || typeof ar.bandGains !== 'object')
    ar.bandGains = { low: 1, lowMid: 1, mid: 1, midHigh: 1, high: 1 };
  for (const k of getActiveAudioBandKeys()) {
    const row = document.createElement('div');
    row.className = 'audio-meter-row';
    row.dataset.band = k;
    const label = document.createElement('span');
    label.textContent = labels[k];
    const meter = document.createElement('div');
    meter.className = 'audio-meter';
    const fill = document.createElement('i');
    fill.dataset.audioMeter = k;
    fill.style.background = AUDIO_BAND_COLORS[k];
    meter.appendChild(fill);
    const value = document.createElement('span');
    value.dataset.audioValue = k;
    value.textContent = '0%';
    const gain = document.createElement('input');
    gain.type = 'number';
    gain.min = '0';
    gain.step = '0.1';
    gain.inputMode = 'decimal';
    gain.className = 'audio-band-gain';
    gain.dataset.audioBandGain = k;
    gain.setAttribute('aria-label', `Множитель ${labels[k]}`);
    gain.title = 'Множитель этого частотного монитора';
    const gv = Number(ar.bandGains[k]);
    gain.value = (Number.isFinite(gv) ? Math.max(0, gv) : 1).toFixed(1);
    const syncGain = () => {
      const v = Number(gain.value);
      ar.bandGains[k] = Number.isFinite(v) ? Math.max(0, v) : 1;
      gain.value = formatDisplayNumber(ar.bandGains[k], 2);
    };
    gain.addEventListener('input', () => {
      const v = Number(gain.value);
      if (Number.isFinite(v)) ar.bandGains[k] = Math.max(0, v);
    });
    gain.addEventListener('change', syncGain);
    const gainWrap = document.createElement('span');
    gainWrap.className = 'audio-band-gain-wrap';
    const times = document.createElement('span');
    times.textContent = '×';
    gainWrap.append(times, gain);
    row.append(label, meter, value, gainWrap);
    host.appendChild(row);
  }
}
function renderAudioCustomBandRows() {
  const host = document.getElementById('audioCustomBandRows');
  if (!host) return;
  const ar = state.audioReactive || {};
  const custom = ar.customBandsEnabled === true;
  host.classList.toggle('hidden', !custom);
  host.innerHTML = '';
  if (!custom) return;
  const keys = getActiveAudioBandKeys();
  const labels = {
    low: 'Низкие',
    lowMid: 'Низ-середина',
    mid: 'Середина',
    midHigh: 'Верх-середина',
    high: 'Высокие',
  };
  if (!ar.customBandRanges || typeof ar.customBandRanges !== 'object') ar.customBandRanges = {};
  const derived = getAudioBandRangesForAnalysis();
  keys.forEach((key) => {
    const fallback = derived[key] || [20, 20000];
    const stored = Array.isArray(ar.customBandRanges[key]) ? ar.customBandRanges[key] : fallback;
    let loHz = Math.max(20, Math.min(20000, Number(stored[0]) || 20));
    let hiHz = Math.max(loHz, Math.min(20000, Number(stored[1]) || 20000));
    ar.customBandRanges[key] = [loHz, hiHz];
    const row = document.createElement('div');
    row.className = 'audio-custom-band-row';
    row.style.setProperty('--band-color', AUDIO_BAND_COLORS[key] || '#94a3b8');
    const name = document.createElement('span');
    name.className = 'audio-custom-band-name';
    name.textContent = labels[key];
    const dual = document.createElement('div');
    dual.className = 'audio-custom-dual';

    const lo = document.createElement('input');
    lo.type = 'range';
    lo.min = '0';
    lo.max = '1000';
    lo.step = '1';
    lo.value = String(frequencyToRange(loHz));
    lo.className = 'audio-band-low';
    const hi = document.createElement('input');
    hi.type = 'range';
    hi.min = '0';
    hi.max = '1000';
    hi.step = '1';
    hi.value = String(frequencyToRange(hiHz));
    hi.className = 'audio-band-high';
    const values = document.createElement('span');
    values.className = 'audio-custom-band-values';
    const loNum = document.createElement('input');
    loNum.type = 'number';
    loNum.min = '20';
    loNum.max = '20000';
    loNum.step = '1';
    loNum.inputMode = 'numeric';
    loNum.value = String(Math.round(loHz));
    loNum.setAttribute('aria-label', `${labels[key]}: нижняя частота`);
    const dash = document.createElement('span');
    dash.textContent = '–';
    const hiNum = document.createElement('input');
    hiNum.type = 'number';
    hiNum.min = '20';
    hiNum.max = '20000';
    hiNum.step = '1';
    hiNum.inputMode = 'numeric';
    hiNum.value = String(Math.round(hiHz));
    hiNum.setAttribute('aria-label', `${labels[key]}: верхняя частота`);
    const commit = (fromSlider = false) => {
      let a = fromSlider ? rangeToFrequency(Number(lo.value) || 0) : Number(loNum.value);
      let b = fromSlider ? rangeToFrequency(Number(hi.value) || 1000) : Number(hiNum.value);
      a = Math.max(20, Math.min(20000, Number.isFinite(a) ? a : loHz));
      b = Math.max(20, Math.min(20000, Number.isFinite(b) ? b : hiHz));
      if (a > b) {
        if (document.activeElement === lo || document.activeElement === loNum) b = a;
        else a = b;
      }
      loHz = a;
      hiHz = b;
      ar.customBandRanges[key] = [a, b];
      lo.value = String(frequencyToRange(a));
      hi.value = String(frequencyToRange(b));
      loNum.value = String(Math.round(a));
      hiNum.value = String(Math.round(b));
      syncAudioCutoffs();
    };
    lo.addEventListener('input', () => commit(true));
    hi.addEventListener('input', () => commit(true));
    lo.addEventListener('change', () => commit(true));
    hi.addEventListener('change', () => commit(true));
    loNum.addEventListener('change', () => commit(false));
    hiNum.addEventListener('change', () => commit(false));
    const resetNumericBoundary = (which) => {
      const standard = getDefaultAudioCustomBandRange(key);
      if (which === 'lo') {
        loNum.value = String(standard[0]);
      } else {
        hiNum.value = String(standard[1]);
      }
      commit(false);
    };
    loNum.title = 'Двойной клик — стандартная нижняя граница';
    hiNum.title = 'Двойной клик — стандартная верхняя граница';
    loNum.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetNumericBoundary('lo');
      loNum.select?.();
    });
    hiNum.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      resetNumericBoundary('hi');
      hiNum.select?.();
    });
    loNum.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit(false);
        loNum.blur();
      }
    });
    hiNum.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        commit(false);
        hiNum.blur();
      }
    });
    dual.append(lo, hi);
    values.append(loNum, dash, hiNum);
    row.append(name, dual, values);
    host.append(row);
  });
}
function paintAudioFrequencyTrack(hpPos, lpPos) {
  const ar = state.audioReactive,
    track = document.getElementById('audioFrequencyTrack');
  if (!track) return;
  const hp = hpPos / 10,
    lp = lpPos / 10,
    keys = getActiveAudioBandKeys(),
    ranges = getAudioBandRangesForAnalysis();
  let stops = [`#111827 0%`, `#111827 ${hp}%`];
  if (ar.customBandsEnabled === true) {
    const endpoints = [state.audioReactive.highPassHz, state.audioReactive.lowPassHz];
    keys.forEach((k) => endpoints.push(...ranges[k]));
    const pts = [...new Set(endpoints.map((v) => Math.max(20, Math.min(20000, v))))].sort((a, b) => a - b);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i],
        b = pts[i + 1];
      if (b <= state.audioReactive.highPassHz || a >= state.audioReactive.lowPassHz) continue;
      const mid = (a + b) / 2,
        cover = keys.filter((k) => mid >= ranges[k][0] && mid <= ranges[k][1]);
      const col = cover.length === 0 ? '#000000' : cover.length > 1 ? '#ffffff' : AUDIO_BAND_COLORS[cover[0]];
      const pa = frequencyToRange(a) / 10,
        pb = frequencyToRange(b) / 10;
      stops.push(`${col} ${pa}%`, `${col} ${pb}%`);
    }
  } else {
    for (const k of keys) {
      const r = ranges[k];
      stops.push(
        `${AUDIO_BAND_COLORS[k]} ${frequencyToRange(r[0]) / 10}%`,
        `${AUDIO_BAND_COLORS[k]} ${frequencyToRange(r[1]) / 10}%`,
      );
    }
  }
  stops.push(`#111827 ${lp}%`, `#111827 100%`);
  track.style.background = `linear-gradient(90deg,${stops.join(',')})`;
  track.style.opacity = '.9';
}
function parseAudioBoundaryFrequency(raw) {
  let text = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(',', '.')
    .replace(/\s+/g, '');
  if (!text) return NaN;
  let multiplier = 1;
  if (/(?:khz|кгц|кгц\.|к)$/.test(text)) {
    multiplier = 1000;
    text = text.replace(/(?:khz|кгц|кгц\.|к)$/, '');
  } else text = text.replace(/(?:hz|гц|гц\.)$/, '');
  const value = Number(text);
  return Number.isFinite(value) ? value * multiplier : NaN;
}
function setAudioBoundaryFrequency(kind, index, raw) {
  const parsed = parseAudioBoundaryFrequency(raw);
  if (!Number.isFinite(parsed)) return false;
  const ar = state.audioReactive;
  const needed = Math.max(
    0,
    Math.min(4, Math.max(1, Math.min(5, Math.round(Number(ar.bandCount) || 3))) - 1),
  );
  let edges = (Array.isArray(ar.masterBandEdges) ? ar.masterBandEdges.slice(0, needed) : []).map(Number);
  while (edges.length < needed) edges.push(getDefaultMasterBandEdges(needed + 1)[edges.length] || 20000);
  const values = [
    Math.max(20, Math.min(20000, Number(ar.highPassHz) || 20)),
    ...edges,
    Math.max(20, Math.min(20000, Number(ar.lowPassHz) || 20000)),
  ];
  let slot = 0,
    changed = 'hp',
    element = document.getElementById('audioHighPass');
  if (kind === 'lp') {
    slot = values.length - 1;
    changed = 'lp';
    element = document.getElementById('audioLowPass');
  } else if (kind === 'cut') {
    slot = Math.max(1, Math.min(values.length - 2, (Number(index) || 0) + 1));
    changed = `cut${slot - 1}`;
    element = document.querySelector(`.audio-band-cut[data-cut-index="${slot - 1}"]`);
  }
  const minHz = slot === 0 ? 20 : values[slot - 1],
    maxHz = slot === values.length - 1 ? 20000 : values[slot + 1];
  const hz = Math.max(minHz, Math.min(maxHz, parsed));
  if (!element) return false;
  element.value = String(frequencyToRange(hz));
  syncAudioCutoffs(changed);
  return true;
}
function beginAudioBoundaryEdit(span) {
  if (!span || span.classList.contains('editing')) return;
  const original = span.textContent;
  const hz = Number(span.dataset.hz) || 20;
  let finished = false;
  const finish = (commit) => {
    if (finished) return;
    finished = true;
    const raw = span.textContent;
    span.contentEditable = 'false';
    span.classList.remove('editing');
    if (
      commit &&
      setAudioBoundaryFrequency(span.dataset.boundaryKind, Number(span.dataset.boundaryIndex) || 0, raw)
    )
      return;
    span.textContent = original;
  };
  span.contentEditable = 'true';
  span.classList.add('editing');
  span.textContent = String(Math.round(hz));
  span.focus();
  const sel = window.getSelection?.();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(span);
    sel.removeAllRanges();
    sel.addRange(range);
  }
  span.addEventListener(
    'keydown',
    (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
        span.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
        span.blur();
      }
    },
    { once: false },
  );
  span.addEventListener('blur', () => finish(true), { once: true });
}
function renderAudioCutoffSummary() {
  const summary = document.getElementById('audioCutoffText');
  if (!summary) return;
  const ar = state.audioReactive,
    needed = Math.max(0, Math.min(4, Math.max(1, Math.min(5, Math.round(Number(ar.bandCount) || 3))) - 1));
  const edges = Array.isArray(ar.masterBandEdges) ? ar.masterBandEdges.slice(0, needed) : [];
  summary.replaceChildren();
  const appendBoundary = (prefix, hz, kind, index = 0, editable = true) => {
    if (prefix) summary.append(document.createTextNode(prefix));
    const span = document.createElement('span');
    span.className = 'audio-cutoff-boundary';
    span.dataset.hz = String(hz);
    span.dataset.boundaryKind = kind;
    span.dataset.boundaryIndex = String(index);
    span.textContent = formatAudioHz(hz);
    span.title = editable ? 'Двойной клик — ввести частоту вручную. Enter — применить, Esc — отменить.' : '';
    if (editable)
      span.addEventListener('dblclick', (e) => {
        e.preventDefault();
        e.stopPropagation();
        beginAudioBoundaryEdit(span);
      });
    else span.style.cursor = 'default';
    summary.append(span);
  };
  appendBoundary('HP ', ar.highPassHz, 'hp', 0, true);
  edges.forEach((hz, i) => appendBoundary(' · ', hz, 'cut', i, ar.customBandsEnabled !== true));
  appendBoundary(' · LP ', ar.lowPassHz, 'lp', 0, true);
}
function syncAudioCutoffs(changed) {
  const ar = state.audioReactive;
  ar.bandCount = Math.max(1, Math.min(5, Math.round(Number(ar.bandCount) || 3)));
  const hpEl = document.getElementById('audioHighPass'),
    lpEl = document.getElementById('audioLowPass');
  if (!hpEl || !lpEl) return;
  const cuts = ['audioCutLow', 'audioCutLowMid', 'audioCutMidHigh', 'audioCutHigh'].map((id) =>
    document.getElementById(id),
  );
  let hp = Math.max(0, Math.min(1000, Number(hpEl.value) || 0)),
    lp = Math.max(0, Math.min(1000, Number(lpEl.value) || 1000));
  if (lp < hp) {
    if (changed === 'lp') hp = lp;
    else lp = hp;
  }
  const needed = ar.bandCount - 1;
  let edgeHz = Array.isArray(ar.masterBandEdges) ? ar.masterBandEdges.slice(0, needed) : [];
  if (!edgeHz.length && needed) edgeHz = getDefaultMasterBandEdges(ar.bandCount);
  let edgePos = edgeHz.map(frequencyToRange);
  while (edgePos.length < needed)
    edgePos.push(
      frequencyToRange(getDefaultMasterBandEdges(ar.bandCount)[edgePos.length] || rangeToFrequency(lp)),
    );
  if (changed && changed.startsWith('cut')) {
    const idx = Number(changed.slice(3));
    if (Number.isInteger(idx) && cuts[idx]) edgePos[idx] = Number(cuts[idx].value) || 0;
  }
  edgePos = edgePos
    .slice(0, needed)
    .map((v) => Math.max(hp, Math.min(lp, v)))
    .sort((a, b) => a - b);
  hpEl.value = String(hp);
  lpEl.value = String(lp);
  cuts.forEach((el, i) => {
    if (!el) return;
    el.style.display = i < needed ? 'block' : 'none';
    if (i < needed) el.value = String(edgePos[i] ?? hp);
  });
  ar.highPassHz = rangeToFrequency(hp);
  ar.lowPassHz = rangeToFrequency(lp);
  ar.masterBandEdges = edgePos.map(rangeToFrequency);
  if (ar.bandCount === 3) {
    ar.lowHz = ar.masterBandEdges[0] || 120;
    ar.highHz = ar.masterBandEdges[1] || 5000;
  }
  renderAudioCutoffSummary();
  const count = document.getElementById('audioBandCount');
  if (count) count.value = String(ar.bandCount);
  const custom = document.getElementById('audioCustomBandsEnabled');
  if (custom) custom.checked = ar.customBandsEnabled === true;
  paintAudioFrequencyTrack(hp, lp);
  if (ar.customBandsEnabled !== true) renderAudioCustomBandRows();
  if (changed === 'count') {
    synchronizeAutomaticLayerAudioBands();
    syncTapUI();
    if (!document.getElementById('audioRoutingPanel')?.classList.contains('hidden'))
      renderAudioRoutingPanel();
  }
  if (changed) {
    ar.levelHistory = [];
    ar.normalizationPeak = 0;
    ar.normalizationFloor = 0;
    state.tapTempo.autoPrevSpectrum = null;
    state.tapTempo.autoFluxHistory = [];
    state.tapTempo.autoBeatTimes = [];
    state.tapTempo.autoFluxPrevSample = null;
    state.tapTempo.autoFluxPrevPrevSample = null;
    state.tapTempo.autoTempoCandidate = 0;
    state.tapTempo.autoTempoCandidateCount = 0;
    state.tapTempo.autoConfidence = 0;
    state.tapTempo.autoTempoEvidence = [];
    state.tapTempo.autoTempoLastApplyAt = 0;
    resetAutoTapBandTrackers();
    resetTempoLock(true);
  }
}
function stopAudioReactive(reason = '') {
  const ar = state.audioReactive;
  animationScheduler.remove('audio');
  ar.raf = 0;
  if (ar.stream) ar.stream.getTracks().forEach((t) => t.stop());
  ar.stream = null;
  if (ar.context) {
    try {
      ar.context.close();
    } catch (error) {
      noteSuppressedError('audio/audio-reactive#stopAudioReactive', error);
    }
  }
  ar.context = null;
  ar.analyser = null;
  ar.data = null;
  ar.timeData = null;
  ar.active = false;
  ar.inputDb = -100;
  ar.gateOpen = true;
  ar.gateGain = 1;
  ar.gateListening = false;
  ar.gateListenSamples = [];
  ar.gateListenStartedAt = 0;
  const gateListenBtn = document.getElementById('btnNoiseGateListen');
  if (gateListenBtn) {
    gateListenBtn.textContent = 'Слушать';
    gateListenBtn.classList.remove('listening');
    gateListenBtn.disabled = false;
  }
  ar.levels = [0, 0, 0, 0, 0];
  ar.smoothedLevels = [0, 0, 0, 0, 0];
  ar.prevLevels = [0, 0, 0, 0, 0];
  ar.derivatives = [0, 0, 0, 0, 0];
  ar.levelHistory = [];
  ar.normalizationPeak = 0;
  ar.normalizationFloor = 0;
  ar.lastAnalysisTime = 0;
  ar.lastMeterPaint = 0;
  if (runtimeState.morph.active) activeRebaseMorphing();
  document.getElementById('btnAudioReactive')?.classList.remove('active');
  document.getElementById('btnMobileMic')?.classList.remove('active');
  syncTapUI();
  const startBtn = document.getElementById('btnAudioStart');
  if (startBtn) startBtn.textContent = 'Старт';
  if (reason && document.getElementById('audioStatus'))
    document.getElementById('audioStatus').textContent = reason;
  document.querySelectorAll('[data-audio-meter]').forEach((m) => (m.style.width = '0%'));
  document.querySelectorAll('[data-audio-value]').forEach((v) => (v.textContent = '0%'));
  paintAudioInputMonitor();
  paintAudioRoutingMeters();
  renderMainCanvas();
}
function audioBandLevel(data, sampleRate, fftSize, fromHz, toHz) {
  const nyquist = sampleRate / 2;
  const from = Math.max(20, Math.min(20000, Number(fromHz) || 20));
  const to = Math.max(20, Math.min(20000, Number(toHz) || 20));

  if (to <= from || from >= nyquist) return 0;

  const clippedTo = Math.min(to, nyquist);
  const binHz = sampleRate / fftSize;
  let a = Math.ceil(from / binHz);
  let b = Math.ceil(clippedTo / binHz);
  a = Math.max(0, Math.min(data.length, a));
  b = Math.max(0, Math.min(data.length, b));
  if (b <= a) return 0;

  let sum = 0;
  for (let i = a; i < b; i++) {
    const x = data[i] / 255;
    sum += x * x;
  }
  return Math.sqrt(sum / (b - a));
}
function normalizeAudioLevels(raw, now = performance.now()) {
  const ar = state.audioReactive;

  const frameLevel = Math.max(0, ...raw);
  ar.levelHistory.push({ time: now, level: frameLevel });

  const windowMs = ar.normalizeLowSignal ? ar.lowSignalWindowMs || 5000 : ar.normalizationWindowMs || 10000;
  const cutoff = now - windowMs;
  let firstValid = 0;
  while (firstValid < ar.levelHistory.length && ar.levelHistory[firstValid].time < cutoff) firstValid++;
  if (firstValid > 0) ar.levelHistory.splice(0, firstValid);

  let peak = 0;
  let floor = Infinity;
  for (const sample of ar.levelHistory) {
    const level = Math.max(0, Number(sample.level) || 0);
    if (level > peak) peak = level;
    if (level < floor) floor = level;
  }

  if (!Number.isFinite(floor)) floor = 0;
  if (!ar.normalizeLowSignal) floor = 0;

  ar.normalizationPeak = peak;
  ar.normalizationFloor = Math.min(floor, peak);

  if (peak <= 1e-7) return raw.map(() => 0);

  const span = peak - ar.normalizationFloor;
  if (ar.normalizeLowSignal && span <= 1e-7) {
    return raw.map(() => 0);
  }

  if (span <= 1e-7) {
    return raw.map((value) => Math.max(0, Math.min(1, value / peak)));
  }

  const normalizedFrame = Math.max(0, Math.min(1, (frameLevel - ar.normalizationFloor) / span));
  if (frameLevel <= 1e-7 || normalizedFrame <= 0) return raw.map(() => 0);

  return raw.map((value) => {
    const relativeToFrame = Math.max(0, Math.min(1, value / frameLevel));
    return relativeToFrame * normalizedFrame;
  });
}
function computeAudioInputDb(samples) {
  if (!samples || !samples.length) return -100;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Number(samples[i]) || 0;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / samples.length);
  if (rms <= 1e-7) return -100;
  return Math.max(-100, Math.min(0, 20 * Math.log10(rms)));
}
function getNoiseGateSoftSpanDb(ar = state.audioReactive) {
  if (!ar?.noiseGateSoftEnabled) return 0;
  const strength = Math.max(0, Math.min(100, Number(ar.noiseGateStrength) || 0));

  return 20 * (1 - strength / 100);
}
function computeNoiseGateGain(inputDb, ar = state.audioReactive) {
  if (!ar?.noiseGateEnabled) return 1;
  const thresholdRaw = Number(ar.noiseGateThresholdDb);
  const levelRaw = Number(inputDb);
  const threshold = Math.max(-100, Math.min(0, Number.isFinite(thresholdRaw) ? thresholdRaw : -37));
  const level = Math.max(-100, Math.min(0, Number.isFinite(levelRaw) ? levelRaw : -100));
  if (level >= threshold) return 1;
  const spanDb = getNoiseGateSoftSpanDb(ar);
  if (spanDb <= 0.001) return 0;
  const floorDb = threshold - spanDb;
  if (level <= floorDb) return 0;
  return Math.max(0, Math.min(1, (level - floorDb) / spanDb));
}
function paintAudioInputMonitor() {
  const ar = state.audioReactive;
  const label = document.getElementById('audioInputDbText');
  const fill = document.getElementById('audioInputLevelFill');
  const meter = document.getElementById('audioInputLevelMeter');
  const range = document.getElementById('audioNoiseGateThresholdRange');
  const number = document.getElementById('audioNoiseGateThreshold');
  const thresholdDb = Math.max(-100, Math.min(0, Number(ar.noiseGateThresholdDb) || -37));
  const inputDb = ar.active && Number.isFinite(ar.inputDb) ? Math.max(-100, Math.min(0, ar.inputDb)) : -100;
  const levelPct = Math.max(0, Math.min(100, inputDb + 100));
  if (fill) fill.style.width = `${levelPct}%`;
  if (meter) meter.classList.toggle('gated', !!ar.noiseGateEnabled && (Number(ar.gateGain) || 0) < 0.999);
  if (range && document.activeElement !== range) range.value = String(Math.round(thresholdDb));
  if (number && document.activeElement !== number) number.value = String(Math.round(thresholdDb));
  if (label) {
    if (!ar.active) label.textContent = '— dBFS';
    else {
      const gain = Math.max(0, Math.min(1, Number(ar.gateGain) || 0));
      const gateState = !ar.noiseGateEnabled
        ? ''
        : gain <= 0.001
          ? ' · GATED'
          : gain >= 0.999
            ? ' · OPEN'
            : ` · SOFT ${Math.round(gain * 100)}%`;
      label.textContent = `${inputDb <= -99.5 ? '≤−100' : inputDb.toFixed(1)} dBFS${gateState}`;
    }
  }
}
function finishNoiseGateListening() {
  const ar = state.audioReactive;
  if (!ar.gateListening) return;
  ar.gateListening = false;
  const button = document.getElementById('btnNoiseGateListen');
  if (button) {
    button.textContent = 'Слушать';
    button.classList.remove('listening');
    button.disabled = false;
  }
  const samples = Array.isArray(ar.gateListenSamples) ? ar.gateListenSamples.filter(Number.isFinite) : [];
  ar.gateListenSamples = [];
  if (!samples.length) return;
  samples.sort((a, b) => a - b);
  const p95 = samples[Math.min(samples.length - 1, Math.floor((samples.length - 1) * 0.95))];

  const softSpanDb = getNoiseGateSoftSpanDb(ar);

  const threshold = Math.max(-100, Math.min(0, Math.round(p95 + 3 + softSpanDb)));
  ar.noiseGateThresholdDb = threshold;
  ar.noiseGateEnabled = true;
  ar.gateGain = computeNoiseGateGain(ar.inputDb, ar);
  ar.gateOpen = ar.gateGain > 0.001;
  ar.levelHistory = [];
  ar.normalizationPeak = 0;
  ar.normalizationFloor = 0;
  ar.levels = [0, 0, 0, 0, 0];
  ar.smoothedLevels = [0, 0, 0, 0, 0];
  ar.prevLevels = [0, 0, 0, 0, 0];
  ar.derivatives = [0, 0, 0, 0, 0];
  state.tapTempo.autoPrevSpectrum = null;
  const enabled = document.getElementById('audioNoiseGateEnabled');
  const number = document.getElementById('audioNoiseGateThreshold');
  const range = document.getElementById('audioNoiseGateThresholdRange');
  if (enabled) enabled.checked = true;
  if (number) number.value = String(threshold);
  if (range) range.value = String(threshold);
  paintAudioInputMonitor();
  renderMainCanvas();
}
async function startNoiseGateListening() {
  const ar = state.audioReactive;
  const button = document.getElementById('btnNoiseGateListen');
  if (ar.gateListening) return;
  if (!ar.active) {
    if (button) {
      button.textContent = 'Запуск…';
      button.disabled = true;
    }
    await startAudioReactive();
    if (button) button.disabled = false;
    if (!ar.active) {
      if (button) button.textContent = 'Слушать';
      return;
    }
  }
  ar.gateListening = true;
  ar.gateListenStartedAt = performance.now();
  ar.gateListenSamples = [];
  if (button) {
    button.textContent = 'Слушаю…';
    button.classList.add('listening');
    button.disabled = true;
  }
}
function getAudioInputSmoothingResponse(ar, dtMs) {
  if (!ar?.inputSmoothingEnabled) return 1;
  const strength = Math.max(0, Math.min(100, Number(ar.inputSmoothingStrength) || 0)) / 100;
  const multiplier = Math.max(0, Number(ar.inputSmoothingMultiplier) || 0);
  const effective = strength * multiplier;
  if (effective <= 0.000001) return 1;

  const tauMs = Math.max(1, 500 * effective);
  return Math.max(0.0001, Math.min(1, 1 - Math.exp(-Math.max(1, dtMs) / tauMs)));
}
function getAudioMasterGain(ar) {
  const strength = Math.max(0, Math.min(200, Number(ar?.masterGainStrength) || 0)) / 50;
  const multiplier = Math.max(0, Number(ar?.masterGainMultiplier) || 0);
  return Math.max(0, strength * multiplier);
}
function audioReactiveFrame(now = performance.now()) {
  const ar = state.audioReactive;
  if (!ar.active || !ar.analyser || !ar.data) return false;

  const analysisInterval = Math.max(16, Number(ar.analysisIntervalMs) || 40);
  if (!ar.lastAnalysisTime || now - ar.lastAnalysisTime >= analysisInterval) {
    const analysisDtMs = ar.lastAnalysisTime ? Math.max(1, now - ar.lastAnalysisTime) : analysisInterval;
    ar.lastAnalysisTime = now;
    ar.analyser.getByteFrequencyData(ar.data);
    if (ar.timeData && ar.analyser.getFloatTimeDomainData) ar.analyser.getFloatTimeDomainData(ar.timeData);
    ar.inputDb = computeAudioInputDb(ar.timeData);
    if (ar.gateListening) {
      ar.gateListenSamples.push(ar.inputDb);
      if (now - ar.gateListenStartedAt >= Math.max(500, Number(ar.gateListenDurationMs) || 2000))
        finishNoiseGateListening();
    }
    ar.gateGain = computeNoiseGateGain(ar.inputDb, ar);
    ar.gateOpen = !ar.noiseGateEnabled || ar.gateGain > 0.001;
    if (ar.gateGain > 0.001)
      analyzeAutoTap(ar.data, now, ar.context.sampleRate, ar.analyser.fftSize, ar.gateGain);
    else {
      state.tapTempo.autoPrevSpectrum = null;
      if (state.tapTempo.autoTap && chooseStableAutoTapBand(now)) syncTapUI();
    }
    const sr = ar.context.sampleRate;
    const ranges = getAudioBandRangesForAnalysis();
    const activeKeys = new Set(getActiveAudioBandKeys());
    const canonical = ['low', 'lowMid', 'mid', 'midHigh', 'high'];
    const raw = canonical.map((k) =>
      ar.gateGain > 0.001 && activeKeys.has(k)
        ? audioBandLevel(ar.data, sr, ar.analyser.fftSize, ranges[k][0], ranges[k][1])
        : 0,
    );
    const normalizedLevels = normalizeAudioLevels(raw, now);
    const smoothingResponse = getAudioInputSmoothingResponse(ar, analysisDtMs);
    const masterGain = getAudioMasterGain(ar);
    if (!Array.isArray(ar.smoothedLevels) || ar.smoothedLevels.length !== 5)
      ar.smoothedLevels = [0, 0, 0, 0, 0];
    if (!Array.isArray(ar.prevLevels) || ar.prevLevels.length !== 5) ar.prevLevels = [0, 0, 0, 0, 0];
    if (!Array.isArray(ar.derivatives) || ar.derivatives.length !== 5) ar.derivatives = [0, 0, 0, 0, 0];
    if (!Array.isArray(ar.levels) || ar.levels.length !== 5) ar.levels = [0, 0, 0, 0, 0];
    const bandGainMap = ar.bandGains || (ar.bandGains = { low: 1, lowMid: 1, mid: 1, midHigh: 1, high: 1 });
    for (let i = 0; i < 5; i++) {
      const bandKey = canonical[i],
        localGain = Number.isFinite(Number(bandGainMap[bandKey]))
          ? Math.max(0, Number(bandGainMap[bandKey]))
          : 1;

      const normalized = normalizedLevels[i] * ar.gateGain * localGain;
      const previousSmoothed = Number(ar.smoothedLevels[i]) || 0;

      const smoothed = previousSmoothed + (normalized - previousSmoothed) * smoothingResponse;
      ar.smoothedLevels[i] = smoothed;
      const mastered = Math.max(0, Math.min(1, smoothed * masterGain));
      ar.derivatives[i] = (mastered - (Number(ar.prevLevels[i]) || 0)) * 9.0;
      ar.prevLevels[i] = mastered;
      ar.levels[i] = mastered;
    }

    const meterInterval = Math.max(16, Number(ar.meterIntervalMs) || 40);
    if (!ar.lastMeterPaint || now - ar.lastMeterPaint >= meterInterval) {
      ar.lastMeterPaint = now;
      // Hidden meters must not consume DOM/layout time on the audio tick.
      // Only presentation is skipped; frequency analysis, routing and Morph
      // modulation are intentionally left untouched.
      const audioPanel = document.getElementById('audioReactivePanel');
      if (audioPanel && !audioPanel.classList.contains('hidden')) {
        for (const key of getActiveAudioBandKeys()) {
          const i = AUDIO_BAND_INDEX[key],
            pct = Math.round((Number(ar.levels[i]) || 0) * 100);
          const meter = audioPanel.querySelector(`[data-audio-meter="${key}"]`),
            val = audioPanel.querySelector(`[data-audio-value="${key}"]`);
          if (meter && meter.style.width !== pct + '%') meter.style.width = pct + '%';
          if (val && val.textContent !== pct + '%') val.textContent = pct + '%';
        }
        paintAudioInputMonitor();
      }
      paintAudioRoutingMeters();
    }
    requestMainCanvasRender();
  }
  ar.raf = 0;
  return true;
}
function isMobileAudioEnvironment() {
  return (
    window.matchMedia('(max-width: 760px)').matches ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
  );
}
function isTelegramProviderContext() {
  const href = String(location.href || '');
  return location.protocol === 'content:' || /org\.telegram\.messenger\.provider/i.test(href);
}
function detectAudioBrowser() {
  const ua = navigator.userAgent || '';
  const opera = ua.match(/(?:OPR|Opera)[\/]([\d.]+)/i);
  const edge = ua.match(/Edg[\/]([\d.]+)/i);
  const chrome = ua.match(/Chrome[\/]([\d.]+)/i);
  const firefox = ua.match(/Firefox[\/]([\d.]+)/i);
  const safari = !chrome && ua.match(/Version[\/]([\d.]+).*Safari/i);
  if (opera) return { name: 'Opera', version: opera[1] || '—' };
  if (edge) return { name: 'Edge', version: edge[1] || '—' };
  if (chrome) return { name: 'Chrome/Chromium', version: chrome[1] || '—' };
  if (firefox) return { name: 'Firefox', version: firefox[1] || '—' };
  if (safari) return { name: 'Safari', version: safari[1] || '—' };
  return { name: 'Не определён', version: '—' };
}
function microphonePermissionPolicyState() {
  try {
    if (document.permissionsPolicy?.allowsFeature)
      return document.permissionsPolicy.allowsFeature('microphone') ? 'allowed' : 'blocked';
    if (document.featurePolicy?.allowsFeature)
      return document.featurePolicy.allowsFeature('microphone') ? 'allowed' : 'blocked';
  } catch (error) {
    noteSuppressedError('audio/audio-reactive#microphonePermissionPolicyState', error);
  }
  return 'unknown';
}
async function queryMicrophonePermissionState() {
  if (!navigator.permissions?.query) return 'API unavailable';
  try {
    const result = await navigator.permissions.query({ name: 'microphone' });
    return result?.state || 'unknown';
  } catch (_) {
    return 'not exposed by browser';
  }
}
async function enumerateMicrophoneSummary() {
  if (!navigator.mediaDevices?.enumerateDevices) return { count: null, labels: [] };
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const inputs = devices.filter((d) => d.kind === 'audioinput');
    return {
      count: inputs.length,
      labels: inputs.map((d, i) => d.label || `Микрофон ${i + 1} (название скрыто до разрешения)`),
    };
  } catch (err) {
    return { count: null, labels: [], error: `${err?.name || 'Error'}: ${err?.message || err}` };
  }
}
async function updateMicrophoneDiagnostics({
  error = null,
  stream = null,
  context = null,
  autoOpen = false,
} = {}) {
  const details = document.getElementById('audioDiagnostics');
  const out = document.getElementById('audioDiagnosticsText');
  if (!out) return;
  const browser = detectAudioBrowser();
  const permission = await queryMicrophonePermissionState();
  const devices = await enumerateMicrophoneSummary();
  const policy = microphonePermissionPolicyState();
  const topLevel = (() => {
    try {
      return window.top === window.self;
    } catch (_) {
      return false;
    }
  })();
  const gum = !!navigator.mediaDevices?.getUserMedia;
  const legacy = !!(navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia);
  const track = stream?.getAudioTracks?.()[0] || state.audioReactive.stream?.getAudioTracks?.()[0] || null;
  const ctx = context || state.audioReactive.context || null;
  const lines = [
    `Браузер: ${browser.name} ${browser.version}`,
    `Платформа: ${navigator.platform || '—'}${/Android/i.test(navigator.userAgent || '') ? ' / Android' : ''}`,
    `Протокол: ${location.protocol || '—'}`,
    `Secure context: ${window.isSecureContext ? 'YES' : 'NO'}`,
    `Top-level document: ${topLevel ? 'YES' : 'NO'}`,
    `Microphone Permissions Policy: ${policy}`,
    `navigator.mediaDevices: ${navigator.mediaDevices ? 'YES' : 'NO'}`,
    `getUserMedia: ${gum ? 'YES' : legacy ? 'LEGACY' : 'NO'}`,
    `Permission state: ${permission}`,
    `Audio inputs: ${devices.count == null ? 'не удалось определить' : devices.count}`,
    `AudioContext: ${ctx ? ctx.state : 'не создан'}`,
    `Активный трек: ${track ? track.label || 'audio track' : 'нет'}`,
  ];
  if (track) {
    const s = track.getSettings ? track.getSettings() : {};
    lines.push(`Track state: ${track.readyState}; enabled=${track.enabled}; muted=${track.muted}`);
    if (s.sampleRate) lines.push(`Sample rate: ${s.sampleRate} Hz`);
    if (s.channelCount) lines.push(`Channels: ${s.channelCount}`);
  }
  if (devices.labels?.length) lines.push(`Входы: ${devices.labels.join(' | ')}`);
  if (devices.error) lines.push(`enumerateDevices: ${devices.error}`);
  if (error) {
    lines.push(`Последняя ошибка: ${error?.name || 'Error'}`);
    lines.push(`Сообщение: ${error?.message || String(error)}`);
  }
  if (browser.name === 'Opera') {
    if (permission === 'denied')
      lines.push(
        'Opera: разрешение для этого origin/site сейчас запрещено. Откройте Settings → Privacy & security → Site settings → Microphone.',
      );
    else if (permission === 'prompt')
      lines.push('Opera: разрешение ещё не принято. Нажмите «Старт» и подтвердите запрос микрофона.');
    if (location.protocol === 'file:')
      lines.push(
        'Opera + file://: страница считается secure context, но если локальному файлу не выдаётся разрешение, проверьте ту же версию через http://localhost или HTTPS.',
      );
  }
  if (!window.isSecureContext) lines.push('Нужен HTTPS, localhost или другой secure context.');
  if (!topLevel)
    lines.push(
      'Встроенный iframe/viewer может блокировать microphone; откройте приложение как верхнюю страницу.',
    );
  if (policy === 'blocked') lines.push('Permissions Policy текущего контейнера запрещает microphone.');
  out.textContent = lines.join('\n');
  if (details) {
    if (autoOpen) {
      details.classList.remove('hidden');
      details.open = true;
    } else if (stream) {
      details.open = false;
      details.classList.add('hidden');
    }
  }
}
async function requestMicrophoneStreamCompat() {
  const constraints = { audio: true, video: false };
  if (navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === 'function') {
    return navigator.mediaDevices.getUserMedia(constraints);
  }
  const legacy = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;
  if (typeof legacy === 'function') {
    return new Promise((resolve, reject) => legacy.call(navigator, constraints, resolve, reject));
  }
  const e = new Error('Этот режим просмотра не предоставляет браузерный API микрофона.');
  e.name = 'NotSupportedError';
  throw e;
}
function microphoneFailureMessage(err) {
  const name = err?.name || '';
  const browser = detectAudioBrowser();
  const telegramProvider = isTelegramProviderContext();
  const insecure = !window.isSecureContext;
  const embedded = (() => {
    try {
      return window.top !== window.self;
    } catch (_) {
      return true;
    }
  })();

  if (telegramProvider) {
    return 'Файл открыт через Telegram/Android content provider. Такой просмотрщик может не дать странице origin/permission для микрофона. Скачайте HTML и откройте напрямую в браузере либо по HTTPS/localhost.';
  }
  if (insecure) return 'Микрофон требует secure context. Откройте приложение по HTTPS или localhost.';
  if (
    !navigator.mediaDevices?.getUserMedia &&
    !navigator.getUserMedia &&
    !navigator.webkitGetUserMedia &&
    !navigator.mozGetUserMedia
  ) {
    return 'Этот браузер/контекст не предоставляет getUserMedia(). Откройте приложение напрямую в обычной вкладке современного браузера.';
  }
  if (embedded && (name === 'NotAllowedError' || name === 'SecurityError')) {
    return 'Встроенный viewer/iframe не разрешил микрофон. Откройте приложение напрямую как верхнюю страницу.';
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return browser.name === 'Opera'
      ? 'Opera отклонила запрос микрофона. Откройте «Диагностика микрофона / Opera»: если Permission state = denied, разрешите микрофон в Opera → Settings → Privacy & security → Site settings → Microphone и проверьте системное разрешение Opera на микрофон.'
      : 'Браузер/система отклонили запрос микрофона. Проверьте разрешение микрофона для браузера и для текущего сайта.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError')
    return 'Аудиовход не найден. Проверьте, видит ли система микрофон, и выбран ли он в настройках браузера.';
  if (name === 'NotReadableError' || name === 'TrackStartError')
    return 'Микрофон разрешён, но браузер не смог открыть устройство. Оно может быть занято другим приложением либо заблокировано системными настройками приватности.';
  if (name === 'OverconstrainedError')
    return 'Выбранный аудиовход не удовлетворяет ограничениям. Сбросьте выбранное устройство и повторите.';
  if (name === 'AbortError')
    return 'Браузер прервал запуск аудиоустройства. Попробуйте закрыть другие программы с микрофоном и запустить снова.';
  return err?.message || 'Не удалось открыть микрофон.';
}
async function startAudioReactive(forceSource = null) {
  if (state.audioReactive.active) {
    const sameForced = !forceSource || state.audioReactive.source === forceSource;
    stopAudioReactive('Цветомузыка остановлена.');
    if (sameForced) return;
  }
  ensureAudioLayers();
  if (runtimeState.morph.active) activeRebaseMorphing();
  const sourceType = forceSource || document.getElementById('audioSourceSelect')?.value || 'system';
  const sourceSelect = document.getElementById('audioSourceSelect');
  if (sourceSelect && forceSource) sourceSelect.value = forceSource;
  const status = document.getElementById('audioStatus');

  let stream = null;
  let ctx = null;
  let primeResume = Promise.resolve();
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx)
      throw Object.assign(new Error('Web Audio API недоступен в этом браузере.'), {
        name: 'NotSupportedError',
      });

    ctx = new AudioCtx({ latencyHint: 'interactive' });
    primeResume = ctx.resume().catch(() => null);

    if (sourceType === 'microphone') {
      if (status) status.textContent = 'Запрашиваем разрешение на микрофон…';

      stream = await requestMicrophoneStreamCompat();
    } else {
      if (isMobileAudioEnvironment()) {
        throw Object.assign(
          new Error('Внутренний системный звук Android/iOS недоступен обычной веб-странице.'),
          { name: 'NotSupportedError' },
        );
      }
      if (!navigator.mediaDevices?.getDisplayMedia)
        throw Object.assign(new Error('Screen Capture API недоступен в этом браузере.'), {
          name: 'NotSupportedError',
        });
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
        systemAudio: 'include',
      });
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((t) => t.stop());
        stream = null;
        throw new Error('Аудио не передано. В окне выбора включите «Поделиться аудио» / Share audio.');
      }
      stream.getVideoTracks().forEach((t) => t.stop());
    }

    if (!stream?.getAudioTracks?.().length)
      throw Object.assign(new Error('Браузер вернул MediaStream без аудиодорожки.'), {
        name: 'NotFoundError',
      });

    await primeResume;
    if (ctx.state !== 'running') {
      try {
        await ctx.resume();
      } catch (error) {
        noteSuppressedError('audio/audio-reactive#startAudioReactive', error);
      }
    }

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;

    analyser.smoothingTimeConstant = 0;
    const node = ctx.createMediaStreamSource(stream);
    node.connect(analyser);
    const ar = state.audioReactive;
    ar.source = sourceType;
    ar.stream = stream;
    ar.context = ctx;
    ar.analyser = analyser;
    ar.data = new Uint8Array(analyser.frequencyBinCount);
    ar.timeData = new Float32Array(analyser.fftSize);
    ar.active = true;
    ar.inputDb = -100;
    ar.gateOpen = true;
    ar.gateGain = 1;
    ar.levels = [0, 0, 0, 0, 0];
    ar.smoothedLevels = [0, 0, 0, 0, 0];
    ar.prevLevels = [0, 0, 0, 0, 0];
    ar.derivatives = [0, 0, 0, 0, 0];
    ar.levelHistory = [];
    ar.normalizationPeak = 0;
    ar.normalizationFloor = 0;
    ar.lastAnalysisTime = 0;
    ar.lastMeterPaint = 0;
    if (runtimeState.morph.active) activeRebaseMorphing();
    stream
      .getAudioTracks()
      .forEach((t) => t.addEventListener('ended', () => stopAudioReactive('Источник аудио отключён.')));
    document.getElementById('btnAudioReactive')?.classList.add('active');
    document.getElementById('btnMobileMic')?.classList.toggle('active', sourceType === 'microphone');
    syncTapUI();
    document.getElementById('btnAudioStart').textContent = 'Стоп';

    const track = stream.getAudioTracks()[0];
    if (status) {
      if (sourceType === 'microphone') {
        const label = track?.label ? ` · ${track.label}` : '';
        status.textContent =
          ctx.state === 'running'
            ? `Микрофон активен${label}.`
            : `Микрофон разрешён${label}, но Web Audio пока ${ctx.state}. Коснитесь «Старт» ещё раз, если индикатор не движется.`;
      } else status.textContent = 'Системный звук активен · низкая задержка.';
    }
    if (sourceType === 'microphone')
      void updateMicrophoneDiagnostics({ stream, context: ctx, autoOpen: false });
    animationScheduler.add('audio', audioReactiveFrame);
    requestMainCanvasRender();
  } catch (err) {
    try {
      stream?.getTracks?.().forEach((t) => t.stop());
    } catch (error) {
      noteSuppressedError('audio/audio-reactive#startAudioReactive', error);
    }
    try {
      if (ctx && ctx !== state.audioReactive.context) await ctx.close();
    } catch (error) {
      noteSuppressedError('audio/audio-reactive#startAudioReactive', error);
    }
    let message = err?.message || String(err || 'неизвестная ошибка');
    if (sourceType === 'microphone') {
      message = microphoneFailureMessage(err);
      document.getElementById('audioReactivePanel')?.classList.remove('hidden');
      document.getElementById('btnMobileMic')?.setAttribute('aria-expanded', 'true');
      void updateMicrophoneDiagnostics({ error: err, autoOpen: true });
    } else if (isMobileAudioEnvironment()) {
      message =
        'Системный звук Android/iOS нельзя получить из обычного HTML-приложения: мобильный браузер не передаёт аудио других приложений. Используйте микрофон или десктопный захват системного звука.';
    }
    stopAudioReactive(`Не удалось запустить: ${message}`);
  }
}
function frequencyToRangeValue(hz) {
  const clamped = Math.max(20, Math.min(20000, Number(hz) || 20));
  const min = Math.log10(20),
    max = Math.log10(20000);
  return ((Math.log10(clamped) - min) / (max - min)) * 1000;
}
function syncAudioSettingsUIFromState() {
  const ar = state.audioReactive;
  const source = document.getElementById('audioSourceSelect');
  const hp = document.getElementById('audioHighPass');
  const low = document.getElementById('audioCutLow');
  const high = document.getElementById('audioCutHigh');
  const lp = document.getElementById('audioLowPass');
  const norm = document.getElementById('audioNormalizeLowSignal');
  const reactionInterval = document.getElementById('audioReactionInterval');
  const noiseGateEnabled = document.getElementById('audioNoiseGateEnabled');
  const noiseGateThreshold = document.getElementById('audioNoiseGateThreshold');
  const noiseGateThresholdRange = document.getElementById('audioNoiseGateThresholdRange');
  const noiseGateSoftEnabled = document.getElementById('audioNoiseGateSoftEnabled');
  const noiseGateStrength = document.getElementById('audioNoiseGateStrength');
  const noiseGateStrengthNumber = document.getElementById('audioNoiseGateStrengthNumber');
  const noiseGateSoftRow = document.getElementById('audioNoiseGateSoftRow');
  const inputSmoothingEnabled = document.getElementById('audioInputSmoothingEnabled');
  const inputSmoothingStrength = document.getElementById('audioInputSmoothingStrength');
  const inputSmoothingMultiplier = document.getElementById('audioInputSmoothingMultiplier');
  const inputSmoothingRow = document.getElementById('audioInputSmoothingRow');
  const inputSmoothingText = document.getElementById('audioInputSmoothingText');
  const masterGainStrength = document.getElementById('audioMasterGainStrength');
  const masterGainMultiplier = document.getElementById('audioMasterGainMultiplier');
  const masterGainText = document.getElementById('audioMasterGainText');
  const sizeStrength = document.getElementById('audioSizeStrength');
  const sizeMultiplier = document.getElementById('audioSizeMultiplier');
  const rotationEnabled = document.getElementById('audioRotationEnabled');
  const rotationStrength = document.getElementById('audioRotationStrength');
  const rotationMultiplier = document.getElementById('audioRotationMultiplier');
  if (source) source.value = ar.source === 'microphone' ? 'microphone' : 'system';
  if (reactionInterval) {
    const supported = [16, 24, 40, 60, 80, 120, 160, 240];
    const requested = Math.max(
      16,
      Math.min(240, Math.round(Number(ar.analysisIntervalMs) || Number(ar.meterIntervalMs) || 40)),
    );
    const reactionMs = supported.reduce(
      (best, value) => (Math.abs(value - requested) < Math.abs(best - requested) ? value : best),
      supported[0],
    );
    ar.analysisIntervalMs = reactionMs;
    ar.meterIntervalMs = reactionMs;
    reactionInterval.value = String(reactionMs);
  }
  if (hp) hp.value = String(frequencyToRangeValue(ar.highPassHz));
  if (low) low.value = String(frequencyToRangeValue(ar.lowHz));
  if (high) high.value = String(frequencyToRangeValue(ar.highHz));
  if (lp) lp.value = String(frequencyToRangeValue(ar.lowPassHz));
  if (norm) norm.checked = !!ar.normalizeLowSignal;
  if (noiseGateEnabled) noiseGateEnabled.checked = !!ar.noiseGateEnabled;
  if (noiseGateThreshold)
    noiseGateThreshold.value = String(Math.max(-100, Math.min(0, Number(ar.noiseGateThresholdDb) || -37)));
  if (noiseGateThresholdRange)
    noiseGateThresholdRange.value = String(
      Math.max(-100, Math.min(0, Number(ar.noiseGateThresholdDb) || -37)),
    );
  if (noiseGateSoftEnabled) noiseGateSoftEnabled.checked = !!ar.noiseGateSoftEnabled;
  const gateStrength = Math.round(Math.max(0, Math.min(100, Number(ar.noiseGateStrength) || 0)));
  if (noiseGateStrength) noiseGateStrength.value = String(gateStrength);
  if (noiseGateStrengthNumber) noiseGateStrengthNumber.value = String(gateStrength);
  if (noiseGateSoftRow) noiseGateSoftRow.classList.toggle('soft-disabled', !ar.noiseGateSoftEnabled);
  const smoothingEnabled = ar.inputSmoothingEnabled === true;
  const smoothingStrength = Math.max(0, Math.min(100, Number(ar.inputSmoothingStrength) || 0));
  const smoothingMultiplier = Math.max(0, Number(ar.inputSmoothingMultiplier) || 0);
  if (inputSmoothingEnabled) inputSmoothingEnabled.checked = smoothingEnabled;
  if (inputSmoothingStrength) {
    inputSmoothingStrength.value = String(Math.round(smoothingStrength));
    inputSmoothingStrength.disabled = !smoothingEnabled;
  }
  if (inputSmoothingMultiplier) {
    inputSmoothingMultiplier.value = String(smoothingMultiplier);
    inputSmoothingMultiplier.disabled = !smoothingEnabled;
  }
  if (inputSmoothingRow) inputSmoothingRow.classList.toggle('disabled', !smoothingEnabled);
  if (inputSmoothingText)
    inputSmoothingText.textContent = `${Math.round(smoothingStrength)}% × ${formatDisplayNumber(smoothingMultiplier, 2)}`;
  const masterStrength = Math.max(
    0,
    Math.min(200, Number.isFinite(Number(ar.masterGainStrength)) ? Number(ar.masterGainStrength) : 50),
  );
  const masterMultiplier = Math.max(
    0,
    Number.isFinite(Number(ar.masterGainMultiplier)) ? Number(ar.masterGainMultiplier) : 1,
  );
  if (masterGainStrength) masterGainStrength.value = String(Math.round(masterStrength));
  if (masterGainMultiplier) masterGainMultiplier.value = String(masterMultiplier);
  if (masterGainText)
    masterGainText.textContent = `${Math.round(masterStrength)}% × ${formatDisplayNumber(masterMultiplier, 2)}`;
  if (sizeStrength)
    sizeStrength.value = String(Math.round(Math.max(0, Math.min(2, Number(ar.sizeStrength) || 0)) * 100));
  if (sizeMultiplier) sizeMultiplier.value = String(Math.max(0, Number(ar.sizeMultiplier) || 0));
  if (rotationEnabled) rotationEnabled.checked = !!ar.rotationEnabled;
  if (rotationStrength)
    rotationStrength.value = String(
      Math.round(Math.max(0, Math.min(2, Number(ar.rotationStrength) || 0)) * 100),
    );
  if (rotationMultiplier) rotationMultiplier.value = String(Math.max(0, Number(ar.rotationMultiplier) || 0));

  syncAudioCutoffs();
  paintAudioInputMonitor();
  norm?.dispatchEvent(new Event('change', { bubbles: true }));
  inputSmoothingEnabled?.dispatchEvent(new Event('change', { bubbles: true }));
  sizeStrength?.dispatchEvent(new Event('input', { bubbles: true }));
  rotationEnabled?.dispatchEvent(new Event('change', { bubbles: true }));
}
function setupAudioReactiveUI() {
  const panel = document.getElementById('audioReactivePanel');
  const micBtn = document.getElementById('btnMobileMic');
  const sourceSelect = document.getElementById('audioSourceSelect');
  const systemOption = sourceSelect?.querySelector('option[value="system"]');
  const mobileAudioQuery = window.matchMedia(
    '(max-width: 760px), (max-height: 480px) and (hover: none) and (pointer: coarse)',
  );

  const setAudioPanelOpen = (open) => {
    panel?.classList.toggle('hidden', !open);
    micBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    document.getElementById('btnAudioReactive')?.setAttribute('aria-expanded', open ? 'true' : 'false');
  };

  const applyMobileAudioSourceDefaults = () => {
    const mobile = mobileAudioQuery.matches || isMobileAudioEnvironment();
    if (systemOption) {
      // Selecting PC audio is the default on every device. An unsupported
      // mobile browser will explain the limitation upon Start; it must
      // never silently switch the project to the microphone.
      systemOption.disabled = false;
      systemOption.textContent = mobile
        ? 'Слушать ПК (на мобильном может быть недоступно)'
        : 'Слушать ПК (системный звук / экран)';
    }
    const status = document.getElementById('audioStatus');
    if (
      mobile &&
      sourceSelect &&
      !state.audioReactive.active &&
      state.audioReactive.source === 'system' &&
      status
    ) {
      status.textContent =
        'По умолчанию выбран звук ПК. На мобильных системный захват может быть недоступен; при необходимости выберите микрофон вручную.';
    }
  };

  document.getElementById('btnAudioReactive')?.addEventListener('click', (e) => {
    const willOpen = panel?.classList.contains('hidden') !== false;
    setAudioPanelOpen(willOpen);
    document.getElementById('btnAudioReactive')?.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    if (willOpen) {
      applyMobileAudioSourceDefaults();
      void updateMicrophoneDiagnostics({ autoOpen: false });
      positionFloatingPanelNearTrigger?.(panel, e.currentTarget);
    }
  });
  document.getElementById('btnCloseAudioPanel')?.addEventListener('click', () => setAudioPanelOpen(false));
  document.getElementById('btnAudioDiagnostics')?.addEventListener('click', () => {
    void updateMicrophoneDiagnostics({ autoOpen: true });
  });
  document.getElementById('btnHideAudioDiagnostics')?.addEventListener('click', () => {
    const diagnostics = document.getElementById('audioDiagnostics');
    if (diagnostics) {
      diagnostics.open = false;
      diagnostics.classList.add('hidden');
    }
  });
  document.getElementById('btnAudioStart')?.addEventListener('click', () => {
    void startAudioReactive();
  });
  sourceSelect?.addEventListener('change', (e) => {
    if (state.audioReactive.active) stopAudioReactive('Источник изменён. Нажмите «Старт».');
    state.audioReactive.source = e.target.value === 'microphone' ? 'microphone' : 'system';
    const status = document.getElementById('audioStatus');
    if (status)
      status.textContent =
        e.target.value === 'microphone'
          ? 'Источник: микрофон. Нажмите «Старт», чтобы запросить разрешение Android/браузера.'
          : isMobileAudioEnvironment()
            ? 'Системный звук других приложений недоступен мобильной веб-странице.'
            : 'Источник: системный звук / экран. В окне захвата включите передачу аудио.';
  });
  document.getElementById('audioHighPass')?.addEventListener('input', () => syncAudioCutoffs('hp'));
  ['audioCutLow', 'audioCutLowMid', 'audioCutMidHigh', 'audioCutHigh'].forEach((id, i) =>
    document.getElementById(id)?.addEventListener('input', () => syncAudioCutoffs('cut' + i)),
  );
  document.getElementById('audioLowPass')?.addEventListener('input', () => syncAudioCutoffs('lp'));
  document.getElementById('audioBandCount')?.addEventListener('change', (e) => {
    state.audioReactive.bandCount = Math.max(1, Math.min(5, Math.round(Number(e.target.value) || 3)));
    state.audioReactive.masterBandEdges = getDefaultMasterBandEdges(state.audioReactive.bandCount);
    renderAudioMeters();
    renderAudioCustomBandRows();
    syncAudioCutoffs('count');
  });
  document.getElementById('audioCustomBandsEnabled')?.addEventListener('change', (e) => {
    state.audioReactive.customBandsEnabled = e.target.checked === true;
    renderAudioCustomBandRows();
    renderAudioMeters();
    syncAudioCutoffs('custom');
  });

  const reactionInterval = document.getElementById('audioReactionInterval');
  const syncReactionInterval = () => {
    const supported = [16, 24, 40, 60, 80, 120, 160, 240];
    const requested = Math.round(Number(reactionInterval?.value) || 40);
    const interval = supported.includes(requested) ? requested : 40;
    state.audioReactive.analysisIntervalMs = interval;
    state.audioReactive.meterIntervalMs = interval;
    if (reactionInterval) reactionInterval.value = String(interval);
    state.audioReactive.lastAnalysisTime = 0;
    state.audioReactive.lastMeterPaint = 0;
  };
  reactionInterval?.addEventListener('change', syncReactionInterval);

  const noiseGateEnabled = document.getElementById('audioNoiseGateEnabled');
  const noiseGateThreshold = document.getElementById('audioNoiseGateThreshold');
  const noiseGateThresholdRange = document.getElementById('audioNoiseGateThresholdRange');
  const noiseGateListen = document.getElementById('btnNoiseGateListen');
  const noiseGateSoftEnabled = document.getElementById('audioNoiseGateSoftEnabled');
  const noiseGateStrength = document.getElementById('audioNoiseGateStrength');
  const noiseGateStrengthNumber = document.getElementById('audioNoiseGateStrengthNumber');
  const noiseGateSoftRow = document.getElementById('audioNoiseGateSoftRow');
  const applyNoiseGateThreshold = (raw) => {
    const threshold = Math.max(-100, Math.min(0, Number(raw) || -37));
    state.audioReactive.noiseGateThresholdDb = threshold;
    if (noiseGateThreshold) noiseGateThreshold.value = String(Math.round(threshold));
    if (noiseGateThresholdRange) noiseGateThresholdRange.value = String(Math.round(threshold));
    state.audioReactive.levelHistory = [];
    state.audioReactive.normalizationPeak = 0;
    state.audioReactive.normalizationFloor = 0;
    state.audioReactive.gateGain = computeNoiseGateGain(state.audioReactive.inputDb, state.audioReactive);
    state.audioReactive.gateOpen =
      !state.audioReactive.noiseGateEnabled || state.audioReactive.gateGain > 0.001;
    state.tapTempo.autoPrevSpectrum = null;
    paintAudioInputMonitor();
  };
  const syncNoiseGate = () => {
    state.audioReactive.noiseGateEnabled = noiseGateEnabled?.checked === true;
    applyNoiseGateThreshold(noiseGateThresholdRange?.value ?? noiseGateThreshold?.value);
    state.audioReactive.gateGain = computeNoiseGateGain(state.audioReactive.inputDb, state.audioReactive);
    state.audioReactive.gateOpen =
      !state.audioReactive.noiseGateEnabled || state.audioReactive.gateGain > 0.001;
  };
  noiseGateEnabled?.addEventListener('change', syncNoiseGate);
  noiseGateThreshold?.addEventListener('input', () => applyNoiseGateThreshold(noiseGateThreshold.value));
  noiseGateThreshold?.addEventListener('change', () => applyNoiseGateThreshold(noiseGateThreshold.value));
  noiseGateThresholdRange?.addEventListener('input', () =>
    applyNoiseGateThreshold(noiseGateThresholdRange.value),
  );
  noiseGateThresholdRange?.addEventListener('change', () =>
    applyNoiseGateThreshold(noiseGateThresholdRange.value),
  );
  noiseGateListen?.addEventListener('click', startNoiseGateListening);
  const applyNoiseGateStrength = (raw) => {
    const strength = Math.max(0, Math.min(100, Number(raw) || 0));
    state.audioReactive.noiseGateStrength = strength;
    if (noiseGateStrength && document.activeElement !== noiseGateStrength)
      noiseGateStrength.value = String(Math.round(strength));
    if (noiseGateStrengthNumber && document.activeElement !== noiseGateStrengthNumber)
      noiseGateStrengthNumber.value = String(Math.round(strength));
    state.audioReactive.gateGain = computeNoiseGateGain(state.audioReactive.inputDb, state.audioReactive);
    state.audioReactive.gateOpen =
      !state.audioReactive.noiseGateEnabled || state.audioReactive.gateGain > 0.001;
    state.tapTempo.autoPrevSpectrum = null;
    paintAudioInputMonitor();
  };
  const syncNoiseGateSoft = () => {
    state.audioReactive.noiseGateSoftEnabled = noiseGateSoftEnabled?.checked === true;
    if (noiseGateSoftRow)
      noiseGateSoftRow.classList.toggle('soft-disabled', !state.audioReactive.noiseGateSoftEnabled);
    applyNoiseGateStrength(noiseGateStrength?.value ?? noiseGateStrengthNumber?.value);
  };
  noiseGateSoftEnabled?.addEventListener('change', syncNoiseGateSoft);
  noiseGateStrength?.addEventListener('input', () => {
    if (noiseGateStrengthNumber) noiseGateStrengthNumber.value = noiseGateStrength.value;
    applyNoiseGateStrength(noiseGateStrength.value);
  });
  noiseGateStrengthNumber?.addEventListener('input', () => {
    if (noiseGateStrength)
      noiseGateStrength.value = String(
        Math.max(0, Math.min(100, Number(noiseGateStrengthNumber.value) || 0)),
      );
    applyNoiseGateStrength(noiseGateStrengthNumber.value);
  });
  noiseGateStrengthNumber?.addEventListener('change', () =>
    applyNoiseGateStrength(noiseGateStrengthNumber.value),
  );
  syncNoiseGate();
  syncNoiseGateSoft();

  const normalizeLowSignal = document.getElementById('audioNormalizeLowSignal');
  const normalizationBaseText = document.getElementById('audioNormalizationBaseText');
  const syncNormalizationMode = () => {
    const enabled = normalizeLowSignal?.checked === true;
    state.audioReactive.normalizeLowSignal = enabled;
    state.audioReactive.levelHistory = [];
    state.audioReactive.normalizationPeak = 0;
    state.audioReactive.normalizationFloor = 0;
    if (normalizationBaseText) normalizationBaseText.textContent = enabled ? 'низкий сигнал' : 'тишина';
  };
  normalizeLowSignal?.addEventListener('change', syncNormalizationMode);
  syncNormalizationMode();

  const clampAudioMultiplier = (value) => Math.max(0, Number(value) || 0);

  const inputSmoothingEnabled = document.getElementById('audioInputSmoothingEnabled');
  const inputSmoothingStrength = document.getElementById('audioInputSmoothingStrength');
  const inputSmoothingMultiplier = document.getElementById('audioInputSmoothingMultiplier');
  const inputSmoothingText = document.getElementById('audioInputSmoothingText');
  const inputSmoothingRow = document.getElementById('audioInputSmoothingRow');
  const syncInputSmoothing = () => {
    const enabled = inputSmoothingEnabled?.checked === true;
    const pct = Math.max(0, Math.min(100, Number(inputSmoothingStrength?.value) || 0));
    const mult = clampAudioMultiplier(inputSmoothingMultiplier?.value);
    if (inputSmoothingMultiplier) inputSmoothingMultiplier.value = String(mult);
    state.audioReactive.inputSmoothingEnabled = enabled;
    state.audioReactive.inputSmoothingStrength = pct;
    state.audioReactive.inputSmoothingMultiplier = mult;
    inputSmoothingRow?.classList.toggle('disabled', !enabled);
    if (inputSmoothingStrength) inputSmoothingStrength.disabled = !enabled;
    if (inputSmoothingMultiplier) inputSmoothingMultiplier.disabled = !enabled;
    if (inputSmoothingText)
      inputSmoothingText.textContent = `${Math.round(pct)}% × ${formatDisplayNumber(mult, 2)}`;
  };
  inputSmoothingEnabled?.addEventListener('change', syncInputSmoothing);
  inputSmoothingStrength?.addEventListener('input', syncInputSmoothing);
  inputSmoothingMultiplier?.addEventListener('input', syncInputSmoothing);
  inputSmoothingMultiplier?.addEventListener('change', syncInputSmoothing);
  syncInputSmoothing();

  const masterGainStrength = document.getElementById('audioMasterGainStrength');
  const masterGainMultiplier = document.getElementById('audioMasterGainMultiplier');
  const masterGainText = document.getElementById('audioMasterGainText');
  const syncMasterGain = () => {
    const pct = Math.max(0, Math.min(200, Number(masterGainStrength?.value) || 0));
    const mult = clampAudioMultiplier(masterGainMultiplier?.value);
    if (masterGainMultiplier) masterGainMultiplier.value = String(mult);
    state.audioReactive.masterGainStrength = pct;
    state.audioReactive.masterGainMultiplier = mult;
    if (masterGainText) masterGainText.textContent = `${Math.round(pct)}% × ${formatDisplayNumber(mult, 2)}`;
  };
  masterGainStrength?.addEventListener('input', syncMasterGain);
  masterGainMultiplier?.addEventListener('input', syncMasterGain);
  masterGainMultiplier?.addEventListener('change', syncMasterGain);
  syncMasterGain();

  const sizeStrength = document.getElementById('audioSizeStrength');
  const sizeMultiplier = document.getElementById('audioSizeMultiplier');
  const sizeStrengthText = document.getElementById('audioSizeStrengthText');
  const syncSizeEffect = () => {
    const pct = Math.max(0, Math.min(200, Number(sizeStrength?.value) || 0));
    const mult = clampAudioMultiplier(sizeMultiplier?.value);
    if (sizeMultiplier) sizeMultiplier.value = String(mult);
    state.audioReactive.sizeStrength = pct / 100;
    state.audioReactive.sizeMultiplier = mult;
    if (sizeStrengthText)
      sizeStrengthText.textContent = `${Math.round(pct)}% × ${formatDisplayNumber(mult, 2)}`;
    requestMainCanvasRender();
  };
  sizeStrength?.addEventListener('input', syncSizeEffect);
  sizeMultiplier?.addEventListener('input', syncSizeEffect);
  sizeMultiplier?.addEventListener('change', syncSizeEffect);

  const rotationEnabled = document.getElementById('audioRotationEnabled');
  const rotationStrength = document.getElementById('audioRotationStrength');
  const rotationMultiplier = document.getElementById('audioRotationMultiplier');
  const rotationStrengthText = document.getElementById('audioRotationStrengthText');
  const rotationEffectRow = document.getElementById('audioRotationEffectRow');
  const syncRotationEffect = (rebaseMorph = false) => {
    const wasEnabled = state.audioReactive.rotationEnabled;
    const enabled = rotationEnabled?.checked === true;
    const pct = Math.max(0, Math.min(200, Number(rotationStrength?.value) || 0));
    const mult = clampAudioMultiplier(rotationMultiplier?.value);
    if (rotationMultiplier) rotationMultiplier.value = String(mult);
    state.audioReactive.rotationEnabled = enabled;
    state.audioReactive.rotationStrength = pct / 100;
    state.audioReactive.rotationMultiplier = mult;
    rotationEffectRow?.classList.toggle('disabled', !enabled);
    if (rotationStrength) rotationStrength.disabled = !enabled;
    if (rotationMultiplier) rotationMultiplier.disabled = !enabled;
    if (rotationStrengthText)
      rotationStrengthText.textContent = `${Math.round(pct)}% × ${formatDisplayNumber(mult, 2)}`;
    if (rebaseMorph && wasEnabled !== enabled && runtimeState.morph.active) activeRebaseMorphing();
    requestMainCanvasRender();
  };
  rotationEnabled?.addEventListener('change', () => syncRotationEffect(true));
  rotationStrength?.addEventListener('input', () => syncRotationEffect(false));
  rotationMultiplier?.addEventListener('input', () => syncRotationEffect(false));
  rotationMultiplier?.addEventListener('change', () => syncRotationEffect(false));

  syncSizeEffect();
  syncRotationEffect(false);
  syncAudioCutoffs();
  applyMobileAudioSourceDefaults();
  if (mobileAudioQuery.addEventListener)
    mobileAudioQuery.addEventListener('change', applyMobileAudioSourceDefaults);
  else mobileAudioQuery.addListener?.(applyMobileAudioSourceDefaults);
}

export {
  getActiveAudioBandKeys,
  getAudioBandRangesForAnalysis,
  isMobileAudioEnvironment,
  renderAudioCustomBandRows,
  renderAudioMeters,
  setupAudioReactiveUI,
  startAudioReactive,
  syncAudioCutoffs,
  syncAudioSettingsUIFromState,
};
