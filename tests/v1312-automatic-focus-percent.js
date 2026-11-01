'use strict';
const assert=require('node:assert/strict');
const {createBrowserHarness}=require('./lib/browser-harness');
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:90,evalTimeoutMs:30000});
 try{
  const data=await h.evaluate(`(()=>{
   const layer=createLayer('focus-1312');state.layers=[layer];state.activeLayerId=layer.id;
   state.tunnel.active=true;state.tunnel.centerHiddenCopies=2;
   layer.spiralEnabled=true;layer.spiralOrder=2;layer.spiralStep=3;layer.N=12;layer.K=3;
   const out={defaults:{manual:layer.spiralManualFocus,figure:layer.spiralRotationFocusFigure,
       slider:document.getElementById('paramSpiralRotationFocus').type,
       hidden:document.getElementById('spiralManualFocusControls').classList.contains('hidden'),
       route:!!SomataParameterRegistry.get('spiral.focusFigure')}};
   out.positions=[];
   for(const travel of [0,.01,.21,.49,.75,.99,1.01,1.5,1.99,2.01,3.98]){
     state.tunnel.travelPhase=travel;
     const focus=SomataCorridorFocus.resolveFrame(layer,getTunnelCopies(),120,1,350,state.tunnel,{total:12});
     out.positions.push({travel,figure:focus.figure,position:focus.position});
   }
   layer.spiralManualFocus=true;
   out.manual=[];
   for(const figure of [1,2,4,7,9,12]){
     layer.spiralRotationFocusFigure=figure;
     const f=SomataCorridorFocus.resolveFrame(layer,getTunnelCopies(),120,1,350,state.tunnel,{total:12});
     out.manual.push({figure:f.figure,index:f.index,highlight:SomataCorridorFocus.strength({position:f.position},{...layer,corridorFocusHighlight:true})});
   }
   layer.spiralRotationFocusFigure=7;layer.spiralManualFocus=false;syncSidebarInputs();
   const checkbox=document.getElementById('paramSpiralManualFocus');checkbox.checked=true;checkbox.dispatchEvent(new Event('change',{bubbles:true}));
   const slider=document.getElementById('paramSpiralRotationFocus'),other=document.getElementById('tunnelFocusNumber');
   slider.max='12';other.max='12';slider.value='9';slider.dispatchEvent(new Event('input',{bubbles:true}));
   out.ui={manual:layer.spiralManualFocus,figure:layer.spiralRotationFocusFigure,tunnelChecked:document.getElementById('tunnelManualFocus').checked,
      tunnelValue:other.value,spiralHidden:document.getElementById('spiralManualFocusControls').classList.contains('hidden'),
      tunnelHidden:document.getElementById('tunnelManualFocusControls').classList.contains('hidden')};
   const route=SomataParameterRegistry.get('spiral.focusFigure');
   out.route={id:route?.id,min:route?.min,max:route?.max,scope:route?.scope,framePath:route?.morph?.framePath,target:route?.morph?.frameTarget};
   state.morph.activeProfileId='standard';
   slider.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,button:2,clientX:150,clientY:150}));
   const popup=document.getElementById('parameterRoutingContextMenu');
   out.popup={open:!!popup&&!popup.classList.contains('hidden'),text:popup?.querySelector('.parameter-routing-popup-title strong')?.textContent,
      blue:!!popup?.querySelector('.routing-morph')};
   const normalized=typeof normalizeProjectLayer==='function'?normalizeProjectLayer({...layer}):null;
   out.persist=normalized?{manual:normalized.spiralManualFocus,figure:normalized.spiralRotationFocusFigure}:null;
   return out;
  })()`,{timeoutMs:30000});
  assert.deepEqual(data.defaults,{manual:false,figure:7,slider:'range',hidden:true,route:true});
  assert(data.positions.every(p=>p.figure===7&&p.position===4),'automatic focus must remain fixed through Corridor travel');
  for(const p of data.manual){assert.equal(p.index,p.figure-1);assert.equal(p.highlight,1)}
  assert.deepEqual(data.ui,{manual:true,figure:9,tunnelChecked:true,tunnelValue:'9',spiralHidden:false,tunnelHidden:false});
  assert.deepEqual(data.route,{id:'spiral.focusFigure',min:1,max:256,scope:'layer',framePath:'spiralRotationFocusFigure',target:'layer'});
  assert.deepEqual(data.popup,{open:true,text:'Номер фигуры фокуса',blue:true});
  if(data.persist)assert.deepEqual(data.persist,{manual:true,figure:9});
  console.log('PASS fixed absolute Corridor focus #7, integer slider 1..total, UI and routing');
 } finally {await h.close()}
})().catch(e=>{console.error(e.stack||e);process.exitCode=1});
