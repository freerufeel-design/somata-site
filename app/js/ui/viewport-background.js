// Фон вьюпорта, фон при морфе проектов, режимы наложения сцены.
import './morph-settings-panel.js'; // initialisation order: this module runs after it
import { renderBackendTelemetry } from '../render/backend-telemetry.js';
import { WebGPUFinalCompositeRenderer } from '../gpu/final-composite-renderer.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { runtimeState, state } from '../core/state.js';
import { mainCanvas, sceneBlendCanvas, sceneBlendCtx } from './profile-presets.js';
import { normalizeProjectMorphSettings } from '../project/project-morph.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

function refreshViewportBackgroundPresentation() {
  try {
    requestMainCanvasRender?.();
  } catch (error) {
    noteSuppressedError('ui/viewport-background#refreshViewportBackgroundPresentation', error);
  }
  try {
    syncSceneBlendCanvasFromMain?.();
  } catch (error) {
    noteSuppressedError('ui/viewport-background#refreshViewportBackgroundPresentation', error);
  }
}
function openViewportBackgroundImagePicker() {
  const input = document.getElementById('backgroundImageInput');
  if (!input) return;

  input.value = '';
  input.click();
}
function desktopTransparencyBridge() {
  const candidates = [
    window.spiroDesktopBridge,
    window.SpiroDesktopBridge,
    window.electronAPI,
    window.desktopBridge,
  ];
  for (const bridge of candidates) {
    if (!bridge || typeof bridge !== 'object') continue;
    for (const key of ['setTransparentDesktop', 'setWindowTransparent', 'setTransparent']) {
      if (typeof bridge[key] === 'function') return { bridge, fn: bridge[key] };
    }
  }
  return null;
}
function applyTransparentDesktopMode(enabled, notifyHost = true) {
  const next = enabled === true;
  const was = state.transparentDesktop === true;
  const classWas = document.body?.classList.contains('desktop-transparent') === true;
  state.transparentDesktop = next;
  document.body?.classList.toggle('desktop-transparent', next);
  const host = document.getElementById('mainContainer');
  if (host) host.style.backgroundColor = next ? 'transparent' : state.bgColor;
  const checkbox = document.getElementById('paramTransparentDesktop');
  if (checkbox) checkbox.checked = next;
  const hint = document.getElementById('transparentDesktopHint');
  const nativeBridge = desktopTransparencyBridge();
  if (hint)
    hint.textContent = nativeBridge
      ? 'Нативный host найден: прозрачность окна передаётся системе.'
      : 'HTML: прозрачна рабочая область. Для настоящего рабочего стола нужен прозрачный нативный host.';
  if (notifyHost && nativeBridge && was !== next) {
    try {
      Promise.resolve(nativeBridge.fn.call(nativeBridge.bridge, next)).catch(() => {});
    } catch (error) {
      noteSuppressedError('ui/viewport-background#applyTransparentDesktopMode', error);
    }
  }
  if (was !== next || classWas !== next) {
    try {
      WebGPUFinalCompositeRenderer?.disable?.();
    } catch (error) {
      noteSuppressedError('ui/viewport-background#applyTransparentDesktopMode', error);
    }
    refreshViewportBackgroundPresentation();
  }
}
function clearViewportBackgroundImage() {
  const layer = document.getElementById('viewportBackgroundImage');
  if (layer) {
    layer.style.backgroundImage = 'none';
    layer.classList.remove('active');
  }
  state.backgroundImageDataUrl = '';
  document.getElementById('btnBackgroundImage')?.classList.remove('active');
  document.getElementById('btnClearBackgroundImage')?.classList.add('hidden');
  const menuClear = document.getElementById('btnClearBackgroundImageMenu');
  if (menuClear) menuClear.disabled = true;
  const input = document.getElementById('backgroundImageInput');
  if (input) input.value = '';
  refreshViewportBackgroundPresentation();
}
function setViewportBackgroundImageDataUrl(dataUrl) {
  const valid = typeof dataUrl === 'string' && /^data:image\//i.test(dataUrl);
  if (!valid) {
    clearViewportBackgroundImage();
    return;
  }
  state.backgroundImageDataUrl = dataUrl;
  const layer = document.getElementById('viewportBackgroundImage');
  if (layer) {
    layer.style.backgroundImage = `url("${dataUrl}")`;
    layer.classList.add('active');
  }
  document.getElementById('btnBackgroundImage')?.classList.add('active');
  document.getElementById('btnClearBackgroundImage')?.classList.remove('hidden');
  const menuClear = document.getElementById('btnClearBackgroundImageMenu');
  if (menuClear) menuClear.disabled = false;
  refreshViewportBackgroundPresentation();
}
function setViewportBackgroundImageFile(file) {
  if (!file || !String(file.type || '').startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => setViewportBackgroundImageDataUrl(String(reader.result || ''));
  reader.readAsDataURL(file);
}
function getProjectBackgroundSpec(projectData) {
  const settings =
    projectData?.settings && typeof projectData.settings === 'object' ? projectData.settings : {};
  const image =
    typeof settings.backgroundImageDataUrl === 'string' &&
    /^data:image\//i.test(settings.backgroundImageDataUrl)
      ? settings.backgroundImageDataUrl
      : '';
  const color = /^#[0-9a-f]{6}$/i.test(String(settings.bgColor || '')) ? String(settings.bgColor) : '#090d16';
  return { image, color };
}
function configureProjectMorphBackgroundLayer(el, spec) {
  if (!el) return;
  const color = spec?.color || '#090d16',
    image = spec?.image || '';
  if (el.__spiroProjectBgColor !== color) {
    el.style.backgroundColor = color;
    el.__spiroProjectBgColor = color;
  }

  if (el.__spiroProjectBgImage !== image) {
    el.style.backgroundImage = image ? `url("${image}")` : 'none';
    el.__spiroProjectBgImage = image;
  }
  el.style.opacity = '1';
  el.style.transform = 'translate3d(0,0,0)';
  el.style.maskImage = 'none';
  el.style.webkitMaskImage = 'none';
  el.classList.add('active');
}
function clearProjectMorphBackgroundTransition() {
  const host = document.getElementById('mainContainer');
  const source = document.getElementById('projectMorphBackgroundSource');
  const target = document.getElementById('projectMorphBackgroundTarget');
  host?.classList.remove('project-morph-background-active');
  for (const el of [source, target])
    if (el) {
      el.classList.remove('active');
      el.style.opacity = '';
      el.style.transform = '';
      el.style.maskImage = '';
      el.style.webkitMaskImage = '';
      el.style.backgroundImage = '';
      el.style.backgroundColor = '';
      el.__spiroProjectBgImage = null;
      el.__spiroProjectBgColor = null;
    }
  if (runtimeState?.projectMorph) runtimeState.projectMorph.backgroundActive = false;
}
function setProjectMorphTargetMask(el, mask) {
  if (!el) return;
  el.style.maskImage = mask;
  el.style.webkitMaskImage = mask;
}
function updateProjectMorphBackgroundTransition(sourceProject, targetProject, progress) {
  const pm = normalizeProjectMorphSettings(),
    pmRt = runtimeState.projectMorph;
  const source = document.getElementById('projectMorphBackgroundSource');
  const target = document.getElementById('projectMorphBackgroundTarget');
  const host = document.getElementById('mainContainer');
  if (!source || !target || !host) return;
  const a = getProjectBackgroundSpec(sourceProject),
    b = getProjectBackgroundSpec(targetProject);
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  configureProjectMorphBackgroundLayer(source, a);
  configureProjectMorphBackgroundLayer(target, b);
  host.classList.add('project-morph-background-active');
  pmRt.backgroundActive = true;
  source.style.opacity = '1';
  target.style.opacity = '1';
  source.style.transform = 'translate3d(0,0,0)';
  target.style.transform = 'translate3d(0,0,0)';
  setProjectMorphTargetMask(target, 'none');
  const mode = pm.imageTransitionType;
  if (mode === 'instant') {
    source.style.opacity = p < 0.5 ? '1' : '0';
    target.style.opacity = p < 0.5 ? '0' : '1';
  } else if (mode === 'fade') {
    source.style.opacity = String(1 - p);
    target.style.opacity = String(p);
  } else if (mode === 'slide') {
    source.style.transform = `translate3d(${-100 * p}%,0,0)`;
    target.style.transform = `translate3d(${100 * (1 - p)}%,0,0)`;
  } else if (mode === 'center') {
    if (p <= 0.0001) {
      target.style.opacity = '0';
    } else if (p >= 0.9999) {
      setProjectMorphTargetMask(target, 'none');
    } else {
      const rect = host.getBoundingClientRect(),
        maxR = Math.hypot(rect.width * 0.5, rect.height * 0.5);
      const softness = Math.max(0, Math.min(100, pm.imageCenterSoftness)) / 100;
      const feather = Math.max(
        0.5,
        Math.min(maxR * 0.32, Math.min(rect.width, rect.height) * 0.24 * softness),
      );
      const r = maxR * p,
        inner = Math.max(0, r - feather),
        outer = Math.min(maxR, r + feather);
      setProjectMorphTargetMask(
        target,
        `radial-gradient(circle at 50% 50%, #000 0px, #000 ${inner.toFixed(2)}px, transparent ${outer.toFixed(2)}px)`,
      );
    }
  } else if (mode === 'sector') {
    if (p <= 0.0001) {
      target.style.opacity = '0';
    } else if (p >= 0.9999) {
      setProjectMorphTargetMask(target, 'none');
    } else {
      const softness = Math.max(0, Math.min(100, pm.imageSectorSoftness)) / 100;
      const feather = Math.max(0.05, 45 * softness),
        angle = 360 * p;
      const solid = Math.max(0, angle - feather * 0.5),
        edge = Math.min(360, angle + feather * 0.5);
      setProjectMorphTargetMask(
        target,
        `conic-gradient(from -90deg at 50% 50%, #000 0deg, #000 ${solid.toFixed(3)}deg, transparent ${edge.toFixed(3)}deg, transparent 360deg)`,
      );
    }
  }
}
const SCENE_BLEND_MODES = new Set([
  'normal',
  'darken',
  'multiply',
  'color-burn',
  'lighten',
  'screen',
  'color-dodge',
  'plus-lighter',
  'overlay',
  'soft-light',
  'hard-light',
  'difference',
  'exclusion',
  'hue',
  'saturation',
  'color',
  'luminosity',
]);
function normalizeSceneBlendState(raw = state.sceneBlend) {
  const src = raw && typeof raw === 'object' ? raw : {};
  let mode = String(src.mode || 'normal');
  if (!SCENE_BLEND_MODES.has(mode)) mode = 'normal';
  if (
    mode === 'plus-lighter' &&
    typeof CSS !== 'undefined' &&
    CSS.supports &&
    !CSS.supports('mix-blend-mode', 'plus-lighter')
  )
    mode = 'screen';
  const strength = Math.max(
    0,
    Math.min(100, Number.isFinite(Number(src.strength)) ? Number(src.strength) : 100),
  );
  const opacity = Math.max(
    0,
    Math.min(100, Number.isFinite(Number(src.opacity)) ? Number(src.opacity) : 100),
  );
  const out = { mode, strength, opacity };
  if (raw === state.sceneBlend || raw === undefined) state.sceneBlend = out;
  return out;
}
function applySceneBlendCompositeStyle() {
  if (!mainCanvas || !sceneBlendCanvas) return;
  const cfg = normalizeSceneBlendState();
  const overall = cfg.opacity / 100;
  const strength = cfg.mode === 'normal' ? 0 : cfg.strength / 100;

  const directBlend = cfg.mode !== 'normal' && strength >= 0.9999 && overall > 0.0001;
  if (directBlend) {
    mainCanvas.style.mixBlendMode = cfg.mode;
    mainCanvas.style.opacity = String(Math.max(0, Math.min(1, overall)));
    sceneBlendCanvas.style.display = 'none';
    sceneBlendCanvas.style.opacity = '0';
    sceneBlendCanvas.style.mixBlendMode = 'normal';
  } else {
    mainCanvas.style.mixBlendMode = 'normal';
    let normalOpacity = overall;
    let blendOpacity = 0;
    if (strength > 0.0001 && overall > 0.0001) {
      normalOpacity = overall * (1 - strength);
      const denom = 1 - normalOpacity;
      blendOpacity = denom > 1e-6 ? (overall - normalOpacity) / denom : 0;
      blendOpacity = Math.max(0, Math.min(1, blendOpacity));
    }
    mainCanvas.style.opacity = String(Math.max(0, Math.min(1, normalOpacity)));
    sceneBlendCanvas.style.mixBlendMode = cfg.mode;
    sceneBlendCanvas.style.opacity = String(blendOpacity);
    sceneBlendCanvas.style.display = blendOpacity > 0.0001 && cfg.mode !== 'normal' ? 'block' : 'none';
  }
  document
    .getElementById('btnBackgroundImage')
    ?.classList.toggle('blend-active', cfg.mode !== 'normal' && cfg.strength > 0);
}
function syncSceneBlendCanvasFromMain() {
  applySceneBlendCompositeStyle();
  if (!mainCanvas || !sceneBlendCanvas || !sceneBlendCtx || sceneBlendCanvas.style.display === 'none') return;
  try {
    renderBackendTelemetry.mark('final', 'canvas', 'Canvas scene-blend copy', true);
  } catch (error) {
    noteSuppressedError('ui/viewport-background#syncSceneBlendCanvasFromMain', error);
  }
  if (sceneBlendCanvas.width !== mainCanvas.width || sceneBlendCanvas.height !== mainCanvas.height) {
    sceneBlendCanvas.width = mainCanvas.width;
    sceneBlendCanvas.height = mainCanvas.height;
  }
  sceneBlendCtx.setTransform(1, 0, 0, 1, 0, 0);
  sceneBlendCtx.globalAlpha = 1;
  sceneBlendCtx.globalCompositeOperation = 'copy';
  sceneBlendCtx.filter = 'none';
  sceneBlendCtx.drawImage(mainCanvas, 0, 0);
  sceneBlendCtx.globalCompositeOperation = 'source-over';
}
function syncSceneBlendUI() {
  const cfg = normalizeSceneBlendState();
  const mode = document.getElementById('sceneBlendMode');
  const strength = document.getElementById('sceneBlendStrength');
  const opacity = document.getElementById('sceneBlendOpacity');
  if (mode) mode.value = cfg.mode;
  if (strength) strength.value = String(cfg.strength);
  if (opacity) opacity.value = String(cfg.opacity);
  const sv = document.getElementById('sceneBlendStrengthValue');
  const ov = document.getElementById('sceneBlendOpacityValue');
  if (sv) sv.textContent = `${Math.round(cfg.strength)}%`;
  if (ov) ov.textContent = `${Math.round(cfg.opacity)}%`;
  const clearMenu = document.getElementById('btnClearBackgroundImageMenu');
  if (clearMenu) clearMenu.disabled = !state.backgroundImageDataUrl;
  applyTransparentDesktopMode(state.transparentDesktop === true, false);
  applySceneBlendCompositeStyle();
}
function closeSceneBlendMenu() {
  document.getElementById('sceneBlendMenu')?.classList.add('hidden');
}
function openSceneBlendMenuAt(clientX, clientY) {
  const menu = document.getElementById('sceneBlendMenu');
  if (!menu) return;
  syncSceneBlendUI();
  menu.classList.remove('hidden');
  menu.style.left = '8px';
  menu.style.top = '8px';
  requestAnimationFrame(() => {
    const r = menu.getBoundingClientRect();
    const margin = 8;
    const x = Math.max(
      margin,
      Math.min(window.innerWidth - r.width - margin, Number(clientX) - r.width + 18),
    );
    const y = Math.max(
      margin,
      Math.min(window.innerHeight - r.height - margin, Number(clientY) - r.height - 8),
    );
    menu.style.left = `${Math.round(x)}px`;
    menu.style.top = `${Math.round(y)}px`;
  });
}
function bindSceneBlendControls() {
  const btn = document.getElementById('btnBackgroundImage');
  const menu = document.getElementById('sceneBlendMenu');
  if (!btn || !menu || btn.dataset.sceneBlendBound === '1') return;
  btn.dataset.sceneBlendBound = '1';
  btn.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openSceneBlendMenuAt(e.clientX, e.clientY);
  });
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
  menu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (menu.classList.contains('hidden')) return;
      if (menu.contains(e.target) || btn.contains(e.target)) return;
      closeSceneBlendMenu();
    },
    true,
  );
  const update = () => {
    const cfg = normalizeSceneBlendState();
    const modeEl = document.getElementById('sceneBlendMode');
    const strengthEl = document.getElementById('sceneBlendStrength');
    const opacityEl = document.getElementById('sceneBlendOpacity');
    cfg.mode = SCENE_BLEND_MODES.has(modeEl?.value) ? modeEl.value : 'normal';
    cfg.strength = Math.max(0, Math.min(100, Number(strengthEl?.value) || 0));
    cfg.opacity = Math.max(0, Math.min(100, Number(opacityEl?.value) || 0));
    state.sceneBlend = cfg;
    syncSceneBlendUI();
    syncSceneBlendCanvasFromMain();
  };
  document.getElementById('sceneBlendMode')?.addEventListener('change', update);
  const cycleBlendMode = (delta) => {
    const modeEl = document.getElementById('sceneBlendMode');
    if (!modeEl || !modeEl.options.length) return;
    const count = modeEl.options.length;
    const current = Math.max(0, modeEl.selectedIndex);
    modeEl.selectedIndex = (current + delta + count) % count;
    update();
  };
  document.getElementById('sceneBlendPrevMode')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cycleBlendMode(-1);
  });
  document.getElementById('sceneBlendNextMode')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    cycleBlendMode(1);
  });
  document.getElementById('sceneBlendStrength')?.addEventListener('input', update);
  document.getElementById('sceneBlendOpacity')?.addEventListener('input', update);
  document.getElementById('btnChooseBackgroundImageMenu')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    openViewportBackgroundImagePicker();
  });
  document.getElementById('btnClearBackgroundImageMenu')?.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    clearViewportBackgroundImage();
  });
  document.getElementById('paramTransparentDesktop')?.addEventListener('change', (e) => {
    applyTransparentDesktopMode(e.target.checked === true, true);
  });
  document.getElementById('btnResetSceneBlend')?.addEventListener('click', () => {
    state.sceneBlend = { mode: 'normal', strength: 100, opacity: 100 };
    syncSceneBlendUI();
    syncSceneBlendCanvasFromMain();
  });
  window.addEventListener('resize', closeSceneBlendMenu, { passive: true });
  syncSceneBlendUI();
}

export {
  applyTransparentDesktopMode,
  bindSceneBlendControls,
  clearProjectMorphBackgroundTransition,
  clearViewportBackgroundImage,
  getProjectBackgroundSpec,
  normalizeSceneBlendState,
  openViewportBackgroundImagePicker,
  setViewportBackgroundImageDataUrl,
  setViewportBackgroundImageFile,
  syncSceneBlendUI,
  updateProjectMorphBackgroundTransition,
};
