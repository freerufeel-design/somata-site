'use strict';
// Regression: source fill metadata is computed once per layer without
// changing legacy alpha, harmony or selected-fill semantics.
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:180,evalTimeoutMs:18000});
 try{
  const records=await h.evaluate(`(async()=>{
   const original=state.layers[0];
   const inputs=[
    {fill:true, closedLoop:true, strokeColor:'#113355',fillColor:'#ff000080'},
    {fill:true, closedLoop:false,strokeColor:'#abcdef',fillColor:'#33aa66ff'},
    {fill:false,closedLoop:true,strokeColor:'#abcdef',fillColor:'#01234520'},
    {fill:true, closedLoop:true, strokeColor:'#606060',fillColor:null},
    {fill:true, closedLoop:true, strokeColor:'#0400ff',fillColor:'#ffdd4420'},
    {fill:false,closedLoop:false,strokeColor:'#abcdef',fillColor:'#ffaa0088'}
   ];
   state.layers=inputs.map((c,i)=>({...original,...c,id:'qa-1048-'+i,name:'QA '+i,
    profileNodes:[{x:0,y:0},{x:1,y:0},{x:0,y:1}],profileMode:'segments',spiralEnabled:false}));
   state.activeLayerId=state.layers[0].id;
   state.morph.mode='circleSlide';
   state.morph.monoOrbitTransforms=false;
   state.morph.options.byShape=false;
   state.morph.options.bySpiralLayers=false;
   state.morph.options.bySpiralOrder=false;
   state.morph.options.byFillColor=true;
   state.morph.fillLayersMax=2;
   state.morph.intervalSec=15;
   const modeSelect=document.getElementById('morphMode');if(modeSelect)modeSelect.value='circleSlide';
   const output=[];
   for(const harmony of ['native','complementary','native']){
    state.layers=inputs.map((c,i)=>({...original,...c,id:'qa-1048-'+i,name:'QA '+i,
     profileNodes:[{x:0,y:0},{x:1,y:0},{x:0,y:1}],profileMode:'segments',spiralEnabled:false}));
    state.activeLayerId=state.layers[0].id;
    state.morph.fillHueHarmony=harmony;
    let seed=42;Math.random=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/4294967296);
    document.getElementById('btnMorph').click();
    await new Promise(r=>setTimeout(r,85));
    if(!runtimeState.morph.active)throw Error('Morph did not start');
    const rt=runtimeState.morph;
    output.push({harmony,sourceFillIndices:[...rt.sourceFillIndices],source:rt.sourceVisuals.map(x=>({
       strokeColor:x.strokeColor,fillColor:x.fillColor,fillOpacity:x.fillOpacity,
       fillHueOffset:x.fillHueOffset,fill:x.fill,closedLoop:x.closedLoop
    }))});
    document.getElementById('btnMorph').click();
    if(runtimeState.morph.active)throw Error('Morph did not stop');
   }
   return output;
  })()`,{timeoutMs:18000});
  assert.equal(records.length,3);
  records.forEach(r=>{
   assert.deepEqual(r.sourceFillIndices,[0,3]);
   assert.equal(r.source.length,6);
   assert.deepEqual(r.source.map(s=>s.fill),[true,false,false,true,false,false]);
   assert(r.source.every(s=>Number.isFinite(s.fillOpacity)&&Number.isFinite(s.fillHueOffset)));
  });
  assert.deepEqual(records[0].source,records[2].source,'Native harmony source changed across restart');
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  if(process.env.SOMATA_PARITY_SNAPSHOT==='1')process.stdout.write('SNAPSHOT:'+JSON.stringify(records)+'\n');
  console.log('PASS Somata 10.4.8 Morph fill preparation and selection parity');
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL',err.stack||err);process.exitCode=1;});
