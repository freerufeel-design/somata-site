'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:24000});
try{
 const data=await h.evaluate(`(()=>{
   const out={};const base=createLayer('v1310-default-focus');
   out.defaultFocus=base.spiralManualFocus===false&&base.spiralRotationFocusFigure===7;
   out.domSpiralDefault=document.getElementById('paramSpiralRotationFocus')?.defaultValue;
   out.domCorridorDefault=document.getElementById('tunnelFocusNumber')?.defaultValue;
   out.matrix=[];
   state.tunnel.active=true;state.tunnel.centerHiddenCopies=2;
   const modes=[['phaseCircle',12,1,16,6],['phase',12,1,12,5],['minimalTurn',12,3,16,3],['continuous',12,3,12,3]];
   for(const [mode,sn,sk,dn,dk] of modes)for(const closed of [true,false]){
     state.morph.mode='circleSlide';state.morph.spiralMorphType=mode;
     const layer=createLayer('v1310-'+mode+'-'+closed);
     Object.assign(layer,{spiralEnabled:true,spiralClosed:closed,spiralOrder:2,spiralRotationFocus:4,spiralManualFocus:true,N:sn,K:sk,spiralStep:sk,spiralStepLinked:true,rotation:0,corridorFocusHighlight:true});
     layer.__somataFocusFrame={position:3}; // explicit fourth-slot fixture independent of viewport
     const target={...layer,N:dn,K:dk,spiralStep:dk};
     state.layers=[layer];state.activeLayerId=layer.id;
     runtimeState.morph.active=true;
     runtimeState.morph.renderSourceLayers=[layer];runtimeState.morph.renderTargetLayers=[target];
     const samples=[];
     for(const t of [0,.1,.25,.5,.75,.9,1]){
       runtimeState.morph.geometryT=t;runtimeState.morph.progress=t;
       const p=SomataCorridorFocus.focusPosition(layer);
       const angles=[p-1,p,p+1].map(pos=>getMotionTunnelLagRadians({position:pos,copyId:pos-10},layer));
       const d=__spiroCurrentSpiralMorphCorridorDelta(layer);
       const anchor=__spiroGetSpiralCarrierSpec(layer,0)?.anchor;
       const a=Math.atan2(anchor.y,anchor.x)+angles[1];
       samples.push({t,p,angle:angles[1],a,d,spacingLeft:angles[1]-angles[0],spacingRight:angles[2]-angles[1],highlight:SomataCorridorFocus.strength({position:p},layer)});
     }
     runtimeState.morph.active=false;
     Object.assign(layer,{N:dn,K:dk,spiralStep:dk});
     const p=SomataCorridorFocus.focusPosition(layer);
     const after=getMotionTunnelLagRadians({position:p,copyId:-100},layer);
     out.matrix.push({mode,closed,samples,after});
   }
   // Verify physical-focus source is independent of recycling copy ID and center shade setting.
   const focusLayer=state.layers[0];focusLayer.spiralRotationFocus=4;
   out.recycle=[-20,0,1,10,23].map(copyId=>getMotionTunnelLagRadians({position:3,copyId},focusLayer));
   out.hidden=[];
   for(const count of [0,1,2,3,6]){
       state.tunnel.centerHiddenCopies=count;
       focusLayer.__somataFocusFrame={position:(count>0?count-2:-2)+3};
       const p=SomataCorridorFocus.focusPosition(focusLayer);
       out.hidden.push({count,p,angle:getMotionTunnelLagRadians({position:p,copyId:777},focusLayer),highlight:SomataCorridorFocus.strength({position:p},focusLayer)});
   }
   state.tunnel.centerHiddenCopies=2;focusLayer.__somataFocusFrame={position:3};
   const corridor=state.tunnel;const oldTravel=corridor.travelPhase;
   out.travel=[];
   for(const travel of [0,.2,.49,.99,1.01,1.49,1.99,2.01,5.99,6.01]){
     corridor.travelPhase=travel;
     const copies=getTunnelCopies(),center=SomataCorridorFocus.focusPosition(focusLayer);
     const actual=copies.reduce((a,b)=>Math.abs(b.position-center)<Math.abs(a.position-center)?b:a,copies[0]);
     const d=2*Math.PI*(focusLayer.spiralStep/focusLayer.N);
     const ang=getMotionTunnelLagRadians(actual,focusLayer);
     out.travel.push({travel,position:actual.position,id:actual.copyId,angle:ang,expected:(actual.position-center)*d,highlight:SomataCorridorFocus.strength(actual,focusLayer)});
   }
   corridor.travelPhase=oldTravel;
   return out;
 })()`,{label:'spatial focus real phase and highlight sync',timeoutMs:24000});
 assert.equal(data.defaultFocus,true,'automatic fixed figure #7 is the default');
 assert.equal(data.domSpiralDefault,'7');assert.equal(data.domCorridorDefault,'7');
 for(const {mode,closed,samples,after} of data.matrix){
   const base=samples[0].a;
   for(const s of samples){
     assert.ok(Math.abs(s.angle)<1e-10,`${mode}/${closed} pivot angle at t=${s.t}: ${s.angle}`);
     assert.ok(Math.abs(s.a-base)<1e-10,`${mode}/${closed} first carrier anchor rotated at t=${s.t}: ${s.a-base}`);
     assert.ok(Math.abs(s.spacingLeft-s.d)<1e-10,`${mode}/${closed} left seam t=${s.t}`);
     assert.ok(Math.abs(s.spacingRight-s.d)<1e-10,`${mode}/${closed} right seam t=${s.t}`);
     assert.equal(s.highlight,1,`${mode}/${closed} highlighted same focus`);
   }
   assert.ok(Math.abs(after)<1e-10,`${mode}/${closed} static handoff rotated`);
 }
 assert.ok(data.recycle.every(v=>Math.abs(v)<1e-10),'changing copyId cannot move physical focus');
 for(const s of data.hidden){assert.ok(Math.abs(s.angle)<1e-10,`hidden ${s.count}`);assert.equal(s.highlight,1);}
 for(const s of data.travel){
     assert.ok(Math.abs(s.angle-s.expected)<1e-10,`real getTunnelCopies phase=${s.travel}: ${s.angle} vs ${s.expected}`);
     assert.ok(s.highlight>.5,`real highlight should remain centered near phase=${s.travel}`);
 }
 assert.equal(uncaughtExceptions(h.events).length,0,'browser exceptions');
 console.log('PASS v13.0.10: spatial focus=4, 8 N/K mode and open/closed variants, 7 phase samples each, 5 hidden center modes, copyId recycling, real first carrier anchor stability and exact inter-copy phase');
}finally{await h.close();}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
