const {createBrowserHarness}=require('./lib/browser-harness');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:12000,loadDelayMs:300});try{
const out=await h.evaluate(`(async()=>{
 const l=state.layers[0]||createLayer('rounding-lat'); if(!state.layers.length)state.layers.push(l); state.activeLayerId=l.id; state.layers.splice(1);
 l.visible=true;l.lineVisible=true;l.N=17;l.K=5;l.radius=220;l.rounding=10;l.spiralEnabled=true;l.spiralClosed=true;l.spiralOrder=3;l.spiralStepLinked=false;l.spiralStep=2.4;ensureLayerEffectState(l);l.showWeb=true;l.web.inside=true;state.showWeb=true;invalidateLayerGeometry(l,'round-lat');refreshLayerLookup(true);setSingleLayerSelection?.(l);syncSidebarInputs();
 state.morph.intervalSec=8; const interval=document.getElementById('morphInterval'); if(interval){interval.value='8';interval.dispatchEvent(new Event('input',{bubbles:true}));}
 const btn=document.getElementById('btnMorph'); if(runtimeState.morph.active)btn.click();btn.click(); await new Promise(r=>setTimeout(r,250));
 const before={p:runtimeState.morph.progress,canon:l.rounding,frame:runtimeState.morph.frameLayers?.[0]?.rounding,frames:__spiroAnimationStats().frameCount,phase:runtimeState.morph.phaseSerial};
 const el=document.getElementById('paramRounding');el.value='95'; const t0=performance.now();el.dispatchEvent(new Event('input',{bubbles:true}));
 const samples=[];for(const ms of [0,16,32,64,128,256,512,1000]){const wait=ms-(samples.at(-1)?.ms||0);if(wait>0)await new Promise(r=>setTimeout(r,wait));samples.push({ms:Math.round(performance.now()-t0),canon:l.rounding,frame:runtimeState.morph.frameLayers?.[0]?.rounding,p:runtimeState.morph.progress,frames:__spiroAnimationStats().frameCount,phase:runtimeState.morph.phaseSerial});}
 btn.click();return{before,samples};
})()` ,{timeoutMs:8000}); console.log(JSON.stringify(out,null,2));}finally{await h.close();}})().catch(e=>{console.error(e);process.exit(1)});
