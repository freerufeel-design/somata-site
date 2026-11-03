'use strict';
// End-to-end regression: long-press names (including non-range widgets),
// unified routing popup and the real movable profile editor.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const css=fs.readFileSync(path.join(__dirname,'../styles/app.css'),'utf8');
const snap=(h,expr)=>h.evaluate(`JSON.stringify(${expr})`).then(JSON.parse);
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:140,evalTimeoutMs:24000});
 try{
  await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s)})()`,{returnByValue:false});
  const out=[];
  for (const width of [320,390,760]) {
   await h.call('Emulation.setDeviceMetricsOverride',{width,height:780,deviceScaleFactor:1,mobile:true});
   // A long-pressed name (not a range) must enter the existing range focus.
   await h.evaluate(`(()=>{const e=document.querySelector('#paramRadius').closest('.control-row').querySelector('.row-label > span:first-child');e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:400,button:0,clientX:62,clientY:450}))})()`,{returnByValue:false});
   await h.sleep(520);
   const range=await snap(h,`(()=>{const e=id=>document.getElementById(id);return {focus:document.body.classList.contains('mobile-parameter-focus'),routeVisible:getComputedStyle(e('mobileParameterRouting')).display,routeId:e('mobileParameterRouting').disabled,proxy:!!e('mobileParameterRangeSlot').querySelector('input'),docWidth:document.documentElement.scrollWidth}})()`);
   assert(range.focus&&range.proxy,JSON.stringify({width,range}));
   assert.equal(range.routeVisible,'flex',JSON.stringify({width,range}));
   assert(!range.routeId,JSON.stringify({width,range}));
   await h.evaluate(`document.getElementById('mobileParameterRouting').click()`,{returnByValue:false});
   const popup=await snap(h,`(()=>{const e=document.getElementById('parameterRoutingContextMenu');const cs=getComputedStyle(e);return {visible:!e.classList.contains('hidden'),css:cs.visibility,z:cs.zIndex,actions:e.querySelectorAll('.parameter-routing-popup-option').length,title:e.querySelector('strong')?.textContent}})()`);
   assert(popup.visible&&popup.css==='visible'&&popup.actions>=2,JSON.stringify({width,popup}));
   if(width===390){
     const shot=await h.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
     fs.writeFileSync('/mnt/data/Somata_13.1_focus_routing_popup.png',Buffer.from(shot.result.data,'base64'));
   }
   if(width===390){
     const toggles=await snap(h,`(()=>{const e=document.getElementById('parameterRoutingContextMenu');return {blue:!e.querySelector('.routing-morph').disabled,orange:!e.querySelector('.routing-orange').disabled,audio:!e.querySelector('.parameter-routing-target-bubble').disabled}})()`);
     for(const [kind,selector] of [['blue','.routing-morph'],['orange','.routing-orange'],['audio','.parameter-routing-target-bubble']]){
       if(!toggles[kind])continue;
       const before=await snap(h,`(()=>{const b=document.querySelector('${selector}');return b.getAttribute('${kind==='audio'?'aria-pressed':'aria-checked'}')})()`);
       await h.evaluate(`document.querySelector('${selector}').click()`,{returnByValue:false});
       const after=await snap(h,`(()=>{const b=document.querySelector('${selector}');return b.getAttribute('${kind==='audio'?'aria-pressed':'aria-checked'}')})()`);
       assert.notEqual(before,after,JSON.stringify({kind,before,after}));
       await h.evaluate(`document.querySelector('${selector}').click()`,{returnByValue:false});
     }
   }
   await h.evaluate(`document.getElementById('mobileParameterFocusClose').click()`,{returnByValue:false});await h.sleep(280);
   // A non-range checkbox setting is focusable by holding its name.
   await h.evaluate(`(()=>{const span=document.querySelector('.geometry-circles-head label span');span.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:401,button:0,clientX:50,clientY:400}))})()`,{returnByValue:false});
   await h.sleep(530);
   const widget=await snap(h,`(()=>{const slot=document.getElementById('mobileParameterWidgetSlot'),orig=document.getElementById('paramGeometryCircles');return {focus:document.body.classList.contains('mobile-parameter-focus'),copy:!!slot.querySelector('input[type=checkbox]'),hidden:slot.classList.contains('hidden'),originalInSidebar:!!orig.closest('#settingsSidebar'),rangeHidden:document.querySelector('.mobile-parameter-focus-controls').classList.contains('hidden'),routingHidden:document.getElementById('mobileParameterRouting').classList.contains('hidden')}})()`);
   assert(widget.focus&&widget.copy&&!widget.hidden&&widget.originalInSidebar&&widget.rangeHidden,JSON.stringify({width,widget}));
   if(width===390){
     const shot=await h.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
     fs.writeFileSync('/mnt/data/Somata_13.1_focus_checkbox.png',Buffer.from(shot.result.data,'base64'));
   }
   await h.evaluate(`(()=>{const el=document.querySelector('#mobileParameterWidgetSlot input[type="checkbox"]');el.click()})()`,{returnByValue:false});
   const relayed=await snap(h,`({original:document.getElementById('paramGeometryCircles').checked,copy:document.querySelector('#mobileParameterWidgetSlot input[type=checkbox]').checked})`);
   assert.equal(relayed.original,relayed.copy,JSON.stringify({width,relayed}));
   await h.evaluate(`document.getElementById('mobileParameterFocusClose').click()`,{returnByValue:false});await h.sleep(280);
   // The actual profile editor moves into the dock (no canvas cloning).
   await h.evaluate(`(()=>{const e=document.querySelector('#profileSettingsGroup .control-group-title > span');e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:402,button:0,clientX:40,clientY:430}))})()`,{returnByValue:false});
   await h.sleep(550);
   const profile=await snap(h,`(()=>{const s=document.getElementById('mobileParameterProfileSlot'),d=document.querySelector('.mobile-parameter-focus-dock'),r=d.getBoundingClientRect();return {focused:document.body.classList.contains('mobile-parameter-focus'),liveCanvas:!!s.querySelector('#profileCanvas'),modeCount:s.querySelectorAll('.profile-mode-btn').length,profileGroup:!!s.querySelector('#profileSettingsGroup'),routing:!document.getElementById('mobileParameterRouting').classList.contains('hidden'),x:r.x,right:r.right,h:r.height,docWidth:document.documentElement.scrollWidth}})()`);
   assert(profile.focused&&profile.liveCanvas&&profile.modeCount===3&&profile.profileGroup,JSON.stringify({width,profile}));
   assert(profile.routing,JSON.stringify({width,profile}));
   assert(profile.x>=0&&profile.right<=width+1,JSON.stringify({width,profile}));
   await h.evaluate(`document.querySelector('#mobileParameterProfileSlot [data-mode="spline"]').click()`,{returnByValue:false});
   const mode=await snap(h,`({spline:document.querySelector('.profile-mode-btn[data-mode="spline"]').classList.contains('active'),originalCanvasCount:document.querySelectorAll('#profileCanvas').length})`);
   assert(mode.spline && mode.originalCanvasCount===1,JSON.stringify({width,mode}));
   if(width===390){
     const shot=await h.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
     fs.writeFileSync('/mnt/data/Somata_13.1_profile_dock.png',Buffer.from(shot.result.data,'base64'));
   }
   await h.evaluate(`document.getElementById('mobileParameterFocusClose').click()`,{returnByValue:false});await h.sleep(280);
   const restore=await snap(h,`({focused:document.body.classList.contains('mobile-parameter-focus'),restored:!!document.querySelector('#settingsSidebar #profileSettingsGroup #profileCanvas'),slotEmpty:document.getElementById('mobileParameterProfileSlot').children.length===0,docWidth:document.documentElement.scrollWidth})`);
   assert(!restore.focused && restore.restored && restore.slotEmpty,JSON.stringify({width,restore}));
   out.push({width,range,popup,widget,profile,restore});
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS mobile 13.1 long-press widgets + routed sliders + real profile editor',JSON.stringify(out));
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL mobile focus routing/profile:',err.stack||err);process.exitCode=1});
