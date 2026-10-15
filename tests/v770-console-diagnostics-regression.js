const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');const assert=(c,m)=>{if(!c)throw new Error(m)};
try{
  const scheduler=fs.readFileSync(path.join(root,'js/core/scheduler.js'),'utf8');
  const pipeline=fs.readFileSync(path.join(root,'js/render/main-pipeline.js'),'utf8');
  assert(scheduler.includes("console.error('[Somata Morph Freeze]'"),'Morph freeze is not emitted as console.error');
  assert(!scheduler.includes("console.warn('[Somata Morph Freeze]'"),'Morph freeze still downgraded to console.warn');
  assert(pipeline.includes('const logger=console.error;'),'GPU diagnostics are still downgraded to warnings');
  assert(pipeline.includes("somataGpuDiagnosticError('web','strict-spiral-authority'"),'missing strict Spiral Web authority diagnostic');
  assert(pipeline.includes("somataGpuDiagnosticError('lightning','strict-spiral-authority'"),'missing strict Spiral Lightning authority diagnostic');
  console.log('SOMATA 7.7 CONSOLE DIAGNOSTICS: PASS');
}catch(e){console.error('FAIL 7.7 console diagnostics:',e.stack||e.message);process.exit(1)}
