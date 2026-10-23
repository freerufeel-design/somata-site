const fs=require('fs'),path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};
const ROOT=path.resolve(__dirname,'..');
async function main(){
  const src=fs.readFileSync(path.join(ROOT,'js/gpu/lightning-arc-renderer.js'),'utf8');
  assert(/EXACT_BEZIER_RASTER_SUBDIV=4/.test(src),'balanced exact Lightning raster must remain at 4x');
  assert(/drawAnalyticGroup\(haloStyles,false\)/.test(src),'Lightning halo no longer uses the analytic GPU path');
  assert(!/drawBlurredHaloGroup/.test(src),'legacy Lightning blur chain has returned');
  assert(!/WebGPUGraffitiContourGlow/.test(src),'Lightning has regained a cross-renderer blur dependency');
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:12000});const baseline=uncaughtExceptions(h.events).length;
  try{
    const result=await h.evaluate(`(()=>{
      const L=state.layers[0];ensureLayerEffectState(L);const s=getLayerSweepConfig(L);s.enabled=true;s.effectType='lightning';s.lightningPrecision='exact';s.lightningAfterglow=true;s.lightningMicroStrikes=2;s.lightningGlow=24;s.lightningGlowIntensity=100;s.lightningBrightness=100;
      const t0=performance.now();let ok=0,idle=0,invalid=0;for(let i=0;i<160;i++){beginFrameGeometryRuntime();const c=acquireLayerFrameEffectContext(0);c.layer=L;c.effectLayer=L;c.sourceLayer=L;c.staticDrawData=getCachedLayerDrawData(L);c.canonicalGeometry=getCanonicalLayerGeometry(L);c.now=i*16;c.frame.now=c.now;c.frame.dpr=1;c.frame.id=c.frameId;c.strokeWidth=2;c.layerSweep=s;c.sweepPreparedReady=false;const d=prepareLayerFrameSweepData(c);if(d?.lightningVector?.stage==='idle'){idle++;if(d.prepared)invalid++;}else if(d?.prepared&&Array.isArray(d.paths)&&d.paths.length)ok++;else invalid++;}return{ok,idle,invalid,iterations:160,ms:performance.now()-t0};
    })()`);
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,`uncaught browser exceptions: ${errors.join(' | ')}`);
    assert(result.idle>0&&result.ok>0&&result.ok+result.idle===result.iterations&&result.invalid===0,'Lightning strike/after needs real prepared geometry, idle must skip expensive preparation: '+JSON.stringify(result));
    assert(result.ms<1500,'Lightning CPU preparation smoke exceeded 1.5 s for 160 frames: '+result.ms.toFixed(1)+' ms');
    console.log('LIGHTNING IMPACT REGRESSION: PASS',{analyticHaloAllStages:true,exactRasterSubdiv:4,prepProbe:result});
  }finally{await h.close();}
}
main().catch(err=>{console.error('LIGHTNING IMPACT REGRESSION: FAIL',err);process.exit(1);});
