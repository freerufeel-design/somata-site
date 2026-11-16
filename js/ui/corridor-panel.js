// Коридор: включение режима и панель настроек.
import '../corridor/corridor-instances.js'; // initialisation order: this module runs after it
import { WebGPUFinalCompositeRenderer } from '../gpu/final-composite-renderer.js';
import { clearTunnelFadeRuntime } from '../core/render-runtime.js';
import { animationScheduler, requestMainCanvasRender } from '../core/scheduler.js';
import { state } from '../core/state.js';
import { renderMainCanvas } from '../render/main-pipeline.js';
import {
  SPIRAL_OUTER_COPIES_DEFAULT,
  TUNNEL_CENTER_HIDDEN_DEFAULT,
  TUNNEL_CENTER_HIDDEN_MAX,
  normalizeSpiralOuterCopies,
  normalizeTunnelCenterHiddenCopies,
  normalizeTunnelColorShiftState,
} from '../corridor/corridor-appearance.js';
import {
  beginCorridorTransition,
  corridorEntrance,
  corridorOrderChanges,
  corridorTransitionDuration,
  stopCorridorEntrance,
  stopHonestZeroCorridorIntro,
  stopHonestZeroCorridorOutro,
} from '../corridor/corridor-transitions.js';
import { tunnelAnimationFrame } from '../corridor/corridor-instances.js';
import { formatDisplayNumber, formatTimeSeconds } from './geometry-n-control.js';
import { toggleMorphSettingsPanel } from './morph-settings-panel.js';
import { positionFloatingPanelNearTrigger } from './floating-panels.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

function setTunnelMode(enabled, options = {}) {
  const tunnel = state.tunnel;
  const next = Boolean(enabled),
    silent = options?.silent === true;
  const wasActive = tunnel.active === true;
  const leaving = corridorEntrance.direction === 'out' && !corridorEntrance.completed;
  // During exit the Tunnel stays resident; the button reports the
  // user's requested state, not the internal residency state.
  if (!next && wasActive && !silent && !leaving && corridorTransitionDuration() > 0) {
    beginCorridorTransition('out');
    const btn = document.getElementById('btnTunnel');
    btn?.classList.remove('active');
    btn?.setAttribute('aria-pressed', 'false');
    btn?.setAttribute('aria-label', 'Включить режим туннеля');
    animationScheduler.add('tunnel', tunnelAnimationFrame);
    requestMainCanvasRender();
    return;
  }
  tunnel.active = next;
  const btn = document.getElementById('btnTunnel');
  btn?.classList.toggle('active', next);
  btn?.setAttribute('aria-pressed', next ? 'true' : 'false');
  btn?.setAttribute('aria-label', next ? 'Выключить режим туннеля' : 'Включить режим туннеля');
  if (next) {
    if (!wasActive || leaving) {
      corridorOrderChanges.clear();
      stopHonestZeroCorridorOutro();
      stopHonestZeroCorridorIntro();
      tunnel.phase = 0;
      tunnel.travelPhase = 0;
      tunnel.lastTime = 0;
      tunnel.raf = 0;
      clearTunnelFadeRuntime();
      if (!silent) beginCorridorTransition('in');
      else stopCorridorEntrance();
    }
    animationScheduler.add('tunnel', tunnelAnimationFrame);
    if (!silent) requestMainCanvasRender();
  } else {
    animationScheduler.remove('tunnel');
    tunnel.raf = 0;
    tunnel.lastTime = 0;
    tunnel.phase = 0;
    tunnel.travelPhase = 0;
    clearTunnelFadeRuntime();
    stopCorridorEntrance();
    corridorOrderChanges.clear();
    stopHonestZeroCorridorOutro();
    stopHonestZeroCorridorIntro();
    if (!silent) {
      if (wasActive) renderMainCanvas();
      else requestMainCanvasRender();
    }
  }
}
function toggleTunnelMode() {
  const visuallyActive =
    state.tunnel.active && !(corridorEntrance.direction === 'out' && !corridorEntrance.completed);
  setTunnelMode(!visuallyActive);
}
function syncTunnelSettingsUI() {
  const tunnel = state.tunnel;
  const speedStrength = document.getElementById('tunnelSpeedStrength');
  const speedMultiplier = document.getElementById('tunnelSpeedMultiplier');
  const speedText = document.getElementById('tunnelSpeedText');
  const spacingStrength = document.getElementById('tunnelSpacingStrength');
  const spacingMultiplier = document.getElementById('tunnelSpacingMultiplier');
  const spacingText = document.getElementById('tunnelSpacingText');
  const depthSlider = document.getElementById('tunnelDepthCurve');
  const depthNumber = document.getElementById('tunnelDepthCurveNumber');
  const depthMultiplier = document.getElementById('tunnelDepthCurveMultiplier');
  const depthText = document.getElementById('tunnelDepthCurveText');
  const centerHiddenCopies = document.getElementById('tunnelCenterHiddenCopies');
  const spiralOuterCopies = document.getElementById('tunnelSpiralOuterCopies');
  const defaultActive = document.getElementById('tunnelDefaultActive');
  const fadeEnabled = document.getElementById('tunnelFadeEnabled');
  const vignetteToggle = document.getElementById('showVignetteSetting');
  const fadeOffset = document.getElementById('tunnelFadeOffsetSteps');
  const vignetteAmount = document.getElementById('tunnelVignetteAmount');
  const fadeDuration = document.getElementById('tunnelFadeDuration');
  const fadeText = document.getElementById('tunnelFadeText');
  const colorShiftEnabled = document.getElementById('tunnelColorShiftEnabled');
  const colorShiftControls = document.getElementById('tunnelColorShiftControls');
  const colorShiftDegrees = document.getElementById('tunnelColorShiftDegrees');
  const colorShiftDegreesNumber = document.getElementById('tunnelColorShiftDegreesNumber');
  const colorShiftText = document.getElementById('tunnelColorShiftText');
  const colorShiftCumulative = document.getElementById('tunnelColorShiftCumulative');
  const paletteLagEnabled = document.getElementById('tunnelPaletteLagEnabled');

  const speedPct = Math.max(-100, Math.min(100, (Number(tunnel.speedStrength) || 0) * 100));
  const speedMult = Math.max(0, Math.min(20, Number(tunnel.speedMultiplier) || 0));
  const spacingPct = Math.max(20, Math.min(2000, (Number(tunnel.spacingStrength) || 3) * 100));
  const spacingMult = Math.max(0.0001, Number(tunnel.spacingMultiplier) || 1);
  const centerHiddenCount = normalizeTunnelCenterHiddenCopies(tunnel);
  normalizeTunnelColorShiftState(tunnel);

  if (speedStrength) speedStrength.value = String(speedPct);
  if (speedMultiplier) speedMultiplier.value = String(speedMult);
  if (speedText)
    speedText.textContent = `${speedPct > 0 ? '+' : ''}${Math.round(speedPct)}% × ${formatDisplayNumber(speedMult, 2)}`;
  if (spacingStrength) spacingStrength.value = String(spacingPct);
  if (spacingMultiplier) spacingMultiplier.value = String(spacingMult);
  if (spacingText)
    spacingText.textContent = `${Math.round(spacingPct)}% × ${formatDisplayNumber(spacingMult, 2)}`;
  const depthValue = Math.max(-100, Math.min(100, Number(tunnel.depthCurve) || 0));
  const depthMult = Math.max(
    0,
    Number.isFinite(Number(tunnel.depthCurveMultiplier)) ? Number(tunnel.depthCurveMultiplier) : 1,
  );
  if (depthSlider) depthSlider.value = String(depthValue);
  if (depthNumber) depthNumber.value = String(depthValue);
  if (depthMultiplier) depthMultiplier.value = String(depthMult);
  if (depthText)
    depthText.textContent = `${depthValue > 0 ? '+' : ''}${depthValue}% × ${formatDisplayNumber(depthMult, 2)}`;
  if (centerHiddenCopies) centerHiddenCopies.value = String(centerHiddenCount);
  if (spiralOuterCopies) spiralOuterCopies.value = String(normalizeSpiralOuterCopies(tunnel));
  if (colorShiftEnabled) colorShiftEnabled.checked = tunnel.colorShiftEnabled;
  if (colorShiftDegrees) colorShiftDegrees.value = String(tunnel.colorShiftDegrees);
  if (colorShiftDegreesNumber) colorShiftDegreesNumber.value = String(tunnel.colorShiftDegrees);
  if (colorShiftText) colorShiftText.textContent = `${Math.round(tunnel.colorShiftDegrees)}°`;
  if (colorShiftCumulative) colorShiftCumulative.checked = tunnel.colorShiftCumulative === true;
  if (paletteLagEnabled) paletteLagEnabled.checked = tunnel.paletteLagEnabled;

  const fadeOffsetValue = Math.max(-50, Math.min(50, Math.round(Number(tunnel.fadeOffsetSteps) || 0)));
  const vignetteAmountValue =
    Math.round(Math.max(0, Math.min(1200, Number(tunnel.vignetteAmount) || 0)) * 10) / 10;
  const fadeDurationValue = Math.round(Math.max(0, Number(tunnel.fadeDurationSec) || 0) * 100) / 100;
  tunnel.fadeOffsetSteps = fadeOffsetValue;
  tunnel.vignetteAmount = vignetteAmountValue;
  tunnel.vignetteUnit = 'px';
  tunnel.fadeDurationSec = fadeDurationValue;
  tunnel.fadeOversize = Boolean(tunnel.fadeOversize);
  tunnel.defaultActive = tunnel.defaultActive === true;
  if (defaultActive) defaultActive.checked = tunnel.defaultActive;
  if (fadeEnabled) fadeEnabled.checked = tunnel.fadeOversize;
  if (vignetteToggle) vignetteToggle.checked = state.showVignette === true;
  if (fadeOffset) fadeOffset.value = String(fadeOffsetValue);
  if (vignetteAmount) vignetteAmount.value = formatDisplayNumber(vignetteAmountValue, 1);
  const vignetteLabel = document.getElementById('tunnelVignetteAmountText');
  if (vignetteLabel) vignetteLabel.textContent = vignetteAmountValue + ' px';
  if (fadeDuration) fadeDuration.value = formatTimeSeconds(fadeDurationValue);
  if (fadeText)
    fadeText.textContent = `${fadeOffsetValue > 0 ? '+' : ''}${fadeOffsetValue} фиг. · ${formatTimeSeconds(fadeDurationValue)} с`;

  tunnel.optimizedCalculation = true;
}
function setupTunnelUI() {
  const panel = document.getElementById('tunnelSettingsPanel');
  const settingsBtn = document.getElementById('btnTunnelSettings');
  const closeBtn = document.getElementById('btnCloseTunnelSettings');
  const speedStrength = document.getElementById('tunnelSpeedStrength');
  const speedMultiplier = document.getElementById('tunnelSpeedMultiplier');
  const spacingStrength = document.getElementById('tunnelSpacingStrength');
  const spacingMultiplier = document.getElementById('tunnelSpacingMultiplier');
  const depthSlider = document.getElementById('tunnelDepthCurve');
  const depthNumber = document.getElementById('tunnelDepthCurveNumber');
  const depthMultiplier = document.getElementById('tunnelDepthCurveMultiplier');
  const centerHiddenCopies = document.getElementById('tunnelCenterHiddenCopies');
  const spiralOuterCopies = document.getElementById('tunnelSpiralOuterCopies');
  const defaultActive = document.getElementById('tunnelDefaultActive');
  const fadeEnabled = document.getElementById('tunnelFadeEnabled');
  const fadeOffset = document.getElementById('tunnelFadeOffsetSteps');
  const vignetteAmount = document.getElementById('tunnelVignetteAmount');
  const fadeDuration = document.getElementById('tunnelFadeDuration');
  const colorShiftEnabled = document.getElementById('tunnelColorShiftEnabled');
  const colorShiftControls = document.getElementById('tunnelColorShiftControls');
  const colorShiftDegrees = document.getElementById('tunnelColorShiftDegrees');
  const colorShiftDegreesNumber = document.getElementById('tunnelColorShiftDegreesNumber');
  const colorShiftCumulative = document.getElementById('tunnelColorShiftCumulative');
  const paletteLagEnabled = document.getElementById('tunnelPaletteLagEnabled');

  const setPanelOpen = (open) => {
    panel?.classList.toggle('hidden', !open);
    settingsBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      document.getElementById('randomSettingsPanel')?.classList.add('hidden');
      toggleMorphSettingsPanel?.(false);
      syncTunnelSettingsUI();
      positionFloatingPanelNearTrigger?.(panel, settingsBtn);
    }
  };

  settingsBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    setPanelOpen(panel?.classList.contains('hidden'));
  });
  closeBtn?.addEventListener('click', () => setPanelOpen(false));
  panel?.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('click', (e) => {
    const nav = document.querySelector('.tunnel-nav');
    if (nav && !nav.contains(e.target)) setPanelOpen(false);
  });

  const syncSpeed = () => {
    const pct = Math.max(-100, Math.min(100, Number(speedStrength?.value) || 0));
    const mult = Math.max(0, Math.min(20, Number(speedMultiplier?.value) || 0));
    state.tunnel.speedStrength = pct / 100;
    state.tunnel.speedMultiplier = mult;
    if (speedMultiplier) speedMultiplier.value = String(mult);
    const text = document.getElementById('tunnelSpeedText');
    if (text) text.textContent = `${pct > 0 ? '+' : ''}${Math.round(pct)}% × ${formatDisplayNumber(mult, 2)}`;
    if (state.tunnel.active) requestMainCanvasRender();
  };
  speedStrength?.addEventListener('input', syncSpeed);
  speedMultiplier?.addEventListener('input', syncSpeed);
  speedMultiplier?.addEventListener('change', syncSpeed);

  const syncSpacing = () => {
    const pct = Math.max(20, Math.min(2000, Number(spacingStrength?.value) || 300));
    const rawMult = Number(spacingMultiplier?.value);
    const mult = Number.isFinite(rawMult) ? Math.max(0.0001, rawMult) : 1;
    state.tunnel.spacingStrength = pct / 100;
    state.tunnel.spacingMultiplier = mult;
    if (spacingMultiplier) spacingMultiplier.value = String(mult);
    const text = document.getElementById('tunnelSpacingText');
    if (text) text.textContent = `${pct > 0 ? '+' : ''}${Math.round(pct)}% × ${formatDisplayNumber(mult, 2)}`;
    if (state.tunnel.active) renderMainCanvas();
  };
  spacingStrength?.addEventListener('input', syncSpacing);
  spacingMultiplier?.addEventListener('input', syncSpacing);
  spacingMultiplier?.addEventListener('change', syncSpacing);
  const syncDepth = (source) => {
    const v = Math.max(-100, Math.min(100, Math.round(Number(source?.value) || 0)));
    const mult = Number(depthMultiplier?.value);
    state.tunnel.depthCurve = v;
    state.tunnel.depthCurveMultiplier = Math.max(0, Math.min(10, Number.isFinite(mult) ? mult : 1));
    if (source === depthMultiplier) {
      // Keep the typed decimal intact during input ("2." must not be rewritten to "2").
      const caption = document.getElementById('tunnelDepthCurveText');
      if (caption)
        caption.textContent = `${v > 0 ? '+' : ''}${v}% × ${formatDisplayNumber(state.tunnel.depthCurveMultiplier, 2)}`;
    } else syncTunnelSettingsUI();
    requestMainCanvasRender();
  };
  depthSlider?.addEventListener('input', () => syncDepth(depthSlider));
  depthNumber?.addEventListener('input', () => syncDepth(depthNumber));
  depthNumber?.addEventListener('change', () => syncDepth(depthNumber));
  depthMultiplier?.addEventListener('input', () => syncDepth(depthNumber));
  depthMultiplier?.addEventListener('change', () => syncDepth(depthNumber));

  const syncCenterShade = () => {
    const raw = Number(centerHiddenCopies?.value);
    state.tunnel.centerHiddenCopies = Math.max(
      0,
      Math.min(
        TUNNEL_CENTER_HIDDEN_MAX,
        Math.round(Number.isFinite(raw) ? raw : TUNNEL_CENTER_HIDDEN_DEFAULT),
      ),
    );
    if (centerHiddenCopies) centerHiddenCopies.value = String(state.tunnel.centerHiddenCopies);
    try {
      WebGPUFinalCompositeRenderer?.warmup?.();
    } catch (error) {
      noteSuppressedError('ui/corridor-panel#syncCenterShade', error);
    }
    requestMainCanvasRender();
  };
  centerHiddenCopies?.addEventListener('input', syncCenterShade);
  centerHiddenCopies?.addEventListener('change', syncCenterShade);
  const syncSpiralOuterCopies = () => {
    const raw = Number(spiralOuterCopies?.value);
    state.tunnel.spiralOuterCopies = Math.max(
      0,
      Math.min(24, Math.round(Number.isFinite(raw) ? raw : SPIRAL_OUTER_COPIES_DEFAULT)),
    );
    if (spiralOuterCopies) spiralOuterCopies.value = String(state.tunnel.spiralOuterCopies);
    requestMainCanvasRender();
  };
  spiralOuterCopies?.addEventListener('input', syncSpiralOuterCopies);
  spiralOuterCopies?.addEventListener('change', syncSpiralOuterCopies);

  const syncTunnelColorShift = (source = null) => {
    const t = normalizeTunnelColorShiftState();
    if (colorShiftEnabled) t.colorShiftEnabled = colorShiftEnabled.checked === true;
    let deg = Number(
      source === colorShiftDegreesNumber ? colorShiftDegreesNumber?.value : colorShiftDegrees?.value,
    );
    if (!Number.isFinite(deg)) deg = t.colorShiftDegrees;
    deg = Math.max(0, Math.min(360, deg));
    t.colorShiftDegrees = deg;
    t.colorShiftCumulative = colorShiftCumulative?.checked === true;
    t.paletteLagEnabled = paletteLagEnabled?.checked === true;
    if (colorShiftDegrees && source !== colorShiftDegrees) colorShiftDegrees.value = String(deg);
    if (colorShiftDegreesNumber && source !== colorShiftDegreesNumber)
      colorShiftDegreesNumber.value = String(deg);
    const text = document.getElementById('tunnelColorShiftText');
    if (text) text.textContent = `${Math.round(deg)}°`;
    requestMainCanvasRender();
  };
  colorShiftEnabled?.addEventListener('change', () => syncTunnelColorShift(colorShiftEnabled));
  colorShiftDegrees?.addEventListener('input', () => syncTunnelColorShift(colorShiftDegrees));
  colorShiftDegreesNumber?.addEventListener('input', () => syncTunnelColorShift(colorShiftDegreesNumber));
  colorShiftDegreesNumber?.addEventListener('change', () => syncTunnelColorShift(colorShiftDegreesNumber));
  colorShiftCumulative?.addEventListener('change', () => syncTunnelColorShift(colorShiftCumulative));
  paletteLagEnabled?.addEventListener('change', () => syncTunnelColorShift(paletteLagEnabled));

  const syncFade = () => {
    state.tunnel.fadeOversize = fadeEnabled ? fadeEnabled.checked : false;
    const offset = Math.max(-50, Math.min(50, Math.round(Number(fadeOffset?.value) || 0)));
    const vignette = Math.round(Math.max(0, Math.min(1200, Number(vignetteAmount?.value) || 0)) * 10) / 10;
    const duration = Math.round(Math.max(0, Number(fadeDuration?.value) || 0) * 100) / 100;
    state.tunnel.fadeOffsetSteps = offset;
    state.tunnel.vignetteAmount = vignette;
    state.tunnel.vignetteUnit = 'px';
    state.tunnel.fadeDurationSec = duration;
    if (fadeOffset) fadeOffset.value = String(offset);
    if (vignetteAmount) vignetteAmount.value = formatDisplayNumber(vignette, 1);
    const vignetteLabel = document.getElementById('tunnelVignetteAmountText');
    if (vignetteLabel) vignetteLabel.textContent = vignette + ' px';
    if (fadeDuration) fadeDuration.value = formatTimeSeconds(duration);
    const text = document.getElementById('tunnelFadeText');
    if (text) text.textContent = `${offset > 0 ? '+' : ''}${offset} фиг. · ${formatTimeSeconds(duration)} с`;
    if (state.tunnel.active) requestMainCanvasRender();
  };
  defaultActive?.addEventListener('change', () => {
    state.tunnel.defaultActive = defaultActive.checked === true;
  });
  fadeEnabled?.addEventListener('change', () => {
    clearTunnelFadeRuntime();
    syncFade();
  });
  fadeOffset?.addEventListener('input', () => {
    clearTunnelFadeRuntime();
    syncFade();
  });
  fadeOffset?.addEventListener('change', () => {
    clearTunnelFadeRuntime();
    syncFade();
  });

  vignetteAmount?.addEventListener('input', syncFade);
  vignetteAmount?.addEventListener('change', syncFade);

  fadeDuration?.addEventListener('input', syncFade);
  fadeDuration?.addEventListener('change', syncFade);

  syncTunnelSettingsUI();
}

export { setTunnelMode, setupTunnelUI, syncTunnelSettingsUI, toggleTunnelMode };
