import './glow-pass.js'; // initialisation order: this module runs after it
import { SomataFeatureHost } from './feature-host.js';

const SomataFeatureLifecycle = (() => {
  const stats = { beginFrames: 0, endFrames: 0, providers: 0, patches: 0, failures: 0, lastErrors: [] };
  function applyRows(rows, renderFrame, phase) {
    const errors = [];
    for (const row of rows || []) {
      stats.providers++;
      if (row?.error) {
        stats.failures++;
        errors.push({ feature: row.name, phase, error: row.error });
        continue;
      }
      const patch = row?.value?.framePatch;
      if (patch && typeof patch === 'object' && renderFrame) {
        Object.assign(renderFrame, patch);
        stats.patches++;
      }
    }
    stats.lastErrors = errors.slice(-16);
    return errors.length === 0;
  }
  function begin(renderFrame, displayLayers, gpuBackendAllowed, width, height) {
    stats.beginFrames++;
    const env = {
      renderFrame,
      displayLayers: Array.isArray(displayLayers) ? displayLayers : [],
      gpuBackendAllowed: gpuBackendAllowed === true,
      width: Number(width) || 0,
      height: Number(height) || 0,
    };
    return applyRows(SomataFeatureHost?.queryAll?.('frameBegin', env) || [], renderFrame, 'begin');
  }
  function end(renderFrame, gpuBackendAllowed) {
    stats.endFrames++;
    const env = { renderFrame, gpuBackendAllowed: gpuBackendAllowed === true };
    return applyRows(SomataFeatureHost?.queryAll?.('frameEnd', env) || [], renderFrame, 'end');
  }
  function status() {
    return {
      ...stats,
      contract:
        'Frame begin/end are feature capabilities; main pipeline does not call Web/Graffiti/Particle/PathFX implementations directly.',
    };
  }
  return { begin, end, status };
})();
window.SomataFeatureLifecycle = SomataFeatureLifecycle;

export { SomataFeatureLifecycle };
