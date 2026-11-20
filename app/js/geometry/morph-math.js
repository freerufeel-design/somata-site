import '../morph-runtime/registry.js'; // initialisation order: this module runs after it
import {
  getEffectiveSpiralStep,
  getSpiralAngularVertexCount,
  getSpiralGeometryLayer,
} from './spiral/order-params.js';
import { buildCircleSlideAnglePlan } from '../slides/planner.js';
import { buildCircleAnchors, morphDuplicateEdgeSlots, rephaseAngleSequenceToReference } from './morph.js';

// Reusable geometry and correspondence algorithms. No named mode is registered or queried here.
window.SomataPhaseMatching = (() => {
  function wrapUnit(v) {
    v = Number(v) || 0;
    v %= 1;
    if (v < 0) v += 1;
    return v;
  }
  function signedUnitDelta(a, b) {
    let d = wrapUnit(b) - wrapUnit(a);
    while (d <= -0.5) d += 1;
    while (d > 0.5) d -= 1;
    return d;
  }
  function spiralBranchPhase(path, layer, fallbackIndex = 0, total = 1) {
    const n = Math.max(2, Math.round(Number(layer?.N) || Math.max(2, total))),
      bi = Number(path?.spiralBranchIndex),
      rot = (Number(layer?.rotation) || 0) / 360;
    return wrapUnit((Number.isFinite(bi) ? bi / n : fallbackIndex / Math.max(1, total)) + rot);
  }
  function stableSpiralPairs(srcPaths, dstPaths, srcLayer = null, dstLayer = null, costFn = null) {
    const src = (Array.isArray(srcPaths) ? srcPaths : [])
      .map((path, i) => ({ path, i, phase: spiralBranchPhase(path, srcLayer, i, srcPaths.length) }))
      .sort((a, b) => a.phase - b.phase || a.i - b.i);
    const dst = (Array.isArray(dstPaths) ? dstPaths : [])
      .map((path, i) => ({ path, i, phase: spiralBranchPhase(path, dstLayer, i, dstPaths.length) }))
      .sort((a, b) => a.phase - b.phase || a.i - b.i);
    if (!src.length || !dst.length) return [];
    const pairCost = (a, b) => {
      if (typeof costFn === 'function') {
        const c = Number(costFn(a.path, b.path));
        if (Number.isFinite(c)) return c;
      }
      const d = signedUnitDelta(a.phase, b.phase);
      return d * d;
    };
    const pairs = [];
    if (src.length === dst.length) {
      let bestShift = 0,
        best = Infinity;
      for (let sh = 0; sh < dst.length; sh++) {
        let c = 0;
        for (let i = 0; i < src.length; i++) c += pairCost(src[i], dst[(i + sh) % dst.length]);
        if (c < best) {
          best = c;
          bestShift = sh;
        }
      }
      for (let i = 0; i < src.length; i++)
        pairs.push({
          src: src[i].path,
          dst: dst[(i + bestShift) % dst.length].path,
          sourcePathPresent: true,
          targetPathPresent: true,
          stableSpiralPairing: true,
          stableShift: bestShift,
        });
      return pairs;
    }
    if (src.length > dst.length) {
      let bestShift = 0,
        best = Infinity;
      for (let sh = 0; sh < dst.length; sh++) {
        let c = 0;
        for (let i = 0; i < src.length; i++) {
          const j = (Math.floor((i * dst.length) / src.length) + sh) % dst.length;
          c += pairCost(src[i], dst[j]);
        }
        if (c < best) {
          best = c;
          bestShift = sh;
        }
      }
      const candidates = [];
      for (let i = 0; i < src.length; i++) {
        const j = (Math.floor((i * dst.length) / src.length) + bestShift) % dst.length;
        candidates.push({
          src: src[i].path,
          dst: dst[j].path,
          sourcePathPresent: true,
          targetPathPresent: false,
          radialMerge: true,
          stableSpiralPairing: true,
          _stableTarget: j,
          _stableCost: pairCost(src[i], dst[j]),
        });
      }
      for (let j = 0; j < dst.length; j++) {
        let winner = null;
        for (const q of candidates)
          if (q._stableTarget === j && (!winner || q._stableCost < winner._stableCost)) winner = q;
        if (winner) winner.targetPathPresent = true;
      }
      return candidates;
    }
    let bestShift = 0,
      best = Infinity;
    for (let sh = 0; sh < src.length; sh++) {
      let c = 0;
      for (let j = 0; j < dst.length; j++) {
        const i = (Math.floor((j * src.length) / dst.length) + sh) % src.length;
        c += pairCost(src[i], dst[j]);
      }
      if (c < best) {
        best = c;
        bestShift = sh;
      }
    }
    const candidates = [];
    for (let j = 0; j < dst.length; j++) {
      const i = (Math.floor((j * src.length) / dst.length) + bestShift) % src.length;
      candidates.push({
        src: src[i].path,
        dst: dst[j].path,
        sourcePathPresent: false,
        targetPathPresent: true,
        radialSplit: true,
        stableSpiralPairing: true,
        _stableSource: i,
        _stableCost: pairCost(src[i], dst[j]),
      });
    }
    for (let i = 0; i < src.length; i++) {
      let winner = null;
      for (const q of candidates)
        if (q._stableSource === i && (!winner || q._stableCost < winner._stableCost)) winner = q;
      if (winner) winner.sourcePathPresent = true;
    }
    return candidates;
  }
  function usesUniquePairs(a, b) {
    const capped =
      a?.spiralStepLimiterEnabled !== false &&
      b?.spiralStepLimiterEnabled !== false &&
      Math.round(Number(a?.spiralStepLimiter) || 2) === Math.round(Number(b?.spiralStepLimiter) || 2);
    const stepDrop = Number(b?.N) < Number(a?.N) && Number(a?.K) > Math.max(1, Math.floor(Number(b?.N) / 2));
    return capped || stepDrop;
  }
  return Object.freeze({ spiralBranchPhase, signedUnitDelta, stableSpiralPairs, usesUniquePairs });
})();

window.SomataRotationMath = (() => {
  function pathReferenceAngle(path) {
    const pts = path?.points || [];
    let fallback = 0;
    for (const p of pts) {
      const x = Number(p?.x) || 0,
        y = Number(p?.y) || 0,
        r = Math.hypot(x, y);
      if (r > 1e-5) return Math.atan2(y, x);
      if (r > 0) fallback = Math.atan2(y, x);
    }
    return fallback;
  }
  function shortestAngleDelta(a, b) {
    let d = (Number(b) || 0) - (Number(a) || 0);
    while (d <= -Math.PI) d += 2 * Math.PI;
    while (d > Math.PI) d -= 2 * Math.PI;
    return d;
  }
  function angularRadialCost(a, b) {
    const ap = a?.points || [],
      bp = b?.points || [];
    if (!ap.length || !bp.length) {
      const d = shortestAngleDelta(pathReferenceAngle(a), pathReferenceAngle(b));
      return d * d;
    }

    const samples = Math.min(11, Math.max(3, Math.min(ap.length, bp.length))),
      at = (arr, q) => arr[Math.min(arr.length - 1, Math.max(0, Math.round(q * (arr.length - 1))))];
    let cost = 0,
      weight = 0,
      maxR = 1;
    for (const p of ap) maxR = Math.max(maxR, Math.hypot(Number(p?.x) || 0, Number(p?.y) || 0));
    for (const p of bp) maxR = Math.max(maxR, Math.hypot(Number(p?.x) || 0, Number(p?.y) || 0));
    for (let k = 0; k < samples; k++) {
      const q = samples === 1 ? 0 : k / (samples - 1),
        pa = at(ap, q),
        pb = at(bp, q),
        ar = Math.hypot(Number(pa?.x) || 0, Number(pa?.y) || 0),
        br = Math.hypot(Number(pb?.x) || 0, Number(pb?.y) || 0),
        visibility = Math.max(ar, br) / maxR,
        w = Math.max(0.025, Math.min(1, visibility)),
        d = shortestAngleDelta(
          Math.atan2(Number(pa?.y) || 0, Number(pa?.x) || 0),
          Math.atan2(Number(pb?.y) || 0, Number(pb?.x) || 0),
        ),
        radial = (ar - br) / maxR;
      cost += d * d * w + 0.32 * radial * radial;
      weight += w + 0.32;
    }
    return cost / Math.max(1e-6, weight);
  }
  function alignWeightedWholeTurns(sp, dp) {
    const n = Math.min(sp.length, dp.length);
    if (!n) return 0;
    let scale = 0;
    for (let i = 0; i < n; i++) scale = Math.max(scale, sp[i].r, dp[i].r);
    const radiusEps = Math.max(1e-6, scale * 0.0015);

    let meanNum = 0,
      meanDen = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.max(sp[i].r, dp[i].r),
        w = r <= radiusEps ? 0.01 : 0.08 + 0.92 * Math.min(1, r / Math.max(radiusEps, scale * 0.15));
      meanNum += (sp[i].a - dp[i].a) * w;
      meanDen += w;
    }
    const k0 = Math.round(meanNum / Math.max(1e-9, meanDen) / (2 * Math.PI));
    let bestK = k0,
      bestCost = Infinity,
      bestMax = Infinity;
    for (let k = k0 - 2; k <= k0 + 2; k++) {
      const shift = k * (2 * Math.PI);
      let cost = 0,
        maxAbs = 0,
        weight = 0;
      for (let i = 0; i < n; i++) {
        const r = Math.max(sp[i].r, dp[i].r),
          w = r <= radiusEps ? 0.01 : 0.08 + 0.92 * Math.min(1, r / Math.max(radiusEps, scale * 0.15)),
          d = dp[i].a + shift - sp[i].a;
        cost += d * d * w;
        maxAbs = Math.max(maxAbs, Math.abs(d));
        weight += w;
      }
      cost /= Math.max(1e-9, weight);
      const score = cost + maxAbs * maxAbs * 0.08;
      if (score < bestCost - 1e-12 || (Math.abs(score - bestCost) < 1e-12 && maxAbs < bestMax)) {
        bestCost = score;
        bestMax = maxAbs;
        bestK = k;
      }
    }
    const globalPhaseK = bestK,
      shift = globalPhaseK * (2 * Math.PI);
    for (let i = 0; i < n; i++) dp[i].a += shift;
    return globalPhaseK;
  }
  return Object.freeze({ shortestAngleDelta, angularRadialCost, alignWeightedWholeTurns });
})();

// A change of fixed N is shown by two independent, moving rails. Only K
// interpolates on each rail; the two rails crossfade instead of changing N.
window.SomataFixedAxisRules = (() => {
  function fixedAxisPairs(axis, srcLayer, dstLayer, srcPaths, dstPaths, build, pairPaths) {
    const nFade = axis === 'N';
    // There are two independent animated rails: each rail moves along the
    // non-fixed axis, while its fixed-axis value never changes. Fade the
    // OUTGOING rail and fade in the INCOMING rail. Do not interpolate the
    // fixed parameter between the two rails or create K copies per vertex.
    const rebuild = (original, axis) => {
      const patched = {
        ...original,
        ...axis,
        __spiroGeometryStepResolved: false,
        __spiralAnimatedEffectiveK: undefined,
        __spiralAnimatedK: undefined,
      };
      return getSpiralGeometryLayer(patched);
    };
    const sourceOther = rebuild(srcLayer, nFade ? { N: dstLayer.N } : { K: dstLayer.K });
    const targetOther = rebuild(dstLayer, nFade ? { N: srcLayer.N } : { K: srcLayer.K });
    const out = pairPaths(srcPaths, build(targetOther) || [], srcLayer, targetOther);
    const incoming = pairPaths(build(sourceOther) || [], dstPaths, sourceOther, dstLayer);
    for (const pair of out) {
      pair.sourceLayer = srcLayer;
      pair.targetLayer = targetOther;
      pair.sourcePathPresent = pair.sourcePathPresent !== false;
      pair.targetPathPresent = false;
      pair.fadeOutgoing = true;
    }
    for (const pair of incoming) {
      pair.sourceLayer = sourceOther;
      pair.targetLayer = dstLayer;
      pair.sourcePathPresent = false;
      pair.targetPathPresent = pair.targetPathPresent !== false;
      pair.fadeIncoming = true;
    }
    return [...out, ...incoming];
  }
  function anchorGroups(axis, ctx, h, polygonPlan, vertex) {
    const { a, b, source, target } = ctx;
    const fix = (layer, value) => ({
      ...layer,
      [axis]: value,
      __spiralAnimatedN: undefined,
      __spiralAnimatedK: undefined,
      __spiralAnimatedEffectiveK: undefined,
      __spiroGeometryStepResolved: false,
    });
    const outgoingTarget = fix(b, a[axis]),
      incomingSource = fix(a, b[axis]);
    const outgoing = { ...ctx, b: outgoingTarget, target: h.anchors(outgoingTarget) };
    const incoming = { ...ctx, a: incomingSource, source: h.anchors(incomingSource) };
    const left = h.polygon(outgoing, vertex, polygonPlan(outgoing));
    const right = h.polygon(incoming, vertex, polygonPlan(incoming));
    if (!left || !right) return null;
    const interpolate = (a, b, t) => a + (b - a) * t;
    return (t) => {
      const group = (paths, ctx, alpha, start, tag) =>
        paths.map((p, i) => ({
          ...p,
          orbitIndex: start + i,
          points: p.points.map((q) => ({ ...q, id: `${tag}:${q.id}` })),
          alpha: (p.alpha ?? 1) * alpha,
          fixedAngularN: interpolate(
            getSpiralAngularVertexCount(ctx.a),
            getSpiralAngularVertexCount(ctx.b),
            t,
          ),
          fixedSpiralStep: interpolate(getEffectiveSpiralStep(ctx.a), getEffectiveSpiralStep(ctx.b), t),
        }));
      const out = group(left(t), outgoing, 1 - t, 0, 'out');
      return [...out, ...group(right(t), incoming, t, out.length, 'in')];
    };
  }
  return Object.freeze({
    fixedAxisPairs,
    anchorGroups,
    hasVertexAxisChange: (a, b) => Math.round(Number(a?.N) || 4) !== Math.round(Number(b?.N) || 4),
    hasStepAxisChange: (a, b) => Math.abs((Number(a?.K) || 1) - (Number(b?.K) || 1)) > 1e-8,
  });
})();

window.SomataBranchMatching = (() => {
  const { spiralBranchPhase, signedUnitDelta } = SomataPhaseMatching;
  const pairPlanarOneToOne = (() => {
    function pairPlanar(sourcePaths, targetPaths, sourceLayer, targetLayer) {
      const src = (sourcePaths || []).map((path, i) => ({ path, i }));
      const dst = (targetPaths || []).map((path, i) => ({ path, i }));
      // Planar assignment is NOT a periodic Spiral phase carrier. Match actual
      // positions of each source/target open rail. A globally minimal one-to-
      // one assignment (Hungarian, rectangular) minimizes total planar travel;
      // a greedy angular match can strand a later ray far from its nearest end.
      const planarCost = (ap, bp) => {
        const a = ap?.points || [],
          b = bp?.points || [];
        if (!a.length || !b.length) return 1e12;
        const at = (pts, t) => {
          const q = t * (pts.length - 1),
            i = Math.max(0, Math.min(pts.length - 2, Math.floor(q))),
            f = q - i,
            p = pts[i],
            r = pts[i + 1] || p;
          return {
            x: (Number(p.x) || 0) * (1 - f) + (Number(r.x) || 0) * f,
            y: (Number(p.y) || 0) * (1 - f) + (Number(r.y) || 0) * f,
          };
        };
        let sum = 0;
        for (let k = 0; k <= 8; k++) {
          const t = k / 8,
            p = at(a, t),
            q = at(b, t),
            dx = p.x - q.x,
            dy = p.y - q.y;
          sum += (k === 0 || k === 8 ? 2 : 1) * (dx * dx + dy * dy);
        }
        return sum / 11;
      };
      const sourceRows = src.length <= dst.length;
      const rows = sourceRows ? src : dst,
        cols = sourceRows ? dst : src;
      const n = rows.length,
        m = cols.length;
      const costs = rows.map((a, i) =>
        cols.map((b, j) => {
          const c = sourceRows ? planarCost(a.path, b.path) : planarCost(b.path, a.path);
          return c + 1e-8 * (a.i * m + b.i); // deterministic tie-break
        }),
      );
      // Standard O(n²m) rectangular assignment, n <= m. Run only once on
      // endpoint preparation, never per animation frame.
      const u = new Float64Array(n + 1),
        v = new Float64Array(m + 1),
        p = new Int32Array(m + 1),
        way = new Int32Array(m + 1);
      for (let i = 1; i <= n; i++) {
        p[0] = i;
        let j0 = 0;
        const minv = new Float64Array(m + 1).fill(Infinity),
          used = new Uint8Array(m + 1);
        do {
          used[j0] = 1;
          const i0 = p[j0];
          let delta = Infinity,
            j1 = 0;
          for (let j = 1; j <= m; j++)
            if (!used[j]) {
              const cur = costs[i0 - 1][j - 1] - u[i0] - v[j];
              if (cur < minv[j]) {
                minv[j] = cur;
                way[j] = j0;
              }
              if (minv[j] < delta) {
                delta = minv[j];
                j1 = j;
              }
            }
          for (let j = 0; j <= m; j++) {
            if (used[j]) {
              u[p[j]] += delta;
              v[j] -= delta;
            } else minv[j] -= delta;
          }
          j0 = j1;
        } while (p[j0] !== 0);
        do {
          const j1 = way[j0];
          p[j0] = p[j1];
          j0 = j1;
        } while (j0 !== 0);
      }
      const usedSource = new Set(),
        usedTarget = new Set(),
        pairs = [];
      for (let j = 1; j <= m; j++)
        if (p[j] !== 0) {
          const a = sourceRows ? rows[p[j] - 1] : cols[j - 1];
          const b = sourceRows ? cols[j - 1] : rows[p[j] - 1];
          usedSource.add(a.i);
          usedTarget.add(b.i);
          pairs.push({
            src: a.path,
            dst: b.path,
            sourcePathPresent: true,
            targetPathPresent: true,
            tornPair: true,
            tornCost: planarCost(a.path, b.path),
          });
        }
      for (const a of src)
        if (!usedSource.has(a.i))
          pairs.push({
            src: a.path,
            dst: a.path,
            sourcePathPresent: true,
            targetPathPresent: false,
            tornUnmatched: true,
          });
      for (const b of dst)
        if (!usedTarget.has(b.i))
          pairs.push({
            src: b.path,
            dst: b.path,
            sourcePathPresent: false,
            targetPathPresent: true,
            tornUnmatched: true,
          });
      return pairs;
    }
    return pairPlanar;
  })();

  function pairCyclicBySlide(sourcePaths, targetPaths, sourceLayer, targetLayer, slide = 'minimal') {
    const entries = (paths, layer) =>
      (paths || [])
        .map((path, i) => ({
          path,
          i,
          phase: spiralBranchPhase(path, layer, i, paths.length),
          root: path?.points?.[0] || { x: 0, y: 0 },
        }))
        .sort((a, b) => a.phase - b.phase || a.i - b.i);
    const src = entries(sourcePaths, sourceLayer),
      dst = entries(targetPaths, targetLayer);
    if (!src.length || !dst.length) return [];
    const sourceIsShort = src.length <= dst.length;
    const short = sourceIsShort ? src : dst,
      long = sourceIsShort ? dst : src;
    const n = short.length,
      m = long.length;
    const metric = (a, b) => {
      const dx = (Number(a.root.x) || 0) - (Number(b.root.x) || 0);
      const dy = (Number(a.root.y) || 0) - (Number(b.root.y) || 0);
      const radius = Math.max(
        1,
        Math.hypot(Number(a.root.x) || 0, Number(a.root.y) || 0),
        Math.hypot(Number(b.root.x) || 0, Number(b.root.y) || 0),
      );
      const planar = (dx * dx + dy * dy) / (radius * radius);
      const angular = Math.abs(signedUnitDelta(a.phase, b.phase));
      if (slide === 'phase') return 18 * angular * angular + 0.02 * planar;
      if (slide === 'sector') {
        const sa = Math.min(7, Math.floor(a.phase * 8)),
          sb = Math.min(7, Math.floor(b.phase * 8));
        const binGap = Math.min(Math.abs(sa - sb), 8 - Math.abs(sa - sb));
        return 3 * angular * angular + 0.075 * binGap * binGap + 0.08 * planar;
      }
      return planar + 6 * angular * angular;
    };
    let best = Infinity,
      chosen = null;
    for (let shift = 0; shift < m; shift++) {
      const dp = Array.from({ length: n + 1 }, () => new Float64Array(m + 1).fill(Infinity));
      const take = Array.from({ length: n + 1 }, () => new Uint8Array(m + 1));
      for (let j = 0; j <= m; j++) dp[0][j] = 0;
      for (let i = 1; i <= n; i++)
        for (let j = i; j <= m; j++) {
          const skip = dp[i][j - 1],
            match = dp[i - 1][j - 1] + metric(short[i - 1], long[(j - 1 + shift) % m]);
          if (match < skip - 1e-10) {
            dp[i][j] = match;
            take[i][j] = 1;
          } else dp[i][j] = skip;
        }
      if (dp[n][m] >= best - 1e-10) continue;
      const indices = new Array(n);
      let i = n,
        j = m;
      while (i > 0 && j > 0) {
        if (take[i][j]) {
          indices[i - 1] = (j - 1 + shift) % m;
          i--;
          j--;
        } else j--;
      }
      if (i !== 0) continue;
      best = dp[n][m];
      chosen = indices;
    }
    if (!chosen) return [];
    const usedSource = new Set(),
      usedTarget = new Set(),
      pairs = [];
    for (let i = 0; i < n; i++) {
      const a = sourceIsShort ? short[i] : long[chosen[i]];
      const b = sourceIsShort ? long[chosen[i]] : short[i];
      usedSource.add(a.i);
      usedTarget.add(b.i);
      pairs.push({
        src: a.path,
        dst: b.path,
        sourcePathPresent: true,
        targetPathPresent: true,
        stableSpiralPairing: true,
        coordinatedSlide: slide,
        coordinatedCyclicPair: true,
      });
    }
    for (const a of src)
      if (!usedSource.has(a.i))
        pairs.push({
          src: a.path,
          dst: a.path,
          sourcePathPresent: true,
          targetPathPresent: false,
          coordinatedUnmatched: true,
        });
    for (const b of dst)
      if (!usedTarget.has(b.i))
        pairs.push({
          src: b.path,
          dst: b.path,
          sourcePathPresent: false,
          targetPathPresent: true,
          coordinatedUnmatched: true,
        });
    return pairs;
  }

  return Object.freeze({ pairPlanarOneToOne, pairCyclicBySlide });
})();

window.SomataMorphMath = (() => {
  // Phase: preserve the first endpoint phase; Minimal: minimum visible total
  // rotation; Sector: anchor the most populated angular sector. Each uses a
  // single whole-rail 2pi shift so adjacent cubic knots remain shared.
  function alignSectorPolarAngles(sp, dp) {
    const bins = Array.from({ length: 8 }, () => ({ sum: 0, weight: 0 }));
    let maxRadius = 1e-9;
    for (let i = 0; i < sp.length; i++) maxRadius = Math.max(maxRadius, sp[i].r, dp[i].r);
    for (let i = 0; i < Math.min(sp.length, dp.length); i++) {
      const angle = ((sp[i].a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const sector = Math.min(7, Math.floor(angle / (Math.PI / 4)));
      const weight = Math.max(0.005, Math.max(sp[i].r, dp[i].r) / maxRadius);
      bins[sector].sum += (sp[i].a - dp[i].a) * weight;
      bins[sector].weight += weight;
    }
    const chosen = bins.reduce((a, b) => (b.weight > a.weight ? b : a), bins[0]);
    const shift = Math.round(chosen.sum / Math.max(1e-9, chosen.weight) / (2 * Math.PI)) * 2 * Math.PI;
    for (const p of dp) p.a += shift;
  }

  const PolygonVertexLinear = Object.freeze({
    linear(pp, i, t, r) {
      const a = pp.from[i],
        b = a + pp.delta[i],
        x = Math.cos(a),
        y = Math.sin(a);
      return { x: r * (x + (Math.cos(b) - x) * t), y: r * (y + (Math.sin(b) - y) * t) };
    },
  });
  function angular(pp, i, t, r) {
    const a = pp.from[i] + pp.delta[i] * t;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  }
  // The caller selects pairing and rephasing. This function only constructs
  // correspondence for the supplied policy, without looking at global mode.
  function polygonCorrespondence(ctx, { pairing, phaseOnOrbitChange, lockSeam = false }) {
    const { a, b, slide } = ctx;
    const authored = (paths) =>
      paths.map((p) => ({ points: p.points.map((q) => ({ angle: Math.atan2(q.y, q.x) })) }));
    const src = ctx.anchorPlan ? authored(ctx.source) : buildCircleAnchors(a);
    const dst = ctx.anchorPlan ? authored(ctx.target) : buildCircleAnchors(b);
    const changed = src.length !== dst.length;
    const pathPlans = [];
    if (src.length && dst.length) {
      const n = pairing === 'matched' ? Math.min(src.length, dst.length) : Math.max(src.length, dst.length);
      for (let i = 0; i < n; i++) {
        let from = src[i % src.length].points.map((p) => p.angle),
          to = dst[i % dst.length].points.map((p) => p.angle);
        if (!lockSeam && (changed || from.length > to.length) && to.length)
          from = rephaseAngleSequenceToReference(from, to[0]);
        else if (!lockSeam && to.length > from.length && from.length)
          to = rephaseAngleSequenceToReference(to, from[0]);
        const pp = buildCircleSlideAnglePlan(
          from,
          to,
          lockSeam || (phaseOnOrbitChange && changed && slide === 'minimal') ? 'phase' : slide,
        );
        if (lockSeam) {
          const n = pp.from.length;
          // Fraction of the turn at each endpoint. Slots duplicated
          // at an endpoint must have the same fraction as their parent.
          pp.turnFrom = pp.from.map((_, i) => Math.floor((i * from.length) / n + 1e-10) / from.length);
          pp.turnTo = pp.from.map((_, i) => Math.floor((i * to.length) / n + 1e-10) / to.length);
        }
        // Путь i есть в источнике / в цели (иначе он — дубль при разделении / слиянии орбит).
        pp.sourcePathPresent = i < src.length;
        pp.targetPathPresent = i < dst.length;
        if (from.length !== to.length) {
          const targetAngles = pp.from.map((a, i) => a + pp.delta[i]);
          pp.birthEdgeSlots = morphDuplicateEdgeSlots(pp.from);
          pp.deathEdgeSlots = morphDuplicateEdgeSlots(targetAngles);
          if (ctx.anchorPlan && ctx.spiralMorph && !lockSeam) {
            const windingStations = (angles, count) => {
              let station = 0;
              return angles.map((angle, i) => {
                if (i > 0 && Math.abs(signedAngleDelta(angles[i - 1], angle)) > 1e-8) station++;
                return station / count;
              });
            };
            // Repeated vertices share one winding station. Otherwise changing
            // the correspondence size changes the whole spiral at t=0 or t=1.
            pp.turnFrom = windingStations(pp.from, from.length);
            pp.turnTo = windingStations(targetAngles, to.length);
          }
        }
        pathPlans.push(pp);
      }
    }
    return {
      pathPlans,
      srcClosed: ctx.anchorPlan ? ctx.source[0].closed : a.closedLoop !== false,
      dstClosed: ctx.anchorPlan ? ctx.target[0].closed : b.closedLoop !== false,
    };
  }
  return Object.freeze({
    linear: PolygonVertexLinear.linear,
    angular,
    alignSectorPolarAngles,
    polygonCorrespondence,
  });
})();
