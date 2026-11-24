import test from 'node:test';
import assert from 'node:assert/strict';
import { importModule } from './helpers/app-env.mjs';

const base = {
  N: 4, K: 1, radius: 150, rotation: 0, spiralEnabled: true, spiralClosed: true,
  spiralRoundSeams: true, profileMode: 'segments', rounding: 0, roundingCornerType: 'simple',
  closedLoop: true, spiralOrder: 1, spiralTangential: true, spiralTwist: true,
  profileNodes: [{ x: 0, y: 0 }, { x: 1.12, y: -0.5 }],
};

test('zero rounding: mapped straight profile must not reverse its true end tangent', async () => {
  const { buildOrbitPolylines } = await importModule('js/geometry/orbit-builder.js');
  let checked = 0;
  for (const spiralOrder of [-3, -1, 1, 3]) {
    for (const spiralRoundSeams of [false, true]) {
      const path = buildOrbitPolylines({ ...base, spiralOrder, spiralRoundSeams })[0];
      for (const [i, q] of path._bezierSegments.entries()) {
        const a = path.points[i], b = path.points[i + 1];
        if (!a || !b || b.__spiralAutoCloseBridgeEnd) continue;
        for (const [x, y, tx, ty] of [
          [q.c1.x - q.p0.x, q.c1.y - q.p0.y, a.__spiralBezierOutTx, a.__spiralBezierOutTy],
          [q.p3.x - q.c2.x, q.p3.y - q.c2.y, b.__spiralBezierInTx, b.__spiralBezierInTy],
        ]) {
          const norm = Math.hypot(x, y) * Math.hypot(tx, ty);
          if (!Number.isFinite(norm) || norm < 1e-9) continue;
          checked++;
          assert.ok((x * tx + y * ty) / norm >= -1e-8, `order ${spiralOrder}, span ${i}: reversed tangent`);
        }
      }
      const last = path._bezierSegments.at(-1);
      if (path.points.at(-1).__spiralAutoCloseBridgeEnd) {
        const dx = last.p3.x - last.p0.x, dy = last.p3.y - last.p0.y;
        assert.ok(Math.hypot(last.c1.x - last.p0.x - dx / 3, last.c1.y - last.p0.y - dy / 3) < 1e-7);
        assert.ok(Math.hypot(last.c2.x - last.p0.x - 2 * dx / 3, last.c2.y - last.p0.y - 2 * dy / 3) < 1e-7);
      }
    }
  }
  assert.ok(checked > 0);
});

test('period correction keeps an originally straight terminal cubic straight', async () => {
  const { buildSpiralBezierSegments, isLinearSpiralCubic } = await importModule('js/geometry/spiral/bezier-carrier.js');
  const points = [{ x: 100, y: 0, __spiralClosed: true, __spiralDelta: Math.PI / 2, __spiralTargetScale: 0.8 }, { x: 10, y: 70 }];
  const q = buildSpiralBezierSegments(points, 0).at(-1);
  assert.ok(Math.hypot(q.p3.x, q.p3.y - 80) < 1e-9);
  assert.ok(isLinearSpiralCubic(q));
});

test('morph seam rounding requires positive strength, not just permission', async () => {
  const { WebGPUSpiralBezierMorphRenderer: renderer } = await importModule('js/gpu/spiral-bezier-morph-renderer.js');
  const source = { ...base, spiralTangential: false, spiralTwist: false };
  for (const rounding of [0, 50]) {
    const target = { ...source, N: 5, spiralOrder: 2, rounding };
    const rec = renderer.createCpuEditFallback(0, { sourceLayer: source, targetLayer: target,
      mode: 'circleSlide', spiralType: 'phaseCircle', origin: 'manual' });
    assert.ok(rec?.carrierRecords?.length);
    assert.ok(rec.carrierRecords.some(r => r.explicitBridge));
    assert.ok(rec.carrierRecords.every(r => r.roundedBridge === (rounding > 0)));
  }
});
