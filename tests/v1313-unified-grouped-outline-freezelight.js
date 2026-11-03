'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:170,evalTimeoutMs:30000});
 try {
   const r=await h.evaluate(`(async()=>{
     const R=window.SomataParameterRegistry,M=window.SomataParameterMatrix,B=window.SomataMorphParameterRouting,O=window.SomataOrangeMorphProfiles;
     const ids=['outline.layerCount','outline.width','outline.color','outline.mode','lamps.freezeTailSec','lamps.freezeIntensity'];
     const line=M.all().filter(d=>(d.morph?.group||d.group)==='Линия').map(d=>({id:d.id,label:d.label}));
     const lamps=M.all().filter(d=>(d.morph?.group||d.group)==='Лампочки').map(d=>({id:d.id,label:d.label}));
     const expected=ids.map(id=>{const d=R.get(id);return {id,supported:d?.morph?.supported===true,audio:R.audioDefinitions().some(a=>a.parameterId===id),kind:d?.type,mainId:d?.ui?.mainId};});
     const controls=expected.map(x=>{const el=document.getElementById(x.mainId);const host=x.id==='outline.mode'?el?.closest('.line-outline-modes'):(el?.closest('.blue-morph-range-host')||el);return{id:x.id,exists:!!el,capable:host?.classList.contains('parameter-routing-capable'),rect:host?.getBoundingClientRect().width};});
     const origOutline={...state.lineOutline},origLamp={...state.lamps},origAudio=state.audioReactive.active;
     const origMorph={active:runtimeState.morph.active,paused:runtimeState.morph.paused,phaseSerial:runtimeState.morph.phaseSerial,geometryT:runtimeState.morph.geometryT};
     const savedBlue=B.workingBindings(state.morph,state.minimalMorph).map(b=>({...b}));
     const savedOrange=O.workingBindings(state.minimalMorph,state.randomOptions,state.randomLayerCount).map(b=>({...b}));
     state.audioReactive.active=false;state.lineOutline.enabled=true;state.lineOutline.layerCount=undefined;
     const total=state.layers.length;
     const countCases=[];
     for(let n of [undefined,0,1,total]){
       state.lineOutline.layerCount=n;
       countCases.push({n:n??'all',flags:state.layers.map((_,i)=>window.somataOutlineLayerEnabled(i))});
     }
     state.lineOutline.layerCount=total;
     const ui=document.getElementById('paramLineOutlineLayerCount');ui.value='1';ui.dispatchEvent(new Event('input',{bubbles:true}));
     const countByUi=state.lineOutline.layerCount;
     B.ensureProfiles(state.morph,state.minimalMorph);O.ensureProfiles(state.minimalMorph,state.randomOptions,state.randomLayerCount);
     for(const [id,min,max] of [['outline.layerCount',1,1],['lamps.freezeTailSec',6,6],['lamps.freezeIntensity',25,25]]){
       B.addBinding(state.morph,state.minimalMorph,id,{min,max});
       O.setBinding(state.minimalMorph,state.randomOptions,state.randomLayerCount,id,true,{min,max});
     }
     runtimeState.morph.active=true;runtimeState.morph.paused=false;runtimeState.morph.pausedByOrangeProject=false;runtimeState.morph.pausedByGreenProject=false;
     runtimeState.morph.phaseSerial=(Number(runtimeState.morph.phaseSerial)||0)+1;runtimeState.morph.geometryT=1;B.resetRuntime(runtimeState.morph);
     const blue={count:B.resolveGlobalValue('outline.layerCount',total),tail:B.resolveGlobalValue('lamps.freezeTailSec',1.5),intensity:B.resolveGlobalValue('lamps.freezeIntensity',100),layers:state.layers.map((_,i)=>window.somataOutlineLayerEnabled(i))};
     const pristine={...state.lamps};
     runtimeState.morph.active=false;B.resetRuntime(runtimeState.morph);
     window.__somataApplyOrangeGlobalTargets?.({'outline.layerCount':2,'lamps.freezeTailSec':7,'lamps.freezeIntensity':40});
     const orange={count:state.lineOutline.layerCount,tail:state.lamps.freezeTailSec,intensity:state.lamps.freezeIntensity,layerTail:state.layers[0].lamps?.freezeTailSec};
     const orangeBindings=O.workingBindings(state.minimalMorph,state.randomOptions,state.randomLayerCount).filter(b=>ids.includes(b.parameter)).map(b=>b.parameter);
     state.lineOutline={...origOutline};state.lamps={...origLamp};state.audioReactive.active=origAudio;
     const bindings=B.workingBindings(state.morph,state.minimalMorph);bindings.splice(0,bindings.length,...savedBlue);
     state.minimalMorph.routingBindings=savedOrange;Object.assign(runtimeState.morph,origMorph);B.resetRuntime(runtimeState.morph);
     return {line,lamps,expected,controls,total,countCases,countByUi,blue,pristineTail:pristine.freezeTailSec,pristineIntensity:pristine.freezeIntensity,orange,orangeBindings};
   })()`,{timeoutMs:30000});
   const lineIds=r.line.map(x=>x.id),lampsIds=r.lamps.map(x=>x.id);
   const seq=['layer.strokeWidth','layer.lineOpacity','layer.strokeColor','layer.opacity','layer.fillOpacity','layer.fillColor','layer.glow','layer.glowIntensity','outline.layerCount','outline.width','outline.color','outline.mode'];
   assert.deepEqual(lineIds.slice(0,seq.length),seq,'line catalog grouping');
   assert.equal(lampsIds.indexOf('lamps.freezeIntensity'),lampsIds.indexOf('lamps.freezeTailSec')+1,'FreezeLight pairs must be adjacent');
   for(const d of r.expected){assert(d.supported,'No Morph support '+d.id);assert(d.audio,'No Audio support '+d.id);assert(d.mainId,'No left-panel binding '+d.id);}
   for(const d of r.controls){assert(d.exists,'No left control '+d.id);assert(d.capable,'No border '+d.id);assert(d.rect>0,'Hidden '+d.id);}
   assert.equal(r.countCases[0].flags.filter(Boolean).length,r.total,'default all');
   assert.deepEqual(r.countCases[1].flags,Array(r.total).fill(false),'zero layers');
   assert.equal(r.countCases[2].flags.filter(Boolean).length,1,'one randomly selected layer');
   assert.equal(r.countCases[3].flags.filter(Boolean).length,r.total,'full coverage');
   assert.equal(r.countByUi,1,'left slider not wired');
   assert.equal(r.blue.count,1);assert.equal(r.blue.tail,6);assert.equal(r.blue.intensity,25);
   assert.equal(r.blue.layers.filter(Boolean).length,1,'Blue must alter random outline coverage');
   assert.equal(r.pristineTail,1.5,'Blue unexpectedly changed authored tail');assert.equal(r.pristineIntensity,100,'Blue unexpectedly changed authored intensity');
   assert.equal(r.orange.count,Math.min(2,r.total));assert.equal(r.orange.tail,7);assert.equal(r.orange.intensity,40);assert.equal(r.orange.layerTail,7);
   for(const id of ['outline.layerCount','lamps.freezeTailSec','lamps.freezeIntensity'])assert(r.orangeBindings.includes(id),'Orange binding '+id);
   assert.deepEqual(uncaughtExceptions(h.events),[]);
   console.log('PASS unified group order, numeric outline coverage, FreezeLight Blue/Orange/Audio metadata + left frame');
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
