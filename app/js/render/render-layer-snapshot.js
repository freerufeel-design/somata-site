import './render-diagnostics.js'; // initialisation order: this module runs after it
import { noteSuppressedError } from '../core/suppressed-errors.js';

const SomataRenderLayerSnapshot = (() => {
  const nestedKeys = [
    'lamps',
    'geometryCircles',
    'motionRotation',
    'web',
    'sweep',
    'sprite',
    'lineMotionFx',
    'particles',
  ];
  const stats = { created: 0, nestedCopies: 0, sealed: 0, sealedObjects: 0 };
  function cloneBag(value) {
    if (Array.isArray(value)) return value.slice();
    if (value && typeof value === 'object' && Object.prototype.toString.call(value) === '[object Object]')
      return { ...value };
    return value;
  }
  function create(layer) {
    if (!layer || typeof layer !== 'object') return layer || null;
    const out = { ...layer };
    for (const key of nestedKeys) {
      if (!(key in out)) continue;
      const next = cloneBag(out[key]);
      if (next !== out[key]) {
        out[key] = next;
        stats.nestedCopies++;
      }
    }
    if (Array.isArray(out.profileNodes))
      out.profileNodes = out.profileNodes.map((p) => (p && typeof p === 'object' ? { ...p } : p));
    if (Array.isArray(out.customSuborbits)) out.customSuborbits = out.customSuborbits.slice();
    // Objects this snapshot owns (copied above). Only these may be frozen by seal(): every other
    // nested value is still shared with the live project layer.
    const owned = [out];
    for (const key of nestedKeys) if (key in out && out[key] !== layer[key]) owned.push(out[key]);
    if (Array.isArray(out.profileNodes))
      owned.push(out.profileNodes, ...out.profileNodes.filter((p) => p && typeof p === 'object'));
    if (Array.isArray(out.customSuborbits)) owned.push(out.customSuborbits);
    Object.defineProperty(out, '__somataOwnedCopies', { value: owned, enumerable: false });
    Object.defineProperty(out, '__somataRenderSource', {
      value: source(layer),
      enumerable: false,
      writable: false,
      configurable: false,
    });
    Object.defineProperty(out, '__somataRenderSnapshot', {
      value: true,
      enumerable: false,
      writable: false,
      configurable: false,
    });
    stats.created++;
    return out;
  }
  // Freeze only what the snapshot copied. deepSeal() used to walk into nested objects shared
  // with the live layer (testMorph, line profile, …) and froze the PROJECT data itself: later
  // edits to those fields threw "Cannot assign to read only property", which broke Master mode
  // for them and any handler writing into a nested setting.
  function seal(layer) {
    if (!isSnapshot(layer)) return layer;
    if (Object.isFrozen(layer)) return layer;
    for (const value of layer.__somataOwnedCopies || [layer]) {
      if (!value || typeof value !== 'object' || Object.isFrozen(value)) continue;
      try {
        Object.freeze(value);
        stats.sealedObjects++;
      } catch (error) {
        noteSuppressedError('render/render-layer-snapshot#seal', error);
      }
    }
    stats.sealed++;
    return layer;
  }
  function source(layer) {
    return layer?.__somataRenderSource || layer || null;
  }
  function isSnapshot(layer) {
    return layer?.__somataRenderSnapshot === true;
  }
  function status() {
    return {
      ...stats,
      nestedKeys: nestedKeys.slice(),
      contract:
        'Planning may normalize a render snapshot; effect execution receives the sealed snapshot. Persistent project state and later effect inputs cannot be mutated through it.',
    };
  }
  return { create, seal, source, isSnapshot, status };
})();
window.SomataRenderLayerSnapshot = SomataRenderLayerSnapshot;

export { SomataRenderLayerSnapshot };
