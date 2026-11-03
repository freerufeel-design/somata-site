'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:180,evalTimeoutMs:50000});
 try{
  const result=await h.evaluate(`(async()=>{
   const layers=Array.from({length:5},(_,i)=>createLayer('Random Outline / Glint '+(i+1)));
   layers.forEach(ensureLayerEffectState);
   state.layers.splice(0,state.layers.length,...layers);
   state.activeLayerId=layers[0].id;
   state.masterLayerEdit=true;state.audioReactive.active=false;
   state.lineOutline={enabled:true,width:1.5,color:'#ffffff',mode:'outer',layerCount:2,selectionSeed:1};
   let sample=null;
   for(let seed=1;seed<1000;seed++){
     state.lineOutline.selectionSeed=seed;
     const flags=state.layers.map((_,i)=>somataOutlineLayerEnabled(i));
     if(flags.slice(0,2).some(x=>!x)||flags.slice(2).some(Boolean)){sample={seed,flags};break;}
   }
   if(!sample)throw Error('Could not find a non-prefix random selection');
   const first=window.__somataOutlineRandomSelection();
   const repeated=Array.from({length:20},()=>state.layers.map((_,i)=>somataOutlineLayerEnabled(i)));
   state.layers.reverse();
   const reordered=window.__somataOutlineRandomSelection();
   state.layers.reverse();
   state.lineOutline.layerCount=0;
   const none=state.layers.map((_,i)=>somataOutlineLayerEnabled(i));
   state.lineOutline.layerCount=5;
   const all=state.layers.map((_,i)=>somataOutlineLayerEnabled(i));
   state.lineOutline.layerCount=3;
   const three=window.__somataOutlineRandomSelection();
   state.lineOutline.layerCount=2;
   const backToTwo=window.__somataOutlineRandomSelection();
   const persisted=JSON.parse(JSON.stringify(state.lineOutline)).selectionSeed;

   for(const layer of state.layers){
      const c=getLayerSweepConfig(layer);normalizeSweepConfig(c);
      c.glintEnabled=true;c.lightningEnabled=false;c.enabled=true;c.effectType='glint';
      c.color='#ffffff';c.haloColor='#000000';layer.lineVisible=false;
   }
   state.showLines=false;
   syncSidebarInputs();syncSweepUI();
   const halo=document.getElementById('sweepHaloColor');
   halo.value='#25c8fa';halo.dispatchEvent(new Event('input',{bubbles:true}));
   const afterHalo=state.layers.map(l=>({core:l.sweep.color,halo:l.sweep.haloColor}));
   // Reproduce an inactive/stale DOM input: changing brightness must not read it.
   halo.value='#000000';
   const bright=document.getElementById('sweepBrightness');bright.value='83';bright.dispatchEvent(new Event('input',{bubbles:true}));
   const afterBrightness=state.layers.map(l=>({halo:l.sweep.haloColor,bright:l.sweep.brightness}));
   const effects=state.layers.map((_,i)=>window.__spiroEffectsPlanSnapshot(i));
   const uiHalo=document.getElementById('sweepHaloColor').value;
   return {first,repeated,reordered,none,all,three,backToTwo,persisted,afterHalo,afterBrightness,effects,uiHalo};
  })()`,{timeoutMs:50000});
  assert.equal(result.first.count,2);
  assert.equal(result.first.selected.length,2);
  assert(result.repeated.every(flags=>flags.filter(Boolean).length===2),'random selection changes N across frames');
  assert(result.repeated.every(flags=>flags.every((v,i)=>v===result.repeated[0][i])),'selection flickers during render');
  assert.deepEqual(result.first.selected,result.reordered.selected,'reordering layers changed IDs in random subset');
  assert(result.none.every(v=>v===false),'0 must mean none');
  assert(result.all.every(v=>v===true),'all count must include all');
  assert.equal(result.three.selected.length,3);
  assert(result.first.selected.every(id=>result.three.selected.includes(id)),'changing N must preserve stable random shuffle');
  assert.deepEqual(result.first.selected,result.backToTwo.selected,'repeated N must restore same subset');
  assert.equal(result.persisted,result.first.seed,'project must persist random seed');
  for(const v of result.afterHalo){assert.equal(v.halo,'#25c8fa');assert.equal(v.core,'#ffffff');}
  for(const v of result.afterBrightness){assert.equal(v.halo,'#25c8fa','unrelated UI slider overwrote halo color');assert.equal(v.bright,83);}
  assert.equal(result.uiHalo,'#25c8fa','UI halo swatch does not reflect authored color');
  for(const e of result.effects){assert.equal(e.base,false,'hidden base line appeared');assert.equal(e.sweep,true,'hidden base line suppressed Glint layer '+e.layerId);}
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS random stable N-of-layers selection, persisted seed, independent halo colors, hidden base / live Glint on 5 layers');
 }finally{await h.close();}
})().catch(err=>{console.error(err.stack||err);process.exitCode=1;});
