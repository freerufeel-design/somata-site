// 9.2.22: Regression for simplified Lightning controls and spiral tangential probability.
const assert=require('assert');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:220,evalTimeoutMs:20000});
 try{
 const v=await h.evaluate(`(()=>{
   const q=id=>document.getElementById(id),row=q('sweepLightningGlowIntensity')?.closest('.control-row'),spiral=q('morphSpiralTangentialChance');
   const L=state.layers[0],cfg=getLayerSweepConfig(L);
   cfg.lightningGlowIntensity=135;cfg.lightningGlowIntensityMultiplier=1.25;cfg.lightningBrightness=0;
   const settings=getLightningVisualSettings(cfg,0);
   spiral.value='77';spiral.dispatchEvent(new Event('change',{bubbles:true}));
   return {
     hasOldBright:!!q('sweepLightningBrightness'),
     brightnessLabel:row?.querySelector('.row-label span')?.textContent,
     hasBothColors:!!q('sweepLightningColor')&&!!q('sweepLightningSecondaryColor'),
     colorsAbove:!!(q('sweepLightningColor').compareDocumentPosition(q('sweepLightningWidthPercent'))&Node.DOCUMENT_POSITION_FOLLOWING),
     precisionHidden:!q('sweepLightningPrecision'),
     exactPrecision:normalizeLightningPrecisionValue('simple')==='exact',
     tangentialInput:!!spiral,
     tangentialState:state.morph.spiralTangentialChance,
     haloIntensity:settings.strength,
     brightness:settings.brightness,
     audioBrightnessRoute:(typeof AUDIO_PARAMETERS==='undefined')?null:'unknown',
     randomControl:q('morphBySpiralLayers')?.type
   };
 })()`);
 assert.strictEqual(v.hasOldBright,false,'retired Lightning brightness still visible');
 assert.strictEqual(v.brightnessLabel,'Яркость');
 assert(v.hasBothColors&&v.colorsAbove,'Lightning color row is not first');
 assert(v.precisionHidden&&v.exactPrecision,'simple Lightning path is still offered');
 assert(v.tangentialInput&&v.tangentialState===77,'tangential probability does not propagate');
 assert(Math.abs(v.haloIntensity-1.6875)<1e-9,'intensity-based brightness is broken');
 assert(v.brightness===1,'retired independent brightness still multiplies intensity');
 assert(!uncaughtExceptions(h.events).length,'browser exceptions: '+uncaughtExceptions(h.events).join(' | '));
 console.log('PASS v9222 Lightning+spiral UI',JSON.stringify(v));
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL v9222',e);process.exitCode=1});
