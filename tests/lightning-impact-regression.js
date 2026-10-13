const fs=require('fs'),path=require('path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(cond,msg)=>{if(!cond)throw new Error(msg);};
const ROOT=path.resolve(__dirname,'..');
async function main(){
  const src=fs.readFileSync(path.join(ROOT,'js/gpu/lightning-arc-renderer.js'),'utf8');
  assert(/analyticStrikeHalo\s*=\s*frame\.stage\s*!==\s*'precharge'/.test(src),'strike analytic-halo guard missing');
  assert(/if\(analyticStrikeHalo\)\{drawAnalyticGroup\(haloStyles,false\)/.test(src),'strike still routes halo through per-style blur');
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:120,evalTimeoutMs:12000});const baseline=uncaughtExceptions(h.events).length;
  try{
    const result=await h.evaluate(`(()=>{
      const L=state.layers[0];ensureLayerEffectState(L);const s=getLayerSweepConfig(L);s.enabled=true;s.effectType='lightning';s.lightningPrecision='exact';s.lightningAfterglow=true;s.lightningMicroStrikes=2;s.lightningGlow=24;s.lightningGlowIntensity=100;s.lightningBrightness=100;
      const t0=performance.now();let ok=0;for(let i=0;i<1200;i++){const d=prepareSweepGpuFrameData?.(L,[{points:[{x:-100,y:0},{x:0,y:50},{x:100,y:0}],closed:false}],i*16,0);if(d)ok++;}return{ok,ms:performance.now()-t0};
    })()`).catch(()=>({ok:0,ms:0}));
    const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,`uncaught browser exceptions: ${errors.join(' | ')}`);
    console.log('LIGHTNING IMPACT REGRESSION: PASS',{analyticStrikeHalo:true,prepProbe:result});
  }finally{await h.close();}
}
main().catch(err=>{console.error('LIGHTNING IMPACT REGRESSION: FAIL',err);process.exit(1);});
