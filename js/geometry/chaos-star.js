// Звезда хаоса: детерминированный ГПСЧ, индексы и кольцо вершин.
import './spiral/carrier.js'; // initialisation order: this module runs after it

function makeChaosStarPrng(seed) {
  let x = Number(seed) >>> 0 || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 4294967296;
  };
}
function buildChaosVertexIndices(layer, N, K) {
  N = Math.max(2, Math.round(Number(N) || 4));
  K = Math.max(1, Math.round(Number(K) || 1));
  const minus = Math.max(0, Math.min(120, Math.round(Number(layer?.chaosStepMinus) || 0)));
  const plus = Math.max(0, Math.min(120, Math.round(Number(layer?.chaosStepPlus) || 0)));
  const targetClosures = Math.max(1, Math.min(N, Math.round(Number(layer?.chaosClosures) || 1)));
  const seed = ((Number(layer?.chaosSeed) >>> 0) ^ Math.imul(N, 0x9e3779b1) ^ Math.imul(K, 0x85ebca6b)) >>> 0;
  const rand = makeChaosStarPrng(seed);
  const indices = [0];
  let current = 0;
  const guardPerClosure = Math.max(N * 32, 256);
  for (let closure = 0; closure < targetClosures; closure++) {
    let closedNaturally = false;
    for (let guard = 0; guard < guardPerClosure; guard++) {
      const delta = -minus + Math.floor(rand() * (minus + plus + 1));
      let step = K + delta;
      if (step % N === 0) {
        const sign = rand() < 0.5 ? -1 : 1;
        step += sign;
      }
      let next = (((current + step) % N) + N) % N;
      if (next === current) next = (current + 1) % N;
      if (next === 0) {
        closedNaturally = true;
        current = 0;
        break;
      }
      indices.push(next);
      current = next;
    }
    if (closure < targetClosures - 1) {
      indices.push(0);
      current = 0;
    } else if (!closedNaturally) {
      current = 0;
    }
  }
  return indices.length > 1 ? indices : [0, Math.max(1, K % N)];
}
function buildChaosVertexRing(layer, N, K, R, rotRad) {
  const stepAngle = (Math.PI * 2) / N;
  return buildChaosVertexIndices(layer, N, K).map((idx) => {
    const angle = idx * stepAngle + rotRad - Math.PI / 2;
    return { x: R * Math.cos(angle), y: R * Math.sin(angle), chaosIndex: idx };
  });
}

export { buildChaosVertexIndices, buildChaosVertexRing };
