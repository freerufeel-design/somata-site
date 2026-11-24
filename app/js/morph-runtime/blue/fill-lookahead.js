// Blue Morph: заливка «на цикл вперёд».
//
// При слиянии и разделении орбит морф рисует «лишние» контуры: при слиянии путь без пары в цели
// к концу фазы совпадает с соседним, при разделении путь без пары в источнике в начале фазы —
// дубль соседнего. В режиме «Математический» (even-odd) совпадающая пара гасит заливку внутри
// себя (центр звезды пустеет), а на стыке фаз лишний путь исчезает/появляется разом — скачок.
// Здесь:
//   1. лишний контур входит в заливку с весом g, который меняется до стыка (слияние) или после
//      него (разделение), и меняется заливка только внутри лишнего контура (ghostFillLayout);
//   2. топология следующей фазы (N, K, орбиты) выбирается заранее (planNextCycle) и затем
//      именно применяется — по ней дубли разделения следующей фазы вводятся в заливку уже в
//      хвосте текущей (fillSplitAheadWeight), чтобы центр пустел заранее, а не на стыке.
// Модуль чистый: все броски и чтения состояния приходят через параметры.

export const FILL_LOOKAHEAD_WINDOW = 0.25;

const clamp01 = (x) => Math.max(0, Math.min(1, Number(x) || 0));
const smooth = (x) => {
  const u = clamp01(x);
  return u * u * (3 - 2 * u);
};
const gcd = (a, b) => (b === 0 ? Math.abs(a) : gcd(b, a % b));

// Boundary-only handoffs must be continuous on both sides of the seam.
// A directional profile window controls the corresponding leg; the opposite
// leg uses the same share, in the adjacent phase. Whole-phase spiral envelopes
// use half a phase per leg (see spiralFillBoundaryAlpha).
export function fillBoundaryWindow(morph, whole = 1) {
  const mode = morph?.profileModeTransition;
  if (mode !== 'start' && mode !== 'end' && mode !== 'second') return whole;
  const pct = Number(morph?.profileModeTransitionPercent ?? 20);
  return Number.isFinite(pct) ? clamp01(pct / 100) : 0.2;
}

export function spiralFillTransitionProgress(t, morph) {
  let u=clamp01(t);
  const mode=morph?.profileModeTransition;
  if(mode==='start'||mode==='second'||mode==='end') {
    const w=fillBoundaryWindow(morph);
    if(w===0) return mode==='end' ? (u>=1?1:0) : 1;
    u=clamp01(mode==='end'?(u-(1-w))/w:u/w);
  }
  return smooth(u);
}

export function spiralFillBoundaryAlpha(t, morph) {
  const phase = clamp01(t);
  const w = Math.min(0.5, fillBoundaryWindow(morph, 0.5));
  if (w === 0) return 1; // explicit instantaneous transition, like the profile UI
  // A single current mesh has no old/new region IDs. Both legs meet at zero.
  // A single mesh cannot finish two longer ramps in one phase; cap each at
  // half a phase so the selected fill opacity is still reached.
  return smooth(Math.min(phase, 1 - phase) / w);
}

// «Лишний» контур морфа. При слиянии орбит (у пути нет пары в цели) он к концу фазы совпадает с
// соседним и на стыке исчезает; при разделении (нет пары в источнике) он в начале фазы — дубль
// соседнего. В режиме even-odd совпадающая пара контуров гасит заливку внутри себя (центр звезды
// пустеет), поэтому лишний контур входит в заливку с весом g:
//   слияние (dir −1) — g уходит в 0 за последние `window` фазы, до стыка;
//   разделение (dir +1) — g поднимается от 0 за первые `window` фазы, а если следующая фаза
//   разделение уже «предъявила» заранее (splitDone), то g = 1 сразу.
// Заливка меняется только внутри лишнего контура. Возвращает null для обычного контура.
export function fillGhostWeight(
  t,
  { sourcePresent = true, targetPresent = true, splitDone = false, window = FILL_LOOKAHEAD_WINDOW } = {},
) {
  if (sourcePresent !== false && targetPresent !== false) return null;
  const w = Number.isFinite(Number(window)) ? clamp01(window) : FILL_LOOKAHEAD_WINDOW;
  const phase = clamp01(t);
  if (targetPresent === false) {
    let g = w === 0 ? (phase < 1 ? 1 : 0) : 1 - smooth((phase - (1 - w)) / w);
    if (sourcePresent === false && !splitDone) g *= w === 0 ? 1 : smooth(phase / w);
    return { g, dir: -1 };
  }
  return { g: splitDone || w === 0 ? 1 : smooth(phase / w), dir: 1 };
}

// Вес дублей, которые орбита получит в начале СЛЕДУЮЩЕЙ фазы (её разделение по плану): они
// входят в заливку уже в хвосте текущей фазы, чтобы на стыке ничего не менялось.
export function fillSplitAheadWeight(t, window = FILL_LOOKAHEAD_WINDOW) {
  const w = Number.isFinite(Number(window)) ? clamp01(window) : FILL_LOOKAHEAD_WINDOW;
  return w === 0 ? (clamp01(t) >= 1 ? 1 : 0) : smooth((clamp01(t) - (1 - w)) / w);
}

// Число активных орбит фигуры {N/K} (как в buildCircleAnchors).
export function activeOrbitCount(N, K, customSuborbits = null) {
  const n = Math.max(2, Math.round(Number(N) || 4));
  const k = Math.max(1, Math.min(Math.floor(n / 2), Math.round(Number(K) || 1)));
  const g = Math.max(1, gcd(n, k));
  return customSuborbits != null ? Math.max(1, Math.min(Math.round(Number(customSuborbits) || 1), g)) : g;
}

// Раскладка заливки с лишними контурами. contours — [{ghost: null|{g,dir}, dup: 0|n}], где dup —
// сколько раз контур повторить как «приходящий» лишний (разделение следующей фазы, вес gDup).
// Возвращает порядок контуров в веере (индексы, с повторами) и группы {start,count,power} в
// единицах контуров: M (уходящие) | обычные | D (приходящие). Каждая группа — отдельная
// чётно-нечётная заливка прозрачностью 1−(1−α)^power; там, где группы совпадают, их доли
// складываются ровно в α, поэтому меняется только область внутри лишних контуров.
export function ghostFillLayout(contours, gDup = 0) {
  const M = [],
    R = [],
    D = [];
  let gM = 1,
    gD = 1,
    hasM = false,
    hasD = false;
  contours.forEach((c, i) => {
    if (c?.ghost && c.ghost.dir < 0) {
      M.push(i);
      gM = Math.min(gM, c.ghost.g);
      hasM = true;
    } else if (c?.ghost && c.ghost.dir > 0) {
      D.push(i);
      gD = Math.min(gD, c.ghost.g);
      hasD = true;
    } else R.push(i);
  });
  contours.forEach((c, i) => {
    const n = Math.max(0, Math.round(Number(c?.dup) || 0));
    if (n > 0 && !(c?.ghost && c.ghost.dir < 0)) {
      for (let k = 0; k < n; k++) D.push(i);
      gD = hasD ? Math.min(gD, gDup) : gDup;
      hasD = true;
    }
  });
  if (!hasM) gM = 0;
  if (!hasD) gD = 0;
  const order = [...M, ...R, ...D];
  const m = M.length,
    r = R.length,
    d = D.length;
  const groups = [
    { from: m, to: m + r, power: (1 - gM) * (1 - gD) },
    { from: 0, to: m + r, power: gM * (1 - gD) },
    { from: m, to: m + r + d, power: (1 - gM) * gD },
    { from: 0, to: m + r + d, power: gM * gD },
  ].filter((group) => group.to > group.from && group.power > 0.002);
  return { order, groups, ghosts: hasM || hasD };
}

// Подпись настроек, от которых зависит выбор цели: если пользователь их тронул
// между выбором и применением, план устарел и выбрасывается.
export function planSignature(morph) {
  const m = morph || {};
  const o = m.options || {};
  return JSON.stringify([
    m.monoOrbitTransforms === true,
    m.diversity === true,
    m.vertexMin,
    m.vertexMax,
    m.vertexMultiplier,
    m.stepMin,
    m.stepMax,
    m.orbitCountMin,
    m.orbitCountMax,
    m.orbitPercentMin,
    m.orbitPercentMax,
    o.byVertices === true,
    o.bySteps === true,
    o.bySpiralLayers === true,
    o.bySpiralOrder === true,
  ]);
}

// Что запишет `commitFullMorphTargetAtBoundary` в слой, когда цикл дойдёт до цели.
function committedTopology(layer, target, morph) {
  const o = morph.options || {};
  const N = o.byVertices ? target.N : layer.N;
  const K = o.bySteps ? Math.max(1, Math.min(Math.floor(N / 2), target.K)) : layer.K;
  return {
    N,
    K,
    customSuborbits: morph.monoOrbitTransforms ? (target.customSuborbits ?? null) : layer.customSuborbits,
  };
}

// План следующего цикла. `layers` — слои до фиксации цели, `targets` — цели текущего
// цикла (с проставленным morphOrbitCopies), `endpoints` — концевые состояния заливки.
// План строится только для слоёв, у которых в конце цикла видна заливка.
// hooks: blocked() — режимы, где план не строим; topology(layer, idx) → {N,K,customSuborbits};
// copies(srcVisual, dstVisual, srcCopies) → число копий; orbits(visual, layer) → число орбит.
export function planNextCycle({ layers, targets, endpoints, morph, hooks }) {
  if (!morph || !Array.isArray(layers) || !layers.length || hooks.blocked()) return null;
  const items = layers.map((layer, i) => {
    const target = targets[i];
    if (!layer || !target) return null;
    if (target.spiralEnabled === true || target.chaosStar === true || target.closedLoop === false)
      return null;
    if (layer.chaosStar === true || layer.spiralEnabled === true) return null;
    const end = endpoints?.[i]?.to;
    if (!(end?.enabled === true && (Number(end.alpha) || 0) > 1e-6)) return null;
    const from = committedTopology(layer, target, morph);
    const sourceLayer = { ...layer, ...from };
    const srcCopies = Math.max(
      1,
      Math.round(Number(target.morphOrbitCopies) || hooks.orbits(target, sourceLayer)),
    );
    const next = hooks.topology(sourceLayer, i);
    const copies = Math.max(
      1,
      Math.round(hooks.copies({ ...target, N: from.N, K: from.K }, next, srcCopies)),
    );
    return {
      fromN: from.N,
      fromK: from.K,
      N: next.N,
      K: next.K,
      customSuborbits: next.customSuborbits,
      copies,
      srcCopies,
    };
  });
  if (!items.some(Boolean)) return null;
  return { ids: layers.map((l) => l?.id ?? null), signature: planSignature(morph), items };
}

// План годится, только если слои и настройки те же, а слой действительно дошёл до
// той топологии, из которой план строился.
export function acceptPlan(plan, layers, morph) {
  if (!plan || !Array.isArray(plan.items) || !Array.isArray(layers)) return null;
  if (plan.ids.length !== layers.length || plan.signature !== planSignature(morph)) return null;
  const items = plan.items.map((item, i) => {
    const layer = layers[i];
    if (!item || (layer?.id ?? null) !== plan.ids[i]) return null;
    if (Math.round(Number(layer.N)) !== item.fromN || Math.round(Number(layer.K)) !== item.fromK) return null;
    return item;
  });
  return items.some(Boolean) ? { ...plan, items } : null;
}
