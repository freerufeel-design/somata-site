'use strict';
/** Somata 10.4.19 — tests the extracted release, not a development folder.
 * Run: node tests/run-all.js                (quick acceptance)
 *      node tests/run-extended.js           (all regressions, no benchmarks)
 *      node tests/run-v9.js --full --bench  (plus opt-in benchmarks)
 */
const fs=require('node:fs');
const path=require('node:path');
const cp=require('node:child_process');
const testsRoot=__dirname;
const full=process.argv.includes('--full');
const bench=process.argv.includes('--bench');
const quick=[
 'static-modules.js','browser-preflight.js','v910-ui-layout-regression.js',
 'v900-tempo-lock-regression.js','v900-auto-tap-browser-regression.js',
 'v902-curated-playlist-browser-regression.js',
 'v921-new-layer-first-route-compact-animation.js',
 'v922-dice-orange-first-audio-routes.js',
 'v901-corridor-lightning-regression.js',
 'v906-lightning-trigger-routing-regression.js',
 'v907-lightning-gpu-encode-regression.js',
 'v908-gpu-stall-backpressure-regression.js',
 'v908-device-loss-circuit-regression.js',
 'v903-static-edit-animation-regression.js',
 'v903-static-animation-render-impact.js',
 'v904-settings-fill-diagnostics-regression.js',
 'v904-static-animation-blue-types-regression.js',
 'v904-strict-spiral-static-edit-regression.js',
 'v9011-spiral-static-edit-and-layout-regression.js',
 'v9011-spiral-edit-cpu-blue-transports-regression.js',
 'v905-spiral-static-control-corridor-idle.js',
 'v905-fill-gpu-warmup-lifecycle.js',
 'v9010-spiral-closure-cubic-ranges-regression.js',
 'v913-spiral-static-edit-fill-authority-regression.js',
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
 'v7117-memory-retention-regression.js',
 'v102-corridor-spiral-order-monoradius.js',
 'v104-spiral-zero-ui-regression.js',
 'v1041-spiral-morph-lightning-corridor-contract.js',
 'v1042-morph-routing-rationalization-regression.js',
 'v1043-metadata-cache-regression.js',
 'v1044-metadata-views-and-routing-regression.js',
 'v1045-blue-morph-frame-rules-regression.js',
 'v1046-shared-morph-frame-plans-regression.js',
 'v1047-blue-morph-spiral-parity-regression.js',
 'v1048-morph-preparation-parity-regression.js',
 'v1049-lazy-morph-endpoints-and-budget-regression.js',
 'v10410-gpu-packing-and-budget-rationalization-regression.js',
 'v10411-fill-storage-and-spiral-sampling-regression.js',
 'v10412-fill-fan-and-audio-routing-regression.js',
 'v10413-spiral-fill-fastpath-parity-regression.js',
 'v10414-mirror-hotpath-parity-regression.js',
 'v10415-web-corridor-link-parity-regression.js',
 'v10416-graffiti-sweep-sampling-parity-regression.js',
 'v10417-particle-corridor-uniform-parity-regression.js',
 'v10418-geometry-circles-hotpath-parity-regression.js',
 'v10419-frame-contour-assembly-parity-regression.js',
 // User-facing Spiral layout and endpoint motion must be in the release gate.
 'v10420-spiral-compact-tangency-regression.js',
 'v10421-spiral-endpoint-cubic-parity-regression.js',
 'v10422-tangential-no-final-fillet-regression.js',
 'v10423-orange-spiral-route-output-regression.js',
 'v10424-tangential-terminal-cubic-easing-regression.js',
 'v10425-blue-animated-spline-boundary-rail-regression.js',
 'v10426-static-gpu-spiral-baked-cubics-regression.js',
 'v10427-nontorn-spline-phase-owned-bezier-regression.js',
 'v10428-nontorn-spline-corridor-seam-regression.js',
 'v10429-terminal-spline-profile-transition-regression.js',
 'v10430-polygon-animated-spline-boundary-regression.js',
 'v10431-profile-transition-shared-clock-regression.js',
 'v10432-visible-polygon-spline-curve-endpoint-regression.js',
 'v10433-mixed-spline-midpoint-render-regression.js',
 'v10434-profile-curvature-ui-timeline-regression.js',
 'v10435-animated-profile-handoff-regression.js',
 'v10436-mixed-visible-profile-endpoint-regression.js',
 'v10437-rounded-segment-profile-fillet-timeline-regression.js',
 'v10438-spiral-optional-corner-interpolation-regression.js',
 'v10439-spiral-full-bezier-morph-mode-regression.js',
 'v10440-spiral-continuous-closed-endpoint-diagnostic.js',
 // The deleted optional join-interpolation behaviour is no longer tested.
 'v10444-closed-spiral-open-rail-plus-bridge-regression.js',
 'v10445-spiral-bridge-ui-fill-regression.js',
 'v10446-closed-spiral-round-seams-regression.js',
 'v10447-spline-seam-live-morph-parity-regression.js',
 'v10448-whole-curve-spline-unified-regression.js',
 'v9221-tangential-spiral-transition.js',
 'v103-tangential-zero-order-linear.js',
 'v101-spiral-wrap-layout.js',
 'runtime-user-actions.js',
 'effect-render-impact.js',
 'effects-stability.js'
];
const helpers=new Set(['run-v9.js','run-all.js','run-extended.js','browser-harness-cleanup.js','v8205-browser-probe.js']);
const cases=full?fs.readdirSync(testsRoot).filter(f=>f.endsWith('.js')&&!helpers.has(f)&&f!=='stability-soak.js'&&(bench||!f.includes('benchmark'))).sort():quick;
// Full suite intentionally includes runtime-user-actions.js. It is a real regression
// signal, NOT a historical test that should be masked as an expected PASS.
let passed=0,failed=0,timedOut=0;
const timeoutMs=Math.max(2000,Number(process.env.SOMATA_TEST_TIMEOUT_MS)||35000);
console.log(`Somata 10.4.19 tests: ${full?'FULL':'QUICK'} (${cases.length} cases; ${timeoutMs} ms/case)`);
// Capture child output in memory rather than regenerating .log files.
// Run asynchronously: a browser subprocess can outlive the Node test process
// and retain an inherited pipe, which makes spawnSync hang after a timeout.
async function runCase(name){
 return new Promise(resolve=>{
  const child=cp.spawn(process.execPath,[path.join(testsRoot,name)],{
   cwd:path.join(testsRoot,'..'),env:process.env,
   detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']
  });
  let stdout='',stderr='',timedOut=false,completed=false;
  let killFallback=null,exitFallback=null;
  const cap=s=>s.slice(-12000);
  child.stdout?.on('data',buf=>{stdout=cap(stdout+String(buf));});
  child.stderr?.on('data',buf=>{stderr=cap(stderr+String(buf));});
  const killGroup=()=>{
   try{if(process.platform!=='win32')process.kill(-child.pid,'SIGKILL');}
   catch(_){try{child.kill('SIGKILL');}catch(__){}}
   if(process.platform==='win32')try{child.kill('SIGKILL');}catch(_){}
  };
  const done=(code,signal,error)=>{
   if(completed)return;
   completed=true;
   clearTimeout(timer);clearTimeout(killFallback);clearTimeout(exitFallback);
   resolve({code,signal,error,timedOut,stdout,stderr});
  };
  const discardLingeringPipes=()=>{
   try{child.stdout?.destroy();child.stderr?.destroy();}catch(_){}
  };
  // A killed Chromium descendant may keep a pipe open after Node exits.
  // Always settle the test result after the deadline: no runner deadlock.
  const terminate=()=>{
   if(completed)return;
   timedOut=true;
   killGroup();
   killFallback=setTimeout(()=>{
    discardLingeringPipes();
    done(null,'SIGKILL',new Error('test exceeded deadline'));
   },1500);
  };
  const timer=setTimeout(terminate,timeoutMs);
  child.on('exit',(code,signal)=>{
   if(completed)return;
   exitFallback=setTimeout(()=>{
    timedOut=true;
    killGroup();
    discardLingeringPipes();
    done(code,signal,new Error('subprocess kept test output open'));
   },3000);
  });
  child.on('close',(code,signal)=>done(code,signal,null));
  child.on('error',err=>done(null,null,err));
 });
}
(async()=>{
 for(let i=0;i<cases.length;i++){
  const name=cases[i];console.log(`[${i+1}/${cases.length}] ${name}`);
  const r=await runCase(name);
  if(r.code===0&&!r.error&&!r.timedOut){passed++;console.log('PASS');continue;}
  if(r.timedOut){timedOut++;console.error('TIMEOUT',name);}
  else{failed++;console.error('FAIL',name,'exit',r.code,r.error?.message||'');}
  if(r.stdout)console.error(r.stdout.slice(-1000));
  if(r.stderr)console.error(r.stderr.slice(-1400));
 }
 console.log(`SUMMARY: PASS=${passed} FAIL=${failed} TIMEOUT=${timedOut} TOTAL=${cases.length}`);
 if(failed||timedOut)process.exitCode=1;
})().catch(err=>{console.error('TEST RUNNER FAILED',err);process.exitCode=1;});
