const cp=require('child_process');
const path=require('path');

const root=__dirname;
const cycles=Math.max(1,Number(process.env.SOMATA_SOAK_CYCLES)||2);
const suites=[
  ['browser-harness-cleanup.js','BROWSER HARNESS CLEANUP REGRESSION: PASS'],
  ['v75-web-bezier-contour.js','PASS Web uses the real rendered Bézier contour'],
  ['v75-web-branch-rendering.js','WEB BRANCH + SPIRAL/MORPH REGRESSION: PASS'],
  ['v75-spiral-web-adversarial.js','SPIRAL + WEB ADVERSARIAL REGRESSION: PASS'],
  ['v75-mobile-runtime-regression.js','MOBILE RUNTIME REGRESSION: PASS'],
  ['v75-mobile-landscape-regression.js','MOBILE LANDSCAPE + ROTATION REGRESSION: PASS'],
  ['v75-mobile-landscape-fps-copy-regression.js','MOBILE LANDSCAPE FPS COPY REGRESSION: PASS'],
  ['v75-mobile-landscape-toast-visibility-regression.js','MOBILE LANDSCAPE TOAST VISIBILITY REGRESSION: PASS'],
  ['v75-mobile-narrow-hit-regression.js','MOBILE NARROW HIT-TARGET REGRESSION: PASS'],
  ['v75-mobile-view-reset-regression.js','MOBILE VIEW RESET REGRESSION: PASS'],
  ['v75-mobile-landscape-desktop-brand-regression.js','MOBILE LANDSCAPE DESKTOP BRAND REGRESSION: PASS'],
  ['v75-mobile-header-touch-regression.js','MOBILE HEADER TOUCH + SPIRAL ACTION REGRESSION: PASS'],
  ['v75-mobile-parameter-focus-spiral-regression.js','MOBILE PARAMETER FOCUS + SPIRAL REGRESSION: PASS'],
  ['v75-mobile-audio-panels-spiral-regression.js','MOBILE AUDIO PANELS + SPIRAL REGRESSION: PASS'],
  ['v75-mobile-spiral-controls-touch-regression.js','MOBILE SPIRAL CONTROLS TOUCH REGRESSION: PASS'],
  ['v75-mobile-project-morph-panel-spiral-regression.js','MOBILE PROJECT MORPH PANEL + SPIRAL REGRESSION: PASS'],
  ['v75-rounding-immediate-morph-regression.js','ROUNDING IMMEDIATE MORPH REGRESSION: PASS'],
  ['v75-rounding-morph-stall-jump-regression.js','ROUNDING MORPH STALL JUMP REGRESSION: PASS'],
  ['v75-morph-mode-gpu-prewarm-recovery.js','MORPH MODE START + GPU PREWARM RECOVERY: PASS'],
  ['v75-topology-monoradius-regression.js','TOPOLOGY + MONORADIUS REGRESSION: PASS'],
  ['v7611-master-physical-ui-regression.js','MASTER PHYSICAL UI REGRESSION: PASS'],
  ['v767-master-write-broadcast-regression.js','MASTER WRITE-BROADCAST REGRESSION: PASS'],
  ['v7610-master-exact-field-broadcast-regression.js','MASTER EXACT-FIELD BROADCAST REGRESSION: PASS'],
  ['v7611-morph-fill-without-corridor-regression.js','MORPH FILL WITHOUT CORRIDOR REGRESSION: PASS'],
  ['v7610-glow-fill-coexistence-regression.js','GLOW + FILL COEXISTENCE REGRESSION: PASS'],
  ['v76-profile-carrier-architecture.js','SOMATA 7.6 PROFILE/CARRIER ARCHITECTURE: PASS'],
  ['v76-gpu-warmup-nonblocking.js','SOMATA 7.6 NONBLOCKING GPU WARMUP: PASS'],
  ['v75-spiral-mobile-orientation-stress.js','SPIRAL + MOBILE ORIENTATION COMBINED STRESS: PASS'],
  ['v75-spiral-narrow-mobile-stress.js','SPIRAL + NARROW MOBILE ORIENTATION STRESS: PASS'],
  ['v75-spiral-effect-fault-recovery.js','SPIRAL + EFFECT FAULT RECOVERY: PASS'],
  ['v75-spiral-mobile-fullscreen-stress.js','SPIRAL + MOBILE FULLSCREEN STRESS: PASS'],
  ['v75-spiral-mobile-dpr-budget-stress.js','SPIRAL + MOBILE DPR BUDGET STRESS: PASS'],
  ['v75-lightning-performance.js','PASS Lightning impact path'],
  ['v75-checkbox-functional-coverage.js','PASS checkbox functional coverage'],
  ['desktop-logo.js','DESKTOP LOGO + DETACHABLE OUTPUT: PASS'],
  ['spiral-morph-continuity.js','SPIRAL MORPH CONTINUITY: PASS'],
  ['spiral-stability-torture.js','SPIRAL STABILITY TORTURE: PASS'],
  ['spiral-profile-fill-continuity.js','SPIRAL PROFILE/FILL CONTINUITY: PASS'],
  ['runtime-user-actions.js','RUNTIME USER ACTIONS: 12/12 PASS'],
  ['gpu-effect-scene-routing.js','GPU EFFECT SCENE ROUTING: 6/6 PASS'],
  ['lightning-impact-regression.js','LIGHTNING IMPACT REGRESSION: PASS'],
  ['effects-stability.js','EFFECT STABILITY: 16/16 PASS'],
  ['effect-render-impact.js','RENDER IMPACT: PASS']
];

for(let cycle=1;cycle<=cycles;cycle++){
  for(const [file,marker] of suites){
    const startedAt=Date.now();
    console.log(`[soak ${cycle}/${cycles}] START ${file}`);
    const r=cp.spawnSync(process.execPath,[path.join(root,file)],{
      encoding:'utf8',
      timeout:90000,
      env:{...process.env,SOMATA_SOAK_CHILD:'1'}
    });
    if(r.error){
      console.error(r.stdout||'');
      console.error(r.stderr||'');
      throw r.error;
    }
    if(r.status!==0||!String(r.stdout||'').includes(marker)){
      console.error(r.stdout||'');
      console.error(r.stderr||'');
      throw new Error(`soak cycle ${cycle}: ${file} failed or missing PASS marker`);
    }
    console.log(`[soak ${cycle}/${cycles}] PASS ${file} (${Date.now()-startedAt} ms)`);
  }
  console.log(`PASS soak cycle ${cycle}/${cycles} — fresh-browser user actions + GPU scene routing + effect stability + render impact`);
}
console.log(`\nSTABILITY SOAK: ${cycles}/${cycles} PASS`);
