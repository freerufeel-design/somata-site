import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Simple vertex birth and death: near-boundary contours agree with authored endpoints', () => {
  const rows=JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL('./helpers/simple-collapse-phase-probe.mjs',import.meta.url))],{encoding:'utf8',maxBuffer:8*1024*1024}));
  assert.equal(rows.length,32);
  for(const row of rows) {
    assert.equal(row.error,undefined,JSON.stringify(row));
    assert.equal(row.direct,true,JSON.stringify(row));
    assert.ok(row.val[0]<1e-8 && row.val[4]<1e-8,JSON.stringify(row));
    assert.ok(row.val.every(v=>Number.isFinite(v)&&v<0.05),JSON.stringify(row));
    assert.ok(row.distance.every(v=>Number.isFinite(v)&&v<0.05),JSON.stringify(row));
    assert.ok(row.sweep.every(v=>Number.isFinite(v)&&v<0.1),JSON.stringify(row));
  }
});
