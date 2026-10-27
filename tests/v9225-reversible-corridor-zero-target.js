'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:160,evalTimeoutMs:16000});
 try{
  const r=await h.evaluate(`(async()=>{
   const layer=state.layers.find(l=>l.id===state.activeLayerId);
   if(state.tunnel.active)setTunnelMode(false,{silent:true});
   const original={spiralEnabled:layer.spiralEnabled,spiralOrder:layer.spiralOrder,testMorph:layer.testMorph&&{...layer.testMorph}};
   layer.spiralEnabled=true;layer.spiralOrder=3;
   // Unspecified testMorph: animation is ON by default.
   delete layer.testMorph;
   const defaultOn=SomataTestMorph.config(layer).enabled;
   document.getElementById('btnTunnel').click();
   const entered=__somataCorridorEntranceStatus();
   const inEarly={layer:SomataRenderLayerSnapshot.create(layer)};
   __somataApplyCorridorEntranceLayer(inEarly,performance.now()+entered.durationMs*.20);
   const orderEarly=inEarly.layer.spiralOrder;
   await new Promise(r=>setTimeout(r,1200));
   const during=__somataCorridorEntranceStatus();
   document.getElementById('btnTunnel').click();
   const exit=__somataCorridorEntranceStatus();
   const isResidentDuringExit=state.tunnel.active;
   const buttonRequestedOff=document.getElementById('btnTunnel').getAttribute('aria-pressed');
   // Numerical tests of both halves, using the live scheduler's animation clock.
   const anchor=performance.now();
   const collapsing={layer:SomataRenderLayerSnapshot.create(layer)};
   __somataApplyCorridorEntranceLayer(collapsing,anchor+exit.durationMs*.25);
   const popCopies=getTunnelCopies().filter(x=>x.alpha>.001).length;
   const unfolded={layer:SomataRenderLayerSnapshot.create(layer)};
   __somataApplyCorridorEntranceLayer(unfolded,anchor+exit.durationMs*.85);
   await new Promise(r=>setTimeout(r,1250));
   const exitEnd=__somataCorridorEntranceStatus();
   const disabled=state.tunnel.active;
   const authored=layer.spiralOrder;
   // Spiral -> Spiral with a phase crossing through order zero is not a Corridor endpoint.
   const before=state.tunnel.active;
   runtimeState.morph.active=true;
   layer.spiralOrder=-2;
   setTunnelMode(true);
   const blueMorph=__somataCorridorEntranceStatus();
   setTunnelMode(false,{silent:true});
   runtimeState.morph.active=false;
   Object.assign(layer,{spiralEnabled:original.spiralEnabled,spiralOrder:original.spiralOrder});
   if(original.testMorph===undefined)delete layer.testMorph;else layer.testMorph=original.testMorph;
   return {defaultOn,entered,orderEarly,during,exit,isResidentDuringExit,buttonRequestedOff,
      collapseOrder:collapsing.layer.spiralOrder,popCopies,unfoldedOrder:unfolded.layer.spiralOrder,
      disabled,authored,exitEnd,before,blueMorph};
  })()`,{timeoutMs:15000});
  assert(r.defaultOn,'new layers default to animation on');
  assert.equal(r.entered.direction,'in');assert.equal(r.entered.hasFold,false);
  assert.equal(r.orderEarly,3,'direct entry must keep Spiral order');
  assert.equal(r.exit.direction,'out');assert(r.isResidentDuringExit);
  assert.equal(r.buttonRequestedOff,'false');
  assert.equal(r.collapseOrder,3,'exit must collapse copies without switching Spiral mode');
  assert.equal(r.unfoldedOrder,3,'exit must leave Spiral order unchanged');
  assert.equal(r.disabled,false,'tunnel disabled only after exit completes');
  assert.equal(r.authored,3,'authored spiral order unchanged');
  assert.equal(r.blueMorph.direction,'idle','Blue Morph must never activate Corridor population through zero');
  assert.equal(uncaughtExceptions(h.events).length,0,'browser exceptions');
  console.log('PASS reversible Corridor entry/exit without spiral reset + default animation',JSON.stringify(r));
 }finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
