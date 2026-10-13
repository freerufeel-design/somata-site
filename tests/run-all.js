const cp=require('child_process');
const path=require('path');
const root=__dirname;
for(const file of ['static-modules.js','contracts.js','browser-preflight.js','runtime-user-actions.js','gpu-effect-scene-routing.js','effects-stability.js','main-control-coverage.js','effect-render-impact.js','stability-soak.js']){
  console.log(`\n=== ${file} ===`);
  const r=cp.spawnSync(process.execPath,[path.join(root,file)],{stdio:'inherit'});
  if(r.status!==0)process.exit(r.status||1);
}
console.log('\nALL PREFLIGHT TESTS PASS');
