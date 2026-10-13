const cp=require('child_process');
const path=require('path');
const root=__dirname;
for(const file of ['static-modules.js','contracts.js','browser-preflight.js','v75-effect-stack-order.js','v75-web-bezier-contour.js','v75-lightning-performance.js','desktop-logo.js','spiral-morph-continuity.js','spiral-stability-torture.js','spiral-profile-fill-continuity.js','profile-morph-ui-regression.js','orange-family-pools.js','orange-random-colors.js','runtime-user-actions.js','gpu-effect-scene-routing.js','graffiti-glow-lamp-blend-regression.js','graffiti-lightning-aftershock-regression.js','lightning-impact-regression.js','lamp-freeze-static-regression.js','effects-stability.js','main-control-coverage.js','v75-checkbox-functional-coverage.js','effect-render-impact.js','stability-soak.js']){
  console.log(`\n=== ${file} ===`);
  const r=cp.spawnSync(process.execPath,[path.join(root,file)],{stdio:'inherit'});
  if(r.status!==0)process.exit(r.status||1);
}
console.log('\nALL PREFLIGHT TESTS PASS');
