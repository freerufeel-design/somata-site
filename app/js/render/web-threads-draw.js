// Паутина: отрисовка нитей.
import '../effects/web.js'; // initialisation order: this module runs after it
import { audioApplyNumeric } from '../audio/audio-routing.js';
import { getTapMorphIntervalSec } from '../audio/tap-tempo.js';
import { ensureLayerEffectState, getLayerWebConfig, getLayerWebEnabled } from '../core/defaults-layers.js';
import { requestMainCanvasRender } from '../core/scheduler.js';
import { state } from '../core/state.js';
import { getLayerStrokeWidthMultiplier } from '../effects/motion.js';
import {
  buildPathLengthTable,
  frameGeometryRuntime,
  isCurrentFrameDynamicPathList,
  webDrawScratch,
} from '../geometry/frame-paths.js';
import {
  collectWebKinkCorners,
  collectWebSharpCorners,
  getWebBranchFlags,
  getWebStyleProfile,
  nearestWebDistanceOnTable,
  pointAtWrappedWebDistance,
  resolveDynamicWebCornerRuntime,
  resolveWebPrimaryColor,
  webCornerThreadBudget,
  webHashSigned,
  webRuntime,
  webSmoothstep01,
} from '../effects/web.js';

function drawWebThreads(
  ctx,
  paths,
  layer,
  alpha = 1,
  forcedType = null,
  prepared = null,
  outerStateIsolated = false,
  forcedBranch = null,
) {
  if ((prepared ? prepared.enabled !== true : getLayerWebEnabled(layer) !== true) || alpha <= 0.001) return;
  const glRecorder = ctx?.__spiroGLGeometryRecorder === true;
  const cfg = prepared?.cfg || getLayerWebConfig(layer),
    flags = prepared
      ? {
          inside: prepared.insideEnabled === true,
          outsideStraight: prepared.outsideStraightEnabled === true,
          outsideArc: prepared.outsideArcEnabled === true,
        }
      : getWebBranchFlags(cfg);
  const branches = forcedBranch
    ? [forcedBranch]
    : ['inside', 'outsideStraight', 'outsideArc'].filter((k) => flags[k]);
  if (!branches.length) return;

  if (!forcedBranch && branches.length > 1 && !glRecorder) {
    for (const branch of branches)
      drawWebThreads(ctx, paths, layer, alpha, forcedType, prepared, outerStateIsolated, branch);
    return;
  }
  const branch = forcedBranch || branches[0];
  if (!['inside', 'outsideStraight', 'outsideArc'].includes(branch) || !flags[branch]) return;
  const layerIndex = Number.isInteger(prepared?.layerIndex) ? prepared.layerIndex : -1;
  const effectivePlacement = prepared?.placementMode || cfg.placementMode,
    useKinkCorners = effectivePlacement === 'corners' || cfg.style === 'spiderSun';
  const corners =
    prepared?.corners ||
    (useKinkCorners
      ? collectWebKinkCorners(
          paths || [],
          audioApplyNumeric('web.angleThreshold', Number(cfg.angleThreshold) || 60, layerIndex),
          8,
        )
      : collectWebSharpCorners(
          paths || [],
          audioApplyNumeric('web.angleThreshold', Number(cfg.angleThreshold) || 60, layerIndex),
          8,
        ));
  if (!corners.length) return;
  const type = forcedType
    ? forcedType === 'rounding'
      ? 'rounding'
      : 'bevel'
    : cfg.type === 'rounding'
      ? 'rounding'
      : 'bevel';
  const spacing =
    prepared?.spacing ||
    Math.max(1, Math.min(80, audioApplyNumeric('web.spacing', Number(cfg.spacing) || 10, layerIndex)));
  const depthPercent = Number.isFinite(prepared?.depthPercent)
    ? prepared.depthPercent
    : Math.max(
        0,
        Math.min(
          100,
          audioApplyNumeric(
            'web.distance',
            Number.isFinite(Number(cfg.distance)) ? Number(cfg.distance) : 60,
            layerIndex,
          ),
        ),
      );
  const depthMultiplier = Number.isFinite(prepared?.depthMultiplier)
    ? prepared.depthMultiplier
    : Math.max(0, Number.isFinite(Number(cfg.depthMultiplier)) ? Number(cfg.depthMultiplier) : 1);
  const jitterStrength = Number.isFinite(prepared?.jitterStrength)
    ? prepared.jitterStrength
    : Math.sin(
        (Math.max(
          0,
          Math.min(45, audioApplyNumeric('web.angleVariation', Number(cfg.angleVariation) || 0, layerIndex)),
        ) *
          Math.PI) /
          180,
      ) * 0.9;
  const now = prepared?.now || performance.now();
  const placementMode = ['corners', 'selfIntersection', 'selfIntersectionCorridor'].includes(
    prepared?.placementMode || cfg.placementMode,
  )
    ? prepared?.placementMode || cfg.placementMode
    : 'corners';
  const oscillating = (prepared?.oscillating ?? cfg.oscillating) === true,
    oscStrength = Math.max(
      0,
      Math.min(100, Number(prepared?.oscillationStrength ?? cfg.oscillationStrength ?? 10)),
    ),
    oscStrengthMultiplier = Math.max(
      0.015625,
      Math.min(64, Number(prepared?.oscillationStrengthMultiplier ?? cfg.oscillationStrengthMultiplier ?? 1)),
    ),
    oscStrengthEffective = Math.min(8, (oscStrength / 100) * oscStrengthMultiplier),
    oscMultiplier = Math.max(
      0.015625,
      Math.min(64, Number(prepared?.oscillationMultiplier ?? cfg.oscillationMultiplier ?? 1)),
    );
  const webCycleSec = getTapMorphIntervalSec(Number(state?.morph?.intervalSec) || 5, 'full'),
    webCycleMs = Math.max(100, webCycleSec * 1000);
  const oscillationPhase = Number.isFinite(Number(prepared?.oscillationPhase))
    ? Number(prepared.oscillationPhase)
    : ((now % webCycleMs) / webCycleMs) * Math.PI * 2 * oscMultiplier;
  const color = prepared?.color || resolveWebPrimaryColor(cfg, layer, null),
    secondaryColor =
      prepared?.secondaryColor ||
      (/^#[0-9a-f]{6}$/i.test(cfg.secondaryColor || '') ? cfg.secondaryColor : '#00ffff'),
    sunDegrees = Math.max(5, Math.min(90, Number(prepared?.sunDegrees ?? cfg.sunDegrees) || 20));
  let width = Number(prepared?.width) || 0;
  if (!(width > 0)) {
    const baseLineWidth = Math.max(
      0.1,
      audioApplyNumeric('layer.strokeWidth', Number(layer?.strokeWidth) || 1.5, layerIndex) *
        getLayerStrokeWidthMultiplier(layer),
    );
    const widthBase =
      cfg.widthRelative === true
        ? Math.max(
            0.05,
            Math.min(12, baseLineWidth * Math.max(0.01, Math.min(4, (Number(cfg.widthPercent) || 40) / 100))),
          )
        : Math.max(0.1, Math.min(4, Number(cfg.width) || 0.6));
    width = Math.max(0.03, Math.min(24, audioApplyNumeric('web.width', widthBase, layerIndex)));
  }
  const style =
    prepared?.renderWidth > 0
      ? {
          width: prepared.renderWidth,
          alpha: prepared.threadAlpha ?? 0.88,
          shadow: prepared.shadowBlur ?? Math.min(6, width * 2.4),
        }
      : getWebStyleProfile(cfg, width, 1);
  const visibility = Math.max(
    0,
    Math.min(1, Number(prepared?._visibilityFactor ?? prepared?.visibilityFactor ?? 1)),
  );
  if (visibility <= 0.0005) return;
  const cacheKey = `${type}:${branch}`;
  const cachedPath =
    !oscillating && visibility >= 0.999 && !prepared?.transition
      ? prepared?._branchPathCache?.[cacheKey] || null
      : null;
  const clipPath =
    branch === 'inside'
      ? prepared?.insideClipPath || prepared?.clipPath
      : prepared?.outsideClipPath || prepared?.clipPath;
  if (cachedPath && !glRecorder) {
    if (!outerStateIsolated) ctx.save();
    if (clipPath) {
      try {
        ctx.clip(clipPath, 'evenodd');
      } catch (_err) {
        ctx.clip(clipPath);
      }
    }
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha * style.alpha));
    ctx.strokeStyle = color;
    ctx.lineWidth = style.width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = style.shadow;
    ctx.stroke(cachedPath);
    if (style.style === 'laser' && secondaryColor !== color) {
      ctx.strokeStyle = secondaryColor;
      ctx.shadowColor = secondaryColor;
      ctx.shadowBlur = Math.max(1, style.shadow * 0.65);
      ctx.lineWidth = Math.max(0.08, style.width * 0.34);
      ctx.globalAlpha = Math.max(0, Math.min(1, alpha * style.alpha * 0.92));
      ctx.stroke(cachedPath);
    }
    if (!outerStateIsolated) ctx.restore();
    return;
  }

  let animating = false;
  const canCache = Boolean(
    prepared &&
    typeof Path2D !== 'undefined' &&
    !glRecorder &&
    !oscillating &&
    visibility >= 0.999 &&
    !prepared?.transition,
  );
  const pathTarget = canCache ? new Path2D() : ctx;
  if (!canCache) ctx.beginPath();
  if (
    prepared?.placementMode === 'selfIntersection' &&
    Array.isArray(prepared.spiralCrossingThreads) &&
    branch === 'inside'
  ) {
    // Build true cross-winding chords; never re-enter polygon corner
    // geometry for a Spiral intersection.  The endpoints are sampled
    // on the current Line master and corridor transforms are shared.
    for (const thread of prepared.spiralCrossingThreads) {
      pathTarget.moveTo(thread.x0, thread.y0);
      if (type === 'rounding') pathTarget.quadraticCurveTo(thread.cx, thread.cy, thread.x1, thread.y1);
      else pathTarget.lineTo(thread.x1, thread.y1);
    }
  } else
    for (let ci = 0; ci < corners.length; ci++) {
      const c = corners[ci];
      // Outside-straight threads span the exterior recess of a CONCAVE notch.
      // Convex tips must never sprout exterior rails: the other two Web modes
      // continue to use convex corners as before.
      // A spiral may cross itself: the signed area of the entire winding
      // does not define its inside. Honor every real anchor on its visible
      // rail for the inside branch, including a locally reversed turn.
      if (
        branch === 'outsideStraight'
          ? c.concave !== true
          : c.concave === true && c.spiralStrokeCorner !== true
      )
        continue;
      const metric = prepared?.cornerMetrics?.[ci] || null,
        visualPathIndex = Number.isInteger(metric?.pathIndex) ? metric.pathIndex : c.pathIndex;
      const visualPath = prepared?.visualPaths?.[visualPathIndex] || paths?.[visualPathIndex],
        closed = visualPath?.closed === true;
      const table =
          prepared?.visualPathTables?.[visualPathIndex] ||
          (visualPath?.points?.length > 2 ? buildPathLengthTable([visualPath]) : null),
        useContour = Boolean(table?.total > 4);
      let localMax = 0,
        anchorDistance = 0,
        anchorX = c.x,
        anchorY = c.y;
      if (metric && useContour) {
        anchorDistance = metric.distance;
        anchorX = metric.x;
        anchorY = metric.y;
      } else if (useContour) {
        const near = nearestWebDistanceOnTable(table, c.x, c.y);
        anchorDistance = near.distance;
        anchorX = near.x;
        anchorY = near.y;
      }
      const localCornerMode =
        placementMode === 'corners' || branch === 'outsideStraight' || style.style === 'spiderSun';
      if (!localCornerMode && closed && useContour) {
        localMax = Math.min(
          table.total * 0.499,
          table.total * 0.25 * (Math.max(0, Math.min(100, depthPercent)) / 100) * depthMultiplier,
        );
      } else {
        const pct = Math.max(0, Math.min(100, depthPercent)) / 100;
        const visibleSpan =
          metric?.cornerSpan > 0
            ? metric.cornerSpan
            : Math.max(0, Math.min(Number(c.inLen) || 0, Number(c.outLen) || 0));
        localMax = Math.max(
          0,
          Math.min(useContour ? table.total * 0.499 : Infinity, visibleSpan * pct * depthMultiplier),
        );
      }
      // Never extrapolate through an open spiral endpoint.  For closed
      // polygon/periodic contours the previous wrapping remains intact.
      if (useContour && !closed) localMax = Math.min(localMax, anchorDistance, table.total - anchorDistance);
      const cornerPlacement = placementMode === 'corners';
      if (localMax < (cornerPlacement ? 0.001 : 0.25)) continue;
      const budget = cornerPlacement
        ? webCornerThreadBudget(localMax, spacing)
        : Math.max(1, Math.min(96, Math.floor(localMax / spacing)));
      const maxCount = Math.ceil(budget);
      // Angle presence is already smooth, so corner mode needs no
      // frame-to-frame nearest-anchor search or per-copy growth state.
      let growth = Math.max(0, Math.min(1, c.target));
      if (!cornerPlacement) {
        let rt;
        const dynamicWebPaths =
          isCurrentFrameDynamicPathList(paths) || isCurrentFrameDynamicPathList(prepared?.visualPaths);
        if (dynamicWebPaths && useContour) {
          rt = resolveDynamicWebCornerRuntime(
            layer?.id || 'layer',
            visualPathIndex,
            anchorDistance / table.total,
            anchorX,
            anchorY,
            table.total,
            now,
          );
        } else {
          const key = `${layer?.id || 'layer'}:${c.pathIndex}:${c.cornerOrdinal}`;
          rt = webRuntime.corners.get(key);
          if (!rt) {
            rt = { growth: 0, last: now, lastSeen: now, fresh: true };
            webRuntime.corners.set(key, rt);
          }
        }
        const rawDt = Math.max(0, (now - rt.last) / 1000),
          dt = rawDt > 1.25 ? 0 : rawDt;
        rt.last = now;
        rt.lastSeen = now;
        const target = growth;
        const visibilityTransition = prepared?.transition?.kind === 'visibility';
        if (visibilityTransition) {
          rt.growth = target;
        } else {
          // When a corner is already at its target, spring update
          // would multiply exactly zero; skip its exponential.
          if (rt.growth !== target) {
            const k = 1 - Math.exp(-dt * 8.5);
            rt.growth += (target - rt.growth) * k;
            if (Math.abs(target - rt.growth) > 0.004) animating = true;
          }
        }
        growth = rt.growth;
      }
      const totalPhase = growth * budget * visibility;
      if (style.style === 'spiderSun') {
        const grow = webSmoothstep01(Math.max(0, Math.min(1, growth * visibility)));
        if (grow > 0.001) {
          const originX = metric?.rounded === true ? metric.roundCenterX : Number(c.x) || anchorX,
            originY = metric?.rounded === true ? metric.roundCenterY : Number(c.y) || anchorY,
            reach = Math.max(1, localMax * grow);
          let va = { x: c.uxPrev, y: c.uyPrev },
            vb = { x: c.uxNext, y: c.uyNext };
          if (useContour) {
            const aa = pointAtWrappedWebDistance(
                table,
                anchorDistance - localMax,
                webDrawScratch.pointA,
                closed,
              ),
              bb = pointAtWrappedWebDistance(table, anchorDistance + localMax, webDrawScratch.pointB, closed),
              al = Math.hypot(aa.x - originX, aa.y - originY),
              bl = Math.hypot(bb.x - originX, bb.y - originY);
            if (al > 1e-4) va = { x: (aa.x - originX) / al, y: (aa.y - originY) / al };
            if (bl > 1e-4) vb = { x: (bb.x - originX) / bl, y: (bb.y - originY) / bl };
          }
          let a0 = Math.atan2(va.y, va.x),
            a1 = Math.atan2(vb.y, vb.x),
            delta = ((a1 - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

          const mid = a0 + delta * 0.5,
            half = Math.abs(delta) * 0.5,
            step = (Math.max(5, sunDegrees) * Math.PI) / 180,
            offsets = [0];
          for (let off = step; off < half - 1e-5 && offsets.length < 35; off += step) {
            offsets.push(-off, off);
          }
          if (half > 1e-5) {
            offsets.push(-half, half);
          }
          offsets.sort((a, b) => a - b);
          const rays = [];
          for (let ri = 0; ri < Math.min(36, offsets.length); ri++) {
            const off = offsets[ri],
              phase = oscillating
                ? Math.sin(oscillationPhase + ri * 0.73 + c.cornerOrdinal * 0.19) *
                  (0.035 * oscStrengthEffective)
                : 0,
              ang = mid + Math.sign(delta || 1) * off + phase,
              edge = half > 1e-5 ? Math.min(1, Math.abs(off) / half) : 0,
              rr = reach * (1 - 0.08 * edge),
              x = originX + Math.cos(ang) * rr,
              y = originY + Math.sin(ang) * rr;
            rays.push({ ang, x, y });
            pathTarget.moveTo(originX, originY);
            pathTarget.lineTo(x, y);
          }
          rays.sort((a, b) => a.ang - b.ang);
          const rings = Math.max(1, Math.min(28, Math.floor(reach / Math.max(2, spacing))));
          for (let qi = 1; qi <= rings; qi++) {
            const rf = qi / rings;
            for (let ri = 0; ri < rays.length - 1; ri++) {
              const p0 = rays[ri],
                p1 = rays[ri + 1];
              pathTarget.moveTo(originX + (p0.x - originX) * rf, originY + (p0.y - originY) * rf);
              pathTarget.lineTo(originX + (p1.x - originX) * rf, originY + (p1.y - originY) * rf);
            }
          }
          if (oscillating) animating = true;
        }
        continue;
      }
      for (let ti = 0; ti < maxCount; ti++) {
        const life = totalPhase - ti;
        if (life <= 0.001) continue;
        const isStraight = branch === 'outsideStraight',
          tg = isStraight && !cornerPlacement ? 1 : webSmoothstep01(life);
        const base = Math.min(localMax, spacing * (ti + 1));
        // Zero angle variation is common: the hash and asymmetric
        // distance clamps cannot affect either thread endpoint.
        // Preserve the identical nonzero-jitter path below.
        let rawDa, rawDb;
        if (jitterStrength === 0) {
          rawDa = rawDb = Math.max(0.25, base);
        } else {
          const asym = webHashSigned(visualPathIndex, c.cornerOrdinal, ti, 137) * jitterStrength;
          rawDa = Math.max(0.25, Math.min(localMax, base * (1 + asym * 0.55)));
          rawDb = Math.max(0.25, Math.min(localMax, base * (1 - asym * 0.55)));
        }
        // Thread phase is needed only for an actually oscillating Web. In the
        // static mode the prior hash + trig work never reached any geometry.
        const wave =
          oscillating && oscStrength > 0
            ? Math.sin(oscillationPhase + webHashSigned(visualPathIndex, c.cornerOrdinal, ti, 911) * Math.PI)
            : 0;
        if (isStraight && oscillating && oscStrength > 0) {
          const slide = Math.min(0.78, 0.035 + 0.245 * oscStrengthEffective) * wave;
          rawDa = Math.max(0.25, Math.min(localMax, rawDa * (1 + slide)));
          rawDb = Math.max(0.25, Math.min(localMax, rawDb * (1 - slide)));
          animating = true;
        }
        const da = rawDa * tg,
          db = rawDb * tg;
        let ax, ay, bx, by;
        if (useContour) {
          const a = pointAtWrappedWebDistance(table, anchorDistance - da, webDrawScratch.pointA, closed),
            b = pointAtWrappedWebDistance(table, anchorDistance + db, webDrawScratch.pointB, closed);
          ax = a.x;
          ay = a.y;
          bx = b.x;
          by = b.y;
        } else {
          ax = c.x + c.uxPrev * da;
          ay = c.y + c.uyPrev * da;
          bx = c.x + c.uxNext * db;
          by = c.y + c.uyNext * db;
        }
        // Straight threads and non-oscillating inside threads need neither
        // midpoint nor tangent length. Outside arcs still use their midpoint.
        let dx = 0,
          dy = 0,
          midX = 0,
          midY = 0,
          waveX = 0,
          waveY = 0;
        if (branch === 'outsideArc' || (!isStraight && oscillating && oscStrength > 0)) {
          dx = bx - ax;
          dy = by - ay;
          midX = (ax + bx) * 0.5;
          midY = (ay + by) * 0.5;
        }
        if (!isStraight && oscillating && oscStrength > 0) {
          const len = Math.max(0.001, Math.hypot(dx, dy)),
            amp = Math.min(144, Math.max(0.25, spacing * (0.25 + 1.75 * oscStrengthEffective))),
            nx = -dy / len,
            ny = dx / len;
          waveX = nx * amp * wave * tg;
          waveY = ny * amp * wave * tg;
          animating = true;
        }
        pathTarget.moveTo(ax, ay);
        if (branch === 'inside') {
          if (type === 'bevel') {
            if (oscillating && oscStrength > 0)
              pathTarget.quadraticCurveTo(midX + waveX, midY + waveY, bx, by);
            else pathTarget.lineTo(bx, by);
          } else pathTarget.quadraticCurveTo(anchorX + waveX, anchorY + waveY, bx, by);
        } else if (branch === 'outsideStraight') {
          pathTarget.lineTo(bx, by);
        } else {
          let vx = anchorX - midX,
            vy = anchorY - midY,
            vl = Math.hypot(vx, vy);
          if (vl < 0.001) {
            vx = -dy;
            vy = dx;
            vl = Math.max(0.001, Math.hypot(vx, vy));
          }

          const reach = Math.max(spacing * tg, Math.max(rawDa, rawDb) * 0.55 * tg),
            controlX = anchorX + (vx / vl) * reach + waveX,
            controlY = anchorY + (vy / vl) * reach + waveY;
          pathTarget.quadraticCurveTo(controlX, controlY, bx, by);
        }
      }
    }
  if (canCache) {
    prepared._branchPathCache = prepared._branchPathCache || Object.create(null);
    prepared._branchPathCache[cacheKey] = pathTarget;
    if (!animating && prepared?.persistentVectorRecord && !prepared?.transition)
      prepared.persistentVectorRecord.paths[cacheKey] = pathTarget;
  }
  if (prepared) prepared.animating = prepared.animating || animating || visibility < 0.999;
  if (!outerStateIsolated) ctx.save();
  if (!glRecorder && clipPath) {
    try {
      ctx.clip(clipPath, 'evenodd');
    } catch (_err) {
      ctx.clip(clipPath);
    }
  }
  ctx.globalAlpha = Math.max(0, Math.min(1, alpha * style.alpha));
  ctx.strokeStyle = color;
  ctx.lineWidth = style.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = color;
  ctx.shadowBlur = style.shadow;
  if (canCache) ctx.stroke(pathTarget);
  else ctx.stroke();
  if (style.style === 'laser' && secondaryColor !== color) {
    ctx.globalAlpha = Math.max(0, Math.min(1, alpha * style.alpha * 0.92));
    ctx.strokeStyle = secondaryColor;
    ctx.shadowColor = secondaryColor;
    ctx.shadowBlur = Math.max(1, style.shadow * 0.65);
    ctx.lineWidth = Math.max(0.08, style.width * 0.34);
    if (canCache) ctx.stroke(pathTarget);
    else ctx.stroke();
  }
  if (!outerStateIsolated) ctx.restore();
  if (now - webRuntime.lastCleanup > 1200) {
    webRuntime.lastCleanup = now;
    for (const [key, rt0] of webRuntime.corners) {
      const ttl = rt0?.trackedDynamic === true ? 3200 : 1800;
      if (now - rt0.lastSeen > ttl) webRuntime.corners.delete(key);
    }
  }
  if (
    (animating || oscillating || visibility < 0.999) &&
    (!prepared || prepared._renderRequestedFrame !== frameGeometryRuntime.frameId)
  ) {
    if (prepared) prepared._renderRequestedFrame = frameGeometryRuntime.frameId;
    requestMainCanvasRender();
  }
}
function drawWebThreadsAnimated(
  ctx,
  paths,
  layer,
  alpha = 1,
  prepared = null,
  outerStateIsolated = false,
  forcedBranch = null,
) {
  if ((prepared ? prepared.enabled !== true : getLayerWebEnabled(layer) !== true) || alpha <= 0.001) return;
  const owner = prepared?.owner || ensureLayerEffectState(layer),
    tr = prepared ? prepared.transition : owner ? webRuntime.transitionByLayer.get(owner.id) : null;
  if (!tr) {
    if (owner?.showWeb !== true) return;
    if (prepared) prepared._visibilityFactor = 1;
    drawWebThreads(ctx, paths, layer, alpha, null, prepared, outerStateIsolated, forcedBranch);
    return;
  }
  const duration = Math.max(60, Number(tr.duration) || 180),
    now = prepared?.now || performance.now(),
    p = Math.max(0, Math.min(1, (now - Number(tr.start || 0)) / duration)),
    e = webSmoothstep01(p);
  if (tr.kind === 'visibility') {
    const from = Math.max(0, Math.min(1, Number(tr.from) || 0)),
      to = Math.max(0, Math.min(1, Number(tr.to) || 0));

    const ve = to > from ? 1 - Math.pow(1 - p, 3) : e,
      factor = from + (to - from) * ve;
    if (prepared) prepared._visibilityFactor = factor;
    if (factor > 0.0005)
      drawWebThreads(ctx, paths, layer, alpha, null, prepared, outerStateIsolated, forcedBranch);
    if (p >= 1 && owner) {
      if (tr.disableAtEnd === true || to <= 0.0005) {
        owner.showWeb = false;
        for (const key of Array.from(webRuntime.corners.keys()))
          if (String(key).startsWith(`${owner.id}:`)) webRuntime.corners.delete(key);
      }
      webRuntime.transitionByLayer.delete(owner.id);
      webRuntime.desiredVisibilityByLayer.delete(owner.id);
      if (prepared) {
        prepared.transition = null;
        prepared._visibilityFactor = to;
      }
    } else if (!prepared || prepared._transitionRenderRequestedFrame !== frameGeometryRuntime.frameId) {
      if (prepared) prepared._transitionRenderRequestedFrame = frameGeometryRuntime.frameId;
      requestMainCanvasRender();
    }
    return;
  }
  if (prepared) prepared._visibilityFactor = 1;
  if (tr.kind === 'type') {
    if (1 - e > 0.001)
      drawWebThreads(
        ctx,
        paths,
        layer,
        alpha * (1 - e),
        tr.fromType,
        prepared,
        outerStateIsolated,
        forcedBranch,
      );
    if (e > 0.001)
      drawWebThreads(ctx, paths, layer, alpha * e, tr.toType, prepared, outerStateIsolated, forcedBranch);
  } else {
    if (e > 0.001)
      drawWebThreads(ctx, paths, layer, alpha * e, tr.toType, prepared, outerStateIsolated, forcedBranch);
  }
  if (p >= 1 && owner) {
    webRuntime.transitionByLayer.delete(owner.id);
    if (prepared) prepared.transition = null;
  } else if (!prepared || prepared._transitionRenderRequestedFrame !== frameGeometryRuntime.frameId) {
    if (prepared) prepared._transitionRenderRequestedFrame = frameGeometryRuntime.frameId;
    requestMainCanvasRender();
  }
}
function getLightningFlashAlpha(progress) {
  const p = Math.max(0, Math.min(1, Number(progress) || 0));
  if (p < 0.86) return 0;
  if (p < 0.94) {
    const x = (p - 0.86) / 0.08;
    return x * x * (3 - 2 * x);
  }
  const x = (p - 0.94) / 0.06;
  const q = 1 - Math.max(0, Math.min(1, x));
  return q * q;
}

export { drawWebThreadsAnimated, getLightningFlashAlpha };
