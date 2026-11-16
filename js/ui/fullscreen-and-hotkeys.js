// Полноэкранный режим, мобильные действия, горячие клавиши.
import '../audio/audio-reactive.js'; // initialisation order: this module runs after it
import { renderProfileEditor } from './profile-editor.js';
import { initializeNewLayerAudioRouting } from '../audio/audio-routing.js';
import { createUserAddedLayer } from '../core/defaults-layers.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { runtimeState, state } from '../core/state.js';
import { renderMainCanvas } from '../render/main-pipeline.js';
import { mainCanvas } from './profile-presets.js';
import { updateLayerListUI } from './layer-selection.js';
import { syncSidebarInputs } from './sidebar-sync.js';
import { activeRebaseMorphing } from '../morph-runtime/morph-hooks.js';
import { stepProjectChooser } from '../project/playlist.js';
import { showShortcutToast } from './header-and-export.js';
import { isMobileAudioEnvironment } from '../audio/audio-reactive.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

function getNativeAppFullscreenElement() {
  return document.fullscreenElement || document.webkitFullscreenElement || null;
}
function isIPhoneWebKitFullscreenLimited() {
  return /iPhone|iPod/i.test(navigator.userAgent || '');
}
function isPseudoAppFullscreen() {
  return document.documentElement.classList.contains('app-pseudo-fullscreen');
}
let pseudoFullscreenViewportRaf = 0;
function syncPseudoFullscreenViewport() {
  if (!isPseudoAppFullscreen()) return;
  const vv = window.visualViewport;
  const width = Math.max(
    1,
    Math.round(
      Number(vv?.width) || Number(window.innerWidth) || Number(document.documentElement.clientWidth) || 1,
    ),
  );
  const height = Math.max(
    1,
    Math.round(
      Number(vv?.height) || Number(window.innerHeight) || Number(document.documentElement.clientHeight) || 1,
    ),
  );
  document.documentElement.style.setProperty('--somata-viewport-width', `${width}px`);
  document.documentElement.style.setProperty('--somata-viewport-height', `${height}px`);
  requestMainCanvasRender();
}
function schedulePseudoFullscreenViewportSync() {
  if (!isPseudoAppFullscreen() || pseudoFullscreenViewportRaf) return;
  pseudoFullscreenViewportRaf = requestAnimationFrame(() => {
    pseudoFullscreenViewportRaf = 0;
    syncPseudoFullscreenViewport();
  });
}
function enterPseudoAppFullscreen() {
  if (isPseudoAppFullscreen()) return;
  document.documentElement.classList.add('app-pseudo-fullscreen');
  syncPseudoFullscreenViewport();
  handleAppFullscreenChange();
}
function exitPseudoAppFullscreen() {
  if (!isPseudoAppFullscreen()) return;
  document.documentElement.classList.remove('app-pseudo-fullscreen');
  document.documentElement.style.removeProperty('--somata-viewport-width');
  document.documentElement.style.removeProperty('--somata-viewport-height');
  handleAppFullscreenChange();
}
async function toggleAppFullscreen() {
  const active = getNativeAppFullscreenElement();
  if (active) {
    try {
      if (document.exitFullscreen) await document.exitFullscreen();
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (error) {
      noteSuppressedError('ui/fullscreen-and-hotkeys#toggleAppFullscreen', error);
    }
    return;
  }
  if (isPseudoAppFullscreen()) {
    exitPseudoAppFullscreen();
    return;
  }

  if (isIPhoneWebKitFullscreenLimited()) {
    enterPseudoAppFullscreen();
    return;
  }

  const target = document.documentElement;
  try {
    if (target.requestFullscreen) {
      await target.requestFullscreen();
      // Some mobile WebViews expose the API but resolve without entering fullscreen.
      // Confirm the state on the next frame before trusting the native call.
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (getNativeAppFullscreenElement()) return;
      if (isMobileAudioEnvironment()) {
        enterPseudoAppFullscreen();
        return;
      }
    }
    if (target.webkitRequestFullscreen) {
      target.webkitRequestFullscreen();
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (getNativeAppFullscreenElement()) return;
      if (isMobileAudioEnvironment()) {
        enterPseudoAppFullscreen();
        return;
      }
    }
  } catch (err) {
    if (isMobileAudioEnvironment()) {
      enterPseudoAppFullscreen();
      return;
    }
    showShortcutToast('Не удалось открыть полный экран');
    return;
  }

  if (isMobileAudioEnvironment()) enterPseudoAppFullscreen();
  else showShortcutToast('Полный экран не поддерживается этим браузером');
}
const desktopFullscreenMedia = window.matchMedia?.('(hover: hover) and (pointer: fine)');
const fullscreenWorkspace = document.getElementById('mainContainer') || mainCanvas;
fullscreenWorkspace?.addEventListener('dblclick', (event) => {
  const mobileViewport = window.matchMedia?.('(max-width: 760px)')?.matches === true;
  if (mobileViewport || desktopFullscreenMedia?.matches === false || event.button !== 0) return;
  if (
    event.target?.closest?.(
      'button,input,select,textarea,a,label,[contenteditable="true"],[role="button"],.floating-controls',
    )
  )
    return;
  event.preventDefault();
  event.stopPropagation();
  void toggleAppFullscreen();
});
function setupMobileMediaActions() {
  document.getElementById('btnMobileFullscreen')?.addEventListener('click', toggleAppFullscreen);
  document.getElementById('btnPseudoFullscreenExit')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    exitPseudoAppFullscreen();
  });

  document.getElementById('btnMobileMic')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('btnAudioReactive')?.click();
  });
  document.getElementById('btnMobileAudioRouting')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById('btnAudioRouting')?.click();
  });
}
function setupMobileNumberSteppers() {
  document.querySelectorAll('.mobile-number-stepper').forEach((wrapper) => {
    const input = wrapper.querySelector('input[type="number"]');
    if (input && wrapper.parentNode) {
      delete input.dataset.mobileStepper;
      wrapper.parentNode.insertBefore(input, wrapper);
    }
    wrapper.remove();
  });
}
let preFullscreenView = null;
const handleAppFullscreenChange = () => {
  const active = Boolean(getNativeAppFullscreenElement() || isPseudoAppFullscreen());
  if (active) {
    if (!preFullscreenView) preFullscreenView = { panX: state.panX, panY: state.panY };
    state.panX = 0;
    state.panY = 0;
    document.getElementById('audioReactivePanel')?.classList.add('hidden');
    document.getElementById('audioRoutingPanel')?.classList.add('hidden');
    document.getElementById('tunnelSettingsPanel')?.classList.add('hidden');
    document.getElementById('btnTunnelSettings')?.setAttribute('aria-expanded', 'false');
    document.getElementById('libraryModal')?.classList.add('hidden');
  } else if (preFullscreenView) {
    state.panX = preFullscreenView.panX;
    state.panY = preFullscreenView.panY;
    preFullscreenView = null;
  }

  requestAnimationFrame(() => requestMainCanvasRender());
};
document.addEventListener('fullscreenchange', handleAppFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleAppFullscreenChange);
window.addEventListener('resize', schedulePseudoFullscreenViewportSync, { passive: true });
window.addEventListener('orientationchange', schedulePseudoFullscreenViewportSync, { passive: true });
window.visualViewport?.addEventListener('resize', schedulePseudoFullscreenViewportSync, { passive: true });
window.visualViewport?.addEventListener('scroll', schedulePseudoFullscreenViewportSync, { passive: true });
function setupGlobalHotkeys() {
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.altKey || e.metaKey) return;
    const active = document.activeElement;
    if (active && (active.isContentEditable || active.matches('input, textarea, select'))) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      toggleAppFullscreen();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const newL = createUserAddedLayer(`Слой ${state.layers.length + 1}`);
      state.layers.push(newL);
      state.activeLayerId = newL.id;
      initializeNewLayerAudioRouting(newL);

      if (runtimeState.morph.active) activeRebaseMorphing();
      updateLayerListUI();
      syncSidebarInputs();
      renderProfileEditor();
      renderMainCanvas();
      showShortcutToast(`Слоёв: ${state.layers.length}`);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (state.layers.length > 1) {
        const removed = state.layers.pop();
        if (removed.id === state.activeLayerId)
          state.activeLayerId = state.layers[state.layers.length - 1].id;
        updateLayerListUI();
        syncSidebarInputs();
        renderProfileEditor();
        renderMainCanvas();
      }
      showShortcutToast(`Слоёв: ${state.layers.length}`);
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      stepProjectChooser(e.key === 'ArrowRight' ? 1 : -1);
      return;
    }
  });
}

export { setupGlobalHotkeys, setupMobileMediaActions, setupMobileNumberSteppers };
