'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:180,evalTimeoutMs:30000});
 try{
  const result=await h.evaluate(`(async()=>{
   const layer=state.layers.find(l=>l.id===state.activeLayerId);
   const original={...layer, testMorph:layer.testMorph&&{...layer.testMorph}};
   const originalTunnel={...state.tunnel};
   if(state.tunnel.active)setTunnelMode(false,{silent:true});
   Object.assign(layer,{spiralEnabled:true,spiralOrder:2,spiralClosed:true,closedLoop:false,
    testMorph:{enabled:true,duration:.6,mode:'circleSlide',spiralType:'phaseCircle'}});
   const startOrder=layer.spiralOrder;
   state.tunnel.speedStrength=0;
   document.getElementById('btnTunnel').click();
   const start=__somataCorridorEntranceStatus();
   const first=getTunnelCopies();
   const startVisible=first.filter(c=>Number(c.alpha)>0.00001).map(c=>({scale:c.scale,alpha:c.alpha}));
   const staged={layer:SomataRenderLayerSnapshot.create(layer)};
   __somataApplyCorridorEntranceLayer(staged,performance.now()+start.durationMs*.21);
   const inFold=staged.layer.spiralOrder;
   const during={layer:SomataRenderLayerSnapshot.create(layer)};
   __somataApplyCorridorEntranceLayer(during,performance.now()+start.durationMs*.73);
   const folded=during.layer.spiralOrder;
   await new Promise(resolve=>setTimeout(resolve,720));
   const end=__somataCorridorEntranceStatus();
   const copies=getTunnelCopies();
   const spread=copies.some(c=>c.scale<.8)&&copies.some(c=>c.scale>1.2);
   const endLayer={layer:SomataRenderLayerSnapshot.create(layer)};
   __somataApplyCorridorEntranceLayer(endLayer,performance.now());
   const foldEnd=endLayer.layer.spiralOrder;
   const preserved=layer.spiralOrder;
   document.getElementById('btnTunnel').click();
   const leaving=__somataCorridorEntranceStatus();
   await new Promise(resolve=>setTimeout(resolve,720));
   return {leaving,start,startVisible,inFold,folded,foldEnd,preserved,startOrder,end,spread,normalActive:state.tunnel.active};
  })()`,{timeoutMs:29000});
  assert(result.start.durationMs===600,'transition duration from animation config');
  assert(result.start.hasFold===false,'Corridor ON must NOT fold the Spiral');
  assert(result.startVisible.length===1,'entrance must start as one source figure, got '+JSON.stringify(result.startVisible));
  assert(Math.abs(result.startVisible[0].scale-1)<1e-6,'source scale is not 1');
  assert.equal(result.inFold,2,'ordinary Corridor entry must retain spiral order');
  assert.equal(result.folded,2,'entry must keep spiral order while copies populate');
  assert.equal(result.foldEnd,2,'after entry the Spiral must stay active');
  assert(result.preserved===2,'authored spiral order was changed');
  assert(result.spread,'corridor population did not reach large/small copies');
  assert.equal(result.leaving.direction,'out','exit must reverse Corridor');
  assert(!result.normalActive,'corridor was not disabled after exit animation');
  assert.equal(uncaughtExceptions(h.events).length,0,'browser exception');
  console.log('PASS: direct Spiral Corridor entry, copy population and authored order unchanged');
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
