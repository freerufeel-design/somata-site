import '../geometry/polyline-rounding.js'; // initialisation order: this module runs after it
import { MAX_ROUNDING_PERCENT, getRoundingStrength } from '../core/palette.js';
import { state } from '../core/state.js';
import { GeometryKernel } from '../geometry/kernel.js';
import { getMotionTunnelLagRadians } from '../effects/motion.js';
import { normalizeSplineRenderMode, useSmoothSplinePath } from '../geometry/profile-model.js';
import { splinePathForDraw } from '../geometry/spline-rounding.js';
import { isSpiralLayer } from '../geometry/spiral/order-params.js';
import { createLampRenderedPathSampler } from '../lamps/lamp-anchors.js';
import { SomataFrameContourService } from '../geometry/frame-contour.js';
import { ghostFillLayout } from '../morph-runtime/blue/fill-lookahead.js';
import { roundPolylineForDraw } from '../geometry/polyline-rounding.js';
import { noteSuppressedError } from '../core/suppressed-errors.js';

var FillMeshPreparer = (() => {
  let cache = new WeakMap();
  let dynamicCache = new WeakMap();
  let frameContourCache = new WeakMap();
  let spiralMorphCache = new WeakMap();
  let spiralInterwindingCache = new WeakMap();
  let evictedMeshes = [];
  const MAX_VARIANTS_PER_DRAW_DATA = 16;
  const EPS = 1e-8;
  let builds = 0,
    hits = 0,
    contoursSeen = 0,
    degenerateContours = 0;
  let variantEvictions = 0,
    preparedFrames = 0,
    skippedFrames = 0;
  let sourcePoints = 0,
    emittedEdges = 0,
    fanBytes = 0,
    linearPlans = 0;
  let dynamicBuilds = 0,
    dynamicReuses = 0,
    dynamicSourcePoints = 0,
    dynamicEdges = 0,
    dynamicFanBytes = 0;

  function samePoint(a, b) {
    return Math.abs(Number(a?.x) - Number(b?.x)) <= EPS && Math.abs(Number(a?.y) - Number(b?.y)) <= EPS;
  }

  function ensureFanFloatStorage(entry, floatCount, minimumCapacity) {
    if (!entry.storage || entry.capacityFloats < floatCount) {
      let capacity = Math.max(minimumCapacity, entry.capacityFloats || 0);
      while (capacity < floatCount) capacity = Math.ceil(capacity * 1.6);
      entry.capacityFloats = capacity;
      entry.storage = new Float32Array(capacity);
    }
    return entry.storage;
  }

  function appendFanContour(points, out, offset, anchorX, anchorY) {
    let o = offset;
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      const ax = Number(a.x),
        ay = Number(a.y),
        bx = Number(b.x),
        by = Number(b.y);
      if (Math.abs(ax - bx) <= EPS && Math.abs(ay - by) <= EPS) continue;
      out[o++] = anchorX;
      out[o++] = anchorY;
      out[o++] = ax;
      out[o++] = ay;
      out[o++] = bx;
      out[o++] = by;
    }
    return o;
  }
  function appendFanContours(contours, out, anchorX, anchorY) {
    let o = 0;
    for (const points of contours) o = appendFanContour(points, out, o, anchorX, anchorY);
    return o;
  }

  function cleanContourPoints(points) {
    if (!Array.isArray(points) || points.length < 3) return null;
    const out = [];
    let lastX, lastY;
    for (let i = 0; i < points.length; i++) {
      const p = points[i],
        x = Number(p?.x),
        y = Number(p?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

      if (!out.length || Math.abs(lastX - x) > EPS || Math.abs(lastY - y) > EPS) {
        out.push(p);
        lastX = x;
        lastY = y;
      }
    }
    if (out.length > 2 && samePoint(out[0], out[out.length - 1])) out.pop();
    return out.length >= 3 ? out : null;
  }

  function renderedContourPoints(layer, contour) {
    if (contour?.spiralBand === true && Array.isArray(contour?.points))
      return cleanContourPoints(contour.points);
    const path = contour?.path;
    if (!path?.points?.length) return null;
    if (path.profileCurveBaked) return cleanContourPoints(path.points);
    const sampler = createLampRenderedPathSampler();
    const rounding = getRoundingStrength(layer?.rounding);
    if (useSmoothSplinePath(layer, rounding, path)) {
      splinePathForDraw(
        sampler,
        path.points,
        true,
        rounding,
        path.cornerFlags || [],
        path.bridgeRoundFlags || [],
        layer?.wholeCurveSpline === true,
        1,
        0,
        layer,
      );
    } else {
      roundPolylineForDraw(
        sampler,
        path.points,
        true,
        rounding,
        path.cornerFlags || [],
        null,
        false,
        null,
        layer,
      );
    }
    return cleanContourPoints(sampler.points.length >= 3 ? sampler.points : path.points);
  }

  function sampleSpiralBranchPath(path) {
    const cubics = Array.isArray(path?._bezierSegments) ? path._bezierSegments : null;
    if (cubics?.length) {
      const out = [];
      const evalCubic = (seg, t) => {
        const q = 1 - t,
          p0 = seg.p0,
          c1 = seg.c1,
          c2 = seg.c2,
          p3 = seg.p3;
        return {
          x: q * q * q * p0.x + 3 * q * q * t * c1.x + 3 * q * t * t * c2.x + t * t * t * p3.x,
          y: q * q * q * p0.y + 3 * q * q * t * c1.y + 3 * q * t * t * c2.y + t * t * t * p3.y,
        };
      };
      const subdiv = 8;
      for (let si = 0; si < cubics.length; si++) {
        const seg = cubics[si];
        if (!seg?.p0 || !seg?.p3) continue;
        for (let j = 0; j < subdiv; j++) {
          out.push(evalCubic(seg, j / subdiv));
        }
        if (si === cubics.length - 1) out.push(evalCubic(seg, 1));
      }
      return cleanContourPoints(out.length >= 2 ? out : path?.points || []);
    }

    const pts = [];
    for (const p of path?.points || []) {
      if (!p) continue;
      const x = Number(p.x),
        y = Number(p.y);
      if (Number.isFinite(x) && Number.isFinite(y)) pts.push({ x, y });
    }
    return pts.length >= 2 ? pts : null;
  }

  function isSpiralBandPath(path) {
    return path?.closed !== true && Array.isArray(path?.points) && path.points.length >= 2;
  }
  function spiralBandFillEnabled(layer) {
    return isSpiralLayer(layer) && layer?.spiralClosed !== false && layer?.spiralFillEnabled === true;
  }
  function getSpiralBandPaths(drawData, layer) {
    if (!spiralBandFillEnabled(layer)) return null;
    const paths = (drawData?.paths || []).filter(isSpiralBandPath);
    if (paths.length < 2) return null;

    paths.sort((a, b) => {
      const ai = Number(a?.spiralBranchIndex),
        bi = Number(b?.spiralBranchIndex);
      if (Number.isFinite(ai) && Number.isFinite(bi)) return ai - bi;
      return (Number(a?.orbitIndex) || 0) - (Number(b?.orbitIndex) || 0);
    });
    return paths;
  }

  function hasSpiralBandTopology(drawData, layer) {
    if (!spiralBandFillEnabled(layer)) return false;
    const paths = drawData?.paths;
    if (!Array.isArray(paths)) return false;
    let eligible = 0;
    for (const path of paths) if (isSpiralBandPath(path)) eligible++;
    return eligible >= 2;
  }

  function buildSpiralBandContours(drawData, layer) {
    const paths = getSpiralBandPaths(drawData, layer);
    if (!paths) return null;
    const contours = [];
    const step = paths.length % 2 === 0 ? 2 : 1;
    for (let i = 0; i + 1 < paths.length; i += step) {
      const a = sampleSpiralBranchPath(paths[i]),
        b = sampleSpiralBranchPath(paths[i + 1]);
      if (!a || !b || a.length < 2 || b.length < 2) return null;
      const points = [];
      for (const p of a) points.push({ x: Number(p.x), y: Number(p.y) });
      for (let j = b.length - 1; j >= 0; j--) points.push({ x: Number(b[j].x), y: Number(b[j].y) });
      const clean = cleanContourPoints(points);
      if (!clean || clean.length < 3) return null;
      contours.push({
        path: { points: clean, closed: true },
        points: clean,
        closed: true,
        fillEligible: true,
        spiralBand: true,
        pairIndex: i / step,
      });
    }
    return contours.length === Math.ceil((paths.length - 1) / step) ? contours : null;
  }

  function transformSpiralFillPoint(p, transform) {
    const { sc, c, sn } = transform,
      x = Number(p?.x) || 0,
      y = Number(p?.y) || 0;
    return { x: (c * x - sn * y) * sc, y: (sn * x + c * y) * sc };
  }
  function branchDelta(path) {
    const meta = path?.points?.[0],
      d = Number(meta?.__spiralDelta);
    if (Number.isFinite(d)) return d;
    const pts = path?.points || [];
    if (pts.length < 2) return 0;
    const a = pts[0],
      b = pts[pts.length - 1];
    let q = Math.atan2(Number(b.y) || 0, Number(b.x) || 0) - Math.atan2(Number(a.y) || 0, Number(a.x) || 0);
    while (q > Math.PI) q -= Math.PI * 2;
    while (q <= -Math.PI) q += Math.PI * 2;
    return q;
  }
  function buildFanMeshFromBands(layer, bands, frameCtx, semantic, flags = {}) {
    if (!bands?.length) return null;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity,
      totalEdges = 0,
      totalPoints = 0;
    const cleanBands = [];
    for (const raw of bands) {
      const pts = cleanContourPoints(raw);
      if (!pts || pts.length < 3) return null;
      cleanBands.push(pts);
      totalPoints += pts.length;
      totalEdges += pts.length;
      for (const q of pts) {
        const x = Number(q.x),
          y = Number(q.y);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (
      !totalEdges ||
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY)
    )
      return null;
    let entry = spiralInterwindingCache.get(layer);
    if (!entry) {
      entry = {
        capacityFloats: 0,
        storage: null,
        mesh: {
          dynamic: true,
          dynamicScreenSpace: false,
          revision: 0,
          frameId: -1,
          fanData: null,
          fanFloatCount: 0,
          fanTriangleCount: 0,
          complete: false,
          nativeComplete: false,
          records: [],
        },
      };
      spiralInterwindingCache.set(layer, entry);
    }
    ensureFanFloatStorage(entry, totalEdges * 6, 384);
    const span = Math.max(1, maxX - minX, maxY - minY),
      anchorX = minX - span * 2 - 1,
      anchorY = minY - span * 2 - 1,
      out = entry.storage;
    const o = appendFanContours(cleanBands, out, anchorX, anchorY);
    const mesh = entry.mesh;
    mesh.fanData = entry.storage;
    mesh.fanFloatCount = o;
    mesh.fanTriangleCount = Math.floor(o / 6);
    mesh.complete = mesh.fanTriangleCount > 0;
    mesh.nativeComplete = mesh.complete;
    mesh.frameId = Number(frameCtx?.frameId) || 0;
    mesh.revision = (mesh.revision + 1) >>> 0 || 1;
    mesh.anchor = { x: anchorX, y: anchorY };
    mesh.totalVertices = totalPoints;
    mesh.totalTriangles = mesh.fanTriangleCount;
    mesh.spiralBandCount = cleanBands.length;
    mesh.spiralBandFill = true;
    mesh.semantic = semantic;

    mesh.spiralInterwindingFill = false;
    mesh.spiralMathematicalFill = false;
    mesh.spiralChoppedFill = false;
    mesh.lineMasterFill = false;
    mesh.retainedRailFill = false;
    mesh.corridorBaked = false;
    mesh.localCellCount = 0;
    mesh.localPatchCount = 0;
    Object.assign(mesh, flags);
    frameCtx._fillMeshShadow = mesh;
    return mesh;
  }

  function anchorCyclicSpiralFillBands(paths) {
    if (!Array.isArray(paths) || paths.length < 2) return paths;
    const identity = (p) => {
      for (const v of [p?.pairIndex, p?.sourceBranchIndex, p?.spiralBranchIndex, p?.targetBranchIndex]) {
        if (v !== null && v !== undefined && Number.isFinite(Number(v))) return Number(v);
      }
      return Infinity;
    };
    let anchor = 0,
      best = identity(paths[0]);
    for (let i = 1; i < paths.length; i++) {
      const id = identity(paths[i]);
      if (id < best) {
        best = id;
        anchor = i;
      }
    }
    if (anchor > 0) {
      const head = paths.splice(0, anchor);
      paths.push(...head);
    }
    return paths;
  }

  const interwindingRoute = {
    frames: 0,
    fromLineMaster: 0,
    fromRetainedRail: 0,
    missingMaster: 0,
    unsupportedTopology: 0,
    last: null,
  };

  function makeLocalInterwindingCells(aRaw, bRaw) {
    const lengthTable = (pts) => {
      const cumulative = [0];
      let total = 0;
      for (let i = 1; i < pts.length; i++) {
        total += Math.hypot(Number(pts[i].x) - Number(pts[i - 1].x), Number(pts[i].y) - Number(pts[i - 1].y));
        cumulative.push(total);
      }
      return { cum: cumulative, len: total };
    };
    if (aRaw.length < 2 || bRaw.length < 2) return null;
    const aa = lengthTable(aRaw),
      forward = lengthTable(bRaw);
    const endpointCost = (p, q, reverse) => {
      const x = reverse ? q[q.length - 1] : q[0],
        y = reverse ? q[0] : q[q.length - 1];
      return (
        Math.hypot(p[0].x - x.x, p[0].y - x.y) + Math.hypot(p[p.length - 1].x - y.x, p[p.length - 1].y - y.y)
      );
    };
    const b =
      endpointCost(aRaw, bRaw, true) < endpointCost(aRaw, bRaw, false) ? bRaw.slice().reverse() : bRaw;
    const bb = b === bRaw ? forward : lengthTable(b);
    if (!(aa.len > 1e-6 && bb.len > 1e-6)) return null;

    const knots = [0, 1];
    for (let i = 1; i < aa.cum.length - 1; i++) knots.push(aa.cum[i] / aa.len);
    for (let i = 1; i < bb.cum.length - 1; i++) knots.push(bb.cum[i] / bb.len);
    knots.sort((a, b) => a - b);
    const ts = [];
    for (const t of knots) if (!ts.length || t - ts[ts.length - 1] > 1e-8) ts.push(t);
    if (ts.length > 1025) return null;
    const sampled = (pts, table) => {
      let i = 0;
      return ts.map((t) => {
        const at = t * table.len;
        while (i + 2 < table.cum.length && table.cum[i + 1] < at - 1e-8) i++;
        const lo = table.cum[i],
          hi = table.cum[i + 1],
          u = hi > lo ? Math.max(0, Math.min(1, (at - lo) / (hi - lo))) : 0;
        return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * u, y: pts[i].y + (pts[i + 1].y - pts[i].y) * u };
      });
    };
    const aPts = sampled(aRaw, aa),
      bPts = sampled(b, bb);
    const widths = aPts.map((a, i) => Math.hypot(a.x - bPts[i].x, a.y - bPts[i].y));
    const ordered = widths.slice().sort((a, b) => a - b),
      median = ordered[Math.floor(ordered.length / 2)];

    if (!Number.isFinite(median) || median > Math.min(aa.len, bb.len) * 0.85) return null;
    const maxGap = Math.max(median * 3, Math.min(aa.len, bb.len) * 0.09, 1e-4);
    const orient = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    const cross = (a, b, c, d) => {
      const e = 1e-8,
        o1 = orient(a, b, c),
        o2 = orient(a, b, d),
        o3 = orient(c, d, a),
        o4 = orient(c, d, b);
      return o1 * o2 < -e && o3 * o4 < -e;
    };

    const cells = [];
    let skipped = 0,
      kept = 0;
    for (let i = 0; i + 1 < ts.length; i++) {
      const a0 = aPts[i],
        a1 = aPts[i + 1],
        b0 = bPts[i],
        b1 = bPts[i + 1];
      const gap0 = widths[i],
        gap1 = widths[i + 1];
      const ax = a1.x - a0.x,
        ay = a1.y - a0.y,
        bx = b1.x - b0.x,
        by = b1.y - b0.y;
      const da = Math.hypot(ax, ay),
        db = Math.hypot(bx, by);

      if (
        gap0 > maxGap ||
        gap1 > maxGap ||
        da <= 1e-8 ||
        db <= 1e-8 ||
        ax * bx + ay * by <= -0.2 * da * db ||
        cross(a0, a1, b0, b1) ||
        cross(a0, b0, a1, b1)
      ) {
        skipped++;
        continue;
      }
      const area = orient(a0, a1, b1) + orient(a0, b1, b0);
      if (Math.abs(area) < 1e-7) {
        skipped++;
        continue;
      }

      const poly = [a0, a1, b1, b0];
      if (area < 0) poly.reverse();
      cells.push(poly);
      kept++;
    }
    return { cells, skipped, kept, possible: ts.length - 1, medianGap: median };
  }

  function chooseLocalInterwindingPairs(samples) {
    const lengths = samples.map((pts) => {
      let len = 0;
      for (let i = 1; i < pts.length; i++)
        len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
      return len;
    });
    const probes = samples.map((pts) => {
      const n = pts.length - 1;
      return [0.08, 0.24, 0.4, 0.56, 0.72, 0.88].map((t) => pts[Math.min(n, Math.round(t * n))]);
    });
    const candidates = [];
    for (let i = 0; i < samples.length; i++)
      for (let j = i + 1; j < samples.length; j++) {
        if (lengths[i] < 1e-5 || lengths[j] < 1e-5) continue;
        const minimum = (a, b) => a.map((p) => Math.min(...b.map((q) => Math.hypot(p.x - q.x, p.y - q.y))));
        const distances = minimum(probes[i], probes[j]).concat(minimum(probes[j], probes[i]));
        distances.sort((a, b) => a - b);
        const median = distances[Math.floor(distances.length / 2)];

        if (!Number.isFinite(median) || median > Math.max(5, Math.min(lengths[i], lengths[j]) * 0.35))
          continue;
        candidates.push({ i, j, cost: median });
      }
    candidates.sort((a, b) => a.cost - b.cost || a.i - b.i || a.j - b.j);
    const degree = samples.map(() => 0),
      parent = samples.map((_, i) => i),
      pairs = [];
    const root = (i) => {
      while (parent[i] !== i) {
        parent[i] = parent[parent[i]];
        i = parent[i];
      }
      return i;
    };
    for (const c of candidates) {
      if (degree[c.i] >= 2 || degree[c.j] >= 2) continue;
      const ri = root(c.i),
        rj = root(c.j);
      if (ri === rj) continue;
      parent[ri] = rj;
      degree[c.i]++;
      degree[c.j]++;
      pairs.push([c.i, c.j]);
    }
    return pairs;
  }

  function prepareInterwindingVisibleRails(frameCtx, retainedRails = null) {
    interwindingRoute.frames++;
    const fid = Number(frameCtx?.frameId) || 0;
    const fail = (reason, count = 0) => {
      if (reason === 'missing-line-master') interwindingRoute.missingMaster++;
      else interwindingRoute.unsupportedTopology++;
      interwindingRoute.last = { frameId: fid, route: 'line-master', reason, pathCount: count, triangles: 0 };
      return null;
    };
    const record =
      SomataFrameContourService?.current?.(frameCtx) || SomataFrameContourService?.get?.(frameCtx);
    const hasMaster =
      record &&
      Number(record.frameId) === fid &&
      Array.isArray(record.paths) &&
      Array.isArray(record.commands) &&
      record.commands.length > 0;
    const source = hasMaster ? record.paths : retainedRails;
    if (!Array.isArray(source) || source.length < 2)
      return fail(hasMaster ? 'not-enough-visible-branches' : 'missing-line-master', source?.length || 0);

    const paths = hasMaster
      ? source
      : source
          .filter((p) => Array.isArray(p?.points) && p.points.length >= 2 && Number(p?.alpha ?? 1) > 1e-5)
          .slice()
          .sort((a, b) => (Number(a?.branchPhase) ?? 0) - (Number(b?.branchPhase) ?? 0));
    if (!hasMaster) anchorCyclicSpiralFillBands(paths);
    if (paths.length < 2) return fail('not-enough-visible-branches', paths.length);
    const samples = paths.map(sampleSpiralBranchPath);
    const candidates = chooseLocalInterwindingPairs(samples.map((a) => (a?.length >= 2 ? a : [])));
    const cells = [];
    let pairCount = 0,
      skippedCells = 0,
      rejectedPairs = 0,
      possibleCells = 0,
      acceptedCells = 0;
    const acceptedPairIndices = [];
    for (const [i, j] of candidates) {
      const a = samples[i],
        b = samples[j];
      if (!a || !b || a.length < 2 || b.length < 2) {
        rejectedPairs++;
        continue;
      }
      const strip = makeLocalInterwindingCells(a, b);
      if (!strip?.cells?.length) {
        rejectedPairs++;
        continue;
      }
      cells.push(...strip.cells);
      pairCount++;
      acceptedPairIndices.push([i, j]);
      skippedCells += strip.skipped;
      possibleCells += strip.possible;
      acceptedCells += strip.kept;
    }
    if (!cells.length) return fail('no-local-interwinding-cells', paths.length);
    const mesh = buildFanMeshFromBands(
      frameCtx.layer,
      cells,
      frameCtx,
      'Somata 14.1 interwinding bounded local cells on visible rails',
      {
        spiralInterwindingFill: true,
        corridorBaked: false,
        lineMasterFill: !!hasMaster,
        retainedRailFill: !hasMaster,
      },
    );
    if (!mesh?.nativeComplete) return fail('unmeshable-visible-branches', paths.length);

    mesh.spiralBandCount = pairCount;
    mesh.localCellCount = acceptedCells;
    mesh.localPatchCount = cells.length;
    if (hasMaster) interwindingRoute.fromLineMaster++;
    else interwindingRoute.fromRetainedRail++;
    interwindingRoute.last = {
      frameId: fid,
      route: hasMaster ? 'line-master' : 'retained-gpu-rail',
      reason: '',
      pathCount: paths.length,
      triangles: mesh.fanTriangleCount,
      pairedBands: pairCount,
      localCells: acceptedCells,
      localPatches: cells.length,
      skippedCells,
      rejectedPairs,
      possibleCells,
      candidatePairs: candidates.length,
      pairIndices: acceptedPairIndices,
      unpairedPaths: paths.length - new Set(acceptedPairIndices.flat()).size,
      sameMasterCommands:
        !!hasMaster &&
        (record.commands === frameCtx._dynamicTunnelMorphMasterCommands ||
          record.commands === frameCtx.__somataFeatureParent?._dynamicTunnelMorphMasterCommands),
    };
    return mesh;
  }

  function prepareInterwindingCorridor(frameCtx, auxPaths = null, choppedLegacy = false) {
    const layer = frameCtx?.layer;
    if (
      (!layer?.fill && !layer?.spiralFillEnabled) ||
      layer?.spiralFillEnabled !== true ||
      layer?.spiralFillType !== (choppedLegacy ? 'chopped' : 'interwinding') ||
      layer?.spiralClosed === false ||
      !isSpiralLayer(layer) ||
      state?.tunnel?.active !== true
    )
      return null;

    if (frameCtx?.geometryPlan?.dynamic === true)
      return choppedLegacy ? null : prepareInterwindingVisibleRails(frameCtx);
    let paths;
    if (Array.isArray(auxPaths) && auxPaths.length) {
      paths = auxPaths.filter(
        (p) => Array.isArray(p?.points) && p.points.length >= 2 && Number(p?.alpha ?? 1) > 0.00001,
      );
      const phase = (p, i) =>
        Number.isFinite(Number(p?.branchPhase))
          ? ((Number(p.branchPhase) % 1) + 1) % 1
          : (Number.isFinite(Number(p?.spiralBranchIndex)) ? Number(p.spiralBranchIndex) : i) /
            Math.max(1, paths.length);
      paths.forEach((p, i) => (p.__interwindSort = phase(p, i)));
      paths.sort((a, b) => (Number(a.__interwindSort) || 0) - (Number(b.__interwindSort) || 0));
      anchorCyclicSpiralFillBands(paths);
    } else {
      const drawData = frameCtx?.geometryPlan?.sourceData || frameCtx?.staticDrawData;
      paths = getSpiralBandPaths(drawData, layer);
    }
    if (!paths || paths.length < 2) return null;
    const samples = paths.map(sampleSpiralBranchPath);
    if (samples.some((p) => !p || p.length < 2)) return null;
    const sourceCopies = Array.isArray(frameCtx?.visibleInstances?.copies)
      ? frameCtx.visibleInstances.copies
      : [];
    const sourceAlphas = frameCtx?.visibleInstances?.fillAlphas || frameCtx?.visibleInstances?.alphas || [];

    const copies = [];
    for (let i = 0; i < sourceCopies.length; i++) {
      const copy = sourceCopies[i],
        alpha = Number(sourceAlphas[i] ?? 1);
      if (alpha > 0.0005 && Number(copy?.scale) > 0) copies.push({ copy, alpha });
    }
    copies.sort((a, b) => Number(b.copy.scale) - Number(a.copy.scale));
    if (!copies.length) return null;
    const n = paths.length,
      TWO = Math.PI * 2;
    const transforms = copies.map((r) => {
      const copy = r.copy,
        sc = Math.max(0.000001, Math.abs(Number(copy?.scale) || 1));
      let ang = 0;
      try {
        ang = Number(getMotionTunnelLagRadians(copy, layer)) || 0;
      } catch (error) {
        noteSuppressedError('render/fill-plan#prepareInterwindingCorridor', error);
      }
      return { sc, c: Math.cos(ang), sn: Math.sin(ang), ang };
    });
    const branchDeltas = paths.map(branchDelta);
    const rails = [];
    for (let seed = 0; seed < n; seed++) {
      const rail = [];
      let idx = seed;
      for (let ci = 0; ci < copies.length; ci++) {
        const pts = samples[idx],
          transform = transforms[ci];
        for (let pi = 0; pi < pts.length; pi++) {
          const q = transformSpiralFillPoint(pts[pi], transform);
          if (
            !rail.length ||
            pi > 0 ||
            Math.hypot(q.x - rail[rail.length - 1].x, q.y - rail[rail.length - 1].y) > 1e-7
          )
            rail.push(q);
        }
        if (ci + 1 < copies.length) {
          const d = branchDeltas[idx],
            shift = Math.round(((d + transforms[ci].ang - transforms[ci + 1].ang) * n) / TWO);
          idx = (((idx + shift) % n) + n) % n;
        }
      }
      rails.push(rail);
    }

    const bandPairs = choppedLegacy
      ? Array.from({ length: Math.floor((n - 1) / (n % 2 === 0 ? 2 : 1)) + 1 }, (_, q) => {
          const i = q * (n % 2 === 0 ? 2 : 1);
          return [i, i + 1];
        }).filter(([i, j]) => j < n)
      : chooseLocalInterwindingPairs(rails);
    const bands = [];
    let pairedBands = 0,
      acceptedCells = 0,
      rejectedPairs = 0;
    for (const [i, j] of bandPairs) {
      const a = rails[i],
        b = rails[j];
      if (!a?.length || !b?.length) return null;
      if (choppedLegacy) {
        const pts = [];
        for (const q of a) pts.push(q);
        for (let j = b.length - 1; j >= 0; j--) pts.push(b[j]);
        bands.push(pts);
        pairedBands++;
      } else {
        const local = makeLocalInterwindingCells(a, b);
        if (!local?.cells?.length) {
          rejectedPairs++;
          continue;
        }
        bands.push(...local.cells);
        pairedBands++;
        acceptedCells += local.kept;
      }
    }
    if (!bands.length) return null;
    const mesh = buildFanMeshFromBands(
      layer,
      bands,
      frameCtx,
      choppedLegacy
        ? 'chopped legacy Corridor Fill (14.0 visual baseline)'
        : 'Somata 14.1 interwinding local cells through Corridor copies',
      choppedLegacy
        ? { spiralChoppedFill: true, corridorBaked: true }
        : { spiralInterwindingFill: true, corridorBaked: true },
    );
    if (mesh) {
      mesh.spiralBandCount = pairedBands;
      mesh.localCellCount = acceptedCells;
      mesh.localPatchCount = bands.length;
      mesh.rejectedPairs = rejectedPairs;
    }
    return mesh;
  }

  function prepareSpiralInterwinding(frameCtx, retainedRails = null) {
    const layer = frameCtx?.layer;
    if (
      layer?.spiralFillEnabled !== true ||
      layer.spiralFillType !== 'interwinding' ||
      layer.spiralClosed === false ||
      !isSpiralLayer(layer)
    )
      return null;
    return prepareInterwindingVisibleRails(frameCtx, retainedRails);
  }

  function keyFor(layer) {
    return [
      Math.max(0, Math.min(MAX_ROUNDING_PERCENT, Number(layer?.rounding) || 0)).toFixed(4),
      String(layer?.profileMode || 'segments'),
      'spline-plus',
      normalizeSplineRenderMode(layer?.splineRenderMode),
      state.fourierMode ? 1 : 0,
    ].join('|');
  }

  function prepareStatic(drawData, layer) {
    if (!drawData || typeof drawData !== 'object') return null;
    const key = keyFor(layer);
    let variants = cache.get(drawData);
    if (!variants) {
      variants = new Map();
      cache.set(drawData, variants);
    }
    const cached = variants.get(key);
    if (cached) {
      hits++;
      return cached;
    }

    const canonical = GeometryKernel.inspectStaticDrawData(drawData);
    const spiralBandContours = buildSpiralBandContours(drawData, layer);
    const sourceContours = spiralBandContours || canonical.fillContours || [];
    const records = [];
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    let totalPoints = 0,
      rejected = 0;

    for (const contour of sourceContours) {
      contoursSeen++;
      const points = renderedContourPoints(layer, contour);
      if (!points || points.length < 3) {
        degenerateContours++;
        rejected++;
        records.push({ contour, status: 'degenerate', pointCount: 0, points: null });
        continue;
      }
      for (let i = 0; i < points.length; i++) {
        const p = points[i],
          x = Number(p.x),
          y = Number(p.y);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
      totalPoints += points.length;
      records.push({ contour, status: 'stencil-edge-fan', pointCount: points.length, points });
    }

    let fanData = null,
      fanTriangleCount = 0,
      anchor = null;
    const validRecords = records.filter((r) => r.status === 'stencil-edge-fan');
    if (
      validRecords.length &&
      Number.isFinite(minX) &&
      Number.isFinite(minY) &&
      Number.isFinite(maxX) &&
      Number.isFinite(maxY)
    ) {
      const span = Math.max(1, maxX - minX, maxY - minY);

      anchor = { x: minX - span * 2 - 1, y: minY - span * 2 - 1 };
      fanData = new Float32Array(totalPoints * 6);
      let o = 0;
      for (const rec of validRecords) {
        const points = rec.points;
        rec.fanOffset = o / 2;
        rec.fanTriangleOffset = fanTriangleCount;
        o = appendFanContour(points, fanData, o, anchor.x, anchor.y);
        fanTriangleCount = o / 6;
        rec.fanTriangleCount = fanTriangleCount - rec.fanTriangleOffset;
        rec.points = null;
      }
      if (o !== fanData.length) fanData = fanData.slice(0, o);
    }

    builds++;
    linearPlans++;
    sourcePoints += totalPoints;
    emittedEdges += fanTriangleCount;
    fanBytes += fanData?.byteLength || 0;
    const complete = validRecords.length > 0 && rejected === 0 && fanTriangleCount > 0;
    const result = {
      key,
      drawData,
      records,
      anchor,
      fanData,
      fanTriangleCount,
      meshable: validRecords.length,
      stencilRequired: validRecords.length,
      rejected,
      totalVertices: totalPoints,
      totalTriangles: fanTriangleCount,
      complete,
      nativeComplete: complete,
      preparationComplexity: 'O(N)',
      spiralBandFill: Boolean(spiralBandContours),
      spiralBandCount: spiralBandContours?.length || 0,
      semantic: spiralBandContours
        ? 'closed even Spiral: alternating neighboring branch-pairs -> closed stencil bands'
        : 'canonical linear stencil Fill: all contours share one stencil field and one color composite',
    };

    variants.set(key, result);
    while (variants.size > MAX_VARIANTS_PER_DRAW_DATA) {
      const oldestKey = variants.keys().next().value;
      const oldPlan = variants.get(oldestKey);
      variants.delete(oldestKey);
      if (oldPlan) {
        evictedMeshes.push(oldPlan);
        variantEvictions++;
      }
    }
    return result;
  }

  function prepareSpiralChopped(frameCtx) {
    const layer = frameCtx?.layer;
    if (
      layer?.spiralFillEnabled !== true ||
      layer.spiralFillType !== 'chopped' ||
      typeof isSpiralLayer !== 'function' ||
      !isSpiralLayer(layer)
    )
      return null;
    const record =
      SomataFrameContourService?.current?.(frameCtx) || SomataFrameContourService?.get?.(frameCtx);
    const source = record?.paths;
    if (!source?.length || source.length % 2 !== 0) return null;
    const sorted = source
      .slice()
      .sort((a, b) => (Number(a?.spiralBranchIndex) || 0) - (Number(b?.spiralBranchIndex) || 0));
    const bands = [];
    for (let i = 0; i < sorted.length; i += 2) {
      const a = sampleSpiralBranchPath(sorted[i]),
        b = sampleSpiralBranchPath(sorted[i + 1]);
      if (!a || !b) return null;
      bands.push(a.concat(b.slice().reverse()));
    }
    return buildFanMeshFromBands(
      layer,
      bands,
      frameCtx,
      'chopped Spiral Fill from shared current Line master',
      { spiralChoppedFill: true, corridorBaked: false },
    );
  }
  const mathematicalCache = new WeakMap();
  const mathematicalStatus = {
    requests: 0,
    fromLineMaster: 0,
    fromRetainedRail: 0,
    missingMaster: 0,
    noCrossings: 0,
    noFaces: 0,
    limited: 0,
    renderable: 0,
    last: null,
  };
  window.__somataSpiralMathematicalFillStatus = () => ({
    ...mathematicalStatus,
    last: mathematicalStatus.last && { ...mathematicalStatus.last },
  });
  function prepareSpiralMathematical(frameCtx, retainedRails = null) {
    const layer = frameCtx?.layer;
    if (
      !layer ||
      layer.spiralFillEnabled !== true ||
      layer.spiralFillType !== 'mathematical' ||
      typeof isSpiralLayer !== 'function' ||
      !isSpiralLayer(layer)
    )
      return null;
    mathematicalStatus.requests++;
    const fid = Number(frameCtx.frameId) || 0;
    let chosenPaths = null,
      authority = 'line-master';
    const note = (reason, hit = null, regions = null, mesh = null) => {
      mathematicalStatus.last = {
        frameId: fid,
        route: authority,
        reason,
        pathCount: Number(chosenPaths?.length) || 0,
        intersectionCount: hit?.intersections?.length || 0,
        faceCount: regions?.length || 0,
        triangles: mesh?.fanTriangleCount || 0,
        masterEligibility: SomataFrameContourService?.eligibility?.(frameCtx) || '',
        masterFailure: SomataFrameContourService?.status?.()?.lastReason || '',
      };
    };
    const record =
      SomataFrameContourService?.current?.(frameCtx) || SomataFrameContourService?.get?.(frameCtx);
    const hasMaster = record && Number(record.frameId) === fid && Array.isArray(record.paths);
    chosenPaths = hasMaster ? record.paths : Array.isArray(retainedRails) ? retainedRails : null;
    authority = hasMaster ? 'line-master' : 'retained-gpu-rail';
    if (!chosenPaths) {
      mathematicalStatus.missingMaster++;
      note('missing-current-line-master');
      return null;
    }
    if (hasMaster) mathematicalStatus.fromLineMaster++;
    else mathematicalStatus.fromRetainedRail++;

    const paths = hasMaster
      ? chosenPaths
      : chosenPaths.filter(
          (p) => Array.isArray(p?.points) && p.points.length >= 2 && Number(p?.alpha ?? 1) > 1e-5,
        );
    const cached = mathematicalCache.get(layer);
    if (cached?.frameId === fid && cached.record === (hasMaster ? record : retainedRails)) {
      note(cached.reason, cached.hit, cached.regions, cached.mesh);
      return cached.mesh;
    }
    const hit = window.SomataSpiralIntersections?.scanFrame?.(paths, fid);
    const regions = hit && !hit.limited ? window.SomataSpiralIntersections?.loops?.(paths, hit, 256) : [];
    const mesh = regions?.length
      ? buildFanMeshFromBands(layer, regions, frameCtx, 'mathematical Spiral crossing faces', {
          spiralMathematicalFill: true,
          spiralBandFill: false,
          crossings: hit.intersections.length,
        })
      : null;
    const reason = hit?.limited
      ? 'intersection-scan-limit'
      : !hit?.intersections?.length
        ? 'no-crossings'
        : !regions?.length
          ? 'no-bounded-faces'
          : !mesh?.nativeComplete
            ? 'unmeshable-faces'
            : '';
    if (reason === 'intersection-scan-limit') mathematicalStatus.limited++;
    else if (reason === 'no-crossings') mathematicalStatus.noCrossings++;
    else if (reason === 'no-bounded-faces') mathematicalStatus.noFaces++;
    else if (!reason) mathematicalStatus.renderable++;
    note(reason, hit, regions, mesh);
    mathematicalCache.set(layer, {
      frameId: fid,
      record: hasMaster ? record : retainedRails,
      mesh,
      hit,
      regions,
      reason,
    });
    return mesh;
  }
  function prepareFrame(frameCtx) {
    const layer = frameCtx?.layer,
      plan = frameCtx?.geometryPlan || {};
    if (layer?.spiralFillEnabled === true && layer.spiralFillType === 'mathematical') {
      skippedFrames++;
      return null;
    }
    if ((!layer?.fill && !layer?.spiralFillEnabled) || plan.dynamic === true) {
      skippedFrames++;
      return null;
    }
    const drawData = plan.sourceData || frameCtx.staticDrawData;
    if (!drawData || (isSpiralLayer(layer) && !hasSpiralBandTopology(drawData, layer))) {
      skippedFrames++;
      return null;
    }
    const fillPlan = prepareStatic(drawData, layer);
    frameCtx._fillMeshShadow = fillPlan;
    preparedFrames++;
    return fillPlan;
  }

  function canUseNative(frameCtx) {
    const fillPlan = frameCtx?._fillMeshShadow || prepareFrame(frameCtx),
      plan = frameCtx?.geometryPlan || {};
    return Boolean(
      fillPlan?.nativeComplete &&
      fillPlan.fanTriangleCount > 0 &&
      plan.dynamic !== true &&
      (!isSpiralLayer(frameCtx?.layer) || fillPlan?.spiralBandFill === true) &&
      !state.fourierMode &&
      !state.showRoundingGuides,
    );
  }

  function prepareSpiralMorphBands(frameCtx, auxPaths) {
    const layer = frameCtx?.layer;
    if (
      (!layer?.fill && !layer?.spiralFillEnabled) ||
      layer?.spiralFillEnabled !== true ||
      layer?.spiralClosed === false ||
      !isSpiralLayer(layer) ||
      !Array.isArray(auxPaths) ||
      auxPaths.length < 2
    )
      return null;

    const sourceLayer =
      frameCtx?.spiralEditMorph?.sourceLayer ||
      frameCtx?.blueMorphProvider?.sourceLayer ||
      frameCtx?.sourceLayer ||
      frameCtx?.geometryPlan?.sourceLayer ||
      null;
    const targetLayer =
      frameCtx?.spiralEditMorph?.targetLayer ||
      frameCtx?.blueMorphProvider?.targetLayer ||
      frameCtx?.geometryPlan?.targetLayer ||
      null;
    const sourceClosed = sourceLayer?.spiralEnabled === true ? sourceLayer.spiralClosed !== false : true;
    const targetClosed = targetLayer?.spiralEnabled === true ? targetLayer.spiralClosed !== false : true;
    if (!sourceClosed || !targetClosed) return null;
    const srcN = Math.max(2, Math.round(Number(sourceLayer?.N) || auxPaths.length));
    const dstN = Math.max(2, Math.round(Number(targetLayer?.N) || auxPaths.length));

    const paths = auxPaths.filter(
      (p) => Array.isArray(p?.points) && p.points.length >= 2 && Number(p?.alpha ?? 1) > 0.00001,
    );
    if (paths.length < 2) return null;
    const phaseKey = (p, idx) => {
      if (Number.isFinite(Number(p?.branchPhase))) return ((Number(p.branchPhase) % 1) + 1) % 1;
      const a = Number(p?.sourceBranchIndex),
        b = Number(p?.targetBranchIndex),
        sn = Math.max(1, Number(p?.sourceBranchCount) || srcN),
        dn = Math.max(1, Number(p?.targetBranchCount) || dstN);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        const sa = (((a / sn) % 1) + 1) % 1,
          db = (((b / dn) % 1) + 1) % 1;
        let d = db - sa;
        d = ((((d + 0.5) % 1) + 1) % 1) - 0.5;
        return (((sa + d * 0.5) % 1) + 1) % 1;
      }
      if (Number.isFinite(a)) return (((a / sn) % 1) + 1) % 1;
      if (Number.isFinite(b)) return (((b / dn) % 1) + 1) % 1;
      return idx / Math.max(1, paths.length);
    };
    paths.forEach((p, i) => {
      p.__fillSortKey = phaseKey(p, i);
    });
    paths.sort((a, b) => (Number(a.__fillSortKey) || 0) - (Number(b.__fillSortKey) || 0));
    anchorCyclicSpiralFillBands(paths);

    let totalEdges = 0,
      totalPoints = 0,
      minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    const bands = [];
    const step = paths.length % 2 === 0 ? 2 : 1;
    for (let i = 0; i + 1 < paths.length; i += step) {
      const ap = paths[i].points,
        bp = paths[i + 1].points,
        pts = [];
      for (const q of ap) pts.push(q);
      for (let j = bp.length - 1; j >= 0; j--) pts.push(bp[j]);
      const clean = cleanContourPoints(pts);
      if (!clean || clean.length < 3) return null;
      bands.push(clean);
      totalPoints += clean.length;
      totalEdges += clean.length;
      for (const q of clean) {
        const x = Number(q.x),
          y = Number(q.y);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
    if (
      !totalEdges ||
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY)
    )
      return null;
    let entry = spiralMorphCache.get(layer);
    if (!entry) {
      entry = {
        capacityFloats: 0,
        storage: null,
        mesh: {
          dynamic: true,
          dynamicScreenSpace: false,
          spiralBandFill: true,
          revision: 0,
          frameId: -1,
          fanData: null,
          fanFloatCount: 0,
          fanTriangleCount: 0,
          complete: false,
          nativeComplete: false,
          records: [],
          semantic: 'dynamic retained Spiral alternating branch-pair Fill',
        },
      };
      spiralMorphCache.set(layer, entry);
    }
    ensureFanFloatStorage(entry, totalEdges * 6, 192);
    const span = Math.max(1, maxX - minX, maxY - minY),
      anchorX = minX - span * 2 - 1,
      anchorY = minY - span * 2 - 1,
      out = entry.storage;
    const o = appendFanContours(bands, out, anchorX, anchorY);
    const mesh = entry.mesh;
    mesh.fanData = entry.storage;
    mesh.fanFloatCount = o;
    mesh.fanTriangleCount = Math.floor(o / 6);
    mesh.complete = mesh.fanTriangleCount > 0;
    mesh.nativeComplete = mesh.complete;
    mesh.frameId = Number(frameCtx?.frameId) || 0;
    mesh.revision = (mesh.revision + 1) >>> 0 || 1;
    mesh.anchor = { x: anchorX, y: anchorY };
    mesh.totalVertices = totalPoints;
    mesh.totalTriangles = mesh.fanTriangleCount;
    mesh.spiralBandCount = bands.length;
    frameCtx._fillMeshShadow = mesh;
    return mesh;
  }

  const LINE_JOIN_EPS = 1e-3;
  function lineJoinSamePoint(a, b) {
    const ax = Number(a?.x),
      ay = Number(a?.y),
      bx = Number(b?.x),
      by = Number(b?.y);
    return (
      Number.isFinite(ax) &&
      Number.isFinite(ay) &&
      Number.isFinite(bx) &&
      Number.isFinite(by) &&
      Math.abs(ax - bx) <= LINE_JOIN_EPS &&
      Math.abs(ay - by) <= LINE_JOIN_EPS
    );
  }
  function normalizedLinePoints(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    const out = [];
    for (const p of points) {
      const x = Number(p?.x),
        y = Number(p?.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      const q = { x, y };
      if (!out.length || !lineJoinSamePoint(out[out.length - 1], q)) out.push(q);
    }
    return out.length >= 2 ? out : null;
  }
  function collectLineCarrierContours(commands) {
    const contours = [];
    if (!Array.isArray(commands)) return contours;
    const commitOpen = (chain) => {
      if (!chain || chain.length < 3 || !lineJoinSamePoint(chain[0], chain[chain.length - 1])) return;
      const pts = chain.slice();
      if (lineJoinSamePoint(pts[0], pts[pts.length - 1])) pts.pop();
      const clean = cleanContourPoints(pts);
      if (clean?.length >= 3) contours.push(clean.map((p) => ({ x: Number(p.x), y: Number(p.y) })));
    };
    for (const cmd of commands) {
      let chain = null;
      const flush = () => {
        commitOpen(chain);
        chain = null;
      };
      for (const sp of cmd?.subpaths || []) {
        const pts = normalizedLinePoints(sp?.points);
        if (!pts) continue;
        if (sp?.closed === true) {
          flush();
          const clean = cleanContourPoints(pts);
          if (clean?.length >= 3) contours.push(clean.map((p) => ({ x: Number(p.x), y: Number(p.y) })));
          continue;
        }
        if (!chain) {
          chain = pts.slice();
          continue;
        }
        const tail = chain[chain.length - 1],
          first = pts[0],
          last = pts[pts.length - 1];
        if (lineJoinSamePoint(tail, first)) {
          for (let i = 1; i < pts.length; i++) chain.push(pts[i]);
        } else if (lineJoinSamePoint(tail, last)) {
          for (let i = pts.length - 2; i >= 0; i--) chain.push(pts[i]);
        } else {
          flush();
          chain = pts.slice();
        }
      }
      flush();
    }
    return contours;
  }

  function prepareFrameContour(frameCtx, record) {
    const layer = frameCtx?.layer,
      paths = record?.screenPaths;
    if (!layer || !Array.isArray(paths) || !paths.length) return null;
    const isDynamic = frameCtx?.geometryPlan?.dynamic === true,
      fid = Number(frameCtx?.frameId) || 0;
    let entry = frameContourCache.get(layer);
    if (!entry) {
      entry = {
        record: null,
        frameId: -1,
        capacityFloats: 0,
        storage: null,
        mesh: {
          dynamic: isDynamic,
          dynamicScreenSpace: true,
          frameContourFill: true,
          lineCarrierFill: true,
          revision: 0,
          frameId: -1,
          fanData: null,
          fanFloatCount: 0,
          fanTriangleCount: 0,
          complete: false,
          nativeComplete: false,
          records: [],
          preparationComplexity: 'O(N)',
          semantic: 'Fill boundary = shared FrameContour screenPaths; no independent geometry reconstruction',
        },
      };
      frameContourCache.set(layer, entry);
    } else if (entry.record === record && entry.frameId === fid && entry.mesh.nativeComplete) {
      dynamicReuses++;
      frameCtx._fillMeshShadow = entry.mesh;
      return entry.mesh;
    }
    const contours = [],
      // A cross-fading morph records the outgoing and the incoming shape with their own
      // Fill presence. They are filled as separate groups (each with its own alpha) so
      // the overlap of the two shapes does not cancel out under the even-odd rule.
      contourPresence = [],
      // Вес «лишнего» контура морфа (см. fillGhostWeight): undefined — обычный контур.
      contourGhost = [];
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity,
      totalEdges = 0,
      totalPoints = 0,
      presenceVaries = false,
      ghostVaries = false,
      dupWeight = 0,
      dupEdges = 0;
    for (const path of paths) {
      if (path?.closed !== true) continue;
      const pts = cleanContourPoints(path.points);
      if (!pts?.length) continue;
      contours.push(pts);
      const rawPresence = Number(path?.source?.[0]?.command?.fillPresence),
        presence = Number.isFinite(rawPresence) ? Math.max(0, Math.min(1, rawPresence)) : 1;
      if (presence < 0.999) presenceVaries = true;
      contourPresence.push(presence);
      const command = path?.source?.[0]?.command,
        ghost = command?.fillGhost && Number.isFinite(Number(command.fillGhost.g)) ? command.fillGhost : null,
        dup = Math.max(0, Math.round(Number(command?.fillDup) || 0));
      if (ghost || dup > 0) ghostVaries = true;
      dupEdges += pts.length * dup;
      if (dup > 0)
        dupWeight = Math.max(dupWeight, Math.max(0, Math.min(1, Number(command.fillDupWeight) || 0)));
      contourGhost.push({ ghost, dup });
      totalPoints += pts.length;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i],
          b = pts[(i + 1) % pts.length],
          ax = Number(a.x),
          ay = Number(a.y),
          bx = Number(b.x),
          by = Number(b.y);
        if (ax < minX) minX = ax;
        if (ax > maxX) maxX = ax;
        if (ay < minY) minY = ay;
        if (ay > maxY) maxY = ay;
        if (!samePoint(a, b)) totalEdges++;
      }
    }
    const mesh = entry.mesh;
    mesh.dynamic = isDynamic;
    mesh.frameId = fid;
    mesh.contourCount = contours.length;
    mesh.totalVertices = totalPoints;
    mesh.fanGroups = null;
    if (
      !totalEdges ||
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY)
    ) {
      mesh.fanFloatCount = 0;
      mesh.fanTriangleCount = 0;
      mesh.complete = false;
      mesh.nativeComplete = false;
      mesh.totalTriangles = 0;
      mesh.revision = (mesh.revision + 1) >>> 0 || 1;
      entry.record = record;
      entry.frameId = fid;
      frameCtx._fillMeshShadow = mesh;
      return mesh;
    }
    ensureFanFloatStorage(entry, (totalEdges + dupEdges) * 6, 96);
    const span = Math.max(1, maxX - minX, maxY - minY),
      anchorX = minX - span * 2 - 1,
      anchorY = minY - span * 2 - 1,
      out = entry.storage;
    let o = 0;
    if (presenceVaries) {
      const byWeight = new Map();
      for (let i = 0; i < contours.length; i++) {
        const key = Math.round(contourPresence[i] * 1000);
        let group = byWeight.get(key);
        if (!group) byWeight.set(key, (group = { weight: key / 1000, contours: [] }));
        group.contours.push(contours[i]);
      }
      const groups = [];
      for (const group of byWeight.values()) {
        if (group.weight < 0.002) continue;
        const startFloat = o;
        for (const pts of group.contours) o = appendFanContour(pts, out, o, anchorX, anchorY);
        if (o > startFloat)
          groups.push({ start: startFloat / 6, count: (o - startFloat) / 6, weight: group.weight });
      }
      mesh.fanGroups = groups;
    } else if (ghostVaries) {
      // Лишние контуры морфа (слияние/разделение орбит): см. ghostFillLayout. Веер
      // складывается в порядке M | обычные | D, группы — непрерывные диапазоны.
      const layout = ghostFillLayout(contourGhost, dupWeight);
      const startOf = [];
      for (const i of layout.order) {
        startOf.push(o / 6);
        o = appendFanContour(contours[i], out, o, anchorX, anchorY);
      }
      startOf.push(o / 6);
      mesh.fanGroups = layout.groups
        .map((group) => ({
          start: startOf[group.from],
          count: startOf[group.to] - startOf[group.from],
          weight: 1,
          power: group.power,
        }))
        .filter((group) => group.count > 0);
    } else o = appendFanContours(contours, out, anchorX, anchorY);
    mesh.fanData = entry.storage;
    mesh.fanFloatCount = o;
    mesh.fanTriangleCount = Math.floor(o / 6);
    mesh.complete = mesh.fanTriangleCount > 0;
    mesh.nativeComplete = mesh.complete;
    mesh.revision = (mesh.revision + 1) >>> 0 || 1;
    mesh.anchor = { x: anchorX, y: anchorY };
    mesh.totalTriangles = mesh.fanTriangleCount;
    entry.record = record;
    entry.frameId = fid;
    frameCtx._fillMeshShadow = mesh;
    dynamicBuilds++;
    dynamicSourcePoints += totalPoints;
    dynamicEdges += mesh.fanTriangleCount;
    dynamicFanBytes += o * 4;
    return mesh;
  }

  function prepareLineCarrierCommands(frameCtx, commands) {
    const layer = frameCtx?.layer;
    if (!layer || !Array.isArray(commands) || !commands.length) return null;
    const isDynamic = frameCtx?.geometryPlan?.dynamic === true;
    let entry = dynamicCache.get(layer);
    if (!entry) {
      entry = {
        frameId: -1,
        commands: null,
        dynamic: null,
        capacityFloats: 0,
        storage: null,
        mesh: {
          dynamic: isDynamic,
          dynamicScreenSpace: true,
          lineCarrierFill: true,
          revision: 0,
          frameId: -1,
          fanData: null,
          fanFloatCount: 0,
          fanTriangleCount: 0,
          complete: false,
          nativeComplete: false,
          records: [],
          preparationComplexity: 'O(N)',
          semantic:
            'Fill boundary = exact frame-resident Line command contour; open Bezier segments are stitched only by shared endpoints',
        },
      };
      dynamicCache.set(layer, entry);
    } else if (
      entry.commands === commands &&
      entry.dynamic === isDynamic &&
      entry.mesh.nativeComplete &&
      (!isDynamic || entry.frameId === Number(frameCtx.frameId))
    ) {
      dynamicReuses++;
      entry.mesh.frameId = Number(frameCtx.frameId) || 0;
      frameCtx._fillMeshShadow = entry.mesh;
      return entry.mesh;
    }

    const contours = collectLineCarrierContours(commands);
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity,
      totalEdges = 0,
      totalPoints = 0;
    for (const pts of contours) {
      totalPoints += pts.length;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i],
          b = pts[(i + 1) % pts.length],
          ax = Number(a.x),
          ay = Number(a.y),
          bx = Number(b.x),
          by = Number(b.y);
        if (ax < minX) minX = ax;
        if (ax > maxX) maxX = ax;
        if (ay < minY) minY = ay;
        if (ay > maxY) maxY = ay;
        if (Math.abs(ax - bx) > EPS || Math.abs(ay - by) > EPS) totalEdges++;
      }
    }
    const mesh = entry.mesh;
    mesh.dynamic = isDynamic;
    mesh.dynamicScreenSpace = true;
    mesh.lineCarrierFill = true;
    if (
      !totalEdges ||
      !Number.isFinite(minX) ||
      !Number.isFinite(minY) ||
      !Number.isFinite(maxX) ||
      !Number.isFinite(maxY)
    ) {
      mesh.fanFloatCount = 0;
      mesh.fanTriangleCount = 0;
      mesh.complete = false;
      mesh.nativeComplete = false;
      mesh.totalVertices = 0;
      mesh.totalTriangles = 0;
      mesh.contourCount = 0;
      mesh.frameId = Number(frameCtx.frameId) || 0;
      mesh.revision = (mesh.revision + 1) >>> 0 || 1;
      entry.frameId = mesh.frameId;
      entry.commands = commands;
      entry.dynamic = isDynamic;
      frameCtx._fillMeshShadow = mesh;
      return mesh;
    }
    ensureFanFloatStorage(entry, totalEdges * 6, 96);
    const span = Math.max(1, maxX - minX, maxY - minY),
      anchorX = minX - span * 2 - 1,
      anchorY = minY - span * 2 - 1;
    const out = entry.storage,
      o = appendFanContours(contours, out, anchorX, anchorY);
    mesh.fanData = entry.storage;
    mesh.fanFloatCount = o;
    mesh.fanTriangleCount = Math.floor(o / 6);
    mesh.complete = mesh.fanTriangleCount > 0;
    mesh.nativeComplete = mesh.complete;
    mesh.frameId = Number(frameCtx.frameId) || 0;
    mesh.revision = (mesh.revision + 1) >>> 0 || 1;
    mesh.anchor = { x: anchorX, y: anchorY };
    mesh.totalVertices = totalPoints;
    mesh.totalTriangles = mesh.fanTriangleCount;
    mesh.contourCount = contours.length;
    entry.frameId = mesh.frameId;
    entry.commands = commands;
    entry.dynamic = isDynamic;
    frameCtx._fillMeshShadow = mesh;
    dynamicBuilds++;
    dynamicSourcePoints += totalPoints;
    dynamicEdges += mesh.fanTriangleCount;
    dynamicFanBytes += o * 4;
    return mesh;
  }

  function prepareDynamicCommands(frameCtx, commands) {
    if (frameCtx?.geometryPlan?.dynamic !== true) return null;
    return prepareLineCarrierCommands(frameCtx, commands);
  }

  function takeEvicted() {
    const out = evictedMeshes;
    evictedMeshes = [];
    return out;
  }
  function reset() {
    cache = new WeakMap();
    dynamicCache = new WeakMap();
    frameContourCache = new WeakMap();
    spiralMorphCache = new WeakMap();
    spiralInterwindingCache = new WeakMap();
    evictedMeshes = [];
  }
  function status() {
    return {
      builds,
      hits,
      contoursSeen,
      degenerateContours,
      variantEvictions,
      maxVariantsPerDrawData: MAX_VARIANTS_PER_DRAW_DATA,
      preparedFrames,
      skippedFrames,
      sourcePoints,
      emittedEdges,
      fanBytes,
      linearPlans,
      dynamicBuilds,
      dynamicReuses,
      dynamicSourcePoints,
      dynamicEdges,
      dynamicFanBytes,
      classificationPasses: 0,
      earClippingPasses: 0,
      mode: 'linear-stencil-all',
      complexity: 'O(N)',
      semantic:
        'ordinary Static + Dynamic + Corridor Fill use the exact shared Line/master FrameContour; strict Spiral retains its native adapter',
    };
  }
  return {
    prepareStatic,
    prepareFrame,
    prepareFrameContour,
    prepareLineCarrierCommands,
    prepareDynamicCommands,
    prepareSpiralInterwinding,
    prepareSpiralMathematical,
    prepareSpiralChopped,
    collectLineCarrierContours,
    prepareSpiralMorphBands,
    prepareInterwindingCorridor,
    canUseNative,
    hasSpiralBandTopology,
    buildSpiralBandContours,
    takeEvicted,
    status,
    reset,
  };
})();

export { FillMeshPreparer };
