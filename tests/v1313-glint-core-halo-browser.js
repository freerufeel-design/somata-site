'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:180,evalTimeoutMs:45000});
 try{
  const d=await h.evaluate(`(async()=>{
   const initial=createDefaultSweepConfig();
   const html={core:!!document.querySelector('#sweepCoreAppearance #sweepColor'),halo:!!document.querySelector('#sweepHaloAppearance #sweepHaloColor'),haloBrightness:!!document.querySelector('#sweepHaloAppearance #sweepBrightness'),coreThickness:!!document.querySelector('#sweepCoreAppearance #sweepWidthPercent')};
   const layers=[createLayer('Core Halo A'),createLayer('Core Halo B'),createLayer('Core Halo C')];
   for(const l of layers)ensureLayerEffectState(l);
   state.layers.splice(0,state.layers.length,...layers);state.activeLayerId=layers[0].id;state.masterLayerEdit=false;
   updateLayerListUI();syncSidebarInputs();syncSweepUI();
   const ui={width:document.getElementById('sweepWidthPercent').value,brightness:document.getElementById('sweepBrightness').value,glow:document.getElementById('sweepGlow').value,glowMultiplier:document.getElementById('sweepGlowMultiplier').value,intensity:document.getElementById('sweepGlowIntensity').value,intensityMultiplier:document.getElementById('sweepGlowIntensityMultiplier').value,softness:document.getElementById('sweepSoftness').value,opacity:document.getElementById('sweepOpacity').value};
   const legacy={color:'#be1251',widthPercent:42};normalizeSweepConfig(legacy);
   const hc=document.getElementById('sweepHaloColor');hc.value='#00aaff';hc.dispatchEvent(new Event('input',{bubbles:true}));
   const solo=state.layers.map(l=>({core:l.sweep.color,halo:l.sweep.haloColor}));
   document.getElementById('btnMasterLayer').click();
   hc.value='#ff0088';hc.dispatchEvent(new Event('input',{bubbles:true}));
   const masterHalo=state.layers.map(l=>({core:l.sweep.color,halo:l.sweep.haloColor}));
   state.layers[2].sweep.haloColor='#123456';
   hc.value='#ff0088';hc.dispatchEvent(new Event('change',{bubbles:true}));
   const masterNoOpHalo=state.layers.map(l=>l.sweep.haloColor);
   const cc=document.getElementById('sweepColor');cc.value='#00ff44';cc.dispatchEvent(new Event('change',{bubbles:true}));
   const masterCore=state.layers.map(l=>({core:l.sweep.color,halo:l.sweep.haloColor}));
   const json=JSON.stringify(state.layers[1].sweep);
   return {initial,html,ui,legacy,solo,masterHalo,masterNoOpHalo,masterCore,saved:{core:JSON.parse(json).color,halo:JSON.parse(json).haloColor},master:state.masterLayerEdit};
  })()`);
  assert.equal(d.initial.widthPercent,105,'default thickness');
  assert.equal(d.initial.brightness,77,'default brightness');
  assert.equal(d.initial.glow,14.5,'default halo size');
  assert.equal(d.initial.glowIntensity,100,'default intensity');
  assert.equal(d.initial.opacity,100,'default opacity');
  assert.equal(d.initial.softness,100,'default softness');
  for(const field of ['core','halo','haloBrightness','coreThickness'])assert.equal(d.html[field],true,'appearance nesting '+field);
  assert.deepEqual(d.ui,{width:'105',brightness:'77',glow:'14.5',glowMultiplier:'1',intensity:'100',intensityMultiplier:'1',softness:'100',opacity:'100'});
  assert.equal(d.legacy.haloColor,d.legacy.color,'old settings inherit original core tint');
  assert.equal(d.solo[0].halo,'#00aaff');assert.equal(d.solo[1].halo,'#ffffff','outside Master halo must stay separate');
  assert.equal(d.master,true);
  assert.deepEqual(d.masterNoOpHalo,['#ff0088','#ff0088','#ff0088'],'Master repeat selection must fan out halo color');
  for(const v of d.masterHalo){assert.equal(v.halo,'#ff0088');assert.equal(v.core,'#ffffff','halo control must not change core');}
  for(const v of d.masterCore){assert.equal(v.halo,'#ff0088','core control must not change halo');assert.equal(v.core,'#00ff44');}
  assert.deepEqual(d.saved,{core:'#00ff44',halo:'#ff0088'},'independent colors must serialize');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS Glint defaults, nested UI, legacy tint, independent GPU config, Master and serialization');
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
