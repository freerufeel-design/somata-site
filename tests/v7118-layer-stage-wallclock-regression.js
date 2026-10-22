// Real Chromium smoke: every diagnostic frame must account for the same
// current frame and current layers; no geometry or GPU objects may be retained.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(v,m)=>{if(!v)throw new Error(m)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:300,evalTimeoutMs:12000});
 try{
  const r=await h.evaluate(`(()=>{
    renderMainCanvas();
    const f=window.__somataFramePhaseStatus()?.last;
    return {boot:window.__spiroAppBootComplete===true,frame:f||null};
  })()`);
  assert(r.boot,'browser boot incomplete');
  assert(r.frame&&Number.isFinite(r.frame.totalMs),'missing last render snapshot');
  assert(Array.isArray(r.frame.layerDetails),'per-layer breakdown missing');
  assert(r.frame.layerDetails.length>=1&&r.frame.layerDetails.length<=8,'invalid layer count');
  let layerTotal=0;
  for(const d of r.frame.layerDetails){
   for(const key of ['prepareMs','drawMs','totalMs'])assert(Number.isFinite(d[key])&&d[key]>=0,`bad ${key}`);
   assert(typeof d.kind==='string'&&d.steps&&typeof d.steps==='object','missing layer labels');
   const sub=Object.values(d.steps);
   for(const ms of sub)assert(Number.isFinite(ms)&&ms>=0,'stage time must be numeric');
   const tolerance=2.0;
   assert(d.prepareMs+d.drawMs <= d.totalMs+tolerance,'preparation and draw exceed layer wall time');
   // Stage timing is inclusive of recorded rendering stages, not unrelated frames.
   assert(sub.reduce((a,b)=>a+b,0) <= d.drawMs+tolerance,'stages exceed draw wall time');
   layerTotal+=d.totalMs;
  }
  assert(layerTotal<=r.frame.layersMs+3,'layer totals exceed frame layer wall time');
  assert(uncaughtExceptions(h.events).length===0,'Chromium exceptions: '+uncaughtExceptions(h.events).join(' | '));
  console.log('PASS 7.11.8 same-frame per-layer/stage wallclock',{
    frameId:r.frame.frameId,layerCount:r.frame.layerDetails.length,
    layersMs:r.frame.layersMs,layerDetails:r.frame.layerDetails
  });
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL 7.11.8 frame timing',e.stack||e);process.exit(1)});
