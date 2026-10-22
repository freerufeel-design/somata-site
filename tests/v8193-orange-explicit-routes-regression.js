const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const assert=(x,m)=>{if(!x)throw new Error(m)};
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,evalTimeoutMs:30000});const baseline=uncaughtExceptions(h.events).length;
 try{
  const r=await h.evaluate(`(async()=>{
   const delay=ms=>new Promise(r=>setTimeout(r,ms));
   const mm=state.minimalMorph,ro=state.randomOptions,store=SomataOrangeMorphProfiles;
   if(runtimeState.morph?.active)activeStopMorphing(false);
   if(runtimeState.minimalMorph?.active)activeStopMinimalMorphing(false);
   const noSpecial=()=>{ro.byShape=false;ro.orbitBindingEnabled=false;ro.chaosStar=false;ro.bySpiralLayers=false;};
   const snap=layers=>layers.map(l=>{const o=JSON.parse(JSON.stringify(l));delete o.id; if(o.sweep){for(const k of ['phase','currentVelocity','lastUpdate','cycleCount','lightningPhase','lightningLastUpdate','lightningCycleCount'])delete o.sweep[k];} return o});
   const assignScene=()=>{
     state.randomLayerCount=3;document.getElementById('randomLayerCount').value='3';
     state.layers=Array.from({length:3},(_,i)=>state.layers[i]||state.layers[0]).map((layer,i)=>{
       const l=JSON.parse(JSON.stringify(layer));l.name='CUSTOM '+i;l.radius=150+i*33;l.rotation=i*47;
       l.strokeWidth=2+i;l.fillMatchStroke=false;l.fillColor=['#ff880055','#00bbcc77','#99887744'][i];
       l.fill=true;l.showLamps=i===0;l.showWeb=i===1;
       l.lamps.brightness=31+i*19;l.web.width=2.3+i;l.opacity=41+i;
       l.sweep.enabled=i===2;l.sweep.glintEnabled=i===2;
       l.particles.enabled=i===1;l.lineVisible=i!==2;
       return l;
     });
   };
   assignScene();
   noSpecial();mm.generatorStyle='standard';mm.routingBindings=[];
   store.captureDraft(mm,ro,3);
   const unchangedBefore=snap(state.layers);
   document.getElementById('btnRandomPreset').click();await delay(75);
   const unchangedAfter=snap(state.layers);
   const noRoutes=JSON.stringify(unchangedBefore)===JSON.stringify(unchangedAfter);
   // Curated style may propose Web, Lamps, Fill, motion, etc. With ONLY width
   // routed, none of these suggested values must be applied to authored layers.
   assignScene();noSpecial();mm.generatorStyle='solarRosette';
   mm.routingBindings=[{parameter:'layer.strokeWidth',enabled:true,min:7,max:7,layerPercent:100}];
   const onlyBefore=snap(state.layers);
   document.getElementById('btnRandomPreset').click();await delay(75);
   const onlyAfter=snap(state.layers);
   const onlyWidth=onlyAfter.every((l,i)=>{
     const expected=JSON.parse(JSON.stringify(onlyBefore[i]));expected.strokeWidth=7;
     return JSON.stringify(l)===JSON.stringify(expected);
   });
   // An active morph generation must obey the same permissions as Dice.
   assignScene();noSpecial();mm.generatorStyle='solarRosette';
   mm.routingBindings=[{parameter:'layer.strokeWidth',enabled:true,min:7,max:7,layerPercent:100}];
   mm.instantSwitch=true;mm.intervalSec=2;
   const liveBefore=snap(state.layers);
   document.getElementById('btnMinimalMorph').click();await delay(160);
   const liveAfter=snap(state.layers);
   const liveOnlyWidth=liveAfter.length===3&&liveAfter.every((l,i)=>{
     const expected=JSON.parse(JSON.stringify(liveBefore[i]));expected.strokeWidth=7;
     return JSON.stringify(l)===JSON.stringify(expected);
   });
   const liveRunning=runtimeState.minimalMorph?.active===true;
   if(runtimeState.minimalMorph?.active)activeStopMinimalMorphing(false);
   // Zero coverage is semantically identical to disabling the row.
   assignScene();noSpecial();mm.generatorStyle='standard';
   mm.routingBindings=[{parameter:'layer.strokeWidth',enabled:true,min:7,max:7,layerPercent:0}];
   const coverageBefore=snap(state.layers);
   document.getElementById('btnRandomPreset').click();await delay(70);
   const coverageZero=JSON.stringify(coverageBefore)===JSON.stringify(snap(state.layers));
   // Explicit empty bindings survive profile save/load (no defaults re-injected).
   mm.routingBindings=[];store.captureDraft(mm,ro,3);const p=store.activeProfile(mm,ro,3);
   store.save(mm,ro,3);
   const noAutoBindings=p.config.minimal.routingBindings.length===0;
   const profileId=p.id;
   store.select(mm,ro,{value:3},'orange-lace');
   store.select(mm,ro,{value:3},profileId);
   const emptyRestored=mm.routingBindings.length===0;
   // Legacy hidden arbitrary keys cannot be applied through Orange profile.
   p.config.minimal.__injectedHiddenValue='this-must-not-be-applied';
   delete mm.__injectedHiddenValue;
   store.select(mm,ro,{value:3},'orange-lace');store.select(mm,ro,{value:3},profileId);
   const hiddenIgnored=mm.__injectedHiddenValue===undefined;
   // Both editors: regular parameter-chip look and layout.
   document.getElementById('btnMorphSettings')?.click();
   document.getElementById('btnRandomSettings')?.click();await delay(50);
   state.morph.options.byShape=true;state.morph.monoOrbitTransforms=true;
   ro.byShape=true;ro.orbitBindingEnabled=true;
   renderMorphProfileBindings();renderOrangeMorphBindings();
   const ui={};
   for(const [id,sel] of [['blueShape','#morphProfileBindings [data-morph-special="shape"] .morph-special-config-name'],['blueOrbits','#morphProfileBindings [data-morph-special="orbits"] .morph-special-config-name'],['orangeShape','#orangeMorphBindings [data-orange-special="shape"] .morph-special-config-name'],['orangeOrbits','#orangeMorphBindings [data-orange-special="orbits"] .morph-special-config-name']]){
     const el=document.querySelector(sel);const css=el&&getComputedStyle(el);
     ui[id]={exists:!!el,border:css?.borderTopStyle,padding:css?.paddingLeft,bg:css?.backgroundColor};
   }
   const changed=(after,before)=>after.map((v,i)=>Object.keys(v).filter(k=>JSON.stringify(v[k])!==JSON.stringify(before[i]?.[k])).map(k=>k==='sweep' ? 'sweep='+JSON.stringify(Object.keys(v.sweep||{}).filter(x=>JSON.stringify(v.sweep[x])!==JSON.stringify(before[i]?.sweep?.[x])).map(x=>[x,before[i]?.sweep?.[x],v.sweep[x]])) : k+':'+JSON.stringify(v[k]).slice(0,70)));
   return {noRoutes,onlyWidth,liveOnlyWidth,liveRunning,coverageZero,details:{noRoutes:changed(unchangedAfter,unchangedBefore),onlyWidth:changed(onlyAfter,onlyBefore),live:changed(liveAfter,liveBefore),coverage:changed(snap(state.layers),coverageBefore)},noAutoBindings,emptyRestored,hiddenIgnored,ui,
    failures:onlyWidth?[]:[{changed:Object.keys(onlyAfter[0]||{}).filter(k=>JSON.stringify(onlyAfter[0][k])!==JSON.stringify(onlyBefore[0]?.[k])).map(k=>({key:k,before:onlyBefore[0]?.[k],after:onlyAfter[0]?.[k]}))}]};
  })()`,{timeoutMs:30000,label:'8.19.3 Orange explicit-only routing and UI'});
  for(const flag of ['noRoutes','onlyWidth','liveOnlyWidth','liveRunning','coverageZero','noAutoBindings','emptyRestored','hiddenIgnored'])assert(r[flag],flag+': '+JSON.stringify(r));
  for(const [id,obj] of Object.entries(r.ui))if(id.startsWith('orange'))assert(obj.exists,'row '+id+' missing');
  const errors=uncaughtExceptions(h.events).slice(baseline);assert(!errors.length,'browser exception: '+errors.join(' | '));
  console.log('8.19.3 ORANGE EXPLICIT ROUTES + MATRIX ROW PARITY: PASS',JSON.stringify(r));
 }finally{await h.close()}
})().catch(e=>{console.error('8.19.3 ORANGE EXPLICIT ROUTES FAIL:',e.stack||e);process.exit(1)});
