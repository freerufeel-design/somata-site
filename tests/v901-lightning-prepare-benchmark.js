'use strict';
// Comparative synthetic CPU-preparation benchmark; NOT an NVIDIA or WebGPU FPS measurement.
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{const h=await createBrowserHarness({disableGpu:true,loadDelayMs:150,evalTimeoutMs:23000});try{
 const r=await h.evaluate(`(()=>{
 const L=state.layers[0];ensureLayerEffectState(L);
 const cfg=getLayerSweepConfig(L);Object.assign(cfg,{enabled:true,glintEnabled:false,lightningEnabled:true,effectType:'lightning',lightningPrecision:'exact',lightningAfterglow:true,lightningMicroStrikes:2,lightningGlow:24,lightningGlowIntensity:100,lightningBrightness:100});
 const n=1200;let prepared=0,precharge=0,strike=0,after=0,idle=0,invalid=0;
 const t0=performance.now();
 for(let i=0;i<n;i++){
   beginFrameGeometryRuntime();const c=acquireLayerFrameEffectContext(0);
   c.layer=L;c.effectLayer=L;c.sourceLayer=L;c.staticDrawData=getCachedLayerDrawData(L);c.canonicalGeometry=getCanonicalLayerGeometry(L);
   c.now=1000+i*16;c.frame.now=c.now;c.frame.dpr=1;c.frame.id=c.frameId;c.strokeWidth=2;c.layerSweep=cfg;c.sweepPreparedReady=false;
   const d=prepareLayerFrameSweepData(c);const st=d?.lightningVector?.stage||'unknown';
   if(d?.prepared&&Array.isArray(d.paths)&&d.paths.length)prepared++;
   if(st==='precharge')precharge++;else if(st==='strike')strike++;else if(st==='after')after++;else if(st==='idle')idle++;else invalid++;
 }
 return{frames:n,precharge,strike,after,idle,prepared,invalid,cpuMs:Math.round((performance.now()-t0)*10)/10};
 })()`,{timeoutMs:23000,label:'Lightning CPU smoke'});
 if(uncaughtExceptions(h.events).length)throw Error('browser exception');
 console.log('SYNTHETIC LIGHTNING CPU BENCHMARK',JSON.stringify(r));
 }finally{await h.close()}})().catch(e=>{console.error(e.stack||e);process.exit(1)});
