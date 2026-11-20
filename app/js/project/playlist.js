// Плейлист: выбор проекта, сохранение, открытие, default.plist, экспорт/импорт.
import './project-morph.js'; // initialisation order: this module runs after it
import { renderProfileEditor } from '../ui/profile-editor.js';
import { createLayerId } from '../core/defaults-layers.js';
import { normalizePlaylistColorPalettes, normalizePlaylistHueOffset } from '../core/palette.js';
import { animationScheduler, requestMainCanvasRender } from '../core/scheduler.js';
import { runtimeState, state } from '../core/state.js';
import { somataRootFileUrl } from '../app/app-paths.js';
import { setTunnelMode } from '../ui/corridor-panel.js';
import { updateLayerListUI } from '../ui/layer-selection.js';
import { syncSidebarInputs } from '../ui/sidebar-sync.js';
import { activeStopMinimalMorphing, activeStopMorphing } from '../morph-runtime/morph-hooks.js';
import { renderPlaylistPaletteButtons, syncActiveProjectPaletteIndicator } from '../ui/playlist-palettes.js';
import { syncRandomSettingsUI } from '../ui/orange-morph/routing-ui.js';
import { syncMorphSettingsUI } from '../ui/morph-settings-panel.js';
import {
  PLAYLIST_FORMAT,
  applyPlaylistOverrides,
  buildPlaylistData,
  buildProjectData,
  captureMenuSettings,
  capturePlaylistOverridesFromCurrent,
  cloneData,
  cloneProjectDataFast,
  currentPlaylistSuggestedFileName,
  defaultPlaylistProjectName,
  getCurrentPlaylistProjectIndex,
  isCompactMobileViewport,
  isSpiroProjectData,
  mergePersistentProjectSection,
  normalizeMenuSettings,
  normalizePlaylistProjectEntry,
  normalizePlaylistProjectNames,
  projectMenuSettingsFromProject,
  sanitizeProjectFileBase,
  uniquePlaylistProjectName,
} from './project-data.js';
import {
  normalizeProjectMorphSettings,
  schedulePlaylistGpuWarmup,
  stopProjectMorphing,
  syncOrangeAndBlueForProject,
  syncProjectMorphUI,
} from './project-morph.js';
import { applyLoadedProject } from './project-loader.js';
import { renderLibrary } from '../ui/library.js';
import { showShortcutToast } from '../ui/header-and-export.js';
import { syncAudioSettingsUIFromState } from '../audio/audio-reactive.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

function toggleProjectMorphSettingsPanel(forceOpen) {
  const panel = document.getElementById('projectMorphSettingsPanel'),
    btn = document.getElementById('btnProjectMorphSettings');
  if (!panel) return;
  const open = typeof forceOpen === 'boolean' ? forceOpen : panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !open);
  if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) syncProjectMorphUI();
}
function renderProjectChooser() {
  const select = document.getElementById('projectSelect');
  if (!select) return;
  const entries = Array.isArray(state.playlistProjects) ? state.playlistProjects : [];
  select.innerHTML = '';
  if (!entries.length || !state.playlistCurrentProjectId) {
    const unnamed = document.createElement('option');
    unnamed.value = '';
    unnamed.textContent = state.draftProjectName || 'Проект один';
    select.appendChild(unnamed);
    select.value = '';
    select.classList.add('project-folder-empty');
  }
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = entry.name || `Проект ${i + 1}`;
    select.appendChild(o);
  }
  const currentIndex = getCurrentPlaylistProjectIndex();
  if (currentIndex >= 0) {
    select.value = String(currentIndex);
    select.classList.remove('project-folder-empty');
  }
  select.disabled = false;
  const titleBtn = document.getElementById('projectNameButton'),
    titleText = document.getElementById('projectNameButtonText'),
    drop = document.getElementById('projectNameDropdown');
  const shownName =
    currentIndex >= 0
      ? entries[currentIndex]?.name || `Проект ${currentIndex + 1}`
      : state.draftProjectName || 'Проект один';
  if (titleText) titleText.textContent = shownName;
  if (titleBtn) {
    titleBtn.classList.toggle('project-folder-empty', currentIndex < 0);
    titleBtn.title = `${shownName} · ЛКМ — список проектов; ПКМ — переименовать`;
  }
  if (drop) {
    drop.innerHTML = '';
    if (entries.length) {
      entries.forEach((entry, i) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = entry.name || `Проект ${i + 1}`;
        b.classList.toggle('active', i === currentIndex);
        b.dataset.projectIndex = String(i);
        b.addEventListener('click', () => {
          hideProjectNameMenus();
          loadPlaylistProjectByIndex(i);
        });
        b.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          showProjectRenameContext(e.clientX, e.clientY, i);
        });
        drop.appendChild(b);
      });
    } else {
      const empty = document.createElement('div');
      empty.className = 'hint-text';
      empty.style.padding = '7px 9px';
      empty.textContent = shownName;
      drop.appendChild(empty);
    }
  }
  const navDisabled = entries.length === 0;
  const prev = document.getElementById('btnPrevProject'),
    next = document.getElementById('btnNextProject');
  if (prev) prev.disabled = navDisabled;
  if (next) next.disabled = navDisabled;
  const del = document.getElementById('btnDeletePlaylistProject');
  if (del) del.disabled = currentIndex < 0;
  const panel = document.getElementById('projectChooserPanel');
  if (panel)
    panel.title = `Плейлист: ${state.playlistFileName || 'не сохранён'} · ${entries.length} проект(ов)`;
  syncProjectMorphUI();
}
let projectContextIndex = -1;
function hideProjectNameMenus() {
  const drop = document.getElementById('projectNameDropdown'),
    ctx = document.getElementById('projectNameContextMenu'),
    btn = document.getElementById('projectNameButton');
  drop?.classList.add('hidden');
  ctx?.classList.add('hidden');
  btn?.setAttribute('aria-expanded', 'false');
  projectContextIndex = -1;
}
function positionCompactMenu(menu, x, y) {
  if (!menu) return;
  menu.classList.remove('hidden');
  menu.style.visibility = 'hidden';
  const vw = Math.max(document.documentElement.clientWidth || 0, window.innerWidth || 0),
    vh = Math.max(document.documentElement.clientHeight || 0, window.innerHeight || 0),
    m = 8;
  const r = menu.getBoundingClientRect();
  menu.style.left = `${Math.max(m, Math.min(vw - r.width - m, x))}px`;
  menu.style.top = `${Math.max(m, Math.min(vh - r.height - m, y))}px`;
  menu.style.visibility = '';
}
function showProjectRenameContext(x, y, index = getCurrentPlaylistProjectIndex()) {
  const entries = state.playlistProjects || [];
  if (index >= 0 && !entries[index]) return;
  projectContextIndex = index >= 0 ? index : -1;
  positionCompactMenu(document.getElementById('projectNameContextMenu'), x, y);
}
function toggleProjectNameDropdown() {
  const menu = document.getElementById('projectNameDropdown'),
    btn = document.getElementById('projectNameButton');
  if (!menu || !btn) return;
  const open = menu.classList.contains('hidden');
  hideProjectNameMenus();
  if (!open) return;
  const r = btn.getBoundingClientRect();
  positionCompactMenu(menu, r.left, r.bottom + 4);
  btn.setAttribute('aria-expanded', 'true');
}
function syncAfterProjectLoad() {
  state.layerIsolation = null;
  if (!state.layers.some((layer) => layer?.id === state.activeLayerId))
    state.activeLayerId = state.layers[0]?.id || null;
  updateLayerListUI();
  syncSidebarInputs();
  syncMorphSettingsUI();
  syncRandomSettingsUI();
  try {
    syncActiveProjectPaletteIndicator();
  } catch (error) {
    noteSuppressedError('project/playlist#syncAfterProjectLoad', error);
  }
  syncAudioSettingsUIFromState();
  renderProfileEditor();

  requestMainCanvasRender();
  renderProjectChooser();
}
async function writePlaylistHandle(handle, json) {
  const writable = await handle.createWritable();
  await writable.write(json);
  await writable.close();
}
async function saveBlobToDevice(blob, filename, title = 'Somata') {
  if (isCompactMobileViewport() && typeof File === 'function' && typeof navigator?.share === 'function') {
    try {
      const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
      const payload = { files: [file], title };
      if (typeof navigator.canShare !== 'function' || navigator.canShare(payload)) {
        await navigator.share(payload);
        return true;
      }
    } catch (err) {
      if (err?.name === 'AbortError') return false;
      console.warn('Native mobile save/share failed; falling back to download', err);
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();

  setTimeout(() => {
    try {
      a.remove();
    } catch (error) {
      noteSuppressedError('project/playlist#saveBlobToDevice', error);
    }
    try {
      URL.revokeObjectURL(url);
    } catch (error) {
      noteSuppressedError('project/playlist#saveBlobToDevice', error);
    }
  }, 30000);
  return true;
}
function snapshotCurrentProjectIntoPlaylist() {
  const idx = getCurrentPlaylistProjectIndex();
  if (idx < 0) return false;
  const entry = state.playlistProjects?.[idx];
  if (!entry) return false;
  entry.project = buildProjectData();
  entry.updatedAt = new Date().toISOString();
  return true;
}
async function savePlaylistToDisk(forcePicker = false) {
  try {
    const currentProjectSnapshotted = snapshotCurrentProjectIntoPlaylist();
    if (state.playlistOverridesActive) capturePlaylistOverridesFromCurrent();
    const json = JSON.stringify(buildPlaylistData(), null, 2);
    if (window.showSaveFilePicker && (forcePicker || !state.playlistFileHandle)) {
      state.playlistFileHandle = await window.showSaveFilePicker({
        suggestedName: currentPlaylistSuggestedFileName(),
        types: [{ description: 'Somata playlist', accept: { 'application/json': ['.plist'] } }],
      });
      state.playlistFileName = state.playlistFileHandle?.name || currentPlaylistSuggestedFileName();
    }
    if (state.playlistFileHandle) {
      await writePlaylistHandle(state.playlistFileHandle, json);
      renderProjectChooser();
      showShortcutToast(
        currentProjectSnapshotted
          ? `Плейлист сохранён · текущий проект обновлён`
          : `Плейлист сохранён: ${state.playlistFileName}`,
      );
      return true;
    }
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const filename = currentPlaylistSuggestedFileName();
    const saved = await saveBlobToDevice(blob, filename, 'Somata playlist');
    if (!saved) return false;
    state.playlistFileName = filename;
    renderProjectChooser();
    showShortcutToast(
      currentProjectSnapshotted
        ? `Плейлист сохранён · текущий проект обновлён`
        : `Плейлист сохранён: ${filename}`,
    );
    return true;
  } catch (err) {
    if (err?.name === 'AbortError') return false;
    console.error('Playlist save failed', err);
    alert('Не удалось сохранить плейлист: ' + (err?.message || 'ошибка записи'));
    return false;
  }
}
function quiesceProjectRuntimeForCommit() {
  try {
    if (runtimeState.minimalMorph?.active) activeStopMinimalMorphing(false);
  } catch (error) {
    noteSuppressedError('project/playlist#quiesceProjectRuntimeForCommit', error);
  }
  try {
    if (runtimeState.morph?.active) activeStopMorphing(false);
  } catch (error) {
    noteSuppressedError('project/playlist#quiesceProjectRuntimeForCommit', error);
  }
  try {
    if (state.tunnel?.active === true || animationScheduler.has('tunnel'))
      setTunnelMode(false, { silent: true });
  } catch (error) {
    noteSuppressedError('project/playlist#quiesceProjectRuntimeForCommit', error);
  }
}
async function loadPlaylistProjectByIndex(index, fromProjectMorph = false) {
  if (!fromProjectMorph) stopProjectMorphing(false);
  const entries = state.playlistProjects || [];
  if (!entries.length) return;
  const i = Math.max(0, Math.min(entries.length - 1, Number(index) || 0));
  const entry = entries[i];
  try {
    quiesceProjectRuntimeForCommit();
    state.playlistOverridesActive = true;
    state.suppressPlaylistOverrideCapture = true;
    try {
      applyLoadedProject(cloneProjectDataFast(entry.project), {
        preserveFullMorph: false,
        preserveMinimalMorph: false,
        suppressMinimalAutoStart: true,
        applyProjectDefaultModes: false,
      });
    } finally {
      state.suppressPlaylistOverrideCapture = false;
    }
    applyPlaylistOverrides();
    state.playlistCurrentProjectId = entry.id;
    state.draftProjectName = entry.name || defaultPlaylistProjectName(i);
    state.projectFileHandle = null;
    state.projectFileName = '';
    syncAfterProjectLoad();
    syncOrangeAndBlueForProject(entry.project);
    showShortcutToast(`Проект: ${entry.name}`);
  } catch (err) {
    console.error('Playlist project load failed', err);
    alert(`Не удалось открыть проект «${entry.name}».`);
  }
}
function stepProjectChooser(delta) {
  const entries = state.playlistProjects || [];
  if (!entries.length) return;
  let i = getCurrentPlaylistProjectIndex();
  if (i < 0) i = delta > 0 ? -1 : 0;
  i = (i + delta + entries.length) % entries.length;
  loadPlaylistProjectByIndex(i);
}
async function saveCurrentProjectToPlaylist(asNew = false, writeToDisk = false) {
  stopProjectMorphing(false);
  const project = buildProjectData();
  let idx = getCurrentPlaylistProjectIndex();
  if (asNew || idx < 0) {
    const proposed = asNew
      ? defaultPlaylistProjectName(state.playlistProjects?.length || 0)
      : state.draftProjectName || 'Проект один';
    let name = proposed;
    if (asNew) {
      const entered = prompt('Название проекта в плейлисте:', proposed);
      if (entered === null) return false;
      name = String(entered).trim() || proposed;
    }
    name = uniquePlaylistProjectName(name);
    const record = { id: createLayerId('project'), name, updatedAt: new Date().toISOString(), project };
    state.playlistProjects.push(record);
    state.playlistCurrentProjectId = record.id;
    idx = state.playlistProjects.length - 1;
    state.draftProjectName = name;
  } else {
    state.playlistProjects[idx].project = project;
    state.playlistProjects[idx].updatedAt = new Date().toISOString();
    state.draftProjectName = state.playlistProjects[idx].name || state.draftProjectName || 'Проект один';
  }
  state.playlistOverridesActive = true;
  if (!state.playlistMenuSettings) {
    state.playlistMenuSettings = captureMenuSettings();
    state.playlistBpm = Math.max(0, Number(state.tapTempo?.bpm) || 0);
  }
  applyPlaylistOverrides();
  renderProjectChooser();
  if (writeToDisk) {
    const ok = await savePlaylistToDisk(false);
    if (ok) showShortcutToast(asNew ? 'Проект добавлен и плейлист сохранён' : 'Проект и плейлист сохранены');
    return ok;
  }
  showShortcutToast(
    asNew
      ? 'Проект добавлен в плейлист (не сохранён на диск)'
      : 'Проект обновлён в плейлисте (не сохранён на диск)',
  );
  return true;
}
function choosePlaylistProjectSaveMode() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:10000;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;padding:18px';
    const card = document.createElement('div');
    card.style.cssText =
      'width:min(360px,calc(100vw - 36px));background:#0f172a;border:1px solid #475569;border-radius:10px;padding:14px;box-shadow:0 20px 55px rgba(0,0,0,.6)';
    const title = document.createElement('div');
    title.textContent = 'Сохранить проект';
    title.style.cssText = 'font-weight:700;margin-bottom:10px;color:#f8fafc';
    const note = document.createElement('div');
    note.textContent = 'Выберите, как сохранить текущее состояние в плейлист.';
    note.style.cssText = 'font-size:11px;color:#94a3b8;margin-bottom:12px';
    const buttons = document.createElement('div');
    buttons.style.cssText = 'display:grid;gap:7px';
    const finish = (value) => {
      overlay.remove();
      resolve(value);
    };
    const add = (label, value, disabled = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.disabled = disabled;
      b.style.justifyContent = 'center';
      b.addEventListener('click', () => finish(value));
      buttons.appendChild(b);
    };
    add('Сохранить как новый проект', 'new');
    add('Переписать текущий проект', 'overwrite', getCurrentPlaylistProjectIndex() < 0);
    add('Отмена', null);
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(null);
    });
    card.append(title, note, buttons);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
  });
}
async function handlePlaylistPlusSave() {
  const mode = await choosePlaylistProjectSaveMode();
  if (!mode) return;
  if (mode === 'new') await saveCurrentProjectToPlaylist(true, false);
  else if (mode === 'overwrite') await saveCurrentProjectToPlaylist(false, false);
}
async function deleteCurrentPlaylistProject() {
  stopProjectMorphing(false);
  const idx = getCurrentPlaylistProjectIndex();
  if (idx < 0) return;
  const removed = state.playlistProjects[idx];
  if (!confirm(`Удалить проект «${removed.name}» из плейлиста?`)) return;
  state.playlistProjects.splice(idx, 1);
  state.playlistCurrentProjectId = null;
  state.draftProjectName = 'Проект один';
  renderProjectChooser();
  showShortcutToast('Проект удалён из плейлиста (плейлист не сохранён на диск)');
}
async function loadPlaylistDocument(parsed, fileName = '', handle = null) {
  const raw = Array.isArray(parsed?.projects) ? parsed.projects : [];
  const projects = normalizePlaylistProjectNames(raw.map(normalizePlaylistProjectEntry).filter(Boolean));
  if (parsed?.format !== PLAYLIST_FORMAT && !Array.isArray(parsed?.projects))
    throw new Error('Файл не содержит плейлист Somata');
  stopProjectMorphing(false);
  state.playlistProjects = projects;
  state.playlistFileHandle = handle;
  state.playlistFileName = fileName || handle?.name || '';
  state.playlistOverridesActive = true;
  state.playlistDefaultSettings =
    parsed?.defaultSettings && typeof parsed.defaultSettings === 'object'
      ? cloneData(parsed.defaultSettings)
      : null;
  state.playlistColorPalettes = normalizePlaylistColorPalettes(parsed?.colorPalettes);
  state.playlistPaletteHueOffset = normalizePlaylistHueOffset(parsed?.paletteHueOffset);
  renderPlaylistPaletteButtons();
  const firstPlaylistProject = projects[0]?.project || null;
  state.playlistMenuSettings =
    parsed?.menuSettings && typeof parsed.menuSettings === 'object'
      ? normalizeMenuSettings(parsed.menuSettings)
      : projectMenuSettingsFromProject(firstPlaylistProject);
  const legacyPlaylistBpm = firstPlaylistProject?.settings?.tapTempo?.bpm;
  state.playlistBpm = Number.isFinite(Number(parsed?.tapTempo?.bpm))
    ? Math.max(0, Math.min(300, Number(parsed.tapTempo.bpm)))
    : Number.isFinite(Number(legacyPlaylistBpm))
      ? Math.max(0, Math.min(300, Number(legacyPlaylistBpm)))
      : Math.max(0, Number(state.tapTempo?.bpm) || 0);
  const legacyTap = firstPlaylistProject?.settings?.tapTempo || {};
  state.playlistTapTempo = {
    autoTap:
      typeof parsed?.tapTempo?.autoTap === 'boolean' ? parsed.tapTempo.autoTap : legacyTap.autoTap === true,
    autoWindowSec: Number.isFinite(Number(parsed?.tapTempo?.autoWindowSec))
      ? Math.max(1, Number(parsed.tapTempo.autoWindowSec))
      : Number.isFinite(Number(legacyTap.autoWindowSec))
        ? Math.max(1, Number(legacyTap.autoWindowSec))
        : 10,
    autoBand: ['low', 'lowMid', 'mid', 'midHigh', 'high', 'combined'].includes(parsed?.tapTempo?.autoBand)
      ? parsed.tapTempo.autoBand
      : ['low', 'lowMid', 'mid', 'midHigh', 'high', 'combined'].includes(legacyTap.autoBand)
        ? legacyTap.autoBand
        : 'low',
  };
  {
    mergePersistentProjectSection('projectMorph', parsed?.projectMorph);
    const loadedPm = normalizeProjectMorphSettings(parsed?.projectMorph);
    if (state.playlistBpm > 0) loadedPm.syncTap = true;
  }
  schedulePlaylistGpuWarmup();
  state.draftProjectName = 'Проект один';
  const requested = String(parsed?.currentProjectId || '');
  state.playlistCurrentProjectId = projects.some((p) => p.id === requested)
    ? requested
    : projects[0]?.id || null;
  if (projects.length) await loadPlaylistProjectByIndex(Math.max(0, getCurrentPlaylistProjectIndex()));
  else {
    applyPlaylistOverrides();
    renderProjectChooser();
  }
  showShortcutToast(`Плейлист: ${state.playlistFileName}`);
}
async function openPlaylist() {
  try {
    let file,
      handle = null;
    if (window.showOpenFilePicker) {
      [handle] = await window.showOpenFilePicker({
        types: [{ description: 'Somata playlist', accept: { 'application/json': ['.plist', '.json'] } }],
        multiple: false,
      });
      if (!handle) return;
      file = await handle.getFile();
    } else {
      document.getElementById('fileInputPlaylist')?.click();
      return;
    }
    const parsed = JSON.parse(await file.text());
    await loadPlaylistDocument(parsed, file.name || handle?.name || '', handle);
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('Playlist open failed', err);
      alert('Не удалось открыть плейлист: ' + (err?.message || 'ошибка чтения'));
    }
  }
}
async function readTextFromRelativeFile(relativeName) {
  const url = somataRootFileUrl(relativeName);
  let response;
  try {
    response = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { Accept: 'application/json,text/plain;q=0.9,*/*;q=0.1' },
    });
  } catch (err) {
    const reason = err?.message || String(err || 'network error');
    const wrapped = new Error(`FETCH failed for ${url}: ${reason}`);
    wrapped.somataDiagnostic = { kind: 'fetch', url, reason };
    throw wrapped;
  }
  const responseUrl = response.url || url;
  const contentType = String(response.headers?.get?.('content-type') || '').trim();
  if (!response.ok) {
    const statusText = String(response.statusText || '').trim();
    const wrapped = new Error(
      `HTTP ${response.status}${statusText ? ' ' + statusText : ''} при загрузке ${responseUrl}`,
    );
    wrapped.somataDiagnostic = {
      kind: 'http',
      url: responseUrl,
      status: response.status,
      statusText,
      contentType,
    };
    throw wrapped;
  }
  try {
    const text = await response.text();
    return { text, url: responseUrl, status: response.status, contentType };
  } catch (err) {
    const wrapped = new Error(`Не удалось прочитать ответ ${responseUrl}: ${err?.message || err}`);
    wrapped.somataDiagnostic = { kind: 'read', url: responseUrl, status: response.status, contentType };
    throw wrapped;
  }
}
async function openDefaultPlaylist() {
  const requestedUrl = somataRootFileUrl('default.plist');
  let stage = 'download';
  let text = '';
  let responseMeta = null;
  try {
    responseMeta = await readTextFromRelativeFile('default.plist');
    text = String(responseMeta?.text ?? '').replace(/^\uFEFF/, '');
    if (!text.trim()) throw new Error('Файл default.plist пуст');
    stage = 'parse';
    const trimmed = text.trimStart();
    if (/^<!doctype\s+html|^<html[\s>]/i.test(trimmed)) {
      throw new Error(
        'Сервер вернул HTML вместо default.plist. Проверьте, что default.plist действительно загружен рядом с index.html и сервер не подменяет отсутствующие файлы страницей index.html.',
      );
    }
    if (/^<\?xml|^<plist[\s>]/i.test(trimmed)) {
      throw new Error(
        'Получен XML plist, а Somata ожидает JSON-плейлист с расширением .plist. Сохраните плейлист из Somata как .PLIST.',
      );
    }
    const parsed = JSON.parse(text);
    stage = 'apply';
    await loadPlaylistDocument(parsed, 'default.plist', null);
    showShortcutToast('Открыт стандартный плейлист: default.plist');
  } catch (err) {
    const extra = err?.somataDiagnostic || {};
    const diagnostic = {
      stage,
      file: 'default.plist',
      requestedUrl,
      resolvedUrl: responseMeta?.url || extra.url || requestedUrl,
      page: window.location.href,
      protocol: window.location.protocol,
      httpStatus: responseMeta?.status ?? extra.status ?? null,
      statusText: extra.statusText || '',
      contentType: responseMeta?.contentType || extra.contentType || '',
      message: err?.message || String(err || 'unknown error'),
    };
    if (stage === 'parse') diagnostic.responsePreview = String(text).slice(0, 320);
    console.error('[Somata default.plist] OPEN FAILED', diagnostic, err);
    showShortcutToast('default.plist не открыт · причина в консоли (клик по FPS)');
  }
}
function triggerJsonDownload(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
async function exportCurrentProjectFile() {
  const project = buildProjectData();
  const idx = getCurrentPlaylistProjectIndex();
  const suggested = `${sanitizeProjectFileBase(idx >= 0 ? state.playlistProjects[idx].name : state.draftProjectName || 'Проект один', 'Проект один')}.sproj`;
  try {
    if (window.showSaveFilePicker) {
      const handle = await window.showSaveFilePicker({
        suggestedName: suggested,
        types: [{ description: 'Somata project', accept: { 'application/json': ['.sproj'] } }],
      });
      const w = await handle.createWritable();
      await w.write(JSON.stringify(project, null, 2));
      await w.close();
      state.projectFileHandle = handle;
      state.projectFileName = handle.name || suggested;
      state.draftProjectName = sanitizeProjectFileBase(state.projectFileName, 'Проект один');
    } else triggerJsonDownload(project, suggested);
    showShortcutToast('Проект экспортирован (.sproj)');
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('Project export failed', err);
      alert('Не удалось экспортировать проект.');
    }
  }
}
async function exportPlaylistProjects() {
  const entries = state.playlistProjects || [];
  if (!entries.length) {
    showShortcutToast('В плейлисте нет проектов');
    return;
  }
  try {
    if (window.showDirectoryPicker) {
      const dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      for (const entry of entries) {
        const h = await dir.getFileHandle(`${sanitizeProjectFileBase(entry.name)}.sproj`, { create: true });
        const w = await h.createWritable();
        await w.write(JSON.stringify(entry.project, null, 2));
        await w.close();
      }
    } else {
      for (const entry of entries)
        triggerJsonDownload(entry.project, `${sanitizeProjectFileBase(entry.name)}.sproj`);
    }
    showShortcutToast(`Экспортировано проектов: ${entries.length}`);
  } catch (err) {
    if (err?.name !== 'AbortError') {
      console.error('Playlist export failed', err);
      alert('Не удалось экспортировать проекты плейлиста.');
    }
  }
}
async function importProjectsIntoPlaylist(files) {
  const list = Array.from(files || []);
  if (!list.length) return;

  const parsedResults = await Promise.allSettled(
    list.map(async (file) => {
      const parsed = JSON.parse(await file.text());
      if (!isSpiroProjectData(parsed)) return null;
      return { file, project: parsed };
    }),
  );
  let added = 0;
  for (let i = 0; i < parsedResults.length; i++) {
    const result = parsedResults[i],
      file = list[i];
    if (result.status !== 'fulfilled') {
      console.warn('Skipped project import', file?.name, result.reason);
      continue;
    }
    const rec = result.value;
    if (!rec) continue;
    const importedName = uniquePlaylistProjectName(
      sanitizeProjectFileBase(rec.file?.name, `Проект ${state.playlistProjects.length + 1}`),
    );

    state.playlistProjects.push({
      id: createLayerId('project'),
      name: importedName,
      updatedAt: new Date().toISOString(),
      project: rec.project,
    });
    added++;
  }
  if (added) {
    if (!state.playlistCurrentProjectId)
      state.playlistCurrentProjectId = state.playlistProjects[0]?.id || null;
    renderProjectChooser();
    renderLibrary('projects');
    showShortcutToast(`Импортировано проектов: ${added} · плейлист не сохранён на диск`);
  } else alert('В выбранных файлах не найдено проектов Somata.');
}
async function saveProjectToDisk(forcePicker = false) {
  if (forcePicker) return exportCurrentProjectFile();
  const idx = getCurrentPlaylistProjectIndex();
  if (idx >= 0) {
    state.playlistProjects[idx].project = buildProjectData();
    state.playlistProjects[idx].updatedAt = new Date().toISOString();
  }
  return true;
}

export {
  deleteCurrentPlaylistProject,
  exportPlaylistProjects,
  handlePlaylistPlusSave,
  hideProjectNameMenus,
  importProjectsIntoPlaylist,
  loadPlaylistDocument,
  loadPlaylistProjectByIndex,
  openDefaultPlaylist,
  openPlaylist,
  projectContextIndex,
  quiesceProjectRuntimeForCommit,
  renderProjectChooser,
  saveCurrentProjectToPlaylist,
  savePlaylistToDisk,
  saveProjectToDisk,
  showProjectRenameContext,
  stepProjectChooser,
  syncAfterProjectLoad,
  toggleProjectMorphSettingsPanel,
  toggleProjectNameDropdown,
};
