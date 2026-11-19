import './profile-pass.js'; // initialisation order: this module runs after it

/* Apply the birth envelope after the attachment route has resolved identities. */
const SomataLampStability = (() => {
  const tracks = new Map(),
    cell = 1;
  // A lamp's attachment point can hop along the contour from one frame to the next (a corner
  // key or slot changes owner) while the line itself barely moves. Drawn as is, that is a
  // teleport. A move far above the lamp's own recent speed is treated as a hop. The lamp does
  // NOT slide there (a straight slide cuts across empty space between neighbouring windings
  // and looks like a lamp flying over the gap): it fades out where it was last drawn and fades
  // in at the new place. GPU Arc lamps are placed by attachment + offset, so the offset
  // carries the same correction.
  const HOP_MIN_PX = 4,
    HOP_RATIO = 5;
  function glideHops(track, items, now, duration, animate, arc, hopGhosts, continuity) {
    const prev = track.pos || new Map(),
      pos = new Map(),
      seen = new Map();
    for (const v of items) seen.set(v.lampTraceId, (seen.get(v.lampTraceId) || 0) + 1);
    for (const v of items) {
      const id = v.lampTraceId;
      if (v.lampPhaseTimed || v.lampContourBound || seen.get(id) !== 1 || !Number.isFinite(v.px) || !Number.isFinite(v.py)) continue;
      const p = prev.get(id),
        s = { x: v.px, y: v.py, at: now, speed: 0, glideAt: 0, gx: 0, gy: 0 };
      if (p && !continuity.has(v)) {
        Object.assign(s, { speed: p.speed, glideAt: p.glideAt, gx: p.gx, gy: p.gy });
        if (animate && now > p.at) {
          const step = Math.hypot(v.px - p.x, v.py - p.y);
          if (!s.glideAt && step > Math.max(HOP_MIN_PX, HOP_RATIO * p.speed))
            Object.assign(s, { glideAt: now, gx: p.x, gy: p.y });
          else if (!s.glideAt) s.speed = p.speed * 0.7 + step * 0.3;
        } else if (now === p.at) s.speed = p.speed;
      }
      if (s.glideAt && !arc) {
        // Перекрёстное затухание: на новом месте лампа разгорается, а её тень гаснет на старом.
        // Сумма света не проваливается, поэтому «мигания» нет.
        const g = Math.max(0, Math.min(1, (now - s.glideAt) / duration)),
          e = g * g * (3 - 2 * g);
        hopGhosts.push({ v, x: s.gx, y: s.gy, base: v.intensityAlpha, weight: 1 - e });
        v.intensityAlpha *= e;
        s.x = v.px;
        s.y = v.py;
        if (g >= 1) s.glideAt = 0;
      } else if (s.glideAt) {
        const g = Math.max(0, Math.min(1, (now - s.glideAt) / duration)),
          fadeOut = g < 0.5,
          f = fadeOut ? g * 2 : g * 2 - 1,
          e = f * f * (3 - 2 * f),
          x = fadeOut ? s.gx : v.px,
          y = fadeOut ? s.gy : v.py;
        if (Number.isFinite(v.gpuLampOffsetX)) v.gpuLampOffsetX += x - v.px;
        if (Number.isFinite(v.gpuLampOffsetY)) v.gpuLampOffsetY += y - v.py;
        v.intensityAlpha *= fadeOut ? 1 - e : e;
        v.px = x;
        v.py = y;
        s.x = x;
        s.y = y;
        if (g >= 1) s.glideAt = 0;
      }
      pos.set(id, s);
    }
    track.pos = pos;
  }
  // Лампы одного ключевого узла (углы соседних витков спирали, близкие точки профиля) стоят на
  // расстоянии в несколько пикселей — внутри одной лампы видны 3–4 белых ядра. Из группы
  // близких ламп остаётся одна (первая по идентификатору); остальные гаснут плавно по мере
  // сближения (вес — сглаженная функция расстояния), поэтому рывков нет. Порог — доля радиуса
  // меньшей лампы: мелкие лампы не сливаются.
  function mergeCloseLamps(items, outputs, factor, strength) {
    const live = items.filter((v) => Number.isFinite(v.px) && Number.isFinite(v.py) && v.rad > 0);
    if (live.length < 2) return;
    // Главнее ключевые точки (lampRank 0), затем изломы (1); внутри ранга — по идентификатору.
    live.sort(
      (a, b) =>
        (a.lampRank || 0) - (b.lampRank || 0) ||
        (a.lampTraceId < b.lampTraceId ? -1 : a.lampTraceId > b.lampTraceId ? 1 : 0),
    );
    let maxRad = 0;
    for (const v of live) maxRad = Math.max(maxRad, v.rad);
    const bin = Math.max(1, factor * maxRad),
      grid = new Map(),
      merged = new Map();
    for (const v of live) {
      const base = outputs.get(v) || 0;
      let keep = 1;
      const bx = Math.floor(v.px / bin),
        by = Math.floor(v.py / bin);
      for (let dx = -1; dx <= 1 && keep > 0; dx++)
        for (let dy = -1; dy <= 1 && keep > 0; dy++)
          for (const w of grid.get(`${bx + dx}:${by + dy}`) || []) {
            const reach = Math.max(1, factor * Math.min(v.rad, w.rad)),
              d = Math.hypot(w.px - v.px, w.py - v.py) / reach;
            if (d >= 1) continue;
            // Внутри половины радиуса сосед гасится целиком, дальше возвращается плавно до края.
            const t = Math.max(0, (d - 0.5) / 0.5),
              near = 1 - t * t * (3 - 2 * t),
              wLevel = merged.get(w) || 0,
              dominance = Math.min(1, wLevel / Math.max(base, 1e-3));
            keep *= 1 - near * dominance * strength;
          }
      merged.set(v, base * keep);
      const k = `${bx}:${by}`;
      let list = grid.get(k);
      if (!list) grid.set(k, (list = []));
      list.push(v);
    }
    for (const [v, value] of merged) outputs.set(v, value);
  }
  // Лампы, которые были в прошлом кадре, а в этом пропали по идентификатору.
  function findOrphans(track, present, transferred) {
    const orphans = [];
    if (!track.birthPos) return orphans;
    for (const [id, level] of track.levels) {
      const p = track.birthPos.get(id);
      if (level > 0.001 && p && !present.has(id) && !transferred.has(id)) orphans.push({ id, x: p[0], y: p[1], level, used: false });
    }
    return orphans;
  }
  // Смена схемы идентификаторов (например, статика → морф: `blue:…` → `key:…`) не должна гасить
  // лампы: лампа без истории, у которой в прошлом кадре на том же месте стояла лампа с другим
  // (теперь пропавшим) идентификатором, наследует её уровень, а не рождается тёмной. Пары жадные,
  // один к одному, по расстоянию; по-настоящему новые лампы (рядом ничего не было) рождаются тёмными.
  function inheritLevels(track, items, orphans, spatial) {
    if (!orphans.length) return null;
    const born = items.filter((v) => spatial(v) && !track.levels.has(v.lampTraceId));
    if (!born.length || born.length * orphans.length > 250000) return null;
    born.sort((a, b) => (a.lampTraceId < b.lampTraceId ? -1 : a.lampTraceId > b.lampTraceId ? 1 : 0));
    const result = new Map();
    for (const v of born) {
      const reach = Math.min(40, Math.max(3, Number(v.rad) || 8));
      let best = null,
        bestD = reach * reach;
      for (const o of orphans) {
        if (o.used) continue;
        const d = (o.x - v.px) * (o.x - v.px) + (o.y - v.py) * (o.y - v.py);
        if (d < bestD) {
          bestD = d;
          best = o;
        }
      }
      if (best) {
        best.used = true;
        result.set(v, best.level);
      }
    }
    return result.size ? result : null;
  }
  const SAME_POINT_EPS = 1e-4;
  const isSpatial = (v) => Number.isFinite(v.px) && Number.isFinite(v.py);
  function arcKey(v) {
    if (!Number.isFinite(v.pathIndex) || !Number.isFinite(v.lampAttachFraction)) return null;
    return `${v.pathIndex}:${Math.round(v.lampAttachFraction * 1e7)}:${Math.round((v.gpuLampOffsetX || 0) * 1e4)}:${Math.round((v.gpuLampOffsetY || 0) * 1e4)}`;
  }
  // Match coincident lights one-to-one before any ID-based birth or hop. Retained GPU arcs
  // supply attachment references instead of CPU centres; their (0,0) placeholders are not positions.
  function matchContinuity(track, items, present, boundary, arc, arcPlaceholders) {
    const matched = new Map(), used = new Set();
    if (!track.drawn?.length || (!boundary && items.every((v) => track.levels.has(v.lampTraceId))))
      return { matched, used };
    const grid = new Map(), attachments = new Map();
    const precision = boundary && items.some((v) => v.lampContourBound) ? 0.75 : SAME_POINT_EPS;
    const add = (map, key, old) => {
      let list = map.get(key);
      if (!list) map.set(key, (list = []));
      list.push(old);
    };
    for (const old of track.drawn || []) {
      if (old.level <= 0.001 || old.drawn <= 0.001 || (!boundary && present.has(old.id))) continue;
      if (old.arcKey !== null) add(attachments, old.arcKey, old);
      if (Number.isFinite(old.x))
        add(grid, `${Math.floor(old.x / precision)}:${Math.floor(old.y / precision)}`, old);
    }
    const candidates = boundary && precision > SAME_POINT_EPS
      ? items.slice().sort((a, b) => Number(a.lampTargetPresent === false) - Number(b.lampTargetPresent === false))
      : items;
    for (const v of candidates) {
      if (!(v.intensityAlpha > 0.001) || (!boundary && track.levels.has(v.lampTraceId))) continue;
      let best = null, bestD = Infinity;
      const offer = (old, d) => {
        if (used.has(old.id)) return;
        if (d < bestD || (d === bestD && (old.drawn > best.drawn ||
          (old.drawn === best.drawn && old.id === v.lampTraceId)))) {
          best = old;
          bestD = d;
        }
      };
      if (!arcPlaceholders && isSpatial(v)) {
        const bx = Math.floor(v.px / precision), by = Math.floor(v.py / precision);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (const old of grid.get(`${bx + dx}:${by + dy}`) || []) {
              const d = Math.hypot(v.px - old.x, v.py - old.y);
              if (d <= (v.lampContourBound ? precision : SAME_POINT_EPS)) offer(old, d);
            }
      }
      // Attachment equality is only a proxy if one side does not have actual centres.
      if (!best && (arc || v.lampHasAttachFraction === true))
        for (const old of attachments.get(arcKey(v)) || [])
          if (arcPlaceholders || !Number.isFinite(old.x)) offer(old, 0);
      if (best) {
        used.add(best.id);
        matched.set(v, boundary && v.lampContourBound ? best.drawn : best.level);
      }
    }
    return { matched, used };
  }
  // The dimmer lamp is dark inside half the mean diameter and reaches its
  // authored intensity where the two discs stop touching.
  function separation(a, b, distance) {
    const meanRadius = ((a.rad || 0) + (b.rad || 0)) / 2;
    return meanRadius > 0 ? Math.max(0, Math.min(1, distance / meanRadius - 1)) : Number(distance > 0);
  }
  function applyPhaseSeparation(track, items, phase, allCrossings, progress) {
    if (track.phase !== phase || !track.separated) track.separated = new Set();
    const survivors = items.filter(v => v.lampSourcePresent && v.lampTargetPresent && isSpatial(v));
    for (const v of items) {
      if (!v.lampPhaseTimed || v.lampRank === 1 || v.lampSourcePresent === v.lampTargetPresent || !isSpatial(v)) continue;
      if ((progress === 0 && !v.lampSourcePresent) || (progress === 1 && !v.lampTargetPresent)) {
        v.intensityAlpha = 0;
        continue;
      }
      let factor = 1, paired = false;
      for (const other of survivors) {
        if (other.pathIndex !== v.pathIndex) continue;
        paired = true;
        factor = Math.min(factor, separation(v, other, Math.hypot(v.px - other.px, v.py - other.py)));
      }
      if (!paired) continue;
      const full = Number.isFinite(v.brightness) ? Math.max(0, Math.min(1, v.brightness / 100)) : 1;
      if (v.lampTargetPresent && factor === 1) track.separated.add(v.lampTraceId);
      v.intensityAlpha = allCrossings || (v.lampTargetPresent && track.separated.has(v.lampTraceId))
        ? full : full * factor;
    }
  }
  function suppressEndpointOverlaps(items, strength, arcPlaceholders, lampRadius = false, distanceScale = 0.5) {
    const lit = items.filter((v) => v.intensityAlpha > 0 && (arcPlaceholders || isSpatial(v)));
    lit.sort((a, b) =>
      (lampRadius ? Number(!!(b.lampSourcePresent && b.lampTargetPresent)) - Number(!!(a.lampSourcePresent && a.lampTargetPresent)) : 0) ||
      b.intensityAlpha - a.intensityAlpha ||
      (a.lampRank || 0) - (b.lampRank || 0) ||
      String(a.lampTraceId).localeCompare(String(b.lampTraceId)),
    );
    const grid = new Map();
    const occupied = new Set();
    const gridSize = lampRadius ? lit.reduce((size, v) => Math.max(size, (v.rad || 0) * 2), cell) : cell;
    for (const v of lit) {
      const x = Math.floor(v.px / gridSize), y = Math.floor(v.py / gridSize);
      const key = arcPlaceholders ? arcKey(v) : `${x}:${y}`;
      if (key === null) continue;
      if (lampRadius) {
        const exact = Math.round(v.px / SAME_POINT_EPS) + ':' + Math.round(v.py / SAME_POINT_EPS);
        if (occupied.has(exact)) { v.intensityAlpha = 0; continue; }
        occupied.add(exact);
      }
      let overlap = 0;
      if (arcPlaceholders) {
        overlap = grid.has(key) ? 1 : 0;
      } else {
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (const earlier of grid.get(`${x + dx}:${y + dy}`) || []) {
              const distance = Math.hypot(v.px - earlier.px, v.py - earlier.py);
              const d = lampRadius
                ? Math.min(1, distance / Math.max(SAME_POINT_EPS, ((v.rad || 0) + (earlier.rad || 0)) * distanceScale))
                : Math.min(1, distance / cell);
              overlap = Math.max(overlap, lampRadius ? 1 - d : 1 - d * d * (3 - 2 * d));
            }
      }
      v.intensityAlpha *= 1 - strength * overlap;
      if (v.intensityAlpha > 0 && (!lampRadius || overlap === 0)) {
        let list = grid.get(key);
        if (!list) grid.set(key, (list = []));
        list.push(v);
      }
    }
  }
  function apply(scope, items, {
    now, duration, animate, arc = false, arcPlaceholders = false, merge = 0,
    phase = null, phaseProgress = null, phaseTiming = null, extinguishIntersections = true, singleWinner = false, intersectionDistance = 50,
  }) {
    let track = tracks.get(scope);
    if (!track || now < track.now || now - track.now > Math.max(2000, duration * 2)) {
      track = { now, levels: new Map(), pending: false, ghosts: [], snaps: new Map() };
      tracks.set(scope, track);
      for (const [k, v] of tracks) if (now - v.now > 120000) tracks.delete(k);
    }
    const dt = now - track.now,
      limit = duration > 0 ? Math.max(0, dt) / duration : 1,
      active = animate || track.pending;
    const next = new Map(),
      bins = new Map(),
      levels = new Map(),
      keys = new Map();
    let rawPeak = 0,
      rawOverlap = 0,
      maxMultiplicity = 0,
      peak = 0,
      pending = false;
    const spatial = (v) => !arcPlaceholders && isSpatial(v);
    if (!arcPlaceholders && phase !== null && phaseTiming) applyPhaseSeparation(track, items, phase, extinguishIntersections && singleWinner, phaseProgress);
    const present = new Set();
    for (const v of items) present.add(v.lampTraceId);
    const boundary = track.drawn && (track.phase !== phase || track.arc !== arc);
    const { matched, used } = matchContinuity(track, items, present, boundary, arc, arcPlaceholders);
    const orphans = arc ? [] : findOrphans(track, present, used);
    const inherited = arc || boundary ? null : inheritLevels(track, items, orphans, spatial);
    for (const v of items) {
      const key = arc ? arcKey(v) : null;
      keys.set(v, key);
      const id = v.lampTraceId,
        target = v.intensityAlpha,
        previous = matched.get(v) ?? (used.has(id) ? undefined : track.levels.get(id)) ?? inherited?.get(v);
      const sourceAtStart = phase !== null && Number.isFinite(phaseProgress) && phaseProgress <= 0.05 &&
        v.lampSourcePresent === true;
      // An authored source vertex is already lit at the phase boundary, even
      // if correspondence or rounding changed its ID and sampled position.
      const ceiling = previous === undefined ? (sourceAtStart ? target : 0) : previous + limit;
      const meterLevel = active && duration > 0 && !v.lampPhaseTimed;
      let level = meterLevel ? Math.min(target, ceiling) : target;
      if (meterLevel && v.lampContourBound && v.lampTargetPresent !== false && v.lampPresence >= 0.999 &&
          previous !== undefined) {
        level = boundary && matched.has(v) ? previous : Math.max(level, previous - limit);
      }
      if (Math.abs(level - target) > 1e-5) pending = true;
      levels.set(v, level);
      next.set(id, Math.max(level, next.get(id) || 0));
      const k = arc ? key : spatial(v) ? `${Math.floor(v.px / cell)}:${Math.floor(v.py / cell)}` : null;
      if (k !== null) {
        let list = bins.get(k);
        if (!list) bins.set(k, (list = []));
        list.push(v);
      }
    }
    // Measure unsmoothed overlaps separately. Divide the actual light only
    // after the birth envelope, so a dark newborn cannot dim a lit lamp.
    const fade = phaseTiming
      ? Math.max(0, Math.min(1, Math.min(phaseTiming.elapsed, phaseTiming.remaining) / Math.max(1, phaseTiming.duration ?? duration)))
      : phase !== null && Number.isFinite(phaseProgress)
        ? Math.max(0, Math.min(1, Math.min(phaseProgress, 1 - phaseProgress) / 0.05))
        : 1;
    const endpoint = 1 - fade * fade * (3 - 2 * fade);
    const radiusOverlap = extinguishIntersections && singleWinner && !arcPlaceholders;
    const outputs = new Map();
    for (const v of items) {
      const a = v.intensityAlpha;
      rawPeak = Math.max(rawPeak, a);
      const level = levels.get(v);
      let sum = a,
        softSum = level,
        softMax = level,
        count = 1;
      const visit = (w, weight) => {
        if (v === w || weight <= 0) return;
        const b = w.intensityAlpha * weight;
        sum += b;
        const soft = levels.get(w) * weight;
        softSum += soft;
        softMax = Math.max(softMax, soft);
        if (weight > 0.75 && b > 0.002) count++;
      };
      if (arc) {
        for (const w of bins.get(keys.get(v)) || []) visit(w, 1);
      } else if (spatial(v)) {
        const x = Math.floor(v.px / cell),
          y = Math.floor(v.py / cell);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (const w of bins.get(`${x + dx}:${y + dy}`) || []) {
              const d = Math.min(1, Math.hypot(w.px - v.px, w.py - v.py) / cell);
              visit(w, 1 - d * d * (3 - 2 * d));
            }
      }
      const normalized = softSum > 0 ? (level * softMax) / softSum : 0;
      outputs.set(v, extinguishIntersections && !radiusOverlap ? normalized + (level - normalized) * endpoint : level);
      rawOverlap = Math.max(rawOverlap, sum);
      maxMultiplicity = Math.max(maxMultiplicity, count);
    }
    if (extinguishIntersections && !radiusOverlap && merge > 0 && !arcPlaceholders && endpoint < 1)
      mergeCloseLamps(items, outputs, merge, 1 - endpoint);
    // Исходные значения нужны «хранителю»: если на старте фазы все лампы разом гаснут, одна остаётся.
    const raw = new Map(),
      origin = new Map();
    for (const v of items) {
      raw.set(v, v.intensityAlpha);
      origin.set(v, [v.px, v.py, v.gpuLampOffsetX, v.gpuLampOffsetY]);
      v.intensityAlpha = outputs.get(v);
    }
    const hopGhosts = [];
    if (extinguishIntersections && !arcPlaceholders) {
      for (const id of used) track.pos?.delete(id);
      if (duration > 0)
        glideHops(track, items, now, duration, animate && track.arc === arc, arc, hopGhosts, matched);
      else track.pos = new Map();
    } else track.pos = new Map();
    // Тени: перескочившие лампы гаснут на старом месте, пропавшие по идентификатору (никому не
    // отданные) досвечивают и гаснут за то же время — вместе с разгорающимися новыми это
    // перекрёстное затухание без провала света.
    const ghostItems = new Set();
    const addGhost = (src, id, x, y, level) => {
      if (!(level > 0.002)) return;
      const ghost = Object.assign({}, src, { lampTraceId: `${id}~g`, px: x, py: y, intensityAlpha: level });
      ghostItems.add(ghost);
      items.push(ghost);
    };
    if (!arc && extinguishIntersections) {
      for (const g of hopGhosts) addGhost(g.v, g.v.lampTraceId, g.x, g.y, g.base * g.weight);
      if (active) {
        for (const o of orphans) {
          const snap = !o.used && track.snaps?.get(o.id);
          if (snap && !snap.lampPhaseTimed && !snap.lampContourBound && snap.intensityAlpha > 0.002)
            track.ghosts.push({ id: o.id, snap, at: now });
        }
      }
      track.ghosts = track.ghosts.filter((g) => {
        if (present.has(g.id) || now - g.at >= duration || now < g.at) return false;
        const f = (now - g.at) / duration;
        addGhost(g.snap, g.id, g.snap.px, g.snap.py, g.snap.intensityAlpha * (1 - f * f * (3 - 2 * f)));
        return true;
      });
      if (track.ghosts.length > 400) track.ghosts.length = 400;
    } else track.ghosts = [];
    // Хранитель: ни один кадр не должен остаться совсем без света, если в предыдущем он был.
    // Смена фазы меняет идентификаторы ламп (старые исчезают, новые рождаются тёмными), а перескоки
    // гасят лампы на старом месте — вместе это давало «все лампы погасли разом». Тогда одна лампа
    // (ближайшая к той, что светила последней) остаётся полностью включённой, без рождения и перескока.
    let litNow = 0,
      best = null;
    for (const v of items) {
      if (v.intensityAlpha > litNow) {
        litNow = v.intensityAlpha;
        best = v;
      }
    }
    const carriedLight = boundary && items.some((v) => v.lampContourBound && matched.has(v));
    if (!carriedLight && items.length && rawPeak > 0.05 && track.hadLit === true && litNow < 0.5 * rawPeak) {
      const eligible = items.filter((v) =>
        raw.get(v) >= 0.5 * rawPeak && (extinguishIntersections || v.lampTargetPresent !== false));
      let keeper = eligible.find((v) => v.lampTraceId === track.keeperId) || null;
      if (!keeper) {
        const from = track.litPos;
        let bestD = Infinity;
        for (const v of eligible) {
          const o = origin.get(v),
            d = from && Number.isFinite(o[0]) ? Math.hypot(o[0] - from.x, o[1] - from.y) : 0;
          if (d < bestD || (d === bestD && keeper && v.lampTraceId < keeper.lampTraceId)) {
            bestD = d;
            keeper = v;
          }
        }
      }
      if (keeper) {
        const o = origin.get(keeper);
        keeper.intensityAlpha = raw.get(keeper);
        keeper.px = o[0];
        keeper.py = o[1];
        if (Number.isFinite(o[2])) keeper.gpuLampOffsetX = o[2];
        if (Number.isFinite(o[3])) keeper.gpuLampOffsetY = o[3];
        next.set(keeper.lampTraceId, Math.max(next.get(keeper.lampTraceId) || 0, raw.get(keeper)));
        track.keeperId = keeper.lampTraceId;
        best = keeper;
        litNow = keeper.intensityAlpha;
      }
    } else track.keeperId = null;
    const phaseEdge = phase !== null && (phaseProgress === 0 || phaseProgress === 1);
    if (radiusOverlap && !phaseEdge)
      suppressEndpointOverlaps(items, 1, false, true, Math.max(0, Math.min(100, intersectionDistance)) / 100);
    else if (endpoint > 0) suppressEndpointOverlaps(items, endpoint, arcPlaceholders);
    if (!arcPlaceholders && !radiusOverlap && endpoint === 0) {
      const ends = items.filter(v => v.lampSpiralEndpoint);
      if (ends.length > 1) suppressEndpointOverlaps(ends, 1, false);
    }
    for (const v of items) peak = Math.max(peak, v.intensityAlpha);
    track.hadLit = rawPeak > 0.05 && litNow >= 0.5 * rawPeak;
    if (best && Number.isFinite(best.px)) track.litPos = { x: best.px, y: best.py };
    track.birthPos = new Map();
    const snaps = new Map();
    const drawn = [];
    for (const v of items) {
      if (ghostItems.has(v)) continue;
      const o = origin.get(v);
      drawn.push({
        id: v.lampTraceId,
        level: next.get(v.lampTraceId),
        drawn: v.intensityAlpha,
        x: spatial(v) ? v.px : NaN,
        y: spatial(v) ? v.py : NaN,
        arcKey: arc || v.lampHasAttachFraction === true ? arcKey(v) : null,
      });
      if (spatial(v) && o && Number.isFinite(o[0]) && Number.isFinite(o[1]))
        track.birthPos.set(v.lampTraceId, o);
      if (!arc && v.intensityAlpha > 0.002) {
        const snap = track.snaps.get(v.lampTraceId) || {};
        snaps.set(v.lampTraceId, Object.assign(snap, v));
      }
    }
    track.snaps = snaps;
    track.drawn = drawn;
    track.arc = arc;
    track.phase = phase;
    track.levels = next;
    track.now = now;
    track.pending = pending;
    return {
      pending,
      count: items.length,
      rawPeak,
      rawOverlap,
      maxMultiplicity,
      peak,
      positionSource: arc ? 'gpu-arc-attachment' : 'cpu-visual-centres',
    };
  }
  return { apply };
})();

export { SomataLampStability };
