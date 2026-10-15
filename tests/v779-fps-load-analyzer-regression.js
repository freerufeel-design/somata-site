const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..');const assert=(c,m)=>{if(!c)throw new Error(m)};
try{
  const overlay=fs.readFileSync(path.join(root,'js/bootstrap/error-overlay.js'),'utf8');
  const scheduler=fs.readFileSync(path.join(root,'js/core/scheduler.js'),'utf8');
  const lightning=fs.readFileSync(path.join(root,'js/gpu/lightning-arc-renderer.js'),'utf8');
  const sweep=fs.readFileSync(path.join(root,'js/render/sweep-pass.js'),'utf8');
  const hub=fs.readFileSync(path.join(root,'js/app/geometry-gpu-core.js'),'utf8');
  assert(overlay.includes("setTab('load')")&&overlay.includes('Анализ: ВКЛ')&&overlay.includes('renderLoadText'),'FPS console Load tab missing');
  assert(overlay.includes('profiler.sampleEvery=1'),'live analyzer does not raise pass sampling while visible');
  assert(overlay.includes("safeCall('__spiroGpuLightningArcPeekStatus')"),'Lightning live metrics missing');
  assert(scheduler.includes('lastPaintMs:roundFreezeMs(lastPaintTiming.ms)'),'scheduler does not expose paint time to load analyzer');
  assert(lightning.includes('lastEncodeCpuMs')&&lightning.includes('__spiroGpuLightningArcPeekStatus'),'Lightning encode timing/peek status missing');
  assert(sweep.includes('rendererReason')&&sweep.includes('lightning:WebGPULightningArcRenderer?.peekStatus?.()'),'exact Lightning error loses renderer reason');
  assert(hub.includes("console.error('[Somata WebGPU device lost]'"),'WebGPU device loss is not emitted to FPS error console');
  console.log('SOMATA 7.7.9 FPS LOAD ANALYZER: PASS');
}catch(e){console.error('FAIL 7.7.9 FPS load analyzer:',e.stack||e.message);process.exit(1)}
