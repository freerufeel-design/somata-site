'use strict';
// Somata 13.1 mobile: expanded layers must not shrink under long settings;
// Android focus must hide paintable source ranges and the New Project button.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {createBrowserHarness,uncaughtExceptions}=require('./lib/browser-harness');
const css=fs.readFileSync(path.join(__dirname,'../styles/app.css'),'utf8');
const snap=(h,expression)=>h.evaluate(`JSON.stringify(${expression})`).then(JSON.parse);
(async()=>{
  const h=await createBrowserHarness({disableGpu:true,loadDelayMs:110,evalTimeoutMs:20000});
  try {
    await h.call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    await h.evaluate(`(()=>{const style=document.createElement('style');style.textContent=${JSON.stringify(css)};document.head.appendChild(style);})()`,{returnByValue:false});
    const outputs=[];
    for (const width of [320,390,640,754,760]) {
      await h.call('Emulation.setDeviceMetricsOverride',{width,height:800,deviceScaleFactor:1,mobile:true});
      // Use the actual mobile tool, drawer and layer toggle controls.
      await h.evaluate(`(()=>{
        const sidebar=document.getElementById('settingsSidebar');
        sidebar.classList.remove('mobile-open');sidebar.classList.add('mobile-layers-collapsed');
        document.getElementById('sidebarToolRail').classList.remove('mobile-open','mobile-rail-open');
        document.querySelector('#sidebarToolRail [data-sidebar-mode="shape"]').click();
        for(let i=document.querySelectorAll('#layerList .layer-item').length;i<8;i++)document.getElementById('btnAddLayer').click();
        document.getElementById('btnToggleLayerList').click();
        document.getElementById('layerList').scrollTop=0;
      })()`,{returnByValue:false});
      await h.sleep(65);
      const expanded=await snap(h,`(()=>{
        const sidebar=document.getElementById('settingsSidebar'),list=document.getElementById('layerList'),body=sidebar.querySelector('.sidebar-content'),button=document.getElementById('btnToggleLayerList');
        const item=list.querySelector('.layer-item'),r=x=>x.getBoundingClientRect();
        const lr=r(list),ir=r(item),br=r(body);
        const target=document.elementFromPoint(ir.left+Math.min(ir.width/2,60),ir.top+ir.height/2);
        return {open:sidebar.classList.contains('mobile-open'),expanded:button.getAttribute('aria-expanded'),hidden:sidebar.classList.contains('mobile-layers-collapsed'),listHeight:lr.height,bodyHeight:br.height,listScrollHeight:list.scrollHeight,listClientHeight:list.clientHeight,itemHeight:ir.height,itemVisible:getComputedStyle(item).visibility,layerHit:list.contains(target),top:lr.top,bottom:lr.bottom,bodyTop:br.top,docWidth:document.documentElement.scrollWidth,items:list.children.length,buttonDisplay:getComputedStyle(button).display};
      })()`);
      assert(expanded.open && expanded.expanded==='true' && !expanded.hidden,JSON.stringify({width,expanded}));
      assert(expanded.listHeight>=90 && expanded.itemHeight>=26 && expanded.layerHit,JSON.stringify({width,expanded}));
      assert(expanded.bodyHeight>=180 && expanded.bottom<=expanded.bodyTop+1,JSON.stringify({width,expanded}));
      assert(expanded.docWidth===width,JSON.stringify({width,expanded}));
      // The layers region scrolls independently of the settings.
      await h.evaluate(`document.getElementById('btnToggleLayerList').click()`,{returnByValue:false});
      const collapsed=await snap(h,`({display:getComputedStyle(document.getElementById('layerList')).display,expanded:document.getElementById('btnToggleLayerList').getAttribute('aria-expanded')})`);
      assert.equal(collapsed.display,'none');assert.equal(collapsed.expanded,'false');
      await h.evaluate(`document.getElementById('btnToggleLayerList').click()`,{returnByValue:false});
      // Open the focus dock with the real long-press handler.
      await h.evaluate(`document.getElementById('paramRadius').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch',pointerId:81,button:0,clientX:140,clientY:420}))`,{returnByValue:false});
      await h.sleep(540);
      const focus=await snap(h,`(()=>{
        const el=id=>document.getElementById(id),out=el('mobileParameterFocusOverlay'),range=out.querySelector('#mobileParameterRangeSlot input[type="range"]'),sources=[...document.querySelectorAll('input[type="range"]')].filter(x=>!out.contains(x));
        const rect=out.querySelector('.mobile-parameter-focus-dock').getBoundingClientRect();
        return {focused:document.body.classList.contains('mobile-parameter-focus'),sidebarDisplay:getComputedStyle(el('settingsSidebar')).display,railDisplay:getComputedStyle(el('sidebarToolRail')).display,newProjectDisplay:getComputedStyle(el('btnQuickNewProject')).display,rendererVisibility:getComputedStyle(el('mainCanvas')).visibility,rendererDisplay:getComputedStyle(el('mainCanvas')).display,activeRangeVisibility:getComputedStyle(range).visibility,activeRangeDisplay:getComputedStyle(range).display,hiddenSourceCount:sources.filter(e=>getComputedStyle(e).visibility==='hidden' || getComputedStyle(e).display==='none').length,totalSources:sources.length,dockHeight:rect.height,dockBottom:rect.bottom,screenHeight:innerHeight};
      })()`);
      assert(focus.focused && focus.sidebarDisplay==='none' && focus.railDisplay==='none',JSON.stringify({width,focus}));
      assert(focus.newProjectDisplay==='none',JSON.stringify({width,focus}));
      assert(focus.rendererVisibility==='visible' && focus.rendererDisplay!=='none',JSON.stringify({width,focus}));
      assert(focus.activeRangeVisibility==='visible' && focus.activeRangeDisplay!=='none',JSON.stringify({width,focus}));
      assert(focus.hiddenSourceCount===focus.totalSources,JSON.stringify({width,focus}));
      assert(focus.dockHeight<=140 && focus.dockBottom<=focus.screenHeight+2,JSON.stringify({width,focus}));
      if(width===390){
        await h.evaluate(`(()=>{let e=document.querySelector('#mobileParameterRangeSlot input');e.value='169';e.dispatchEvent(new Event('input',{bubbles:true}));})()`,{returnByValue:false});
        assert.equal(await h.evaluate(`document.getElementById('paramRadius').value`),'169');
        const shot=await h.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        fs.writeFileSync('/mnt/data/Somata_13.1_focus_preview.png',Buffer.from(shot.result.data,'base64'));
      }
      await h.evaluate(`document.getElementById('mobileParameterFocusClose').click()`,{returnByValue:false});
      await h.sleep(295);
      const restored=await snap(h,`({active:document.body.classList.contains('mobile-parameter-focus'),sidebarDisplay:getComputedStyle(document.getElementById('settingsSidebar')).display,newProjectDisplay:getComputedStyle(document.getElementById('btnQuickNewProject')).display,sourceValue:document.getElementById('paramRadius').value})`);
      assert(!restored.active && restored.sidebarDisplay!=='none' && restored.newProjectDisplay!=='none',JSON.stringify({width,restored}));
      if(width===390){
        const shot=await h.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});
        fs.writeFileSync('/mnt/data/Somata_13.1_layers_preview.png',Buffer.from(shot.result.data,'base64'));
      }
      outputs.push({width,layerListPx:Math.round(expanded.listHeight),settingsPx:Math.round(expanded.bodyHeight),layers:expanded.items,dockPx:Math.round(focus.dockHeight)});
      if (width===390) {
        await h.evaluate(`(()=>{for(let i=document.querySelectorAll('#layerList .layer-item').length;i<18;i++)document.getElementById('btnAddLayer').click();const list=document.getElementById('layerList');list.scrollTop=list.scrollHeight;})()`,{returnByValue:false});
        const longList=await snap(h,`(()=>{const e=document.getElementById('layerList'),last=e.lastElementChild,r=e.getBoundingClientRect(),lr=last.getBoundingClientRect();return {height:r.height,scrollHeight:e.scrollHeight,scrollTop:e.scrollTop,lastVisible:lr.bottom<=r.bottom+1 && lr.top>=r.top-1}})()`);
        assert(longList.height<=321 && longList.scrollHeight>longList.height && longList.scrollTop>0 && longList.lastVisible,JSON.stringify(longList));
      }
      await h.evaluate(`document.getElementById('btnMobileCloseSidebar').click()`,{returnByValue:false});
    }
    assert.deepEqual(uncaughtExceptions(h.events),[]);
    console.log('PASS Somata 13.1 mobile layers expansion, ghost-range isolation and new-project button',JSON.stringify(outputs));
  }finally{await h.close();}
})().catch(err=>{console.error('FAIL Somata 13.1 regression',err.stack||err);process.exitCode=1});
