import assert from 'node:assert/strict';
import test from 'node:test';
import { importModule } from './helpers/app-env.mjs';

const rail = (...coords) => ({ points: coords.map(([x, y]) => ({ x, y })), closed: false });

test('a snapped key uses the closest point within its own patch at a crossing', async () => {
  const { projectMorphKeyLamps } = await importModule('js/lamps/lamp-points.js');
  const own = rail([-4, 1], [4, 1], [0, -4], [0, 4]);
  const crossing = rail([-4, 0], [4, 0]);
  const anchor = { x: 0, y: 0, pathIndex: 0, lampAttachFraction: 0.17, lampAttachSegmentWindow: 0.12 };
  const [point] = projectMorphKeyLamps([anchor], [own, crossing], [own, crossing], { id: 'crossing' });
  assert.equal(point.pathIndex, 0);
  assert.ok(Math.abs(point.x) < 1e-9);
  assert.equal(point.y, 1);
});

test('an open-profile key keeps its incident edge when the other edge appears', async () => {
  const { bindOpenCircleLampEdges } = await importModule('js/lamps/lamp-points.js');
  const incoming = { ...rail([-5, 0], [0, 0]), lampCircleOrbitIndex: 0, lampCircleEdgeIndex: 2 };
  const outgoing = { ...rail([0, 0], [5, 0]), lampCircleOrbitIndex: 0, lampCircleEdgeIndex: 0 };
  const anchor = { pathIndex: 0, vertexIndex: 0, lampCircleSlotCount: 3, lampId: 'joint' };
  const layer = { id: 'open-key' };
  const [before] = bindOpenCircleLampEdges([anchor], [incoming], layer);
  const [after] = bindOpenCircleLampEdges([anchor], [outgoing, incoming], layer);
  assert.equal(before.lampOpenCircleEndpoint, 1);
  assert.equal(after.lampOpenCircleEndpoint, 1);
  assert.equal(after.pathIndex, 1);
});

test('the search interval wraps across the seam of a closed contour', async () => {
  const { nearestLampOnPathInterval } = await importModule('js/lamps/lamp-attachment.js');
  const square = { ...rail([0, 0], [10, 0], [10, 10], [0, 10]), closed: true };
  const { point } = nearestLampOnPathInterval({ x: -1, y: 2 }, square, -0.1, 0.1, 0);
  assert.ok(Math.abs(point.x) < 1e-9);
  assert.ok(Math.abs(point.y - 2) < 1e-9);
});

test('coincident circle slots converge on the physical support of the compact end rail', async () => {
  const { projectMorphKeyLamps } = await importModule('js/lamps/lamp-points.js');
  const square = { ...rail([0, 0], [10, 0], [10, 10], [0, 10]), closed: true };
  const target = { x: 10, y: 10 };
  const slots = [0, 1].map(vertexIndex => ({
    ...target, vertexIndex, pathIndex: 0, lampCircleSlotCount: 5,
    lampAttachProgress: 1, lampAttachSourcePoint: square.points[0], lampAttachTargetPoint: target,
  }));
  for (const lamp of projectMorphKeyLamps(slots, [square], [square], { id: 'compact' })) {
    assert.ok(Math.hypot(lamp.x - target.x, lamp.y - target.y) < 1e-8);
  }
});

test('first moving frame may rotate the contour seam under a stationary lamp', async () => {
  const { projectMorphKeyLamps } = await importModule('js/lamps/lamp-points.js');
  const square = { ...rail([0, 0], [10, 0], [10, 10], [0, 10]), closed: true };
  const shifted = { points: [...square.points.slice(2), ...square.points.slice(0, 2)], closed: true };
  const key = { x: 10, y: 0, vertexIndex: 1, pathIndex: 0, lampCircleSlotCount: 4,
    lampId: 'joint', lampAttachSourcePoint: square.points[1], lampAttachTargetPoint: square.points[1] };
  for (const [shape, t] of [[square, 0], [shifted, 0.01]]) {
    const [p] = projectMorphKeyLamps([{ ...key, lampAttachProgress: t }], [shape], [shape], { id: 'shifted-seam' });
    assert.ok(Math.hypot(p.x - key.x, p.y - key.y) < 1e-8);
  }
});
