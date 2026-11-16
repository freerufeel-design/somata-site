// Синхронизация сайдбара с состоянием слоя и морфа.
import '../morph-runtime/morph-mode.js'; // initialisation order: this module runs after it
import { getConfiguredSplinePointCount, normalizeSplineRenderMode } from '../geometry/profile-model.js';
import {
  contourModeIsSpiral,
  getContourMode,
  getEffectiveSpiralOrder,
  getEffectiveSpiralStep,
  isSpiralLayer,
  normalizeSpiralOrder,
} from '../geometry/spiral/order-params.js';
import { applyTopologyBadgeStyle, getProfileTopologyStatus } from './profile-topology-badge.js';
import { normalizeSpiralSquashY } from '../geometry/orbit-builder.js';
import { getGraffitiVariationMode } from '../effects/graffiti-ribbon.js';
import { ensureGpuPathFxAnimation, syncParticleUI } from '../effects/effect-animation.js';
import {
  getLayerMainLineMode,
  normalizeLineMarkerType,
  normalizeLineProfileValue,
  setSidebarMode,
  syncLampSettingsUI,
  syncSidebarToolStates,
  syncSweepUI,
  syncWebOutlineUI,
} from './effects-sidebar.js';
import {
  colorBaseHex6,
  ensureLayerEffectState,
  gcd,
  getFillOpacityPercent,
  getLayerFillAccumulationSeconds,
  getLayerFillFadeDirection,
  getLayerFillFadeHardness,
  getLayerFillFadePixelization,
  getLayerFillMatchStroke,
  getLayerFillModeChoice,
  getLineSpritePreset,
  normalizeLayerFillRule,
  normalizeLayerFillType,
  normalizeLineMotionFxConfig,
  normalizeLineSpriteConfig,
  normalizeLineSpritePlacement,
  normalizeLineSpriteType,
  syncLayerFillColorToStroke,
} from '../core/defaults-layers.js';
import { MAX_ROUNDING_PERCENT, clampRoundingPercent } from '../core/palette.js';
import { runtimeState, state } from '../core/state.js';
import {
  getLayerGlowIntensityMultiplier,
  getLayerGlowMultiplier,
  getLayerRadiusMultiplier,
  getLayerStrokeWidthMultiplier,
} from '../effects/motion.js';
import { syncProfilePresetLibrarySelection } from './profile-presets.js';
import { setSidebarValueText } from '../app/app-paths.js';
import { isAudioRotationOverrideActive } from './layer-selection.js';
import { formatDisplayNumber, syncGeometryNControl } from './geometry-n-control.js';
import { isSpiralLayerMorphEnabled } from '../morph-runtime/morph-mode.js';
import { syncBlueMorphParameterDecorations } from './blue-morph/parameter-bindings.js';
import { sampleBlueSpiralOrder } from '../audio/tap-tempo.js';
import { renderGraffitiPaletteChooser } from './playlist-palettes.js';

function updateSidebarFromMorph(t) {
  if (!runtimeState.morph.active) return;
  const idx = state.layers.findIndex((l) => l.id === state.activeLayerId);
  if (idx < 0) return;
  const src = runtimeState.morph.sourceVisuals[idx];
  const dst = runtimeState.morph.targetVisuals[idx];
  if (!src || !dst) return;
  const lerp = (a, b) => Number(a) + (Number(b) - Number(a)) * t;
  const setRange = (id, value, min, max, step = 'any') => {
    const el = document.getElementById(id);
    if (!el) return;
    el.min = min;
    el.max = max;
    el.step = step;
    el.value = Math.max(min, Math.min(max, value));
  };
  const setText = (id, value, suffix = '') => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.textContent = formatDisplayNumber(value, 1) + suffix;
  };
  const n = lerp(src.N, dst.N),
    k = lerp(src.K, dst.K);
  if (state.morph.options.byVertices) {
    syncGeometryNControl(n, true);
  }
  if (state.morph.options.bySteps) {
    const maxK = Math.max(1, Math.floor(lerp(src.N, dst.N) / 2));
    setRange('paramK', k, 1, maxK, '0.01');
    const numK = document.getElementById('numK');
    if (numK) numK.value = Math.max(1, Math.round(k));
  }
  if (state.morph.options.byRounding) {
    const v = lerp(src.rounding, dst.rounding);
    setRange('paramRounding', v, 0, MAX_ROUNDING_PERCENT, '0.01');
    setText('valRounding', v, '%');
  }
  if (state.morph.options.bySize) {
    const v = lerp(src.radius, dst.radius);
    setRange('paramRadius', v, 20, 500, '0.01');
    setText('valRadius', v, ` × ${formatDisplayNumber(getLayerRadiusMultiplier(state.layers[idx]), 2)}`);
  }
  if (state.morph.options.byRotation && !isAudioRotationOverrideActive()) {
    const v = lerp(src.rotation, dst.rotation);
    setRange('paramRotation', v, 0, 360, '0.01');
    setText('valRotation', v, '°');
  }
  if (isSpiralLayerMorphEnabled()) {
    const authored = state.layers[idx];
    const manual = window.SomataTestMorph?.independentOrderTarget?.(authored.id);
    const v =
      manual ??
      (isSpiralLayerMorphEnabled()
        ? sampleBlueSpiralOrder(
            authored,
            src.spiralEnabled === true ? Number(src.spiralOrder) || 0 : 0,
            dst.spiralEnabled === true ? Number(dst.spiralOrder) || 0 : 0,
            runtimeState.morph.progress,
            state.tunnel?.active === true,
          ).order
        : lerp(src.spiralOrder ?? 0, dst.spiralOrder ?? 0));
    const el = document.getElementById('paramSpiralOrder');
    if (el && document.activeElement !== el) {
      el.value = normalizeSpiralOrder(v, false);
    }
  }
  if (state.morph.options.byOpacity) {
    const opacity = lerp(src.opacity, dst.opacity);
    setRange('paramOpacity', opacity, 0, 100, '0.01');
    setText('valOpacity', opacity, '%');
  }
  if (state.morph.options.byStrokeWidth) {
    const sw = lerp(src.strokeWidth, dst.strokeWidth);
    setRange('paramStrokeWidth', sw, 0.5, 50, '0.01');
    setText('valStrokeWidth', sw, 'px');
  }

  const activeLayer = state.layers[idx];
  const glow = Math.max(0, Number(activeLayer?.glow) || 0);
  setRange('paramGlow', glow, 0, 40, '0.01');
  setText('valGlow', glow, 'px');

  const glowIntensity = Math.max(
    0,
    Math.min(
      200,
      Number.isFinite(Number(activeLayer?.glowIntensity)) ? Number(activeLayer.glowIntensity) : 40,
    ),
  );
  setRange('paramGlowIntensity', glowIntensity, 0, 200, '1');
  const gim = getLayerGlowIntensityMultiplier(activeLayer),
    gimi = document.getElementById('paramGlowIntensityMultiplier');
  if (gimi) gimi.value = gim;
  const git = document.getElementById('valGlowIntensity');
  if (git && document.activeElement !== git)
    git.textContent = `${Math.round(glowIntensity)}% × ${formatDisplayNumber(gim, 2)}`;
  const swm = document.getElementById('paramStrokeWidthMultiplier');
  if (swm) swm.value = getLayerStrokeWidthMultiplier(activeLayer);
  const gm = document.getElementById('paramGlowMultiplier');
  if (gm) gm.value = getLayerGlowMultiplier(activeLayer);
}
function syncLineSpritePreviewArtwork(type, primary, secondary) {
  type = normalizeLineSpriteType(type);
  const target = document.getElementById('lineSpriteBuiltinPreview'),
    card = document.querySelector(`.line-sprite-preset[data-line-sprite-type="${type}"]`),
    source = card?.querySelector('svg');
  if (target && source) {
    target.innerHTML = source.innerHTML;
    target.style.setProperty('--sprite-primary', primary);
    target.style.setProperty('--sprite-secondary', secondary);
    target.style.setProperty('--sprite-ink', '#07111f');
  }
  document
    .querySelectorAll('.line-sprite-preset')
    .forEach((el) => el.classList.toggle('active', el.dataset.lineSpriteType === type));
}
function syncGpuLineFxUI(layer) {
  const owner = ensureLayerEffectState(layer);
  if (!owner) return;
  const sp = (owner.sprite = normalizeLineSpriteConfig(owner.sprite)),
    mo = (owner.lineMotionFx = normalizeLineMotionFxConfig(owner.lineMotionFx)),
    preset = getLineSpritePreset(sp.type);
  if (sp.enabled === true) {
    owner.lineProfile = 'round';
    owner.lineProfileStroke = 'round';
  }
  document.getElementById('lineProfileSpriteLockHint')?.classList.toggle('hidden', sp.enabled !== true);
  const set = (id, v) => {
      const e = document.getElementById(id);
      if (e) e.value = String(v);
    },
    chk = (id, v) => {
      const e = document.getElementById(id);
      if (e) e.checked = v === true;
    },
    txt = (id, v) => {
      const e = document.getElementById(id);
      if (e) e.textContent = v;
    };
  set('lineSpriteType', sp.type);
  set('lineSpriteMode', normalizeLineSpritePlacement(sp.mode));
  set('lineSpriteEveryN', Math.max(2, Math.round(Number(sp.everyN) || 2)));
  set('lineSpriteLength', 100);
  set('lineSpriteAmplitude', 0);
  set('lineSpriteWavelength', 54);
  set('lineSpriteSpeed', 0);
  set('lineSpriteWidth', Math.max(100, Number(sp.widthPercent) || preset.widthPercent));
  set('lineSpriteWidthMultiplier', Math.max(0.01, Number(sp.widthMultiplier) || 1));
  chk('lineSpriteMatchColor', sp.matchLineColor === true);
  set('lineSpriteColor', sp.color || preset.primary);
  set('lineSpriteSecondaryColor', sp.secondaryColor || preset.secondary);
  txt('lineSpriteEveryNText', String(Math.max(2, Math.round(Number(sp.everyN) || 2))));
  txt('lineSpriteLengthText', '100%');
  txt('lineSpriteAmplitudeText', '0 px');
  txt('lineSpriteWavelengthText', '—');
  txt('lineSpriteSpeedText', '—');
  txt(
    'lineSpriteWidthText',
    `${Math.round(Number(sp.widthPercent) || preset.widthPercent)}% × ${formatDisplayNumber(Math.max(0.01, Number(sp.widthMultiplier) || 1), 2)}`,
  );
  txt(
    'lineSpriteColorText',
    `${sp.matchLineColor === true ? owner.strokeColor || '#ffffff' : sp.color || preset.primary} + ${sp.secondaryColor || preset.secondary}`,
  );
  {
    const sparseSegment = sp.mode === 'everyNth',
      sparsePath = sp.mode === 'everyNthPath';
    document
      .getElementById('lineSpriteEveryNRow')
      ?.classList.toggle('hidden', !(sparseSegment || sparsePath));
    const lbl = document.getElementById('lineSpriteEveryNLabel');
    if (lbl) lbl.textContent = sparseSegment ? 'Каждый N-й сегмент' : 'Каждый N-й контур';
  }
  document.getElementById('lineSpriteBlock')?.classList.toggle('gpu-line-fx-disabled', sp.enabled !== true);
  const sc = document.getElementById('lineSpriteColor');
  if (sc) sc.disabled = sp.matchLineColor === true;
  const customPreview = document.getElementById('lineSpriteCustomPreview'),
    builtinPreview = document.getElementById('lineSpriteBuiltinPreview'),
    previewName = document.getElementById('lineSpritePreviewName'),
    resetSpriteBtn = document.getElementById('lineSpriteResetBtn');
  if (sp.imageDataUrl) {
    if (customPreview) {
      if (customPreview.src !== sp.imageDataUrl) customPreview.src = sp.imageDataUrl;
      customPreview.style.display = 'block';
    }
    if (builtinPreview) builtinPreview.style.display = 'none';
    if (previewName)
      previewName.textContent = sp.imageName ? `Свой · ${sp.imageName}` : 'Свой длинный спрайт';
    resetSpriteBtn?.classList.remove('hidden');
  } else {
    if (customPreview) {
      customPreview.removeAttribute('src');
      customPreview.style.display = 'none';
    }
    if (builtinPreview) {
      builtinPreview.style.display = 'block';
      syncLineSpritePreviewArtwork(
        sp.type,
        sp.matchLineColor === true ? owner.strokeColor || '#ffffff' : sp.color || preset.primary,
        sp.secondaryColor || preset.secondary,
      );
    }
    if (previewName)
      previewName.textContent = `${preset.name} · ${sp.color || preset.primary} + ${sp.secondaryColor || preset.secondary}`;
    resetSpriteBtn?.classList.add('hidden');
  }
  chk('lineMotionFxEnabled', mo.enabled);
  const motionType =
    mo.type === 'sine'
      ? 'seaRaft'
      : ['seaRaft', 'jumpRope', 'sinusoid'].includes(mo.type)
        ? mo.type
        : 'seaRaft';
  if (mo.type !== motionType) mo.type = motionType;
  set('lineMotionFxType', motionType);
  chk('lineMotionFxReplaceBase', mo.replaceBase !== false);
  set('lineMotionFxAmplitude', Math.max(0, Number(mo.amplitudePx) || 0));
  set(
    'lineMotionFxAmplitudeMultiplier',
    Math.max(0, Number.isFinite(Number(mo.amplitudeMultiplier)) ? Number(mo.amplitudeMultiplier) : 1),
  );
  set('lineMotionFxWavelength', Math.max(1, Number(mo.wavelengthPx) || 36));
  set(
    'lineMotionFxWavelengthMultiplier',
    Math.max(0.01, Number.isFinite(Number(mo.wavelengthMultiplier)) ? Number(mo.wavelengthMultiplier) : 2),
  );
  set('lineMotionFxSpeed', Math.max(0, Number(mo.speedPercent) || 0));
  set('lineMotionFxWidth', Math.max(20, Number(mo.widthPercent) || 100));
  txt(
    'lineMotionFxAmplitudeText',
    `${Number(mo.amplitudePx || 0)
      .toFixed(1)
      .replace('.0', '')} px × ${formatDisplayNumber(mo.amplitudeMultiplier, 2)}`,
  );
  txt(
    'lineMotionFxWavelengthText',
    `${Number(mo.wavelengthPx || 36)
      .toFixed(1)
      .replace('.0', '')} px × ${formatDisplayNumber(mo.wavelengthMultiplier, 2)}`,
  );
  txt('lineMotionFxSpeedText', `${Math.round(Number(mo.speedPercent) || 0)}%`);
  txt('lineMotionFxWidthText', `${Math.round(Number(mo.widthPercent) || 100)}%`);
  document.getElementById('lineMotionFxBlock')?.classList.toggle('gpu-line-fx-disabled', mo.enabled !== true);
  ensureGpuPathFxAnimation();
}
function syncSidebarInputs() {
  window.SomataTestMorph?.syncUI?.();
  const layer = state.layers.find((l) => l.id === state.activeLayerId);
  if (!layer) return;
  if (layer.extendedProfileEnabled !== true) layer.spiralEnabled = isSpiralLayer(layer);
  document.getElementById('paramBgColor').value = state.bgColor;
  setSidebarMode(state.sidebarMode);
  syncLampSettingsUI();
  syncWebOutlineUI();
  const mirrorBtn = document.getElementById('btnSidebarMirror');
  if (mirrorBtn) {
    mirrorBtn.classList.toggle('active', state.mirrorMode === true);
    mirrorBtn.setAttribute('aria-pressed', String(state.mirrorMode === true));
  }
  syncSweepUI();
  syncParticleUI();
  const bgDot = document.getElementById('bgColorDot');
  if (bgDot) bgDot.style.background = state.bgColor;
  document.getElementById('paramShowGrid').checked = state.showGrid;
  const showGuidesCb = document.getElementById('paramShowRoundingGuides');
  if (showGuidesCb) showGuidesCb.checked = state.roundingGuidesOverlayEnabled === true;
  const dashedGuidesCb = document.getElementById('paramRoundingGuidesDashed');
  if (dashedGuidesCb) dashedGuidesCb.checked = state.roundingGuidesDashed !== false;
  const guideControls = document.getElementById('roundingGuideControls');
  if (guideControls) guideControls.classList.toggle('hidden', state.roundingGuidesOverlayEnabled !== true);
  const guideColor = state.roundingGuideColor || '#94a3b8';
  const guideColorEl = document.getElementById('paramRoundingGuideColor');
  if (guideColorEl) guideColorEl.value = guideColor;
  const guideOpacity = Number(state.roundingGuideOpacity ?? 28);
  const guideOpacityEl = document.getElementById('paramRoundingGuideOpacity');
  if (guideOpacityEl) guideOpacityEl.value = guideOpacity;
  const guideOpacityText = document.getElementById('valRoundingGuideOpacity');
  if (guideOpacityText && document.activeElement !== guideOpacityText)
    guideOpacityText.textContent = `${Math.round(guideOpacity)}%`;
  document.getElementById('paramShowBoundingCircle').checked = state.showBoundingCircle;
  const circleColor = state.boundingCircleColor || '#94a3b8';
  document.getElementById('paramBoundingCircleColor').value = circleColor;
  const circleDot = document.getElementById('boundingCircleColorDot');
  if (circleDot) circleDot.style.background = circleColor;

  syncGeometryNControl(layer.N, runtimeState.morph.active);

  const maxK = Math.max(1, Math.floor(layer.N / 2));
  document.getElementById('paramK').max = maxK;
  document.getElementById('paramK').step = runtimeState.morph.active ? '0.01' : '1';
  document.getElementById('numK').max = maxK;
  document.getElementById('paramK').value = Math.min(layer.K, maxK);
  document.getElementById('numK').value = Math.min(layer.K, maxK);

  const chaosOn = layer.chaosStar === true;
  const chaosToggle = document.getElementById('paramChaosStar');
  if (chaosToggle) chaosToggle.checked = chaosOn;
  document.getElementById('chaosStarSettings')?.classList.toggle('hidden', !chaosOn);
  document.getElementById('chaosStarHint')?.classList.toggle('hidden', !chaosOn);
  const chaosMinus = document.getElementById('chaosStepMinus');
  if (chaosMinus && document.activeElement !== chaosMinus)
    chaosMinus.value = String(Math.max(0, Math.min(120, Math.round(Number(layer.chaosStepMinus) || 0))));
  const chaosPlus = document.getElementById('chaosStepPlus');
  if (chaosPlus && document.activeElement !== chaosPlus)
    chaosPlus.value = String(Math.max(0, Math.min(120, Math.round(Number(layer.chaosStepPlus) || 0))));
  const chaosClosures = document.getElementById('chaosClosures');
  if (chaosClosures && document.activeElement !== chaosClosures) {
    chaosClosures.max = String(Math.max(1, Math.round(Number(layer.N) || 4)));
    chaosClosures.value = String(
      Math.max(1, Math.min(Math.round(Number(layer.N) || 4), Math.round(Number(layer.chaosClosures) || 1))),
    );
  }
  const chaosRegen = document.getElementById('btnRegenerateChaosStar');
  if (chaosRegen) {
    chaosRegen.disabled = !chaosOn;
    chaosRegen.classList.toggle('hidden', !chaosOn);
  }

  const circleCfg =
    layer.geometryCircles && typeof layer.geometryCircles === 'object'
      ? layer.geometryCircles
      : (layer.geometryCircles = {
          enabled: false,
          circumscribed: false,
          inscribed: false,
          median: false,
          keyPoints: false,
        });
  const circlesEnabled = circleCfg.enabled === true;
  const circleToggle = document.getElementById('paramGeometryCircles');
  if (circleToggle) circleToggle.checked = circlesEnabled;
  document.getElementById('geometryCircleModes')?.classList.toggle('hidden', !circlesEnabled);
  const cc = document.getElementById('circleModeCircumscribed');
  if (cc) cc.checked = circleCfg.circumscribed === true;
  const ci = document.getElementById('circleModeInscribed');
  if (ci) ci.checked = circleCfg.inscribed === true;
  const cm = document.getElementById('circleModeMedian');
  if (cm) cm.checked = circleCfg.median === true;
  const ck = document.getElementById('circleModeKeyPoints');
  if (ck) ck.checked = circleCfg.keyPoints === true;

  const maxS = gcd(layer.N, layer.K);
  const hasMultipleSuborbits = maxS > 1;

  const subContainer = document.getElementById('suborbitsContainer');
  const subInput = document.getElementById('numSuborbits');
  const subRange = document.getElementById('paramSuborbits');
  const btnDecS = document.getElementById('btnDecS');
  const btnIncS = document.getElementById('btnIncS');
  const notice = document.getElementById('gcdNotice');

  subInput.max = maxS;
  subRange.max = maxS;

  if (chaosOn) {
    // Disable only direct editing; Morph routing remains available.
    subContainer.style.opacity = '1';
    subInput.disabled = true;
    subRange.disabled = true;
    btnDecS.disabled = true;
    btnIncS.disabled = true;
    notice.textContent = '⚠️ В режиме «Звезда хаоса» суборбиты не используются.';
    notice.classList.remove('hidden');
    subInput.value = '1';
    subRange.value = '1';
  } else if (hasMultipleSuborbits) {
    subContainer.style.opacity = '1';
    subInput.disabled = false;
    subRange.disabled = false;
    btnDecS.disabled = false;
    btnIncS.disabled = false;
    notice.textContent = '⚠️ Суборбиты доступны, когда НОД(N, K) больше 1.';
    notice.classList.add('hidden');

    const curS =
      layer.customSuborbits !== null && layer.customSuborbits !== undefined
        ? Math.min(layer.customSuborbits, maxS)
        : maxS;
    subInput.value = curS;
    subRange.value = curS;
  } else {
    // N and K may be morphed into a multi-suborbit topology later.
    subContainer.style.opacity = '1';
    subInput.disabled = true;
    subRange.disabled = true;
    btnDecS.disabled = true;
    btnIncS.disabled = true;
    notice.textContent = '⚠️ Суборбиты доступны, когда НОД(N, K) больше 1.';
    notice.classList.remove('hidden');

    subInput.value = maxS;
    subRange.value = maxS;
  }

  const topology = getProfileTopologyStatus(layer);
  const isBroken = topology.broken;
  const closedCheckbox = document.getElementById('paramClosedLoop');
  const lineJoinContainer = document.getElementById('lineJoinTypeContainer');
  const badge = document.getElementById('loopStatusBadge');
  const spiralTopologyBadge = document.getElementById('spiralTopologyBadge');
  const contourMode = getContourMode(layer);
  const spiralModeActive = contourModeIsSpiral(contourMode);

  closedCheckbox.disabled = false;
  closedCheckbox.checked = !['open', 'spiral-open'].includes(contourMode);
  const family = contourMode.startsWith('extended-') ? 'extended' : spiralModeActive ? 'spiral' : 'polygon';
  const second = ['open', 'spiral-open'].includes(contourMode);
  document.querySelectorAll('[data-contour-family]').forEach((btn) => {
    const active = btn.dataset.contourFamily === family;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-contour-variant]').forEach((btn) => {
    const active = (btn.dataset.contourVariant === 'second') === second;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-contour-variant]').forEach((btn, i) => {
    btn.textContent = i === 0 ? 'Замкнутый' : 'Разомкнутый';
  });
  const extendedActive = family === 'extended';
  const extendedButton = document.getElementById('btnExtendedContour');
  if (extendedButton) {
    extendedButton.textContent = extendedActive ? 'Выключить продлённый' : 'Включить продлённый';
    extendedButton.setAttribute('aria-pressed', String(extendedActive));
    extendedButton.classList.toggle('active', extendedActive);
  }
  document.getElementById('extendedContourVariants')?.classList.toggle('hidden', !extendedActive);
  document.querySelectorAll('[data-extended-variant]').forEach((btn) => {
    const active = (btn.dataset.extendedVariant === 'second') === (contourMode === 'extended-profile');
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });

  const closedMode = contourMode === 'closed';
  lineJoinContainer.classList.toggle('hidden', !closedMode);
  lineJoinContainer.style.opacity = closedMode && isBroken ? '1' : '0.48';
  lineJoinContainer.style.pointerEvents = closedMode && isBroken ? 'auto' : 'none';

  if (spiralModeActive) {
    badge.textContent = 'Спираль';
    badge.style.background = 'rgba(6,182,212,0.18)';
    badge.style.color = '#67e8f9';
    spiralTopologyBadge?.classList.remove('hidden');
    applyTopologyBadgeStyle(spiralTopologyBadge, topology);
  } else {
    spiralTopologyBadge?.classList.add('hidden');
    applyTopologyBadgeStyle(badge, topology);
  }

  const currentJoin = layer.lineJoinType || 'straight';
  document.querySelectorAll('.line-join-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.join === currentJoin);
  });

  document.getElementById('paramRounding').value = clampRoundingPercent(layer.rounding);
  // Classic Spline+ and local fillets are independent; Fourier is scene-wide.
  // Normalize old imported layers without changing radius policy.
  layer.roundingShape = 'hybrid';
  const cornerType = ['local', 'classic', 'fourier'].includes(layer.roundingCornerType)
    ? layer.roundingCornerType
    : 'classic';
  document.getElementById('roundingFourierControls')?.classList.toggle('hidden', cornerType !== 'fourier');
  const cornerSelect = document.getElementById('paramRoundingCornerType');
  if (cornerSelect) cornerSelect.value = cornerType;
  document.querySelectorAll('.rounding-corner-type-btn').forEach((btn) => {
    const active = btn.dataset.roundingCornerType === cornerType;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  const roundingModeEl = document.getElementById('paramRoundingMode');
  if (roundingModeEl) roundingModeEl.value = layer.roundingMode === 'monoradius' ? 'monoradius' : 'standard';
  document.querySelectorAll('.rounding-mode-btn[data-rounding-mode]').forEach((btn) => {
    const active =
      btn.dataset.roundingMode === (layer.roundingMode === 'monoradius' ? 'monoradius' : 'standard');
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  setSidebarValueText('valRounding', formatDisplayNumber(layer.rounding, 1) + '%');

  document.getElementById('paramRadius').value = layer.radius;
  const radiusMultEl = document.getElementById('paramRadiusMultiplier');
  if (radiusMultEl && document.activeElement !== radiusMultEl)
    radiusMultEl.value = String(getLayerRadiusMultiplier(layer));
  setSidebarValueText(
    'valRadius',
    `${formatDisplayNumber(layer.radius, 1)} × ${formatDisplayNumber(getLayerRadiusMultiplier(layer), 2)}`,
  );

  document.getElementById('paramRotation').value = layer.rotation;
  setSidebarValueText('valRotation', formatDisplayNumber(layer.rotation, 1) + '°');
  document.getElementById('spiralSettingsBlock')?.classList.remove('hidden'); // Stage 6: settings remain visible at order 0.
  const zeroModeInput = document.getElementById('paramSpiralZeroTransition');
  if (zeroModeInput) zeroModeInput.value = SomataSpiralZeroTransition.transitionOf(layer);
  const buildInput = document.getElementById('paramSpiralConstruction');
  if (buildInput) buildInput.value = SomataSpiralZeroTransition.buildOf(layer);
  const manual = layer.spiralManualFocus === true;
  const rawFigure = Number(layer.spiralRotationFocusFigure);
  const configuredFigure = Math.max(1, Math.min(256, Math.round(Number.isFinite(rawFigure) ? rawFigure : 7)));
  const currentTotal = Math.max(
    1,
    Math.round(
      Number(layer?.__somataFocusFrame?.total) ||
        Number(document.getElementById('spiralFocusCopyCount')?.dataset?.focusCount) ||
        7,
    ),
  );
  const focusFigure = Math.min(currentTotal, manual ? configuredFigure : 7);
  for (const id of ['paramSpiralManualFocus', 'tunnelManualFocus']) {
    const el = document.getElementById(id);
    if (el) el.checked = manual;
  }
  for (const id of ['spiralManualFocusControls', 'tunnelManualFocusControls'])
    document.getElementById(id)?.classList.toggle('hidden', !manual);
  for (const id of ['paramSpiralRotationFocus', 'tunnelFocusNumber']) {
    const el = document.getElementById(id);
    if (el) {
      el.max = String(currentTotal);
      if (document.activeElement !== el) el.value = String(focusFigure);
    }
  }
  for (const id of ['spiralFocusPercentText', 'tunnelFocusPercentText']) {
    const el = document.getElementById(id);
    if (el) el.textContent = `№${focusFigure}`;
  }
  for (const id of ['paramSpiralFocusHighlight', 'tunnelFocusHighlight']) {
    const el = document.getElementById(id);
    if (el) el.checked = layer.corridorFocusHighlight === true;
  }
  const squashYInput = document.getElementById('paramSpiralSquashY');
  if (squashYInput) {
    const value = normalizeSpiralSquashY(layer.spiralSquashY);
    squashYInput.value = String(value);
    document.getElementById('spiralSquashYValue').textContent = `${value}%`;
  }
  const spiralOrderInput = document.getElementById('paramSpiralOrder');
  if (spiralOrderInput && document.activeElement !== spiralOrderInput) {
    spiralOrderInput.value = getEffectiveSpiralOrder(layer);
  }
  const stepLinked = layer.spiralStepLinked !== false;
  const spiralStepInput = document.getElementById('paramSpiralStep');
  const spiralStepLinkInput = document.getElementById('paramSpiralStepLinked');
  if (spiralStepInput) {
    spiralStepInput.removeAttribute('min');
    spiralStepInput.removeAttribute('max');
    spiralStepInput.step = 'any';
    spiralStepInput.disabled = stepLinked;
    spiralStepInput
      .closest('.spiral-settings-row')
      ?.classList.toggle('spiral-step-manual-disabled', stepLinked);
    if (document.activeElement !== spiralStepInput)
      spiralStepInput.value = String(getEffectiveSpiralStep(layer));
  }
  if (spiralStepLinkInput) spiralStepLinkInput.checked = stepLinked;
  const limitEnabled = layer.spiralStepLimiterEnabled !== false;
  const limiterEnabledInput = document.getElementById('paramSpiralStepLimiterEnabled');
  const limiterNumberInput = document.getElementById('paramSpiralStepLimiter');
  if (limiterEnabledInput) limiterEnabledInput.checked = limitEnabled;
  if (limiterNumberInput) {
    limiterNumberInput.disabled = !limitEnabled;
    if (document.activeElement !== limiterNumberInput)
      limiterNumberInput.value = String(
        Math.max(1, Math.min(120, Math.round(Number(layer.spiralStepLimiter ?? 2) || 2))),
      );
  }
  const spiralClosed = contourMode === 'spiral-closed' || contourMode === 'closed';
  const twistInput = document.getElementById('paramSpiralTwist');
  if (twistInput) twistInput.checked = layer.spiralTwist === true;
  const twistRow = document.getElementById('spiralTwistRow');
  const orbitUnfold =
    window.SomataSpiralZeroTransition?.usesOrbitUnfold(SomataSpiralZeroTransition.buildOf(layer)) === true;
  twistRow?.classList.toggle('spiral-setting-inactive', !isSpiralLayer(layer) && !orbitUnfold);
  if (twistRow)
    twistRow.title = orbitUnfold
      ? 'На переходе 0 ↔ ±1 добавляет небольшой поворот всей орбиты, не размыкая её внутренние вершины.'
      : 'Включено: связанный виток. Выключено: независимые спиральные ветви по геометрии Somata 13.2.';
  const tangentInput = document.getElementById('paramSpiralTangential');
  const tangentialEnabled = layer.spiralTangential === true; // Preserve latent setting at order 0.
  if (tangentInput) {
    tangentInput.checked = tangentialEnabled;
    tangentInput.disabled = false; // Editable at order 0; geometry only uses it for nonzero order.
  }
  const seamRoundInput = document.getElementById('paramSpiralRoundSeams');
  if (seamRoundInput) {
    seamRoundInput.checked = layer.spiralRoundSeams !== false;
    seamRoundInput.disabled = !spiralClosed;
  }
  const tangentRow = document.getElementById('spiralTangentialRow');
  const seamRow = document.getElementById('spiralRoundSeamsRow');
  tangentRow?.classList.remove('hidden');
  seamRow?.classList.remove('hidden');
  tangentRow?.classList.toggle('spiral-setting-inactive', Math.abs(getEffectiveSpiralOrder(layer)) <= 1e-8);
  seamRow?.classList.toggle('spiral-setting-disabled', !spiralClosed);
  const spiralFillInput = document.getElementById('paramSpiralFillEnabled');
  const spiralFillTypeRow = document.getElementById('spiralFillTypeRow');
  const spiralFillTypeInput = document.getElementById('paramSpiralFillType');
  const spiralFillEnabled = layer.spiralFillEnabled === true;
  if (spiralFillInput) spiralFillInput.checked = spiralFillEnabled;
  spiralFillTypeRow?.classList.toggle('hidden', !spiralFillEnabled);
  if (spiralFillTypeInput && document.activeElement !== spiralFillTypeInput)
    spiralFillTypeInput.value = ['interwinding', 'mathematical'].includes(layer.spiralFillType)
      ? layer.spiralFillType
      : 'chopped';

  // The segmented accumulation mode is retired: old saved values
  // migrate to uniform as soon as a layer becomes active.
  layer.lineLayerMode = 'uniform';
  layer.spiralLineType = 'uniform';
  const lineOpacity = Math.max(
    0,
    Math.min(100, Number.isFinite(Number(layer.lineOpacity)) ? Number(layer.lineOpacity) : 100),
  );
  layer.lineOpacity = lineOpacity;
  const lineOpacityInput = document.getElementById('paramLineOpacity');
  if (lineOpacityInput && document.activeElement !== lineOpacityInput)
    lineOpacityInput.value = String(lineOpacity);
  setSidebarValueText('valLineOpacity', formatDisplayNumber(lineOpacity, 1) + '%');

  const layerOpacity = layer.opacity !== undefined ? layer.opacity : 100;
  document.getElementById('paramOpacity').value = layerOpacity;
  setSidebarValueText('valOpacity', formatDisplayNumber(layerOpacity, 1) + '%');

  document.getElementById('paramStrokeColor').value = layer.strokeColor;
  document.getElementById('hexStroke').textContent = layer.strokeColor;
  const mainLineMode = getLayerMainLineMode(layer);
  document
    .querySelectorAll('[data-line-main-mode]')
    .forEach((btn) => btn.classList.toggle('active', btn.dataset.lineMainMode === mainLineMode));
  layer.lineMarkerType = normalizeLineMarkerType(
    layer.lineMarkerType ||
      (layer.lineProfileStroke && layer.lineProfileStroke !== 'round' ? layer.lineProfileStroke : 'slash'),
    'slash',
  );
  document
    .querySelectorAll('[data-line-marker-type]')
    .forEach((btn) => btn.classList.toggle('active', btn.dataset.lineMarkerType === layer.lineMarkerType));
  document.getElementById('lineMarkerTypeRow')?.classList.toggle('line-mode-hidden', mainLineMode !== 'dash');
  document.getElementById('lineProfileSpriteLockHint')?.classList.toggle('hidden', mainLineMode !== 'sprite');
  const graffitiOn = mainLineMode === 'graffiti';
  layer.lineProfileGraffiti = normalizeLineProfileValue(layer.lineProfileGraffiti, 'slash');
  document.getElementById('graffitiProfileRow')?.classList.toggle('line-mode-hidden', !graffitiOn);
  document.getElementById('graffitiProfileRow')?.classList.toggle('hidden', !graffitiOn);
  const spriteBlock = document.getElementById('lineSpriteBlock');
  if (spriteBlock) spriteBlock.classList.toggle('line-mode-hidden', mainLineMode !== 'sprite');
  const nibShapeNow = ['pointed', 'blunt', 'pinched', 'round'].includes(layer.graffitiNibShape)
    ? layer.graffitiNibShape
    : 'pointed';
  document
    .querySelectorAll('[data-graffiti-nib]')
    .forEach((btn) => btn.classList.toggle('active', btn.dataset.graffitiNib === nibShapeNow));
  const graffitiAngle = Math.max(
    -90,
    Math.min(90, Number.isFinite(Number(layer.graffitiAngle)) ? Number(layer.graffitiAngle) : 45),
  );
  const graffitiAngleRow = document.getElementById('graffitiAngleRow');
  if (graffitiAngleRow) {
    graffitiAngleRow.classList.toggle('hidden', !graffitiOn);
    graffitiAngleRow.classList.toggle('line-mode-hidden', !graffitiOn);
  }
  const graffitiAngleInput = document.getElementById('graffitiAngle');
  if (graffitiAngleInput) graffitiAngleInput.value = graffitiAngle;
  const graffitiAngleValue = document.getElementById('graffitiAngleValue');
  if (graffitiAngleValue) graffitiAngleValue.textContent = `${Math.round(graffitiAngle)}°`;
  const graffitiAngleMode = ['absolute', 'relative'].includes(layer.graffitiAngleMode)
    ? layer.graffitiAngleMode
    : 'absolute';
  layer.graffitiAngleMode = graffitiAngleMode;
  const graffitiAngleModeRow = document.getElementById('graffitiAngleModeRow');
  if (graffitiAngleModeRow) {
    graffitiAngleModeRow.classList.toggle('hidden', !graffitiOn);
    graffitiAngleModeRow.classList.toggle('line-mode-hidden', !graffitiOn);
  }
  const graffitiAngleModeInput = document.getElementById('graffitiAngleMode');
  if (graffitiAngleModeInput) graffitiAngleModeInput.value = graffitiAngleMode;
  const graffitiNibRow = document.getElementById('graffitiNibRow');
  if (graffitiNibRow) {
    graffitiNibRow.classList.toggle('hidden', !graffitiOn);
    graffitiNibRow.classList.toggle('line-mode-hidden', !graffitiOn);
  }
  const graffitiNibShape = ['pointed', 'blunt', 'pinched', 'round'].includes(layer.graffitiNibShape)
    ? layer.graffitiNibShape
    : 'pointed';
  const graffitiNibShapeInput = document.getElementById('graffitiNibShape');
  if (graffitiNibShapeInput) graffitiNibShapeInput.value = graffitiNibShape;
  const graffitiNibLength = Math.max(1, Math.min(20, Number(layer.graffitiNibLength) || 3));
  const graffitiNibLengthMultiplier = Math.max(
    0.01,
    Number.isFinite(Number(layer.graffitiNibLengthMultiplier))
      ? Number(layer.graffitiNibLengthMultiplier)
      : 1,
  );
  const graffitiNibLengthRange = document.getElementById('graffitiNibLength');
  if (graffitiNibLengthRange) graffitiNibLengthRange.value = graffitiNibLength;
  const graffitiNibLengthText = document.getElementById('graffitiNibLengthText');
  if (graffitiNibLengthText)
    graffitiNibLengthText.textContent = graffitiNibLength.toFixed(graffitiNibLength % 1 ? 2 : 0);
  const graffitiNibLengthMultiplierInput = document.getElementById('graffitiNibLengthMultiplier');
  if (graffitiNibLengthMultiplierInput) graffitiNibLengthMultiplierInput.value = graffitiNibLengthMultiplier;
  const graffitiVariationMode = getGraffitiVariationMode(layer);
  const graffitiVariationModeInput = document.getElementById('graffitiVariationMode');
  if (graffitiVariationModeInput) graffitiVariationModeInput.value = graffitiVariationMode;
  const graffitiVariationEveryN = Math.max(
    1,
    Math.min(24, Math.round(Number(layer.graffitiVariationEveryN) || 2)),
  );
  const graffitiVariationEveryNRow = document.getElementById('graffitiVariationEveryNRow');
  if (graffitiVariationEveryNRow)
    graffitiVariationEveryNRow.classList.toggle('hidden', graffitiVariationMode !== 'everyNth');
  syncGpuLineFxUI(layer);
  const graffitiVariationEveryNInput = document.getElementById('graffitiVariationEveryN');
  if (graffitiVariationEveryNInput) graffitiVariationEveryNInput.value = graffitiVariationEveryN;
  const graffitiVariationEveryNText = document.getElementById('graffitiVariationEveryNText');
  if (graffitiVariationEveryNText) graffitiVariationEveryNText.textContent = String(graffitiVariationEveryN);
  const sizeVarOn = layer.graffitiSizeVariationEnabled === true,
    sizeVar = Math.max(
      0,
      Math.min(
        100,
        Number.isFinite(Number(layer.graffitiSizeVariation)) ? Number(layer.graffitiSizeVariation) : 30,
      ),
    ),
    sizeFocus = Math.max(
      0,
      Math.min(100, Number.isFinite(Number(layer.graffitiSizeFocus)) ? Number(layer.graffitiSizeFocus) : 75),
    );
  const sizeBlock = document.getElementById('graffitiSizeVariationBlock');
  if (sizeBlock) sizeBlock.classList.toggle('variation-disabled', !sizeVarOn);
  const sizeCb = document.getElementById('graffitiSizeVariationEnabled');
  if (sizeCb) sizeCb.checked = sizeVarOn;
  const sizeR = document.getElementById('graffitiSizeVariation');
  if (sizeR) sizeR.value = sizeVar;
  const sizeV = document.getElementById('graffitiSizeVariationValue');
  if (sizeV) sizeV.textContent = Math.round(sizeVar) + '%';
  const sizeF = document.getElementById('graffitiSizeFocus');
  if (sizeF) sizeF.value = sizeFocus;
  const sizeFV = document.getElementById('graffitiSizeFocusValue');
  if (sizeFV) sizeFV.textContent = Math.round(sizeFocus) + '%';
  const rotVarOn = layer.graffitiRotationVariationEnabled === true,
    rotVar = Math.max(0, Math.min(180, Number(layer.graffitiRotationVariation) || 0)),
    rotMul = Math.max(
      0,
      Number.isFinite(Number(layer.graffitiRotationMultiplier))
        ? Number(layer.graffitiRotationMultiplier)
        : 1,
    ),
    rotFocus = Math.max(
      0,
      Math.min(
        100,
        Number.isFinite(Number(layer.graffitiRotationFocus)) ? Number(layer.graffitiRotationFocus) : 50,
      ),
    );
  const rotBlock = document.getElementById('graffitiRotationVariationBlock');
  if (rotBlock) rotBlock.classList.toggle('variation-disabled', !rotVarOn);
  const rotCb = document.getElementById('graffitiRotationVariationEnabled');
  if (rotCb) rotCb.checked = rotVarOn;
  const rotR = document.getElementById('graffitiRotationVariation');
  if (rotR) rotR.value = rotVar;
  const rotV = document.getElementById('graffitiRotationVariationValue');
  if (rotV) rotV.textContent = Math.round(rotVar) + '°';
  const rotM = document.getElementById('graffitiRotationMultiplier');
  if (rotM) rotM.value = rotMul;
  const rotF = document.getElementById('graffitiRotationFocus');
  if (rotF) rotF.value = rotFocus;
  const rotFV = document.getElementById('graffitiRotationFocusValue');
  if (rotFV) rotFV.textContent = Math.round(rotFocus) + '%';
  if (Number(layer.strokeWidth) > 50) {
    const effective = Number(layer.strokeWidth) * getLayerStrokeWidthMultiplier(layer);
    if (effective <= 0) {
      layer.strokeWidth = 50;
      layer.strokeWidthMultiplier = 0;
    } else {
      const nextMult = Math.max(1, Math.ceil(effective / 50));
      layer.strokeWidth = effective / nextMult;
      layer.strokeWidthMultiplier = nextMult;
    }
  }
  document.getElementById('paramStrokeWidth').value = layer.strokeWidth;
  const numStrokeWidth = document.getElementById('numStrokeWidth');
  if (numStrokeWidth) numStrokeWidth.value = formatDisplayNumber(layer.strokeWidth, 1);
  const strokeWidthMultiplier = getLayerStrokeWidthMultiplier(layer);
  const swm = document.getElementById('paramStrokeWidthMultiplier');
  if (swm) swm.value = strokeWidthMultiplier;
  setSidebarValueText('valStrokeWidth', formatDisplayNumber(layer.strokeWidth, 1) + 'px');

  document.getElementById('paramGlow').value = layer.glow;
  const numGlow = document.getElementById('numGlow');
  if (numGlow) numGlow.value = formatDisplayNumber(layer.glow, 1);
  const glowMultiplier = getLayerGlowMultiplier(layer);
  const gm = document.getElementById('paramGlowMultiplier');
  if (gm) gm.value = glowMultiplier;
  setSidebarValueText('valGlow', formatDisplayNumber(layer.glow, 1) + 'px');
  const glowIntensity = Math.max(
    0,
    Math.min(200, Number.isFinite(Number(layer.glowIntensity)) ? Number(layer.glowIntensity) : 40),
  );
  const gi = document.getElementById('paramGlowIntensity');
  if (gi) gi.value = glowIntensity;
  const gim = getLayerGlowIntensityMultiplier(layer),
    gimi = document.getElementById('paramGlowIntensityMultiplier');
  if (gimi) gimi.value = gim;
  setSidebarValueText('valGlowIntensity', `${Math.round(glowIntensity)}% × ${formatDisplayNumber(gim, 2)}`);

  document.getElementById('paramEnableFill').checked = layer.fill !== false;
  layer.fill = layer.fill !== false;
  layer.fillMatchStroke = layer.fillMatchStroke !== false;
  layer.fillRule = normalizeLayerFillRule(layer);
  layer.fillType = normalizeLayerFillType(layer);
  layer.fillAccumulationSeconds = getLayerFillAccumulationSeconds(layer);
  layer.fillFadeDirection = getLayerFillFadeDirection(layer);
  layer.fillFadeHardness = getLayerFillFadeHardness(layer);
  layer.fillFadePixelization = getLayerFillFadePixelization(layer);
  if (getLayerFillMatchStroke(layer)) syncLayerFillColorToStroke(layer);
  if (layer.fillColor && layer.fillColor.length >= 7) {
    document.getElementById('paramFillColor').value = colorBaseHex6(
      layer.fillColor,
      layer.strokeColor || '#4f46e5',
    );
  }
  const fillMatchControl = document.getElementById('fillMatchStrokeControl');
  const fillMatchInput = document.getElementById('paramFillMatchStroke');
  if (fillMatchInput) fillMatchInput.checked = getLayerFillMatchStroke(layer);
  fillMatchControl?.classList.toggle('hidden', !layer.fill);
  document.getElementById('fillModeControl')?.classList.toggle('hidden', !layer.fill);
  document.getElementById('fillSettingsBody')?.classList.toggle('fill-disabled', !layer.fill);
  const fillModeChoice = getLayerFillModeChoice(layer);
  const fillModeInput = document.getElementById('paramFillMode');
  if (fillModeInput) fillModeInput.value = fillModeChoice;
  const fillAccumulationControl = document.getElementById('fillAccumulationControl');
  const fillFadeDirectionControl = document.getElementById('fillFadeDirectionControl');
  const fillFadeHardnessControl = document.getElementById('fillFadeHardnessControl');
  const fillFadePixelizationControl = document.getElementById('fillFadePixelizationControl');
  fillAccumulationControl?.classList.toggle('hidden', !layer.fill || fillModeChoice !== 'accumulation');
  fillFadeDirectionControl?.classList.toggle(
    'hidden',
    !layer.fill || !(fillModeChoice === 'fade' || fillModeChoice === 'fadeSmooth'),
  );
  fillFadeHardnessControl?.classList.toggle(
    'hidden',
    !layer.fill || !(fillModeChoice === 'fade' || fillModeChoice === 'fadeSmooth'),
  );
  fillFadePixelizationControl?.classList.toggle('hidden', !layer.fill || fillModeChoice !== 'fade');
  const fillAccumulationInput = document.getElementById('paramFillAccumulationSeconds');
  if (fillAccumulationInput) fillAccumulationInput.value = String(layer.fillAccumulationSeconds);
  const fillFadeDirectionInput = document.getElementById('paramFillFadeDirection');
  if (fillFadeDirectionInput) fillFadeDirectionInput.value = layer.fillFadeDirection;
  const fillFadeHardnessInput = document.getElementById('paramFillFadeHardness');
  if (fillFadeHardnessInput) fillFadeHardnessInput.value = String(layer.fillFadeHardness);
  const fillFadeHardnessValue = document.getElementById('valFillFadeHardness');
  if (fillFadeHardnessValue) fillFadeHardnessValue.textContent = `${Math.round(layer.fillFadeHardness)}%`;
  const fillFadePixelizationInput = document.getElementById('paramFillFadePixelization');
  if (fillFadePixelizationInput) fillFadePixelizationInput.value = String(layer.fillFadePixelization);
  const fillFadePixelizationValue = document.getElementById('valFillFadePixelization');
  if (fillFadePixelizationValue)
    fillFadePixelizationValue.textContent = `${Math.round(layer.fillFadePixelization)}%`;
  const fillModeHint = document.getElementById('fillModeHint');
  if (fillModeHint) {
    if (fillModeChoice === 'accumulation')
      fillModeHint.textContent = 'Накапливает состояния заливки и очищает историю по таймеру.';
    else if (fillModeChoice === 'fade')
      fillModeHint.textContent =
        'Резкое контурное затухание с выраженными слоями — сохранённый исходный эффект.';
    else if (fillModeChoice === 'fadeSmooth')
      fillModeHint.textContent =
        'Плавное контурное затухание без выраженных ступеней; форма следует контуру фигуры.';
    else if (fillModeChoice === 'mathematical')
      fillModeHint.textContent = 'Самопересечения инвертируют заливку (even-odd).';
    else fillModeHint.textContent = 'Плотная заливка по направлению контура (non-zero winding).';
  }
  const fillColorInput = document.getElementById('paramFillColor');
  if (fillColorInput) fillColorInput.disabled = getLayerFillMatchStroke(layer);
  const fillOpacity = getFillOpacityPercent(layer.fillColor);
  const fillOpacityControl = document.getElementById('fillOpacityControl');
  const fillOpacityInput = document.getElementById('paramFillOpacity');
  const fillOpacityValue = document.getElementById('valFillOpacity');
  fillOpacityControl?.classList.toggle('hidden', !layer.fill);
  if (fillOpacityInput) fillOpacityInput.value = String(Math.round(fillOpacity));
  if (fillOpacityValue) fillOpacityValue.textContent = formatDisplayNumber(fillOpacity, 0) + '%';
  renderGraffitiPaletteChooser(layer);

  document.querySelectorAll('.profile-mode-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.mode === layer.profileMode);
  });
  const wholeCurveSplineInput = document.getElementById('paramWholeCurveSpline');
  if (wholeCurveSplineInput) {
    wholeCurveSplineInput.checked = layer.wholeCurveSpline === true;
    wholeCurveSplineInput.disabled = layer.profileMode !== 'spline';
  }
  const splineRenderMode = normalizeSplineRenderMode(layer.splineRenderMode);
  document.querySelectorAll('[data-spline-render-mode]').forEach((btn) => {
    const on = btn.dataset.splineRenderMode === splineRenderMode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const rawProfileModeTransition = state.morph.profileModeTransition;
  const profileModeTransition =
    rawProfileModeTransition === 'second'
      ? 'start'
      : ['phase', 'start', 'end'].includes(rawProfileModeTransition)
        ? rawProfileModeTransition
        : 'phase';
  state.morph.profileModeTransition = profileModeTransition;
  document.querySelectorAll('[data-profile-mode-transition]').forEach((btn) => {
    const on = btn.dataset.profileModeTransition === profileModeTransition;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const transitionPct = Math.max(
    0,
    Math.min(100, Math.round(Number(state.morph.profileModeTransitionPercent) || 0)),
  );
  state.morph.profileModeTransitionPercent = transitionPct;
  const transitionPctRow = document.getElementById('profileModeTransitionPercentRow');
  transitionPctRow?.classList.toggle('hidden', profileModeTransition === 'phase');
  const transitionPctInput = document.getElementById('profileModeTransitionPercent');
  if (transitionPctInput && document.activeElement !== transitionPctInput)
    transitionPctInput.value = String(transitionPct);
  const transitionPctValue = document.getElementById('profileModeTransitionPercentValue');
  if (transitionPctValue) transitionPctValue.textContent = `${transitionPct}%`;
  const splinePointCount = getConfiguredSplinePointCount();
  const splinePointInput = document.getElementById('profileSplinePointCount');
  const splinePointText = document.getElementById('profileSplinePointCountText');
  if (splinePointInput && document.activeElement !== splinePointInput)
    splinePointInput.value = String(splinePointCount);
  if (splinePointText) splinePointText.textContent = 'точ.';

  syncProfilePresetLibrarySelection(layer);
  syncSidebarToolStates();
  syncBlueMorphParameterDecorations();
}

export { syncGpuLineFxUI, syncSidebarInputs, updateSidebarFromMorph };
