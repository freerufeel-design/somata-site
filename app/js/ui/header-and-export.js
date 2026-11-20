// Видимость шапки, библиотека, экспорт PNG/SVG, всплывающие подсказки.
import './floating-panels.js'; // initialisation order: this module runs after it
import { computeMaxArtworkRadius } from '../geometry/artwork-extent.js';
import { renderLayerOrbitPaths } from '../render/spiral-stroke.js';
import { state } from '../core/state.js';
import {
  getCachedLayerDrawData,
  getLayerGlowIntensityMultiplier,
  getLayerGlowMultiplier,
  getLayerStrokeWidthMultiplier,
} from '../effects/motion.js';
import { buildMorphGeometry } from '../geometry/morph.js';
import { computeLayerGeometryCircles } from '../render/geometry-circles-pass.js';
import { capturePlaylistOverridesFromCurrent } from '../project/project-data.js';
import { saveCurrentProjectToPlaylist } from '../project/playlist.js';
import { renderLibrary } from './library.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const HEADER_VISIBILITY_KEY = 'SpiroStar.headerVisibility.v7';
function applyHeaderVisibility() {
  // Somata 9.1: profiles are permanently visible; the redundant preset
  // and miniature morph selectors have been retired, including for old saves.
  const h = state.uiVisibility || (state.uiVisibility = { showProjects: true });
  h.showPresets = false;
  h.hideMorphChooser = true;
  h.hideProfiles = false;
  document
    .getElementById('presetChooserPanel')
    ?.classList.toggle('header-choice-hidden', h.showPresets !== true);
  document
    .getElementById('projectChooserPanel')
    ?.classList.toggle('header-choice-hidden', h.showProjects !== true);
  document
    .getElementById('morphTypeTopNav')
    ?.classList.toggle('header-choice-hidden', h.hideMorphChooser === true);
  document.getElementById('profileSettingsGroup')?.classList.remove('hidden');
  const p = document.getElementById('showPresetChooser');
  if (p) p.checked = h.showPresets === true;
  const j = document.getElementById('hideProjectChooser');
  if (j) j.checked = h.showProjects !== false;
  const m = document.getElementById('hideMorphChooser');
  if (m) m.checked = h.hideMorphChooser !== true;
  const f = document.getElementById('hideProfiles');
  if (f) f.checked = h.hideProfiles !== true;
}
function saveHeaderVisibility() {
  try {
    localStorage.setItem(HEADER_VISIBILITY_KEY, JSON.stringify(state.uiVisibility));
  } catch (error) {
    noteSuppressedError('ui/header-and-export#saveHeaderVisibility', error);
  }
}
try {
  const saved = JSON.parse(localStorage.getItem(HEADER_VISIBILITY_KEY) || 'null');
  if (saved && typeof saved === 'object') state.uiVisibility = { ...state.uiVisibility, ...saved };
} catch (error) {
  noteSuppressedError('ui/header-and-export', error);
}
applyHeaderVisibility();
document.getElementById('showPresetChooser')?.addEventListener('change', (e) => {
  state.uiVisibility.showPresets = e.target.checked;
  applyHeaderVisibility();
  saveHeaderVisibility();
  capturePlaylistOverridesFromCurrent();
});
document.getElementById('hideProjectChooser')?.addEventListener('change', (e) => {
  state.uiVisibility.showProjects = e.target.checked;
  applyHeaderVisibility();
  saveHeaderVisibility();
  capturePlaylistOverridesFromCurrent();
});
document.getElementById('hideMorphChooser')?.addEventListener('change', (e) => {
  state.uiVisibility.hideMorphChooser = !e.target.checked;
  applyHeaderVisibility();
  saveHeaderVisibility();
  capturePlaylistOverridesFromCurrent();
});
document.getElementById('hideProfiles')?.addEventListener('change', (e) => {
  state.uiVisibility.hideProfiles = !e.target.checked;
  applyHeaderVisibility();
  saveHeaderVisibility();
  capturePlaylistOverridesFromCurrent();
});
document.getElementById('btnLibrary').addEventListener('click', () => {
  renderLibrary('projects');
  document.getElementById('libraryModal').classList.remove('hidden');
});
document
  .getElementById('btnLibraryNewProject')
  ?.addEventListener('click', () => document.getElementById('btnNewProject')?.click());
document
  .getElementById('btnLibrarySaveProject')
  ?.addEventListener('click', () => saveCurrentProjectToPlaylist(false, true));
document
  .getElementById('btnCloseLibrary')
  .addEventListener('click', () => document.getElementById('libraryModal').classList.add('hidden'));
document
  .querySelectorAll('.library-tab')
  .forEach((btn) => btn.addEventListener('click', () => renderLibrary(btn.dataset.libraryTab)));
document.getElementById('btnExportPNG').addEventListener('click', () => {
  const boundingR = computeMaxArtworkRadius();
  const padding = 10;
  const cropRadius = Math.ceil(boundingR + padding);
  const cropSize = cropRadius * 2;

  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = cropSize;
  exportCanvas.height = cropSize;
  const expCtx = exportCanvas.getContext('2d');

  expCtx.fillStyle = state.bgColor;
  expCtx.fillRect(0, 0, cropSize, cropSize);
  expCtx.translate(cropRadius, cropRadius);

  state.layers.forEach((layer) => {
    if (!layer.visible) return;

    expCtx.save();
    expCtx.globalAlpha = (layer.opacity !== undefined ? layer.opacity : 100) / 100;
    expCtx.lineWidth = Math.max(
      0.001,
      (Number(layer.strokeWidth) || 1.5) * getLayerStrokeWidthMultiplier(layer),
    );
    expCtx.strokeStyle = layer.strokeColor;
    expCtx.fillStyle = layer.fillColor;

    const exportGlow = Math.max(0, (Number(layer.glow) || 0) * getLayerGlowMultiplier(layer));
    const exportGlowIntensity = Math.max(
      0,
      ((Number.isFinite(Number(layer.glowIntensity)) ? Number(layer.glowIntensity) : 40) / 100) *
        getLayerGlowIntensityMultiplier(layer),
    );
    if (exportGlow > 0 && exportGlowIntensity > 0) {
      expCtx.shadowColor = layer.strokeColor;
      expCtx.shadowBlur = exportGlow;
      expCtx.shadowColor = layer.strokeColor;
    }

    renderLayerOrbitPaths(expCtx, layer);
    const circleCfg = layer.geometryCircles;
    if (circleCfg?.enabled === true) {
      const circlePaths = getCachedLayerDrawData(layer)?.paths || [];
      expCtx.shadowBlur = 0;
      expCtx.fillStyle = 'transparent';
      for (const c of computeLayerGeometryCircles(circlePaths, circleCfg)) {
        if (!(c.r > 0)) continue;
        expCtx.beginPath();
        expCtx.arc(c.x, c.y, c.r, 0, Math.PI * 2);
        expCtx.stroke();
      }
    }

    expCtx.restore();
  });

  const link = document.createElement('a');
  link.download = `somata_art_${Date.now()}.png`;
  link.href = exportCanvas.toDataURL('image/png');
  link.click();
});
function buildLayerSVGPaths(layer) {
  const paths = [];
  const geometry = buildMorphGeometry(layer, 180);
  geometry.forEach((path) => {
    if (!path.points || path.points.length < 2) return;
    const d = [`M ${path.points[0].x} ${path.points[0].y}`];
    for (let i = 1; i < path.points.length; i++) {
      d.push(`L ${path.points[i].x} ${path.points[i].y}`);
    }
    if (path.closed) d.push('Z');
    paths.push(d.join(' '));
  });
  return paths;
}
document.getElementById('btnExportSVG').addEventListener('click', () => {
  const boundingR = Math.ceil(computeMaxArtworkRadius() + 10);
  const layersSvg = [];

  state.layers.forEach((layer) => {
    if (!layer.visible) return;

    const paths = buildLayerSVGPaths(layer);
    if (!paths.length) return;

    const opacity = (layer.opacity !== undefined ? layer.opacity : 100) / 100;
    const fill = layer.fill ? layer.fillColor || 'none' : 'none';
    const stroke = layer.strokeColor || '#ffffff';
    const effectiveGlow = Math.max(0, (Number(layer.glow) || 0) * getLayerGlowMultiplier(layer));
    const effectiveGlowIntensity = Math.max(
      0,
      ((Number.isFinite(Number(layer.glowIntensity)) ? Number(layer.glowIntensity) : 40) / 100) *
        getLayerGlowIntensityMultiplier(layer),
    );
    const glow =
      effectiveGlow > 0 && effectiveGlowIntensity > 0
        ? `<filter id="glow_${layer.id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${Math.max(0.1, effectiveGlow / 2)}" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
        : '';

    const circleCfg = layer.geometryCircles;
    const circleSvg =
      circleCfg?.enabled === true
        ? computeLayerGeometryCircles(getCachedLayerDrawData(layer)?.paths || [], circleCfg)
            .map((c) => `<circle cx="${c.x}" cy="${c.y}" r="${c.r}" fill="none" />`)
            .join('')
        : '';
    layersSvg.push(
      `${glow}<g opacity="${opacity}" fill="${fill}" stroke="${stroke}" stroke-width="${Math.max(0.001, (Number(layer.strokeWidth) || 1.5) * getLayerStrokeWidthMultiplier(layer))}" stroke-linejoin="${layer.lineJoinType === 'rounded' ? 'round' : 'miter'}" ${effectiveGlow > 0 && effectiveGlowIntensity > 0 ? `filter="url(#glow_${layer.id})"` : ''}>` +
        paths.map((d) => `<path d="${d}" />`).join('') +
        circleSvg +
        `</g>`,
    );
  });

  const svgStr = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-${boundingR} -${boundingR} ${boundingR * 2} ${boundingR * 2}" width="${boundingR * 2}" height="${boundingR * 2}" style="background:${state.bgColor};">\n${layersSvg.join('\n')}\n</svg>`;

  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `somata_vector_${Date.now()}.svg`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
});
function showShortcutToast(message) {
  const el = document.getElementById('shortcutToast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showShortcutToast._timer);
  showShortcutToast._timer = setTimeout(() => el.classList.remove('show'), 850);
}

export { applyHeaderVisibility, showShortcutToast };
