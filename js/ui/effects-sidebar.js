// Сайдбар эффектов: режим линии, граффити, Фурье, паутина, лампы, проблеск.
import '../render/web-threads-draw.js'; // initialisation order: this module runs after it
import {
  SOMATA_DEFAULT_GRAFFITI_STROKE_WIDTH,
  SOMATA_DEFAULT_LINE_STROKE_WIDTH,
  compactSweepPixelValue,
  ensureLayerEffectState,
  everyLayerMatches,
  getActiveEffectLayer,
  getActiveLampConfig,
  getEffectTargets,
  getLayerGlintEnabled,
  getLayerLampsEnabled,
  getLayerLightningEnabled,
  getLayerLineVisible,
  getLayerSweepConfig,
  getLayerWebConfig,
  getLayerWebEnabled,
  linesAreEffectivelyVisible,
  markLayerEffectChanged,
  normalizeLightningLampBlendMode,
  normalizeLineSpriteConfig,
  normalizeParticleConfig,
  normalizeSweepBlendMode,
  normalizeSweepConfig,
  normalizeSweepFlashMode,
  syncLineMasterVisibilityUI,
  withLampConfig,
} from '../core/defaults-layers.js';
import { invalidateLayerEffect, invalidateLayerGeometry } from '../core/render-runtime.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { state } from '../core/state.js';
import {
  anyMotionEnabled,
  getMotionRotationTargets,
  normalizeLayerMotionRotation,
  normalizeMotionState,
} from '../effects/motion.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { isLampContourAttachmentEnabled } from '../lamps/lamp-anchors.js';
import { frameGraphPerformanceRuntime } from '../render/backend-telemetry.js';
import { formatDisplayNumber, formatTimeSeconds } from './geometry-n-control.js';
import { renderPlaylistPaletteStudio } from './playlist-palettes.js';
import { syncSidebarInputs } from './sidebar-sync.js';
import { lampCornerInertiaMs } from '../lamps/lamp-attachment.js';
import { normalizeGlintPrecisionValue } from '../effects/sweep-glint.js';
import {
  normalizeLightningBehaviorValue,
  normalizeLightningPrecisionValue,
} from '../effects/lightning-exact.js';
import {
  formatLightningMultiplier,
  getLightningEffectiveCycleRateHz,
  getLightningTriggerSource,
  lightningRateSyncEnabled,
  setLightningBinarySelectValue,
} from '../effects/lightning.js';
import { ensureSweepAnimation } from '../effects/effect-animation.js';
import { getWebBranchFlags, webRuntime } from '../effects/web.js';
import { snapLampAdaptiveExponent } from '../lamps/adaptive-exponent.js';

function syncMorphModeDependentUI() {
  const mode = state.morph.mode;
  const fade = document.getElementById('morphFadeDurationRow');
  const slide = document.getElementById('morphSlideTypeRow');
  fade?.classList.toggle('is-visible', mode === 'fade');
  slide?.classList.add('is-visible'); // all 11 active morph modes share one sliding control

  window.SomataTestMorph?.syncModeOptions();
}
function syncMotionUI() {
  const m = normalizeMotionState(),
    active = getActiveEffectLayer(),
    r = normalizeLayerMotionRotation(active);
  const setCheck = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.checked = v === true;
  };
  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = String(v);
  };
  const rotationTargets = getMotionRotationTargets();
  const rotationEnabled =
    state.masterLayerEdit === true && rotationTargets.length
      ? rotationTargets.every((l) => normalizeLayerMotionRotation(l).enabled)
      : r.enabled;
  setCheck('motionRotationEnabled', rotationEnabled);
  setVal('motionRotationSpeed', r.speed);
  setVal('motionRotationMultiplier', r.multiplier);
  setVal('motionTunnelLag', r.tunnelLag);
  setVal('motionTunnelLagMultiplier', r.tunnelLagMultiplier);
  const dir = document.getElementById('motionRotationDirection');
  if (dir) {
    dir.value = r.direction;
    dir.dataset.direction = r.direction;
    dir.textContent = r.direction === 'cw' ? '↻ По часовой' : '↺ Против часовой';
    dir.setAttribute(
      'aria-label',
      r.direction === 'cw'
        ? 'Направление вращения слоя: по часовой. Клик — против часовой'
        : 'Направление вращения слоя: против часовой. Клик — по часовой',
    );
    dir.setAttribute('aria-pressed', r.direction === 'cw' ? 'true' : 'false');
  }
  setCheck('motionCameraEnabled', m.cameraEnabled);
  setVal('motionCameraSpeed', m.cameraSpeed);
  setVal('motionCameraMultiplier', m.cameraMultiplier);
  setVal('motionCameraAmount', m.cameraAmount);
  setCheck('motionColorEnabled', m.colorEnabled);
  setVal('motionColorSpeed', m.colorSpeed);
  setVal('motionColorMultiplier', m.colorMultiplier);
  const rt = document.getElementById('motionRotationSpeedText');
  if (rt) rt.textContent = `${formatDisplayNumber(r.speed, 0)}°/с × ${formatDisplayNumber(r.multiplier, 2)}`;
  const lag = document.getElementById('motionTunnelLagText');
  if (lag)
    lag.textContent = `${formatDisplayNumber(r.tunnelLag, 0)}° × ${formatDisplayNumber(r.tunnelLagMultiplier, 2)}`;
  const ct = document.getElementById('motionCameraSpeedText');
  if (ct)
    ct.textContent = `${formatDisplayNumber(m.cameraSpeed, 0)}% × ${formatDisplayNumber(m.cameraMultiplier, 2)}`;
  const ca = document.getElementById('motionCameraAmountText');
  if (ca) ca.textContent = `${formatDisplayNumber(m.cameraAmount, 0)}%`;
  const col = document.getElementById('motionColorSpeedText');
  if (col)
    col.textContent = `${formatDisplayNumber(m.colorSpeed, 0)}% × ${formatDisplayNumber(m.colorMultiplier, 2)}`;
  document.getElementById('motionRotationBlock')?.classList.toggle('disabled', !rotationEnabled);
  document.getElementById('motionCameraBlock')?.classList.toggle('disabled', !m.cameraEnabled);
  document.getElementById('motionColorBlock')?.classList.toggle('disabled', !m.colorEnabled);
  document.getElementById('btnSidebarMotion')?.classList.toggle('feature-enabled', anyMotionEnabled());
  const sel = document.querySelector('#motionPaletteHost select');
  if (sel && sel.value !== m.paletteKey) sel.value = m.paletteKey;
}
function syncSidebarToolStates() {
  const layer = (state.layers || []).find((l) => l.id === state.activeLayerId) || state.layers?.[0] || null;
  const lineBtn = document.getElementById('btnSidebarLines');
  document
    .getElementById('btnSidebarShape')
    ?.classList.toggle('feature-enabled', linesAreEffectivelyVisible());
  lineBtn?.classList.toggle('feature-enabled', linesAreEffectivelyVisible());
  syncLineMasterVisibilityUI();
  const effectLayer = getActiveEffectLayer();
  const master = state.masterLayerEdit === true;
  const lampsEnabled = master
    ? everyLayerMatches((l) => getLayerLampsEnabled(l))
    : getLayerLampsEnabled(effectLayer);
  document.getElementById('btnSidebarLamps')?.classList.toggle('feature-enabled', lampsEnabled);
  const graffitiEnabled = master
    ? everyLayerMatches((l) => l.lineProfileApplication === 'graffiti')
    : layer?.lineProfileApplication === 'graffiti';
  lineBtn?.classList.toggle('graffiti-enabled', graffitiEnabled);
  const desiredWebState = (l) =>
    webRuntime.desiredVisibilityByLayer.has(l.id)
      ? webRuntime.desiredVisibilityByLayer.get(l.id) === true
      : l.showWeb === true;
  const webEnabled = master
    ? everyLayerMatches(desiredWebState)
    : effectLayer
      ? desiredWebState(effectLayer)
      : false;
  document.getElementById('btnSidebarWeb')?.classList.toggle('feature-enabled', webEnabled);
  const glintEnabled = master
    ? everyLayerMatches((l) => getLayerGlintEnabled(l))
    : getLayerGlintEnabled(effectLayer);
  const lightningEnabled = master
    ? everyLayerMatches((l) => getLayerLightningEnabled(l))
    : getLayerLightningEnabled(effectLayer);
  document.getElementById('btnSidebarSweep')?.classList.toggle('feature-enabled', glintEnabled);
  document.getElementById('btnSidebarLightning')?.classList.toggle('feature-enabled', lightningEnabled);
  const particlesEnabled = master
    ? everyLayerMatches((l) => normalizeParticleConfig(l?.particles).enabled === true)
    : normalizeParticleConfig(effectLayer?.particles).enabled === true;
  document.getElementById('btnSidebarParticles')?.classList.toggle('feature-enabled', particlesEnabled);
  document.getElementById('btnSidebarFourier')?.classList.toggle('fourier-on', state.fourierMode === true);
  syncMotionUI();
  const fourierToggle = document.getElementById('fourierModeToggle');
  if (fourierToggle) fourierToggle.checked = state.fourierMode === true;
  syncFourierStrengthUI();
}
function normalizeLineProfileValue(value, fallback = 'round') {
  return ['round', 'slash', 'square', 'circle', 'cross'].includes(value) ? value : fallback;
}
function normalizeLineMarkerType(value, fallback = 'slash') {
  return ['circle', 'square', 'cross', 'slash'].includes(value) ? value : fallback;
}
function getLayerMainLineMode(layer) {
  if (!layer) return 'point';
  if (layer.lineProfileApplication === 'graffiti') return 'graffiti';
  if (layer?.sprite?.enabled === true) return 'sprite';
  const p = normalizeLineProfileValue(layer.lineProfileStroke ?? layer.lineProfile, 'round');
  return p === 'round' ? 'point' : 'dash';
}
function setLayerMainLineMode(layer, mode) {
  if (!layer) return;
  ensureLayerEffectState(layer);
  mode = ['point', 'dash', 'sprite', 'graffiti'].includes(mode) ? mode : 'point';
  if (mode === 'graffiti') {
    layer.sprite.enabled = false;
    setLayerGraffitiMode(layer, true);
    layer.lineProfileGraffiti = 'slash';
    markLayerEffectChanged(layer, 'graffiti-main-mode');
    return;
  }
  setLayerGraffitiMode(layer, false);
  if (mode === 'sprite') {
    layer.sprite = normalizeLineSpriteConfig(layer.sprite);
    layer.sprite.enabled = true;
    layer.lineProfileApplication = 'stroke';
    layer.lineProfile = 'round';
    layer.lineProfileStroke = 'round';
    frameGraphPerformanceRuntime.penaltyUntilFrame = 0;
    markLayerEffectChanged(layer, 'sprite-main-mode');
    return;
  }
  layer.sprite.enabled = false;
  if (mode === 'dash') {
    layer.lineMarkerType = normalizeLineMarkerType(layer.lineMarkerType || layer.lineProfileStroke, 'slash');
    layer.lineProfile = layer.lineMarkerType;
    layer.lineProfileStroke = layer.lineMarkerType;
  } else {
    if (layer.lineProfileStroke !== 'round')
      layer.lineMarkerType = normalizeLineMarkerType(
        layer.lineProfileStroke,
        layer.lineMarkerType || 'slash',
      );
    layer.lineProfile = 'round';
    layer.lineProfileStroke = 'round';
  }
  markLayerEffectChanged(layer, 'line-main-mode');
}
function rememberCurrentLineProfile(layer) {
  if (!layer) return;
  const active = normalizeLineProfileValue(layer.lineProfileStroke ?? layer.lineProfile, 'round');
  layer.lineProfileStroke = active;
  layer.lineProfile = active;
}
function setLayerGraffitiMode(layer, enabled) {
  if (!layer) return;
  const on = enabled === true;
  const current = layer.lineProfileApplication === 'graffiti';
  rememberCurrentLineProfile(layer);
  if (on && !current) {
    if (!['round', 'slash', 'square'].includes(layer.lineProfileGraffiti))
      layer.lineProfileGraffiti = 'slash';
    layer.lineProfileApplication = 'graffiti';
    if (!Number.isFinite(Number(layer.graffitiAngle))) layer.graffitiAngle = 45;
    if (!['absolute', 'relative'].includes(layer.graffitiAngleMode)) layer.graffitiAngleMode = 'absolute';
    if (!Number.isFinite(Number(layer.graffitiNibLength))) layer.graffitiNibLength = 3;
    // An untouched default Line (2 px) starts Graffiti at 8 px.
    // Keep any user-authored width, and only remember the original
    // Line width when we actually apply this automatic default.
    const priorWidth = Number(layer.strokeWidth);
    if (Number.isFinite(priorWidth) && Math.abs(priorWidth - SOMATA_DEFAULT_LINE_STROKE_WIDTH) < 1e-6) {
      layer.graffitiBaseStrokeWidth = priorWidth;
      layer.strokeWidth = SOMATA_DEFAULT_GRAFFITI_STROKE_WIDTH;
    } else layer.graffitiBaseStrokeWidth = null;
  } else if (!on && current) {
    // Restore the Line default only if Graffiti still has its
    // untouched automatic width. A user-edited width is preserved.
    const base = layer.graffitiBaseStrokeWidth == null ? NaN : Number(layer.graffitiBaseStrokeWidth);
    const width = Number(layer.strokeWidth);
    if (
      Number.isFinite(base) &&
      Number.isFinite(width) &&
      Math.abs(base - SOMATA_DEFAULT_LINE_STROKE_WIDTH) < 1e-6 &&
      Math.abs(width - SOMATA_DEFAULT_GRAFFITI_STROKE_WIDTH) < 0.05
    ) {
      layer.strokeWidth = base;
    } else if (Number.isFinite(base) && Number.isFinite(width) && Math.abs(width - base * 3) < 0.05) {
      // Preserve restoration of legacy 3x graffiti defaults.
      layer.strokeWidth = Math.max(0.5, Math.min(20, base));
    }
    layer.graffitiBaseStrokeWidth = null;
    layer.lineProfileApplication = 'stroke';
  } else layer.lineProfileApplication = on ? 'graffiti' : 'stroke';
  layer.lineProfile = normalizeLineProfileValue(layer.lineProfileStroke ?? layer.lineProfile, 'round');
  layer.lineProfileStroke = layer.lineProfile;
  if (!['absolute', 'relative'].includes(layer.graffitiAngleMode)) layer.graffitiAngleMode = 'absolute';
  if (!['pointed', 'blunt', 'pinched', 'round'].includes(layer.graffitiNibShape))
    layer.graffitiNibShape = 'pointed';
  if (!Number.isFinite(Number(layer.graffitiNibLength))) layer.graffitiNibLength = 3;
  if (!Number.isFinite(Number(layer.graffitiNibLengthMultiplier))) layer.graffitiNibLengthMultiplier = 1;
  if (!['perSegment', 'everyNth', 'across', 'perPath', 'whole'].includes(layer.graffitiVariationMode))
    layer.graffitiVariationMode = 'perSegment';
  if (!Number.isFinite(Number(layer.graffitiVariationEveryN))) layer.graffitiVariationEveryN = 2;
  if (typeof layer.graffitiSizeVariationEnabled !== 'boolean') layer.graffitiSizeVariationEnabled = true;
  if (!Number.isFinite(Number(layer.graffitiSizeVariation))) layer.graffitiSizeVariation = 30;
  if (!Number.isFinite(Number(layer.graffitiSizeFocus))) layer.graffitiSizeFocus = 75;
  if (typeof layer.graffitiRotationVariationEnabled !== 'boolean')
    layer.graffitiRotationVariationEnabled = false;
  if (!Number.isFinite(Number(layer.graffitiRotationVariation))) layer.graffitiRotationVariation = 0;
  if (!Number.isFinite(Number(layer.graffitiRotationMultiplier))) layer.graffitiRotationMultiplier = 1;
  if (!Number.isFinite(Number(layer.graffitiRotationFocus))) layer.graffitiRotationFocus = 50;
  if (typeof markLayerEffectChanged === 'function') markLayerEffectChanged(layer, 'graffiti-mode');
  else invalidateLayerEffect(layer, 'graffiti-mode');
  syncSidebarInputs();
  syncSidebarToolStates();
  requestMainCanvasRender();
}
function syncFourierStrengthUI() {
  state.fourierStrength = Math.max(0, Math.min(100, Number(state.fourierStrength ?? 50)));
  const r = document.getElementById('fourierStrength');
  if (r && document.activeElement !== r) r.value = String(state.fourierStrength);
  const t = document.getElementById('fourierStrengthText');
  if (t) t.textContent = `${Math.round(state.fourierStrength)}%`;
}
function setFourierMode(enabled, syncControl = true) {
  const layer = state.layers.find((l) => l.id === state.activeLayerId) || state.layers[0];
  if (layer) {
    state.fourierMode = enabled === true;
    invalidateLayerGeometry(layer, 'fourier-mode');
  }
  if (syncControl) {
    const cb = document.getElementById('fourierModeToggle');
    if (cb) cb.checked = state.fourierMode;
  }
  document.getElementById('btnSidebarFourier')?.classList.toggle('fourier-on', state.fourierMode);
  const cornerValue = layer?.roundingCornerType || 'classic';
  const cornerSelect = document.getElementById('paramRoundingCornerType');
  if (cornerSelect) cornerSelect.value = cornerValue;
  document.querySelectorAll('.rounding-corner-type-btn').forEach((btn) => {
    const active = btn.dataset.roundingCornerType === cornerValue;
    btn.classList.toggle('active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  document.getElementById('roundingFourierControls')?.classList.toggle('hidden', !state.fourierMode);
  syncFourierStrengthUI();
  requestMainCanvasRender();
}
function setSidebarMode(mode) {
  state.sidebarMode = [
    'shape',
    'lines',
    'lamps',
    'web',
    'sweep',
    'lightning',
    'particles',
    'motion',
    'palette',
    'fourier',
    'ambient',
    'prism',
  ].includes(mode)
    ? mode
    : 'shape';
  const aside = document.getElementById('settingsSidebar');
  [
    'shape',
    'lines',
    'lamps',
    'web',
    'sweep',
    'lightning',
    'particles',
    'motion',
    'palette',
    'fourier',
    'ambient',
    'prism',
  ].forEach((name) => aside?.classList.toggle(`sidebar-mode-${name}`, state.sidebarMode === name));
  document.querySelectorAll('[data-sidebar-mode]').forEach((btn) => {
    const on = btn.dataset.sidebarMode === state.sidebarMode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  if (state.sidebarMode === 'palette' && typeof renderPlaylistPaletteStudio === 'function')
    renderPlaylistPaletteStudio();
  syncSidebarToolStates();
}
function syncWebOutlineUI() {
  const effectLayer = getActiveEffectLayer();
  const web = getLayerWebConfig(effectLayer);
  const outline =
    state.lineOutline ||
    (state.lineOutline = {
      enabled: false,
      color: '#ffffff',
      width: 1.5,
      mode: 'outer',
      style: 'classic',
      auraSpeed: 100,
      widthMultiplier: 1,
      auraSpeedMultiplier: 1,
      auraSpan: 100,
      auraSpanMultiplier: 1,
    });
  outline.mode = ['outer', 'inner', 'median'].includes(outline.mode) ? outline.mode : 'outer';
  const pendingWebSwitch = effectLayer ? webRuntime.pendingByLayer.get(effectLayer.id) || {} : {};
  const desiredVisibility = effectLayer ? webRuntime.desiredVisibilityByLayer.get(effectLayer.id) : undefined;
  const showWeb = document.getElementById('showWeb');
  if (showWeb)
    showWeb.checked =
      state.masterLayerEdit === true
        ? getEffectTargets().every((l) =>
            webRuntime.desiredVisibilityByLayer.has(l.id)
              ? webRuntime.desiredVisibilityByLayer.get(l.id) === true
              : l.showWeb === true,
          )
        : desiredVisibility === undefined
          ? getLayerWebEnabled(effectLayer)
          : desiredVisibility === true;
  const type = document.getElementById('webType'),
    styleSel = document.getElementById('webStyle'),
    inside = document.getElementById('webInside'),
    outsideStraight = document.getElementById('webOutsideStraight'),
    outsideArc = document.getElementById('webOutsideArc'),
    placement = document.getElementById('webPlacementMode'),
    osc = document.getElementById('webOscillating'),
    os = document.getElementById('webOscillationStrength'),
    osmult = document.getElementById('webOscillationStrengthMultiplier'),
    omult = document.getElementById('webOscillationMultiplier'),
    a = document.getElementById('webAngleThreshold'),
    w = document.getElementById('webWidth'),
    wr = document.getElementById('webWidthRelative'),
    wp = document.getElementById('webWidthPercent'),
    wc = document.getElementById('webColor'),
    wmc = document.getElementById('webMatchLineColor'),
    wsc = document.getElementById('webSecondaryColor'),
    wsd = document.getElementById('webSunDegrees'),
    d = document.getElementById('webDistance'),
    dm = document.getElementById('webDepthMultiplier'),
    sp = document.getElementById('webSpacing'),
    av = document.getElementById('webAngleVariation');
  if (type) type.value = (pendingWebSwitch.type || web.type) === 'rounding' ? 'rounding' : 'bevel';
  const branches = getWebBranchFlags(web),
    placementValue = ['corners', 'selfIntersection', 'selfIntersectionCorridor'].includes(web.placementMode)
      ? web.placementMode
      : 'corners';
  if (styleSel) styleSel.value = ['web', 'laser', 'spiderSun'].includes(web.style) ? web.style : 'web';
  if (inside) inside.checked = branches.inside;
  if (outsideStraight) outsideStraight.checked = branches.outsideStraight;
  if (outsideArc) outsideArc.checked = branches.outsideArc;
  // Spiral Web has no inner/outer split. Keep all three authored polygon
  // toggles editable and persisted, but visually mark them as non-operative.
  const spiralBranches = isSpiralLayer(effectLayer);
  for (const el of [inside, outsideStraight, outsideArc]) {
    const label = el?.closest?.('label');
    if (label) {
      label.classList.toggle('spiral-web-choice-muted', spiralBranches);
      label.title = spiralBranches ? 'На спирали ветви едины. Выбор сохраняется для многоугольника.' : '';
    }
  }
  if (placement) placement.value = placementValue;
  if (osc) osc.checked = web.oscillating === true;
  if (os)
    os.value = Math.max(
      0,
      Math.min(100, Number.isFinite(Number(web.oscillationStrength)) ? Number(web.oscillationStrength) : 10),
    );
  if (osmult)
    osmult.value = String(Math.max(0.015625, Math.min(64, Number(web.oscillationStrengthMultiplier) || 1)));
  if (omult) omult.value = String(Math.max(0.015625, Math.min(64, Number(web.oscillationMultiplier) || 1)));
  if (a) a.value = web.angleThreshold;
  if (w) w.value = web.width;
  if (wr) wr.checked = web.widthRelative === true;
  if (wp) {
    wp.value = web.widthPercent ?? 40;
    wp.disabled = web.widthRelative !== true;
  }
  if (wmc) wmc.checked = web.matchLineColor === true;
  if (wc) {
    wc.value = web.color || '#ffffff';
    wc.disabled = web.matchLineColor === true;
  }
  if (wsc) wsc.value = web.secondaryColor || '#00ffff';
  if (wsd) wsd.value = Math.max(5, Math.min(90, Number(web.sunDegrees) || 20));
  if (d)
    d.value = Math.max(0, Math.min(100, Number.isFinite(Number(web.distance)) ? Number(web.distance) : 60));
  if (dm) dm.value = Math.max(0, Number(web.depthMultiplier) || 0);
  if (sp) sp.value = web.spacing;
  if (av) av.value = web.angleVariation;
  const at = document.getElementById('webAngleText'),
    wt = document.getElementById('webWidthText'),
    dt = document.getElementById('webDistanceText'),
    dmt = document.getElementById('webDepthMultiplierText'),
    st = document.getElementById('webSpacingText'),
    vt = document.getElementById('webVariationText'),
    ost = document.getElementById('webOscillationStrengthText'),
    osmt = document.getElementById('webOscillationStrengthMultiplierText'),
    omt = document.getElementById('webOscillationMultiplierText'),
    wsdt = document.getElementById('webSunDegreesText');
  if (at) at.textContent = `${Math.round(Number(web.angleThreshold) || 60)}°`;
  if (wt)
    wt.textContent =
      web.widthRelative === true
        ? `${Math.round(Number(web.widthPercent) || 40)}% линии`
        : `${(Number(web.width) || 0.6).toFixed(1)} px`;
  if (dt)
    dt.textContent = `${Math.round(Math.max(0, Math.min(100, Number.isFinite(Number(web.distance)) ? Number(web.distance) : 60)))}%`;
  if (dmt) dmt.textContent = `×${Math.max(0, Number(web.depthMultiplier) || 0).toFixed(2)}`;
  if (st) st.textContent = `${Math.round(Number(web.spacing) || 10)} px`;
  if (vt) vt.textContent = `${Math.round(Number(web.angleVariation) || 0)}°`;
  if (ost)
    ost.textContent = `${Math.round(Math.max(0, Math.min(100, Number.isFinite(Number(web.oscillationStrength)) ? Number(web.oscillationStrength) : 10)))}%`;
  if (osmt) {
    const m = Math.max(0.015625, Math.min(64, Number(web.oscillationStrengthMultiplier) || 1));
    osmt.textContent = `×${m
      .toFixed(m < 1 ? 3 : m % 1 ? 2 : 0)
      .replace(/0+$/, '')
      .replace(/\.$/, '')}`;
  }
  if (wsdt) wsdt.textContent = `${Math.round(Math.max(5, Math.min(90, Number(web.sunDegrees) || 20)))}°`;
  document.getElementById('webSecondaryColorRow')?.classList.toggle('hidden', web.style !== 'laser');
  document.getElementById('webSunDegreesRow')?.classList.toggle('hidden', web.style !== 'spiderSun');
  if (omt) {
    const m = Math.max(0.015625, Math.min(64, Number(web.oscillationMultiplier) || 1));
    omt.textContent = `×${m
      .toFixed(m < 1 ? 3 : m % 1 ? 2 : 0)
      .replace(/0+$/, '')
      .replace(/\.$/, '')}`;
  }
  const osr = document.getElementById('webOscillationStrengthRow'),
    osmr = document.getElementById('webOscillationStrengthMultiplierRow'),
    omr = document.getElementById('webOscillationMultiplierRow');
  if (osr) osr.classList.toggle('disabled', web.oscillating !== true);
  if (osmr) osmr.classList.toggle('disabled', web.oscillating !== true);
  if (omr) omr.classList.toggle('disabled', web.oscillating !== true);
  const badge = document.getElementById('webModeBadge');
  if (badge) {
    const names = [];
    if (spiralBranches) names.push('единая');
    else if (branches.inside) names.push('внутренняя');
    if (!spiralBranches && branches.outsideStraight) names.push('внешняя прямая');
    if (!spiralBranches && branches.outsideArc) names.push('внешняя дуговая');
    const rr = names.length ? names.join(' + ') : 'ветви выключены',
      pp =
        {
          corners: 'углы',
          selfIntersection: 'самопересечения',
          selfIntersectionCorridor: 'самопересечения + коридор',
        }[placementValue] || 'углы';
    badge.textContent = `${rr} · ${pp}`;
  }
  const oe = document.getElementById('paramLineOutlineEnabled'),
    oc = document.getElementById('paramLineOutlineColor'),
    or = document.getElementById('paramLineOutlineWidth'),
    on = document.getElementById('numLineOutlineWidth'),
    ot = document.getElementById('lineOutlineWidthText');
  const countMax = Math.max(1, (state.layers || []).length),
    count = Math.max(
      0,
      Math.min(
        countMax,
        outline.layerCount != null && Number.isFinite(Number(outline.layerCount))
          ? Math.round(Number(outline.layerCount))
          : countMax,
      ),
    );
  const countInput = document.getElementById('paramLineOutlineLayerCount'),
    countText = document.getElementById('lineOutlineLayerCountText');
  if (countInput) {
    countInput.max = String(countMax);
    countInput.value = String(count);
  }
  if (countText) countText.textContent = count === countMax ? `Все · ${countMax}` : `${count} из ${countMax}`;
  const aura = ['saiyan', 'drip', 'mountain'].includes(outline.style),
    styleSelect = document.getElementById('paramLineOutlineStyle'),
    speedRow = document.getElementById('lineOutlineAuraSpeedRow'),
    speedInput = document.getElementById('paramLineOutlineAuraSpeed'),
    speedText = document.getElementById('lineOutlineAuraSpeedText');
  if (styleSelect) styleSelect.value = aura ? outline.style : 'classic';
  if (speedRow) speedRow.hidden = !aura;
  const spanRow = document.getElementById('lineOutlineAuraSpanRow');
  if (spanRow) spanRow.hidden = !aura;
  const setMult = (id, key, min, max) => {
    const e = document.getElementById(id);
    if (e)
      e.value = String(
        Math.max(min, Math.min(max, Number.isFinite(Number(outline[key])) ? Number(outline[key]) : 1)),
      );
  };
  setMult('paramLineOutlineWidthMultiplier', 'widthMultiplier', 0.015625, 64);
  setMult('paramLineOutlineAuraSpeedMultiplier', 'auraSpeedMultiplier', 0, 64);
  setMult('paramLineOutlineAuraSpanMultiplier', 'auraSpanMultiplier', 0.015625, 64);
  const spanInput = document.getElementById('paramLineOutlineAuraSpan');
  if (spanInput)
    spanInput.value = String(
      Math.max(0, Math.min(200, Number.isFinite(Number(outline.auraSpan)) ? Number(outline.auraSpan) : 100)),
    );
  const multFmt = (n) =>
    `×${Number(n)
      .toFixed(n < 1 ? 3 : 2)
      .replace(/0+$/, '')
      .replace(/\.$/, '')}`;
  const multText = document.getElementById('lineOutlineWidthMultiplierText');
  if (multText) multText.textContent = multFmt(Number(outline.widthMultiplier ?? 1));
  const spanText = document.getElementById('lineOutlineAuraSpanText');
  if (spanText)
    spanText.textContent = `${spanInput?.value || 100}% ${multFmt(Number(outline.auraSpanMultiplier ?? 1))}`;
  const placementModes = document.querySelector('.line-outline-modes');
  if (placementModes) placementModes.hidden = aura;
  const widthLabel = document.getElementById('lineOutlineWidthLabel');
  if (widthLabel) widthLabel.textContent = aura ? 'Толщина энергетической оболочки' : 'Толщина обводки';
  const maxWidth = aura ? 30 : 12;
  if (or) or.max = String(maxWidth);
  if (on) on.max = String(maxWidth);
  if (speedInput)
    speedInput.value = String(
      Math.max(
        0,
        Math.min(200, Number.isFinite(Number(outline.auraSpeed)) ? Number(outline.auraSpeed) : 100),
      ),
    );
  if (speedText)
    speedText.textContent = `${speedInput?.value ?? 100}% ${multFmt(Number(outline.auraSpeedMultiplier ?? 1))}`;
  if (oe) oe.checked = outline.enabled === true;
  if (oc) oc.value = outline.color || '#ffffff';
  if (or) or.value = outline.width;
  if (on) on.value = outline.width;
  if (ot)
    ot.textContent = `${Number(outline.width || 1.5).toFixed(1)} px ${multFmt(Number(outline.widthMultiplier ?? 1))}`;
  const om = {
    outer: 'paramLineOutlineOuter',
    inner: 'paramLineOutlineInner',
    median: 'paramLineOutlineMedian',
  };
  for (const [mode, id] of Object.entries(om)) {
    const el = document.getElementById(id);
    if (el) el.checked = outline.mode === mode;
  }
}
function syncLampSettingsUI() {
  const c = getActiveLampConfig() || state.lamps;
  {
    const base = Math.max(1, Number.isFinite(Number(c.radius)) ? Number(c.radius) : 50),
      mult = Math.max(0, Number.isFinite(Number(c.radiusMultiplier)) ? Number(c.radiusMultiplier) : 1);
    if (base > 50) {
      const effective = base * mult;
      if (effective <= 0) {
        c.radius = 50;
        c.radiusMultiplier = 0;
      } else {
        const nextMult = Math.max(1, Math.ceil(effective / 50));
        c.radius = effective / nextMult;
        c.radiusMultiplier = nextMult;
      }
    } else {
      c.radius = base;
      c.radiusMultiplier = mult;
    }
  }
  const mode = c.colorMode || (c.rainbow ? 'rainbow' : c.matchLineColor ? 'line' : 'selected');
  c.colorMode = mode;
  c.matchLineColor = mode === 'line';
  c.rainbow = mode === 'rainbow';
  const vals = {
    lampColor: c.color,
    lampFreezeLight: c.freezeLight === true,
    lampFreezeTailSec: c.freezeTailSec ?? 1.5,
    lampFreezeIntensity: c.freezeIntensity ?? 100,
    lampFreezeHardness: c.freezeHardness ?? 50,
    lampFreezeColorMode: ['lamp', 'line', 'fixed', 'hue'].includes(c.freezeColorMode)
      ? c.freezeColorMode
      : 'lamp',
    lampFreezeColor: c.freezeColor || '#00ffcc',
    lampFreezeHueDegrees: c.freezeHueDegrees ?? 45,
    lampFreezeHueDegreesNumber: c.freezeHueDegrees ?? 45,
    lampFreezeChromatic: c.freezeChromatic === true,
    lampFreezeChromaticColor: c.freezeChromaticColor || '#22d3ee',
    lampFreezeRain: c.freezeRain === true,
    lampFreezeRainDegrees: c.freezeRainDegrees ?? 180,
    lampFreezeRainDegreesNumber: c.freezeRainDegrees ?? 180,
    lampFreezeRainSource: c.freezeRainSource === 'lamp' ? 'lamp' : 'core',
    lampFreezeRainSpeed: c.freezeRainSpeed ?? 50,
    lampFreezeRainTailSec: c.freezeRainTailSec ?? 1.5,
    lampFreezeRainHardness: c.freezeRainHardness ?? 50,
    lampBrightness: c.brightness,
    lampRadius: c.radius,
    lampRadiusMultiplier: c.radiusMultiplier ?? 1,
    lampSoftness: c.softness,
    lampSoftnessMultiplier: c.softnessMultiplier ?? 1,
    lampBlendMode: c.blendMode,
    lampType: c.type,
    lampDensity: c.density ?? 100,
    lampDensityMultiplier: c.densityMultiplier ?? 1,
    lampScatter: c.scatter ?? 0,
    lampScatterMultiplier: c.scatterMultiplier ?? 1,
    lampSizeVariation: c.sizeVariation ?? 0,
    lampSizeVariationMultiplier: c.sizeVariationMultiplier ?? 1,
    lampBrightnessVariation: c.brightnessVariation ?? 0,
    lampBrightnessVariationMultiplier: c.brightnessVariationMultiplier ?? 1,
    lampAdaptiveBrightness: c.adaptiveBrightness !== false,
    lampAdaptiveAdjustBrightness: c.adaptiveAdjustBrightness === true,
    lampAdaptiveStrength: c.adaptiveStrength ?? 100,
    lampAdaptiveStrengthMultiplier: c.adaptiveStrengthMultiplier ?? 1,
    lampAdaptiveExponent: snapLampAdaptiveExponent(c.adaptiveExponent),
    lampAdaptiveAutoExponent: c.adaptiveAutoExponent === true,
    lampAdaptiveFadeSec: c.adaptiveFadeSec ?? 1,
    lampMorphEnabled: c.morphEnabled === true,
    lampMorphSize: c.morphSize ?? 20,
    lampMorphBrightness: c.morphBrightness ?? 25,
    lampMorphInertia: c.morphInertia ?? 0,
    lampCornerInertiaLinked: c.cornerInertiaLinked !== false,
    lampSnapToContour: withLampConfig(c, () => isLampContourAttachmentEnabled()),
  };
  for (const [id, v] of Object.entries(vals)) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = v;
  }
  const showLines = document.getElementById('showLines');
  if (showLines) showLines.checked = linesAreEffectivelyVisible();
  const showLamps = document.getElementById('showLamps');
  if (showLamps)
    showLamps.checked =
      state.masterLayerEdit === true
        ? everyLayerMatches((l) => getLayerLampsEnabled(l))
        : getLayerLampsEnabled(getActiveEffectLayer());
  const positionMode = ['key', 'corners', 'arbitrary'].includes(c.positionMode) ? c.positionMode : 'key';
  document.querySelectorAll('[data-lamp-position]').forEach((btn) => {
    const on = btn.dataset.lampPosition === positionMode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  const motionMode =
    c.morphMotionMode === 'current'
      ? 'dynamic'
      : ['linear', 'ghost', 'dynamic', 'smooth'].includes(c.morphMotionMode)
        ? c.morphMotionMode
        : 'linear';
  document.querySelectorAll('[data-lamp-motion]').forEach((btn) => {
    const on = btn.dataset.lampMotion === motionMode;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  document
    .querySelectorAll('[data-lamp-color-mode]')
    .forEach((btn) => btn.classList.toggle('active', btn.dataset.lampColorMode === mode));
  const set = (id, t) => {
    const e = document.getElementById(id);
    if (e) e.textContent = t;
  };
  const fmt = (n) => Number(n).toFixed(Math.abs(Number(n) % 1) > 0.001 ? 1 : 0);
  set('lampFreezeTailText', `${formatTimeSeconds(Math.max(0.05, Number(c.freezeTailSec ?? 1.5)))} с`);
  set(
    'lampFreezeIntensityText',
    `${Math.round(Math.max(0, Math.min(100, Number(c.freezeIntensity ?? 100))))}%`,
  );
  set('lampFreezeHardnessText', `${Math.round(Math.max(0, Math.min(100, Number(c.freezeHardness ?? 50))))}%`);
  set('lampFreezeHueText', `0→${Math.round(Math.max(0, Math.min(180, Number(c.freezeHueDegrees ?? 45))))}°`);
  set(
    'lampFreezeRainDegreesText',
    `${Math.round(((Number(c.freezeRainDegrees ?? 180) % 360) + 360) % 360)}°`,
  );
  set(
    'lampFreezeRainSpeedText',
    `${Math.round(Math.max(0, Math.min(100, Number(c.freezeRainSpeed ?? 50))))}%`,
  );
  set('lampFreezeRainTailText', `${formatTimeSeconds(Math.max(0.05, Number(c.freezeRainTailSec ?? 1.5)))} с`);
  set(
    'lampFreezeRainHardnessText',
    `${Math.round(Math.max(0, Math.min(100, Number(c.freezeRainHardness ?? 50))))}%`,
  );
  const freezeOn = c.freezeLight === true,
    freezeMode = ['lamp', 'line', 'fixed', 'hue'].includes(c.freezeColorMode) ? c.freezeColorMode : 'lamp';
  document.getElementById('lampFreezeDetails')?.classList.toggle('hidden', !freezeOn);
  for (const id of [
    'lampFreezeTailSec',
    'lampFreezeIntensity',
    'lampFreezeHardness',
    'lampFreezeColorMode',
    'lampFreezeColor',
    'lampFreezeHueDegrees',
    'lampFreezeHueDegreesNumber',
    'lampFreezeChromatic',
    'lampFreezeChromaticColor',
  ]) {
    const el = document.getElementById(id);
    if (el) el.disabled = !freezeOn;
  }
  document
    .getElementById('lampFreezeColorRow')
    ?.classList.toggle('hidden', !freezeOn || freezeMode !== 'fixed');
  document.getElementById('lampFreezeHueRow')?.classList.toggle('hidden', !freezeOn || freezeMode !== 'hue');
  document
    .getElementById('lampFreezeChromaticColorRow')
    ?.classList.toggle('hidden', !freezeOn || c.freezeChromatic !== true);
  const rainOn = c.freezeRain === true;
  document.getElementById('lampFreezeRainDetails')?.classList.toggle('hidden', !rainOn);
  for (const id of [
    'lampFreezeRainDegrees',
    'lampFreezeRainDegreesNumber',
    'lampFreezeRainSource',
    'lampFreezeRainSpeed',
    'lampFreezeRainTailSec',
    'lampFreezeRainHardness',
  ]) {
    const el = document.getElementById(id);
    if (el) el.disabled = !rainOn;
  }
  set('lampBrightnessText', `${Math.round(c.brightness)}%`);
  set('lampRadiusText', `${fmt(c.radius)} px × ${fmt(c.radiusMultiplier ?? 1)}`);
  set('lampSoftnessText', `${Math.round(c.softness)}% × ${fmt(c.softnessMultiplier ?? 1)}`);
  set('lampDensityText', `${Math.round(Number(c.density ?? 100))}% × ${fmt(c.densityMultiplier ?? 1)}`);
  set('lampScatterText', `${Math.round(Number(c.scatter) || 0)}% × ${fmt(c.scatterMultiplier ?? 1)}`);
  set(
    'lampSizeVariationText',
    `${Math.round(Number(c.sizeVariation ?? 0))}% × ${fmt(c.sizeVariationMultiplier ?? 1)}`,
  );
  set(
    'lampBrightnessVariationText',
    `${Math.round(Number(c.brightnessVariation ?? 0))}% × ${fmt(c.brightnessVariationMultiplier ?? 1)}`,
  );
  set(
    'lampAdaptiveStrengthText',
    `${Math.round(Number(c.adaptiveStrength ?? 100))}% × ${fmt(c.adaptiveStrengthMultiplier ?? 1)}`,
  );
  set('lampAdaptiveFadeText', `${formatTimeSeconds(Math.max(0, Number(c.adaptiveFadeSec ?? 1)))} с`);
  {
    const exponent = snapLampAdaptiveExponent(c.adaptiveExponent);
    set('lampAdaptiveExponentText', `${exponent > 0 ? '+' : ''}${exponent}%`);
    const lightChannel = c.adaptiveAdjustBrightness === true;
    document.querySelectorAll('[data-lamp-adaptive-channel]').forEach((btn) => {
      const on = (btn.dataset.lampAdaptiveChannel === 'light') === lightChannel;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    set('lampAdaptiveStrengthLabel', lightChannel ? 'Сила адаптивного света' : 'Сила адаптивного размера');
  }
  set('lampMorphSizeText', `${Math.round(Number(c.morphSize ?? 20))}%`);
  set('lampMorphBrightnessText', `${Math.round(Number(c.morphBrightness ?? 25))}%`);
  set('lampMorphInertiaText', `${Math.round(Number(c.morphInertia ?? 0))}%`);
  document.getElementById('lampMorphInertiaRow')?.classList.remove('hidden');
  document.getElementById('lampMorphSettings')?.classList.toggle('hidden', c.morphEnabled !== true);
  document.getElementById('lampDensityRow')?.classList.toggle('hidden', positionMode !== 'arbitrary');
  const cornerRow = document.getElementById('lampCornerInertiaRow');
  cornerRow?.classList.add('hidden');
  document.getElementById('lampBendAnimationNote')?.classList.toggle('hidden', positionMode !== 'corners');
  const cornerSlider = document.getElementById('lampCornerInertia');
  const cornerLinked = c.cornerInertiaLinked !== false;
  if (cornerSlider) {
    cornerSlider.min = '0';
    cornerSlider.max = cornerLinked ? '100' : '15';
    cornerSlider.step = cornerLinked ? '1' : '0.1';
    cornerSlider.value = String(
      cornerLinked
        ? Math.max(0, Math.min(100, Number(c.cornerInertiaPercent ?? 10)))
        : Math.max(0, Math.min(15, Number(c.cornerInertiaSec ?? 0.5))),
    );
  }
  const cornerSec = lampCornerInertiaMs(c) / 1000;
  set(
    'lampCornerInertiaText',
    cornerLinked
      ? `${Math.round(Number(c.cornerInertiaPercent ?? 10))}% · ${formatTimeSeconds(cornerSec)} с`
      : `${formatTimeSeconds(cornerSec)} с`,
  );
  const selected = mode === 'selected';
  const color = document.getElementById('lampColor');
  if (color) color.disabled = !selected;
  const palette = document.getElementById('lampColorPresets');
  if (palette) palette.style.opacity = selected ? '1' : '.42';
}
function syncSweepUI() {
  const effectLayer = getActiveEffectLayer(),
    c = getLayerSweepConfig(effectLayer);
  normalizeSweepConfig(c);
  delete c.blurEnabled;
  delete c.blur;
  const allowed = ['perSegment', 'everyNth', 'across', 'perPath', 'whole'];
  if (c.mode === 'lightning') {
    c.effectType = 'lightning';
    c.mode = 'whole';
  }
  if (!allowed.includes(c.mode)) c.mode = 'whole';
  c.effectType = c.effectType === 'lightning' ? 'lightning' : 'glint';
  c.flashMode = normalizeSweepFlashMode(c.flashMode);
  c.flashType = normalizeGlintPrecisionValue(c.flashType ?? c.glintPrecision);
  if (c.flashType === 'spectral') c.flashType = 'high';
  c.glintPrecision = c.flashType;
  const lightningMode = c.lightningEnabled === true,
    spectral = c.flashMode === 'spectral';
  const e = document.getElementById('showSweep');
  if (e)
    e.checked =
      state.masterLayerEdit === true
        ? everyLayerMatches((l) => getLayerGlintEnabled(l))
        : c.glintEnabled === true;
  const le = document.getElementById('showLightning');
  if (le)
    le.checked =
      state.masterLayerEdit === true
        ? everyLayerMatches((l) => getLayerLightningEnabled(l))
        : c.lightningEnabled === true;
  const et = document.getElementById('sweepEffectType');
  if (et) et.value = c.effectType;
  const trigger = document.getElementById('sweepLightningTriggerMode');
  if (trigger) trigger.value = c.lightningTriggerMode || 'morph';
  c.coreBlendMode = normalizeSweepBlendMode(c.coreBlendMode);
  c.glowBlendMode = normalizeSweepBlendMode(c.glowBlendMode);
  const cbm = document.getElementById('sweepCoreBlendMode');
  if (cbm) cbm.value = c.coreBlendMode;
  const gbm = document.getElementById('sweepGlowBlendMode');
  if (gbm) gbm.value = c.glowBlendMode;
  const lightningBlend = document.getElementById('sweepLightningBlendMode');
  if (lightningBlend) lightningBlend.value = normalizeLightningLampBlendMode(c.lightningBlendMode);
  document.getElementById('sweepGlintSettings')?.classList.remove('hidden');
  document.getElementById('sweepLightningSettings')?.classList.remove('hidden');
  const title = document.getElementById('sweepGlintSectionTitle');
  if (title) title.textContent = 'Проблеск';
  const fm = document.getElementById('sweepFlashMode');
  if (fm) fm.value = c.flashMode;
  c.profileShape = 'current';
  document.getElementById('sweepMovingSettings')?.classList.toggle('hidden', spectral);
  document.getElementById('sweepSpectralSettings')?.classList.toggle('hidden', !spectral);
  document.getElementById('sweepGlintPrecisionRow')?.classList.toggle('hidden', spectral);
  document.getElementById('sweepStandaloneMotionSettings')?.classList.toggle('hidden', spectral);
  const gp = document.getElementById('sweepGlintPrecision');
  if (gp) gp.value = c.flashType;
  const m = document.getElementById('sweepMode');
  if (m) m.value = c.mode;
  document.getElementById('sweepEveryNRow')?.classList.toggle('hidden', c.mode !== 'everyNth');
  const n = document.getElementById('sweepEveryN');
  if (n) n.value = String(Math.max(2, Math.min(24, Math.round(Number(c.everyN) || 2))));
  const nt = document.getElementById('sweepEveryNText');
  if (nt) nt.textContent = n?.value || '2';
  const d = document.getElementById('sweepDirection');
  if (d) d.value = c.direction || 'forward';
  const bpm = Math.max(0, Number(state.tapTempo?.bpm) || 0),
    syncActive = c.syncMusic !== false && bpm > 0;
  const sm = document.getElementById('sweepSyncMusic');
  if (sm) sm.checked = c.syncMusic !== false;
  const sp = document.getElementById('sweepSpeed');
  if (sp) {
    sp.value = c.speed;
    sp.disabled = syncActive;
    sp.style.opacity = syncActive ? '.42' : '1';
  }
  {
    const v = Number(c.speedMultiplier);
    c.speedMultiplier = Number.isFinite(v) ? Math.max(0.015625, Math.min(64, v)) : 1;
  }
  const mul = document.getElementById('sweepSpeedMultiplier');
  if (mul) mul.value = String(c.speedMultiplier);
  const st = document.getElementById('sweepSpeedText');
  if (st) {
    const mm = c.speedMultiplier;
    st.textContent = syncActive
      ? `${Math.round(bpm)} BPM × ${mm.toFixed(mm % 1 ? 2 : 0)}`
      : `${Number(c.speed || 0.25).toFixed(2)} цикл/с × ${mm.toFixed(mm % 1 ? 2 : 0)}`;
  }
  c.lengthPercent = Math.max(
    1,
    Math.min(100, Number.isFinite(Number(c.lengthPercent)) ? Number(c.lengthPercent) : 3),
  );
  const len = document.getElementById('sweepLength');
  if (len) len.value = String(c.lengthPercent);
  const lt = document.getElementById('sweepLengthText');
  if (lt) lt.textContent = `${Math.round(c.lengthPercent)}%`;
  c.spectralSectorDegrees = Math.max(
    1,
    Math.min(360, Number.isFinite(Number(c.spectralSectorDegrees)) ? Number(c.spectralSectorDegrees) : 45),
  );
  c.spectralAngularSpeed = Math.max(
    -720,
    Math.min(720, Number.isFinite(Number(c.spectralAngularSpeed)) ? Number(c.spectralAngularSpeed) : 90),
  );
  const ssd = document.getElementById('sweepSpectralSectorDegrees');
  if (ssd) ssd.value = String(c.spectralSectorDegrees);
  const ssdt = document.getElementById('sweepSpectralSectorText');
  if (ssdt) ssdt.textContent = `${Math.round(c.spectralSectorDegrees)}°`;
  const sas = document.getElementById('sweepSpectralAngularSpeed');
  if (sas) sas.value = String(c.spectralAngularSpeed);
  const sast = document.getElementById('sweepSpectralAngularSpeedText');
  if (sast) sast.textContent = `${Math.round(c.spectralAngularSpeed)}°/с`;
  c.widthPercent = Math.max(
    0,
    Math.min(200, Number.isFinite(Number(c.widthPercent)) ? Number(c.widthPercent) : 105),
  );
  const swp = document.getElementById('sweepWidthPercent');
  if (swp) swp.value = String(c.widthPercent);
  const swpt = document.getElementById('sweepWidthText');
  if (swpt) swpt.textContent = `${Math.round(c.widthPercent)}%`;
  const col = document.getElementById('sweepColor');
  if (col) col.value = /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#ffffff';
  c.haloColor = /^#[0-9a-f]{6}$/i.test(c.haloColor || '') ? c.haloColor : c.color;
  const haloCol = document.getElementById('sweepHaloColor');
  if (haloCol) haloCol.value = c.haloColor;
  c.opacity = Math.max(0, Math.min(100, Number.isFinite(Number(c.opacity)) ? Number(c.opacity) : 100));
  const sop = document.getElementById('sweepOpacity');
  if (sop) sop.value = String(c.opacity);
  const sopt = document.getElementById('sweepOpacityText');
  if (sopt) sopt.textContent = `${Math.round(c.opacity)}%`;
  c.brightness = Math.max(
    0,
    Math.min(200, Number.isFinite(Number(c.brightness)) ? Number(c.brightness) : 77),
  );
  c.glow = Math.max(0, Number.isFinite(Number(c.glow)) ? Number(c.glow) : 14.5);
  c.glowMultiplier = Math.max(0, Number.isFinite(Number(c.glowMultiplier)) ? Number(c.glowMultiplier) : 1);
  if (c.glow > 50) {
    const q = compactSweepPixelValue(c.glow, c.glowMultiplier, 50);
    c.glow = q.base;
    c.glowMultiplier = q.multiplier;
  }
  c.glowIntensity = Math.max(
    0,
    Math.min(200, Number.isFinite(Number(c.glowIntensity)) ? Number(c.glowIntensity) : 100),
  );
  c.glowIntensityMultiplier = Math.max(
    0,
    Number.isFinite(Number(c.glowIntensityMultiplier)) ? Number(c.glowIntensityMultiplier) : 1,
  );
  c.softness = Math.max(0, Math.min(150, Number.isFinite(Number(c.softness)) ? Number(c.softness) : 100));
  c.softnessMultiplier = Math.max(
    0,
    Number.isFinite(Number(c.softnessMultiplier)) ? Number(c.softnessMultiplier) : 1,
  );
  const sb = document.getElementById('sweepBrightness');
  if (sb) sb.value = String(c.brightness);
  const sbt = document.getElementById('sweepBrightnessText');
  if (sbt) sbt.textContent = `${Math.round(c.brightness)}%`;
  const sgl = document.getElementById('sweepGlow');
  if (sgl) sgl.value = String(c.glow);
  const sglm = document.getElementById('sweepGlowMultiplier');
  if (sglm) sglm.value = String(c.glowMultiplier);
  const sglt = document.getElementById('sweepGlowText');
  if (sglt)
    sglt.textContent = `${Math.round(c.glow * 10) / 10} px × ${Number(c.glowMultiplier).toFixed(c.glowMultiplier % 1 ? 1 : 0)}`;
  const sgi = document.getElementById('sweepGlowIntensity');
  if (sgi) sgi.value = String(c.glowIntensity);
  const sgim = document.getElementById('sweepGlowIntensityMultiplier');
  if (sgim) sgim.value = String(c.glowIntensityMultiplier);
  const sgit = document.getElementById('sweepGlowIntensityText');
  if (sgit)
    sgit.textContent = `${Math.round(c.glowIntensity)}% × ${Number(c.glowIntensityMultiplier).toFixed(c.glowIntensityMultiplier % 1 ? 1 : 0)}`;
  const ss = document.getElementById('sweepSoftness');
  if (ss) ss.value = String(c.softness);
  const ssm = document.getElementById('sweepSoftnessMultiplier');
  if (ssm) ssm.value = String(c.softnessMultiplier);
  const sst = document.getElementById('sweepSoftnessText');
  if (sst)
    sst.textContent = `${Math.round(c.softness)}% × ${Number(c.softnessMultiplier).toFixed(c.softnessMultiplier % 1 ? 1 : 0)}`;
  {
    delete c.lightningProfileShape;
    c.lightningBehavior = normalizeLightningBehaviorValue(c.lightningBehavior, 'symmetric');
    c.lightningPrecision = normalizeLightningPrecisionValue(c.lightningPrecision);
    const lbeh = document.getElementById('sweepLightningBehavior');
    if (lbeh) lbeh.value = c.lightningBehavior;
    c.lightningMode = 'perPath';
    c.lightningEveryN = Math.max(2, Math.min(24, Math.round(Number(c.lightningEveryN) || 2)));
    c.lightningRandomPosition = false;
    const lm = document.getElementById('sweepLightningMode');
    if (lm) lm.value = c.lightningMode;
    document
      .getElementById('sweepLightningEveryNRow')
      ?.classList.toggle('hidden', c.lightningMode !== 'everyNth');
    const lne = document.getElementById('sweepLightningEveryN');
    if (lne) lne.value = String(c.lightningEveryN);
    const lnet = document.getElementById('sweepLightningEveryNText');
    if (lnet) lnet.textContent = String(c.lightningEveryN);
    const lrpos = document.getElementById('sweepLightningRandomPosition');
    if (lrpos) lrpos.checked = c.lightningRandomPosition;
    const lcol = document.getElementById('sweepLightningColor');
    if (lcol) lcol.value = /^#[0-9a-f]{6}$/i.test(c.lightningColor || '') ? c.lightningColor : '#ffffff';
    const lscol = document.getElementById('sweepLightningSecondaryColor');
    if (lscol)
      lscol.value = /^#[0-9a-f]{6}$/i.test(c.lightningSecondaryColor || '')
        ? c.lightningSecondaryColor
        : '#7dd3fc';
    c.lightningSegmentPercent = Math.max(
      1,
      Math.min(
        100,
        Number.isFinite(Number(c.lightningSegmentPercent)) ? Number(c.lightningSegmentPercent) : 100,
      ),
    );
    const lseg = document.getElementById('sweepLightningSegmentPercent');
    if (lseg) lseg.value = String(c.lightningSegmentPercent);
    const lsegt = document.getElementById('sweepLightningSegmentText');
    if (lsegt) lsegt.textContent = `${Math.round(c.lightningSegmentPercent)}%`;
    c.lightningRatePercent = Math.max(
      0,
      Math.min(100, Number.isFinite(Number(c.lightningRatePercent)) ? Number(c.lightningRatePercent) : 100),
    );
    c.lightningRateMultiplier =
      Number(c.lightningRateMultiplier) > 0 && Number.isFinite(Number(c.lightningRateMultiplier))
        ? Number(c.lightningRateMultiplier)
        : 1;
    const lrs = document.getElementById('sweepLightningRateSync');
    if (lrs) lrs.checked = lightningRateSyncEnabled();
    const lrpct = document.getElementById('sweepLightningRatePercent');
    if (lrpct) lrpct.value = String(c.lightningRatePercent);
    const lrm = document.getElementById('sweepLightningRateMultiplier');
    if (lrm) setLightningBinarySelectValue(lrm, c.lightningRateMultiplier);
    const lrt = document.getElementById('sweepLightningRateText');
    if (lrt) {
      const source = getLightningTriggerSource(c),
        hz = getLightningEffectiveCycleRateHz(c, state.layers.indexOf(effectLayer)),
        tag =
          source === 'glint'
            ? ' · управляет проблеск'
            : source === 'morph'
              ? ' · цикл Blue × частота'
              : source === 'orange'
                ? ' · цикл Orange × частота'
                : source === 'off'
                  ? ' · источник-проблеск выключен'
                  : lightningRateSyncEnabled()
                    ? ' · синхр.'
                    : '';
      lrt.textContent =
        source === 'timer'
          ? hz > 0
            ? `${Math.round(c.lightningRatePercent)}% × ${formatLightningMultiplier(c.lightningRateMultiplier)} интервала · ${(1 / hz).toFixed(1 / hz < 10 ? 2 : 1)} с${tag}`
            : `Таймер выключен`
          : hz > 0
            ? `${(1 / hz).toFixed(1 / hz < 10 ? 2 : 1)} с${tag}`
            : tag.trim();
    }
    c.lightningDurationMs = Math.max(30, Math.min(700, Number(c.lightningDurationMs) || 480));
    const ldur = document.getElementById('sweepLightningDuration');
    if (ldur) ldur.value = String(c.lightningDurationMs);
    c.lightningDurationMultiplier =
      Number(c.lightningDurationMultiplier) > 0 && Number.isFinite(Number(c.lightningDurationMultiplier))
        ? Number(c.lightningDurationMultiplier)
        : 1;
    const ldm = document.getElementById('sweepLightningDurationMultiplier');
    if (ldm) setLightningBinarySelectValue(ldm, c.lightningDurationMultiplier);
    const ldurt = document.getElementById('sweepLightningDurationText');
    if (ldurt)
      ldurt.textContent = `${Math.round(c.lightningDurationMs)} ms × ${formatLightningMultiplier(c.lightningDurationMultiplier)}`;
    c.lightningWidthPercent = Math.max(1, Math.min(100, Number(c.lightningWidthPercent) || 64));
    const lw = document.getElementById('sweepLightningWidthPercent');
    if (lw) lw.value = String(c.lightningWidthPercent);
    c.lightningWidthMultiplier = Math.max(
      0,
      Number.isFinite(Number(c.lightningWidthMultiplier)) ? Number(c.lightningWidthMultiplier) : 1,
    );
    const lwm = document.getElementById('sweepLightningWidthMultiplier');
    if (lwm) lwm.value = String(c.lightningWidthMultiplier);
    const lwt = document.getElementById('sweepLightningWidthText');
    if (lwt)
      lwt.textContent = `${Math.round(c.lightningWidthPercent)}% × ${Number(c.lightningWidthMultiplier.toFixed(4))}`;
    c.lightningBrightness = Math.max(
      0,
      Math.min(400, Number.isFinite(Number(c.lightningBrightness)) ? Number(c.lightningBrightness) : 100),
    );
    c.lightningGlow = Math.max(0, Number.isFinite(Number(c.lightningGlow)) ? Number(c.lightningGlow) : 16);
    c.lightningGlowMultiplier = Math.max(
      0,
      Number.isFinite(Number(c.lightningGlowMultiplier)) ? Number(c.lightningGlowMultiplier) : 1,
    );
    if (c.lightningGlow > 50) {
      const q = compactSweepPixelValue(c.lightningGlow, c.lightningGlowMultiplier, 50);
      c.lightningGlow = q.base;
      c.lightningGlowMultiplier = q.multiplier;
    }
    c.lightningGlowIntensity = Math.max(
      0,
      Math.min(
        400,
        Number.isFinite(Number(c.lightningGlowIntensity)) ? Number(c.lightningGlowIntensity) : 100,
      ),
    );
    c.lightningGlowIntensityMultiplier = Math.max(
      0,
      Number.isFinite(Number(c.lightningGlowIntensityMultiplier))
        ? Number(c.lightningGlowIntensityMultiplier)
        : 1,
    );
    c.lightningSoftness = Math.max(
      0,
      Number.isFinite(Number(c.lightningSoftness)) ? Number(c.lightningSoftness) : 100,
    );
    c.lightningSoftnessMultiplier = Math.max(
      0,
      Number.isFinite(Number(c.lightningSoftnessMultiplier)) ? Number(c.lightningSoftnessMultiplier) : 1,
    );
    let di = c.lightningGlowIntensity * c.lightningGlowIntensityMultiplier,
      dg = c.lightningGlow * c.lightningGlowMultiplier,
      ds = c.lightningSoftness * c.lightningSoftnessMultiplier;
    const dgCompact = compactSweepPixelValue(dg, 1, 50),
      diBase = Math.min(400, di),
      diMult = diBase > 0 ? di / diBase : 1,
      dsBase = Math.min(150, ds),
      dsMult = dsBase > 0 ? ds / dsBase : 1,
      lgi = document.getElementById('sweepLightningGlowIntensity'),
      lgim = document.getElementById('sweepLightningGlowIntensityMultiplier'),
      lg = document.getElementById('sweepLightningGlow'),
      lgm = document.getElementById('sweepLightningGlowMultiplier'),
      lsoft = document.getElementById('sweepLightningSoftness'),
      lsoftm = document.getElementById('sweepLightningSoftnessMultiplier');
    if (lgi) lgi.value = String(diBase);
    if (lgim) lgim.value = String(diMult);
    if (lg) lg.value = String(dgCompact.base);
    if (lgm) lgm.value = String(dgCompact.multiplier);
    if (lsoft) lsoft.value = String(dsBase);
    if (lsoftm) lsoftm.value = String(dsMult);
    const lgit = document.getElementById('sweepLightningGlowIntensityText');
    if (lgit) lgit.textContent = `${Math.round(di)}%`;
    const lgt = document.getElementById('sweepLightningGlowText');
    if (lgt) lgt.textContent = `${Math.round(dg * 10) / 10} px`;
    const lst = document.getElementById('sweepLightningSoftnessText');
    if (lst) lst.textContent = `${Math.round(ds)}%`;
    c.lightningSmoothLighting = true;
    const lsl = document.getElementById('sweepLightningShowLines');
    if (lsl) lsl.checked = c.lightningShowLines !== false;
    const llo = document.getElementById('sweepLightningLineOpacity');
    if (llo) {
      c.lightningLineOpacity = Math.max(
        0,
        Math.min(100, Number.isFinite(Number(c.lightningLineOpacity)) ? Number(c.lightningLineOpacity) : 100),
      );
      llo.value = String(c.lightningLineOpacity);
      const lineOn = getLayerLineVisible(effectLayer);
      llo.style.opacity = lineOn ? '.45' : '1';
      llo.title = lineOn
        ? 'Обычная линия уже видима — дополнительная основа не рисуется'
        : 'Прозрачность локальной основы под ударом';
    }
    const llot = document.getElementById('sweepLightningLineOpacityText');
    if (llot) llot.textContent = `${Math.round(c.lightningLineOpacity)}%`;
    c.lightningAfterglow = false;
    c.lightningAfterglowMs = 0;
    const lmicro = document.getElementById('sweepLightningMicroStrikes');
    if (lmicro) {
      c.lightningMicroStrikes = Math.max(0, Math.round(Number(c.lightningMicroStrikes) || 0));
      lmicro.value = String(c.lightningMicroStrikes);
    }
  }
  normalizeSweepConfig(c);
  if (c.enabled === true) ensureSweepAnimation();
}

export {
  getLayerMainLineMode,
  normalizeLineMarkerType,
  normalizeLineProfileValue,
  setFourierMode,
  setLayerMainLineMode,
  setSidebarMode,
  syncFourierStrengthUI,
  syncLampSettingsUI,
  syncMorphModeDependentUI,
  syncMotionUI,
  syncSidebarToolStates,
  syncSweepUI,
  syncWebOutlineUI,
};
