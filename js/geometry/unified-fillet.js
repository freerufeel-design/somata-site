import './spline.js'; // initialisation order: this module runs after it
import { centripetalSplineBezierControls } from './spline.js';

function somataBaseEdge(layer, points, closed) {
  const n = Math.max(2, Math.round(Number(layer?.N) || 0));
  const radius = (Number(layer?.radius) || 0) * (Number(layer?.radiusMultiplier) || 1);
  if (Number.isFinite(radius) && radius > 0 && layer?.N != null) return 2 * radius * Math.sin(Math.PI / n);
  const lengths = [];
  for (let i = 0; i < points.length - (closed ? 0 : 1); i++) {
    const p = points[i],
      q = points[(i + 1) % points.length],
      d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d > 1e-6) lengths.push(d);
  }
  if (!lengths.length) return 0;
  lengths.sort((a, b) => a - b);
  return lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * 0.75))];
}

function somataDrawFullRoundingCircle(ctx, radius, startAngle, direction) {
  const pieces = 16,
    sweep = (direction * Math.PI * 2) / pieces;
  const handle = (4 / 3) * Math.tan(sweep / 4);
  let angle = startAngle;
  ctx.moveTo(radius * Math.cos(angle), radius * Math.sin(angle));
  for (let i = 0; i < pieces; i++) {
    const next = angle + sweep;
    const ax = radius * Math.cos(angle),
      ay = radius * Math.sin(angle);
    const bx = radius * Math.cos(next),
      by = radius * Math.sin(next);
    ctx.bezierCurveTo(ax - handle * ay, ay + handle * ax, bx + handle * by, by - handle * bx, bx, by);
    angle = next;
  }
  ctx.closePath();
}
function drawUnifiedFilletPath(ctx, raw, closed, rounding, cornerFlags, options = {}) {
  const pts = raw || [],
    count = pts.length;

  if (count < 3 || !ctx || typeof ctx.bezierCurveTo !== 'function') return false;
  const amount = Math.max(0, Math.min(2, Number(rounding) || 0));
  if (amount < 1e-6) return false;
  const flags = Array.isArray(cornerFlags) ? cornerFlags : [];

  const strength = (i) =>
    options.bridgeRoundFlags?.[i] === false || (!closed && (i === 0 || i === count - 1))
      ? 0
      : flags[i] === true
        ? 1
        : typeof flags[i] === 'number' && Number.isFinite(flags[i])
          ? Math.max(0, Math.min(1, flags[i]))
          : 0;
  if (!pts.some((_, i) => strength(i) > 0)) return false;

  let circle = null;
  if (closed && amount > 1 && pts.every((_, i) => strength(i) === 1)) {
    let signedTwiceArea = 0,
      maximumRadius = 0;
    for (let i = 0; i < count; i++) {
      const p = pts[i],
        q = pts[(i + 1) % count];
      signedTwiceArea += p.x * q.y - p.y * q.x;
      maximumRadius = Math.max(maximumRadius, Math.hypot(p.x, p.y));
    }
    if (maximumRadius > 1e-8) {
      const t = amount - 1;
      circle = {
        radius: maximumRadius,
        angle: Math.atan2(pts[0].y, pts[0].x),
        direction: signedTwiceArea > 0 ? 1 : -1,
        weight: t * t * (3 - 2 * t),
      };
      if (amount >= 2) {
        somataDrawFullRoundingCircle(ctx, circle.radius, circle.angle, circle.direction);
        return true;
      }
    }
  }
  const edge = Math.max(1e-8, Number(options.baseEdge) || somataBaseEdge(options.layer, pts, closed));
  const drop = Math.max(
    0,
    Math.min(0.95, Number(options.maxRadiusDrop ?? options.layer?.roundingMaxRadiusDrop ?? 30) / 100),
  );
  const mix = (a, b, t) => a + (b - a) * t;

  const rail = [];
  const epsilon = Math.max(1e-10, edge * 1e-10);
  const collapseTolerance = Math.max(epsilon, edge * 2e-6);
  const appendSample = (p, finalEndpoint = false) => {
    const last = rail[rail.length - 1];
    if (last && Math.hypot(last.x - p.x, last.y - p.y) < collapseTolerance) {
      last.corner = Math.max(last.corner, p.corner);
      last.synthetic &&= p.synthetic;
      if (!closed && finalEndpoint) {
        last.x = p.x;
        last.y = p.y;
      }
      return;
    }
    rail.push(p);
  };
  const spline = options.spline === true;

  const splineSubdivisions =
    options.splineSubdivisions === 8
      ? 8
      : options.splineSubdivisions === 16
        ? 16
        : typeof window !== 'undefined' && window.__somataSplineFilletSteps === 8
          ? 8
          : 16;
  for (let i = 0; i < count - (closed ? 0 : 1); i++) {
    const j = (i + 1) % count,
      p = pts[i],
      q = pts[j];
    appendSample({ x: p.x, y: p.y, corner: strength(i), synthetic: false });
    if (!spline || typeof centripetalSplineBezierControls !== 'function') continue;
    const prev = closed || i > 0 ? pts[(i - 1 + count) % count] : null;
    const next = closed || j < count - 1 ? pts[(j + 1) % count] : null;
    const whole = options.wholeCurveSpline === true;
    const p0 = (whole || flags[i] !== true) && prev ? prev : { x: 2 * p.x - q.x, y: 2 * p.y - q.y };
    const p3 = (whole || flags[j] !== true) && next ? next : { x: 2 * q.x - p.x, y: 2 * q.y - p.y };
    const c = centripetalSplineBezierControls(p0, p, q, p3, 0.5);

    const sub = splineSubdivisions;
    for (let k = 1; k < sub; k++) {
      const t = k / sub,
        u = 1 - t;
      appendSample({
        x: u * u * u * p.x + 3 * u * u * t * c.c1.x + 3 * u * t * t * c.c2.x + t * t * t * q.x,
        y: u * u * u * p.y + 3 * u * u * t * c.c1.y + 3 * u * t * t * c.c2.y + t * t * t * q.y,
        corner: false,
        synthetic: true,
      });
    }
  }
  if (!closed)
    appendSample({ x: pts[count - 1].x, y: pts[count - 1].y, corner: false, synthetic: false }, true);
  if (
    closed &&
    rail.length > 1 &&
    Math.hypot(rail[0].x - rail.at(-1).x, rail[0].y - rail.at(-1).y) < collapseTolerance
  ) {
    rail[0].corner = Math.max(rail[0].corner, rail.at(-1).corner);
    rail[0].synthetic &&= rail.at(-1).synthetic;
    rail.pop();
  }
  const n = rail.length;
  if (n < 3) return false;
  const edges = closed ? n : n - 1,
    arc = [0],
    vel = [],
    knots = [];
  for (let i = 0; i < edges; i++) {
    const p = rail[i],
      q = rail[(i + 1) % n];
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < epsilon) return false;
    vel.push({ x: (q.x - p.x) / d, y: (q.y - p.y) / d });
    arc.push(arc[i] + d);
  }
  const length = arc[edges];
  if (!(length > epsilon)) return false;
  const bisect = (sorted, x) => {
    let lo = 0,
      hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  let arcCursorX = -Infinity,
    arcCursor = 0;
  const at = (s, side = 1) => {
    const x = closed
      ? side < 0 && Math.abs(s - length) < epsilon
        ? length
        : ((s % length) + length) % length
      : Math.max(0, Math.min(length, s));
    let j;
    if (x >= arcCursorX) {
      j = arcCursor;
      while (j < arc.length && arc[j] < x) j++;
    } else j = bisect(arc, x);
    arcCursorX = x;
    arcCursor = j;

    if (j > 0 && Math.abs(arc[j - 1] - x) <= epsilon) j--;
    if (j < arc.length && Math.abs(arc[j] - x) <= epsilon)
      j = side < 0 ? Math.max(0, j - 1) : Math.min(edges - 1, j);
    else j = Math.max(0, j - 1);
    j = Math.min(edges - 1, j);
    const p = rail[j],
      v = vel[j],
      d = x - arc[j];
    return { point: { x: p.x + v.x * d, y: p.y + v.y * d }, velocity: v };
  };

  let width = Math.min(length * (closed ? 0.48 : 0.98), edge * 0.5 * (circle ? 1 : amount));
  if (width < epsilon) return false;

  const allowedStations = [];
  for (let i = 0; i < n; i++)
    if (rail[i].corner && (closed || (i > 0 && i < n - 1))) allowedStations.push(arc[i]);
  if (!allowedStations.length) return false;
  const microReach = Math.min(edge * 0.16, width * 0.4);
  const events = [];
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) continue;
    let weight = rail[i].corner;

    if (!weight && !rail[i].synthetic && microReach > epsilon) {
      const s = arc[i],
        j = bisect(allowedStations, s);
      const before = allowedStations[(j - 1 + allowedStations.length) % allowedStations.length];
      const after = allowedStations[j % allowedStations.length];
      const d = closed
        ? Math.min((s - before + length) % length, (after - s + length) % length)
        : Math.min(
            j ? s - allowedStations[j - 1] : Infinity,
            j < allowedStations.length ? allowedStations[j] - s : Infinity,
          );
      if (d < microReach) {
        const u = d / microReach;

        weight = 1 - u * u * (3 - 2 * u);
      }
    }

    if (!closed && microReach > epsilon) {
      const d = Math.min(arc[i], length - arc[i]);
      if (d < microReach) {
        const u = Math.max(0, d / microReach);
        weight *= u * u * (3 - 2 * u);
      }
    }
    if (weight <= 0) continue;
    const prev = vel[(i - 1 + edges) % edges],
      next = vel[i % edges];
    const jump = { x: next.x - prev.x, y: next.y - prev.y };
    if (Math.hypot(jump.x, jump.y) < 1e-12) continue;
    events.push({ s: arc[i], dv: { x: jump.x * weight, y: jump.y * weight }, factor: 1 });

    if (weight > 0 && weight < 1) {
      let factor = 0.48 * weight * (1 - weight);
      if (!closed) {
        const endpointDistance = Math.min(arc[i], length - arc[i]);
        factor = Math.min(factor, (0.45 * endpointDistance) / width);
      }
      if (factor > 1e-8)
        events.push({ s: arc[i], dv: { x: jump.x * (1 - weight), y: jump.y * (1 - weight) }, factor });
    }
  }
  if (!events.length) return false;
  const basis = [];
  for (const ev of events) {
    for (let k = closed ? -1 : 0; k <= (closed ? 1 : 0); k++) {
      const s = ev.s + k * length;
      if (s + width < 0 || s - width > length) continue;
      basis.push({ s, dv: ev.dv, factor: ev.factor });
    }
  }
  basis.sort((a, b) => a.s - b.s);
  const basisStations = basis.map((v) => v.s);
  const calc = (s, side = 1, w = width) => {
    const origin = at(s, side),
      p = origin.point,
      d = origin.velocity;
    let dx = 0,
      dy = 0,
      vx = 0,
      vy = 0;

    for (let k = bisect(basisStations, s - w); k < basis.length && basis[k].s < s + w; k++) {
      const v = basis[k];
      const localWidth = w * v.factor;
      const t = s - v.s,
        abs = Math.abs(t);
      if (abs >= localWidth) continue;
      const h = localWidth - abs;
      const g = (h * h * h) / (6 * localWidth * localWidth);

      const derivativeSide = Math.abs(t) <= epsilon ? (side < 0 ? 1 : -1) : t < 0 ? 1 : -1;
      const gp = (derivativeSide * h * h) / (2 * localWidth * localWidth);
      dx += g * v.dv.x;
      dy += g * v.dv.y;
      vx += gp * v.dv.x;
      vy += gp * v.dv.y;
    }
    return { p, velocity: d, dx, dy, vx: d.x + vx, vy: d.y + vy };
  };

  let originalRadius = 0;
  for (const p of pts) originalRadius = Math.max(originalRadius, Math.hypot(p.x, p.y));
  const required = originalRadius * Math.min(1, 1 - drop + 0.008);

  if (drop === 0 && options.skipRadiusSearch !== true) width = Math.min(width, epsilon * 2);
  else if (required > epsilon && options.skipRadiusSearch !== true) {
    const initialWidth = width;

    let peakIndex = 0,
      peakRadius = -Infinity;
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(rail[i].x, rail[i].y);
      if (r > peakRadius) {
        peakRadius = r;
        peakIndex = i;
      }
    }
    let guardIsProvablyInactive = false;
    if (options.forceFullRadiusGuard !== true && peakRadius >= required && peakRadius > epsilon) {
      const station = arc[peakIndex];
      const radialX = rail[peakIndex].x / peakRadius;
      const radialY = rail[peakIndex].y / peakRadius;
      let worstLoss = 0;
      for (
        let j = bisect(basisStations, station - initialWidth);
        j < basis.length && basis[j].s <= station + initialWidth;
        j++
      ) {
        const ev = basis[j];
        const projected = radialX * ev.dv.x + radialY * ev.dv.y;
        if (projected >= 0) continue;
        const support = initialWidth * ev.factor;
        const h = support - Math.abs(station - ev.s);
        if (h > 0) worstLoss += (-projected * h * h * h) / (6 * support * support);
      }

      guardIsProvablyInactive = peakRadius - worstLoss - 0.04 * originalRadius >= required + 1e-10;
    }

    if (
      !guardIsProvablyInactive &&
      options.forceFullRadiusGuard !== true &&
      peakRadius >= required &&
      peakRadius > epsilon
    ) {
      const station = arc[peakIndex],
        radialX = rail[peakIndex].x / peakRadius,
        radialY = rail[peakIndex].y / peakRadius;
      const first = bisect(basisStations, station - initialWidth);
      let last = first;
      while (last < basis.length && basis[last].s <= station + initialWidth) last++;
      let previous = peakRadius,
        loss = 0;
      for (let k = 1; k <= 8; k++) {
        const w = (initialWidth * k) / 8;
        let current = peakRadius;
        for (let j = first; j < last; j++) {
          const ev = basis[j],
            projected = radialX * ev.dv.x + radialY * ev.dv.y;
          if (Math.abs(projected) <= 1e-14) continue;
          const support = w * ev.factor,
            h = support - Math.abs(station - ev.s);
          if (h > 0) current += (projected * h * h * h) / (6 * support * support);
        }
        loss += Math.max(0, previous - current);
        previous = current;
      }
      guardIsProvablyInactive = peakRadius - loss - 0.04 * originalRadius >= required + 1e-9;
    }
    if (!guardIsProvablyInactive) {
      const steps = 8;
      const lower = Array(steps + 1).fill(0);

      const influenceDistance = new Float64Array(basis.length);
      const influenceFactor = new Float64Array(basis.length);
      const influenceProjection = new Float64Array(basis.length);

      const guardSlope = (0.04 * originalRadius) / Math.max(initialWidth, epsilon);
      for (let i = 0; i < n; i++) {
        const point = rail[i],
          radius = Math.hypot(point.x, point.y);
        if (radius + 1e-12 < required || radius <= epsilon) continue;
        const station = arc[i],
          radialX = point.x / radius,
          radialY = point.y / radius;
        let influenceCount = 0;
        for (
          let j = bisect(basisStations, station - initialWidth);
          j < basis.length && basis[j].s <= station + initialWidth;
          j++
        ) {
          const ev = basis[j];
          const projected = radialX * ev.dv.x + radialY * ev.dv.y;
          if (Math.abs(projected) > 1e-14) {
            influenceDistance[influenceCount] = Math.abs(station - ev.s);
            influenceFactor[influenceCount] = ev.factor;
            influenceProjection[influenceCount] = projected;
            influenceCount++;
          }
        }
        let previous = radius,
          loss = 0;
        lower[0] = Math.max(lower[0], radius);
        for (let k = 1; k <= steps; k++) {
          const w = (initialWidth * k) / steps;
          let current = radius;
          for (let j = 0; j < influenceCount; j++) {
            const support = w * influenceFactor[j],
              h = support - influenceDistance[j];
            if (h > 0) current += (influenceProjection[j] * h * h * h) / (6 * support * support);
          }

          loss += Math.max(0, previous - current);
          previous = current;
          lower[k] = Math.max(lower[k], radius - loss);
        }
      }
      for (let k = 0; k <= steps; k++) lower[k] -= (guardSlope * initialWidth * k) / steps;
      if (lower[steps] < required) {
        let k = 1;
        while (k < steps && lower[k] >= required) k++;
        const before = lower[k - 1],
          after = lower[k];
        const frac = after < before ? Math.max(0, Math.min(1, (before - required) / (before - after))) : 0;
        width = Math.max(epsilon * 2, (initialWidth * (k - 1 + frac)) / steps);
      }
    }
  }

  if (drop > 0 && drop < 0.02 && options.skipRadiusSearch !== true) {
    const u = drop / 0.02;
    const budgetBlend = u * u * u * u;
    width = Math.max(epsilon * 2, Math.min(width, edge * amount * budgetBlend));
  }

  for (const ev of basis) {
    const s = ev.s;

    const support = width * ev.factor;
    if (s + support < 0 || s - support > length) continue;
    const clampStation = (t) => Math.max(0, Math.min(length, t));
    knots.push(clampStation(s - support), clampStation(s), clampStation(s + support));
  }
  for (let i = 0; i < arc.length; i++) knots.push(arc[i]);
  knots.push(0, length);

  const shoulder = !closed ? Math.min(width, length / 3) : 0;
  const left = !closed ? calc(0, 1) : null;
  const right = !closed ? calc(length, -1) : null;
  if (shoulder > 0) knots.push(shoulder, length - shoulder);
  knots.sort((a, b) => a - b);

  const knotTol = Math.max(1e-13, Math.min(epsilon * 0.25, width * 1e-8));
  const times = [];
  for (const s of knots) if (!times.length || s - times.at(-1) > knotTol) times.push(s);
  if (length - times.at(-1) > knotTol) times.push(length);

  const finalSupport = new Float64Array(basis.length);
  for (let i = 0; i < basis.length; i++) finalSupport[i] = width * basis[i].factor;
  let activeFirst = 0,
    activeLast = 0;
  const valuePair = (s) => {
    while (activeFirst < basis.length && basis[activeFirst].s < s - width) activeFirst++;
    while (activeLast < basis.length && basis[activeLast].s < s + width) activeLast++;
    const plus = at(s, 1),
      minus = at(s, -1);
    let dx = 0,
      dy = 0,
      plusX = 0,
      plusY = 0,
      minusX = 0,
      minusY = 0;
    for (let k = activeFirst; k < activeLast; k++) {
      const v = basis[k];
      const localWidth = finalSupport[k];
      const t = s - v.s,
        abs = Math.abs(t);
      if (abs >= localWidth) continue;
      const h = localWidth - abs;

      const h2 = h * h;
      const g = (h2 * h) / (6 * localWidth * localWidth);
      const onEvent = Math.abs(t) <= epsilon;
      const gpPlus = ((onEvent ? -1 : t < 0 ? 1 : -1) * h2) / (2 * localWidth * localWidth);
      const gpMinus = onEvent ? -gpPlus : gpPlus;
      dx += g * v.dv.x;
      dy += g * v.dv.y;
      plusX += gpPlus * v.dv.x;
      plusY += gpPlus * v.dv.y;
      minusX += gpMinus * v.dv.x;
      minusY += gpMinus * v.dv.y;
    }
    let x = plus.point.x + dx,
      y = plus.point.y + dy;
    let xMinus = minus.point.x + dx,
      yMinus = minus.point.y + dy;
    let vxPlus = plus.velocity.x + plusX,
      vyPlus = plus.velocity.y + plusY;
    let vxMinus = minus.velocity.x + minusX,
      vyMinus = minus.velocity.y + minusY;

    if (shoulder > 0 && s < shoulder) {
      const u = Math.max(0, s / shoulder),
        u2 = u * u,
        u3 = u2 * u;
      const h00 = 2 * u3 - 3 * u2 + 1,
        h10 = u3 - 2 * u2 + u;
      const d00 = (6 * u2 - 6 * u) / shoulder,
        d10 = 3 * u2 - 4 * u + 1;
      x -= left.dx * h00 + (left.vx - left.velocity.x) * shoulder * h10;
      xMinus -= left.dx * h00 + (left.vx - left.velocity.x) * shoulder * h10;
      y -= left.dy * h00 + (left.vy - left.velocity.y) * shoulder * h10;
      yMinus -= left.dy * h00 + (left.vy - left.velocity.y) * shoulder * h10;
      const cx = left.dx * d00 + (left.vx - left.velocity.x) * d10;
      const cy = left.dy * d00 + (left.vy - left.velocity.y) * d10;
      vxPlus -= cx;
      vyPlus -= cy;
      vxMinus -= cx;
      vyMinus -= cy;
    }
    if (shoulder > 0 && s > length - shoulder) {
      const u = Math.min(1, (s - (length - shoulder)) / shoulder),
        u2 = u * u,
        u3 = u2 * u;
      const h01 = -2 * u3 + 3 * u2,
        h11 = u3 - u2;
      const d01 = (-6 * u2 + 6 * u) / shoulder,
        d11 = 3 * u2 - 2 * u;
      x -= right.dx * h01 + (right.vx - right.velocity.x) * shoulder * h11;
      xMinus -= right.dx * h01 + (right.vx - right.velocity.x) * shoulder * h11;
      y -= right.dy * h01 + (right.vy - right.velocity.y) * shoulder * h11;
      yMinus -= right.dy * h01 + (right.vy - right.velocity.y) * shoulder * h11;
      const cx = right.dx * d01 + (right.vx - right.velocity.x) * d11;
      const cy = right.dy * d01 + (right.vy - right.velocity.y) * d11;
      vxPlus -= cx;
      vyPlus -= cy;
      vxMinus -= cx;
      vyMinus -= cy;
    }
    return { x, y, xMinus, yMinus, vxPlus, vyPlus, vxMinus, vyMinus };
  };

  const requestedFast =
    options.fastPolynomialFillets === true ||
    (options.fastPolynomialFillets !== false &&
      typeof window !== 'undefined' &&
      window.__somataFastFilletSweep === true);
  let evaluator = (s, i) => valuePair(s);
  if (
    requestedFast &&
    closed &&
    n >= 300 &&
    width > 1e-4 &&
    pts.every((_, i) => strength(i) === 1) &&
    basis.every((v) => v.factor === 1 && width * v.factor > 1e-5)
  ) {
    let maxGap = 0;
    for (let i = 1; i < times.length; i++) maxGap = Math.max(maxGap, times[i] - times[i - 1]);
    if (maxGap < width * 0.25) {
      const timeline = [];
      for (const v of basis) {
        const support = width * v.factor;
        if (!(support > 0)) continue;
        const inv = 1 / (6 * support * support);
        for (const [station, coefficient, linear] of [
          [v.s - support, inv, 0],
          [v.s, -2 * inv, -1],
          [v.s + support, inv, 0],
        ]) {
          if (station > 0 && station < length) timeline.push({ station, coefficient, linear, dv: v.dv });
        }
      }
      timeline.sort((a, b) => a.station - b.station);
      let missingEvents = 0;
      for (const ev of timeline) {
        const k = bisect(times, ev.station);
        if (times[k] !== ev.station && times[k - 1] !== ev.station) missingEvents++;
      }
      let transitionIndex = 0;

      const blockSize = 64;
      let blockOrigin = 0,
        polys = null;
      const initializeBlock = (s, index) => {
        blockOrigin = s;
        const probe = index + 1 < times.length ? (s + times[index + 1]) * 0.5 : s;
        const sumsX = [0, 0, 0, 0],
          sumsY = [0, 0, 0, 0];
        const start = bisect(basisStations, s - width);
        for (let k = start; k < basis.length && basis[k].s <= s + width; k++) {
          const v = basis[k],
            w = width * v.factor;
          const t = s - v.s;
          const sign = probe < v.s ? 1 : -1;
          const h = w + sign * t;
          if (!(Math.abs(probe - v.s) < w)) continue;
          const inv = 1 / (6 * w * w);
          const a0 = h * h * h * inv,
            a1 = sign * 3 * h * h * inv;
          const a2 = 3 * h * inv,
            a3 = sign * inv;
          sumsX[0] += a0 * v.dv.x;
          sumsY[0] += a0 * v.dv.y;
          sumsX[1] += a1 * v.dv.x;
          sumsY[1] += a1 * v.dv.y;
          sumsX[2] += a2 * v.dv.x;
          sumsY[2] += a2 * v.dv.y;
          sumsX[3] += a3 * v.dv.x;
          sumsY[3] += a3 * v.dv.y;
        }
        polys = { x: sumsX, y: sumsY };
        while (transitionIndex < timeline.length && timeline[transitionIndex].station <= s) transitionIndex++;
      };
      const applyTransition = (e) => {
        const t = blockOrigin - e.station,
          inv = e.coefficient,
          linear = e.linear;
        const c0 = inv * t * t * t + linear * t;
        const c1 = 3 * inv * t * t + linear,
          c2 = 3 * inv * t,
          c3 = inv;
        const x = e.dv.x,
          y = e.dv.y;
        polys.x[0] += c0 * x;
        polys.x[1] += c1 * x;
        polys.x[2] += c2 * x;
        polys.x[3] += c3 * x;
        polys.y[0] += c0 * y;
        polys.y[1] += c1 * y;
        polys.y[2] += c2 * y;
        polys.y[3] += c3 * y;
      };
      const evalPoly = (s) => {
        const t = s - blockOrigin;
        const [x0, x1, x2, x3] = polys.x,
          [y0, y1, y2, y3] = polys.y;
        return {
          dx: ((x3 * t + x2) * t + x1) * t + x0,
          dy: ((y3 * t + y2) * t + y1) * t + y0,
          vx: (3 * x3 * t + 2 * x2) * t + x1,
          vy: (3 * y3 * t + 2 * y2) * t + y1,
        };
      };
      const fastValuePair = (s, i) => {
        if (i % blockSize === 0 || !polys || s - blockOrigin > width * 0.12) {
          initializeBlock(s, i);
          return valuePair(s);
        }
        const before = evalPoly(s);
        while (transitionIndex < timeline.length && timeline[transitionIndex].station <= s) {
          applyTransition(timeline[transitionIndex++]);
        }
        const after = evalPoly(s);
        const plus = at(s, 1),
          minus = at(s, -1);
        let x = plus.point.x + after.dx,
          y = plus.point.y + after.dy;
        let xMinus = minus.point.x + after.dx,
          yMinus = minus.point.y + after.dy;
        let vxPlus = plus.velocity.x + after.vx,
          vyPlus = plus.velocity.y + after.vy;
        let vxMinus = minus.velocity.x + before.vx,
          vyMinus = minus.velocity.y + before.vy;
        if (shoulder > 0 && s < shoulder) {
          const u = Math.max(0, s / shoulder),
            u2 = u * u,
            u3 = u2 * u;
          const h00 = 2 * u3 - 3 * u2 + 1,
            h10 = u3 - 2 * u2 + u;
          const d00 = (6 * u2 - 6 * u) / shoulder,
            d10 = 3 * u2 - 4 * u + 1;
          x -= left.dx * h00 + (left.vx - left.velocity.x) * shoulder * h10;
          xMinus -= left.dx * h00 + (left.vx - left.velocity.x) * shoulder * h10;
          y -= left.dy * h00 + (left.vy - left.velocity.y) * shoulder * h10;
          yMinus -= left.dy * h00 + (left.vy - left.velocity.y) * shoulder * h10;
          const cx = left.dx * d00 + (left.vx - left.velocity.x) * d10;
          const cy = left.dy * d00 + (left.vy - left.velocity.y) * d10;
          vxPlus -= cx;
          vyPlus -= cy;
          vxMinus -= cx;
          vyMinus -= cy;
        }
        if (shoulder > 0 && s > length - shoulder) {
          const u = Math.min(1, (s - (length - shoulder)) / shoulder),
            u2 = u * u,
            u3 = u2 * u;
          const h01 = -2 * u3 + 3 * u2,
            h11 = u3 - u2;
          const d01 = (-6 * u2 + 6 * u) / shoulder,
            d11 = 3 * u2 - 2 * u;
          x -= right.dx * h01 + (right.vx - right.velocity.x) * shoulder * h11;
          xMinus -= right.dx * h01 + (right.vx - right.velocity.x) * shoulder * h11;
          y -= right.dy * h01 + (right.vy - right.velocity.y) * shoulder * h11;
          yMinus -= right.dy * h01 + (right.vy - right.velocity.y) * shoulder * h11;
          const cx = right.dx * d01 + (right.vx - right.velocity.x) * d11;
          const cy = right.dy * d01 + (right.vy - right.velocity.y) * d11;
          vxPlus -= cx;
          vyPlus -= cy;
          vxMinus -= cx;
          vyMinus -= cy;
        }
        return { x, y, xMinus, yMinus, vxPlus, vyPlus, vxMinus, vyMinus };
      };
      if (missingEvents === 0) evaluator = fastValuePair;
    }
  }

  const drawValue = circle
    ? (s, i) => {
        const v = evaluator(s, i),
          w = circle.weight,
          keep = 1 - w;

        const toCircle = (x, y, vx, vy) => {
          const r = Math.hypot(x, y);
          if (r <= 1e-9) {
            const theta = circle.angle + (circle.direction * 2 * Math.PI * s) / length;
            const omega = (circle.direction * 2 * Math.PI) / length;
            return {
              x: circle.radius * Math.cos(theta),
              y: circle.radius * Math.sin(theta),
              vx: -circle.radius * Math.sin(theta) * omega,
              vy: circle.radius * Math.cos(theta) * omega,
            };
          }
          const inv = circle.radius / r,
            dot = (x * vx + y * vy) / (r * r);
          return { x: x * inv, y: y * inv, vx: (vx - x * dot) * inv, vy: (vy - y * dot) * inv };
        };
        const plus = toCircle(v.x, v.y, v.vxPlus, v.vyPlus);
        const minus = toCircle(v.xMinus, v.yMinus, v.vxMinus, v.vyMinus);
        return {
          x: v.x * keep + plus.x * w,
          y: v.y * keep + plus.y * w,
          xMinus: v.xMinus * keep + minus.x * w,
          yMinus: v.yMinus * keep + minus.y * w,
          vxPlus: v.vxPlus * keep + plus.vx * w,
          vyPlus: v.vyPlus * keep + plus.vy * w,
          vxMinus: v.vxMinus * keep + minus.vx * w,
          vyMinus: v.vyMinus * keep + minus.vy * w,
        };
      }
    : evaluator;
  let previous = drawValue(times[0], 0);
  ctx.moveTo(previous.x, previous.y);
  for (let i = 1; i < times.length; i++) {
    const a = times[i - 1],
      b = times[i];
    if (b - a <= knotTol) continue;
    const current = drawValue(b, i),
      h = (b - a) / 3;
    ctx.bezierCurveTo(
      previous.x + previous.vxPlus * h,
      previous.y + previous.vyPlus * h,
      current.xMinus - current.vxMinus * h,
      current.yMinus - current.vyMinus * h,
      current.xMinus,
      current.yMinus,
    );
    previous = current;
  }
  if (closed) ctx.closePath();
  return true;
}

export { drawUnifiedFilletPath, somataDrawFullRoundingCircle };
