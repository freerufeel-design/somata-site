import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('Direct Simple anchor route uses the current skeleton and reaches its authored static endpoints', () => {
  const rows = JSON.parse(execFileSync(process.execPath, [fileURLToPath(new URL('./helpers/simple-direct-phase-probe.mjs', import.meta.url))], {encoding:'utf8', maxBuffer: 8*1024*1024}));
  assert.equal(rows.length,64);
  for (const row of rows) {
    assert.equal(row.error,undefined,JSON.stringify(row));
    assert.equal(row.direct,true,JSON.stringify(row));
    assert.ok(row.val[0]<1e-8 && row.val[4]<1e-8,JSON.stringify(row));
    assert.ok(row.val.every(x=>Number.isFinite(x)&&x<0.05),JSON.stringify(row));
  }
});
