'use strict';
/** Somata 9.0.7 — tests the extracted release, not a development folder.
 * Run: node tests/run-all.js                (quick acceptance)
 *      node tests/run-extended.js           (all regressions, no benchmarks)
 *      node tests/run-v9.js --full --bench  (plus opt-in benchmarks)
 */
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const cp=require('node:child_process');
const testsRoot=__dirname;
const full=process.argv.includes('--full');
const bench=process.argv.includes('--bench');
const quick=[
 'static-modules.js','browser-preflight.js',
 'v900-tempo-lock-regression.js','v900-auto-tap-browser-regression.js',
 'v902-curated-playlist-browser-regression.js',
 'v901-corridor-lightning-regression.js',
 'v906-lightning-trigger-routing-regression.js',
 'v907-lightning-gpu-encode-regression.js',
 'v903-static-edit-animation-regression.js',
 'v903-static-animation-render-impact.js',
 'v904-settings-fill-diagnostics-regression.js',
 'v904-static-animation-blue-types-regression.js',
 'v904-strict-spiral-static-edit-regression.js',
 'v905-spiral-static-control-corridor-idle.js',
 'v905-fill-gpu-warmup-lifecycle.js',
 'v7123-tap-wheel-bpm-regression.js',
 'v7122-shared-parameter-matrix-parity-regression.js',
 'v762-static-dynamic-geometry-invariant.js',
 'v763-spiral-carrier-profile-invariant.js',
 'v770-web-lightning-reference-authority-regression.js',
 'v779-lightning-static-dynamic-unified-regression.js',
 'v75-spiral-effect-fault-recovery.js',
 'orange-family-pools.js',
 'v8210-dynamic-optical-live-scene-regression.js',
 'v8214-ambients-compositor-and-effects-regression.js',
 'v7117-memory-retention-regression.js'
];
const helpers=new Set(['run-v9.js','run-all.js','run-extended.js','browser-harness-cleanup.js','v8205-browser-probe.js']);
const cases=full?fs.readdirSync(testsRoot).filter(f=>f.endsWith('.js')&&!helpers.has(f)&&f!=='stability-soak.js'&&(bench||!f.includes('benchmark'))).sort():quick;
// Full suite intentionally includes runtime-user-actions.js. It is a real regression
// signal, NOT a historical test that should be masked as an expected PASS.
let passed=0,failed=0,timedOut=0;
const timeoutMs=Math.max(2000,Number(process.env.SOMATA_TEST_TIMEOUT_MS)||35000);
console.log(`Somata 9.0.7 tests: ${full?'FULL':'QUICK'} (${cases.length} cases; ${timeoutMs} ms/case)`);
for(let i=0;i<cases.length;i++){
 const name=cases[i];console.log(`[${i+1}/${cases.length}] ${name}`);
 const log=path.join(os.tmpdir(),`somata-v9-test-${process.pid}-${i}.log`);
 const fd=fs.openSync(log,'w');
 let r;
 try{r=cp.spawnSync(process.execPath,[path.join(testsRoot,name)],{cwd:path.join(testsRoot,'..'),env:process.env,stdio:['ignore',fd,fd],timeout:timeoutMs,killSignal:'SIGKILL'});}
 finally{fs.closeSync(fd);}
 if(r.status===0&&!r.error){passed++;console.log('PASS');try{fs.unlinkSync(log)}catch{};continue;}
 if(r.error?.code==='ETIMEDOUT'){timedOut++;console.error('TIMEOUT',name);}
 else{failed++;console.error('FAIL',name,'exit',r.status);}
 const msg=fs.readFileSync(log,'utf8');console.error(msg.slice(-1400));
 try{fs.unlinkSync(log)}catch{}

}
console.log(`SUMMARY: PASS=${passed} FAIL=${failed} TIMEOUT=${timedOut} TOTAL=${cases.length}`);
if(failed||timedOut)process.exitCode=1;
