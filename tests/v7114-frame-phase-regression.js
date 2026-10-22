// Rare long frames must be measured on THAT frame, not attributed to the last
// sampled per-effect CPU profile. Covers real browser initialization and render.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(v,m)=>{if(!v)throw new Error(m)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:300,evalTimeoutMs:12000});
 try{
  const outcome=await h.evaluate(`(()=>{
    renderMainCanvas();
    const r=window.__somataFramePhaseStatus?.();
    const b=r?.last||{};
    const fields=['framePrepareMs','layersMs','lampGpuMs','viewportMs','finalGpuMs','presentationRescueMs','frameCleanupMs','gpuMainUploadMs','gpuQueueSubmitMs','unattributedMs','totalMs'];
    return {boot:window.__spiroAppBootComplete===true,fields:Object.fromEntries(fields.map(k=>[k,b[k]])),frameId:b.frameId,historyCount:r?.slow?.length};
  })()`);
  assert(outcome.boot,'Boot did not finish');
  for(const [key,n] of Object.entries(outcome.fields))assert(typeof n==='number'&&Number.isFinite(n)&&n>=0,`Missing or invalid ${key}: ${n}`);
  assert(outcome.fields.totalMs>0,'No real frame timing');
  const sum=['framePrepareMs','layersMs','lampGpuMs','viewportMs','finalGpuMs','presentationRescueMs','frameCleanupMs'].reduce((s,k)=>s+outcome.fields[k],0);
  assert(sum<=outcome.fields.totalMs+1,`Frame phase accounting exceeded total: ${sum} > ${outcome.fields.totalMs}`);
  assert(uncaughtExceptions(h.events).length===0,'Unhandled Chromium exceptions: '+uncaughtExceptions(h.events).join(' | '));
  console.log('PASS 7.11.4 frame-stage wallclock accounting + browser boot',outcome);
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL 7.11.4 frame phases:',e.stack||e);process.exit(1)});
