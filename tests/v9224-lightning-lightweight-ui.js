const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:250,evalTimeoutMs:22000});
 try{
  const res=await h.evaluate(`(()=>{
   const el=id=>document.getElementById(id);
   const panel=el('sweepLightningSettings'),sections=[...panel.querySelectorAll('.lightning-slider-block .sweep-subsection-title')].map(e=>e.textContent.trim());
   const text=panel.innerText;
   const shapeRemoved=!el('sweepLightningProfileShape');
   const typeVisible=!!el('sweepLightningBehavior');
   const colorBeforeDuration=el('sweepLightningSecondaryColor').compareDocumentPosition(el('sweepLightningDuration')) & Node.DOCUMENT_POSITION_FOLLOWING;
   const durationBeforeSliders=el('sweepLightningDuration').compareDocumentPosition(el('sweepLightningWidthPercent')) & Node.DOCUMENT_POSITION_FOLLOWING;
   const layer=state.layers[0];ensureLayerEffectState(layer);state.activeLayerId=layer.id;
   const cfg=getLayerSweepConfig(layer);cfg.enabled=true;cfg.lightningEnabled=true;cfg.effectType='lightning';
   syncSweepUI();
   const input=el('sweepLightningDurationMultiplier');input.value='2.5';input.dispatchEvent(new Event('input',{bubbles:true}));
   const c=getLayerSweepConfig(layer);const old=lightningStrikeDurationMs(c,0);c.lightningDurationMultiplier=.5;const newDur=lightningStrikeDurationMs(c,0);c.lightningDurationMultiplier=2.5;
   const hz=getLightningEffectiveCycleRateHz(c,0),fraction=lightningActiveCycleFraction(c,0);
   const dummy={gpuArcResident:true};
   const f=prepareLightningVectorFrame(layer,fraction*.5,dummy,0,c);
   const finish=prepareLightningVectorFrame(layer,Math.min(.999,fraction+.002),dummy,0,c);
   return {sections,shapeRemoved,typeVisible,colorBeforeDuration:!!colorBeforeDuration,durationBeforeSliders:!!durationBeforeSliders,
     removed:!el('sweepLightningMode')&&!el('sweepLightningRandomPosition')&&!el('sweepLightningAfterglow')&&!el('sweepLightningAfterglowMs'),
     durationMultiplier:c.lightningDurationMultiplier,durationMs:old,halfMs:newDur,rateHz:hz,fraction,
     stage:f.stage,microIndex:f.microIndex,pulses:f.microPulses?.length,finish:finish.stage,
     noTail:c.lightningAfterglow===false&&c.lightningAfterglowMs===0,mode:c.lightningMode,random:c.lightningRandomPosition};
  })()`);
  assert.deepEqual(res.sections,['Основа','Свечение']);
  for(const key of ['shapeRemoved','typeVisible','colorBeforeDuration','durationBeforeSliders','removed','noTail'])assert(res[key],key);
  assert.equal(res.durationMultiplier,2.5);assert(Math.abs(res.durationMs/res.halfMs-5)<1e-6);
  assert.equal(res.stage,'strike');assert.equal(res.finish,'idle');assert.equal(res.mode,'perPath');assert.equal(res.random,false);
  assert.equal(uncaughtExceptions(h.events).length,0,uncaughtExceptions(h.events).join(' | '));
  console.log('PASS lightning 9.2.24 compact UI and no-tail duration:',JSON.stringify(res));
 }finally{await h.close();}
})().catch(e=>{console.error('FAIL',e);process.exitCode=1;});
