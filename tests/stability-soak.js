const cp=require('child_process');
const path=require('path');

const root=__dirname;
const cycles=Math.max(1,Number(process.env.SOMATA_SOAK_CYCLES)||2);
const suites=[
  ['v75-web-bezier-contour.js','PASS Web uses the real rendered Bézier contour'],
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
  }
  console.log(`PASS soak cycle ${cycle}/${cycles} — fresh-browser user actions + GPU scene routing + effect stability + render impact`);
}
console.log(`\nSTABILITY SOAK: ${cycles}/${cycles} PASS`);
