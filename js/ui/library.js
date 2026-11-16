// Библиотека фигур и проектов, сброс к стартовым значениям.
import '../project/project-loader.js'; // initialisation order: this module runs after it
import { renderProfileEditor } from './profile-editor.js';
import {
  audioMasterRouteRuntime,
  ensureAudioRoutingState,
  setAudioMasterRouteStateRef,
} from '../audio/audio-routing.js';
import { renderAudioRoutingPanel } from './audio-routing-panel.js';
import { createLayerId } from '../core/defaults-layers.js';
import {
  ensurePlaylistColorPalettes,
  normalizePlaylistColorPalettes,
  normalizePlaylistHueOffset,
} from '../core/palette.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { STATE_RUNTIME_FIELDS, state } from '../core/state.js';
import { renderMainCanvas } from '../render/main-pipeline.js';
import { updateLayerListUI } from './layer-selection.js';
import { syncSidebarInputs } from './sidebar-sync.js';
import { activeStopMorphing } from '../morph-runtime/morph-hooks.js';
import { renderPlaylistPaletteButtons } from './playlist-palettes.js';
import {
  applyPlaylistOverrides,
  buildProjectData,
  captureMenuSettings,
  cloneData,
  defaultPlaylistProjectName,
  uniquePlaylistProjectName,
} from '../project/project-data.js';
import { syncProjectMorphUI } from '../project/project-morph.js';
import { loadPlaylistProjectByIndex, renderProjectChooser, saveProjectToDisk } from '../project/playlist.js';
import { showShortcutToast } from './header-and-export.js';
import { syncAudioSettingsUIFromState } from '../audio/audio-reactive.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

let libraryTab = 'projects';
function escapeLibraryName(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}
function uniqueShapeLibraryName(name, ignoreId = null) {
  const items = state.library?.shapes || [],
    base = String(name || 'Фигура').trim() || 'Фигура';
  const used = new Set(
    items
      .filter((x) => !ignoreId || x.id !== ignoreId)
      .map((x) =>
        String(x?.name || '')
          .trim()
          .toLocaleLowerCase('ru-RU'),
      ),
  );
  if (!used.has(base.toLocaleLowerCase('ru-RU'))) return base;
  let n = 2,
    c = `${base} (${n})`;
  while (used.has(c.toLocaleLowerCase('ru-RU'))) {
    n++;
    c = `${base} (${n})`;
  }
  return c;
}
function renamePlaylistProjectByIndex(index) {
  const entry = state.playlistProjects?.[index];
  if (!entry) return false;
  const entered = prompt('Новое название проекта:', entry.name || defaultPlaylistProjectName(index));
  if (entered === null) return false;
  const next = uniquePlaylistProjectName(String(entered).trim() || entry.name, entry.id);
  entry.name = next;
  entry.updatedAt = new Date().toISOString();
  if (entry.id === state.playlistCurrentProjectId) state.draftProjectName = next;
  renderProjectChooser();
  renderLibrary('projects');
  saveProjectToDisk(false);
  return true;
}
function renameDraftProject() {
  const current = String(state.draftProjectName || 'Проект один').trim() || 'Проект один';
  const entered = prompt('Новое название проекта:', current);
  if (entered === null) return false;
  state.draftProjectName = uniquePlaylistProjectName(String(entered).trim() || current);
  renderProjectChooser();
  return true;
}
function duplicatePlaylistProjectByIndex(index) {
  const entry = state.playlistProjects?.[index];
  if (!entry) return false;
  const suggested = uniquePlaylistProjectName(`${entry.name || defaultPlaylistProjectName(index)} копия`);
  const entered = prompt('Сохранить копию проекта как:', suggested);
  if (entered === null) return false;
  const name = uniquePlaylistProjectName(String(entered).trim() || suggested);
  const copy = {
    id: createLayerId('project'),
    name,
    updatedAt: new Date().toISOString(),
    project: cloneData(entry.project),
  };
  state.playlistProjects.splice(index + 1, 0, copy);
  renderProjectChooser();
  renderLibrary('projects');
  showShortcutToast(`Создана копия: ${name}`);
  return true;
}
function deletePlaylistProjectByIndex(index) {
  const entry = state.playlistProjects?.[index];
  if (!entry) return false;
  if (!confirm(`Удалить проект «${entry.name}» из плейлиста?`)) return false;
  const wasCurrent = entry.id === state.playlistCurrentProjectId;
  state.playlistProjects.splice(index, 1);
  if (wasCurrent) {
    state.playlistCurrentProjectId = null;
    state.draftProjectName = 'Проект один';
  }
  renderProjectChooser();
  renderLibrary('projects');
  showShortcutToast('Проект удалён из плейлиста (плейлист не сохранён на диск)');
  return true;
}
function renameShapeLibraryItem(item) {
  if (!item) return false;
  const entered = prompt('Новое название фигуры:', item.name || 'Фигура');
  if (entered === null) return false;
  item.name = uniqueShapeLibraryName(String(entered).trim() || item.name, item.id);
  renderLibrary('shapes');
  saveProjectToDisk(false);
  return true;
}
function duplicateShapeLibraryItem(item) {
  if (!item) return false;
  const suggested = uniqueShapeLibraryName(`${item.name || 'Фигура'} копия`);
  const entered = prompt('Сохранить копию фигуры как:', suggested);
  if (entered === null) return false;
  const copy = cloneData(item);
  copy.id = createLayerId('shape');
  copy.name = uniqueShapeLibraryName(String(entered).trim() || suggested);
  copy.createdAt = new Date().toISOString();
  state.library.shapes.push(copy);
  renderLibrary('shapes');
  saveProjectToDisk(false);
  return true;
}
function deleteShapeLibraryItem(item) {
  if (!item) return false;
  if (!confirm(`Удалить фигуру «${item.name}»?`)) return false;
  const arr = state.library?.shapes || [],
    idx = arr.findIndex((x) => x.id === item.id);
  if (idx >= 0) arr.splice(idx, 1);
  renderLibrary('shapes');
  saveProjectToDisk(false);
  return true;
}
function makeLibraryAction(label, fn, disabled = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.textContent = label;
  b.disabled = disabled;
  b.addEventListener('click', fn);
  return b;
}
function renderLibrary(tab = libraryTab) {
  if (tab !== 'projects' && tab !== 'shapes') tab = 'projects';
  libraryTab = tab;
  document
    .querySelectorAll('.library-tab')
    .forEach((b) => b.classList.toggle('active', b.dataset.libraryTab === tab));
  const list = document.getElementById('libraryList');
  if (!list) return;
  list.innerHTML = '';
  if (tab === 'projects') {
    const entries = Array.isArray(state.playlistProjects) ? state.playlistProjects : [];
    if (!entries.length) {
      list.innerHTML =
        '<div class="hint-text" style="padding:14px;">В текущем плейлисте пока нет сохранённых проектов. Текущий несохранённый проект отображается сверху как «Проект один».</div>';
      return;
    }
    entries.forEach((entry, index) => {
      const row = document.createElement('div');
      row.className = 'library-item';
      const active = entry.id === state.playlistCurrentProjectId;
      row.innerHTML = `<span class="library-name">${escapeLibraryName(entry.name)}</span><small>${active ? 'текущий проект' : 'проект'}</small>`;
      const actions = document.createElement('span');
      actions.className = 'library-actions';
      actions.append(
        makeLibraryAction('Переименовать', () => renamePlaylistProjectByIndex(index)),
        makeLibraryAction('Удалить', () => deletePlaylistProjectByIndex(index)),
        makeLibraryAction('Сохранить как', () => duplicatePlaylistProjectByIndex(index)),
        makeLibraryAction(
          active ? 'Открыт' : 'Открыть',
          () => {
            loadPlaylistProjectByIndex(index);
            document.getElementById('libraryModal')?.classList.add('hidden');
          },
          active,
        ),
      );
      row.append(actions);
      list.appendChild(row);
    });
    return;
  }
  const items = state.library?.shapes || [];
  if (!items.length) {
    list.innerHTML = '<div class="hint-text" style="padding:14px;">Пока ничего не сохранено.</div>';
    return;
  }
  items.forEach((item) => {
    const row = document.createElement('div');
    row.className = 'library-item';
    row.innerHTML = `<span class="library-name">${escapeLibraryName(item.name)}</span><small>${item.layers?.length || 0} сл.</small>`;
    const actions = document.createElement('span');
    actions.className = 'library-actions';
    actions.append(
      makeLibraryAction('Переименовать', () => renameShapeLibraryItem(item)),
      makeLibraryAction('Удалить', () => deleteShapeLibraryItem(item)),
      makeLibraryAction('Сохранить как', () => duplicateShapeLibraryItem(item)),
      makeLibraryAction('Открыть', () => loadSavedLibraryItem(item, 'shapes')),
    );
    row.append(actions);
    list.appendChild(row);
  });
}
function loadSavedLibraryItem(item, tab) {
  if (item.layers?.length) {
    activeStopMorphing();
    state.layers = cloneData(item.layers);
    for (const layer of state.layers) if (layer) layer.roundingShape = 'hybrid';
    state.activeLayerId = state.layers[0].id;
    updateLayerListUI();
    syncSidebarInputs();
    renderProfileEditor();
    renderMainCanvas();
  }
  document.getElementById('libraryModal')?.classList.add('hidden');
}
function captureSerializableConfigSection(sectionName, excludedKeys = []) {
  const src = state?.[sectionName];
  if (!src || typeof src !== 'object') return {};
  const excluded = new Set([...(STATE_RUNTIME_FIELDS?.[sectionName] || []), ...excludedKeys]);
  const out = {};
  for (const [key, value] of Object.entries(src)) {
    if (excluded.has(key)) continue;
    try {
      out[key] = cloneData(value);
    } catch (error) {
      noteSuppressedError('ui/library#captureSerializableConfigSection', error);
    }
  }
  return out;
}
function restoreSerializableConfigSection(sectionName, snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !state?.[sectionName]) return;
  for (const [key, value] of Object.entries(snapshot)) {
    try {
      state[sectionName][key] = cloneData(value);
    } catch (_) {
      state[sectionName][key] = value;
    }
  }
}
function resetCurrentProjectToStartupDefaults() {
  if (
    !confirm(
      'Сбросить настройки текущего проекта к состоянию при запуске программы? Настройки источника микрофона и глобальные настройки плейлиста останутся без изменений. Связи микрофона будут сброшены.',
    )
  )
    return;

  const keep = {
    playlistProjects: state.playlistProjects,
    playlistCurrentProjectId: state.playlistCurrentProjectId,
    playlistFileHandle: state.playlistFileHandle,
    playlistFileName: state.playlistFileName,
    playlistMenuSettings: cloneData(state.playlistMenuSettings || captureMenuSettings()),
    playlistBpm: Math.max(0, Number(state.playlistBpm ?? state.tapTempo?.bpm) || 0),
    playlistTapTempo: cloneData(
      state.playlistTapTempo || {
        autoTap: state.tapTempo?.autoTap === true,
        autoWindowSec: state.tapTempo?.autoWindowSec || 10,
        autoBand: state.tapTempo?.autoBand || 'low',
      },
    ),
    playlistDefaultSettings:
      state.playlistDefaultSettings && typeof state.playlistDefaultSettings === 'object'
        ? cloneData(state.playlistDefaultSettings)
        : null,
    playlistColorPalettes: cloneData(ensurePlaylistColorPalettes()),
    playlistPaletteHueOffset: normalizePlaylistHueOffset(state.playlistPaletteHueOffset),
    playlistOverridesActive: state.playlistOverridesActive === true,
    projectFileHandle: state.projectFileHandle,
    projectFileName: state.projectFileName,
    draftProjectName: state.draftProjectName,
    projectMorph: captureSerializableConfigSection('projectMorph'),
  };

  const audioSourceSettings = captureSerializableConfigSection('audioReactive', [
    'routingInitialized',
    'routingTarget',
    'routingPreset',
    'masterRouteMultipliers',
    'groupToggleMemory',
    'layerSignalEnabled',
    'routes',
    'defaultRoutesEnabled',
  ]);

  document.getElementById('btnNew')?.click();

  state.playlistProjects = keep.playlistProjects;
  state.playlistCurrentProjectId = keep.playlistCurrentProjectId;
  state.playlistFileHandle = keep.playlistFileHandle;
  state.playlistFileName = keep.playlistFileName;
  state.playlistMenuSettings = keep.playlistMenuSettings;
  state.playlistBpm = keep.playlistBpm;
  state.playlistTapTempo = keep.playlistTapTempo;
  state.playlistDefaultSettings = keep.playlistDefaultSettings;
  state.playlistColorPalettes = normalizePlaylistColorPalettes(keep.playlistColorPalettes);
  state.playlistPaletteHueOffset = normalizePlaylistHueOffset(keep.playlistPaletteHueOffset);
  state.playlistOverridesActive = keep.playlistOverridesActive;
  state.projectFileHandle = keep.projectFileHandle;
  state.projectFileName = keep.projectFileName;
  state.draftProjectName = keep.draftProjectName;
  restoreSerializableConfigSection('projectMorph', keep.projectMorph);
  restoreSerializableConfigSection('audioReactive', audioSourceSettings);

  state.audioReactive.routingInitialized = false;
  state.audioReactive.routingTarget = 'master';
  state.audioReactive.masterEditEnabled = false;
  state.audioReactive.routingPreset = 'geometryLamps';
  state.audioReactive.defaultRoutesEnabled = true;
  state.audioReactive.masterRouteMultipliers = {};
  state.audioReactive.groupToggleMemory = {};
  state.audioReactive.layerSignalEnabled = {};
  state.audioReactive.routes = { master: [], layers: {} };
  setAudioMasterRouteStateRef(null);
  audioMasterRouteRuntime.clear();
  ensureAudioRoutingState();

  renderPlaylistPaletteButtons();
  applyPlaylistOverrides();
  renderProjectChooser();
  renderLibrary('projects');
  syncProjectMorphUI();
  syncAudioSettingsUIFromState?.();
  renderAudioRoutingPanel?.();
  syncSidebarInputs();
  requestMainCanvasRender();
  showShortcutToast('Проект сброшен · источник микрофона и плейлист сохранены');
}
async function saveCurrentProjectFile() {
  try {
    if (state.projectFileHandle?.createWritable) {
      const writable = await state.projectFileHandle.createWritable();
      await writable.write(JSON.stringify(buildProjectData(), null, 2));
      await writable.close();
      showShortcutToast('Проект сохранён');
      return;
    }
    await saveProjectToDisk(true);
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('Project save failed', err);
      alert('Не удалось сохранить проект: ' + (err?.message || 'ошибка записи'));
    }
  }
}

export {
  renameDraftProject,
  renamePlaylistProjectByIndex,
  renderLibrary,
  resetCurrentProjectToStartupDefaults,
  saveCurrentProjectFile,
  uniqueShapeLibraryName,
};
