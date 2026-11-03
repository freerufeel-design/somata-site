'use strict';
// 13.1.2 mobile profile touch gestures and compact dropdown, no GPU required.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const css=fs.readFileSync(path.join(__dirname,'../styles/app.css'),'utf8');
const q=async(h,expr)=>JSON.parse(await h.evaluate(`JSON.stringify(${expr})`));
(async()=>{
 const h=await createBrowserHarness({disableGpu:true,loadDelayMs:150,evalTimeoutMs:25000});
 try {
  await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
  await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.append(s)})()`,{returnByValue:false});
  const tests=[];
  for(const width of [320,390,760]) {
   await h.call('Emulation.setDeviceMetricsOverride',{width,height:820,deviceScaleFactor:1,mobile:true});
   await h.evaluate(`(()=>{const el=document.querySelector('#profileSettingsGroup .control-group-title > span');el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:892,button:0,clientX:50,clientY:460}));})()`,{returnByValue:false});
   await h.sleep(515);
   const initial=await q(h,`(()=>{const d=document.querySelector('.mobile-parameter-focus-dock');const slot=document.getElementById('mobileParameterProfileSlot');const tabs=document.getElementById('profileLibraryTabs');const toggle=slot.querySelector('.mobile-profile-library-toggle');const buttons=[...slot.querySelectorAll('.profile-mode-btn')];const rects=buttons.map(b=>b.getBoundingClientRect().width);return {focus:document.body.classList.contains('mobile-parameter-focus'),dockHeight:d.getBoundingClientRect().height,slotHeight:slot.getBoundingClientRect().height,dockWidth:d.getBoundingClientRect().width,docWidth:document.documentElement.scrollWidth,toggle:toggle?.textContent,tabsClosed:getComputedStyle(tabs).display==='none',sameWidth:Math.max(...rects)-Math.min(...rects)<1,canvasHeight:document.getElementById('profileCanvas').getBoundingClientRect().height}})()`);
   assert(initial.focus&&initial.tabsClosed&&initial.sameWidth,JSON.stringify({width,initial}));
   assert(initial.dockHeight<=Math.min(820*.42,340)+2,JSON.stringify({width,initial}));
   assert(initial.docWidth<=width,JSON.stringify({width,initial}));
   await h.evaluate(`document.querySelector('.mobile-profile-library-toggle').click()`,{returnByValue:false});
   const dropdown=await q(h,`(()=>{const t=document.getElementById('profileLibraryTabs');const c=t.querySelectorAll('[data-morph-profile-group]');return {display:getComputedStyle(t).display,count:c.length,checked:[...c].filter(e=>e.checked).length,expanded:document.querySelector('.mobile-profile-library-toggle').getAttribute('aria-expanded')}})()`);
   assert(dropdown.display==='grid'&&dropdown.count===5&&dropdown.checked>=1&&dropdown.expanded==='true',JSON.stringify({width,dropdown}));
   // Checking a Morph group is independent of browsing it and must not
   // dismiss the dropdown before the other checkboxes can be selected.
   const wasChecked=await q(h,`document.querySelector('[data-morph-profile-group="closed"]').checked`);
   await h.evaluate(`document.querySelector('[data-morph-profile-group="closed"]').click()`,{returnByValue:false});
   const checkChanged=await q(h,`({checked:document.querySelector('[data-morph-profile-group="closed"]').checked,open:document.querySelector('.mobile-profile-library-toggle').getAttribute('aria-expanded')})`);
   assert(checkChanged.checked!==wasChecked&&checkChanged.open==='true',JSON.stringify({width,checkChanged}));
   await h.evaluate(`document.querySelector('[data-morph-profile-group="closed"]').click()`,{returnByValue:false});
   await h.evaluate(`document.querySelector('#profileLibraryTabs [data-profile-group="closed"]').click()`,{returnByValue:false});
   await h.sleep(30);
   const afterSelect=await q(h,`({name:document.querySelector('.mobile-profile-library-toggle').textContent,closed:getComputedStyle(document.getElementById('profileLibraryTabs')).display==='none'})`);
   assert(afterSelect.name.includes('Замкнутые')&&afterSelect.closed,JSON.stringify({width,afterSelect}));
   // Reset to two nodes, and single-tap the visible line in the middle.
   await h.evaluate(`document.getElementById('btnResetProfile').click()`,{returnByValue:false});
   await h.evaluate(`(()=>{window.__touchProfile=(type,x,y,id=1)=>{const c=document.getElementById('profileCanvas');const t=new Touch({identifier:id,target:c,clientX:x,clientY:y});c.dispatchEvent(new TouchEvent(type,{bubbles:true,cancelable:true,touches:type==='touchend'||type==='touchcancel'?[]:[t],targetTouches:type==='touchend'||type==='touchcancel'?[]:[t],changedTouches:[t]}));};window.__profileXY=p=>{const c=document.getElementById('profileCanvas'),rect=c.getBoundingClientRect(),coord=profileToCanvasCoords(p,c.width,c.height);return {x:rect.left+coord.x*rect.width/c.width,y:rect.top+coord.y*rect.height/c.height}}})()`,{returnByValue:false});
   await h.evaluate(`(()=>{const p=__profileXY({x:.5,y:0});__touchProfile('touchstart',p.x,p.y);__touchProfile('touchend',p.x,p.y)})()`,{returnByValue:false});
   const inserted=await q(h,`(()=>{const n=state.layers.find(l=>l.id===state.activeLayerId).profileNodes;return {length:n.length,x:n[1]?.x,y:n[1]?.y}})()`);
   assert.equal(inserted.length,3,JSON.stringify({width,inserted}));
   assert(Math.abs(inserted.x-.5)<.08,JSON.stringify({width,inserted}));
   // Drag point by finger, starting at the inserted mid-node.
   await h.evaluate(`(()=>{const n=state.layers.find(l=>l.id===state.activeLayerId).profileNodes[1];const p=__profileXY(n);__touchProfile('touchstart',p.x,p.y);__touchProfile('touchmove',p.x+8,p.y-26);__touchProfile('touchend',p.x+8,p.y-26)})()`,{returnByValue:false});
   const moved=await q(h,`(()=>{const n=state.layers.find(l=>l.id===state.activeLayerId).profileNodes;return {length:n.length,y:n[1]?.y}})()`);
   assert(moved.length===3&&Math.abs(moved.y)>0.1,JSON.stringify({width,moved}));
   // Long stationary press on the SAME point deletes it (never while moving).
   await h.evaluate(`(()=>{const n=state.layers.find(l=>l.id===state.activeLayerId).profileNodes[1],p=__profileXY(n);window.__holdXY=p;__touchProfile('touchstart',p.x,p.y)})()`,{returnByValue:false});
   await h.sleep(605);
   await h.evaluate(`__touchProfile('touchend',__holdXY.x,__holdXY.y)`,{returnByValue:false});
   const deleted=await q(h,`state.layers.find(l=>l.id===state.activeLayerId).profileNodes.length`);
   assert.equal(deleted,2,JSON.stringify({width,deleted}));
   // Long press, THEN move -> 20% opacity, no delete, returns on release.
   await h.evaluate(`(()=>{const p=__profileXY({x:0,y:0});window.__holdDragXY=p;__touchProfile('touchstart',p.x,p.y)})()`,{returnByValue:false});
   await h.sleep(600);
   await h.evaluate(`__touchProfile('touchmove',__holdDragXY.x+20,__holdDragXY.y-25)`,{returnByValue:false});
   await h.sleep(160);
   const dragging=await q(h,`(()=>{const o=document.getElementById('mobileParameterFocusOverlay');return {peek:o.classList.contains('mobile-profile-drag-peek'),opacity:getComputedStyle(o.querySelector('.mobile-parameter-focus-dock')).opacity,nodes:state.layers.find(l=>l.id===state.activeLayerId).profileNodes.length}})()`);
   assert(dragging.peek&&Number(dragging.opacity)<.25&&dragging.nodes===2,JSON.stringify({width,dragging}));
   await h.evaluate(`__touchProfile('touchend',__holdDragXY.x+20,__holdDragXY.y-25)`,{returnByValue:false});
   await h.sleep(180);
   const released=await q(h,`(()=>{const o=document.getElementById('mobileParameterFocusOverlay');return {peek:o.classList.contains('mobile-profile-drag-peek'),opacity:getComputedStyle(o.querySelector('.mobile-parameter-focus-dock')).opacity,nodes:state.layers.find(l=>l.id===state.activeLayerId).profileNodes.length}})()`);
   assert(!released.peek&&Number(released.opacity)>.9&&released.nodes===2,JSON.stringify({width,released}));
   if(width===390) {
    const shot=await h.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync('/mnt/data/Somata_13.1.2_profile_compact_preview.png',Buffer.from(shot.result.data,'base64'));
    await h.evaluate(`document.querySelector('.mobile-profile-library-toggle').click()`,{returnByValue:false});
    const shot2=await h.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
    fs.writeFileSync('/mnt/data/Somata_13.1.2_profile_dropdown_preview.png',Buffer.from(shot2.result.data,'base64'));
   }
   if(width===390) {
     // The same tap workflow must work in spline mode, while freehand keeps
     // its existing stroke drawing and exposes conversion controls.
     await h.evaluate(`document.getElementById('btnResetProfile').click();document.querySelector('.profile-mode-btn[data-mode="spline"]').click()`,{returnByValue:false});
     await h.evaluate(`(()=>{const p=__profileXY({x:.5,y:0});__touchProfile('touchstart',p.x,p.y);__touchProfile('touchend',p.x,p.y)})()`,{returnByValue:false});
     const splineTap=await q(h,`(()=>{const l=state.layers.find(l=>l.id===state.activeLayerId);return {mode:l.profileMode,nodes:l.profileNodes.length}})()`);
     assert(splineTap.mode==='spline'&&splineTap.nodes===3,JSON.stringify(splineTap));
     await h.evaluate(`document.querySelector('.profile-mode-btn[data-mode="freehand_raw"]').click()`,{returnByValue:false});
     const freehandReady=await q(h,`({expanded:document.querySelector('.mobile-profile-extras').open,mode:state.layers.find(l=>l.id===state.activeLayerId).profileMode})`);
     assert(freehandReady.expanded&&freehandReady.mode==='freehand_raw',JSON.stringify(freehandReady));
     await h.evaluate(`(()=>{const p=__profileXY({x:.35,y:0});__touchProfile('touchstart',p.x,p.y);__touchProfile('touchmove',p.x+16,p.y-12);__touchProfile('touchmove',p.x+30,p.y-20);__touchProfile('touchend',p.x+30,p.y-20)})()`,{returnByValue:false});
     const freehand=await q(h,`({nodes:state.layers.find(l=>l.id===state.activeLayerId).profileNodes.length,mode:state.layers.find(l=>l.id===state.activeLayerId).profileMode})`);
     assert(freehand.mode==='freehand_raw'&&freehand.nodes>=2,JSON.stringify(freehand));
   }
   await h.evaluate(`document.getElementById('mobileParameterFocusClose').click()`,{returnByValue:false});await h.sleep(280);
   const restored=await q(h,`(()=>{const editor=document.querySelector('#settingsSidebar #profileSettingsGroup'),box=editor?.querySelector('.profile-canvas-container');return {canvas:!!editor?.querySelector('#profileCanvas'),reset:!!editor?.querySelector('.control-group-title > #btnResetProfile'),advanced:box?.nextElementSibling?.id,extras:document.querySelectorAll('.mobile-profile-extras').length,toolbar:document.querySelectorAll('.mobile-profile-toolbar').length}})()`);
   assert(restored.canvas&&restored.reset&&restored.advanced==='freehandInterpolationPanel'&&restored.extras===0&&restored.toolbar===0,JSON.stringify({width,restored}));
   tests.push({width,initial,dropdown,inserted,moved,deleted,dragging,released,restored});
  }
  assert.deepEqual(uncaughtExceptions(h.events),[]);
  console.log('PASS profile touch 13.1.2',JSON.stringify(tests));
 }finally{await h.close();}
})().catch(err=>{console.error('FAIL mobile profile touch:',err.stack||err);process.exitCode=1;});
