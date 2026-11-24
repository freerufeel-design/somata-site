import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const run = name => JSON.parse(execFileSync(process.execPath,[fileURLToPath(new URL(`./helpers/${name}`,import.meta.url))],{encoding:'utf8',maxBuffer:8*1024*1024}));
test('Non-Simple render commands remain identical to the confirmed 16.4.2 base',()=>{
 const rows=run('rounding-render-probe.mjs');
 assert.equal(rows.length,144);
 for(const row of rows) assert.equal(row.error,undefined,JSON.stringify(row));
 const reference=JSON.parse(fs.readFileSync(new URL('./rounding-non-simple-16.4.2.json',import.meta.url),'utf8'));
 assert.deepEqual(rows.filter(r=>r.method!=='simple').map(({seen,...r})=>r),reference);
 const find=(method)=>rows.find(r=>r.method===method&&r.profile==='mixed'&&r.mode==='circleSlide'&&r.order===0);
 for(const method of ['classic','local','fourier']) assert.notDeepEqual(find('simple').digest,find(method).digest);
});
test('Simple phase endpoints agree and near-boundary samples remain close',()=>{
 const rows=run('simple-phase-probe.mjs');
 assert.equal(rows.length,32);
 for(const row of rows){
  assert.equal(row.error,undefined,JSON.stringify(row));
  assert.equal(row.val.length,4);
  assert.ok(row.val[0]<1e-8,JSON.stringify(row));
  assert.ok(row.val.slice(1).every(x=>Number.isFinite(x)&&x<0.05),JSON.stringify(row));
 }
});
