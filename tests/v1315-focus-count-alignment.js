'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:85,evalTimeoutMs:15000});
 try{
  const samples=await h.evaluate(`(()=>{
   const layer=createLayer('focus-1315');state.layers=[layer];state.activeLayerId=layer.id;
   state.tunnel.active=true;state.tunnel.centerHiddenCopies=2;state.tunnel.copies=10;
   layer.spiralEnabled=true;layer.spiralOrder=1;layer.spiralManualFocus=true;
   const out=[];
   for(const travel of [0,.25,.5,.75,.99,1.01,1.5,2.25]){
     state.tunnel.travelPhase=travel;
     const copies=getTunnelCopies().map(c=>({...c}));
     const visible=prepareTunnelVisibleInstances(copies,100,1,450,1,layer.id);
     const p=SomataCorridorFocus.population(visible.copies,100,1,450,state.tunnel,layer);
     for(const target of [1,5,7,p.total,p.total+5]){
       layer.spiralRotationFocusFigure=target;
       const focus=SomataCorridorFocus.resolveFrame(layer,copies,100,1,450,state.tunnel,p);
       out.push({travel,target,p,focus,highlight:SomataCorridorFocus.strength({position:focus.position},{...layer,corridorFocusHighlight:true})});
     }
   }
   return out;
  })()`,{timeoutMs:15000});
  for(const s of samples){
   assert.equal(s.focus.total,s.p.total,'Focus must use EXACT displayed population');
   assert.equal(s.focus.maxIndex,s.p.total-1,'all currently counted figures selectable');
   assert.equal(s.focus.figure,Math.min(s.target,s.p.total),'focus is absolute, clamped only by population');
   assert.equal(s.focus.position,-2+s.focus.figure-1,'physical Corridor position counts hidden central copies');
   assert(s.highlight>.999,'focus highlighting and angular pivot agree');
  }
  assert(samples.some(s=>s.p.total>=7),'scenario should exercise figure #7');
  console.log('PASS 1..total focus range, same count as UI, outermost figure selectable, correct pivot/highlight');
 } finally {await h.close()}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
