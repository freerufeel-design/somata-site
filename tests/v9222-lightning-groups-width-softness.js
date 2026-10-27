const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:220,evalTimeoutMs:18000});
  try{
    const x=await h.evaluate(`(()=>{
      const node=id=>document.getElementById(id),panel=node('sweepLightningSettings');
      const sections=[...panel.querySelectorAll('.lightning-slider-block')].map(x=>x.querySelector('.sweep-subsection-title')?.textContent.trim());
      const labels=[...panel.querySelectorAll('.lightning-text-settings select')].map(x=>x.id);
      const idx=(id)=>[...panel.querySelectorAll('*')].indexOf(node(id));
      const layer=state.layers[0];ensureLayerEffectState(layer);state.activeLayerId=layer.id;
      const cfg=getLayerSweepConfig(layer);cfg.enabled=true;cfg.effectType='lightning';cfg.lightningEnabled=true;
      syncSweepUI();
      const width=node('sweepLightningWidthMultiplier');width.value='2.5';width.dispatchEvent(new Event('input',{bubbles:true}));
      const soft=node('sweepLightningSoftnessMultiplier');soft.value='8';soft.dispatchEvent(new Event('input',{bubbles:true}));
      const cfgNow=getLayerSweepConfig(layer);
      const visual=getLightningVisualSettings(cfgNow,0);
      const prepared={gpuArcResident:true,strikePath:null};
      const vb=prepareLightningVectorFrame(layer,0.1,prepared,0,cfgNow);
      const original=cfgNow.lightningWidthMultiplier;cfgNow.lightningWidthMultiplier=1;
      const va=prepareLightningVectorFrame(layer,0.1,prepared,0,cfgNow);
      cfgNow.lightningWidthMultiplier=original;
      return {sections,labels,colorsFirst:idx('sweepLightningColor')<idx('sweepLightningWidthPercent'),
        noOldBrightness:!node('sweepLightningBrightness'),noPrecisionSelect:!node('sweepLightningPrecision'),
        widthMultiplier:cfgNow.lightningWidthMultiplier,softMultiplier:cfgNow.lightningSoftnessMultiplier,
        effectiveSoftness:visual.softness,renderWidth:vb?.boltW,referenceWidth:va?.boltW,
        multiplierIsLog:width.dataset.logMultiplier==='1',noLegacySimple:normalizeLightningPrecisionValue('simple')==='exact',
        addedTangential:!!node('morphSpiralTangentialChance')};
    })()`);
    assert.deepEqual(x.sections,['Основа','Свечение']);
    assert(!x.labels.includes('sweepLightningProfileShape')&&x.labels.includes('sweepLightningBehavior')&&x.colorsFirst);
    assert(x.noOldBrightness&&x.noPrecisionSelect&&x.multiplierIsLog&&x.noLegacySimple);
    assert(x.addedTangential);
    assert.equal(x.widthMultiplier,2.5);assert.equal(x.softMultiplier,8);
    assert(x.effectiveSoftness>1.5,'softness is still clamped to 150%');
    assert(Math.abs(x.renderWidth/x.referenceWidth-2.5)<1e-7,'width multiplier is not applied to stroke');
    const errors=uncaughtExceptions(h.events);assert(!errors.length,errors.join(' | '));
    console.log('PASS lightning grouped UI/width/unbounded softness',x);
  }finally{await h.close()}
})().catch(e=>{console.error('FAIL',e);process.exitCode=1});
