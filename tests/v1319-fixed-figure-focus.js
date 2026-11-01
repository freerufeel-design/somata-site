'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:100,evalTimeoutMs:20000});
 try{
   const data=await h.evaluate(`(()=>{
     const l=createLayer('focus-figure-v1319');
     state.layers=[l];state.activeLayerId=l.id;
     state.tunnel.active=true;
     state.tunnel.centerHiddenCopies=2;
     state.tunnel.copies=10;
     Object.assign(l,{spiralEnabled:true,spiralOrder:2,N:12,K:3,spiralStep:3});
     const copies=getTunnelCopies();
     const out={defaults:{manual:l.spiralManualFocus,figure:l.spiralRotationFocusFigure,route:!!SomataParameterRegistry.get('spiral.focusFigure')}};
     out.stable=[8,9,12,8,9].map(total=>{
       const f=SomataCorridorFocus.resolveFrame(l,copies,100,1,450,state.tunnel,{total});
       return {total,index:f.index,figure:f.figure,position:f.position,angle:getMotionTunnelLagRadians({position:6,copyId:99},l)};
     });
     l.spiralManualFocus=true;l.spiralRotationFocusFigure=3;
     out.manual=[8,9,12].map(total=>{
       const f=SomataCorridorFocus.resolveFrame(l,copies,100,1,450,state.tunnel,{total});
       return {total,figure:f.figure,position:f.position};
     });
     l.spiralRotationFocusFigure=11;
     out.shrink=[5,8,11,12].map(total=>{
       const f=SomataCorridorFocus.resolveFrame(l,copies,100,1,450,state.tunnel,{total});
       return {total,figure:f.figure,saved:l.spiralRotationFocusFigure};
     });
     l.spiralRotationFocusFigure=7;
     syncSidebarInputs();
     const s=document.getElementById('paramSpiralRotationFocus');
     // Real user moves the absolute-index slider, mirrored to Corridor.
     s.max='12';s.value='9';s.dispatchEvent(new Event('input',{bubbles:true}));
     out.ui={figure:l.spiralRotationFocusFigure,mirror:document.getElementById('tunnelFocusNumber').value,
        label:document.getElementById('spiralFocusPercentText').textContent,
        min:s.min,max:s.max,step:s.step};
     const def=SomataParameterRegistry.get('spiral.focusFigure');
     out.route={min:def.min,max:def.max,field:def.morph.framePath};
     const loaded=typeof normalizeProjectLayer==='function'?normalizeProjectLayer({...l,spiralRotationFocusFigure:undefined,spiralRotationFocusPercent:66}):null;
     out.legacy=loaded?.spiralRotationFocusFigure ?? createLayer('legacy-fallback').spiralRotationFocusFigure;
     return out;
   })()`,{timeoutMs:20000});
   assert.deepEqual(data.defaults,{manual:false,figure:7,route:true});
   assert(data.stable.every(x=>x.figure===7&&x.position===4),'automatic focus must remain at #7 across population changes');
   assert(data.stable.every(x=>Math.abs(x.angle-data.stable[0].angle)<1e-12),'spiral angle must not jump when population changes');
   assert(data.manual.every(x=>x.figure===3&&x.position===0),'manual figure #3 must remain physically fixed');
   assert.deepEqual(data.shrink.map(x=>x.figure),[5,8,11,11]);
   assert(data.shrink.every(x=>x.saved===11),'must preserve configured focus even when count shrinks');
   assert.deepEqual(data.ui,{figure:9,mirror:'9',label:'№9',min:'1',max:'12',step:'1'});
   assert.deepEqual(data.route,{min:1,max:256,field:'spiralRotationFocusFigure'});
   assert.equal(data.legacy,7,'older percent profiles must not become figure #66');
   assert.equal(uncaughtExceptions(h.events).length,0);
   console.log('PASS fixed 1-based focus #7, no 8→9 jump, manual index, dynamic clamp, UI, legacy fallback');
 } finally {await h.close()}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
