const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:180,evalTimeoutMs:15000});
 try{
  const info=await h.evaluate(`(()=>{
   const removed=['paramSpiralStep','paramSpiralStepLinked','morphSpiralOrderLinked','morphSpiralRotationCompensation'];
   const missing=removed.every(id=>!document.getElementById(id));
   document.getElementById('morphSettingsPanel').classList.remove('hidden');
   state.morph.options.bySpiralLayers=true;
   renderMorphProfileBindings();
   const row=document.querySelector('#morphProfileBindings [data-morph-special="spiralLayers"]');
   const names=row?[...row.querySelectorAll('.morph-spiral-compact-range > span:first-child')].map(x=>x.textContent):[];
   const numbers=row?[...row.querySelectorAll('.morph-spiral-compact-range input[type=number]')].map(e=>e.value):[];
   const countDash=row?.querySelectorAll('.morph-spiral-compact-range > span:nth-child(3)').length||0;
   const layer=createLayer('v9214');layer.N=12;layer.K=1;layer.spiralEnabled=true;layer.spiralOrder=1;state.layers=[layer];state.activeLayerId=layer.id;
   setLayerK(3);const linked={step:getEffectiveSpiralStep(layer),order:layer.spiralOrder,K:layer.K};
   layer.spiralStep=99;layer.spiralStepLinked=false;const legacy=getEffectiveSpiralStep(layer);
   layer.__spiralAnimatedK=2.25;const fractional=getEffectiveSpiralStep(layer);delete layer.__spiralAnimatedK;
   const p={...layer,spiralOrder:.0001,__spiralOrderInterpolating:true};
   const early=getEffectiveSpiralOrder(p);
   const eased=[0,.1,.25,.5,.75,.9,1].map(t=>t*t*(3-2*t));
   return{missing,names,numbers,countDash,linked,legacy,fractional,early,eased};
  })()`);
  assert(info.missing,'obsolete UI controls remain');
  assert.deepEqual(info.names,['Число слоёв','Порядок спирали']);
  assert.equal(info.numbers.length,4,'expected exactly four compact inputs');
  assert.equal(info.countDash,2);
  assert.equal(info.linked.K,3);assert.equal(info.linked.step,3);assert.equal(info.linked.order,1,'changing K must not change spiral order');
  assert.equal(info.legacy,3,'legacy independent step still overrides K');
  assert.equal(info.fractional,2.25,'fractional animated K snapped');
  assert.equal(info.early,.0001,'first incoming spiral snaps to full winding');

  assert(!uncaughtExceptions(h.events).length,'browser threw');
  console.log('PASS 9.2.15 compact blue-morph ranges, canonical K, independent order',info);
 }finally{await h.close()}
})().catch(e=>{console.error('FAIL 9.2.14 spiral UI/canonical K',e.stack||e);process.exitCode=1;});
