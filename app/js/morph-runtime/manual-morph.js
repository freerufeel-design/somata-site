import '../app/prism-3d-layer.js'; // initialisation order: this module runs after it
import { runtimeState, state } from '../core/state.js';
import { isPreSampledSplineLayer, setPreSampledSplineLayer } from '../core/render-runtime.js';
import { animationScheduler, requestMainCanvasRender } from '../core/scheduler.js';
import { getCachedLayerDrawData, layerGeometrySignature } from '../effects/motion.js';
import {
  getEffectiveSpiralOrder,
  getEffectiveSpiralStep,
  getSpiralClosureRatio,
} from '../geometry/spiral/order-params.js';
import { normalizeSpiralSquashY } from '../geometry/orbit-builder.js';
import { SOMATA_STRICT_SPIRAL_GPU_PRESENTATION } from '../render/layer-scene-service.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';
import { profileModeTransitionProgress } from '../geometry/morph.js';
import { setSyncedBluePhaseDurationSec, syncGeometryMorphDuration, syncTapTimingIndicators } from '../audio/tap-tempo.js';
import { syncMorphIntervalQuickButtons } from '../ui/morph-settings-panel.js';

const SomataTestMorph = (() => {
  const defaults = Object.freeze({
    enabled: true,
    mode: 'circleSlide',
    spiralMode: 'coordinated',
    slide: 'minimal',
    spiralSlide: 'standard',
    spiralType: 'coordinated',
    duration: 1,
    syncWithMorph: false,
    showSkeleton: false,
  });

  const HONEST_CORRIDOR_FRACTION = 0.2;
  const SPIRAL_TYPES = new Set(window.SomataMorphRegistry.spiralIds());
  const MORPH_TYPES = new Set(window.SomataMorphRegistry.ids());
  const SLIDES = new Set(['minimal', 'sector', 'phase']);
  // Тип морфинга спирали отделён от типа многоугольника. Fade и Слайдшоу — кадровые
  // режимы: они общие, поэтому при них спираль следует выбору многоугольника.
  const FRAME_LEVEL_MODES = new Set(['light', 'fade']);
  // Fill presence of the outgoing / incoming shape during a frame-level cross-fade.
  // The Line fades by the raw phase; the Fill follows "Смена режима".
  function fadeFillPresence(phase, slideshow = false) {
    const v = Math.max(0, Math.min(1, Number(phase) || 0));
    if (slideshow) return { out: v < 0.5 ? 1 : 0, next: v >= 0.5 ? 1 : 0 };
    const u = profileModeTransitionProgress(v);
    return { out: 1 - u, next: u };
  }
  const spiralOf = (cfg) =>
    cfg ? (FRAME_LEVEL_MODES.has(cfg.mode) ? cfg.mode : cfg.spiralMode || cfg.mode) : undefined;
  const layerIsSpiral = (layer) =>
    layer?.spiralEnabled === true || Math.abs(Number(layer?.spiralOrder) || 0) > 1e-8;
  // Для слоя со спиралью — тип спирали, иначе — тип многоугольника.
  const modeForLayer = (cfg, layer) => (layerIsSpiral(layer) ? spiralOf(cfg) : cfg.mode);
  const realKeys = [
    'N',
    'K',
    'radius',
    'radiusMultiplier',
    'rotation',
    'rounding',
    'spiralStep',
    'spiralOrder',
    'spiralLayers',
    'spiralTurns',
    'spiralOffset',
    'spiralStartRadius',
    'spiralEndRadius',
    'spiralWidth',
    'spiralAngle',
    'spiralPhase',
    'profileOffset',
    'splineTension',
  ];
  const structuralKeys = [
    'N',
    'K',
    'customSuborbits',
    'spiralEnabled',
    'spiralClosed',
    'roundingMode',
    'roundingShape',
    'profileMode',
    'profileNodes',
    'splineRenderMode',
    'chaosStar',
    'chaosClosures',
    'spiralStepLinked',
    'spiralTangential',
  ];
  const observedKeys = [...new Set([...realKeys, ...structuralKeys])];
  const dynamic = new Map();

  const independentOrders = new Map();

  const blueZeroRails = new Map();

  const lightCarrierCache = new WeakMap();
  function coordinatedRestFrame(frameCtx, layer, mode) {
    if (!SomataMorphRuntime.isWound(layer)) return false;
    const spec = SomataMorphRuntime.describe({
      sourceLayer: layer,
      targetLayer: layer,
      mode,
      layerIndex: frameCtx.layerIndex,
    });
    return SomataMorphRuntime.publish(frameCtx, SomataMorphRuntime.samplePrimary(spec, 0, { layer }), {
      structural: false,
    });
  }
  const staticOrderCache = new WeakMap();
  const usesUnfoldRest = (layer) =>
    SomataSpiralZeroTransition.buildOf(layer) !== 'simple' &&
    (SomataSpiralZeroTransition.buildOf(layer) === 'unfold'
      ? Math.abs(getEffectiveSpiralOrder(layer)) >= 1
      : Math.abs(getEffectiveSpiralOrder(layer)) === 1) &&
    layer.chaosStar !== true;
  function staticOrderFrame(frameCtx, layer, mode) {
    const edit = SomataSpiralZeroTransition.staticOrder(getEffectiveSpiralOrder(layer));
    if (!edit && !usesUnfoldRest(layer)) return false;
    const source = frameCtx.sourceLayer || layer,
      corridor = state.tunnel?.active === true;
    const key = `${layerGeometrySignature(layer)}|${SomataSpiralZeroTransition.modeFor(layer)}|${mode}|${corridor}|${state.fourierMode}`;
    const cached = staticOrderCache.get(source);
    const result =
      key !== null && key === cached?.key
        ? cached.result
        : edit
          ? SomataMorphRuntime.sampleStaticOrder(layer, mode, corridor)
          : {
              sampled: SomataMorphRuntime.samplePrimary(
                SomataMorphRuntime.describe({ sourceLayer: layer, targetLayer: layer, mode }),
                0,
                { layer },
              ),
            };
    if (!result?.sampled || !SomataMorphRuntime.publish(frameCtx, result.sampled, { structural: false }))
      return false;
    if (key !== null) staticOrderCache.set(source, { key, result });
    if (!result.edit) return true;
    const { edit: position, zeroMode, flat, wound } = result;
    layer.closedLoop = SomataSpiralZeroTransition.isZero(layer.spiralOrder) && flat.closedLoop;
    SomataSpiralZeroTransition.applyCorridorFrame(
      layer,
      zeroMode,
      position.from,
      position.to,
      position.progress,
      corridor,
      flat,
      wound,
      source,
      true,
    );
    return true;
  }
  function blueSharedSkeletonFrame(frameCtx) {
    const blue = frameCtx?.blueMorphProvider,
      idx = Number(frameCtx?.layerIndex) || 0;
    const explicitOrder = blue?.options?.bySpiralOrder === true || blue?.options?.bySpiralLayers === true;
    if (
      blue?.active &&
      blue.kind !== 'lightning' &&
      !blue.geometryActive &&
      !blue.lightMorphEnabled &&
      !explicitOrder &&
      usesUnfoldRest(frameCtx.layer)
    )
      return staticOrderFrame(frameCtx, frameCtx.layer, SomataMorphRuntime.fromBlue(idx)?.mode);
    if (
      !blue?.active ||
      blue.kind === 'lightning' ||
      (blue.geometryActive !== true &&
        !blue.lightMorphEnabled &&
        !explicitOrder &&
        !SomataSpiralZeroTransition.staticOrder(getEffectiveSpiralOrder(frameCtx.layer))) ||
      frameCtx.__somataZeroOrderPrepared === true ||
      (typeof SOMATA_STRICT_SPIRAL_GPU_PRESENTATION !== 'undefined' &&
        SOMATA_STRICT_SPIRAL_GPU_PRESENTATION === true) ||
      typeof SomataMorphRuntime === 'undefined'
    )
      return false;
    const spec = SomataMorphRuntime.fromBlue(idx);
    // The original polygon providers correct their Spline+ contours against the
    // static endpoints. Publishing raw skeleton paths would bypass that step.
    if (
      !explicitOrder && !state.fourierMode &&
      (blue.kind === 'blue-anchor-linear' || blue.kind === 'blue-circle-slide') &&
      (spec?.mode === 'topology' || spec?.mode === 'circleSlide') &&
      getEffectiveSpiralOrder(spec.sourceLayer) === 0 &&
      getEffectiveSpiralOrder(spec.targetLayer) === 0 &&
      Math.max(Number(spec.sourceLayer.rounding) || 0, Number(spec.targetLayer.rounding) || 0) > 0
    )
      return false;
    const layer = blue.renderLayer || frameCtx.layer;
    const squashY = normalizeSpiralSquashY(frameCtx.layer?.spiralSquashY ?? layer?.spiralSquashY);
    const lightPhase = runtimeState.morph.lightGeometryBucket;
    const canReuse =
      spec?.mode === 'light' &&
      blue.lightDrawData &&
      blue.renderLayer &&
      Number.isFinite(lightPhase) &&
      lightPhase !== -1;
    const progress = canReuse ? lightPhase : blue.geometryT;
    const zeroMode = SomataSpiralZeroTransition.modeFor(frameCtx.sourceLayer || layer);
    const orders = spec && zeroPairOrder(spec.sourceLayer, spec.targetLayer);
    const withCorridor = state.tunnel?.active === true;
    const fixedCalibration =
      spec &&
      getEffectiveSpiralOrder(spec.sourceLayer) === getEffectiveSpiralOrder(spec.targetLayer) &&
      SomataSpiralZeroTransition.staticOrder(getEffectiveSpiralOrder(spec.sourceLayer));
    if (spec && (explicitOrder || fixedCalibration)) {
      const a = spec.sourceLayer,
        b = spec.targetLayer,
        zero = SomataSpiralZeroTransition;
      const from = getEffectiveSpiralOrder(a),
        to = getEffectiveSpiralOrder(b);
      if (from !== to || zero.staticOrder(from)) {
        const authored = frameCtx.sourceLayer || layer,
          progress = blue.linearProgress ?? blue.geometryT;
        const rail =
          window.__somataSampleBlueSpiralOrder?.(authored, from, to, progress, withCorridor) ??
          zero.blueOrder(zeroMode, from, to, progress, withCorridor);
        const live = {
          ...frameCtx.layer,
          spiralOrder: rail.order,
          spiralEnabled: !zero.isZero(rail.order),
          closedLoop: zero.isZero(rail.order) && frameCtx.layer.spiralClosed !== false,
        };
        if (isPreSampledSplineLayer(layer)) setPreSampledSplineLayer(live, true);
        const opt = blue.options || {};
        const orderOnly =
          (explicitOrder || !blue.geometryActive) &&
          !opt.byShape &&
          !opt.byVertices &&
          !opt.bySteps &&
          !opt.bySize &&
          !opt.byRotation &&
          !opt.byRounding &&
          state.morph?.monoOrbitTransforms !== true &&
          a.customSuborbits === b.customSuborbits;
        const built = SomataMorphRuntime.samplePrimary(spec, blue.geometryT, {
          layer: live,
          order: rail.order,
          orderTransition: rail,
          zeroMode,
          sharedOrder: true,
          explicitOrder: true,
          orderOnly,
          spiralSquashY: squashY,
        });
        if (SomataMorphRuntime.publish(frameCtx, built)) {
          zero.applyCorridorFrame(
            frameCtx.layer,
            zeroMode,
            rail.from,
            rail.to,
            rail.progress,
            withCorridor,
            a,
            b,
            frameCtx.sourceLayer,
            true,
          );
          frameCtx.layer.closedLoop = !frameCtx.layer.spiralEnabled && live.spiralClosed !== false;
          frameCtx.layer.__spiralOrderInterpolating = rail.transitioning;
          return true;
        }
      } else if (!blue.geometryActive && !blue.lightMorphEnabled)
        return staticOrderFrame(frameCtx, frameCtx.layer, spec.mode);
    }
    const zeroPlan = orders
      ? window.SomataSpiralZeroTransition.plan(zeroMode, orders.from, orders.to, progress, withCorridor)
      : null;
    const order = zeroPlan?.order;
    const geometryProgress = zeroPlan?.shapeT ?? progress;
    if (orders)
      window.SomataSpiralZeroTransition.applyCorridorFrame(
        frameCtx.layer,
        zeroMode,
        orders.from,
        orders.to,
        progress,
        withCorridor,
        spec.sourceLayer,
        spec.targetLayer,
        frameCtx.sourceLayer,
      );
    const cached = canReuse ? lightCarrierCache.get(layer) : null;
    const same =
      cached &&
      cached.drawData === blue.lightDrawData &&
      cached.progress === progress &&
      cached.squashY === squashY &&
      cached.source === spec.sourceLayer &&
      cached.target === spec.targetLayer &&
      cached.serial === spec.phaseSerial &&
      cached.fourier === state.fourierMode &&
      cached.ratio === getSpiralClosureRatio() &&
      cached.order === order &&
      cached.zeroMode === zeroMode;
    const sampled = same
      ? cached.sampled
      : SomataMorphRuntime.samplePrimary(spec, geometryProgress, {
          layer,
          order,
          zeroMode,
          spiralSquashY: squashY,
        });
    if (canReuse && !same && sampled)
      lightCarrierCache.set(layer, {
        drawData: blue.lightDrawData,
        progress,
        sampled,
        squashY,
        source: spec.sourceLayer,
        target: spec.targetLayer,
        serial: spec.phaseSerial,
        order,
        zeroMode,
        fourier: state.fourierMode,
        ratio: getSpiralClosureRatio(),
      });
    return SomataMorphRuntime.publish(frameCtx, sampled, { structural: true });
  }

  let lastBlueZero = null;
  let applied = 0,
    last = null,
    lastPresentedLayer = null;
  const clamp = (v, min, max, def) =>
    Math.max(min, Math.min(max, Number.isFinite(Number(v)) ? Number(v) : def));
  const selectLayer = () =>
    state.layers?.find((layer) => layer?.id === state.activeLayerId) || state.layers?.[0] || null;
  function config(layer) {
    const saved = layer?.testMorph && typeof layer.testMorph === 'object' ? layer.testMorph : {};

    const migrated =
      saved.unifiedModeVersion !== 5 &&
      saved.spiralTypeExplicit === true &&
      SPIRAL_TYPES.has(SomataMorphRegistry.migrate(saved.spiralType))
        ? saved.spiralType
        : saved.mode;
    const resolved = SomataMorphRegistry.migrate(migrated);
    const mode = MORPH_TYPES.has(resolved) ? resolved : defaults.mode;
    const slide = SLIDES.has(saved.slide) ? saved.slide : defaults.slide;
    // У нового слоя тип спирали — по умолчанию. Старые слои хранили один общий тип:
    // спираль следует за ним, пока не выбран свой.
    const savedSpiral = SomataMorphRegistry.migrate(saved.spiralMode);
    const spiralMode =
      MORPH_TYPES.has(savedSpiral) && !FRAME_LEVEL_MODES.has(savedSpiral)
        ? savedSpiral
        : saved.mode == null
          ? defaults.spiralMode
          : mode;
    const effectiveSpiral = FRAME_LEVEL_MODES.has(mode) ? mode : spiralMode;
    return {
      ...defaults,
      ...saved,
      mode,
      spiralMode,
      slide,
      spiralType: SPIRAL_TYPES.has(effectiveSpiral) ? effectiveSpiral : 'phaseCircle',
    };
  }
  const copy = (v) =>
    Array.isArray(v)
      ? v.map(copy)
      : v && typeof v === 'object'
        ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, copy(x)]))
        : v;
  function capture(layer) {
    const v = {};
    for (const key of observedKeys) v[key] = copy(layer?.[key]);
    return v;
  }
  const same = (a, b) => observedKeys.every((k) => JSON.stringify(a?.[k]) === JSON.stringify(b?.[k]));
  const differs = (a, b, k) => JSON.stringify(a?.[k]) !== JSON.stringify(b?.[k]);
  const mix = (a, b, t) => a + (b - a) * t;

  const isZeroOrder = (n) => Math.abs(Number(n) || 0) < 1e-8;
  function zeroPairOrder(from, to) {
    const a = from?.spiralEnabled === true ? Number(from.spiralOrder) || 0 : 0;
    const b = to?.spiralEnabled === true ? Number(to.spiralOrder) || 0 : 0;
    return isZeroOrder(a) !== isZeroOrder(b) ? { from: a, to: b } : null;
  }
  function zeroShapePhase(mode, a, b, u, withCorridor) {
    const p = window.SomataSpiralZeroTransition?.plan(mode, a, b, u, withCorridor, true);
    return p && Math.abs(b - a) > 1e-10 ? clamp((p.order - a) / (b - a), 0, 1, 0) : clamp(u, 0, 1, 0);
  }

  function applyZeroCorridorSignals(layer, mode, fromOrder, toOrder, progress, source, target) {
    window.SomataSpiralZeroTransition.applyCorridorFrame(
      layer,
      mode,
      fromOrder,
      toOrder,
      progress,
      state.tunnel?.active === true,
      source,
      target,
    );
  }
  function sampledContour(path, count = 96) {
    const raw = Array.isArray(path?.points) ? path.points : [];
    const segs =
      Array.isArray(path?._bezierSegments) && path._bezierSegments.length ? path._bezierSegments : null;
    const dense = [];
    if (segs) {
      for (const seg of segs) {
        const p = seg?.p0,
          c = seg?.c1,
          d = seg?.c2,
          q = seg?.p3;
        if (!p || !c || !d || !q) continue;
        for (let j = 0; j < 12; j++) {
          const t = j / 12,
            z = 1 - t;
          dense.push({
            x: z * z * z * p.x + 3 * z * z * t * c.x + 3 * z * t * t * d.x + t * t * t * q.x,
            y: z * z * z * p.y + 3 * z * z * t * c.y + 3 * z * t * t * d.y + t * t * t * q.y,
            widthScale: Math.exp(
              (1 - t) * Math.log(Math.max(0.02, Number(seg.widthScale0) || 1)) +
                t * Math.log(Math.max(0.02, Number(seg.widthScale1) || 1)),
            ),
          });
        }
      }
      if (segs.length) dense.push({ ...segs[segs.length - 1].p3 });
    }
    if (dense.length < 2)
      for (const p of raw)
        if (Number.isFinite(p?.x) && Number.isFinite(p?.y))
          dense.push({ x: p.x, y: p.y, widthScale: Math.max(0.02, Number(p.widthScale) || 1) });
    if (dense.length < 2) return Array.from({ length: count }, () => ({ x: 0, y: 0 }));
    const closed = path?.closed === true;
    if (closed && Math.hypot(dense[0].x - dense.at(-1).x, dense[0].y - dense.at(-1).y) > 1e-8)
      dense.push({ ...dense[0] });
    const distances = [0];
    for (let i = 1; i < dense.length; i++)
      distances.push(distances.at(-1) + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y));
    const total = distances.at(-1);
    if (total < 1e-9) return Array.from({ length: count }, () => ({ ...dense[0] }));
    let cursor = 1;
    return Array.from({ length: count }, (_, j) => {
      const target = (total * j) / (count - 1);
      while (cursor < distances.length - 1 && distances[cursor] < target) cursor++;
      const a = dense[cursor - 1],
        b = dense[cursor],
        denom = distances[cursor] - distances[cursor - 1];
      const t = denom > 1e-9 ? (target - distances[cursor - 1]) / denom : 0;
      return {
        x: mix(a.x, b.x, t),
        y: mix(a.y, b.y, t),
        widthScale: Math.exp(
          mix(
            Math.log(Math.max(0.02, Number(a.widthScale) || 1)),
            Math.log(Math.max(0.02, Number(b.widthScale) || 1)),
            t,
          ),
        ),
      };
    });
  }

  function polygonEdgePaths(paths) {
    const result = [];
    for (const path of paths) {
      const vertices = path?.points || [];
      if (path?.closed !== true || vertices.length < 2) return null;
      const count =
        vertices.length > 2 &&
        Math.hypot(vertices[0].x - vertices.at(-1).x, vertices[0].y - vertices.at(-1).y) < 1e-7
          ? vertices.length - 1
          : vertices.length;
      for (let i = 0; i < count; i++) {
        const a = vertices[i],
          b = vertices[(i + 1) % count];
        if (!a || !b || !Number.isFinite(a.x + b.x + a.y + b.y)) continue;
        result.push({
          points: [
            { x: a.x, y: a.y, widthScale: a.widthScale || 1 },
            { x: b.x, y: b.y, widthScale: b.widthScale || 1 },
          ],
          closed: false,
          __zeroEdge: true,
        });
      }
    }
    return result;
  }
  function pairByRoot(paths, guide) {
    if (!paths.length || !guide.length) return null;
    const used = new Set(),
      sorted = [];
    for (const branch of guide) {
      const anchor = branch?.points?.[0];
      if (!anchor) return null;
      let best = -1,
        bestD = Infinity;
      for (let i = 0; i < paths.length; i++) {
        if (used.has(i)) continue;
        const point = paths[i]?.points?.[0];
        if (!point) continue;
        const d = (point.x - anchor.x) ** 2 + (point.y - anchor.y) ** 2;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best < 0) return null;
      used.add(best);
      sorted.push(paths[best]);
    }

    return used.size === paths.length && used.size === guide.length ? sorted : null;
  }
  function makeZeroContourRail(from, to, sourceOverride = null) {
    if (typeof getCachedLayerDrawData !== 'function') return null;
    let src =
      Array.isArray(sourceOverride) && sourceOverride.length
        ? sourceOverride
        : getCachedLayerDrawData(from)?.paths || [];
    let dst = getCachedLayerDrawData(to)?.paths || [];
    if (!src.length || !dst.length) return null;
    const fromZero = isZeroOrder(from?.spiralOrder),
      toZero = isZeroOrder(to?.spiralOrder);
    const crossing = fromZero !== toZero;
    if (crossing) {
      if (fromZero && (!sourceOverride || src.every((path) => path?.closed === true))) {
        const parts = polygonEdgePaths(src);
        if (!parts || parts.length !== dst.length) return null;
        src = pairByRoot(parts, dst);
      } else if (toZero) {
        const parts = polygonEdgePaths(dst);
        if (!parts || parts.length !== src.length) return null;
        dst = pairByRoot(parts, src);
      } else if (sourceOverride) {
        src = pairByRoot(src, dst);
      }
    } else if (sourceOverride && src.length === dst.length) {
      src = pairByRoot(src, dst);
    }
    if (!src || !dst || src.length !== dst.length) return null;
    const samples = 96;
    return src.map((path, i) => ({
      a: sampledContour(path, samples),
      b: sampledContour(dst[i], samples),
      sourceClosed: path?.closed === true,
      targetClosed: dst[i]?.closed === true,
      sourceZero: fromZero,
      targetZero: toZero,
      signedOrder: fromZero ? Number(to?.spiralOrder) || 1 : Number(from?.spiralOrder) || 1,
    }));
  }

  const zeroSmooth = (v) => {
    v = clamp(v, 0, 1, 0);
    return v * v * (3 - 2 * v);
  };
  function zeroPivot(rail) {
    let x = 0,
      y = 0,
      n = 0;
    for (const path of rail) {
      const a = path.a?.[0],
        b = path.b?.[0];
      if (a && Number.isFinite(a.x) && Number.isFinite(a.y)) {
        x += a.x;
        y += a.y;
        n++;
      } else if (b && Number.isFinite(b.x) && Number.isFinite(b.y)) {
        x += b.x;
        y += b.y;
        n++;
      }
    }
    return n ? { x: x / n, y: y / n } : { x: 0, y: 0 };
  }
  function rotateToward(a, b, v, origin, signedOrder, rotationMode) {
    if (v <= 0) return { x: a.x, y: a.y };
    if (v >= 1) return { x: b.x, y: b.y };
    const ax = a.x - origin.x,
      ay = a.y - origin.y,
      bx = b.x - origin.x,
      by = b.y - origin.y;
    const ra = Math.hypot(ax, ay),
      rb = Math.hypot(bx, by);

    if (ra < 1e-7 || rb < 1e-7) return { x: mix(a.x, b.x, v), y: mix(a.y, b.y, v) };
    const first = Math.atan2(ay, ax),
      second = Math.atan2(by, bx);
    let delta = window.SomataSpiralZeroTransition?.shortestEquivalentAngle?.(second - first);
    if (!Number.isFinite(delta)) delta = Math.atan2(Math.sin(second - first), Math.cos(second - first));

    if (rotationMode === 'active') {
      const sign = Math.sign(Number(signedOrder) || 1);
      if (sign > 0 && delta < 0) delta += 2 * Math.PI;
      if (sign < 0 && delta > 0) delta -= 2 * Math.PI;
    }
    const angle = first + delta * v;

    const radius = mix(ra, rb, v);
    return { x: origin.x + Math.cos(angle) * radius, y: origin.y + Math.sin(angle) * radius };
  }

  const ZERO_ANGULAR_MORPHS = new Set([
    'calm',
    'circleSlide',
    'topoCircle',
    'topoCircleOpacity',
    'minimalTurn',
    'phaseCircle',
    'coordinated',
    'coordinatedFromCenter',
  ]);
  function zeroNamedTransport(
    a,
    b,
    u,
    pivot,
    pathIndex,
    pathCount,
    signedOrder,
    morphMode = 'topology',
    slideType = 'minimal',
    rotationMode = 'minimal',
  ) {
    const t = clamp(u, 0, 1, 0);
    if (t === 0) return { x: a.x, y: a.y };
    if (t === 1) return { x: b.x, y: b.y };
    const n = Math.max(1, pathCount),
      branchAngle = (2 * Math.PI * pathIndex) / n;
    let phase = t;
    if (morphMode === 'phase')
      phase = clamp(t + 0.07 * Math.sin(Math.PI * t) * Math.sin(branchAngle), 0, 1, t);
    else if (morphMode === 'phaseCircle')
      phase = clamp(t + 0.12 * Math.sin(Math.PI * t) * Math.sin(branchAngle + Math.PI / 3), 0, 1, t);
    else if (SomataMorphRegistry.usesCoordinatedSpine(morphMode))
      phase = clamp(t + 0.2 * Math.sin(Math.PI * t) * Math.sin(pathIndex * 0.37), 0, 1, t);
    else if (morphMode === 'torn') {
      const rank = pathIndex / Math.max(1, n - 1),
        delay = 0.33 * rank;
      phase = zeroSmooth((t - delay) / (1 - delay));
    }
    const chord = { x: mix(a.x, b.x, phase), y: mix(a.y, b.y, phase) };
    if (!ZERO_ANGULAR_MORPHS.has(morphMode)) return chord;

    const activeRotation = slideType === 'phase' ? 'active' : rotationMode;
    const slidePhase =
      slideType === 'sector'
        ? clamp(phase + 0.06 * Math.sin(Math.PI * phase) * Math.sin(branchAngle), 0, 1, phase)
        : phase;
    const arc = rotateToward(a, b, slidePhase, pivot, signedOrder, activeRotation);
    const factor =
      {
        calm: 0.24,
        circleSlide: 1,
        topoCircle: 0.56,
        topoCircleOpacity: 0.56,
        minimalTurn: 0.82,
        phaseCircle: 0.95,
        coordinated: 0.7,
      }[morphMode] ?? 0;
    return { x: mix(chord.x, arc.x, factor), y: mix(chord.y, arc.y, factor) };
  }
  function zeroContourFrame(
    rail,
    t,
    mode = 'honest',
    rotationMode = 'minimal',
    morphMode = 'topology',
    slideType = 'minimal',
  ) {
    const u = clamp(t, 0, 1, 0),
      pivot = zeroPivot(rail);
    const width = (a, b, v) =>
      Math.exp(
        mix(
          Math.log(Math.max(0.02, Number(a.widthScale) || 1)),
          Math.log(Math.max(0.02, Number(b.widthScale) || 1)),
          v,
        ),
      );
    return rail.map((path, pathIndex) => ({
      points: path.a.map((a, i) => {
        const b = path.b[i];
        let v = u,
          x,
          y;
        if (mode === 'layerwise' || mode === 'beautiful') {
          x = mix(a.x, b.x, u);
          y = mix(a.y, b.y, u);
        } else {
          const named = zeroNamedTransport(
            a,
            b,
            u,
            pivot,
            pathIndex,
            rail.length,
            path.signedOrder,
            morphMode,
            slideType,
            rotationMode,
          );
          x = named.x;
          y = named.y;
        }
        return { x, y, widthScale: width(a, b, v) };
      }),
      closed:
        u <= 1e-9
          ? path.sourceClosed
          : u >= 1 - 1e-9
            ? path.targetClosed
            : path.sourceClosed && path.targetClosed,
      _alpha: 1,
      cornerFlags: [],
    }));
  }

  function zeroContourByMorphMode(
    rail,
    phase,
    zeroMode,
    rotationMode,
    fromLayer,
    toLayer,
    morphMode,
    slideType = 'minimal',
  ) {
    if (['continuous', 'fade', 'light'].includes(morphMode) && typeof getCachedLayerDrawData === 'function') {
      const a = getCachedLayerDrawData(fromLayer)?.paths || [];
      const b = getCachedLayerDrawData(toLayer)?.paths || [];
      if (a.length && b.length) {
        const v = Math.max(0, Math.min(1, Number(phase) || 0));
        const oldAlpha = morphMode === 'light' ? (v < 0.5 ? 1 : 0) : 1 - v;
        const newAlpha = morphMode === 'light' ? (v >= 0.5 ? 1 : 0) : v;
        const fp = fadeFillPresence(v, morphMode === 'light');
        return [
          ...a.map((path) => ({ ...path, _alpha: oldAlpha, _fillPresence: fp.out })),
          ...b.map((path) => ({ ...path, _alpha: newAlpha, _fillPresence: fp.next })),
        ];
      }
    }
    const paths = zeroContourFrame(rail, phase, zeroMode, rotationMode, morphMode, slideType);

    const continuous = [
      'phase',
      'minimalTurn',
      'phaseCircle',
      'coordinated',
      'coordinatedFromCenter',
    ].includes(morphMode);
    const from = Number(fromLayer?.spiralOrder) || 0,
      to = Number(toLayer?.spiralOrder) || 0;
    const isZero = (x) => Math.abs(x) < 1e-8;
    const zeroCrossing = isZero(from) !== isZero(to);
    const skipSeamRepair = zeroMode === 'layerwise' || (zeroMode === 'beautiful' && isZero(to));
    if (
      continuous &&
      zeroCrossing &&
      !skipSeamRepair &&
      fromLayer?.spiralClosed !== false &&
      toLayer?.spiralClosed !== false &&
      Array.isArray(paths) &&
      paths.length
    ) {
      const p = Math.max(0, Math.min(1, Number(phase) || 0));
      const source = isZero(from) ? toLayer : fromLayer;
      const signed = (Number(source?.spiralOrder) || 0) < 0 ? -1 : 1;
      const n = Math.max(2, Number(fromLayer?.N) || Number(toLayer?.N) || 2);
      const step = Number(getEffectiveSpiralStep(source));
      const angle = ((2 * Math.PI * (Number.isFinite(step) ? step : 1)) / n) * signed;
      const ratio = Math.max(1.0000001, Number(getSpiralClosureRatio()) || 1.1);

      const order = from + (to - from) * p,
        scale = Math.pow(ratio, Math.abs(order));
      const co = Math.cos(angle) * scale,
        si = Math.sin(angle) * scale;
      for (const path of paths) {
        const pts = path.points;
        if (!Array.isArray(pts) || pts.length < 2) continue;
        const root = pts[0],
          end = pts[pts.length - 1];
        const x = co * root.x - si * root.y,
          y = si * root.x + co * root.y;
        const dx = x - end.x,
          dy = y - end.y;
        if (!Number.isFinite(dx + dy) || Math.hypot(dx, dy) < 1e-9) continue;

        const first = Math.max(0, Math.floor((pts.length - 1) * 0.88));
        for (let i = first; i < pts.length; i++) {
          const z = (i - first) / Math.max(1, pts.length - 1 - first);
          const w = z * z * (3 - 2 * z);
          pts[i].x += dx * w;
          pts[i].y += dy * w;
        }
      }
    }
    return paths;
  }

  function easing(t, cfg) {
    return window.SomataManualInterpolation.easing(t, cfg, { clamp });
  }
  function sample(from, to, t, cfg) {
    return window.SomataManualInterpolation.sample(from, to, t, cfg, {
      observedKeys,
      realKeys,
      mix,
      copy,
      clamp,
    });
  }
  function hasStructuralChange(a, b) {
    return structuralKeys.some((k) => differs(a, b, k));
  }
  function anyActive() {
    return (
      [...dynamic.values()].some((r) => r.active === true) ||
      [...independentOrders.values()].some((r) => !r.finished)
    );
  }
  function tick() {
    if (!anyActive()) return false;
    requestMainCanvasRender();
    return true;
  }
  function syncTask() {
    if (anyActive()) {
      if (!animationScheduler.has('geometry-test-morph')) animationScheduler.add('geometry-test-morph', tick);
    } else animationScheduler.remove('geometry-test-morph');
  }
  function seed(layer) {
    if (!layer) return;
    dynamic.set(layer.id, { observed: capture(layer), visual: capture(layer), active: false });
  }

  function settleManualOrder(layer) {
    independentOrders.delete(layer.id);
    window.__somataCorridorStopHonestZeroIntro?.(layer.id);
    window.__somataCorridorStopHonestZeroOutro?.(layer.id);
    seed(layer);
    syncTask();
  }
  function prepareManualOrderEdit(layer, previousOrder, now = performance.now()) {
    if (!layer || config(layer).enabled !== true) return false;
    const previous = Number(previousOrder),
      target = Number(layer.spiralOrder);
    if (!Number.isFinite(previous) || !Number.isFinite(target) || Math.abs(previous - target) < 1e-9)
      return false;
    const r = dynamic.get(layer.id),
      cfg = config(layer);
    const from =
      r?.active === true
        ? sample(r.from, r.to, clamp((now - r.start) / r.duration, 0, 1, 0), cfg)
        : copy(r?.visual || r?.observed || capture(layer));

    let sourceOverride = null;
    if (r?.active === true && r.zeroRail) {
      const a = Number(r.zeroOrders?.from) || 0,
        b = Number(r.zeroOrders?.to) || 0;
      const u = easing(clamp((now - r.start) / r.duration, 0, 1, 0), cfg);
      const phase = zeroShapePhase(
        r.zeroMode,
        a,
        b,
        state.tunnel?.active !== true && ['layerwise', 'beautiful'].includes(r.zeroMode)
          ? clamp((now - r.start) / r.duration, 0, 1, 0)
          : u,
        state.tunnel?.active === true,
      );
      const priorMode = r.zeroNamedMode || spiralOf(cfg);

      sourceOverride = ['fade', 'light', 'continuous'].includes(priorMode)
        ? zeroContourFrame(r.zeroRail, phase, r.zeroMode, 'minimal')
        : zeroContourByMorphMode(
            r.zeroRail,
            phase,
            r.zeroMode,
            'minimal',
            { ...layer, ...r.from },
            { ...layer, ...r.to },
            priorMode,
            r.zeroSlide || cfg.slide,
          );
      from.spiralOrder = mix(a, b, phase);
    }
    if (r?.active !== true) from.spiralOrder = previous;
    const visualOrder = Number(from.spiralOrder) || 0;
    from.spiralEnabled = Math.abs(visualOrder) > 1e-8;
    from.closedLoop = from.spiralEnabled ? false : from.spiralClosed !== false;

    window.__somataCorridorStopHonestZeroOutro?.(layer.id);
    window.__somataCorridorStopHonestZeroIntro?.(layer.id);
    dynamic.set(layer.id, {
      observed: copy(from),
      visual: copy(from),
      active: false,
      manualOrder: true,
      sourceOverride,
    });
    requestMainCanvasRender();
    return true;
  }
  function independentOrderTarget(id) {
    const r = independentOrders.get(id);
    return r ? Number(r.to) : null;
  }
  function synchronizedBlueClock() {
    const clock = window.__somataBlueMorphPhaseClock?.();
    return clock && Number.isFinite(clock.durationMs) ? clock : null;
  }
  function resolvePendingOrderPhase(r, layer, now) {
    if (!r.waitingForBluePhase) return;
    const clock = synchronizedBlueClock();
    if (!clock?.active) {
      // Blue may have been stopped while this edit was queued. Use
      // the local render clock rather than waiting for a nonexistent phase.
      r.waitingForBluePhase = false;
      r.start = now + (r.corridorMs && isZeroOrder(r.from) ? r.corridorMs : 0);
      if (r.corridorMs && isZeroOrder(r.from))
        window.__somataCorridorBeginHonestZeroIntro?.(layer.id, now, r.corridorMs / 1000, r.to);
      return;
    }
    if (clock.paused || !clock.phaseStart) return;

    if (r.waitAfterPhaseSerial !== null) {
      if (clock.phaseSerial === r.waitAfterPhaseSerial) return;
    } else if (r.waitAfterPhaseStart !== null && clock.phaseStart <= r.waitAfterPhaseStart + 0.001) return;
    r.waitingForBluePhase = false;
    r.bluePhaseStart = clock.phaseStart;
    r.bluePhaseSerial = clock.phaseSerial;
    r.totalDuration = clock.durationMs;
    r.corridorMs =
      r.mode === 'honest' && state.tunnel?.active === true && isZeroOrder(r.from) !== isZeroOrder(r.to)
        ? clock.durationMs * HONEST_CORRIDOR_FRACTION
        : 0;
    r.duration = r.totalDuration - r.corridorMs;
    r.start = clock.phaseStart + (r.corridorMs && isZeroOrder(r.from) ? r.corridorMs : 0);
    if (r.corridorMs && isZeroOrder(r.from))
      window.__somataCorridorBeginHonestZeroIntro?.(layer.id, clock.phaseStart, r.corridorMs / 1000, r.to);
  }
  function independentOrderPhase(r, now = performance.now()) {
    const clock = r.config?.syncWithMorph === true ? synchronizedBlueClock() : null;
    if (
      !r.waitingForBluePhase &&
      r.bluePhaseStart != null &&
      clock?.active &&
      clock.phaseSerial === r.bluePhaseSerial &&
      clock.phaseStart !== 0 &&
      (Math.abs(clock.phaseStart - r.bluePhaseStart) > 0.001 || Math.abs(clock.durationMs - r.totalDuration) > 0.001)
    ) {
      const ratio = r.totalDuration > 0 ? clock.durationMs / r.totalDuration : 1;
      r.start = clock.phaseStart + (r.start - r.bluePhaseStart) * ratio;
      r.bluePhaseStart = clock.phaseStart;
      r.corridorMs *= ratio;
      r.duration *= ratio;
      r.totalDuration = clock.durationMs;
    }
    const t = r.waitingForBluePhase
      ? 0
      : clock?.active && clock.paused && r.bluePhaseStart != null
        ? clamp(r.lastFrame?.progress ?? 0, 0, 1, 0)
        : clamp((now - r.start) / r.duration, 0, 1, 0);
    const eased = easing(t, r.config);
    const corridor = state.tunnel?.active === true;
    const legacy132 = !corridor && ['layerwise', 'beautiful'].includes(r.mode);
    const plan = window.SomataSpiralZeroTransition?.plan(
      r.mode,
      r.from,
      r.to,
      legacy132 ? t : eased,
      corridor,
    );
    const phase =
      plan && Math.abs(r.to - r.from) > 1e-9
        ? clamp((plan.order - r.from) / (r.to - r.from), 0, 1, eased)
        : eased;
    return { t, eased, phase, plan, order: mix(r.from, r.to, phase) };
  }

  function beginIndependentOrderEdit(layer, previousOrder, targetOrder, now = performance.now()) {
    if (!layer) return false;
    const target = Number(targetOrder),
      previous = Number(previousOrder);
    if (!Number.isFinite(target) || !Number.isFinite(previous)) return false;
    const instant = SomataSpiralZeroTransition.isCalibrationEdit(previous, target);
    if (!instant && config(layer).enabled !== true) return false;
    const old = independentOrders.get(layer.id);
    if (old && Math.abs(old.to - target) < 1e-9) return false;
    const from = old ? independentOrderPhase(old, now).order : previous;
    if (!instant && Math.abs(from - target) < 1e-9) return false;

    window.__somataCorridorStopHonestZeroOutro?.(layer.id);
    window.__somataCorridorStopHonestZeroIntro?.(layer.id);
    const cfg = config(layer);
    const mode = SomataSpiralZeroTransition.modeFor(layer);
    const clock = cfg.syncWithMorph === true ? synchronizedBlueClock() : null;
    const synced = cfg.syncWithMorph === true;
    const waitForBlue = synced && clock?.active === true;
    const totalDuration = synced
      ? clock?.durationMs || Math.max(100, Number(state.morph?.intervalSec) || 5) * 1000
      : clamp(cfg.duration, 0.1, 60, 1) * 1000;
    const honestCorridor =
      !instant &&
      mode === 'honest' &&
      state.tunnel?.active === true &&
      isZeroOrder(from) !== isZeroOrder(target);
    const corridorMs = honestCorridor ? totalDuration * HONEST_CORRIDOR_FRACTION : 0;

    if (!waitForBlue && corridorMs && isZeroOrder(from))
      window.__somataCorridorBeginHonestZeroIntro?.(layer.id, now, corridorMs / 1000, target);
    independentOrders.set(layer.id, {
      from,
      to: target,
      start: now + (corridorMs && isZeroOrder(from) ? corridorMs : 0),
      duration: totalDuration - corridorMs,
      totalDuration,
      corridorMs,
      mode,
      config: cfg,
      instant,
      waitingForBluePhase: !instant && waitForBlue,
      waitAfterPhaseStart: clock?.active && clock.phaseStart !== 0 ? clock.phaseStart : null,
      waitAfterPhaseSerial: clock?.active && clock.phaseStart !== 0 ? clock.phaseSerial : null,
      bluePhaseStart: null,

      sourcePaths: old?.displayPaths || null,
      displayPaths: old?.displayPaths || null,
      finished: false,
      lastFrame: null,
    });
    syncTask();
    requestMainCanvasRender();
    return true;
  }
  function completeIndependentOrder(source, r) {
    if (!r.finished && r.corridorMs > 0 && !isZeroOrder(r.from) && isZeroOrder(r.to))
      window.__somataCorridorBeginHonestZeroOutro?.(source.id, r.start + r.duration, r.corridorMs / 1000);
    r.finished = true;
    independentOrders.delete(source.id);
    seed(source);
  }
  function handoffIndependentOrderToBlue(frameCtx, source, r) {
    const rt = runtimeState?.morph,
      idx = frameCtx.layerIndex;
    const a = rt?.renderSourceLayers?.[idx],
      b = rt?.renderTargetLayers?.[idx];
    if (a?.id !== source.id || b?.id !== source.id) return false;
    // Change only the order channel of this already running phase. Fresh
    // endpoint identities invalidate the shared skeleton plan, without
    // preparing another phase or changing either endpoint's N/K/profile.
    const fields = {
      spiralOrder: r.to,
      spiralEnabled: !isZeroOrder(r.to),
      spiralClosed: source.spiralClosed !== false,
      closedLoop: isZeroOrder(r.to) && source.spiralClosed !== false,
    };
    const endpoint = (old) => {
      const next = { ...old, ...fields, __somataOrderHandoff: true };
      delete next.__morphBoundaryRails;
      setPreSampledSplineLayer(next, isPreSampledSplineLayer(old));
      return next;
    };
    rt.renderSourceLayers[idx] = endpoint(a);
    rt.renderTargetLayers[idx] = endpoint(b);
    for (const visual of [rt.sourceVisuals?.[idx], rt.targetVisuals?.[idx]])
      if (visual) Object.assign(visual, fields);
    Object.assign(frameCtx.layer, fields);
    delete frameCtx.layer.__spiralOrderInterpolating;
    delete frameCtx.layer.__somataIndependentOrderCorridor;
    completeIndependentOrder(source, r);
    return true;
  }
  function independentOrderFrame(frameCtx, now = performance.now()) {
    const source = frameCtx?.sourceLayer || frameCtx?.layer;
    const r = independentOrders.get(source?.id);
    if (!r || !frameCtx?.layer) return false;
    const blueActive = frameCtx.blueMorphProvider?.active === true;
    resolvePendingOrderPhase(r, source, now);

    const live = r.instant ? { t: 1, phase: 1, eased: 1, order: r.to } : independentOrderPhase(r, now),
      layer = frameCtx.layer;
    // Do not render the completed zero crossing as a permanent rail.
    // Fall through to the ordinary Blue sampler even on the handoff frame.
    if (blueActive && live.t >= 1 && handoffIndependentOrderToBlue(frameCtx, source, r)) return false;
    if (r.instant) {
      completeIndependentOrder(source, r);
      return staticOrderFrame(frameCtx, frameCtx.layer, spiralOf(r.config));
    }
    const active = r.finished !== true && live.t < 1;
    const corridor = state.tunnel?.active === true;
    const originalOrder = Number(layer.spiralOrder) || 0;
    const sourceForGeometry = {
      ...layer,
      spiralOrder: r.from,
      spiralEnabled: Math.abs(r.from) > 1e-8,
      closedLoop: Math.abs(r.from) < 1e-8 ? layer.spiralClosed !== false : false,
    };
    const targetForGeometry = {
      ...layer,
      spiralOrder: r.to,
      spiralEnabled: Math.abs(r.to) > 1e-8,
      closedLoop: Math.abs(r.to) < 1e-8 ? layer.spiralClosed !== false : false,
    };
    // Order-only edits use the common anchor → spiral → profile path.
    {
      const blueSpec = blueActive ? SomataMorphRuntime.fromBlue(frameCtx.layerIndex) : null;
      const spec =
        blueSpec ||
        SomataMorphRuntime.describe({
          sourceLayer: sourceForGeometry,
          targetLayer: targetForGeometry,
          mode: spiralOf(r.config),
          slide: r.config.slide,
          layerIndex: frameCtx.layerIndex,
        });
      const built = SomataMorphRuntime.samplePrimary(
        spec,
        blueSpec ? frameCtx.blueMorphProvider.geometryT : live.phase,
        {
          order: live.order,
          zeroMode: r.mode,
          sharedOrder: true,
          orderOnly: !blueSpec,
          orderTransition: { from: r.from, to: r.to },
          spiralSquashY: normalizeSpiralSquashY(layer.spiralSquashY ?? source.spiralSquashY),
          layer: blueSpec?.mode === 'light' ? { ...layer, spiralOrder: live.order } : layer,
        },
      );
      if (SomataMorphRuntime.publish(frameCtx, built)) {
        layer.__spiralOrderInterpolating = active;
        frameCtx.lampAnimationMs = r.duration;
        // Explicit order presets remain independent of the morph's
        // ordinary population; they own their separate order edit.
        layer.__somataIndependentOrderCorridor = true;
        applyZeroCorridorSignals(
          layer,
          r.mode,
          r.from,
          r.to,
          live.eased,
          sourceForGeometry,
          targetForGeometry,
        );
        r.lastFrame = {
          progress: live.t,
          eased: live.eased,
          shapePhase: live.phase,
          order: live.order,
          pathCount: built.paths.length,
          prepared: true,
          primarySkeleton: true,
          blueActive,
        };
        if (live.t >= 1) completeIndependentOrder(source, r);
        return true;
      }
    }
    let bluePaths = null;
    if (blueActive && !r.sourcePaths && typeof window.__somataReadCurrentBlueCarrierPaths === 'function') {
      try {
        const candidate = window.__somataReadCurrentBlueCarrierPaths(frameCtx.layerIndex, layer) || null;

        const reference = getCachedLayerDrawData(sourceForGeometry)?.paths || [];
        if (
          Array.isArray(candidate) &&
          candidate.length === reference.length &&
          candidate.every((path, i) => path?.closed === reference[i]?.closed)
        )
          bluePaths = candidate;
      } catch (error) {
        noteSuppressedError('morph-runtime/manual-morph#independentOrderFrame', error);
      }
    }
    let rail = null,
      opacityRetargetHandoff = null;
    if (active) {
      rail = makeZeroContourRail(sourceForGeometry, targetForGeometry, r.sourcePaths || bluePaths);
      if (
        !rail?.length &&
        Array.isArray(r.sourcePaths) &&
        r.sourcePaths.length &&
        !['fade', 'continuous', 'light'].includes(spiralOf(r.config)) &&
        typeof getCachedLayerDrawData === 'function'
      ) {
        const targetPaths = getCachedLayerDrawData(targetForGeometry)?.paths || [];
        if (targetPaths.length && targetPaths.every((p) => p.closed === targetPaths[0].closed)) {
          const candidates = r.sourcePaths.filter((p) => p?.closed === targetPaths[0].closed);
          if (candidates.length === targetPaths.length) {
            const recovered = makeZeroContourRail(sourceForGeometry, targetForGeometry, candidates);
            if (recovered?.length) {
              rail = recovered;
              const others = r.sourcePaths.filter((p) => p?.closed !== targetPaths[0].closed);
              const sourceAlpha =
                candidates.reduce((sum, p) => sum + clamp(Number(p?._alpha ?? 1), 0, 1, 1), 0) /
                Math.max(1, candidates.length);
              opacityRetargetHandoff = { others, sourceAlpha };
            }
          }
        }
      }
    }
    let paths;
    if (
      active &&
      Array.isArray(r.sourcePaths) &&
      r.sourcePaths.length &&
      ['fade', 'continuous', 'light'].includes(spiralOf(r.config)) &&
      typeof getCachedLayerDrawData === 'function'
    ) {
      const targetPaths = getCachedLayerDrawData(targetForGeometry)?.paths || [];
      const phase = clamp(live.phase, 0, 1, 0),
        slideshow = spiralOf(r.config) === 'light';
      const oldWeight = slideshow ? (phase < 0.5 ? 1 : 0) : 1 - phase;
      const nextWeight = slideshow ? (phase >= 0.5 ? 1 : 0) : phase;
      if (targetPaths.length) {
        const fp = fadeFillPresence(phase, slideshow);
        paths = [
          ...r.sourcePaths.map((p) => ({
            ...p,
            _alpha: clamp(Number(p?._alpha ?? 1), 0, 1, 1) * oldWeight,
            _fillPresence: clamp(Number(p?._fillPresence ?? 1), 0, 1, 1) * fp.out,
          })),
          ...targetPaths.map((p) => ({ ...p, _alpha: nextWeight, _fillPresence: fp.next })),
        ];
      }
    }
    if (!paths && active && rail?.length) {
      paths = zeroContourByMorphMode(
        rail,
        live.phase,
        r.mode,
        'minimal',
        sourceForGeometry,
        targetForGeometry,
        spiralOf(r.config),
        r.config?.slide,
      );
      if (opacityRetargetHandoff) {
        const p = clamp(live.phase, 0, 1, 0);
        paths = [
          ...paths.map((path) => ({ ...path, _alpha: mix(opacityRetargetHandoff.sourceAlpha, 1, p) })),
          ...opacityRetargetHandoff.others.map((path) => ({
            ...path,
            _alpha: clamp(Number(path?._alpha ?? 1), 0, 1, 1) * (1 - p),
          })),
        ];
      }
    }
    if (
      !paths &&
      active &&
      Array.isArray(r.sourcePaths) &&
      r.sourcePaths.length &&
      r.sourcePaths.some((path) => Number(path?._alpha ?? 1) < 0.999999) &&
      typeof getCachedLayerDrawData === 'function'
    ) {
      const targetPaths = getCachedLayerDrawData(targetForGeometry)?.paths || [];
      const p = clamp(live.phase, 0, 1, 0);
      if (targetPaths.length) {
        const fp = fadeFillPresence(p);
        paths = [
          ...r.sourcePaths.map((path) => ({
            ...path,
            _alpha: clamp(Number(path?._alpha ?? 1), 0, 1, 1) * (1 - p),
            _fillPresence: clamp(Number(path?._fillPresence ?? 1), 0, 1, 1) * fp.out,
          })),
          ...targetPaths.map((path) => ({ ...path, _alpha: p, _fillPresence: fp.next })),
        ];
      }
    }
    if (!paths && typeof getCachedLayerDrawData === 'function')
      paths = getCachedLayerDrawData(targetForGeometry)?.paths || null;

    if (Array.isArray(paths) && paths.length) {
      const blue = frameCtx.blueMorphProvider;
      const isFade = blueActive && blue?.kind === 'blue-fade' && blue?.sourceLayer && blue?.targetLayer;
      let fadeProvider = null;
      if (isFade) {
        const morphOne = (endpoint) => {
          const before = {
            ...endpoint,
            spiralEnabled: Math.abs(r.from) > 1e-8,
            spiralOrder: r.from,
            closedLoop: Math.abs(r.from) < 1e-8 ? endpoint.spiralClosed !== false : false,
          };
          const after = {
            ...endpoint,
            spiralEnabled: Math.abs(r.to) > 1e-8,
            spiralOrder: r.to,
            closedLoop: Math.abs(r.to) < 1e-8 ? endpoint.spiralClosed !== false : false,
          };
          const frameRail = makeZeroContourRail(before, after);
          return frameRail?.length
            ? zeroContourByMorphMode(
                frameRail,
                live.phase,
                r.mode,
                'minimal',
                before,
                after,
                spiralOf(r.config),
                r.config?.slide,
              )
            : getCachedLayerDrawData(after)?.paths || [];
        };
        fadeProvider = {
          kind: 'blue-order-fade',
          active: true,
          geometryActive: true,
          progress: Number(blue.progress) || 0,
          sourceLayer: blue.sourceLayer,
          targetLayer: blue.targetLayer,
          sourcePaths: morphOne(blue.sourceLayer),
          targetPaths: morphOne(blue.targetLayer),
          framePaths: paths,
          sourceProfileMode: blue.sourceProfileMode,
          targetProfileMode: blue.targetProfileMode,
        };
      }
      frameCtx.__somataZeroOrderPrepared = true;
      frameCtx.geometryProvider = fadeProvider || {
        kind: 'blue-prepared',
        active: true,
        geometryActive: true,
        progress: live.phase,
        framePaths: paths,
        sourceProfileMode: layer.profileMode,
        targetProfileMode: layer.profileMode,
      };
      frameCtx.geometryMorphEnabled = true;
      frameCtx.topologyMorphEnabled = true;
      frameCtx.circleAngularMorphEnabled = false;
      r.displayPaths = paths;
    }

    layer.spiralOrder = live.order;
    layer.spiralEnabled = Math.abs(live.order) > 1e-8;
    layer.__spiralOrderInterpolating = active;
    layer.closedLoop = layer.spiralEnabled ? false : layer.spiralClosed !== false;

    applyZeroCorridorSignals(layer, r.mode, r.from, r.to, live.eased, sourceForGeometry, targetForGeometry);
    r.lastFrame = {
      progress: live.t,
      eased: live.eased,
      shapePhase: live.phase,
      order: live.order,
      blueActive,
      waitingForBluePhase: r.waitingForBluePhase === true,
      bluePhaseStart: r.bluePhaseStart,
      blueProgress: Number(frameCtx.blueMorphProvider?.progress) || 0,
      blueGeometryT: Number(frameCtx.blueMorphProvider?.geometryT) || 0,
      pathCount: paths?.length || 0,
      prepared: frameCtx.__somataZeroOrderPrepared === true,
      originalBlueOrder: originalOrder,
    };
    if (live.t >= 1) completeIndependentOrder(source, r);
    return true;
  }

  function blueZeroOriginal132Frame(frameCtx) {
    const blue = frameCtx?.blueMorphProvider;
    const source = frameCtx?.sourceLayer || frameCtx?.layer;
    if (
      !source ||
      !blue?.active ||
      state.tunnel?.active === true ||
      !['layerwise', 'beautiful'].includes(SomataSpiralZeroTransition.modeFor(source)) ||
      blue.mode === 'fade' ||
      blue.mode === 'light' ||
      blue.mode === 'lightning'
    )
      return false;
    const index = frameCtx.layerIndex;
    const rt = runtimeState?.morph;
    const fromLayer = rt?.renderSourceLayers?.[index];
    const toLayer = rt?.renderTargetLayers?.[index];
    if (!fromLayer || !toLayer || fromLayer.id !== source.id || toLayer.id !== source.id) return false;
    const fromOrder = fromLayer.spiralEnabled === true ? Number(fromLayer.spiralOrder) || 0 : 0;
    const toOrder = toLayer.spiralEnabled === true ? Number(toLayer.spiralOrder) || 0 : 0;
    if (isZeroOrder(fromOrder) === isZeroOrder(toOrder)) return false;

    if (independentOrders.has(source.id)) return false;
    let rec = blueZeroRails.get(source.id);
    if (!rec || rec.from !== fromLayer || rec.to !== toLayer) {
      rec = { from: fromLayer, to: toLayer, rail: makeZeroContourRail(fromLayer, toLayer) };
      blueZeroRails.set(source.id, rec);
    }
    if (!rec.rail?.length) return false;
    const morphT = clamp(blue.geometryT, 0, 1, 0);
    const phase = zeroShapePhase(
      SomataSpiralZeroTransition.modeFor(source),
      fromOrder,
      toOrder,
      morphT,
      false,
    );
    const mode = blue.mode || spiralOf(config(source));
    const slide = state.morph?.slideType || config(source).slide;
    const framePaths = zeroContourByMorphMode(
      rec.rail,
      phase,
      SomataSpiralZeroTransition.modeFor(source),
      'minimal',
      fromLayer,
      toLayer,
      mode,
      slide,
    );
    if (!framePaths?.length) return false;

    frameCtx.__somataZeroOrderPrepared = true;
    frameCtx.geometryProvider = {
      kind: 'blue-prepared',
      active: true,
      geometryActive: true,
      progress: phase,
      framePaths,
      sourceLayer: fromLayer,
      targetLayer: toLayer,
      sourceProfileMode: fromLayer.profileMode,
      targetProfileMode: toLayer.profileMode,
      modeOverride: mode,
    };
    frameCtx.geometryMorphEnabled = true;
    frameCtx.topologyMorphEnabled = true;
    frameCtx.circleAngularMorphEnabled = false;
    frameCtx.layer.spiralOrder = mix(fromOrder, toOrder, phase);
    frameCtx.layer.spiralEnabled = !isZeroOrder(frameCtx.layer.spiralOrder);
    frameCtx.layer.__spiralOrderInterpolating = true;
    frameCtx.layer.closedLoop = !frameCtx.layer.spiralEnabled && frameCtx.layer.spiralClosed !== false;
    lastBlueZero = {
      layerId: source.id,
      fromOrder,
      toOrder,
      phase,
      pathCount: framePaths.length,
      provider: frameCtx.geometryProvider.kind,
      corridor: false,
    };
    return true;
  }
  function syncSpeedUI() {
    const speed = document.getElementById('testMorphSpeedType');
    const blue = document.getElementById('morphSpeedType');
    const val = state.morph?.speedType || 'linear';
    if (speed && [...speed.options].some((o) => o.value === val)) speed.value = val;
    if (blue && [...blue.options].some((o) => o.value === val)) blue.value = val;
  }
  function applyFrame(frameCtx, now = performance.now()) {
    const source = frameCtx?.sourceLayer || frameCtx?.layer,
      layer = frameCtx?.layer;
    if (!source || !layer) return false;
    const cfg = config(source),
      id = source.id;

    frameCtx.__somataZeroOrderPrepared = false;
    frameCtx.__somataSkeletonFrame = null;
    if (cfg.enabled !== true) {
      if (independentOrders.get(id)?.instant && frameCtx.blueMorphProvider?.active)
        independentOrderFrame(frameCtx, now);
      dynamic.delete(id);
      independentOrders.delete(id);
      window.__somataCorridorStopHonestZeroOutro?.(id);
      window.__somataCorridorStopHonestZeroIntro?.(id);

      const blueRestored = Boolean(
        frameCtx.blueMorphProvider?.active &&
        !frameCtx.minimalFadeEnabled &&
        !frameCtx.greenMorphEnabled &&
        !frameCtx.orangeMorphProvider?.active &&
        !frameCtx.greenMorphProvider?.active &&
        (blueSharedSkeletonFrame(frameCtx) || blueZeroOriginal132Frame(frameCtx)),
      );
      syncTask();
      return (
        blueRestored ||
        (!frameCtx.blueMorphProvider?.active &&
          !frameCtx.minimalFadeEnabled &&
          !frameCtx.greenMorphEnabled &&
          !frameCtx.orangeMorphProvider?.active &&
          !frameCtx.greenMorphProvider?.active &&
          staticOrderFrame(frameCtx, layer, modeForLayer(cfg, layer)))
      );
    }

    if (
      independentOrders.has(id) &&
      !frameCtx.minimalFadeEnabled &&
      !frameCtx.greenMorphEnabled &&
      !frameCtx.orangeMorphProvider?.active &&
      !frameCtx.greenMorphProvider?.active
    ) {
      const composed = independentOrderFrame(frameCtx, now);
      if (composed) {
        syncTask();
        return true;
      }
    }

    if (
      frameCtx.blueMorphProvider?.active &&
      !frameCtx.minimalFadeEnabled &&
      !frameCtx.greenMorphEnabled &&
      !frameCtx.orangeMorphProvider?.active &&
      !frameCtx.greenMorphProvider?.active &&
      blueSharedSkeletonFrame(frameCtx)
    ) {
      syncTask();
      return true;
    }
    if (
      frameCtx.blueMorphProvider?.active &&
      !frameCtx.minimalFadeEnabled &&
      !frameCtx.greenMorphEnabled &&
      !frameCtx.orangeMorphProvider?.active &&
      !frameCtx.greenMorphProvider?.active &&
      blueZeroOriginal132Frame(frameCtx)
    ) {
      syncTask();
      return true;
    }

    if (
      frameCtx.blueMorphProvider?.active ||
      frameCtx.minimalFadeEnabled ||
      frameCtx.greenMorphEnabled ||
      frameCtx.orangeMorphProvider?.active ||
      frameCtx.greenMorphProvider?.active
    ) {
      seed(source);
      syncTask();
      return false;
    }
    let r = dynamic.get(id),
      target = capture(source);
    if (!r) {
      seed(source);
      return (
        staticOrderFrame(frameCtx, layer, modeForLayer(cfg, layer)) ||
        (SomataMorphRegistry.usesCoordinatedSpine(modeForLayer(cfg, layer)) &&
          coordinatedRestFrame(frameCtx, layer, modeForLayer(cfg, layer)))
      );
    }

    const polygonEdit = source.spiralEnabled !== true && Math.abs(Number(source.spiralOrder) || 0) < 1e-8;
    if (polygonEdit) {
      const mode = config(source).mode,
        baseline = r.visual || r.observed || target;
      const lockN = mode === 'continuous' || mode === 'phase';
      const lockK = mode === 'continuous' || mode === 'minimalTurn';
      if (lockN) {
        target.N = copy(baseline.N);
        source.N = copy(baseline.N);
        layer.N = copy(baseline.N);
      }
      if (lockK) {
        target.K = copy(baseline.K);
        source.K = copy(baseline.K);
        layer.K = copy(baseline.K);
      }
    }

    const spiralInFlight =
      r.active === true &&
      [r.from, r.to, target].some(
        (v) => v?.spiralEnabled === true && Math.abs(Number(v?.spiralOrder) || 0) > 1e-8,
      );
    if (spiralInFlight && !same(target, r.observed)) r.queuedTarget = copy(target);
    if (!same(target, r.observed) && !spiralInFlight) {
      window.__somataCorridorStopHonestZeroOutro?.(id);
      window.__somataCorridorStopHonestZeroIntro?.(id);
      const start = r.visual || r.observed;
      const onlyManualOrder = Boolean(
        r.manualOrder &&
        observedKeys.every(
          (key) =>
            ['spiralOrder', 'spiralEnabled', 'spiralClosed', 'closedLoop'].includes(key) ||
            !differs(start, target, key),
        ),
      );
      const totalDuration = clamp(cfg.duration, 0.1, 60, 1) * 1000;
      r = {
        observed: target,
        from: copy(start),
        to: copy(target),
        visual: copy(start),
        start: now,
        duration: totalDuration,
        totalDuration,
        corridorMs: 0,
        active: true,
        manualOrder: onlyManualOrder,
        configAtStart: { ...cfg },
      };
      const zeroOrders = zeroPairOrder(r.from, r.to);
      const sourceOverride = dynamic.get(id)?.sourceOverride;
      if ((zeroOrders || sourceOverride) && onlyManualOrder) {
        r.zeroOrders = zeroOrders || {
          from: Number(r.from.spiralOrder) || 0,
          to: Number(r.to.spiralOrder) || 0,
        };
        r.zeroMode = SomataSpiralZeroTransition.modeFor(source);
        r.zeroNamedMode = spiralOf(cfg);
        r.zeroSlide = cfg.slide;
        r.zeroRail = makeZeroContourRail({ ...source, ...r.from }, { ...source, ...r.to }, sourceOverride);

        if (!r.zeroRail) console.warn('[Somata] zero-order contour preparation unavailable');
        if (
          r.zeroMode === 'honest' &&
          state.tunnel?.active === true &&
          isZeroOrder(r.zeroOrders.from) !== isZeroOrder(r.zeroOrders.to)
        ) {
          r.corridorMs = totalDuration * HONEST_CORRIDOR_FRACTION;
          r.duration = totalDuration - r.corridorMs;
          if (isZeroOrder(r.zeroOrders.from)) {
            r.start = now + r.corridorMs;
            window.__somataCorridorBeginHonestZeroIntro?.(id, now, r.corridorMs / 1000, r.zeroOrders.to);
          }
        }
      }

      r.fromEndpoint = { ...source, ...r.from, __somataStaticEditEndpoint: true };
      r.toEndpoint = { ...source, ...r.to, __somataStaticEditEndpoint: true };
      dynamic.set(id, r);

      syncTask();
    }
    if (!r.active)
      return (
        staticOrderFrame(frameCtx, layer, modeForLayer(cfg, layer)) ||
        (SomataMorphRegistry.usesCoordinatedSpine(modeForLayer(cfg, layer)) &&
          coordinatedRestFrame(frameCtx, layer, modeForLayer(cfg, layer)))
      );

    const activeCfg = r.configAtStart || cfg;
    const t = clamp((now - r.start) / r.duration, 0, 1, 0),
      u = easing(t, activeCfg);
    const visual = sample(r.from, r.to, t, activeCfg);

    r.visual = visual;

    const isSpiral = [source, r.from, r.to].some(
      (v) => v?.spiralEnabled === true || Math.abs(Number(v?.spiralOrder) || 0) > 1e-8,
    );
    const structural = hasStructuralChange(r.from, r.to);
    const mode = isSpiral ? spiralOf(activeCfg) : activeCfg.mode;
    const geometryChanged = observedKeys.some((k) => differs(r.from, r.to, k));

    const resolvedSpiralType = SPIRAL_TYPES.has(mode) ? mode : 'phaseCircle';

    const changedN = differs(r.from, r.to, 'N');
    const changedK = differs(r.from, r.to, 'K');

    const axisNeedsFade =
      (resolvedSpiralType === 'continuous' && (changedN || changedK)) ||
      (resolvedSpiralType === 'phase' && changedN) ||
      (resolvedSpiralType === 'minimalTurn' && changedK);
    const angularSpiralEdit = Boolean(
      !axisNeedsFade &&
      isSpiral &&
      structural &&
      r.from.spiralEnabled === true &&
      r.to.spiralEnabled === true &&
      Math.abs(Number(r.from.spiralOrder) || 0) > 1e-8 &&
      Math.abs(Number(r.to.spiralOrder) || 0) > 1e-8 &&
      structuralKeys.every(
        (key) => key === 'N' || key === 'K' || key === 'spiralTangential' || !differs(r.from, r.to, key),
      ) &&
      (differs(r.from, r.to, 'N') || differs(r.from, r.to, 'K') || differs(r.from, r.to, 'spiralTangential')),
    );

    const retainedSpiralPair = Boolean(
      isSpiral &&
      r.from.spiralEnabled === true &&
      r.to.spiralEnabled === true &&
      Math.abs(Number(r.from.spiralOrder) || 0) > 1e-8 &&
      Math.abs(Number(r.to.spiralOrder) || 0) > 1e-8,
    );

    const useContinuousSpiralFade = Boolean(
      isSpiral && structural && axisNeedsFade && (resolvedSpiralType === 'continuous' || !retainedSpiralPair),
    );
    const editSpec = SomataMorphRuntime.describe({
      sourceLayer: r.fromEndpoint,
      targetLayer: r.toEndpoint,
      layerIndex: frameCtx.layerIndex,
      mode,
      slide: activeCfg.slide,
      origin: 'manual',
    });
    const corridorOrderSequenced = window.__somataCorridorOrderChangeActive?.(id) === true;
    const orderPair = zeroPairOrder(r.from, r.to);
    const zeroMode = r.zeroMode || SomataSpiralZeroTransition.modeFor(source);
    const withCorridor = state.tunnel?.active === true;
    const orderT = !withCorridor && ['layerwise', 'beautiful'].includes(zeroMode) ? t : u;
    const zeroPlan = orderPair
      ? window.SomataSpiralZeroTransition.plan(zeroMode, orderPair.from, orderPair.to, orderT, withCorridor)
      : null;
    const primary = geometryChanged
      ? SomataMorphRuntime.samplePrimary(editSpec, zeroPlan?.shapeT ?? u, {
          layer: { ...layer, ...visual },
          order: zeroPlan?.order,
          zeroMode,
          spiralSquashY: normalizeSpiralSquashY(source.spiralSquashY),
        })
      : null;
    let cpuEditDrawn = false;
    if (primary) {
      for (const key of observedKeys) if (key in visual) layer[key] = copy(visual[key]);
      cpuEditDrawn = SomataMorphRuntime.publish(frameCtx, primary, { structural });
      if (cpuEditDrawn) {
        frameCtx.lampAnimationMs = r.duration;
        frameCtx.geometryProvider.lampPhase = { elapsed: t * r.duration, duration: r.duration, id: r };
      }
      if (zeroPlan) {
        applyZeroCorridorSignals(
          layer,
          zeroMode,
          orderPair.from,
          orderPair.to,
          u,
          r.fromEndpoint,
          r.toEndpoint,
        );
        if (Math.abs(primary.order) > 1e-8 && t < 1) layer.__spiralOrderInterpolating = true;
        r.visual.spiralOrder = primary.order;
        r.currentZeroPhase = zeroShapePhase(zeroMode, orderPair.from, orderPair.to, orderT, withCorridor);
      }
    }
    const gpuEditAccepted = false;
    if (!cpuEditDrawn && r.zeroRail) {
      const phase = zeroShapePhase(
        r.zeroMode,
        r.zeroOrders.from,
        r.zeroOrders.to,
        state.tunnel?.active !== true && ['layerwise', 'beautiful'].includes(r.zeroMode) ? t : u,
        state.tunnel?.active === true,
      );
      const prepared = zeroContourByMorphMode(
        r.zeroRail,
        phase,
        r.zeroMode,
        'minimal',
        r.fromEndpoint,
        r.toEndpoint,
        mode,
        activeCfg.slide,
      );
      r.currentZeroPhase = phase;
      r.displayPaths = prepared;
      if (t < 1 && t > 0) {
        frameCtx.__somataZeroOrderPrepared = true;
        frameCtx.geometryProvider = {
          kind: 'blue-prepared',
          active: true,
          geometryActive: true,
          origin: 'manual',
          progress: phase,
          framePaths: prepared,
          sourceLayer: r.fromEndpoint,
          targetLayer: r.toEndpoint,
          sourceProfileMode: r.fromEndpoint.profileMode,
          targetProfileMode: r.toEndpoint.profileMode,
        };
        frameCtx.lampAnimationMs = r.duration;
        frameCtx.geometryMorphEnabled = true;
        frameCtx.topologyMorphEnabled = true;
      }
    }
    if (geometryChanged && !cpuEditDrawn && !isSpiral && typeof getCachedLayerDrawData === 'function') {
      const a = r.fromEndpoint,
        b = r.toEndpoint;
      if (!r.sourceData) r.sourceData = getCachedLayerDrawData(a);
      if (!r.targetData) r.targetData = getCachedLayerDrawData(b);
      const provider = {
        active: true,
        geometryActive: true,
        progress: u,
        slideTypeOverride: activeCfg.slide,
        modeOverride: mode,
        sourceLayer: a,
        targetLayer: b,
        sourceData: r.sourceData,
        targetData: r.targetData,
        sourceProfileMode: a.profileMode,
        targetProfileMode: b.profileMode,
      };

      const polygonFixedAxisFade = false;
      if (mode === 'fade') provider.kind = 'blue-fade';
      else if (
        [
          'circleSlide',
          'topoCircle',
          'topoCircleOpacity',
          'phase',
          'minimalTurn',
          'phaseCircle',
          'coordinated',
          'coordinatedFromCenter',
        ].includes(mode)
      )
        provider.kind = 'blue-circle-slide';
      else provider.kind = 'blue-anchor-linear';
      frameCtx.geometryProvider = provider;
      frameCtx.geometryMorphEnabled = true;
      frameCtx.topologyMorphEnabled = structural;
    }
    if (!cpuEditDrawn) {
      for (const key of observedKeys) {
        if (key in visual) layer[key] = copy(visual[key]);
      }

      window.SomataSpiralZeroTransition.applyCorridorFrame(layer, null, 0, 0, 0, false);
      if (r.zeroOrders && r.zeroRail) {
        applyZeroCorridorSignals(
          layer,
          r.zeroMode,
          r.zeroOrders.from,
          r.zeroOrders.to,
          u,
          r.fromEndpoint,
          r.toEndpoint,
        );
      }
      if (isSpiral) {
        const a = r.from.spiralEnabled === true ? Number(r.from.spiralOrder) || 0 : 0;
        const b = r.to.spiralEnabled === true ? Number(r.to.spiralOrder) || 0 : 0;
        const withCorridor = state.tunnel?.active === true && isZeroOrder(a) !== isZeroOrder(b);

        const plan = window.SomataSpiralZeroTransition?.plan(
          SomataSpiralZeroTransition.modeFor(source),
          a,
          b,
          u,
          withCorridor,
          true,
        );
        if (plan?.zeroEndpoint) {
          applyZeroCorridorSignals(
            layer,
            SomataSpiralZeroTransition.modeFor(source),
            a,
            b,
            u,
            r.fromEndpoint,
            r.toEndpoint,
          );
          layer.spiralEnabled = true;
          layer.spiralOrder = plan.order;
          layer.__spiralOrderInterpolating = true;
          layer.closedLoop = Math.abs(layer.spiralOrder) < 1e-8 ? layer.spiralClosed !== false : false;
          r.visual.spiralOrder = layer.spiralOrder;
        }
      }

      if (isSpiral) {
        const fromOrder = r.from.spiralEnabled === true ? Number(r.from.spiralOrder) || 0 : 0;
        const toOrder = r.to.spiralEnabled === true ? Number(r.to.spiralOrder) || 0 : 0;
        const start =
          Math.abs(fromOrder) > 1e-8
            ? Number.isFinite(r.from.__spiralTangentialMix)
              ? r.from.__spiralTangentialMix
              : r.from.spiralTangential === true
                ? 1
                : 0
            : 0;
        const end = Math.abs(toOrder) > 1e-8 && r.to.spiralTangential === true ? 1 : 0;

        layer.__spiralTangentialMix = mix(start, end, u);
        if (Math.abs(Number(layer.spiralOrder) || 0) <= 1e-8) layer.__spiralTangentialMix = 0;
        r.visual.__spiralTangentialMix = layer.__spiralTangentialMix;
      }
      if (angularSpiralEdit) {
        const startN = Math.max(2, Number(r.from.N) || 2),
          targetN = Math.max(2, Number(r.to.N) || startN);
        const startK = Math.max(1, Number(r.from.K) || 1),
          targetK = Math.max(1, Number(r.to.K) || startK);
        const fractionalN = mix(startN, targetN, u),
          fractionalK = mix(startK, targetK, u);
        layer.N = Math.max(2, Math.round(fractionalN));
        layer.K = Math.max(1, Math.round(fractionalK));
        layer.__spiralAnimatedN = fractionalN;
        layer.__spiralAnimatedK = fractionalK;

        r.visual.N = layer.N;
        r.visual.K = layer.K;
      }

      if (
        isSpiral &&
        structural &&
        !angularSpiralEdit &&
        !r.manualOrder &&
        (useContinuousSpiralFade || (!gpuEditAccepted && !cpuEditDrawn)) &&
        t < 1
      ) {
        const fraction = u < 0.5 ? 1 - 2 * u : 2 * u - 1;
        const endpoint = u < 0.5 ? r.from : r.to;
        for (const key of observedKeys) if (key in endpoint) layer[key] = copy(endpoint[key]);

        if (resolvedSpiralType === 'phase' && changedN) {
          const movingK = mix(Number(r.from.K) || 1, Number(r.to.K) || 1, u);
          layer.K = Math.max(1, Math.round(movingK));
          layer.__spiralAnimatedK = movingK;
        } else if (resolvedSpiralType === 'minimalTurn' && changedK) {
          const movingN = mix(Number(r.from.N) || 2, Number(r.to.N) || 2, u);
          layer.N = Math.max(2, Math.round(movingN));
          layer.__spiralAnimatedN = movingN;
        }
        const opacity = Number(endpoint.opacity ?? layer.opacity);
        layer.opacity = (Number.isFinite(opacity) ? opacity : 100) * Math.max(0, Math.min(1, fraction));

        r.visual = copy(endpoint);
        if (resolvedSpiralType === 'phase' && changedN) r.visual.K = layer.K;
        if (resolvedSpiralType === 'minimalTurn' && changedK) r.visual.N = layer.N;
      }
    }
    if (
      cpuEditDrawn &&
      cfg.showSkeleton &&
      geometryChanged &&
      !Array.isArray(frameCtx.__somataSkeletonFrame) &&
      !r.zeroRail &&
      !r.manualOrder &&
      !corridorOrderSequenced
    ) {
      const skeletonSpec =
        editSpec ||
        SomataMorphRuntime.describe({
          sourceLayer: r.fromEndpoint,
          targetLayer: r.toEndpoint,
          mode,
          slide: activeCfg.slide,
          layerIndex: frameCtx.layerIndex,
        });
      frameCtx.__somataSkeletonFrame = SomataMorphRuntime.sampleSkeleton(skeletonSpec, u, { layer });
    }
    if (t >= 1) {
      window.__somataCorridorStopHonestZeroIntro?.(id);

      const fromOrder = r.from.spiralEnabled === true ? Number(r.from.spiralOrder) || 0 : 0;
      const toOrder = r.to.spiralEnabled === true ? Number(r.to.spiralOrder) || 0 : 0;
      if (
        SomataSpiralZeroTransition.modeFor(source) === 'honest' &&
        state.tunnel?.active === true &&
        r.corridorMs > 0 &&
        Math.abs(fromOrder) > 1e-8 &&
        Math.abs(toOrder) < 1e-8
      ) {
        window.__somataCorridorBeginHonestZeroOutro?.(id, r.start + r.duration, (r.corridorMs || 0) / 1000);
      }
      r.active = false;
      r.visual = copy(r.to);
      syncTask();

      requestMainCanvasRender();
    }
    applied++;
    last = {
      layerId: id,
      progress: t,
      eased: u,
      zeroTransitionMode: r.zeroMode || null,
      zeroContourPhase: Number.isFinite(r.currentZeroPhase) ? r.currentZeroPhase : null,
      zeroContourPaths: r.zeroRail?.length || 0,
      spiralType: activeCfg.spiralType,
      transitioning: t < 1,
      sourceN: r.from.N,
      renderN: layer.N,
      targetN: r.to.N,
      sourceK: r.from.K,
      renderK: layer.K,
      targetK: r.to.K,
      renderRotation: layer.rotation,
      structural,
      mode,
      strictSpiral: isSpiral,
      topologyEndpointFade:
        isSpiral &&
        structural &&
        !angularSpiralEdit &&
        (useContinuousSpiralFade || (!gpuEditAccepted && !cpuEditDrawn)),
      axisNeedsFade,
      angularSpiralEdit,
      angularN: Number(layer.__spiralAnimatedN),
      angularK: Number(layer.__spiralAnimatedK),
      retainedGpuEdit: gpuEditAccepted,
      cpuStableSpiralEdit: cpuEditDrawn,
      queuedSpiralRetarget: !!r.queuedTarget,
      forcedContinuousFade: useContinuousSpiralFade === true,
    };
    return true;
  }
  function phase(layer, now = performance.now()) {
    const r = dynamic.get(layer?.id),
      cfg = config(layer);
    const total = r?.totalDuration || clamp(cfg.duration, 0.1, 60, 1) * 1000;
    const start =
      r?.start - (r?.corridorMs && Math.abs(Number(r?.from?.spiralOrder) || 0) < 1e-8 ? r.corridorMs : 0);
    const progress = r?.active ? clamp((now - start) / total, 0, 1, 0) : 1;
    return { progress, eased: easing(progress, cfg), duration: total };
  }
  function syncModeOptions(mode = config(selectLayer()).mode) {
    const definition = window.SomataMorphRegistry.get(mode);
    const visible = {
      slide: !!definition && definition.slideSetting !== false,
      fade: definition?.fadeSetting === true,
      spiralStepLimiter: mode === 'phaseCircle',
    };
    document.querySelectorAll('#testMorphControls [data-morph-option]').forEach((row) => {
      row.classList.toggle('hidden', !visible[row.dataset.morphOption]);
    });
    const fade = document.getElementById('testMorphFadePercent');
    if (fade) fade.value = String(state.morph?.fadePercent ?? 0);
    const fadePercentReadout = document.getElementById('testMorphFadePercentReadout');
    if (fadePercentReadout) fadePercentReadout.value = `${state.morph?.fadePercent ?? 0}%`;
  }
  function syncUI() {
    const layer = selectLayer(),
      cfg = config(layer),
      enabled = document.getElementById('testMorphEnabled');

    if (layer && lastPresentedLayer !== layer && typeof window.__somataSyncBlueFromGeometry === 'function') {
      lastPresentedLayer = layer;
      window.__somataSyncBlueFromGeometry(cfg.mode, cfg.slide, cfg.spiralMode);
    }
    if (enabled) enabled.checked = cfg.enabled === true;
    const group = document.getElementById('testMorphControls');
    group?.classList.toggle('hidden', cfg.enabled !== true);

    document.getElementById('testMorphModeRow')?.classList.remove('hidden');
    const mode = document.getElementById('testMorphMode');
    if (mode) mode.value = cfg.mode;
    const spiralMode = document.getElementById('testMorphSpiralMode');
    if (spiralMode) {
      spiralMode.value = cfg.spiralMode;
      // Fade и Слайдшоу — общие для кадра: спираль следует типу многоугольника.
      const shared = FRAME_LEVEL_MODES.has(cfg.mode);
      spiralMode.disabled = shared;
      if (shared) spiralMode.value = '';
      spiralMode.title = shared ? 'Для Fade и Слайдшоу тип спирали совпадает с типом многоугольника' : '';
    }
    const slide = document.getElementById('testMorphSlide');
    if (slide) slide.value = cfg.slide;
    syncModeOptions(cfg.mode);
    const duration = document.getElementById('testMorphDuration');
    const sync = document.getElementById('testMorphSyncWithMorph');
    if (sync) sync.checked = cfg.syncWithMorph === true;
    if (duration) {
      duration.disabled = false;
      if (cfg.syncWithMorph !== true) {
        duration.min = '0.1';
        duration.max = '60';
        if (document.activeElement !== duration) duration.value = String(cfg.duration);
      }
      duration.title = cfg.syncWithMorph === true
        ? 'Длительность фазы синего морфа с учётом множителя. Ручное изменение отключает TAP для синего морфа.'
        : '';
    }
    syncGeometryMorphDuration();
    syncSpeedUI();
  }
  function updateTask() {
    for (const layer of state.layers || []) {
      if (config(layer).enabled !== true) {
        dynamic.delete(layer.id);
        independentOrders.delete(layer.id);
        continue;
      }
      if (!dynamic.has(layer.id)) seed(layer);
    }
    const ids = new Set((state.layers || []).map((l) => l.id));
    for (const id of dynamic.keys()) if (!ids.has(id)) dynamic.delete(id);
    for (const id of independentOrders.keys()) if (!ids.has(id)) independentOrders.delete(id);
    syncTask();
    requestMainCanvasRender();
  }
  function change(key, val) {
    const current = selectLayer();
    if (!current) return;
    const targets = state.masterLayerEdit === true ? state.layers : [current];
    for (const layer of targets) {
      const previous = config(layer);
      const mode = key === 'mode' ? SomataMorphRuntime.modeOf(val) : previous.mode;
      const spiralMode = key === 'spiralMode' ? SomataMorphRuntime.modeOf(val) : previous.spiralMode;
      const effectiveSpiral = FRAME_LEVEL_MODES.has(mode) ? mode : spiralMode;
      layer.testMorph = {
        ...previous,
        [key]: val,
        mode,
        spiralMode,
        unifiedModeVersion: 5,
        spiralType: SPIRAL_TYPES.has(effectiveSpiral) ? effectiveSpiral : 'phaseCircle',
        spiralTypeExplicit: false,
      };
      if (key === 'enabled') {
        if (val === true) seed(layer);
        else dynamic.delete(layer.id);
      }
    }
    updateTask();
    syncUI();
    if (key === 'mode' || key === 'spiralMode' || key === 'slide') {
      const cfg = config(current);
      window.__somataSyncBlueFromGeometry?.(cfg.mode, cfg.slide, cfg.spiralMode);
    }
  }

  function syncFromBlue(rawMode, rawSlide, rawSpiralMode = null) {
    const current = selectLayer();
    if (!current) return false;
    const mode = SomataMorphRuntime.modeOf(rawMode);
    const slide = SLIDES.has(rawSlide) ? rawSlide : defaults.slide;
    const targets = state.masterLayerEdit === true ? state.layers : [current];
    let changed = false;
    for (const layer of targets) {
      const previous = config(layer);
      const spiralMode =
        rawSpiralMode == null ? previous.spiralMode : SomataMorphRuntime.modeOf(rawSpiralMode);
      if (previous.mode === mode && previous.slide === slide && previous.spiralMode === spiralMode) continue;
      const effectiveSpiral = FRAME_LEVEL_MODES.has(mode) ? mode : spiralMode;
      layer.testMorph = {
        ...previous,
        mode,
        spiralMode,
        slide,
        unifiedModeVersion: 5,
        spiralType: SPIRAL_TYPES.has(effectiveSpiral) ? effectiveSpiral : 'phaseCircle',
        spiralTypeExplicit: false,
      };
      changed = true;
    }
    if (changed) {
      updateTask();
      syncUI();
    }
    return changed;
  }
  function init() {
    const options = [
      ['testMorphEnabled', 'enabled', (el) => el.checked],
      ['testMorphMode', 'mode', (el) => (MORPH_TYPES.has(el.value) ? el.value : defaults.mode)],
      [
        'testMorphSpiralMode',
        'spiralMode',
        (el) =>
          MORPH_TYPES.has(el.value) && !FRAME_LEVEL_MODES.has(el.value) ? el.value : defaults.spiralMode,
      ],
      ['testMorphSlide', 'slide', (el) => (SLIDES.has(el.value) ? el.value : defaults.slide)],
      ['testMorphDuration', 'duration', (el) => clamp(el.value, 0.1, 60, 1)],
      ['testMorphSyncWithMorph', 'syncWithMorph', (el) => el.checked === true],
    ];
    for (const [id, key, read] of options) {
      const el = document.getElementById(id);
      if (!el) continue;
      const handler = () => {
        if (key === 'duration' && config(selectLayer()).syncWithMorph === true) {
          // Commit on change (including the existing stepper), not while typing.
          setSyncedBluePhaseDurationSec(el.value);
          syncTapTimingIndicators();
          syncMorphIntervalQuickButtons();
          el.value = String(Math.round((synchronizedBlueClock()?.durationMs || 1000)) / 1000);
          requestMainCanvasRender();
          return;
        }
        change(key, read(el));
      };
      el.addEventListener('change', handler);
      if (key === 'duration') el.addEventListener('input', () => {
        if (config(selectLayer()).syncWithMorph !== true) handler();
      });
    }
    // Use Blue's existing controls and event bindings; these are not new project settings.
    document.getElementById('testMorphFadePercent')?.addEventListener('input', (e) => {
      const original = document.getElementById('morphFadePercent');
      if (!original) return;
      original.value = e.target.value;
      original.dispatchEvent(new Event('input', { bubbles: true }));
    });
    document.getElementById('testMorphSpeedType')?.addEventListener('change', (e) => {
      const val = e.target.value;
      if (!document.querySelector(`#morphSpeedType option[value="${val}"]`)) return;
      state.morph.speedType = val;
      syncSpeedUI();
      requestMainCanvasRender();
    });

    const stepPicker = (id, direction) => {
      const el = document.getElementById(id);
      if (!el || el.disabled) return;
      const items = Array.from(el.options).filter((o) => o.value && !o.disabled && !o.hidden);
      if (!items.length) return;
      const index = items.findIndex((o) => o.value === el.value);
      const next =
        index < 0
          ? direction > 0
            ? 0
            : items.length - 1
          : (index + direction + items.length) % items.length;
      const value = items[next].value;
      if (value === el.value) return;
      el.value = value;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    };
    for (const [id, selectId, direction] of [
      ['btnTestMorphModePrev', 'testMorphMode', -1],
      ['btnTestMorphModeNext', 'testMorphMode', 1],
      ['btnTestMorphSpiralModePrev', 'testMorphSpiralMode', -1],
      ['btnTestMorphSpiralModeNext', 'testMorphSpiralMode', 1],
      ['btnTestMorphSlidePrev', 'testMorphSlide', -1],
      ['btnTestMorphSlideNext', 'testMorphSlide', 1],
      ['btnTestMorphSpeedPrev', 'testMorphSpeedType', -1],
      ['btnTestMorphSpeedNext', 'testMorphSpeedType', 1],
    ])
      document.getElementById(id)?.addEventListener('click', () => stepPicker(selectId, direction));

    for (const id of ['paramSpiralOrder', 'paramSpiralEnabled']) {
      const el = document.getElementById(id);
      el?.addEventListener('change', () => queueMicrotask(syncUI));
    }
    syncUI();
    updateTask();
  }
  window.addEventListener('load', init);
  // Запомнить слои как есть, без анимации. Нужен при остановке Blue: пока Blue рисует общий
  // скелет, TAP не обновляет «наблюдаемое» состояние, и после остановки он принял бы
  // зафиксированные на стыках фазы значения за правку и проиграл бы переход ещё раз.
  function seedLayers(layers) {
    for (const layer of layers || []) if (layer?.id != null && !independentOrders.has(layer.id)) seed(layer);
    syncTask();
  }

  return Object.freeze({
    applyFrame,
    seedLayers,
    syncUI,
    syncModeOptions,
    syncSpeedUI,
    prepareManualOrderEdit,
    settleManualOrder,
    beginIndependentOrderEdit,
    independentOrderTarget,
    independentOrderStatus: () =>
      [...independentOrders].map(([id, r]) => ({
        id,
        from: r.from,
        to: r.to,
        start: r.start,
        waitingForBluePhase: r.waitingForBluePhase === true,
        bluePhaseStart: r.bluePhaseStart,
        duration: r.duration,
        mode: r.mode,
        finished: r.finished,
        ...r.lastFrame,
      })),
    blueZeroStatus: () => (lastBlueZero ? { ...lastBlueZero } : null),
    segmentStatus: () => {
      const selected = selectLayer(),
        id = selected?.id;
      const r = independentOrders.get(id) || dynamic.get(id);
      const paths = r?.displayPaths || [];
      const lengths = paths.map((path) =>
        (path.points || []).reduce(
          (total, p, i, arr) => (i ? total + Math.hypot(p.x - arr[i - 1].x, p.y - arr[i - 1].y) : total),
          0,
        ),
      );
      return {
        active: !!r && r.finished !== true && (r.active === true || independentOrders.has(id)),
        mode: r?.mode || r?.zeroMode || SomataSpiralZeroTransition.modeFor(selected),
        independent: independentOrders.has(id),
        corridorActive: state.tunnel?.active === true,
        from: r?.from?.spiralOrder ?? r?.from ?? null,
        to: r?.to?.spiralOrder ?? r?.to ?? null,
        order: r?.lastFrame?.order ?? null,
        phase: r?.lastFrame?.shapePhase ?? r?.currentZeroPhase ?? null,
        branchCount: paths.length,
        nonDegenerateBranches: lengths.filter((x) => x > 1e-6).length,
        minLength: lengths.length ? Math.min(...lengths) : null,
        maxLength: lengths.length ? Math.max(...lengths) : null,
        totalLength: lengths.reduce((a, b) => a + b, 0),
        blueActive: r?.lastFrame?.blueActive === true,
        blueGeometryT: r?.lastFrame?.blueGeometryT ?? null,
        note: 'Развёртывание использует текущую фазу анимации без дополнительной хореографии Corridor. У остальных режимов свои правила перехода через нулевой порядок.',
      };
    },
    updateTask,
    config,
    phase,
    syncFromBlue,
    unifiedModes: () => [...MORPH_TYPES],
    status: () => ({
      active: anyActive(),
      applied,
      last,
      transitions: [...dynamic]
        .filter(([, r]) => r.active)
        .map(([id, r]) => ({
          id,
          from: r.from,
          to: r.to,
          visualOrder: Number(r.visual?.spiralOrder) || 0,
          manualOrder: r.manualOrder === true,
          zeroTransitionMode: r.zeroMode || null,
          zeroContourPaths: r.zeroRail?.length || 0,
          zeroContourPhase: r.currentZeroPhase ?? null,
          start: r.start,
          duration: r.duration,
          totalDuration: r.totalDuration,
          corridorMs: r.corridorMs || 0,
        })),
    }),
  });
})();
window.SomataTestMorph = SomataTestMorph;
