const cp=require('child_process');
const path=require('path');
const root=__dirname;
const totalTimeoutMs=Math.max(1000,Number(process.env.SOMATA_RUN_ALL_TIMEOUT_MS)||60000);
const startedAt=Date.now(),deadline=startedAt+totalTimeoutMs;

// Linux CI/browser tests can leave Chromium descendants alive after the Node test exits.
// Put the entire Run All process tree under GNU timeout as the authoritative 60-second wall.
// The inner runner still has its own deadline for clear progress/diagnostics.
if(process.platform!=='win32'&&process.env.SOMATA_RUN_ALL_GUARD!=='1'){
  const seconds=Math.max(1,Math.ceil(totalTimeoutMs/1000));
  const r=cp.spawnSync('timeout',[
    '--signal=TERM','--kill-after=2s',`${seconds}s`,
    process.execPath,__filename
  ],{
    stdio:'inherit',
    env:{...process.env,SOMATA_RUN_ALL_GUARD:'1'}
  });
  if(r.error){console.error('RUN-ALL timeout wrapper error:',r.error);process.exit(1);}
  if(r.status===124||r.status===137||r.signal){
    console.error(`RUN-ALL HARD TIMEOUT: ${seconds}s wall-clock budget reached`);
    process.exit(124);
  }
  process.exit(r.status||0);
}

const coreSuites=[
  'static-modules.js',
  'v779-self-owned-feature-contracts.js',
  'contracts.js',
  'browser-preflight.js',
  'v779-line-effect-timeline-sync-regression.js',
  'v779-dynamic-fill-unified-regression.js',
  'v779-fill-follows-line-carrier-regression.js',
  'v779-frame-contour-authority-regression.js',
  'v780-shared-frame-contour-regression.js',
  'v782-web-line-fill-authority-regression.js',
  'v782-corridor-frame-contour-regression.js',
  'v782-web-fill-order-retry-regression.js',
  'v783-web-default-corners-regression.js',
  'v783-static-web-render-pass-regression.js',
  'v783-effect-order-static-morph-regression.js',
  'v783-web-toggle-stability-regression.js',
  'v781-web-buffer-lifetime-regression.js',
  'v779-palette-fill-web-color-regression.js',
  'v779-static-web-under-base-regression.js',
  'v779-lightning-static-dynamic-unified-regression.js',
  'v779-fps-load-analyzer-regression.js',
  'v779-fps-console-browser-regression.js',
  'v7611-master-physical-ui-regression.js',
  'v770-web-lightning-reference-authority-regression.js',
  'gpu-effect-scene-routing.js',
  'effect-render-impact.js'
];
const extendedSuites=[
  'static-modules.js',
  'v777-isolation-kernel.js',
  'v779-self-owned-feature-contracts.js',
  'v778-noodle-firewall.js',
  'v776-dependency-dag.js',
  'v775-render-firewalls.js',
  'v774-feature-plugin-architecture.js',
  'v773-module-firewalls.js',
  'v772-modular-architecture.js',
  'v771-module-boundaries.js',
  'contracts.js',
  'browser-preflight.js',
  'v779-line-effect-timeline-sync-regression.js',
  'v779-dynamic-fill-unified-regression.js',
  'v779-fill-follows-line-carrier-regression.js',
  'v779-frame-contour-authority-regression.js',
  'v780-shared-frame-contour-regression.js',
  'v782-web-line-fill-authority-regression.js',
  'v782-corridor-frame-contour-regression.js',
  'v782-web-fill-order-retry-regression.js',
  'v783-web-default-corners-regression.js',
  'v783-static-web-render-pass-regression.js',
  'v783-effect-order-static-morph-regression.js',
  'v783-web-toggle-stability-regression.js',
  'v781-web-buffer-lifetime-regression.js',
  'v779-palette-fill-web-color-regression.js',
  'v779-static-web-under-base-regression.js',
  'v779-lightning-static-dynamic-unified-regression.js',
  'v779-fps-load-analyzer-regression.js',
  'v779-fps-console-browser-regression.js',
  'v7611-master-physical-ui-regression.js',
  'v7610-master-exact-field-broadcast-regression.js',
  'v767-master-write-broadcast-regression.js',
  'v7611-morph-fill-without-corridor-regression.js',
  'v7610-glow-fill-coexistence-regression.js',
  'v768-lightning-device-generation-regression.js',
  'v770-web-lightning-reference-authority-regression.js',
  'v770-console-diagnostics-regression.js',
  'v75-legacy-dead-code-regression.js',
  'browser-harness-cleanup.js',
  'v75-effect-stack-order.js',
  'v75-web-bezier-contour.js',
  'v75-web-branch-rendering.js',
  'v75-spiral-web-adversarial.js',
  'v75-lightning-performance.js',
  'v75-mobile-runtime-regression.js',
  'v75-mobile-landscape-regression.js',
  'v75-mobile-landscape-fps-copy-regression.js',
  'v75-mobile-landscape-toast-visibility-regression.js',
  'v75-mobile-narrow-hit-regression.js',
  'v75-mobile-view-reset-regression.js',
  'v75-mobile-landscape-desktop-brand-regression.js',
  'v75-mobile-header-touch-regression.js',
  'v75-mobile-parameter-focus-spiral-regression.js',
  'v75-mobile-audio-panels-spiral-regression.js',
  'v75-mobile-spiral-controls-touch-regression.js',
  'v75-mobile-project-morph-panel-spiral-regression.js',
  'v75-rounding-immediate-morph-regression.js',
  'v75-rounding-morph-stall-jump-regression.js',
  'v75-morph-mode-gpu-prewarm-recovery.js',
  'v75-topology-monoradius-regression.js',
  'v76-profile-carrier-architecture.js',
  'v76-gpu-warmup-nonblocking.js',
  'v761-static-morph-stop-continuity.js',
  'v761-topology-calm-stall-continuity.js',
  'v762-static-dynamic-geometry-invariant.js',
  'v763-spiral-carrier-profile-invariant.js',
  'v764-spiral-static-round-fade-regression.js',
  'v765-spiral-glow-copy-fade-regression.js',
  'v766-spiral-keypoint-transport-regression.js',
  'v7612-spiral-performance-path-regression.js',
  'v767-spiral-constant-step-corridor-regression.js',
  'v75-spiral-mobile-orientation-stress.js',
  'v75-spiral-effect-fault-recovery.js',
  'v75-spiral-mobile-fullscreen-stress.js',
  'v75-spiral-mobile-dpr-budget-stress.js',
  'v75-spiral-narrow-mobile-stress.js',
  'desktop-logo.js',
  'spiral-morph-continuity.js',
  'spiral-stability-torture.js',
  'spiral-profile-fill-continuity.js',
  'profile-morph-ui-regression.js',
  'orange-family-pools.js',
  'orange-random-colors.js',
  'runtime-user-actions.js',
  'gpu-effect-scene-routing.js',
  'graffiti-glow-lamp-blend-regression.js',
  'graffiti-lightning-aftershock-regression.js',
  'lightning-impact-regression.js',
  'lamp-freeze-static-regression.js',
  'effects-stability.js',
  'main-control-coverage.js',
  'v75-checkbox-functional-coverage.js',
  'effect-render-impact.js',
  'stability-soak.js'
];;
const suites=process.env.SOMATA_EXTENDED==='1'?extendedSuites:coreSuites;
let activeChild=null;
let passedCount=0;

function killTree(child){
  if(!child)return;
  try{
    if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,'SIGKILL');
    else child.kill('SIGKILL');
  }catch(_){try{child.kill('SIGKILL');}catch(__){}}
}

function runSuite(file,timeoutMs){
  return new Promise((resolve)=>{
    const child=cp.spawn(process.execPath,[path.join(root,file)],{
      stdio:['ignore','pipe','pipe'],
      detached:process.platform!=='win32',
      env:{...process.env,SOMATA_RUN_ALL_CHILD:'1'}
    });
    activeChild=child;
    child.stdout?.on('data',chunk=>process.stdout.write(chunk));
    child.stderr?.on('data',chunk=>process.stderr.write(chunk));
    let settled=false;
    const finish=(code,signal,err=null,timedOut=false)=>{
      if(settled)return;settled=true;clearTimeout(timer);if(activeChild===child)activeChild=null;
      resolve({code,signal,err,timedOut});
    };
    const timer=setTimeout(()=>{
      killTree(child);
      // Do not wait for Chromium descendants to close inherited descriptors.
      // The Run All contract is a hard wall-clock budget.
      finish(null,'SIGKILL',null,true);
    },Math.max(1,timeoutMs));
    child.once('error',err=>finish(null,null,err,false));
    child.once('close',(code,signal)=>finish(code,signal,null,false));
  });
}

const hardWatchdog=setTimeout(()=>{
  console.error(`\nRUN-ALL HARD TIMEOUT after ${Date.now()-startedAt} ms — ${passedCount}/${suites.length} suites completed`);
  killTree(activeChild);
  process.exit(124);
},totalTimeoutMs);
hardWatchdog.unref?.();

(async()=>{
  console.log(`RUN-ALL TIME BUDGET: ${totalTimeoutMs} ms (${(totalTimeoutMs/1000).toFixed(0)} s)`);
  let passed=0;
  for(const file of suites){
    const remaining=deadline-Date.now();
    if(remaining<=0){
      console.error(`\nRUN-ALL TIMEOUT after ${Date.now()-startedAt} ms — ${passed}/${suites.length} suites completed`);
      process.exit(124);
    }
    console.log(`\n=== ${file} ===`);
    const r=await runSuite(file,remaining);
    if(r.timedOut||Date.now()>=deadline){
      console.error(`\nRUN-ALL TIMEOUT during ${file} after ${Date.now()-startedAt} ms — ${passed}/${suites.length} suites completed`);
      process.exit(124);
    }
    if(r.err){console.error(`RUN-ALL child error in ${file}:`,r.err);process.exit(1);}
    if(r.code!==0)process.exit(r.code||1);
    passed++;passedCount=passed;
  }
  clearTimeout(hardWatchdog);console.log(`\nALL PREFLIGHT TESTS PASS — ${passed}/${suites.length} in ${Date.now()-startedAt} ms`);
})().catch(err=>{console.error(err?.stack||err);process.exit(1);});
