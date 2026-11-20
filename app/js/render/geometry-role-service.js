import './layer-scene-service.js'; // initialisation order: this module runs after it
import { SomataGeometryPolicy } from './geometry-policy.js';
import { WebGPUStrokeRenderer } from '../gpu/stroke-renderer.js';
import { GeometryGPURenderer } from '../gpu/line-effects-renderer.js';
import { tryRenderBaseGeometryGPU } from './gpu-dispatch.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

const SomataGeometryRoleService = (() => {
  const adapters = [];

  let nativeOrder = [];
  const stats = {
    renders: 0,
    glow: 0,
    glowBase: 0,
    base: 0,
    misses: 0,
    registrations: 0,
    lastBackend: 'none',
    lastReason: '',
    lastFailure: null,
    exceptions: 0,
  };
  function register(name, api = {}, priority = 0) {
    const key = String(name || '').trim();
    if (!key || !api || typeof api !== 'object') throw new Error('Geometry role adapter requires name/api');
    const rec = {
      name: key,
      api,
      priority: Number(priority) || 0,
      nativePriority: Number(api.nativePriority ?? priority) || 0,
    };
    const i = adapters.findIndex((x) => x.name === key);
    if (i >= 0) adapters.splice(i, 1);
    adapters.push(rec);
    adapters.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
    nativeOrder = adapters
      .slice()
      .sort((a, b) => b.nativePriority - a.nativePriority || b.priority - a.priority);
    stats.registrations++;
    return true;
  }
  function adapter(name) {
    return adapters.find((a) => a.name === String(name || '')) || null;
  }
  function isStrict(frameCtx) {
    try {
      return SomataGeometryPolicy?.isStrict?.(frameCtx) === true;
    } catch (_) {
      return false;
    }
  }
  function matches(rec, frameCtx) {
    const fn = rec?.api?.matches;
    if (typeof fn !== 'function') return true;
    try {
      return fn(frameCtx) === true;
    } catch (_) {
      return false;
    }
  }
  function allowed(rec, frameCtx) {
    return !isStrict(frameCtx) || rec?.api?.allowStrict === true;
  }
  function eligibleRec(rec, frameCtx, role = 'base') {
    if (!rec || !allowed(rec, frameCtx) || !matches(rec, frameCtx)) return false;
    try {
      return rec.api.eligible?.(frameCtx, role) === true;
    } catch (_) {
      return false;
    }
  }
  function note(rec, kind) {
    stats.renders++;
    stats[kind] = (stats[kind] || 0) + 1;
    stats.lastBackend = rec?.name || 'none';
    stats.lastReason = '';
  }
  function renderVia(method, kind, frameCtx, ctx2d, opts = {}) {
    stats.lastFailure = null;
    for (const rec of adapters) {
      if (!allowed(rec, frameCtx) || !matches(rec, frameCtx)) continue;
      const fn = rec.api?.[method];
      if (typeof fn !== 'function') continue;
      try {
        const out = fn(frameCtx, ctx2d, opts);
        if (out === true) {
          note(rec, kind);
          return { handled: true, backend: rec.name, baseCommitted: method === 'renderGlowBase' };
        }
        if (out?.handled === true) {
          note(rec, kind);
          return { backend: rec.name, ...out };
        }
      } catch (err) {
        stats.exceptions++;
        stats.lastFailure = {
          backend: rec.name,
          role: kind,
          error: String(err?.message || err),
          layerId: frameCtx?.layer?.id || null,
          frameId: Number(frameCtx?.frameId) || 0,
        };
      }
    }
    stats.misses++;
    stats.lastBackend = 'none';
    stats.lastReason = `no-geometry-backend-for-${kind}`;
    return { handled: false, backend: 'none', baseCommitted: false };
  }
  function renderGlowBase(frameCtx, ctx2d, opts = {}) {
    return renderVia('renderGlowBase', 'glowBase', frameCtx, ctx2d, opts);
  }
  function renderGlow(frameCtx, ctx2d, opts = {}) {
    return renderVia('renderGlow', 'glow', frameCtx, ctx2d, opts);
  }
  function batchHas(frameCtx, role) {
    return Boolean(frameCtx?._webgpuStrokeBatch?.roles?.has?.(role));
  }
  function batchSceneHas(frameCtx, role) {
    return Boolean(frameCtx?._webgpuStrokeBatch?.sceneCombined && batchHas(frameCtx, role));
  }
  function compositeBatchRole(frameCtx, role, ctx2d, composite = 'source-over') {
    const batch = frameCtx?._webgpuStrokeBatch,
      stroke = typeof WebGPUStrokeRenderer !== 'undefined' ? WebGPUStrokeRenderer : null;
    if (!batchHas(frameCtx, role) || !stroke?.compositeLayerBatch) return false;
    try {
      return stroke.compositeLayerBatch(batch, role, ctx2d, composite) === true;
    } catch (_) {
      return false;
    }
  }
  function renderBase(frameCtx, ctx2d, opts = {}) {
    const force = opts.force === true,
      strict = isStrict(frameCtx) && frameCtx?._spiralCorridorSharedLineAuthority !== true,
      shared = frameCtx?._sharedFrameContourRequired === true;
    // 7.8: once FrameContour is authoritative, Line may not jump to a separate
    // native topology/green renderer. Prefer the batch built from record.commands,
    // then the generic GPU command renderer which consumes those same commands.
    if (!force && !strict && shared) {
      if (compositeBatchRole(frameCtx, 'base', ctx2d, 'source-over'))
        return { handled: true, backend: 'shared-frame-contour-batch' };
      {
        let ok = false;
        try {
          ok = tryRenderBaseGeometryGPU(frameCtx) === true;
        } catch (_) {
          ok = false;
        }
        if (ok) {
          let backend = 'gpu';
          try {
            backend = String(GeometryGPURenderer?.status?.()?.active || 'gpu');
          } catch (error) {
            noteSuppressedError('render/geometry-role-service#renderBase', error);
          }
          return { handled: true, backend: `shared-frame-contour-${backend}` };
        }
      }
      stats.lastReason = 'shared-frame-contour-base-unavailable';
      return { handled: false, backend: 'none' };
    }
    if (!force) {
      const out = renderVia('renderBase', 'base', frameCtx, ctx2d, opts);
      if (out.handled) return out;
    }
    if (!force && !strict && compositeBatchRole(frameCtx, 'base', ctx2d, 'source-over'))
      return { handled: true, backend: 'batch' };
    if (!force && !strict && typeof tryRenderBaseGeometryGPU === 'function') {
      let ok = false;
      try {
        ok = tryRenderBaseGeometryGPU(frameCtx) === true;
      } catch (_) {
        ok = false;
      }
      if (ok) {
        let backend = 'gpu';
        try {
          backend = String(GeometryGPURenderer?.status?.()?.active || 'gpu');
        } catch (error) {
          noteSuppressedError('render/geometry-role-service#renderBase', error);
        }
        return { handled: true, backend };
      }
    }
    if (!force) {
      stats.lastReason = 'no-geometry-backend-for-base';
    }
    return { handled: false, backend: 'none' };
  }
  function backendEligible(frameCtx, name, role = 'base') {
    const rec = adapter(name);
    if (!rec || !allowed(rec, frameCtx)) return false;
    try {
      return rec.api.eligible?.(frameCtx, role) === true;
    } catch (_) {
      return false;
    }
  }
  function nativeBaseKind(frameCtx, opt = {}) {
    const replacement =
      typeof isPathFxBaseReplacementActive === 'function' && isPathFxBaseReplacementActive(frameCtx);
    if (replacement) return null;
    for (const rec of nativeOrder) {
      if (!allowed(rec, frameCtx)) continue;
      try {
        if (rec.api.nativeEligible?.(frameCtx, opt) === true) {
          if (opt.warmup !== false) rec.api.warmup?.(frameCtx);
          return rec.name;
        }
      } catch (error) {
        noteSuppressedError('render/geometry-role-service#nativeBaseKind', error);
      }
    }
    return null;
  }
  function canRenderRole(frameCtx, role = 'base') {
    for (const rec of adapters) if (eligibleRec(rec, frameCtx, role)) return true;
    return batchHas(frameCtx, role);
  }
  function warmupEntry(strictIntent = false) {
    try {
      WebGPUStrokeRenderer?.warmup?.();
    } catch (error) {
      noteSuppressedError('render/geometry-role-service#warmupEntry', error);
    }
    if (strictIntent !== true) return;
    for (const rec of adapters)
      try {
        rec.api.entryWarmup?.();
      } catch (error) {
        noteSuppressedError('render/geometry-role-service#warmupEntry', error);
      }
  }
  function warmup(frameCtx) {
    try {
      WebGPUStrokeRenderer?.warmup?.();
    } catch (error) {
      noteSuppressedError('render/geometry-role-service#warmup', error);
    }
    for (const rec of adapters) {
      if (!allowed(rec, frameCtx) || !matches(rec, frameCtx)) continue;
      try {
        rec.api.warmup?.(frameCtx);
      } catch (error) {
        noteSuppressedError('render/geometry-role-service#warmup', error);
      }
    }
  }
  function strictDiagnostics(frameCtx, role = 'glow', allowHiddenGraffitiCarrier = false) {
    for (const rec of adapters) {
      if (!allowed(rec, frameCtx) || !matches(rec, frameCtx) || typeof rec.api.diagnostics !== 'function')
        continue;
      try {
        const d = rec.api.diagnostics(frameCtx, role, allowHiddenGraffitiCarrier);
        if (d) return { backend: rec.name, ...d };
      } catch (error) {
        noteSuppressedError('render/geometry-role-service#strictDiagnostics', error);
      }
    }
    let stroke = null;
    try {
      stroke = WebGPUStrokeRenderer?.status?.() || null;
    } catch (error) {
      noteSuppressedError('render/geometry-role-service#strictDiagnostics', error);
    }
    return { reason: 'no strict geometry adapter', layerSceneEligible: false, stroke };
  }
  // Compatibility aliases for older call-sites. Their implementation is registry based;
  // no Spiral renderer is imported by this service.
  function usesRetainedSpiral(frameCtx) {
    const rec = adapter('spiral');
    return Boolean(rec && matches(rec, frameCtx));
  }
  function spiralRoute(frameCtx, allowHiddenGraffitiCarrier = false) {
    const rec = adapter('spiral');
    try {
      return (
        rec?.api?.route?.(frameCtx, allowHiddenGraffitiCarrier) || {
          deferLayerScene: false,
          deferFrameScene: false,
          resident: false,
        }
      );
    } catch (_) {
      return { deferLayerScene: false, deferFrameScene: false, resident: false };
    }
  }
  function status() {
    return {
      ...stats,
      adapters: adapters.map((r) => ({
        name: r.name,
        priority: r.priority,
        nativePriority: r.nativePriority,
        methods: Object.keys(r.api).filter((k) => typeof r.api[k] === 'function'),
      })),
      contract:
        'Somata 7.8: semantic geometry roles remain pluggable, but an active FrameContour has priority over native topology/green Base so every ordinary consumer sees one contour.',
    };
  }
  return {
    register,
    isStrict,
    usesRetainedSpiral,
    spiralRoute,
    backendEligible,
    nativeBaseKind,
    warmupEntry,
    canRenderRole,
    renderBase,
    renderGlowBase,
    renderGlow,
    batchHas,
    batchSceneHas,
    compositeBatchRole,
    strictDiagnostics,
    warmup,
    status,
  };
})();
window.SomataGeometryRoleService = SomataGeometryRoleService;

window.__somataSpiralBezierGlowRouting = (frameCtx = {}, strict = false) =>
  strict === true || SomataGeometryRoleService.usesRetainedSpiral(frameCtx);

export { SomataGeometryRoleService };
