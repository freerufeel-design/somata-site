const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');const assert=(c,m)=>{if(!c)throw new Error(m)};
try{
  const scheduler=fs.readFileSync(path.join(root,'js/core/scheduler.js'),'utf8');
  const pipeline=fs.readFileSync(path.join(root,'js/render/main-pipeline.js'),'utf8');
  const diagnostics=fs.readFileSync(path.join(root,'js/render/render-diagnostics.js'),'utf8');
  assert(scheduler.includes("console.error('[Somata Morph Freeze]'"),'Genuine scheduler watchdog failure lost error diagnostics');
  assert(scheduler.includes("console.warn('[Somata Performance]'"),'Slow-frame measurements need bounded console performance warnings');
  assert(scheduler.includes('performanceConsoleSuppressed'),'Slow-frame warning flood is not counted for later diagnosis');
  assert(scheduler.includes('morphFreezeHistory.push(rec)'),'Long-frame evidence must remain accessible even when console warnings are sampled');
  assert(diagnostics.includes('const logger=console.error;'),'True GPU failures must remain console.error');
  assert(fs.readFileSync(path.join(root,'js/render/outline-plan.js'),'utf8').includes("somataGpuDiagnosticError('web','strict-spiral-authority'"),'missing strict Spiral Web authority diagnostic');
  assert(fs.readFileSync(path.join(root,'js/render/sweep-plan.js'),'utf8').includes("somataGpuDiagnosticError('lightning','strict-spiral-authority'"),'missing strict Spiral Lightning authority diagnostic');
  console.log('SOMATA 7.7 CONSOLE DIAGNOSTICS: PASS');
}catch(e){console.error('FAIL 7.7 console diagnostics:',e.stack||e.message);process.exit(1)}
