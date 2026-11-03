'use strict';
// Regressions for v13.1.3 Master: synchronous three-layer fan-out,
// repeated/no-op assignments, nested effect fields and active Blue Morph.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:45000});
 try{
  const result=await h.evaluate(`(async()=>{
   const layers=[createLayer('Master A'),createLayer('Master B'),createLayer('Master C')];
   layers.forEach((layer,i)=>{
    ensureLayerEffectState(layer);
    layer.glow=[9,2,4][i];
    layer.glowMultiplier=[1,2,3][i];
    layer.glowIntensity=[60,20,40][i];
    layer.glowIntensityMultiplier=[1,2,3][i];
    layer.strokeWidth=[4,6,8][i];
    layer.strokeWidthMultiplier=[1,2,3][i];
    layer.radius=[120,160,220][i];
    layer.opacity=[90,80,70][i];
    layer.strokeColor=['#ff0000','#00ff00','#0000ff'][i];
    layer.fill=false;
    layer.fillMatchStroke=false;
    layer.fillColor=['#ff000033','#00ff0066','#0000ff99'][i];
    layer.web.width=[.9,.3,.6][i];
    layer.sweep.glow=[14,4,8][i];
    layer.particles.density=[50,25,75][i];
    layer.lamps.brightness=[80,40,60][i];
   });
   state.layers.splice(0,state.layers.length,...layers);
   state.activeLayerId=layers[0].id;
   state.masterLayerEdit=false;
   updateLayerListUI();syncSidebarInputs();
   const initial=state.layers.map(l=>({glow:l.glow,radius:l.radius,strokeColor:l.strokeColor}));
   document.getElementById('btnMasterLayer').click();
   const onEnable=state.layers.map(l=>({glow:l.glow,radius:l.radius,strokeColor:l.strokeColor}));
   const cases=[
    ['paramGlow',9,'input','glow'],                     // no-op source value
    ['numGlow',12,'change','glow'],                     // numeric value
    ['paramGlowMultiplier',3,'input','glowMultiplier'],
    ['paramGlowIntensity',60,'input','glowIntensity'],  // no-op source value
    ['paramGlowIntensityMultiplier',2,'input','glowIntensityMultiplier'],
    ['paramStrokeWidth',4,'input','strokeWidth'],
    ['numStrokeWidth',5,'change','strokeWidth'],
    ['paramStrokeWidthMultiplier',2,'input','strokeWidthMultiplier'],
    ['paramOpacity',90,'input','opacity'],
    ['paramRadius',120,'input','radius'],
    ['webWidth',.9,'input','web.width'],                 // per-layer web settings
    ['sweepGlow',14,'input','sweep.glow'],              // per-layer sweep settings
    ['particleDensity',50,'input','particles.density'],
    ['lampBrightness',80,'input','lamps.brightness']
   ];
   const checks=[];
   for(const [id,value,eventType,path] of cases){
    const el=document.getElementById(id);
    if(!el)throw new Error('Missing control '+id);
    el.value=String(value);
    el.dispatchEvent(new Event(eventType,{bubbles:true}));
    const values=state.layers.map(l=>path.split('.').reduce((v,k)=>v?.[k],l));
    checks.push({id,path,value,values,paths:window.__spiroLastMasterBroadcast?.paths||[]});
   }
   // A one-field operation must preserve other layer-specific properties.
   const unrelated=state.layers.map(l=>({strokeColor:l.strokeColor,radius:l.radius}));
   // Segmented line mode buttons already edit every layer, even when the
   // selected source mode is unchanged. The transaction must not undo them.
   state.layers[0].lineProfile='round';state.layers[0].lineProfileStroke='round';
   state.layers[1].lineProfile='slash';state.layers[1].lineProfileStroke='slash';
   state.layers[2].sprite.enabled=true;
   syncSidebarInputs();
   document.querySelector('[data-line-main-mode="point"]').click();
   const lineModes=state.layers.map(l=>({line:l.lineProfileStroke,sprite:l.sprite.enabled}));
   // A derived sweep.enabled must respect the destination's independent
   // Lightning switch rather than blindly using the source's Boolean.
   state.layers[0].sweep.glintEnabled=true;state.layers[0].sweep.lightningEnabled=false;state.layers[0].sweep.enabled=true;
   state.layers[1].sweep.glintEnabled=false;state.layers[1].sweep.lightningEnabled=false;state.layers[1].sweep.enabled=false;
   state.layers[2].sweep.glintEnabled=false;state.layers[2].sweep.lightningEnabled=true;state.layers[2].sweep.enabled=true;
   syncSidebarInputs();
   const glint=document.getElementById('showSweep');glint.checked=true;glint.dispatchEvent(new Event('change',{bubbles:true}));
   const sweepSwitches=state.layers.map(l=>({glint:l.sweep.glintEnabled,lightning:l.sweep.lightningEnabled,enabled:l.sweep.enabled}));
   const beforeColors=state.layers.map(l=>l.fillColor);
   // The opacity of the source is left unchanged, but must still be assigned
   // to all targets, retaining their distinct fill RGB colors.
   state.layers.forEach((l,i)=>{l.fillColor=beforeColors[i];});
   syncSidebarInputs();
   const fillOpacity=document.getElementById('paramFillOpacity');
   const sourcePercent=Math.round((parseInt(state.layers[0].fillColor.slice(-2),16)/255)*100);
   fillOpacity.value=String(sourcePercent);
   fillOpacity.dispatchEvent(new Event('input',{bubbles:true}));
   const fills=state.layers.map(l=>l.fillColor);
   // Master stays enabled if the source layer is switched.
   const select=state.layers[1];
   setSingleLayerSelection(select);updateLayerListUI();syncSidebarInputs();
   const masterAfterSelection=state.masterLayerEdit;
   const intensity=document.getElementById('paramGlowIntensity');
   intensity.value='83';intensity.dispatchEvent(new Event('input',{bubbles:true}));
   const afterSelection=state.layers.map(l=>l.glowIntensity);
   // Master writes through to the live Blue Morph layer snapshots.
   setSingleLayerSelection(state.layers[0]);updateLayerListUI();syncSidebarInputs();
   if(!runtimeState.morph.active)document.getElementById('btnMorph').click();
   const rt=runtimeState.morph,cycleStart=rt.cycleStart;
   const glow=document.getElementById('paramGlow');
   glow.value='16';glow.dispatchEvent(new Event('input',{bubbles:true}));
   const live={active:rt.active,cycleStart,cycleAfter:rt.cycleStart,glows:state.layers.map(l=>l.glow),
    snapshots:['frameLayers','lightLayers','renderSourceLayers','renderTargetLayers'].map(k=>({name:k,values:(rt[k]||[]).slice(0,3).map(l=>l?.glow)}))};
   if(rt.active)document.getElementById('btnMorph').click();
   document.getElementById('btnMasterLayer').click();
   const masterOff=state.masterLayerEdit===false;
   glow.value='5';glow.dispatchEvent(new Event('input',{bubbles:true}));
   const afterOff=state.layers.map(l=>l.glow);
   // Fallback for custom controls that stop propagation before window bubble.
   document.getElementById('btnMasterLayer').click();
   const custom=document.createElement('input');custom.id='custom-master-edit';document.body.appendChild(custom);
   custom.addEventListener('input',e=>{state.layers[0].glow=23;e.stopPropagation();});
   custom.dispatchEvent(new Event('input',{bubbles:true}));
   await new Promise(r=>setTimeout(r,0));
   const stopPropagation=state.layers.map(l=>l.glow);
   custom.remove();
   return{initial,onEnable,checks,unrelated,lineModes,sweepSwitches,beforeColors,fills,sourcePercent,masterAfterSelection,afterSelection,live,masterOff,afterOff,stopPropagation};
  })()`,{label:'13.1.3 Master three-layer browser regression',timeoutMs:44000});
  assert.deepEqual(result.onEnable,result.initial,'enabling Master must not normalize existing layers');
  for(const item of result.checks){
   assert(item.values.every(v=>v===item.values[0]),'Master missed synchronous field '+JSON.stringify(item));
   assert(item.paths.includes(item.path),'Master did not resolve field '+JSON.stringify(item));
  }
  assert.deepEqual(result.unrelated.map(v=>v.strokeColor),result.initial.map(v=>v.strokeColor),'other fields were overwritten');
  assert(result.lineModes.every(v=>v.line==='round'&&v.sprite===false),'line mode command rolled back dependent fields');
  assert.deepEqual(result.sweepSwitches,[
   {glint:true,lightning:false,enabled:true},
   {glint:true,lightning:false,enabled:true},
   {glint:true,lightning:true,enabled:true}
  ]);
  assert(result.fills.every(c=>c.slice(-2)===result.fills[0].slice(-2)),'fill opacity did not broadcast');
  assert(result.fills.every((c,i)=>c.slice(0,7)===result.beforeColors[i].slice(0,7)),'fill RGB was overwritten');
  assert(result.masterAfterSelection,'selecting another source switched Master off');
  assert.deepEqual(result.afterSelection,[83,83,83]);
  assert(result.live.active,'Blue Morph not active');
  assert.equal(result.live.cycleAfter,result.live.cycleStart,'Master restarted Morph');
  assert.deepEqual(result.live.glows,[16,16,16]);
  for(const snap of result.live.snapshots)for(const val of snap.values)if(val!==undefined)assert.equal(val,16,'stale Blue Morph '+snap.name);
  assert(result.masterOff,'failed to switch Master off');
  assert.deepEqual(result.afterOff,[5,16,16]);
  assert.deepEqual(result.stopPropagation,[23,23,23]);
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS Master 13.1.3: all three layers, unchanged source values, line glow/width/opacity, web/sweep/particles/lamps, fill RGB, Blue Morph, Master off, stopped event');
 }finally{await h.close();}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
