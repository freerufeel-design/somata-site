import test from 'node:test';
import assert from 'node:assert/strict';
import { densityFromPercent, densityPercent, normalizeTunnelDensity, tunnelDensityAlpha } from '../js/corridor/corridor-density.js';

test('old projects and invalid values use the classic density', () => {
  for (const value of [undefined, null, '', NaN, Infinity, -1]) {
    assert.equal(normalizeTunnelDensity(value), 100);
  }
  assert.equal(normalizeTunnelDensity(250), 200);
  assert.equal(normalizeTunnelDensity('150'), 150);
});

test('default matches v6.7 and maximum restores v15.16 depth opacity', () => {
  for (const count of [2, 6, 16, 160]) {
    for (const position of [-2, 0, 0.5, 1, 4.25, count - 1, count + 2]) {
      const progress = Math.max(0, Math.min(1, position / (count - 1)));
      const classic = 0.08 + 0.92 * Math.pow(progress, 0.72);
      assert.equal(tunnelDensityAlpha(position, count, normalizeTunnelDensity(0)), 0);
      const at = percent => tunnelDensityAlpha(position, count, densityFromPercent(percent));
      assert.equal(densityPercent(100), 75);
      assert.equal(at(75), classic);
      assert.equal(at(100), 1);
      assert.equal(at(12.5), at(25) / 2);
      assert.ok(at(25) <= at(50) && at(50) <= at(75));
      if (progress === 1) assert.equal(at(25), 1);
      assert.equal(tunnelDensityAlpha(position, count), classic);
      assert.equal(tunnelDensityAlpha(position, count, 200), 1);
      assert.equal(tunnelDensityAlpha(position, count, 150), classic + (1 - classic) * 0.5);
    }
  }
});
