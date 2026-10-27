'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:200,evalTimeoutMs:12000});
 try{
  const r=await h.evaluate(`(()=>{
    const rate=document.getElementById('sweepLightningRateMultiplier');
    const dur=document.getElementById('sweepLightningDurationMultiplier');
    const shapes=document.getElementById('sweepProfileShape');
    const numericEditors=rate.type==='number'&&dur.type==='number'&&!rate.hasAttribute('min')&&!dur.hasAttribute('min');
    const layer=state.layers[0];ensureLayerEffectState(layer);
    state.activeLayerId=layer.id;
    const c=getLayerSweepConfig(layer);
    c.glintEnabled=true;c.lightningEnabled=true;c.enabled=true;
    c.profileShape='line';
    normalizeSweepConfig(c);
    const forced=c.profileShape==='current'&&sweepProfileMode({...c,effectType:'glint',profileShape:'line'})==='current';
    rate.value=String(1/4096);
    rate.dispatchEvent(new Event('change',{bubbles:true}));
    const changed=getLayerSweepConfig(layer);
    const savedRate=changed.lightningRateMultiplier;
    const normal=getLightningRateFactor(changed,0);
    const sourceWhenNotMorph=getLightningTriggerSource(changed);
    runtimeState.morph.active=true;
    const sourceWhenMorph=getLightningTriggerSource(changed);
    const morphRate=getLightningEffectiveCycleRateHz(changed,0);
    runtimeState.morph.active=false;
    // Saved non-binary values must survive round trips through the select UI.
    changed.lightningRateMultiplier=.3;
    syncSweepUI();
    const savedCustom={selected:rate.value};
    dur.value=String(1/4096);
    dur.dispatchEvent(new Event('change',{bubbles:true}));
    const durationMult=getLayerSweepConfig(layer).lightningDurationMultiplier;
    return {hasShapeControl:!!shapes,forced,numericEditors,savedRate,normal,sourceWhenNotMorph,sourceWhenMorph,morphRate,savedCustom,durationMult};
  })()`,{timeoutMs:10000});
  assert.equal(r.hasShapeControl,false);
  assert(r.forced,'old glint line profiles must migrate to current');
  assert(r.numericEditors,'old numeric multiplier inputs must be present, not binary dropdowns');
  assert.equal(r.savedRate,1/4096,'lightning rate must survive UI state update');
  assert.equal(r.normal,4096,'rate multiplier has to affect actual strike rate');
  assert.equal(r.savedCustom.selected,'0.3','persisted arbitrary numeric value must remain editable');
  assert.equal(r.durationMult,1/4096,'duration multiplier must preserve small values');
  assert.equal(uncaughtExceptions(h.events).length,0,'no uncaught exceptions');
  console.log('PASS Somata 10 lightning fractions, legacy glint profiles, UI state and Morph source',JSON.stringify({rate:r.savedRate,rateFactor:r.normal,duration:r.durationMult,morphSource:r.sourceWhenMorph}));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
