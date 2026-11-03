'use strict';
// Regression for reported Android ghost sliders and oversized mobile focus dock.
// Runs against actual application markup, runtime and CSS in Chromium.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {createBrowserHarness,uncaughtExceptions} = require('./lib/browser-harness');
const css = fs.readFileSync(path.join(__dirname,'../styles/app.css'),'utf8');
const snapshot = (h, expr) => h.evaluate(`JSON.stringify(${expr})`).then(JSON.parse);

(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:90,evalTimeoutMs:20000});
  try {
    await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    await h.evaluate(`(()=>{const s=document.createElement('style');s.textContent=${JSON.stringify(css)};document.head.appendChild(s);})()`,{returnByValue:false});
    const results=[];
    for(const width of [320,390,640,760]) {
      await h.call('Emulation.setDeviceMetricsOverride',{width,height:780,deviceScaleFactor:1,mobile:true});
      await h.evaluate(`(()=>{document.getElementById('settingsSidebar').classList.remove('mobile-open');document.getElementById('sidebarToolRail').classList.remove('mobile-open','mobile-rail-open');})()`,{returnByValue:false});
      const closed = await snapshot(h,`(()=>{const p=document.getElementById('settingsSidebar'),e=document.getElementById('paramRadius');return {sidebarOpacity:getComputedStyle(p).opacity,sliderVisibility:getComputedStyle(e).visibility,visibleCanvas:getComputedStyle(document.getElementById('mainCanvas')).visibility}})()`);
      assert.equal(closed.sidebarOpacity,'0',JSON.stringify({width,closed}));
      assert.equal(closed.visibleCanvas,'visible');
      await h.evaluate(`(()=>{const e=document.getElementById('paramRadius');e.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:71,button:0,clientX:120,clientY:380}))})()`,{returnByValue:false});
      await h.sleep(530);
      const focus=await snapshot(h,`(()=>{const el=id=>document.getElementById(id),rect=e=>{let r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom,r:r.right}},head=el('mobileParameterFocusTitle'),mul=el('mobileParameterMultiplierWrap'),slot=el('mobileParameterRangeSlot'),close=el('mobileParameterFocusClose'),controls=document.querySelector('.mobile-parameter-focus-controls'),dock=document.querySelector('.mobile-parameter-focus-dock');return {focused:document.body.classList.contains('mobile-parameter-focus'),dock:rect(dock),head:rect(head),multi:rect(mul),slot:rect(slot),close:rect(close),controls:rect(controls),overlay:rect(el('mobileParameterFocusOverlay')),headerOpacity:getComputedStyle(document.querySelector('header')).opacity,sidebarOpacity:getComputedStyle(el('settingsSidebar')).opacity,canvasVisible:getComputedStyle(el('mainCanvas')).visibility,hasRange:!!slot.querySelector('.mobile-focus-proxy'),hasMultiplier:!!mul.querySelector('input'),mulHidden:mul.classList.contains('hidden'),originalInRow:!!el('paramRadius').closest('.control-row'),headParent:mul.parentElement.className,docWidth:document.documentElement.scrollWidth}})()`);
      assert(focus.focused && focus.hasRange && focus.hasMultiplier && !focus.mulHidden,JSON.stringify({width,focus}));
      assert(focus.headParent.includes('mobile-parameter-focus-head'),JSON.stringify({width,focus}));
      assert(focus.multi.y<focus.controls.y && focus.slot.y>=focus.controls.y-1,JSON.stringify({width,focus}));
      assert(focus.close.y<focus.controls.y,JSON.stringify({width,focus}));
      assert.equal(focus.headerOpacity,'0',JSON.stringify({width,focus}));
      assert.equal(focus.sidebarOpacity,'0',JSON.stringify({width,focus}));
      assert.equal(focus.canvasVisible,'visible');
      assert(focus.dock.h<=140,JSON.stringify({width,focus}));
      assert(focus.dock.x>=0 && focus.dock.r<=width+1,JSON.stringify({width,focus}));
      assert.equal(focus.docWidth,width,JSON.stringify({width,focus}));
      if(width===390){
        await h.evaluate(`(()=>{const p=document.querySelector('#mobileParameterRangeSlot input');p.value='169';p.dispatchEvent(new Event('input',{bubbles:true}));const m=document.querySelector('#mobileParameterMultiplierSlot input');m.value='2';m.dispatchEvent(new Event('input',{bubbles:true}));})()`,{returnByValue:false});
        const relay=await snapshot(h,`({slider:document.getElementById('paramRadius').value,multiplier:document.getElementById('paramRadiusMultiplier').value,output:document.getElementById('mobileParameterFocusValue').textContent})`);
        assert.equal(relay.slider,'169',JSON.stringify(relay));assert.equal(relay.multiplier,'2',JSON.stringify(relay));assert.equal(relay.output,'169',JSON.stringify(relay));
        const shot=await h.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        fs.writeFileSync('/mnt/data/somata_focus_compact_390.png',Buffer.from(shot.result.data,'base64'));
      }
      await h.evaluate(`document.getElementById('mobileParameterFocusClose').click()`,{returnByValue:false});
      await h.sleep(280);
      const exited=await snapshot(h,`({focused:document.body.classList.contains('mobile-parameter-focus'),original:!!document.getElementById('paramRadius').closest('.control-row'),proxyCount:document.querySelectorAll('#mobileParameterFocusOverlay .mobile-focus-proxy').length,sidebarOpacity:getComputedStyle(document.getElementById('settingsSidebar')).opacity})`);
      assert(!exited.focused && exited.original && exited.proxyCount===0 && exited.sidebarOpacity==='0',JSON.stringify({width,exited}));
      results.push({width,dockHeight:Math.round(focus.dock.h),headY:Math.round(focus.head.y),sliderY:Math.round(focus.slot.y)});
    }
    // Second parameter lacks multiplier. It must still occupy the same two rows.
    await h.call('Emulation.setDeviceMetricsOverride',{width:390,height:780,deviceScaleFactor:1,mobile:true});
    await h.evaluate(`document.getElementById('paramRotation').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:72,button:0}))`,{returnByValue:false});
    await h.sleep(520);
    const simple=await snapshot(h,`({focused:document.body.classList.contains('mobile-parameter-focus'),hidden:document.getElementById('mobileParameterMultiplierWrap').classList.contains('hidden'),dockHeight:document.querySelector('.mobile-parameter-focus-dock').getBoundingClientRect().height})`);
    assert(simple.focused && simple.hidden && simple.dockHeight<=140,JSON.stringify(simple));
    await h.evaluate(`document.getElementById('mobileParameterFocusClose').click()`,{returnByValue:false});
    await h.sleep(270);
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    console.log('PASS mobile two-row dock + hidden orphan controls (320/390/640/760)',JSON.stringify({results,simple}));
  } finally {await h.close();}
})().catch(err=>{console.error('FAIL mobile two-row focus dock',err.stack||err);process.exitCode=1;});
