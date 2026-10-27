'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:12000});
 try{
  const r=await h.evaluate(`(()=>{
   const el=document.getElementById('sweepLightningBlendMode');
   const values=[...el.options].map(o=>o.value);
   const lamp=[...document.getElementById('lampBlendMode').options].map(o=>o.value);
   const layer=state.layers.find(l=>l.id===state.activeLayerId);
   const sweep=getLayerSweepConfig(layer),saved=sweep.lightningBlendMode;
   const modes=[];
   for(const mode of values){
      el.value=mode;el.dispatchEvent(new Event('change',{bubbles:true}));
      const c=getLayerSweepConfig(layer);
      modes.push({mode,stored:c.lightningBlendMode,core:sweepCoreBlendMode({...c,effectType:'lightning'}),glow:sweepGlowBlendMode({...c,effectType:'lightning'}),advanced:SomataSweepLampBlend.hasAdvanced(mode)});
   }
   el.value=saved||'lighter';el.dispatchEvent(new Event('change',{bubbles:true}));
   const glint={effectType:'glint',coreBlendMode:'multiply',glowBlendMode:'darken',lightningBlendMode:'color'};
   return {values,lamp,modes,glint:{core:sweepCoreBlendMode(glint),glow:sweepGlowBlendMode(glint)},
      helper:typeof SomataSweepLampBlend.encode==='function',absentOld:!document.getElementById('sweepLightningCoreBlendMode')};
 })()`,{timeoutMs:11000});
  assert.deepEqual(r.values,r.lamp,'flash must use the six Lamp blend modes');
  for(const m of r.modes)assert(m.mode===m.stored&&m.mode===m.core&&m.mode===m.glow,'flash mode not connected: '+JSON.stringify(m));
  assert(r.helper&&r.absentOld,'separate old selects remain');
  assert.deepEqual(r.modes.filter(x=>x.advanced).map(x=>x.mode),['color-dodge','difference','color']);
  assert.equal(r.glint.core,'multiply');assert.equal(r.glint.glow,'darken');
  assert.equal(uncaughtExceptions(h.events).length,0);
  console.log('PASS lightning flash all six lamp modes routed to both GPU stages, Glint unaffected',JSON.stringify(r));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
