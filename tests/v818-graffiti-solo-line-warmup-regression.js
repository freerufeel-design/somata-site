const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(v,msg)=>{if(!v)throw Error(msg)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:180,evalTimeoutMs:12000});
 try{
  const r=await h.evaluate(`(()=>{
    while(state.layers.length<3)state.layers.push(createLayer());
    state.layers=state.layers.slice(0,3);
    state.layers.forEach((l,i)=>{l.visible=i===2;l.lineVisible=true;l.lineProfileApplication=i===2?'graffiti':'stroke';l.fill=false;l.spiralEnabled=false;});
    state.masterLayerEdit=false;state.activeLayerId=state.layers[2].id;
    if(runtimeState.morph)runtimeState.morph.active=false;
    if(runtimeState.projectMorph)runtimeState.projectMorph.active=false;
    if(runtimeState.minimalMorph)runtimeState.minimalMorph.active=false;
    const original=WebGPUGraffitiRibbonRenderer.isReady;
    try{WebGPUGraffitiRibbonRenderer.isReady=()=>false;
      const snap=__spiroEffectsPlanSnapshot(2);
      return {base:snap?.base,application:state.layers[2].lineProfileApplication,solo:state.layers.map(l=>l.visible),snapshot:snap};
    }finally{WebGPUGraffitiRibbonRenderer.isReady=original;}
  })()`);
  assert(r.base===true,'Graffiti GPU warmup cannot blank ordinary isolated Line: '+JSON.stringify(r));
  assert(r.application==='graffiti'&&r.solo.join(',')==='false,false,true','authored third-layer selection changed');
  assert(uncaughtExceptions(h.events).length===0,'Uncaught browser exceptions');
  console.log('V818 GRAFFITI SOLO GPU WARMUP: PASS',JSON.stringify({base:r.base,application:r.application,solo:r.solo}));
 }finally{await h.close()}
})().catch(e=>{console.error('V818 GRAFFITI SOLO GPU WARMUP: FAIL',e.stack||e);process.exit(1)});
