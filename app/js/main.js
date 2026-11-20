// Somata entry point.
// Every module imports its predecessor first (see the "initialisation order" import at the top of
// each file), so importing the last module evaluates the whole application in the historical order.
import './ui/hint-tooltips.js';
import { loadPlaylistProjectByIndex, openDefaultPlaylist } from './project/playlist.js';
import { buildOrbitPolylines } from './geometry/orbit-builder.js';
import { state } from './core/state.js';
import {
  normalizeProjectMorphSettings,
  startProjectMorphing,
  stopProjectMorphing,
} from './project/project-morph.js';

// Stable hooks for automated checks (tests/browser, tools/visual). Not used by the app itself.
window.__somataDebugApi = Object.freeze({
  openDefaultPlaylist,
  loadPlaylistProjectByIndex,
  buildOrbitPolylines,
  getState: () => state,
  normalizeProjectMorphSettings,
  startProjectMorphing,
  stopProjectMorphing,
});

import defaults from '../project-defaults.js';
import { applyLoadedProject } from './project/project-loader.js';
function applyStartupDefaults() {
  applyLoadedProject(structuredClone(defaults), { applyProjectDefaultModes: false });
}

document.getElementById('btnNew').addEventListener('click', applyStartupDefaults);
